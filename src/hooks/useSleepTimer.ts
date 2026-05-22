import { useCallback, useEffect, useRef, useState } from 'react';

import { usePlayerStore } from '@/src/state/player';

const TICK_MS = 1000;

export type SleepTimerState = {
  /** Remaining seconds until the timer fires, or `null` when no timer is armed. */
  remainingSec: number | null;
  /** Arm a timer for `minutes` of active playback. Replaces any existing timer. */
  start: (minutes: number) => void;
  /** Disarm the timer without pausing playback. */
  cancel: () => void;
};

/**
 * Single-shot countdown that pauses playback when it reaches zero.
 * The countdown only advances while audio is actually playing; when the
 * player is paused, the timer is paused too and resumes from the same
 * remaining time on playback.
 *
 * Lives at the player screen so it disarms automatically when the user
 * navigates away — by design a sleep timer should not survive losing the
 * current book context.
 */
export function useSleepTimer(): SleepTimerState {
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTick = useCallback(() => {
    if (!tickRef.current) return;
    clearInterval(tickRef.current);
    tickRef.current = null;
  }, []);

  useEffect(() => {
    if (remainingSec == null || !isPlaying) {
      clearTick();
      return;
    }

    tickRef.current = setInterval(() => {
      setRemainingSec(prev => {
        if (prev == null) return null;
        return Math.max(0, prev - 1);
      });
    }, TICK_MS);

    return clearTick;
  }, [clearTick, isPlaying, remainingSec]);

  useEffect(() => {
    if (remainingSec !== 0) return;
    setRemainingSec(null);
    usePlayerStore.getState().pause();
  }, [remainingSec]);

  // Disarm on unmount.
  useEffect(
    () => () => {
      clearTick();
      setRemainingSec(null);
    },
    [clearTick]
  );

  const start = useCallback((minutes: number) => {
    const clean = Math.max(1, Math.round(minutes));
    setRemainingSec(clean * 60);
  }, []);

  const cancel = useCallback(() => setRemainingSec(null), []);

  return { remainingSec, start, cancel };
}
