import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { TtsAlignment } from '@/src/api/elevenlabs';
import { getEffectiveSettings, useEffectiveSettings } from '@/src/hooks/useEffectiveSettings';
import { isTtsRetryable, withRetry } from '@/src/pipeline/processor';
import { invalidateVoice, prefetchBlocks, synthesizeBlockToFile } from '@/src/pipeline/tts';
import { useLibraryStore } from '@/src/state/library';
import { usePlayerStore } from '@/src/state/player';
import { hasCachedAudio, readAlignment } from '@/src/storage/audioCache';
import type { Block } from '@/src/types/book';
import type { SkippingMode } from '@/src/types/settings';

/** ElevenLabs server-side speed cap. Anything outside is clamped *for the API call* only. */
const TTS_MIN_SPEED = 0.7;
const TTS_MAX_SPEED = 1.2;

/** expo-audio playback rate range, common across platforms. */
const PLAYER_MIN_RATE = 0.5;
const PLAYER_MAX_RATE = 2.0;

/** Periodic cadence for persisting `progress.positionSec` while playing. */
const PROGRESS_TICK_MS = 1000;

/** Number of upcoming main-content blocks to prefetch ahead of the current one. */
const PREFETCH_LOOKAHEAD = 2;

/** Status updates from `expo-audio` come every 500 ms by default — quick enough for a scrubber. */
const PLAYER_UPDATE_INTERVAL_MS = 250;

export type UseAudioEngineResult = {
  /** Current block's audio file is loaded and ready to play. */
  isReady: boolean;
  /** A synthesize/load is currently in flight for the current block. */
  isLoadingBlock: boolean;
  /** Last error from synthesizing the current block, if any. */
  blockError?: string;
  /** Intra-block playback position in seconds. */
  positionSec: number;
  /** Intra-block duration in seconds (0 until the file is loaded). */
  durationSec: number;
  /**
   * Position within the *current page*, in seconds. Sums durations of
   * already-finished playable blocks on this page plus the running
   * playback position of the current block. Treats the page as one
   * continuous track for the player UI.
   */
  pagePositionSec: number;
  /**
   * Total duration of the current page, in seconds. Real durations are
   * used for blocks that have been loaded into the player at least once;
   * the rest are estimated from text length so the bar moves predictably
   * even before later blocks have been synthesized.
   */
  pageDurationSec: number;
  /** 1-based current page number (or `0` when the book has no pages). */
  currentPage: number;
  /** Total number of pages in the book. */
  totalPages: number;
  /** Force-retry the current block (re-synthesize, bypassing the cache). */
  retryCurrentBlock: () => void;
  /** Toggle play/pause via the player store. */
  togglePlay: () => void;
  /** Skip ±N seconds inside the current block. */
  seekBy: (deltaSec: number) => void;
  /** Move to the previous playable block (respecting `skipping`). No-op at start. */
  goPrev: () => void;
  /** Move to the next playable block (respecting `skipping`). No-op at end. */
  goNext: () => void;
  /**
   * Jump to `offsetSec` inside `blockIndex`. If `blockIndex` is the block
   * already loaded in the player, this seeks the live audio directly
   * (works during playback, no re-synthesis). If it's a different block,
   * we set the player store and let the load effect pick up the pending
   * offset after the new source loads.
   */
  seekToBlockOffset: (blockIndex: number, offsetSec: number) => void;
  /**
   * Best-known duration of a block in seconds — real value if the block
   * has been loaded into the player at least once, otherwise a text-length
   * estimate scaled by the current playback speed. Stable identity per
   * render but its return values may change as more durations are observed.
   */
  estimateBlockDuration: (block: Block) => number;
  /**
   * Convert a (block, character offset within its text) pair to an audio
   * offset in seconds. Uses TTS-emitted character timestamps when the
   * provider returned them (ElevenLabs); falls back to a proportional
   * char-rate estimate otherwise (XTTS-v2 / local server).
   */
  charOffsetToAudioSec: (block: Block, charOffset: number) => number;
};

