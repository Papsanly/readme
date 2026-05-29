import { File, Paths } from 'expo-file-system';

import { useLibraryStore } from '@/src/state/library';
import { useSettingsStore } from '@/src/state/settings';
import type { AppSettings } from '@/src/types/settings';
import type { Book } from '@/src/types/book';

const BACKUP_VERSION = 1;
const EXPORT_FILENAME = 'readme-library-backup.json';

/**
 * On-disk shape of an export bundle. JSON-only, intentionally light:
 *   - books: the in-memory Book records, minus per-book file paths that are
 *     specific to *this* device (source/cover/audio uris). Those paths point
 *     into the device's app sandbox and can't be restored on another phone.
 *   - settings: full global settings snapshot.
 *
 * Audio cache / OCR / page renders / source PDFs are NOT included. The user
 * needs to re-import sources after restoring — the metadata, progress, and
 * per-book overrides come back so they can pick up where they left off.
 */
export type LibraryBackup = {
  version: 1;
  exportedAt: number;
  settings: AppSettings;
  books: BackupBook[];
};

type BackupBook = Omit<Book, 'coverUri'>;

function stripDeviceSpecificFields(book: Book): BackupBook {
  // The cover uri lives inside the device sandbox; restoring on another
  // device would point at nothing. The library re-derives the cover on
  // reprocess, so dropping it is safe.
  const { coverUri: _coverUri, ...rest } = book;
  return rest;
}

/** Build a backup payload from the current library + settings state. */
export function buildBackup(): LibraryBackup {
  const books = Object.values(useLibraryStore.getState().books).map(stripDeviceSpecificFields);
  const settingsState = useSettingsStore.getState();
  const settings: AppSettings = {
    voiceId: settingsState.voiceId,
    voiceName: settingsState.voiceName,
    speed: settingsState.speed,
    skipping: settingsState.skipping,
    ttsProvider: settingsState.ttsProvider,
    localVoice: settingsState.localVoice,
    viewMode: settingsState.viewMode,
    pronunciations: settingsState.pronunciations
  };
  return {
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    settings,
    books
  };
}

/**
 * Write a backup JSON to the cache directory and return its file URI. The
 * caller can hand the URI to `Share` (native) to let the user save / send it.
 */
export async function writeBackupToCache(): Promise<{ uri: string; size: number }> {
  const backup = buildBackup();
  const json = JSON.stringify(backup, null, 2);
  const uri = Paths.join(Paths.cache.uri, EXPORT_FILENAME);
  const file = new File(uri);
  if (file.exists) {
    try {
      file.delete();
    } catch {
      // Allow the write call to surface the underlying error if any.
    }
  }
  file.write(json);
  return { uri, size: json.length };
}

/**
 * Read a backup JSON from `uri` (the result of a document picker) and
 * validate it. Throws on schema / version mismatch — caller surfaces the
 * message in an Alert.
 */
export async function readBackupFromUri(uri: string): Promise<LibraryBackup> {
  const file = new File(uri);
  if (!file.exists) {
    throw new Error(`Backup file does not exist: ${uri}`);
  }
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Backup file is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Backup file is not an object.');
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== BACKUP_VERSION) {
    throw new Error(
      `Unsupported backup version ${String(obj.version)} (expected ${BACKUP_VERSION}).`
    );
  }
  if (!Array.isArray(obj.books) || typeof obj.settings !== 'object') {
    throw new Error('Backup file is missing required fields.');
  }
  return parsed as LibraryBackup;
}

export type ImportSummary = {
  restoredBooks: number;
  skippedBooks: number;
  settingsApplied: boolean;
};

/**
 * Apply a previously-exported backup onto the local stores. Books that
 * already exist locally (same id) are skipped — restore never clobbers
 * unsaved on-device progress. Settings are applied wholesale.
 */
export function applyBackup(backup: LibraryBackup): ImportSummary {
  const lib = useLibraryStore.getState();
  let restored = 0;
  let skipped = 0;
  for (const book of backup.books) {
    if (lib.books[book.id]) {
      skipped += 1;
      continue;
    }
    // Drop device-specific source URI; the user must re-import the source
    // file before processing. We keep the metadata so the entry shows up in
    // the library.
    const safe: Book = {
      ...book,
      // Mark as failed-with-explanation so the user knows they need to
      // re-import the source. The library card surfaces the error already.
      status: 'failed',
      processingError: 'Imported from backup — re-import the source file to resume processing.',
      blocks: book.blocks ?? [],
      progress: book.progress ?? { blockIndex: 0, positionSec: 0, updatedAt: Date.now() }
    };
    lib.addBook(safe);
    restored += 1;
  }

  const settings = useSettingsStore.getState();
  settings.setSpeed(backup.settings.speed);
  settings.setSkipping(backup.settings.skipping);
  settings.setTtsProvider(backup.settings.ttsProvider);
  settings.setVoice(backup.settings.voiceId, backup.settings.voiceName);
  if (backup.settings.localVoice) settings.setLocalVoice(backup.settings.localVoice);
  if (backup.settings.viewMode) settings.setViewMode(backup.settings.viewMode);
  settings.setPronunciations(backup.settings.pronunciations ?? []);

  return { restoredBooks: restored, skippedBooks: skipped, settingsApplied: true };
}
