import { useMemo } from 'react';

import { useLibraryStore } from '@/src/state/library';
import { useSettingsStore } from '@/src/state/settings';
import type { BookSettingsOverride } from '@/src/types/book';
import type { PronunciationOverride, SkippingMode, TtsProvider } from '@/src/types/settings';
import { mergePronunciations } from '@/src/utils/pronunciation';

/**
 * Reading settings actually used to play a specific book. Each field is
 * either taken from the book's `settingsOverride`, or — when that field
 * is unset — from the global settings store.
 *
 * Components that need to know "is this currently overridden?" should
 * subscribe to the override directly (`useBookSettingsOverride`).
 */
export type EffectiveSettings = {
  speed: number;
  skipping: SkippingMode;
  ttsProvider: TtsProvider;
  voiceId?: string;
  voiceName?: string;
  localVoice?: string;
  pronunciations: PronunciationOverride[];
};

/**
 * Reactive merge of global settings + per-book override. Re-computes on any
 * change to the override OR to the underlying global field.
 */
export function useEffectiveSettings(bookId: string | undefined): EffectiveSettings {
  const override = useLibraryStore(s => (bookId ? s.books[bookId]?.settingsOverride : undefined));

  const speed = useSettingsStore(s => s.speed);
  const skipping = useSettingsStore(s => s.skipping);
  const ttsProvider = useSettingsStore(s => s.ttsProvider);
  const voiceId = useSettingsStore(s => s.voiceId);
  const voiceName = useSettingsStore(s => s.voiceName);
  const localVoice = useSettingsStore(s => s.localVoice);
  const pronunciations = useSettingsStore(s => s.pronunciations);
  const mergedPronunciations = useMemo(
    () => mergePronunciations(pronunciations, override?.pronunciations),
    [override?.pronunciations, pronunciations]
  );

  return {
    speed: override?.speed ?? speed,
    skipping: override?.skipping ?? skipping,
    ttsProvider: override?.ttsProvider ?? ttsProvider,
    voiceId: 'voiceId' in (override ?? {}) ? override?.voiceId : voiceId,
    voiceName: 'voiceName' in (override ?? {}) ? override?.voiceName : voiceName,
    localVoice: override?.localVoice ?? localVoice,
    pronunciations: mergedPronunciations
  };
}

/** Subscribe to just the override object (or `undefined` if none set). */
export function useBookSettingsOverride(
  bookId: string | undefined
): BookSettingsOverride | undefined {
  return useLibraryStore(s => (bookId ? s.books[bookId]?.settingsOverride : undefined));
}

/**
 * Non-reactive snapshot of the effective settings for a book — reads both
 * stores at call time. Use inside event handlers and refs where a fresh
 * read is needed without triggering re-renders.
 */
export function getEffectiveSettings(bookId: string): EffectiveSettings {
  const book = useLibraryStore.getState().books[bookId];
  const override = book?.settingsOverride;
  const global = useSettingsStore.getState();
  return {
    speed: override?.speed ?? global.speed,
    skipping: override?.skipping ?? global.skipping,
    ttsProvider: override?.ttsProvider ?? global.ttsProvider,
    voiceId: 'voiceId' in (override ?? {}) ? override?.voiceId : global.voiceId,
    voiceName: 'voiceName' in (override ?? {}) ? override?.voiceName : global.voiceName,
    localVoice: override?.localVoice ?? global.localVoice,
    pronunciations: mergePronunciations(global.pronunciations, override?.pronunciations)
  };
}