/**
 * Rough TTS speaking rate at speed 1× — used to estimate the duration of
 * blocks we haven't loaded yet so the page progress bar shows a sensible
 * total before every block has been synthesized.
 */
const ESTIMATED_CHARS_PER_SECOND = 14;
const MIN_ESTIMATED_BLOCK_SEC = 1;

function clampTtsSpeed(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(TTS_MAX_SPEED, Math.max(TTS_MIN_SPEED, v));
}

function clampPlayerRate(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(PLAYER_MAX_RATE, Math.max(PLAYER_MIN_RATE, v));
}

/**
 * Apply the user's playback rate to the audio player without running 1×
 * audio through the pitch-correction filter. Passing
 * `pitchCorrectionQuality: 'high'` even at rate 1.0 makes some
 * `expo-audio` builds add a subtle warble/buzz to clean source audio.
 * When the user is exactly at 1×, we omit the quality argument so the
 * filter chain is bypassed entirely.
 */
function applyPlaybackRate(player: AudioPlayer, speed: number): void {
  const rate = clampPlayerRate(speed);
  try {
    if (rate === 1) {
      player.setPlaybackRate(1);
    } else {
      player.setPlaybackRate(rate, 'high');
    }
  } catch (err) {
    console.warn('[player] setPlaybackRate failed', err);
  }
}

/** Block types skipped in `service-only` mode — strictly the ones the user
 *  almost never wants narrated, regardless of how the VLM classified them. */
const SERVICE_ONLY_SKIP_TYPES: ReadonlySet<Block['type']> = new Set([
  'page-number',
  'header-footer',
  'footnote',
  'toc',
  'service'
]);

function isPlayableBlock(block: Block, skipping: SkippingMode): boolean {
  if (skipping === 'none') return true;
  if (skipping === 'main-only') {
    // Aggressive: skip anything the VLM did not flag as main content.
    return block.isMainContent;
  }
  // 'service-only' — keep everything except a fixed list of block types,
  // independent of the `isMainContent` flag. This way headings, captions,
  // figures, etc. are always read; only page numbers / headers-footers /
  // footnotes / service / toc get skipped.
  return !SERVICE_ONLY_SKIP_TYPES.has(block.type);
}

/**
 * Locate the next block index that should be played given a `skipping` mode.
 * Returns `null` when no further playable block exists in the requested direction.
 */
export function nextPlayableBlockIndex(
  blocks: readonly Block[],
  current: number,
  direction: 'forward' | 'backward',
  skipping: SkippingMode
): number | null {
  const step = direction === 'forward' ? 1 : -1;
  for (let i = current + step; i >= 0 && i < blocks.length; i += step) {
    const block = blocks[i];
    if (block && isPlayableBlock(block, skipping)) return i;
  }
  return null;
}

/** Index of the first playable block on the given page, or `null` if none. */
function firstPlayableBlockOnPage(
  blocks: readonly Block[],
  pageNumber: number,
  skipping: SkippingMode
): number | null {
  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks[i];
    if (!b) continue;
    if ((b.page ?? 1) === pageNumber && isPlayableBlock(b, skipping)) return i;
  }
  return null;
}

/**
 * Step to the next/previous *page* (relative to `fromPage`) that contains
 * at least one playable block. Returns `null` when no such page exists.
 */
