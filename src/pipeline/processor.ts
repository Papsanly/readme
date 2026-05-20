/**
 * Pipeline orchestrator: streamed book ingestion.
 *
 * Per-book flow:
 *   1. Pre-flight: register an `AbortController`, link the optional external
 *      signal, mark the book as `queued`. Reject duplicate calls for the same
 *      bookId via `AlreadyProcessingError`.
 *   2. Queue: enqueue the work onto a global FIFO tail so only one book is
 *      processed at a time.
 *   3. Stream: branch on the source extension.
 *      - `pdf`:               rasterize via the WebView host at scale 1.5 and
 *                             start VLM analysis on each page as soon as it
 *                             is rendered.
 *      - `png/jpg/webp/gif`:  copy the source as page 1, then run a single
 *                             VLM call with the matching media_type.
 *      - `txt/html`:          read the file, strip HTML if applicable, split
 *                             into paragraphs, no VLM.
 *      As pages finish analysis, blocks are appended to the book in
 *      page-number order. The book flips to `status: 'ready'` after page 1's
 *      blocks are committed — the user can start listening immediately while
 *      remaining pages keep processing in the background.
 *   4. Cover: write page 1 as the book cover (best effort, non-fatal) as soon
 *      as page 1 is rendered (before VLM completes).
 *
 * Cancellation:
 *   - `cancelProcessing(bookId)` aborts the internal controller for that book.
 *   - In-flight VLM requests cannot be hard-aborted (no signal in
 *     `VlmClient.analyzePage`), so they finish naturally; further dispatches
 *     are skipped immediately.
 *   - `renderPdfToPages` honors the signal, so PDF rendering stops promptly.
 *   - Before page 1 is ready: on abort the book is marked `failed` with error
 *     `'Cancelled'`. After page 1 is ready: the book stays `ready` (the user
 *     keeps what was already analyzed); later page errors are logged only.
 *   - Files are NOT auto-deleted; the user can retry or `removeBook` to wipe.
 *
 * Retry:
 *   - VLM and TTS calls retry up to RETRY_ATTEMPTS times with exponential
 *     backoff (1s, 4s, 9s, ±25% jitter) on 429, 5xx, network and timeout
 *     errors. 4xx (other than 429) are not retried.
 */

import { Directory, File } from 'expo-file-system';

import { getDefaultDatalabClient } from '@/src/api/datalab';
import { getDefaultVlmClient, vlmBlockToBlock } from '@/src/api/vlm';
import { renderPdfToPages } from '@/src/pipeline/pdf';
import { writeCoverFromPage } from '@/src/storage/books';
import { loadBookOcr, mergeOcrPage, rawPageToOcrPage, saveBookOcr } from '@/src/storage/ocr';
import { paths } from '@/src/storage/paths';
import { useLibraryStore } from '@/src/state/library';
import { useSettingsStore } from '@/src/state/settings';
import type { Block } from '@/src/types/book';
import type { OcrBlock, OcrPage } from '@/src/types/ocr';
import type {
  VlmBlock,
  VlmClient,
  VlmContext,
  VlmImageMimeType,
  VlmPageResult
} from '@/src/types/vlm';
import { newId } from '@/src/utils/id';

/** Concurrent in-flight VLM requests per book. */
const MAX_VLM_CONCURRENCY = 2;
/** pdf.js render scale; lower than the renderer default (2.0) to reduce VLM token cost. */
const PDF_RENDER_SCALE = 1.5;
/** Initial attempt + retries for retryable network calls. */
const RETRY_ATTEMPTS = 3;
/** Base delay for backoff (ms). Squared per attempt: 1s, 4s, 9s. */
const BASE_BACKOFF_MS = 1_000;
/** Symmetric jitter applied to each backoff delay (±fraction of base). */
const BACKOFF_JITTER = 0.25;

