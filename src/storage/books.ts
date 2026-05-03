import { Directory, File } from 'expo-file-system';

import { paths } from '@/src/storage/paths';
import { newId } from '@/src/utils/id';

const HEAD_TIMEOUT_MS = 15_000;

/** Canonical extensions accepted as book sources in the MVP. */
export const SUPPORTED_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'txt'] as const;
export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

const EXT_BY_MIME: Readonly<Record<string, SupportedExtension>> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'text/plain': 'txt'
};

const SUPPORTED_SET: ReadonlySet<string> = new Set(SUPPORTED_EXTENSIONS);

/** Thrown when an input file's mime/extension is outside the accepted MVP list. */
export class UnsupportedFormatError extends Error {
  readonly hint?: string;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'UnsupportedFormatError';
    this.hint = hint;
  }
}

/** Thrown for any failure during URL ingestion (network, HTTP non-2xx, etc.). */
export class DownloadError extends Error {
  readonly status?: number;
  readonly cause?: unknown;

  constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message);
    this.name = 'DownloadError';
    this.status = options.status;
    this.cause = options.cause;
  }
}

function ensureBookDir(bookId: string): void {
  const dir = new Directory(paths.bookDir(bookId));
  if (dir.exists) return;
  try {
    dir.create({ intermediates: true, idempotent: true });
  } catch (err) {
    if (!new Directory(paths.bookDir(bookId)).exists) throw err;
  }
}

function lowerExt(name: string): string | undefined {
  const m = /\.([A-Za-z0-9]+)(?:\?|#|$)/.exec(name);
  return m ? m[1].toLowerCase() : undefined;
}

function normalizeExt(raw: string | undefined): SupportedExtension | undefined {
  if (!raw) return undefined;
  const v = raw.toLowerCase();
  // Canonicalize `jpeg` → `jpg` so all JPEG inputs (filename or mime) land at
  // the same on-disk path.
  if (v === 'jpeg') return 'jpg';
  return SUPPORTED_SET.has(v) ? (v as SupportedExtension) : undefined;
}

function extFromMime(mime: string | undefined): SupportedExtension | undefined {
  if (!mime) return undefined;
  // Strip parameters like `; charset=utf-8`.
  const main = mime.split(';')[0].trim().toLowerCase();
  return EXT_BY_MIME[main];
}

function deriveExt(name: string, mime: string | undefined): SupportedExtension {
  const fromName = normalizeExt(lowerExt(name));
  if (fromName) return fromName;
  const fromMime = extFromMime(mime);
  if (fromMime) return fromMime;
  throw new UnsupportedFormatError(
    `Unsupported book format (name="${name}", mime="${mime ?? 'unknown'}")`,
    `Accepted: ${SUPPORTED_EXTENSIONS.join(', ')}`
  );
}

function basenameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const segments = u.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    return last || u.hostname || 'download';
  } catch {
    return 'download';
  }
}

function stripExt(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i > 0 ? filename.slice(0, i) : filename;
}

