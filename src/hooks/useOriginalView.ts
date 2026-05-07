/**
 * `useOriginalView(bookId)` — load the cached `BookOcr` for the player.
 *
 * OCR is produced during initial book processing (alongside VLM analysis),
 * so the hook is purely a disk-cache read. Alignment between VLM blocks
 * and OCR overlays is read directly off `Block.ocrBlockIds` — no fuzzy
 * matching needed.
 */

import { useEffect, useMemo, useState } from 'react';

import { useLibraryStore } from '@/src/state/library';
import { loadBookOcr } from '@/src/storage/ocr';
import type { BookOcr } from '@/src/types/ocr';

export type UseOriginalViewResult = {
  /** Loaded BookOcr if available; undefined while loading or if cache empty. */
  ocr: BookOcr | undefined;
  /** True when the book source isn't a PDF — original view is unavailable. */
  unsupported: boolean;
};

export function useOriginalView(bookId: string | undefined): UseOriginalViewResult {
  const book = useLibraryStore(s => (bookId ? s.books[bookId] : undefined));
  const [ocr, setOcr] = useState<BookOcr | undefined>();

  const isPdf = useMemo(() => {
    if (!book) return false;
    return /\.pdf$/i.test(book.source.name);
  }, [book]);

  // Re-read on bookId change AND on any blocks update — streaming processing
  // appends pages to the on-disk BookOcr, and we want the UI to pick them up.
  const blockCount = book?.blocks.length ?? 0;

  useEffect(() => {
    if (!bookId || !isPdf) {
      setOcr(undefined);
      return;
    }
    setOcr(loadBookOcr(bookId));
  }, [bookId, isPdf, blockCount]);

  return {
    ocr,
    unsupported: !!book && !isPdf
  };
}
