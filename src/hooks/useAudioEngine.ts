import {
  createAudioPlayer,
  type AudioMetadata,
  type AudioPlayer,
  type AudioStatus
} from 'expo-audio';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getEffectiveSettings, useEffectiveSettings } from '@/src/hooks/useEffectiveSettings';
import { isTtsRetryable, withRetry } from '@/src/pipeline/processor';
import { invalidateVoice, prefetchBlocks, synthesizeBlockToFile } from '@/src/pipeline/tts';
import { useLibraryStore } from '@/src/state/library';
import { usePlayerStore } from '@/src/state/player';
import { hasCachedAudio } from '@/src/storage/audioCache';
import { paths } from '@/src/storage/paths';
import type { Block, Book } from '@/src/types/book';
import { findSmartMainContentIndex } from '@/src/utils/mainContent';
import { applyPronunciationsToText, pronunciationCacheKey } from '@/src/utils/pronunciation';
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

function isPlayableBlockAtIndex(
  blocks: readonly Block[],
  index: number,
  skipping: SkippingMode,
  smartStart: number | null = skipping === 'main-only' ? findSmartMainContentIndex(blocks) : null
): boolean {
  const block = blocks[index];
  if (!block) return false;
  if (smartStart != null && index < smartStart) return false;
  return isPlayableBlock(block, skipping);
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
  const smartStart = skipping === 'main-only' ? findSmartMainContentIndex(blocks) : null;
  for (let i = current + step; i >= 0 && i < blocks.length; i += step) {
    if (isPlayableBlockAtIndex(blocks, i, skipping, smartStart)) return i;
  }
  return null;
}