function adjacentPageWithPlayable(
  blocks: readonly Block[],
  fromPage: number,
  direction: 'forward' | 'backward',
  skipping: SkippingMode
): number | null {
  const pages = new Set<number>();
  for (const b of blocks) pages.add(b.page ?? 1);
  const sorted = Array.from(pages).sort((a, b) => a - b);
  const i = sorted.indexOf(fromPage);
  if (i === -1) return null;
  const step = direction === 'forward' ? 1 : -1;
  for (let j = i + step; j >= 0 && j < sorted.length; j += step) {
    if (firstPlayableBlockOnPage(blocks, sorted[j], skipping) != null) return sorted[j];
  }
  return null;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Drives a single shared `expo-audio` player from the current player/settings/library state.
 * The hook is the only owner of the underlying `AudioPlayer` — mount it once per Player screen.
 */
export function useAudioEngine(bookId: string): UseAudioEngineResult {
  // ----- Reactive sources -------------------------------------------------
  const blocks = useLibraryStore(s => s.books[bookId]?.blocks) ?? EMPTY_BLOCKS;
  const currentBlockIndex = usePlayerStore(s => s.currentBlockIndex);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  // Effective (global + per-book override) reading settings.
  const effective = useEffectiveSettings(bookId);
  const voiceId = effective.voiceId;
  const speed = effective.speed;
  const skipping = effective.skipping;
  const ttsProvider = effective.ttsProvider;
  const localVoice = effective.localVoice;

  // ----- Local state ------------------------------------------------------
  const [isReady, setIsReady] = useState(false);
  const [isLoadingBlock, setIsLoadingBlock] = useState(false);
  const [blockError, setBlockError] = useState<string | undefined>(undefined);
  const [positionSec, setPositionSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  /**
   * Real durations of blocks observed when they were loaded into the player
   * at least once. Keys are block ids. Bumped via `durationsTick` so the
   * page-progress derivation re-runs on each new measurement.
   */
  const knownDurationsRef = useRef<Map<string, number>>(new Map());
  const [durationsTick, setDurationsTick] = useState(0);
  /**
   * Per-block TTS alignment (character → audio time) loaded from disk
   * after each block is synthesized. Populated lazily as blocks play.
   * Provider-dependent: ElevenLabs ships alignments, the local XTTS
   * server doesn't, so this map only ever holds entries for blocks that
   * had alignment data when their audio was written.
   */
  const alignmentsRef = useRef<Map<string, TtsAlignment>>(new Map());

  // ----- Refs (engine internals, no re-render triggers) -------------------
  const playerRef = useRef<AudioPlayer | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);
  const prefetchAbortRef = useRef<AbortController | null>(null);
  const lastTtsSpeedRef = useRef<number>(clampTtsSpeed(speed));
  const lastVoiceIdRef = useRef<string | undefined>(voiceId);
  const lastLocalVoiceRef = useRef<string | undefined>(localVoice);
  const lastTtsProviderRef = useRef(ttsProvider);
  /**
   * `true` while we've fired the finish-handler for the current source and
   * haven't yet swapped in the next source. While this is set, all
   * `didJustFinish` status updates are ignored — `expo-audio` can deliver
   * several of them in a row from the old source before the `replace` swap
   * actually takes effect, and without this gate each one would advance the
   * index again (the "skips every other block" symptom).
   */
  const transitioningRef = useRef(false);
  /** When `cacheEpoch` increments, the current-block effect re-runs even if index is unchanged. */
  const [cacheEpoch, setCacheEpoch] = useState(0);

  const safeIndex =
    blocks.length > 0 ? Math.min(Math.max(currentBlockIndex, 0), blocks.length - 1) : -1;
  // Track the *identity* of the current block separately from the array so the
  // current-block load effect doesn't re-run (and restart audio) every time
  // streaming appends new blocks elsewhere in the array.
  const currentBlock = safeIndex >= 0 ? blocks[safeIndex] : undefined;
  const currentBlockId = currentBlock?.id;
  const blocksLength = blocks.length;

  // Page-level progress: aggregate the current page's blocks into a single
  // virtual track so the player UI shows page position / page duration
  // instead of the individual ~10–30 second block segments. `txt` books and
  // anything without per-block page numbers fall back to a single page.
  const pageProgress = useMemo(() => {
    if (!currentBlock) {
      return { pagePositionSec: 0, pageDurationSec: 0, currentPage: 0, totalPages: 0 };
    }
    const currentPageNum = currentBlock.page ?? 1;
    const allPages = new Set<number>();
    const pageBlocks: Block[] = [];
    for (const b of blocks) {
      const p = b.page ?? 1;
      allPages.add(p);
      if (p === currentPageNum) pageBlocks.push(b);
    }
    const known = knownDurationsRef.current;
    const blockDuration = (b: Block): number => {
      const real = known.get(b.id);
      if (real != null && Number.isFinite(real) && real > 0) return real;
      // Estimate from text length, scaled by playback speed.
      const charsPerSec = ESTIMATED_CHARS_PER_SECOND * Math.max(0.5, speed);
      const est = b.text.length / Math.max(1, charsPerSec);
      return Math.max(MIN_ESTIMATED_BLOCK_SEC, est);
    };
    const indexInPage = pageBlocks.findIndex(b => b.id === currentBlockId);
    let position = 0;
    if (indexInPage > 0) {
      for (let i = 0; i < indexInPage; i += 1) position += blockDuration(pageBlocks[i]);
    }
    position += positionSec;
    const total = pageBlocks.reduce((s, b) => s + blockDuration(b), 0);
    return {
      pagePositionSec: position,
      pageDurationSec: total,
      currentPage: currentPageNum,
      totalPages: allPages.size
    };
    // `durationsTick` participates so newly observed real durations refresh
    // the bar; React Compiler ignores this kind of plain ref read otherwise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, currentBlock, currentBlockId, positionSec, speed, durationsTick]);

  // ----- Player lifecycle: create once, release on unmount ---------------
  useEffect(() => {
    const player = createAudioPlayer(null, { updateInterval: PLAYER_UPDATE_INTERVAL_MS });
    playerRef.current = player;

    const subscription = player.addListener('playbackStatusUpdate', status => {
      if (typeof status.currentTime === 'number') setPositionSec(status.currentTime);
      if (typeof status.duration === 'number') setDurationSec(status.duration);
      if (status.didJustFinish === true) {
        // Ignore lingering `didJustFinish` events from the old source that
        // arrive after we've already advanced. The flag is only released
        // below, when we observe a confirmed-not-finished update from the
        // new source.
        if (transitioningRef.current) return;
        transitioningRef.current = true;
        handleBlockFinishedRef.current?.();
      } else {
        // Real, non-finished update — the new source is producing events,
        // so any old-source backlog is gone. Re-arm the gate.
        transitioningRef.current = false;
      }
    });

    return () => {
      subscription.remove();
      try {
        player.remove();
      } catch (err) {
        console.warn('[player] failed to release audio player', err);
      }
      playerRef.current = null;
    };
    // The player is created once per Player-screen mount; the bookId is read via
    // refs/state inside event handlers, so we don't recreate on bookId changes.
  }, []);

  // Record the current block's duration whenever a fresh, non-zero value
  // arrives from the player. This populates `knownDurationsRef` so the page
  // progress bar uses real durations after a block is loaded once.
  useEffect(() => {
    if (!currentBlockId) return;
    if (!Number.isFinite(durationSec) || durationSec <= 0) return;
    const prev = knownDurationsRef.current.get(currentBlockId);
    if (prev === durationSec) return;
    knownDurationsRef.current.set(currentBlockId, durationSec);
    setDurationsTick(t => t + 1);
  }, [currentBlockId, durationSec]);

  // ----- Stable callback for `didJustFinish` -----------------------------
  // Reads fresh state from the stores at invocation time (no stale closures).
  // The rising-edge gate in the listener guarantees this runs at most once
  // per finished source, so we don't need any per-block bookkeeping here.
  const handleBlockFinishedRef = useRef<() => void>(() => {});
  useEffect(() => {
    handleBlockFinishedRef.current = () => {
      const blocksNow = useLibraryStore.getState().books[bookId]?.blocks ?? [];
      const skippingNow = getEffectiveSettings(bookId).skipping;
      const idx = usePlayerStore.getState().currentBlockIndex;
      const next = nextPlayableBlockIndex(blocksNow, idx, 'forward', skippingNow);
      if (next == null) {
        usePlayerStore.getState().pause();
        return;
      }
      usePlayerStore.getState().setBlock(next);
    };
  }, [bookId]);

  // ----- Cache invalidation on voice / provider / TTS-speed change ------
  useEffect(() => {
    const newTtsSpeed = clampTtsSpeed(speed);
    let invalidated = false;
    if (lastVoiceIdRef.current !== voiceId) {
      lastVoiceIdRef.current = voiceId;
      invalidated = true;
    }
    if (lastLocalVoiceRef.current !== localVoice) {
      lastLocalVoiceRef.current = localVoice;
      invalidated = true;
    }
    if (lastTtsProviderRef.current !== ttsProvider) {
      lastTtsProviderRef.current = ttsProvider;
      invalidated = true;
    }
    if (lastTtsSpeedRef.current !== newTtsSpeed) {
      lastTtsSpeedRef.current = newTtsSpeed;
      invalidated = true;
    }
    if (invalidated) {
      void invalidateVoice(bookId).catch(err => {
        console.warn('[player] invalidateVoice failed', err);
      });
      setCacheEpoch(epoch => epoch + 1);
    }
  }, [bookId, voiceId, localVoice, ttsProvider, speed]);

  // ----- Apply rate to player whenever speed changes ---------------------
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    applyPlaybackRate(player, speed);
  }, [speed]);

  // ----- Current-block load (synthesize → replace source) ----------------
  // Deps are intentionally narrow: `currentBlockId` (not the full `blocks`
  // array) is what tells us "the current block has actually changed". When the
  // streaming pipeline appends *other* blocks, the array reference changes but
  // `currentBlockId` stays the same, so we don't restart the audio.
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    if (safeIndex < 0) return;
    const block = currentBlock;
    if (!block) return;
    if (ttsProvider === 'elevenlabs' && !voiceId) {
      setIsReady(false);
      setIsLoadingBlock(false);
      setBlockError('Choose a voice in Settings to start listening.');
      return;
    }

    const ac = new AbortController();
    loadAbortRef.current?.abort();
    loadAbortRef.current = ac;

    setBlockError(undefined);
    setPositionSec(0);
    setDurationSec(0);

    const ttsSpeed = clampTtsSpeed(speed);

    void (async () => {
      try {
        // Cache-hit fast path: if the synth was already done (prefetch hit
        // or replayed block), skip the pre-load pause and the loading
        // spinner entirely. Page transitions where the next page's first
        // block was prefetched feel instant — no pause, no spinner flash.
        const cacheHit = await hasCachedAudio(bookId, block.id);
        if (ac.signal.aborted) return;

        if (!cacheHit) {
          // Cold path: stop old audio NOW (synth may take 1-30s), show
          // the spinner, then synthesize.
          try {
            player.pause();
          } catch (err) {
            console.warn('[player] pre-load pause failed', err);
          }
          setIsReady(false);
          setIsLoadingBlock(true);
        }

        const { uri } = await withRetry(
          () =>
            synthesizeBlockToFile({
              bookId,
              blockId: block.id,
              text: block.text,
              voiceId,
              voiceSettings: { speed: ttsSpeed }
            }),
          {
            attempts: 3,
            signal: ac.signal,
            isRetryable: e => isTtsRetryable(e, ac.signal)
          }
        );
        if (ac.signal.aborted) return;

        try {
          player.replace({ uri });
          applyPlaybackRate(player, speed);
        } catch (err) {
          if (ac.signal.aborted) return;
          throw err;
        }

        // Lazy-load the alignment file (if any) that the synth wrote next
        // to the audio. Tap-to-seek for this block now uses real per-char
        // timings instead of the proportional estimate.
        void readAlignment(bookId, block.id)
          .then(a => {
            if (ac.signal.aborted) return;
            if (a) alignmentsRef.current.set(block.id, a);
          })
          .catch(err => {
            console.warn(
              `[player] readAlignment failed for ${block.id}: ${err instanceof Error ? err.message : String(err)}`
            );
          });

        // Honor any pending intra-block offset requested via the player
        // store (set by word-tap seek or resume-on-mount). Consumed once
        // here and cleared so subsequent loads don't re-seek to the same
        // place by accident.
        const pendingOffset = usePlayerStore.getState().positionSec;
        if (pendingOffset > 0) {
          try {
            void player.seekTo(pendingOffset).catch(err => {
              console.warn('[player] post-load seekTo failed', err);
            });
            setPositionSec(pendingOffset);
          } finally {
            usePlayerStore.getState().setPosition(0);
          }
        }

        // The transition gate is released by the listener as soon as a
        // non-finished status update is observed from the new source — not
        // here. That guarantees we don't re-open the gate while old-source
        // `didJustFinish` events are still in flight.

        setIsLoadingBlock(false);
        setIsReady(true);

        if (usePlayerStore.getState().isPlaying) {
          try {
            player.play();
          } catch (err) {
            console.warn('[player] play() failed', err);
          }
        }
      } catch (err) {
        if (ac.signal.aborted) return;
        setIsLoadingBlock(false);
        setIsReady(false);
        setBlockError(describeError(err));
        usePlayerStore.getState().pause();
      }
    })();

    return () => {
      ac.abort();
    };
    // `cacheEpoch` participates so a forced retry / cache bust re-runs the loader.
    // We deliberately omit `currentBlock` (a fresh object every render) and
    // depend on its stable `currentBlockId` instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, currentBlockId, safeIndex, voiceId, localVoice, speed, cacheEpoch, ttsProvider]);

  // ----- Drive play/pause on the player when isPlaying flips -------------
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    if (!isReady) return;
    try {
      if (isPlaying) player.play();
      else player.pause();
    } catch (err) {
      console.warn('[player] play/pause toggle failed', err);
    }
  }, [isPlaying, isReady]);

  // ----- Persist progress periodically while playing ---------------------
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      const pos = typeof player.currentTime === 'number' ? player.currentTime : 0;
      const idx = usePlayerStore.getState().currentBlockIndex;
      useLibraryStore.getState().setProgress(bookId, {
        blockIndex: idx,
        positionSec: pos,
        updatedAt: Date.now()
      });
    }, PROGRESS_TICK_MS);
    return () => clearInterval(id);
  }, [bookId, isPlaying]);

  // ----- Final progress write on unmount ---------------------------------
  useEffect(() => {
    return () => {
      const player = playerRef.current;
      const pos = player && typeof player.currentTime === 'number' ? player.currentTime : 0;
      const state = usePlayerStore.getState();
      if (state.currentBookId === bookId) {
        useLibraryStore.getState().setProgress(bookId, {
          blockIndex: state.currentBlockIndex,
          positionSec: pos,
          updatedAt: Date.now()
        });
      }
    };
  }, [bookId]);

  // ----- Prefetch upcoming main-content blocks ---------------------------
  // Two queues stitched together:
  //   1. Reading-order lookahead — `PREFETCH_LOOKAHEAD` blocks ahead in the
  //      current page so playback stays cached as the user reads on.
  //   2. Next-page first block — covers the "user taps Next page mid-page"
  //      case so manual page jumps aren't a 1-3 second cold synth.
  // Depend on `blocksLength` (a number) instead of `blocks` (a reference that
  // changes on every streaming append) so we still re-run when newly streamed
  // pages bring more upcoming blocks into the lookahead window, but don't
  // restart prefetch needlessly when blocks land elsewhere in the array.
  useEffect(() => {
    if (ttsProvider === 'elevenlabs' && !voiceId) return;
    if (safeIndex < 0) return;
    const blocksNow = useLibraryStore.getState().books[bookId]?.blocks ?? [];
    const queue: { id: string; text: string }[] = [];
    let cursor = safeIndex;
    while (queue.length < PREFETCH_LOOKAHEAD) {
      const next = nextPlayableBlockIndex(blocksNow, cursor, 'forward', skipping);
      if (next == null) break;
      const block = blocksNow[next];
      if (!block) break;
      queue.push({ id: block.id, text: block.text });
      cursor = next;
    }

    // Make sure the next page's first block is queued so manual "Next page"
    // jumps from the middle of a page hit the cache.
    const currentBlk = blocksNow[safeIndex];
    if (currentBlk) {
      const currentPage = currentBlk.page ?? 1;
      const nextPage = adjacentPageWithPlayable(blocksNow, currentPage, 'forward', skipping);
      if (nextPage != null) {
        const firstNextIdx = firstPlayableBlockOnPage(blocksNow, nextPage, skipping);
        if (firstNextIdx != null) {
          const b = blocksNow[firstNextIdx];
          if (b && !queue.some(q => q.id === b.id)) {
            queue.push({ id: b.id, text: b.text });
          }
        }
      }
    }

    if (queue.length === 0) return;

    const ac = new AbortController();
    prefetchAbortRef.current?.abort();
    prefetchAbortRef.current = ac;

    void prefetchBlocks(
      bookId,
      queue,
      voiceId,
      { speed: clampTtsSpeed(speed) },
      { signal: ac.signal }
    ).catch(err => {
      if (!ac.signal.aborted) console.warn('[player] prefetch failed', err);
    });

    return () => {
      ac.abort();
    };
  }, [
    bookId,
    blocksLength,
    safeIndex,
    voiceId,
    localVoice,
    speed,
    skipping,
    cacheEpoch,
    ttsProvider
  ]);

  // ----- Imperative callbacks --------------------------------------------
  const retryCurrentBlock = useCallback(() => {
    setCacheEpoch(epoch => epoch + 1);
  }, []);

  const togglePlay = useCallback(() => {
    const state = usePlayerStore.getState();
    if (state.isPlaying) state.pause();
    else state.play();
  }, []);

  const seekBy = useCallback((deltaSec: number) => {
    const player = playerRef.current;
    if (!player) return;
    const current = typeof player.currentTime === 'number' ? player.currentTime : 0;
    const total = typeof player.duration === 'number' ? player.duration : 0;
    const upper = total > 0 ? total : current + Math.abs(deltaSec);
    const target = Math.max(0, Math.min(upper, current + deltaSec));
    void player.seekTo(target).catch(err => {
      console.warn('[player] seekTo failed', err);
    });
    setPositionSec(target);
  }, []);

  const goPrev = useCallback(() => {
    const state = usePlayerStore.getState();
    const blocksNow = useLibraryStore.getState().books[bookId]?.blocks ?? [];
    const skippingNow = getEffectiveSettings(bookId).skipping;
    const idx = state.currentBlockIndex;
    const currentBlockNow = blocksNow[idx];
    if (!currentBlockNow) return;
    const currentPageNum = currentBlockNow.page ?? 1;
    const firstOnPage = firstPlayableBlockOnPage(blocksNow, currentPageNum, skippingNow);
    const player = playerRef.current;
    const pos = player && typeof player.currentTime === 'number' ? player.currentTime : 0;

    // If we're not at the very start of the page, "back" rewinds to the
    // beginning of the *current* page rather than jumping a page back.
    if (firstOnPage != null && (idx > firstOnPage || pos > 3)) {
      state.setBlock(firstOnPage);
      return;
    }
    // Otherwise try to step back to the previous page.
    const prevPage = adjacentPageWithPlayable(blocksNow, currentPageNum, 'backward', skippingNow);
    if (prevPage == null) {
      void player?.seekTo(0).catch(err => console.warn('[player] seekTo(0) failed', err));
      setPositionSec(0);
      return;
    }
    const target = firstPlayableBlockOnPage(blocksNow, prevPage, skippingNow);
    if (target == null) return;
    state.setBlock(target);
  }, [bookId]);

  const goNext = useCallback(() => {
    const state = usePlayerStore.getState();
    const blocksNow = useLibraryStore.getState().books[bookId]?.blocks ?? [];
    const skippingNow = getEffectiveSettings(bookId).skipping;
    const idx = state.currentBlockIndex;
    const currentBlockNow = blocksNow[idx];
    const currentPageNum = currentBlockNow?.page ?? 1;
    const nextPage = adjacentPageWithPlayable(blocksNow, currentPageNum, 'forward', skippingNow);
    if (nextPage == null) {
      state.pause();
      return;
    }
    const target = firstPlayableBlockOnPage(blocksNow, nextPage, skippingNow);
    if (target == null) {
      state.pause();
      return;
    }
    state.setBlock(target);
  }, [bookId]);

  // Stable refs the seek/duration helpers below read from. Refs (instead of
  // closing over `currentBlockId`/`speed`) keep the helper identities stable
  // — important for `CurrentPageView`'s memoized word-tap handlers.
  const currentBlockIdRef = useRef(currentBlockId);
  currentBlockIdRef.current = currentBlockId;
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const seekToBlockOffset = useCallback(
    (blockIndex: number, offsetSec: number) => {
      const blocksNow = useLibraryStore.getState().books[bookId]?.blocks ?? [];
      const target = blocksNow[blockIndex];
      if (!target) return;
      const player = playerRef.current;
      const playerState = usePlayerStore.getState();
      const targetIsCurrent = target.id === currentBlockIdRef.current;
      if (targetIsCurrent && player) {
        // Live seek — works during playback, no re-synthesis. Bypasses the
        // load effect entirely so it always fires (no equality check on
        // `currentBlockId` to skip).
        const cleanOffset = Math.max(0, offsetSec);
        void player.seekTo(cleanOffset).catch(err => {
          console.warn('[player] word-tap seekTo failed', err);
        });
        setPositionSec(cleanOffset);
        if (!playerState.isPlaying) {
          playerState.play();
          try {
            player.play();
          } catch (err) {
            console.warn('[player] post-seek play failed', err);
          }
        }
        return;
      }
      // Different block → set the target with a pending offset; the load
      // effect will load the new source and apply the seek after replace.
      playerState.setBlock(blockIndex, Math.max(0, offsetSec));
      if (!playerState.isPlaying) playerState.play();
    },
    [bookId]
  );

  const estimateBlockDuration = useCallback((block: Block): number => {
    const real = knownDurationsRef.current.get(block.id);
    if (real != null && Number.isFinite(real) && real > 0) return real;
    const charsPerSec = ESTIMATED_CHARS_PER_SECOND * Math.max(0.5, speedRef.current);
    const est = block.text.length / Math.max(1, charsPerSec);
    return Math.max(MIN_ESTIMATED_BLOCK_SEC, est);
  }, []);

  const charOffsetToAudioSec = useCallback((block: Block, charOffset: number): number => {
    const clean = Math.max(0, Math.min(block.text.length, Math.floor(charOffset)));
    const alignment = alignmentsRef.current.get(block.id);
    if (alignment && alignment.startTimesSec.length > 0) {
      // TTS-emitted timestamps: index directly into the per-character
      // start-time array (clamped to its bounds). This is the accurate
      // path — accounts for variable speaking rate, pauses at punctuation,
      // and word-length-dependent timing.
      const i = Math.min(clean, alignment.startTimesSec.length - 1);
      const t = alignment.startTimesSec[i];
      return Number.isFinite(t) ? Math.max(0, t) : 0;
    }
    // No alignment (local XTTS server): proportional estimate against
    // either the real measured duration of the block or a char-rate
    // fallback when we haven't played the block yet.
    const totalChars = Math.max(1, block.text.length);
    const ratio = Math.max(0, Math.min(1, clean / totalChars));
    const real = knownDurationsRef.current.get(block.id);
    if (real != null && Number.isFinite(real) && real > 0) return ratio * real;
    const charsPerSec = ESTIMATED_CHARS_PER_SECOND * Math.max(0.5, speedRef.current);
    const blockDur = Math.max(MIN_ESTIMATED_BLOCK_SEC, totalChars / Math.max(1, charsPerSec));
    return ratio * blockDur;
  }, []);

  return {
    isReady,
    isLoadingBlock,
    blockError,
    positionSec,
    durationSec,
    pagePositionSec: pageProgress.pagePositionSec,
    pageDurationSec: pageProgress.pageDurationSec,
    currentPage: pageProgress.currentPage,
    totalPages: pageProgress.totalPages,
    retryCurrentBlock,
    togglePlay,
    seekBy,
    goPrev,
    goNext,
    seekToBlockOffset,
    estimateBlockDuration,
    charOffsetToAudioSec
  };
}

const EMPTY_BLOCKS: readonly Block[] = Object.freeze([]);
