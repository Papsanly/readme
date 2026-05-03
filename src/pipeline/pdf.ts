import { Directory, File } from 'expo-file-system';

import { paths } from '@/src/storage/paths';
import { newId } from '@/src/utils/id';

const DEFAULT_SCALE = 2;
const DEFAULT_READY_TIMEOUT_MS = 30_000;
const DATA_URL_PREFIX = 'data:image/png;base64,';

/** Thrown when a render is requested but no `<PdfRendererHost />` has been mounted. */
export class PdfRendererNotReadyError extends Error {
  constructor(message = 'PdfRendererHost is not mounted') {
    super(message);
    this.name = 'PdfRendererNotReadyError';
  }
}

/** Thrown for any failure surfaced by the WebView during rendering. */
export class PdfRenderError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'PdfRenderError';
    this.cause = cause;
  }
}

/** Single render job dispatched from `renderPdfToPages` to the host. */
export type PdfRendererJob = {
  /** Stable job id used for trace/debug. */
  id: string;
  /** `file://` uri of the PDF the host should rasterize. */
  pdfUri: string;
  /** pdf.js render scale; ~1.0 is screen-resolution, 2.0 ≈ 150 DPI. */
  scale: number;
  /** Invoked once per rendered page with a base64 PNG data URL. */
  onPage: (pageNumber: number, total: number, dataUrl: string) => void;
  /** Invoked once when the WebView signals all pages have been rendered. */
  onDone: (total: number) => void;
  /** Invoked once on any WebView failure — `onPage`/`onDone` will not fire afterwards. */
  onError: (err: Error) => void;
};

/** Surface that `<PdfRendererHost />` exposes to the bus. */
export type PdfRendererImpl = {
  run: (job: PdfRendererJob) => void;
};

/** Caller-facing options for `renderPdfToPages`. */
export type RenderPdfToPagesOptions = {
  bookId: string;
  pdfUri: string;
  /** Defaults to 2.0 (~150 DPI in screen coords for crisp VLM input). */
  scale?: number;
  onProgress?: (pageNumber: number, total: number) => void;
  signal?: AbortSignal;
};

/** Result of a successful render. */
export type RenderPdfToPagesResult = {
  pages: { pageNumber: number; uri: string }[];
};

let impl: PdfRendererImpl | null = null;
let readyResolve: (() => void) | null = null;
const ready: Promise<void> = new Promise<void>(r => {
  readyResolve = r;
});

/** Called by `<PdfRendererHost />` once on mount to take over job dispatch. */
export function registerPdfRenderer(next: PdfRendererImpl): () => void {
  impl = next;
  if (readyResolve) {
    readyResolve();
    readyResolve = null;
  }
  return () => {
    if (impl === next) impl = null;
  };
}

/** Internal: wait until a host has registered, with a timeout. */
async function waitForHost(timeoutMs: number): Promise<PdfRendererImpl> {
  if (impl) return impl;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new PdfRendererNotReadyError(`PdfRendererHost did not become ready within ${timeoutMs}ms`)
        ),
      timeoutMs
    );
  });
  try {
    await Promise.race([ready, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!impl) throw new PdfRendererNotReadyError();
  return impl;
}

function decodeDataUrl(dataUrl: string): string {
  if (!dataUrl.startsWith(DATA_URL_PREFIX)) {
    throw new PdfRenderError(`Unexpected data URL prefix: ${dataUrl.slice(0, 40)}…`);
  }
  return dataUrl.slice(DATA_URL_PREFIX.length);
}

function ensurePagesDir(bookId: string): void {
  const dir = new Directory(paths.bookPagesDir(bookId));
  if (dir.exists) return;
  try {
    dir.create({ intermediates: true, idempotent: true });
  } catch (err) {
    if (!new Directory(paths.bookPagesDir(bookId)).exists) throw err;
  }
}

function clearPagesDir(bookId: string): void {
  const dir = new Directory(paths.bookPagesDir(bookId));
  if (!dir.exists) return;
  try {
    dir.delete();
  } catch {
    // Best-effort; the next attempt may resurrect or recreate as needed.
  }
}

function writePngFromBase64(uri: string, base64: string): void {
  const file = new File(uri);
  if (file.exists) {
    try {
      file.delete();
    } catch {
      // Fall through to write — surface real errors there.
    }
  }
  file.write(base64, { encoding: 'base64' });
}

/**
 * Rasterize every page of a PDF to PNG and persist each page to
 * `paths.bookPage(bookId, n)`. Resolves with the list of written pages.
 */
export async function renderPdfToPages(
  opts: RenderPdfToPagesOptions
): Promise<RenderPdfToPagesResult> {
  const { bookId, pdfUri, onProgress, signal } = opts;
  const scale = opts.scale ?? DEFAULT_SCALE;

  if (signal?.aborted) {
    throw new DOMException('Render aborted before start', 'AbortError');
  }

  const renderer = await waitForHost(DEFAULT_READY_TIMEOUT_MS);

  ensurePagesDir(bookId);

  return new Promise<RenderPdfToPagesResult>((resolve, reject) => {
    const written: { pageNumber: number; uri: string }[] = [];
    let settled = false;

    const cleanupOnFailure = (): void => {
      clearPagesDir(bookId);
    };

    const finishWithError = (err: Error): void => {
      if (settled) return;
      settled = true;
      if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
      cleanupOnFailure();
      reject(err);
    };

    const finishWithSuccess = (): void => {
      if (settled) return;
      settled = true;
      if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
      written.sort((a, b) => a.pageNumber - b.pageNumber);
      resolve({ pages: written });
    };

    const abortHandler = signal
      ? () => finishWithError(new DOMException('Render aborted', 'AbortError'))
      : null;
    if (signal && abortHandler) signal.addEventListener('abort', abortHandler);

    const job: PdfRendererJob = {
      id: newId('pdfjob'),
      pdfUri,
      scale,
      onPage: (pageNumber, total, dataUrl) => {
        if (settled) return;
        try {
          const base64 = decodeDataUrl(dataUrl);
          const uri = paths.bookPage(bookId, pageNumber);
          writePngFromBase64(uri, base64);
          written.push({ pageNumber, uri });
          if (onProgress) {
            try {
              onProgress(pageNumber, total);
            } catch (err) {
              console.warn(
                `[pdf] onProgress threw for page ${pageNumber}: ${err instanceof Error ? err.message : String(err)}`
              );
            }
          }
        } catch (err) {
          finishWithError(
            err instanceof Error ? err : new PdfRenderError(`Failed to persist page ${pageNumber}`)
          );
        }
      },
      onDone: () => {
        finishWithSuccess();
      },
      onError: err => {
        finishWithError(err);
      }
    };

    try {
      renderer.run(job);
    } catch (err) {
      finishWithError(err instanceof Error ? err : new PdfRenderError('Renderer dispatch failed'));
    }
  });
}
