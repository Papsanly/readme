import { Directory, File } from 'expo-file-system';

import type { TtsAlignment } from '@/src/api/elevenlabs';
import { paths } from '@/src/storage/paths';

/** Ensure the per-book audio directory exists. Idempotent. */
export async function ensureBookAudioDir(bookId: string): Promise<void> {
  const dir = new Directory(paths.bookAudioDir(bookId));
  if (dir.exists) return;
  try {
    dir.create({ intermediates: true, idempotent: true });
  } catch (err) {
    // Re-check after the throw: another concurrent caller may have just created it.
    if (!new Directory(paths.bookAudioDir(bookId)).exists) throw err;
  }
}

/** Canonical on-disk path for a block's cached audio. */
export function getCachedAudioPath(bookId: string, blockId: string): string {
  return paths.bookAudio(bookId, blockId);
}

/** Whether the block's audio is already cached on disk. */
export async function hasCachedAudio(bookId: string, blockId: string): Promise<boolean> {
  return new File(paths.bookAudio(bookId, blockId)).exists;
}

/** Write `bytes` to the block's cache slot, overwriting any stale file. Returns the absolute uri. */
export async function writeAudio(
  bookId: string,
  blockId: string,
  bytes: Uint8Array
): Promise<string> {
  await ensureBookAudioDir(bookId);
  const uri = paths.bookAudio(bookId, blockId);
  const file = new File(uri);
  // Pre-delete to keep `write` idempotent — SDK 54 `File.write` semantics around
  // existing files differ between platforms; deleting first is uniformly safe.
  if (file.exists) {
    try {
      file.delete();
    } catch {
      // Ignore — we'll surface any real failure on the subsequent write().
    }
  }
  file.write(bytes);
  return uri;
}

/** Delete a single block's cached audio (and its alignment) if present. */
export async function deleteCachedAudio(bookId: string, blockId: string): Promise<void> {
  for (const uri of [paths.bookAudio(bookId, blockId), paths.bookAudioAlignment(bookId, blockId)]) {
    const file = new File(uri);
    if (!file.exists) continue;
    try {
      file.delete();
    } catch (err) {
      if (new File(uri).exists) throw err;
    }
  }
}

/** Persist a block's TTS alignment to disk next to its audio file. */
export async function writeAlignment(
  bookId: string,
  blockId: string,
  alignment: TtsAlignment
): Promise<void> {
  await ensureBookAudioDir(bookId);
  const uri = paths.bookAudioAlignment(bookId, blockId);
  const file = new File(uri);
  if (file.exists) {
    try {
      file.delete();
    } catch {
      // Ignore — write below will surface real failures.
    }
  }
  file.write(JSON.stringify(alignment));
}

/** Read a block's TTS alignment from disk. Returns `null` when no file exists. */
export async function readAlignment(bookId: string, blockId: string): Promise<TtsAlignment | null> {
  const uri = paths.bookAudioAlignment(bookId, blockId);
  const file = new File(uri);
  if (!file.exists) return null;
  try {
    const raw = await file.text();
    const parsed = JSON.parse(raw) as TtsAlignment;
    if (
      Array.isArray(parsed.characters) &&
      Array.isArray(parsed.startTimesSec) &&
      Array.isArray(parsed.endTimesSec)
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/** Delete the entire audio directory for a book. */
export async function clearBookAudio(bookId: string): Promise<void> {
  const dir = new Directory(paths.bookAudioDir(bookId));
  if (!dir.exists) return;
  try {
    dir.delete();
  } catch (err) {
    if (new Directory(paths.bookAudioDir(bookId)).exists) throw err;
  }
}

/** Sum of file sizes inside the book's audio directory. Returns 0 if the directory is missing. */
export async function getBookAudioSizeBytes(bookId: string): Promise<number> {
  const dir = new Directory(paths.bookAudioDir(bookId));
  if (!dir.exists) return 0;
  let total = 0;
  for (const entry of dir.list()) {
    if (entry instanceof File) total += entry.size;
  }
  return total;
}
