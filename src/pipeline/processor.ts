/**
 * Pipeline orchestrator: end-to-end book ingestion.
 *
 * Per-book flow:
 *   1. Pre-flight: register an `AbortController`, link the optional external
 *      signal, mark the book as `queued`. Reject duplicate calls for the same
 *      bookId via `AlreadyProcessingError`.
 *   2. Queue: enqueue the work onto a global FIFO tail so only one book is
 *      processed at a time.
 *   3. Render: branch on the source extension.
 *      - `pdf`:        rasterize via the WebView host at scale 1.5 (lower than
 *                      the renderer default of 2.0 to control VLM token cost).
 *      - `png` / `jpg`: copy the source as page 1 (no rendering required).
 *      - `txt`:        read the file, split into paragraphs, skip steps 4-5.
 *   4. Cover: write page 1 as the book cover (best effort, non-fatal).
 *   5. VLM: analyze each page in parallel up to MAX_VLM_CONCURRENCY with
 *      retry/backoff. Live-update `processingProgress` as pages complete.
 *   6. Reduce: flatten per-page blocks into a globally-indexed list, attaching
 *      `imageUri` to figure blocks (whole page PNG for MVP — no region crop).
 *   7. Persist: write blocks, mark `status: 'ready'`, clear progress.
 *
 * Cancellation:
 *   - `cancelProcessing(bookId)` aborts the internal controller for that book.
 *   - In-flight VLM requests cannot be hard-aborted (no signal in
 *     `VlmClient.analyzePage`), so they finish naturally; further dispatches
 *     are skipped immediately.
 *   - `renderPdfToPages` honors the signal, so PDF rendering stops promptly.
 *   - On abort the book is marked `failed` with error `'Cancelled'`. Files are
 *     NOT auto-deleted; the user can retry the import or `removeBook` to wipe.
 *
 * Retry:
 *   - VLM and TTS calls retry up to RETRY_ATTEMPTS times with exponential
 *     backoff (1s, 4s, 9s, ±25% jitter) on 429, 5xx, network and timeout
 *     errors. 4xx (other than 429) are not retried.
 */

import { Directory, File } from 'expo-file-system';

