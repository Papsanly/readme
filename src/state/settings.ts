import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { AppSettings, SkippingMode, TtsProvider } from '@/src/types/settings';

type SettingsState = AppSettings & {
  setVoice: (voiceId?: string, voiceName?: string) => void;
  setSpeed: (speed: number) => void;
  setSkipping: (skipping: SkippingMode) => void;
  setTtsProvider: (provider: TtsProvider) => void;
  reset: () => void;
};

const DEFAULTS: AppSettings = {
  voiceId: undefined,
  voiceName: undefined,
  speed: 1.0,
  skipping: 'none',
  ttsProvider: 'elevenlabs'
};

const MIN_SPEED = 0.7;
const MAX_SPEED = 1.5;

function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return DEFAULTS.speed;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    set => ({
      ...DEFAULTS,
      setVoice: (voiceId, voiceName) => set({ voiceId, voiceName }),
      setSpeed: speed => set({ speed: clampSpeed(speed) }),
      setSkipping: skipping => set({ skipping }),
      setTtsProvider: provider => set({ ttsProvider: provider }),
      reset: () => set({ ...DEFAULTS })
    }),
    {
      name: 'readme:settings',
      storage: createJSONStorage(() => AsyncStorage)
    }
  )
);