/** Ingestion options for a single book that has already been imported. */
export type ProcessBookOptions = {
  /** Existing source already imported via `storage/books.ts`. */
  bookId: string;
  /** Absolute file uri of the imported source. */
  storedUri: string;
  /** Canonical extension; `'pdf' | 'png' | 'jpg' | 'txt'`. */
  ext: string;
  /** Display title; the orchestrator does not overwrite the book's stored title. */
  title: string;
  /** Optional VLM context hint — book title for disambiguation. */
  bookTitle?: string;
  /** Optional VLM context hint — book description for tone/terminology cues. */
  bookDescription?: string;
};

/** Resolved value of `processBook` after the book has been written to the library store. */
export type ProcessBookResult = {
  bookId: string;
  blocks: Block[];
  /** Number of analyzed pages; `0` for plain-text sources. */
  pageCount: number;
};

/** Thrown when `processBook` is called for a book that is already in flight. */
export class AlreadyProcessingError extends Error {
  readonly bookId: string;

  constructor(bookId: string) {
    super(`Book ${bookId} is already being processed`);
    this.name = 'AlreadyProcessingError';
    this.bookId = bookId;
  }
}

/** A retryable async operation; receives the abort signal it should honor when supported. */
export type RetryableFn<T> = (signal?: AbortSignal) => Promise<T>;

/** Configuration for `withRetry`. */
export type WithRetryOptions = {
  /** Total attempts including the initial one. Must be ≥ 1. */
  attempts: number;
  /** Optional signal aborts the sleep between attempts and skips remaining retries. */
  signal?: AbortSignal;
  /** Returns `true` if the error should be retried. */
  isRetryable: (err: unknown) => boolean;
};

const controllers = new Map<string, AbortController>();
let queueTail: Promise<unknown> = Promise.resolve();

/** Returns true if a job for `bookId` is currently registered (queued or running). */
export function isProcessing(bookId: string): boolean {
  return controllers.has(bookId);
}

/** Abort an in-flight or queued processing job for `bookId`, if any. */
export function cancelProcessing(bookId: string): void {
  const controller = controllers.get(bookId);
  if (controller) controller.abort();
}

/**
 * End-to-end ingestion for a single imported book. Updates Library state
 * (status, progress, blocks, cover) in real time. Honors `signal`.
 */
export async function processBook(
  opts: ProcessBookOptions,
  signal?: AbortSignal
): Promise<ProcessBookResult> {
  const { bookId } = opts;

  if (controllers.has(bookId)) throw new AlreadyProcessingError(bookId);

  const internalController = new AbortController();
  controllers.set(bookId, internalController);

  let externalHandler: (() => void) | undefined;
  if (signal) {
    if (signal.aborted) {
      internalController.abort();
    } else {
      externalHandler = () => internalController.abort();
      signal.addEventListener('abort', externalHandler, { once: true });
    }
  }

  try {
    useLibraryStore.getState().updateBook(bookId, {
      status: 'queued',
      processingError: undefined
    });

    // FIFO: only one book is processed at a time across the app. We swallow the
    // tail's error so a previous job's failure does not poison subsequent turns.
    const myTurn = queueTail.catch(() => {});
    const work = myTurn.then(() => runProcessBook(opts, internalController.signal));
    queueTail = work.catch(() => {});

    return await work;
  } finally {
    if (signal && externalHandler) {
      signal.removeEventListener('abort', externalHandler);
    }
    controllers.delete(bookId);
  }
}

