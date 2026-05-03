import { create } from 'zustand';

type PlayerState = {
  currentBookId?: string;
  currentBlockIndex: number;
  isPlaying: boolean;
  positionSec: number;
  setBook: (id: string) => void;
  setBlock: (i: number) => void;
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

  setBlock: i => set({ currentBlockIndex: i, positionSec: 0 }),

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
