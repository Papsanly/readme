import { create } from 'zustand';

type PlayerState = {
  currentBookId?: string;
  currentBlockIndex: number;
  isPlaying: boolean;
  /**
   * Pending intra-block offset (in seconds) that the audio engine should
   * `seekTo` after the next source loads. One-shot: consumed and reset to
   * 0 by the engine. Used for word-level tap-to-seek and resume-on-mount.
   */
  positionSec: number;
  setBook: (id: string) => void;
  /** Move to block `i`, optionally requesting a `seekTo(offsetSec)` after load. */
  setBlock: (i: number, offsetSec?: number) => void;
  setPosition: (sec: number) => void;
  play: () => void;
  pause: () => void;
  clear: () => void;
};

export const usePlayerStore = create<PlayerState>(set => ({
  currentBookId: undefined,
  currentBlockIndex: 0,
  isPlaying: false,
  positionSec: 0,

  setBook: id =>
    set({
      currentBookId: id,
      currentBlockIndex: 0,
      positionSec: 0,
      isPlaying: false
    }),

  setBlock: (i, offsetSec) =>
    set({ currentBlockIndex: i, positionSec: Math.max(0, offsetSec ?? 0) }),

  setPosition: sec => set({ positionSec: sec }),

  play: () => set({ isPlaying: true }),

  pause: () => set({ isPlaying: false }),

  clear: () =>
    set({
      currentBookId: undefined,
      currentBlockIndex: 0,
      isPlaying: false,
      positionSec: 0
    })
}));