/** Index of the first playable block on the given page, or `null` if none. */
function firstPlayableBlockOnPage(
  blocks: readonly Block[],
  pageNumber: number,
  skipping: SkippingMode
): number | null {
  const smartStart = skipping === 'main-only' ? findSmartMainContentIndex(blocks) : null;
  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks[i];
    if (!b) continue;
    if ((b.page ?? 1) === pageNumber && isPlayableBlockAtIndex(blocks, i, skipping, smartStart)) {
      return i;
    }
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

function fileExists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

function artworkUriForBook(book: Book): string | undefined {
  const candidates = [book.coverUri, paths.bookCover(book.id), paths.bookPage(book.id, 1)];
  for (const uri of candidates) {
    if (!uri) continue;
    if (/^https?:\/\//i.test(uri)) return uri;
    if (/^file:\/\//i.test(uri) && fileExists(uri)) return uri;
  }
  return undefined;
}

function compactText(text: string | undefined, maxLength = 80): string | undefined {
  const clean = text?.replace(/\s+/g, ' ').trim();
  if (!clean) return undefined;
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildLockScreenMetadata(
  book: Book,
  currentBlock: Block | undefined,
  currentPage: number,
  totalPages: number
): AudioMetadata {
  const pageLabel =
    currentPage > 0 ? `Page ${currentPage}${totalPages > 0 ? ` of ${totalPages}` : ''}` : 'ReadMe';
  const section = currentBlock?.type === 'heading' ? compactText(currentBlock.text) : undefined;
  const artworkUrl = artworkUriForBook(book);
  return {
    title: book.title,
    artist: pageLabel,
    albumTitle: section ?? 'ReadMe audiobook',
    ...(artworkUrl ? { artworkUrl } : {})
  };
}

/**
 * Drives a single shared `expo-audio` player from the current player/settings/library state.
 * The hook is the only owner of the underlying `AudioPlayer` — mount it once per Player screen.
 */
export function useAudioEngine(bookId: string): UseAudioEngineResult {
  // ----- Reactive sources -------------------------------------------------
  const book = useLibraryStore(s => s.books[bookId]);
  const blocks = book?.blocks ?? EMPTY_BLOCKS;
  const knownPageTotal = book?.processingProgress?.total ?? 0;
  const currentBlockIndex = usePlayerStore(s => s.currentBlockIndex);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  // Effective (global + per-book override) reading settings.
  const effective = useEffectiveSettings(bookId);
  const voiceId = effective.voiceId;
  const speed = effective.speed;
  const skipping = effective.skipping;
  const ttsProvider = effective.ttsProvider;
  const localVoice = effective.localVoice;
  const pronunciations = effective.pronunciations;
  const pronunciationKey = useMemo(() => pronunciationCacheKey(pronunciations), [pronunciations]);

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

  // ----- Refs (engine internals, no re-render triggers) -------------------
  const playerRef = useRef<AudioPlayer | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);
  const prefetchAbortRef = useRef<AbortController | null>(null);
  const lockScreenActiveRef = useRef(false);
  const ignoreNativePauseUntilReadyRef = useRef(false);
  const bookIdRef = useRef(bookId);
  bookIdRef.current = bookId;
  const lastTtsSpeedRef = useRef<number>(clampTtsSpeed(speed));
  const lastVoiceIdRef = useRef<string | undefined>(voiceId);
  const lastLocalVoiceRef = useRef<string | undefined>(localVoice);
  const lastTtsProviderRef = useRef(ttsProvider);
  const lastPronunciationKeyRef = useRef(pronunciationKey);
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
  const smartMainContentIndex = useMemo(() => findSmartMainContentIndex(blocks), [blocks]);
  const shouldSmartSkipCurrent =
    skipping === 'main-only' &&
    smartMainContentIndex != null &&
    safeIndex >= 0 &&
    safeIndex < smartMainContentIndex;

  // Page-level progress: aggregate the current page's blocks into a single
  // virtual track so the player UI shows page position / page duration
  // instead of the individual ~10–30 second block segments. `txt` books and
  // anything without per-block page numbers fall back to a single page.
  const pageProgress = useMemo(() => {
    if (!currentBlock) {
      return { pagePositionSec: 0, pageDurationSec: 0, currentPage: 0, totalPages: knownPageTotal };
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
      totalPages: Math.max(allPages.size, knownPageTotal)
    };
    // `durationsTick` participates so newly observed real durations refresh
    // the bar; React Compiler ignores this kind of plain ref read otherwise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, currentBlock, currentBlockId, positionSec, speed, durationsTick, knownPageTotal]);

  function syncNativePlaybackState(status: AudioStatus): void {
    const state = usePlayerStore.getState();
    if (state.currentBookId !== bookIdRef.current) return;
    if (status.playing) {
      if (!state.isPlaying) state.play();
      return;
    }
    if (ignoreNativePauseUntilReadyRef.current) return;
    if (!status.isLoaded || status.isBuffering || status.timeControlStatus !== 'paused') return;
    if (state.isPlaying) state.pause();
  }

  // ----- Player lifecycle: create once, release on unmount ---------------
  useEffect(() => {
    const player = createAudioPlayer(null, {
      updateInterval: PLAYER_UPDATE_INTERVAL_MS,
      keepAudioSessionActive: true
    });
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
        syncNativePlaybackState(status);
      }
    });

    return () => {
      subscription.remove();
      try {
        player.clearLockScreenControls();
      } catch (err) {
        console.warn('[player] failed to clear lock screen controls', err);
      }
      try {
        player.remove();
      } catch (err) {
        console.warn('[player] failed to release audio player', err);
      }
      playerRef.current = null;
      lockScreenActiveRef.current = false;
    };
    // The player is created once per Player-screen mount; the bookId is read via
    // refs/state inside event handlers, so we don't recreate on bookId changes.
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !book) return;
    const metadata = buildLockScreenMetadata(
      book,
      currentBlock,
      pageProgress.currentPage,
      pageProgress.totalPages
    );

    try {
      if (lockScreenActiveRef.current) {
        player.updateLockScreenMetadata(metadata);
      } else {
        player.setActiveForLockScreen(true, metadata, {
          showSeekBackward: true,
          showSeekForward: true
        });
        lockScreenActiveRef.current = true;
      }
    } catch (err) {
      console.warn('[player] failed to update lock screen controls', err);
    }
  }, [book, currentBlock, pageProgress.currentPage, pageProgress.totalPages]);

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
    if (lastPronunciationKeyRef.current !== pronunciationKey) {
      lastPronunciationKeyRef.current = pronunciationKey;
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
  }, [bookId, voiceId, localVoice, ttsProvider, pronunciationKey, speed]);

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
    if (shouldSmartSkipCurrent && smartMainContentIndex != null) {
      usePlayerStore.getState().setBlock(smartMainContentIndex);
      return;
    }
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
            ignoreNativePauseUntilReadyRef.current = true;
            player.pause();
          } catch (err) {
            ignoreNativePauseUntilReadyRef.current = false;
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
              text: applyPronunciationsToText(block.text, pronunciations),
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

        // Honor any pending intra-block offset requested via the player
        // store (set by tap-to-seek or resume-on-mount). Consumed once here
        // and cleared so subsequent loads don't re-seek to the same place
        // by accident.
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
        ignoreNativePauseUntilReadyRef.current = false;

        if (usePlayerStore.getState().isPlaying) {
          try {
            player.play();
          } catch (err) {
            console.warn('[player] play() failed', err);
          }
        }
      } catch (err) {
        if (ac.signal.aborted) return;
        ignoreNativePauseUntilReadyRef.current = false;
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
  }, [
    bookId,
    currentBlockId,
    safeIndex,
    shouldSmartSkipCurrent,
    smartMainContentIndex,
    voiceId,
    localVoice,
    speed,
    cacheEpoch,
    ttsProvider,
    pronunciations
  ]);

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
      queue.push({ id: block.id, text: applyPronunciationsToText(block.text, pronunciations) });
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
            queue.push({ id: b.id, text: applyPronunciationsToText(b.text, pronunciations) });
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
    ttsProvider,
    pronunciations
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
        return;
      }
      // Different block → set the target with a pending offset; the load
      // effect will load the new source and apply the seek after replace.
      usePlayerStore.getState().setBlock(blockIndex, Math.max(0, offsetSec));
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
    estimateBlockDuration
  };
}

const EMPTY_BLOCKS: readonly Block[] = Object.freeze([]);
