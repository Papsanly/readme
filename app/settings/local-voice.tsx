import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { getTtsClient } from '@/src/api/tts';
import { SectionHeader } from '@/src/components/settings';
import { IconSymbol, ListItem, Screen } from '@/src/components/ui';
import { useEffectiveSettings } from '@/src/hooks/useEffectiveSettings';
import { useTheme } from '@/src/hooks/useTheme';
import { useLibraryStore } from '@/src/state/library';
import { useSettingsStore } from '@/src/state/settings';
import { newId } from '@/src/utils/id';

/**
 * Voices that openedai-speech maps to XTTS-v2 reference samples. They are
 * named after the OpenAI voice list so any OpenAI-compatible server speaks
 * them. The model is the same multilingual XTTS-v2; only the speaker
 * timbre differs.
 */
const LOCAL_VOICES: { id: string; description: string }[] = [
  { id: 'alloy', description: 'Neutral, clear (default)' },
  { id: 'echo', description: 'Soft male, warm' },
  { id: 'fable', description: 'British male, expressive' },
  { id: 'nova', description: 'Bright female, upbeat' },
  { id: 'onyx', description: 'Deep male, calm' },
  { id: 'shimmer', description: 'Light female, gentle' }
];

/**
 * XTTS-v2 expects one language per request — mixing scripts (or even mixing
 * Latin scripts of different languages) makes it pick a dominant language
 * and read the rest with the wrong phonetics. We keep the preview to a
 * single short sentence so the user hears the voice's actual timbre.
 */
const SAMPLE_TEXT = 'Привет! Это короткий пример того, как звучит этот голос.';
const PREVIEW_BUTTON_SIZE = 36;

export default function LocalVoiceSettingsScreen() {
  const { colors, spacing, fontSize, fontWeight } = useTheme();

  // When opened with `?bookId=X`, picks land in that book's override;
  // otherwise they update the global default.
  const params = useLocalSearchParams<{ bookId?: string }>();
  const bookId = typeof params.bookId === 'string' ? params.bookId : undefined;
  const effective = useEffectiveSettings(bookId);
  const selected = effective.localVoice ?? 'alloy';

  const [previewing, setPreviewing] = useState<string | undefined>(undefined);
  const playerRef = useRef<AudioPlayer | null>(null);
  /** Per-session cache of synthesized preview files, keyed by voice id. */
  const previewCacheRef = useRef<Map<string, string>>(new Map());
  /** AbortController for the in-flight preview, so a new tap cancels the old one. */
  const previewAbortRef = useRef<AbortController | null>(null);

  // Player lifecycle.
  useEffect(() => {
    const player = createAudioPlayer(null);
    const sub = player.addListener('playbackStatusUpdate', status => {
      if (status.didJustFinish) setPreviewing(undefined);
    });
    playerRef.current = player;
    return () => {
      sub.remove();
      try {
        player.remove();
      } catch {
        // Already released.
      }
      playerRef.current = null;
      previewAbortRef.current?.abort();
    };
  }, []);

  const handleSelect = useCallback(
    (id: string) => {
      Haptics.selectionAsync().catch(() => {});
      if (bookId) {
        useLibraryStore.getState().setSettingsOverride(bookId, { localVoice: id });
      } else {
        useSettingsStore.getState().setLocalVoice(id);
      }
    },
    [bookId]
  );

  const handlePreview = useCallback(async (id: string) => {
    Haptics.selectionAsync().catch(() => {});
    const player = playerRef.current;
    if (!player) return;

    // Stop whatever is playing right now (synchronously) so taps don't stack.
    try {
      player.pause();
    } catch {
      // Already paused / not loaded.
    }
    // Cancel any in-flight preview synthesis from a previous tap.
    previewAbortRef.current?.abort();
    const ac = new AbortController();
    previewAbortRef.current = ac;

    setPreviewing(id);

    // Cache hit: just replay the previously-synthesized file.
    const cachedPath = previewCacheRef.current.get(id);
    if (cachedPath) {
      try {
        player.replace({ uri: cachedPath });
        player.seekTo(0).catch(() => {});
        player.play();
      } catch (err) {
        console.warn('[local-voice] cached preview replay failed', err);
        setPreviewing(undefined);
      }
      return;
    }

    try {
      const { bytes } = await getTtsClient().synthesize({ voiceId: id, text: SAMPLE_TEXT });
      if (ac.signal.aborted) return;
      const path = `${Paths.cache.uri}preview-${id}-${newId('s')}.mp3`;
      const file = new File(path);
      if (file.exists) {
        try {
          file.delete();
        } catch {
          // Ignore.
        }
      }
      file.write(bytes);
      if (ac.signal.aborted) return;
      previewCacheRef.current.set(id, path);
      try {
        player.replace({ uri: path });
        player.play();
      } catch (err) {
        console.warn('[local-voice] preview play failed', err);
        setPreviewing(undefined);
      }
    } catch (err) {
      if (ac.signal.aborted) return;
      console.warn('[local-voice] preview failed:', err);
      setPreviewing(undefined);
    }
  }, []);

  return (
    <Screen scroll padded={false}>
      <SectionHeader title="Voices" />
      <View style={{ backgroundColor: colors.bgElevated }}>
        {LOCAL_VOICES.map((voice, i) => {
          const isSelected = voice.id === selected;
          const isPreviewing = previewing === voice.id;
          return (
            <ListItem
              key={voice.id}
              title={voice.id}
              subtitle={voice.description}
              showSeparator={i < LOCAL_VOICES.length - 1}
              right={
                <View style={[styles.right, { gap: spacing.sm }]}>
                  <Pressable
                    onPress={() => handlePreview(voice.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Preview ${voice.id}`}
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.previewButton,
                      {
                        width: PREVIEW_BUTTON_SIZE,
                        height: PREVIEW_BUTTON_SIZE,
                        borderRadius: PREVIEW_BUTTON_SIZE / 2,
                        backgroundColor: colors.bg,
                        borderColor: colors.border,
                        opacity: pressed ? 0.7 : 1
                      }
                    ]}
                  >
                    {isPreviewing ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : (
                      <IconSymbol name="play.fill" size={14} color={colors.text} weight="medium" />
                    )}
                  </Pressable>
                  {isSelected ? (
                    <IconSymbol name="checkmark" size={20} color={colors.accent} weight="medium" />
                  ) : null}
                </View>
              }
              onPress={() => handleSelect(voice.id)}
            />
          );
        })}
      </View>
      <View style={[styles.note, { paddingHorizontal: spacing.lg, marginTop: spacing.lg }]}>
        <Text
          style={{
            color: colors.textMuted,
            fontSize: fontSize.caption,
            fontWeight: fontWeight.regular,
            lineHeight: fontSize.caption * 1.5
          }}
        >
          All six voices read every language XTTS-v2 supports (en, ru, uk, pl, de, es, fr, it, pt,
          nl, cs, ar, zh-cn, hu, ko, ja, hi, tr). Language is auto-detected per request, so each
          block of a book is read in its own language — but mixing scripts inside one block makes
          the model stumble.
        </Text>
      </View>
      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  right: { flexDirection: 'row', alignItems: 'center' },
  previewButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth
  },
  note: {}
});