async function runProcessBook(
  opts: ProcessBookOptions,
  signal: AbortSignal
): Promise<ProcessBookResult> {
  const { bookId, storedUri, ext, bookTitle, bookDescription } = opts;

  // Mutable state shared with the streaming helper so the catch-block can tell
  // whether the book had already flipped to `ready` before the failure.
  const flow: StreamFlowState = { firstPageReady: false, blocks: [] };

  try {
    throwIfAborted(signal);

    useLibraryStore.getState().updateBook(bookId, {
      status: 'processing',
      processingError: undefined,
      processingProgress: { stage: 'rendering', done: 0, total: 0 }
    });

    if (ext === 'txt' || ext === 'html' || ext === 'htm') {
      const blocks = await processTextLike(storedUri, ext);
      useLibraryStore.getState().updateBook(bookId, {
        blocks,
        status: 'ready',
        processingProgress: { stage: 'done', done: blocks.length, total: blocks.length }
      });
      return { bookId, blocks, pageCount: 0 };
    }

    const settings = useSettingsStore.getState();
    const context: VlmContext = { skipping: settings.skipping };
    if (bookTitle) context.bookTitle = bookTitle;
    if (bookDescription) context.bookDescription = bookDescription;

    const pageCount = await streamRenderAndAnalyze(
      { bookId, storedUri, ext, context },
      flow,
      signal
    );

    useLibraryStore.getState().updateBook(bookId, {
      processingProgress: { stage: 'done', done: pageCount, total: pageCount }
    });

    return { bookId, blocks: flow.blocks, pageCount };
  } catch (err) {
    // After page 1 has committed, we keep the book usable and treat later
    // failures (cancel or otherwise) as non-fatal. The user can keep listening
    // to whatever has already been analyzed.
    if (flow.firstPageReady) {
      console.warn(
        `[processor] background processing stopped for ${bookId} after page 1 was ready: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      const processedPages = new Set(flow.blocks.map(b => b.page ?? 1)).size;
      return { bookId, blocks: flow.blocks, pageCount: processedPages };
    }
    const isCancel = signal.aborted || (err instanceof Error && err.name === 'AbortError');
    const message = isCancel ? 'Cancelled' : err instanceof Error ? err.message : String(err);
    useLibraryStore.getState().updateBook(bookId, {
      status: 'failed',
      processingError: message
    });
    throw err;
  }
}

type StreamFlowState = {
  firstPageReady: boolean;
  blocks: Block[];
};

async function processTextLike(storedUri: string, ext: string): Promise<Block[]> {
  let text = await new File(storedUri).text();
  if (ext === 'html' || ext === 'htm') {
    text = htmlToPlainText(text);
  }
  const paragraphs = splitTxtParagraphs(text);
  return paragraphs.map((paragraph, i) => ({
    id: newId('blk'),
    index: i,
    type: 'paragraph',
    text: paragraph,
    isMainContent: true
  }));
}

function splitTxtParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

const HTML_ENTITY_MAP: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
};

/**
 * Strip HTML to plain text without bringing in a parser dep. Good enough for
 * narration: drops script/style content, replaces block tags with newlines so
 * paragraph boundaries survive, then decodes the common named entities.
 */
function htmlToPlainText(html: string): string {
  // Remove script/style blocks wholesale — never read aloud.
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // Block-level closers become paragraph breaks.
    .replace(/<\/(?:p|div|section|article|li|h[1-6]|blockquote|tr)>/gi, '\n\n')
    // Hard line breaks inside block elements.
    .replace(/<br\s*\/?>/gi, '\n')
    // Anything else goes — strip every remaining tag.
    .replace(/<[^>]+>/g, '')
    // Numeric entities → unicode codepoints.
    .replace(/&#(\d+);/g, (_, code: string) => {
      const n = parseInt(code, 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => {
      const n = parseInt(code, 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : '';
    })
    // Named entities — only the handful that matter for narration.
    .replace(/&([a-z]+);/gi, (match, name: string) => {
      const v = HTML_ENTITY_MAP[name.toLowerCase()];
      return v ?? match;
    });
  // Collapse runs of whitespace inside lines.
  return stripped.replace(/[ \t]+/g, ' ');
}

function imageMimeTypeForExt(ext: string): VlmImageMimeType {
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    default:
      return 'image/png';
  }
}

const IMAGE_EXTS: ReadonlySet<string> = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

type StreamInput = {
  bookId: string;
  storedUri: string;
  ext: string;
  context: VlmContext;
};

/**
 * Drive rendering and VLM analysis in parallel. Each page kicks off a VLM
 * request as soon as it has been written to disk; analyzed pages are committed
 * to the library store in strict page-number order so block indices stay
 * monotonic. The book flips to `ready` after page 1's blocks land, allowing
 * the user to start listening while later pages keep streaming in.
 *
 * Returns the total page count once both rendering and analysis are complete.
 */
async function streamRenderAndAnalyze(
  input: StreamInput,
  flow: StreamFlowState,
  signal: AbortSignal
): Promise<number> {
  const { bookId, storedUri, ext, context } = input;

  if (IMAGE_EXTS.has(ext)) {
    ensureDirectory(paths.bookPagesDir(bookId));
    const pageUri = paths.bookPage(bookId, 1);
    copyFile(storedUri, pageUri);
    useLibraryStore.getState().updateBook(bookId, {
      processingProgress: { stage: 'rendering', done: 1, total: 1 }
    });
    await commitCover(bookId, pageUri);
    await analyzeAndCommitPage({
      bookId,
      pageNumber: 1,
      pageUri,
      imageMimeType: imageMimeTypeForExt(ext),
      totalPages: 1,
      context,
      flow,
      signal,
      client: getDefaultVlmClient(),
      onProgressLabel: 'analyzing',
      onCompleted: () => {
        useLibraryStore.getState().updateBook(bookId, {
          processingProgress: { stage: 'analyzing', done: 1, total: 1 }
        });
      }
    });
    return 1;
  }

  if (ext !== 'pdf') {
    throw new Error(`Unsupported extension for rendering: ${ext}`);
  }

  const client = getDefaultVlmClient();

  // Per-page VLM results, sparse, indexed by `pageNumber - 1`.
  const pageResults: (VlmPageResult | undefined)[] = [];
  let nextPageToCommit = 1;
  let renderedTotal = 0;

  let coverWritten = false;
  let globalBlockIndex = 0;
  let inFlight = 0;
  const slotWaiters: (() => void)[] = [];
  const vlmPromises: Promise<void>[] = [];

  const acquireSlot = (): Promise<void> =>
    new Promise<void>(resolve => {
      const tryAcquire = (): void => {
        if (inFlight < MAX_VLM_CONCURRENCY) {
          inFlight += 1;
          resolve();
          return;
        }
        slotWaiters.push(tryAcquire);
      };
      tryAcquire();
    });

  const releaseSlot = (): void => {
    inFlight -= 1;
    const w = slotWaiters.shift();
    if (w) w();
  };

  const tryCommitInOrder = (): void => {
    while (nextPageToCommit <= renderedTotal && pageResults[nextPageToCommit - 1] !== undefined) {
      const pageNumber = nextPageToCommit;
      const result = pageResults[pageNumber - 1] as VlmPageResult;
      const pageUri = paths.bookPage(bookId, pageNumber);

      const newBlocks: Block[] = [];
      for (const vlm of result.blocks) {
        const partial = vlmBlockToBlock(vlm, pageNumber, globalBlockIndex);
        // Figure regions are not cropped in MVP; point at the whole page PNG.
        newBlocks.push(vlm.isFigure ? { ...partial, imageUri: pageUri } : partial);
        globalBlockIndex += 1;
      }
      flow.blocks = flow.blocks.concat(newBlocks);

      const patch: Partial<{
        blocks: Block[];
        status: 'ready';
      }> = { blocks: flow.blocks };
      if (!flow.firstPageReady) {
        patch.status = 'ready';
        flow.firstPageReady = true;
      }
      useLibraryStore.getState().updateBook(bookId, patch);

      nextPageToCommit += 1;
    }

    const committedPages = nextPageToCommit - 1;
    if (committedPages > 0 && renderedTotal > 0) {
      useLibraryStore.getState().updateBook(bookId, {
        processingProgress: {
          stage: 'analyzing',
          done: committedPages,
          total: renderedTotal
        }
      });
    }
  };

  const startVlmForPage = (pageNumber: number): void => {
    const p = (async () => {
      await acquireSlot();
      let fallbackOcrPage: OcrPage | undefined;
      try {
        if (signal.aborted) return;
        const pageUri = paths.bookPage(bookId, pageNumber);

        // Step 1: datalab OCR for this page. Result is persisted to BookOcr
        // on disk so the Original View just reads the cache.
        const pageOcr = await runOcrForPage(bookId, pageUri, pageNumber, signal);
        fallbackOcrPage = pageOcr;
        if (signal.aborted) return;

        // Step 2: VLM with image + OCR JSON. Model emits narration blocks
        // with `ocrBlockIds` referencing the layout we just produced.
        const imageBase64 = await new File(pageUri).base64();
        if (signal.aborted) return;
        const ocrBlocks = pageOcr.blocks.map(b => ({ id: b.id, label: b.label, text: b.text }));
        const result = await withRetry(
          () =>
            client.analyzePage({
              imageBase64,
              context,
              pageNumber,
              totalPages: renderedTotal,
              ocrBlocks
            }),
          {
            attempts: RETRY_ATTEMPTS,
            signal,
            isRetryable: e => isVlmRetryable(e, signal)
          }
        );
        pageResults[pageNumber - 1] = result;
        tryCommitInOrder();
      } catch (err) {
        if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) throw err;
        const fallback = fallbackPageResultFromOcr(fallbackOcrPage);
        if (!flow.firstPageReady && fallback.blocks.length === 0) throw err;
        console.warn(
          `[processor] VLM failed for ${bookId} page ${pageNumber}; using OCR fallback and continuing: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        pageResults[pageNumber - 1] = fallback;
        tryCommitInOrder();
      } finally {
        releaseSlot();
      }
    })();
    vlmPromises.push(p);
  };

  await renderPdfToPages({
    bookId,
    pdfUri: storedUri,
    scale: PDF_RENDER_SCALE,
    signal,
    onProgress: (pageNumber, total) => {
      renderedTotal = total;
      // Live-update the rendering counter for the upload screen until the
      // analyzer takes over the progress field on its first commit.
      useLibraryStore.getState().updateBook(bookId, {
        processingProgress: { stage: 'rendering', done: pageNumber, total }
      });
      // Cover ASAP — does not block VLM dispatch.
      if (pageNumber === 1 && !coverWritten) {
        coverWritten = true;
        const coverPageUri = paths.bookPage(bookId, 1);
        void commitCover(bookId, coverPageUri);
      }
      startVlmForPage(pageNumber);
    }
  });

  // Rendering is done; wait for any still-running VLM jobs.
  await Promise.all(vlmPromises);

  // Defensive: ensure the trailing pages have been committed.
  tryCommitInOrder();

  return renderedTotal;
}

