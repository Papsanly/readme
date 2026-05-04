import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';

import { isTtsRetryable, withRetry } from '@/src/pipeline/processor';
import { invalidateVoice, prefetchBlocks, synthesizeBlockToFile } from '@/src/pipeline/tts';
import { useLibraryStore } from '@/src/state/library';
import { usePlayerStore } from '@/src/state/player';
import { useSettingsStore } from '@/src/state/settings';
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
};

function clampTtsSpeed(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(TTS_MAX_SPEED, Math.max(TTS_MIN_SPEED, v));
}

function clampPlayerRate(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(PLAYER_MAX_RATE, Math.max(PLAYER_MIN_RATE, v));
}

function isPlayableBlock(block: Block, skipping: SkippingMode): boolean {
  if (skipping === 'none') return true;
  // For Phase 4 MVP, 'main-only' and 'service-only' both filter on `isMainContent`
  // (the VLM stage already encoded the distinction at ingest time).
  return block.isMainContent;
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
  const voiceId = useSettingsStore(s => s.voiceId);
  const speed = useSettingsStore(s => s.speed);
  const skipping = useSettingsStore(s => s.skipping);
  const ttsProvider = useSettingsStore(s => s.ttsProvider);

  // ----- Local state ------------------------------------------------------
  const [isReady, setIsReady] = useState(false);
  const [isLoadingBlock, setIsLoadingBlock] = useState(false);
  const [blockError, setBlockError] = useState<string | undefined>(undefined);
  const [positionSec, setPositionSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);

  // ----- Refs (engine internals, no re-render triggers) -------------------
  const playerRef = useRef<AudioPlayer | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);
  const prefetchAbortRef = useRef<AbortController | null>(null);
  const lastTtsSpeedRef = useRef<number>(clampTtsSpeed(speed));
  const lastVoiceIdRef = useRef<string | undefined>(voiceId);
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

  // ----- Stable callback for `didJustFinish` -----------------------------
  // Reads fresh state from the stores at invocation time (no stale closures).
  // The rising-edge gate in the listener guarantees this runs at most once
  // per finished source, so we don't need any per-block bookkeeping here.
  const handleBlockFinishedRef = useRef<() => void>(() => {});
  useEffect(() => {
    handleBlockFinishedRef.current = () => {
      const blocksNow = useLibraryStore.getState().books[bookId]?.blocks ?? [];
      const skippingNow = useSettingsStore.getState().skipping;
      const idx = usePlayerStore.getState().currentBlockIndex;
      const next = nextPlayableBlockIndex(blocksNow, idx, 'forward', skippingNow);
      if (next == null) {
        usePlayerStore.getState().pause();
        return;
      }
      usePlayerStore.getState().setBlock(next);
    };
  }, [bookId]);

  // ----- Cache invalidation on voice / TTS-speed change ------------------
  useEffect(() => {
    const newTtsSpeed = clampTtsSpeed(speed);
    let invalidated = false;
    if (lastVoiceIdRef.current !== voiceId) {
      lastVoiceIdRef.current = voiceId;
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
  }, [bookId, voiceId, speed]);

  // ----- Apply rate to player whenever speed changes ---------------------
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    try {
      player.setPlaybackRate(clampPlayerRate(speed), 'high');
    } catch (err) {
      console.warn('[player] setPlaybackRate failed', err);
    }
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

    setIsReady(false);
    setIsLoadingBlock(true);
    setBlockError(undefined);
    setPositionSec(0);
    setDurationSec(0);

    const ttsSpeed = clampTtsSpeed(speed);

    void (async () => {
      try {
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
          player.setPlaybackRate(clampPlayerRate(speed), 'high');
        } catch (err) {
          if (ac.signal.aborted) return;
          throw err;
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
  }, [bookId, currentBlockId, safeIndex, voiceId, speed, cacheEpoch, ttsProvider]);

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
  }, [bookId, blocksLength, safeIndex, voiceId, speed, skipping, cacheEpoch, ttsProvider]);

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
    const skippingNow = useSettingsStore.getState().skipping;
    const idx = state.currentBlockIndex;
    // If we're past 3s into the current block, restart it instead of jumping back.
    const player = playerRef.current;
    const pos = player && typeof player.currentTime === 'number' ? player.currentTime : 0;
    if (pos > 3) {
      void player?.seekTo(0).catch(err => console.warn('[player] seekTo(0) failed', err));
      setPositionSec(0);
      return;
    }
    const prev = nextPlayableBlockIndex(blocksNow, idx, 'backward', skippingNow);
    if (prev == null) {
      // At the beginning — restart the current block.
      void player?.seekTo(0).catch(err => console.warn('[player] seekTo(0) failed', err));
      setPositionSec(0);
      return;
    }
    state.setBlock(prev);
  }, [bookId]);

  const goNext = useCallback(() => {
    const state = usePlayerStore.getState();
    const blocksNow = useLibraryStore.getState().books[bookId]?.blocks ?? [];
    const skippingNow = useSettingsStore.getState().skipping;
    const next = nextPlayableBlockIndex(blocksNow, state.currentBlockIndex, 'forward', skippingNow);
    if (next == null) {
      state.pause();
      return;
    }
    state.setBlock(next);
  }, [bookId]);

  return {
    isReady,
    isLoadingBlock,
    blockError,
    positionSec,
    durationSec,
    retryCurrentBlock,
    togglePlay,
    seekBy,
    goPrev,
    goNext
  };
}

const EMPTY_BLOCKS: readonly Block[] = Object.freeze([]);
