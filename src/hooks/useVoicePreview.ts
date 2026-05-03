import { createAudioPlayer, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Voice } from '@/src/types/voice';

export type UseVoicePreviewResult = {
  previewingVoiceId: string | undefined;
  play: (voice: Voice) => void;
  stop: () => void;
};

/**
 * Owns a single shared `expo-audio` player used to preview ElevenLabs voices.
 * The player is lazily created on first `play` and released on unmount.
 */
export function useVoicePreview(): UseVoicePreviewResult {
  const playerRef = useRef<AudioPlayer | null>(null);
  const subscriptionRef = useRef<{ remove: () => void } | null>(null);
  const previewingIdRef = useRef<string | undefined>(undefined);
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | undefined>(undefined);

  const updatePreviewingId = useCallback((id: string | undefined) => {
    previewingIdRef.current = id;
    setPreviewingVoiceId(id);
  }, []);

  const ensurePlayer = useCallback((): AudioPlayer => {
    if (playerRef.current) return playerRef.current;
    const player = createAudioPlayer(null);
    subscriptionRef.current = player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
      if (status.didJustFinish) {
        updatePreviewingId(undefined);
      }
    });
    playerRef.current = player;
    return player;
  }, [updatePreviewingId]);

  const play = useCallback(
    (voice: Voice) => {
      if (!voice.previewUrl) {
        console.warn(`[voice-preview] voice ${voice.id} has no previewUrl`);
        return;
      }
      const player = ensurePlayer();
      const wasPreviewing = previewingIdRef.current;
      try {
        if (wasPreviewing !== voice.id) {
          player.replace({ uri: voice.previewUrl });
        } else {
          // Same voice — restart from the beginning.
          player.seekTo(0).catch(() => {});
        }
        player.play();
        updatePreviewingId(voice.id);
      } catch (err) {
        console.warn(
          `[voice-preview] failed to play ${voice.id}: ${err instanceof Error ? err.message : String(err)}`
        );
        updatePreviewingId(undefined);
      }
    },
    [ensurePlayer, updatePreviewingId]
  );

  const stop = useCallback(() => {
    const player = playerRef.current;
    if (!player) {
      updatePreviewingId(undefined);
      return;
    }
    try {
      player.pause();
    } catch {
      // Best-effort — the player may already be torn down.
    }
    updatePreviewingId(undefined);
  }, [updatePreviewingId]);

  useEffect(() => {
    return () => {
      const sub = subscriptionRef.current;
      const player = playerRef.current;
      subscriptionRef.current = null;
      playerRef.current = null;
      previewingIdRef.current = undefined;
      try {
        sub?.remove();
      } catch {
        // Ignore subscription cleanup failures.
      }
      try {
        player?.remove();
      } catch {
        // Ignore — already released or never created.
      }
    };
  }, []);

  return { previewingVoiceId, play, stop };
}