/**
 * Submit a rasterized page PNG to datalab marker, persist the resulting
 * OCR layout to the on-disk `BookOcr`, and return the page record so the
 * caller can pass `ocrBlocks` hints into the VLM call.
 *
 * Failures are non-fatal: if datalab is unavailable we return an empty
 * page record so the VLM still runs (without OCR hints / overlay support).
 */
async function runOcrForPage(
  bookId: string,
  pageUri: string,
  pageNumber: number,
  signal: AbortSignal
): Promise<OcrPage> {
  try {
    const datalab = getDefaultDatalabClient();
    const raw = await withRetry(
      () => datalab.runMarkerForPage({ pageImageUri: pageUri, pageNumber, signal }),
      {
        attempts: RETRY_ATTEMPTS,
        signal,
        isRetryable: e => isVlmRetryable(e, signal)
      }
    );
    const ocrPage = rawPageToOcrPage(raw);
    const existing = loadBookOcr(bookId);
    const updated = mergeOcrPage(existing, bookId, ocrPage);
    saveBookOcr(updated);
    return ocrPage;
  } catch (err) {
    if (signal.aborted) throw err;
    console.warn(
      `[processor] datalab OCR failed for ${bookId} page ${pageNumber}: ${
        err instanceof Error ? err.message : String(err)
      } — continuing without OCR hints (Original View overlays will be unavailable for this page)`
    );
    // Empty page record so VLM proceeds without ocrBlockIds.
    return {
      pageIndex: pageNumber,
      width: 0,
      height: 0,
      blocks: []
    };
  }
}

