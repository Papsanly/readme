import { getTtsClient, type TtsClient } from '@/src/api/tts';
import {
  clearBookAudio,
  getCachedAudioPath,
  hasCachedAudio,
  writeAlignment,
  writeAudio
} from '@/src/storage/audioCache';
import type { VoiceSettings } from '@/src/types/voice';

const DEFAULT_PREFETCH_CONCURRENCY = 2;

export type SynthesizeBlockOptions = {
  bookId: string;
  blockId: string;
  text: string;
  /** Voice id from the ElevenLabs picker; ignored when the OpenAI provider is active. */
  voiceId?: string;
  voiceSettings?: VoiceSettings;
  /** Bypass the cache and re-synthesize even if a file already exists. */
  force?: boolean;
};

export type PrefetchItem = {
  id: string;
  text: string;
};

export type PrefetchOptions = {
  /** Maximum concurrent in-flight TTS requests. Defaults to 2. */
  concurrency?: number;
  /** Aborts dispatch of remaining items; in-flight requests are allowed to finish. */
  signal?: AbortSignal;
};

function resolveClient(client?: TtsClient): TtsClient {
  return client ?? getTtsClient();
}

/**
 * Synthesize a single block's audio and persist it to the cache.
 * Returns the on-disk uri and whether it was served from cache.
 */
export async function synthesizeBlockToFile(
  opts: SynthesizeBlockOptions,
  client?: TtsClient
): Promise<{ uri: string; cached: boolean }> {
  const { bookId, blockId, text, voiceId, voiceSettings, force } = opts;
  const uri = getCachedAudioPath(bookId, blockId);

  if (!force && (await hasCachedAudio(bookId, blockId))) {
    return { uri, cached: true };
  }

  const result = await resolveClient(client).synthesize({
    voiceId,
    text,
    voiceSettings
  });
  const writtenUri = await writeAudio(bookId, blockId, result.bytes);
  // Persist alignment data when the provider returned any (ElevenLabs).
  // Local server (XTTS-v2) returns audio only — we silently skip writing
  // the JSON, and `readAlignment` later returns `null`.
  if (result.alignment) {
    try {
      await writeAlignment(bookId, blockId, result.alignment);
    } catch (err) {
      console.warn(
        `[tts] writeAlignment failed for ${blockId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return { uri: writtenUri, cached: false };
}

/** Same as `synthesizeBlockToFile` but returns just the on-disk uri. */
export async function ensureBlockAudio(
  opts: SynthesizeBlockOptions,
  client?: TtsClient
): Promise<string> {
  const { uri } = await synthesizeBlockToFile(opts, client);
  return uri;
}

/**
 * Pre-warm the cache for a sequence of blocks using a bounded worker pool.
 * Individual failures are logged via `console.warn` and do not abort the queue.
 */
export async function prefetchBlocks(
  bookId: string,
  items: PrefetchItem[],
  voiceId: string | undefined,
  voiceSettings?: VoiceSettings,
  opts: PrefetchOptions = {},
  client?: TtsClient
): Promise<void> {
  if (items.length === 0) return;

  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_PREFETCH_CONCURRENCY);
  const signal = opts.signal;
  const resolvedClient = resolveClient(client);

  let cursor = 0;
  const total = items.length;

  const worker = async (): Promise<void> => {
    while (cursor < total) {
      if (signal?.aborted) return;
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (!item) return;
      try {
        await synthesizeBlockToFile(
          {
            bookId,
            blockId: item.id,
            text: item.text,
            voiceId,
            voiceSettings
          },
          resolvedClient
        );
      } catch (err) {
        console.warn(
          `[tts] prefetch failed for block ${item.id}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  };

  const workerCount = Math.min(concurrency, total);
  const workers: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
}

/** Drop all cached audio for a book — call when voice or voice settings change. */
export async function invalidateVoice(bookId: string): Promise<void> {
  await clearBookAudio(bookId);
}