function copyFileSync(src: string, dest: string): void {
  const source = new File(src);
  if (!source.exists) {
    throw new DownloadError(`Source file does not exist: ${src}`);
  }
  const target = new File(dest);
  if (target.exists) {
    try {
      target.delete();
    } catch {
      // Allow `copy` to surface the real error if any.
    }
  }
  source.copy(target);
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function probeUrl(url: string): Promise<{ contentType?: string }> {
  // HEAD first; some servers don't support it, in which case we'll fall back to
  // sniffing the GET response headers later.
  try {
    const res = await fetchWithTimeout(url, { method: 'HEAD' }, HEAD_TIMEOUT_MS);
    if (res.ok) {
      const ct = res.headers.get('content-type') ?? undefined;
      return { contentType: ct };
    }
  } catch {
    // Swallow — caller will retry with GET.
  }
  return {};
}

/** Result of `importLocalFile`. */
export type ImportLocalFileResult = {
  bookId: string;
  storedUri: string;
  ext: SupportedExtension;
};

/** Result of `importUrl`. */
export type ImportUrlResult = {
  bookId: string;
  storedUri: string;
  ext: SupportedExtension;
  suggestedTitle: string;
};

/**
 * Copy a local file (e.g. a document picker result) into the canonical
 * `bookSource(bookId, ext)` slot and return the new bookId.
 */
export async function importLocalFile(input: {
  sourceUri: string;
  mime: string;
  name: string;
}): Promise<ImportLocalFileResult> {
  const ext = deriveExt(input.name, input.mime);
  const bookId = newId('book');
  ensureBookDir(bookId);
  const storedUri = paths.bookSource(bookId, ext);
  try {
    copyFileSync(input.sourceUri, storedUri);
  } catch (err) {
    // Roll back the half-created directory so we don't leak empty book folders.
    try {
      new Directory(paths.bookDir(bookId)).delete();
    } catch {
      // Best-effort; surface the original error.
    }
    if (err instanceof UnsupportedFormatError || err instanceof DownloadError) throw err;
    throw new DownloadError(
      `Failed to copy local file into book ${bookId}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }
  return { bookId, storedUri, ext };
}

/**
 * Download a remote URL into the canonical `bookSource(bookId, ext)` slot.
 * Validates content-type/extension before persisting.
 */
export async function importUrl(input: { url: string }): Promise<ImportUrlResult> {
  const { url } = input;

  let probedContentType: string | undefined;
  try {
    const probe = await probeUrl(url);
    probedContentType = probe.contentType;
  } catch {
    // Move on; we'll re-derive ext from the GET response if needed.
  }

  const filename = basenameFromUrl(url);
  let ext: SupportedExtension;
  try {
    ext = deriveExt(filename, probedContentType);
  } catch (err) {
    if (!(err instanceof UnsupportedFormatError)) throw err;
    // Defer until we have GET headers.
    ext = 'pdf'; // placeholder, replaced after GET
  }

  const bookId = newId('book');
  ensureBookDir(bookId);

  let response: Response;
  try {
    response = await fetchWithTimeout(url, { method: 'GET' }, HEAD_TIMEOUT_MS);
  } catch (err) {
    cleanupBookDir(bookId);
    throw new DownloadError(
      `Failed to GET ${url}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }

  if (!response.ok) {
    cleanupBookDir(bookId);
    throw new DownloadError(`GET ${url} returned HTTP ${response.status}`, {
      status: response.status
    });
  }

  // Re-derive ext now that we have authoritative response headers.
  const resolvedContentType =
    response.headers.get('content-type') ?? probedContentType ?? undefined;
  try {
    ext = deriveExt(filename, resolvedContentType);
  } catch (err) {
    cleanupBookDir(bookId);
    throw err;
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await response.arrayBuffer();
  } catch (err) {
    cleanupBookDir(bookId);
    throw new DownloadError(`Failed to read body of ${url}`, { cause: err });
  }

  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength === 0) {
    cleanupBookDir(bookId);
    throw new DownloadError(`Empty response body for ${url}`);
  }

  const storedUri = paths.bookSource(bookId, ext);
  try {
    const file = new File(storedUri);
    if (file.exists) {
      try {
        file.delete();
      } catch {
        // Allow write to surface the real error.
      }
    }
    file.write(bytes);
  } catch (err) {
    cleanupBookDir(bookId);
    throw new DownloadError(
      `Failed to write downloaded body to ${storedUri}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }

  return {
    bookId,
    storedUri,
    ext,
    suggestedTitle: stripExt(filename) || 'Imported document'
  };
}

/** Copy the rendered first page into the canonical `bookCover(bookId)` slot. */
export async function writeCoverFromPage(bookId: string, pageUri: string): Promise<string> {
  ensureBookDir(bookId);
  const dest = paths.bookCover(bookId);
  copyFileSync(pageUri, dest);
  return dest;
}

function cleanupBookDir(bookId: string): void {
  const dir = new Directory(paths.bookDir(bookId));
  if (!dir.exists) return;
  try {
    dir.delete();
  } catch {
    // Best-effort; surface the originating error to the caller.
  }
}

/** Recursively delete the entire on-disk directory for a book (idempotent). */
export async function deleteBookFiles(bookId: string): Promise<void> {
  cleanupBookDir(bookId);
}