function cleanOcrText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function ocrBlockReadingOrder(a: OcrBlock, b: OcrBlock): number {
  const ay = a.bbox[1];
  const by = b.bbox[1];
  if (Math.abs(ay - by) > 12) return ay - by;
  return a.bbox[0] - b.bbox[0];
}

function fallbackTypeForOcrLabel(label: string): VlmBlock['type'] {
  const l = label.toLowerCase();
  if (l.includes('header') || l.includes('footer')) return 'header-footer';
  if (l.includes('page') && l.includes('number')) return 'page-number';
  if (l.includes('footnote')) return 'footnote';
  if (l.includes('toc') || l.includes('contents')) return 'toc';
  if (l.includes('caption')) return 'caption';
  if (l.includes('section') || l.includes('title') || l.includes('heading')) return 'heading';
  if (l.includes('list')) return 'list';
  if (l.includes('quote')) return 'quote';
  if (l.includes('picture') || l.includes('figure') || l.includes('image') || l.includes('table')) {
    return 'figure';
  }
  return 'paragraph';
}

function isServiceOcrLabel(label: string): boolean {
  const l = label.toLowerCase();
  return (
    l.includes('header') ||
    l.includes('footer') ||
    (l.includes('page') && l.includes('number')) ||
    l.includes('footnote') ||
    l.includes('toc') ||
    l.includes('contents')
  );
}