import { getDefaultVlmClient, vlmBlockToBlock } from '@/src/api/vlm';
import { renderPdfToPages } from '@/src/pipeline/pdf';
import { writeCoverFromPage } from '@/src/storage/books';
import { paths } from '@/src/storage/paths';
import { useLibraryStore } from '@/src/state/library';
import { useSettingsStore } from '@/src/state/settings';
import type { Block } from '@/src/types/book';
import type { VlmContext, VlmPageResult } from '@/src/types/vlm';
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

  try {
    throwIfAborted(signal);

    useLibraryStore.getState().updateBook(bookId, {
      status: 'processing',
      processingError: undefined,
      processingProgress: { stage: 'rendering', done: 0, total: 0 }
    });

    if (ext === 'txt') {
      const blocks = await processTxt(storedUri);
      useLibraryStore.getState().updateBook(bookId, {
        blocks,
        status: 'ready',
        processingProgress: { stage: 'done', done: blocks.length, total: blocks.length }
      });
      return { bookId, blocks, pageCount: 0 };
    }

    const pages = await renderOrCopyPages({ bookId, storedUri, ext }, signal);

    throwIfAborted(signal);

    if (pages.length > 0) {
      try {
        const coverUri = await writeCoverFromPage(bookId, pages[0].uri);
        useLibraryStore.getState().updateBook(bookId, { coverUri });
      } catch (err) {
        console.warn(
          `[processor] writeCoverFromPage failed for ${bookId}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    const blocks = await analyzePages(bookId, pages, { bookTitle, bookDescription }, signal);

    useLibraryStore.getState().updateBook(bookId, {
      blocks,
      status: 'ready',
      processingProgress: { stage: 'done', done: pages.length, total: pages.length }
    });

    return { bookId, blocks, pageCount: pages.length };
  } catch (err) {
    const isCancel = signal.aborted || (err instanceof Error && err.name === 'AbortError');
    const message = isCancel ? 'Cancelled' : err instanceof Error ? err.message : String(err);
    useLibraryStore.getState().updateBook(bookId, {
      status: 'failed',
      processingError: message
    });
    throw err;
  }
}

async function processTxt(storedUri: string): Promise<Block[]> {
  const text = await new File(storedUri).text();
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

type RenderInput = { bookId: string; storedUri: string; ext: string };

async function renderOrCopyPages(
  input: RenderInput,
  signal: AbortSignal
): Promise<{ pageNumber: number; uri: string }[]> {
  const { bookId, storedUri, ext } = input;

  if (ext === 'pdf') {
    const result = await renderPdfToPages({
      bookId,
      pdfUri: storedUri,
      scale: PDF_RENDER_SCALE,
      signal,
      onProgress: (page, total) => {
        useLibraryStore.getState().updateBook(bookId, {
          processingProgress: { stage: 'rendering', done: page, total }
        });
      }
    });
    return result.pages;
  }

  if (ext === 'png' || ext === 'jpg') {
    ensureDirectory(paths.bookPagesDir(bookId));
    const pageUri = paths.bookPage(bookId, 1);
    copyFile(storedUri, pageUri);
    useLibraryStore.getState().updateBook(bookId, {
      processingProgress: { stage: 'rendering', done: 1, total: 1 }
    });
    return [{ pageNumber: 1, uri: pageUri }];
  }

  throw new Error(`Unsupported extension for rendering: ${ext}`);
}

async function analyzePages(
  bookId: string,
  pages: { pageNumber: number; uri: string }[],
  ctxOpts: { bookTitle?: string; bookDescription?: string },
  signal: AbortSignal
): Promise<Block[]> {
  const total = pages.length;

  const settings = useSettingsStore.getState();
  const context: VlmContext = { skipping: settings.skipping };
  if (ctxOpts.bookTitle) context.bookTitle = ctxOpts.bookTitle;
  if (ctxOpts.bookDescription) context.bookDescription = ctxOpts.bookDescription;

  useLibraryStore.getState().updateBook(bookId, {
    processingProgress: { stage: 'analyzing', done: 0, total }
  });

  let completed = 0;
  const client = getDefaultVlmClient();
  const pageResults = new Array<VlmPageResult>(total);

  await mapWithConcurrency(
    pages,
    MAX_VLM_CONCURRENCY,
    async (page, index) => {
      throwIfAborted(signal);
      const imageBase64 = await new File(page.uri).base64();
      const result = await withRetry(
        () =>
          client.analyzePage({
            imageBase64,
            context,
            pageNumber: page.pageNumber,
            totalPages: total
          }),
        {
          attempts: RETRY_ATTEMPTS,
          signal,
          isRetryable: e => isVlmRetryable(e, signal)
        }
      );
      pageResults[index] = result;
      completed += 1;
      useLibraryStore.getState().updateBook(bookId, {
        processingProgress: { stage: 'analyzing', done: completed, total }
      });
    },
    signal
  );

  return reduceBlocks(pages, pageResults);
}

function reduceBlocks(
  pages: { pageNumber: number; uri: string }[],
  pageResults: VlmPageResult[]
): Block[] {
  const blocks: Block[] = [];
  let globalIndex = 0;
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i];
    const result = pageResults[i];
    if (!result) continue;
    for (const vlm of result.blocks) {
      const partial = vlmBlockToBlock(vlm, page.pageNumber, globalIndex);
      // Figure regions are not cropped in MVP; point at the whole page PNG.
      const block: Block = vlm.isFigure ? { ...partial, imageUri: page.uri } : partial;
      blocks.push(block);
      globalIndex += 1;
    }
  }
  return blocks;
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

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  let firstError: unknown;

  const worker = async (): Promise<void> => {
    while (true) {
      if (firstError !== undefined) return;
      if (signal?.aborted) {
        if (firstError === undefined) firstError = new DOMException('Aborted', 'AbortError');
        return;
      }
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        if (firstError === undefined) firstError = err;
        return;
      }
    }
  };

  const workerCount = Math.min(concurrency, items.length);
  const pool: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i += 1) pool.push(worker());
  await Promise.all(pool);

  if (firstError !== undefined) throw firstError;
  return results;
}
