/**
 * Disk cache for the Original View OCR data and its alignment to VLM blocks.
 *
 * Both files live next to the book's source/pages directory. They are kept
 * out of zustand `persist` because polygon arrays for a 200-page book are
 * heavy and would inflate AsyncStorage.
 */

import { File } from 'expo-file-system';

import type { RawOcrPage, RawOcrResult } from '@/src/api/datalab';
import { paths } from '@/src/storage/paths';
import type { BookOcr, OcrBlock, OcrPage } from '@/src/types/ocr';
import { newId } from '@/src/utils/id';

function readJsonFile<T>(uri: string): T | undefined {
  const file = new File(uri);
  if (!file.exists) return undefined;
  try {
    const text = file.textSync();
    return JSON.parse(text) as T;
  } catch (err) {
    console.warn(
      `[storage/ocr] Failed to parse ${uri}: ${err instanceof Error ? err.message : String(err)}`
    );
    return undefined;
  }
}

function writeJsonFile(uri: string, data: unknown): void {
  const file = new File(uri);
  if (file.exists) {
    try {
      file.delete();
    } catch {
      // Allow write to surface the real error.
    }
  }
  file.write(JSON.stringify(data));
}

/** Promote a `RawOcrResult` from the datalab client into a stable `BookOcr` (assigns block ids). */
export function rawOcrToBookOcr(bookId: string, raw: RawOcrResult): BookOcr {
  const pages = raw.pages.map(p => rawPageToOcrPage(p));
  return { version: 1, bookId, generatedAt: Date.now(), pages };
}

/** Promote a single raw page into an `OcrPage` (assigns block ids). */
export function rawPageToOcrPage(raw: RawOcrPage): OcrPage {
  return {
    pageIndex: raw.pageIndex,
    width: raw.width,
    height: raw.height,
    blocks: raw.blocks.map<OcrBlock>(b => ({
      id: newId('ocr'),
      pageIndex: b.pageIndex,
      label: b.label,
      text: b.text,
      polygon: b.polygon,
      bbox: b.bbox
    }))
  };
}

/**
 * Insert (or replace) a single page into a `BookOcr`. Pages are sorted by
 * `pageIndex` afterwards so the on-disk file stays canonical.
 *
 * Pass `existing = undefined` to start a new BookOcr from one page.
 */
export function mergeOcrPage(
  existing: BookOcr | undefined,
  bookId: string,
  page: OcrPage
): BookOcr {
  const base = existing ?? { version: 1 as const, bookId, generatedAt: Date.now(), pages: [] };
  const without = base.pages.filter(p => p.pageIndex !== page.pageIndex);
  without.push(page);
  without.sort((a, b) => a.pageIndex - b.pageIndex);
  return { ...base, bookId, generatedAt: Date.now(), pages: without };
}

export function loadBookOcr(bookId: string): BookOcr | undefined {
  return readJsonFile<BookOcr>(paths.bookOcr(bookId));
}

export function saveBookOcr(ocr: BookOcr): void {
  writeJsonFile(paths.bookOcr(ocr.bookId), ocr);
}

/** Idempotent: removes the cached OCR file if it exists. Used by dev "Reprocess". */
export function deleteBookOcr(bookId: string): void {
  const file = new File(paths.bookOcr(bookId));
  if (!file.exists) return;
  try {
    file.delete();
  } catch {
    // best effort
  }
}