function fallbackPageResultFromOcr(ocrPage: OcrPage | undefined): VlmPageResult {
  const ocrBlocks = [...(ocrPage?.blocks ?? [])]
    .map(block => ({ block, text: cleanOcrText(block.text) }))
    .filter(item => item.text.length > 0)
    .sort((a, b) => ocrBlockReadingOrder(a.block, b.block));

  const blocks: VlmBlock[] = ocrBlocks.map(({ block, text }) => {
    const type = fallbackTypeForOcrLabel(block.label);
    const isFigure = type === 'figure';
    const isMainContent = !isServiceOcrLabel(block.label);
    return {
      type,
      text,
      rawText: text,
      isFigure,
      isMainContent,
      ocrBlockIds: [block.id]
    };
  });

  return { blocks };
}

async function commitCover(bookId: string, pageUri: string): Promise<void> {
  try {
    const coverUri = await writeCoverFromPage(bookId, pageUri);
    useLibraryStore.getState().updateBook(bookId, { coverUri });
  } catch (err) {
    console.warn(
      `[processor] writeCoverFromPage failed for ${bookId}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

type AnalyzeAndCommitArgs = {
  bookId: string;
  pageNumber: number;
  pageUri: string;
  /** Defaults to `image/png` (the PDF render output). Set for native image sources. */
  imageMimeType?: VlmImageMimeType;
  totalPages: number;
  context: VlmContext;
  flow: StreamFlowState;
  signal: AbortSignal;
  client: VlmClient;
  onProgressLabel: 'analyzing';
  onCompleted: () => void;
};

/**
 * Single-page analyze-and-commit, used for the png/jpg branch where there's
 * exactly one page and no streaming order to manage.
 */
async function analyzeAndCommitPage(args: AnalyzeAndCommitArgs): Promise<void> {
  const { bookId, pageNumber, pageUri, imageMimeType, totalPages, context, flow, signal, client } =
    args;
  throwIfAborted(signal);
  useLibraryStore.getState().updateBook(bookId, {
    processingProgress: { stage: args.onProgressLabel, done: 0, total: totalPages }
  });
  const ocrPage = await runOcrForPage(bookId, pageUri, pageNumber, signal);
  const imageBase64 = await new File(pageUri).base64();
  const result = await withRetry(
    () =>
      client.analyzePage({
        imageBase64,
        imageMimeType,
        context,
        pageNumber,
        totalPages,
        ocrBlocks: ocrPage.blocks.map(b => ({ id: b.id, label: b.label, text: b.text }))
      }),
    {
      attempts: RETRY_ATTEMPTS,
      signal,
      isRetryable: e => isVlmRetryable(e, signal)
    }
  );

  let globalIndex = flow.blocks.length;
  const newBlocks: Block[] = [];
  for (const vlm of result.blocks) {
    const partial = vlmBlockToBlock(vlm, pageNumber, globalIndex);
    newBlocks.push(vlm.isFigure ? { ...partial, imageUri: pageUri } : partial);
    globalIndex += 1;
  }
  flow.blocks = flow.blocks.concat(newBlocks);
  flow.firstPageReady = true;
  useLibraryStore.getState().updateBook(bookId, { blocks: flow.blocks, status: 'ready' });
  args.onCompleted();
}

/**
 * Run `fn` up to `attempts` times with exponential backoff (1s, 4s, 9s, ±25% jitter).
 * Stops early on non-retryable errors or signal abort.
 */
export async function withRetry<T>(fn: RetryableFn<T>, opts: WithRetryOptions): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt += 1) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      return await fn(opts.signal);
    } catch (err) {
      lastError = err;
      if (attempt >= opts.attempts) break;
      if (!opts.isRetryable(err)) break;
      const baseMs = BASE_BACKOFF_MS * attempt * attempt;
      const jitter = baseMs * (Math.random() * 2 - 1) * BACKOFF_JITTER;
      const delay = Math.max(0, baseMs + jitter);
      await sleepCancellable(delay, opts.signal);
    }
  }
  throw lastError;
}

/** True if a VLM error is worth retrying — false on user-aborted requests. */
export function isVlmRetryable(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false;
  return isRetryableErrorMessage(err);
}

/** True if a TTS (ElevenLabs) error is worth retrying — false on user-aborted requests. */
export function isTtsRetryable(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false;
  return isRetryableErrorMessage(err);
}

function isRetryableErrorMessage(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'AbortError') return false;
  const msg = err.message.toLowerCase();
  return (
    /\b429\b/.test(msg) ||
    /http 5\d\d/.test(msg) ||
    /timed out/.test(msg) ||
    /\btimeout\b/.test(msg) ||
    /\bnetwork\b/.test(msg) ||
    /\babort/.test(msg) ||
    /request failed/.test(msg) ||
    /failed before receiving/.test(msg) ||
    /could not be read/.test(msg)
  );
}

function ensureDirectory(dirUri: string): void {
  const dir = new Directory(dirUri);
  if (dir.exists) return;
  try {
    dir.create({ intermediates: true, idempotent: true });
  } catch (err) {
    if (!new Directory(dirUri).exists) throw err;
  }
}

function copyFile(src: string, dest: string): void {
  const source = new File(src);
  const target = new File(dest);
  if (target.exists) {
    try {
      target.delete();
    } catch {
      // Allow `copy` to surface the real error.
    }
  }
  source.copy(target);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
}

async function sleepCancellable(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return new Promise<void>((resolve, reject) => {
    let abortHandler: (() => void) | undefined;
    const timer = setTimeout(() => {
      if (abortHandler && signal) signal.removeEventListener('abort', abortHandler);
      resolve();
    }, ms);
    if (signal) {
      abortHandler = () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', abortHandler, { once: true });
    }
  });
}
