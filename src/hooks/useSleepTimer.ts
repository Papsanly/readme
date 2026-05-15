import { useCallback, useEffect, useRef, useState } from 'react';

import { usePlayerStore } from '@/src/state/player';

const TICK_MS = 1000;

export type SleepTimerState = {
  /** Remaining seconds until the timer fires, or `null` when no timer is armed. */
  remainingSec: number | null;
  /** Arm a timer for `minutes` from now. Replaces any existing timer. */
  start: (minutes: number) => void;
  /** Disarm the timer without pausing playback. */
  cancel: () => void;
};

/**
 * Single-shot countdown that pauses playback when it reaches zero.
 * Lives at the player screen so it disarms automatically when the user
 * navigates away — by design a sleep timer should not survive losing the
 * current book context.
 */
export function useSleepTimer(): SleepTimerState {
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (endsAt == null) {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return;
    }
    setNow(Date.now());
    tickRef.current = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [endsAt]);

  useEffect(() => {
    if (endsAt == null) return;
    if (now < endsAt) return;
    // Timer expired — pause playback and disarm.
    setEndsAt(null);
    usePlayerStore.getState().pause();
  }, [endsAt, now]);

  // Disarm on unmount.
  useEffect(() => () => setEndsAt(null), []);

  const start = useCallback((minutes: number) => {
    const clean = Math.max(1, Math.round(minutes));
    setEndsAt(Date.now() + clean * 60 * 1000);
  }, []);

  const cancel = useCallback(() => setEndsAt(null), []);

  const remainingSec = endsAt == null ? null : Math.max(0, Math.ceil((endsAt - now) / 1000));

  return { remainingSec, start, cancel };
}
