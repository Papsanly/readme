import { getEffectiveSettings } from '@/src/hooks/useEffectiveSettings';
import { prefetchBlocks } from '@/src/pipeline/tts';
import { useLibraryStore } from '@/src/state/library';
import { hasCachedAudio } from '@/src/storage/audioCache';
import type { Block } from '@/src/types/book';
import type { SkippingMode } from '@/src/types/settings';
import { applyPronunciationsToText } from '@/src/utils/pronunciation';

const SERVICE_ONLY_SKIP_TYPES: ReadonlySet<Block['type']> = new Set([
  'page-number',
  'header-footer',
  'footnote',
  'toc',
  'service'
]);

function isPlayableBlock(block: Block, skipping: SkippingMode): boolean {
  if (skipping === 'none') return true;
  if (skipping === 'main-only') return block.isMainContent;
  return !SERVICE_ONLY_SKIP_TYPES.has(block.type);
}

const TTS_MIN_SPEED = 0.7;
const TTS_MAX_SPEED = 1.2;

function clampTtsSpeed(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(TTS_MAX_SPEED, Math.max(TTS_MIN_SPEED, v));
}

export type PreloadProgress = {
  /** Number of playable blocks already cached on disk. */
  cached: number;
  /** Total playable blocks the book contains under the current skipping mode. */
  total: number;
};

export type PreloadOptions = {
  /** Concurrent TTS calls. Default 2 — matches the player's normal prefetch. */
  concurrency?: number;
  /** Receives progress updates as new blocks land in the cache. */
  onProgress?: (progress: PreloadProgress) => void;
  /** Cancels remaining work; in-flight requests finish naturally. */
  signal?: AbortSignal;
};

/**
 * Walk every playable block in the book (filtered by the book's effective
 * skipping mode) and synthesize the ones that aren't cached yet. Skips
 * already-cached blocks for free — re-running after some blocks landed via
 * normal playback only synthesizes the remainder.
 */
export async function preloadBookAudio(
  bookId: string,
  opts: PreloadOptions = {}
): Promise<PreloadProgress> {
  const book = useLibraryStore.getState().books[bookId];
  if (!book) throw new Error(`Book ${bookId} not found`);
  const effective = getEffectiveSettings(bookId);
  if (effective.ttsProvider === 'elevenlabs' && !effective.voiceId) {
    throw new Error('Choose a voice in Settings before preloading audio.');
  }

  const playable = book.blocks.filter(b => isPlayableBlock(b, effective.skipping));
  const total = playable.length;
  if (total === 0) return { cached: 0, total: 0 };

  // Fast pass: count what's already cached so the bar starts at the right spot.
  let cached = 0;
  for (const b of playable) {
    if (await hasCachedAudio(bookId, b.id)) cached += 1;
  }
  opts.onProgress?.({ cached, total });
  if (cached === total) return { cached, total };

  // Build the queue of misses. Order matches reading order — the prefetch
  // pool will pick up the first uncached ones first, which is also the
  // most useful order for the user if they start listening mid-preload.
  const queue: { id: string; text: string }[] = [];
  for (const b of playable) {
    if (!(await hasCachedAudio(bookId, b.id))) {
      queue.push({ id: b.id, text: applyPronunciationsToText(b.text, effective.pronunciations) });
    }
  }

  const ttsSpeed = clampTtsSpeed(effective.speed);

  // Mirror `prefetchBlocks` but with progress reporting. Each successful
  // synth bumps `cached`; failures are logged inside `prefetchBlocks` and
  // do not advance the counter — the user can hit "Preload" again later
  // to retry the misses.
  let cursor = 0;
  const concurrency = Math.max(1, opts.concurrency ?? 2);
  const worker = async (): Promise<void> => {
    while (cursor < queue.length) {
      if (opts.signal?.aborted) return;
      const i = cursor;
      cursor += 1;
      const item = queue[i];
      try {
        await prefetchBlocks(
          bookId,
          [item],
          effective.voiceId,
          { speed: ttsSpeed },
          { signal: opts.signal, concurrency: 1 }
        );
        if (await hasCachedAudio(bookId, item.id)) {
          cached += 1;
          opts.onProgress?.({ cached, total });
        }
      } catch (err) {
        // Individual block failure is non-fatal — keep the rest of the
        // queue moving. The user-visible counter just stops advancing for
        // this block.
        console.warn(
          `[preload] block ${item.id} failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  };

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, queue.length); i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return { cached, total };
}

/**
 * Cheap synchronous snapshot used by the UI to show "X / Y blocks downloaded"
 * without scheduling any work. Returns `undefined` if the book is missing.
 */
export async function inspectPreloadProgress(bookId: string): Promise<PreloadProgress | undefined> {
  const book = useLibraryStore.getState().books[bookId];
  if (!book) return undefined;
  const effective = getEffectiveSettings(bookId);
  const playable = book.blocks.filter(b => isPlayableBlock(b, effective.skipping));
  let cached = 0;
  for (const b of playable) {
    if (await hasCachedAudio(bookId, b.id)) cached += 1;
  }
  return { cached, total: playable.length };
}
