import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SectionHeader } from '@/src/components/settings';
import {
  ListItem,
  Screen,
  SegmentedControl,
  type SegmentedOption,
  Slider
} from '@/src/components/ui';
import { useEffectiveSettings } from '@/src/hooks/useEffectiveSettings';
import { useTheme } from '@/src/hooks/useTheme';
import { useLibraryStore } from '@/src/state/library';
import { useSettingsStore } from '@/src/state/settings';
import type { SkippingMode, TtsProvider } from '@/src/types/settings';

const SPEED_MIN = 0.7;
const SPEED_MAX = 1.5;
const SPEED_STEP = 0.05;

const SKIPPING_OPTIONS: readonly SegmentedOption<SkippingMode>[] = [
  {
    value: 'main-only',
    label: 'Main only',
    description: 'Aggressive: skip everything not classified as main content.'
  },
  {
    value: 'service-only',
    label: 'Skip service',
    description: 'Skip page numbers, headers/footers, footnotes, table of contents.'
  },
  { value: 'none', label: 'Read all', description: 'Read every block, including service elements.' }
];

const PROVIDER_OPTIONS: readonly SegmentedOption<TtsProvider>[] = [
  { value: 'elevenlabs', label: 'ElevenLabs' },
  { value: 'local', label: 'Local server' }
];

/**
 * Per-book reading settings. Each control has a "Use default" link that
 * clears the override and falls back to the value from the global settings
 * tab. The visible value reflects the *effective* setting (override OR
 * default) so what you see is what the player will use.
 */
export default function BookSettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const bookId = typeof id === 'string' ? id : undefined;

  const { colors, spacing, fontSize, fontWeight } = useTheme();
  const effective = useEffectiveSettings(bookId);
  const override = useLibraryStore(s => (bookId ? s.books[bookId]?.settingsOverride : undefined));
  const globalSpeed = useSettingsStore(s => s.speed);
  const globalSkipping = useSettingsStore(s => s.skipping);
  const globalTtsProvider = useSettingsStore(s => s.ttsProvider);
  const globalVoiceName = useSettingsStore(s => s.voiceName);
  const globalLocalVoice = useSettingsStore(s => s.localVoice);

  const setSpeedOverride = useCallback(
    (value: number | undefined) => {
      if (!bookId) return;
      useLibraryStore.getState().setSettingsOverride(bookId, { speed: value });
    },
    [bookId]
  );

  const setSkippingOverride = useCallback(
    (value: SkippingMode | undefined) => {
      if (!bookId) return;
      useLibraryStore.getState().setSettingsOverride(bookId, { skipping: value });
    },
    [bookId]
  );

  const setProviderOverride = useCallback(
    (value: TtsProvider | undefined) => {
      if (!bookId) return;
      useLibraryStore.getState().setSettingsOverride(bookId, { ttsProvider: value });
    },
    [bookId]
  );

  const clearVoiceOverride = useCallback(() => {
    if (!bookId) return;
    if (effective.ttsProvider === 'elevenlabs') {
      // `voiceId` and `voiceName` are paired — clear both.
      useLibraryStore
        .getState()
        .setSettingsOverride(bookId, { voiceId: undefined, voiceName: undefined });
    } else {
      useLibraryStore.getState().setSettingsOverride(bookId, { localVoice: undefined });
    }
  }, [bookId, effective.ttsProvider]);

  const openVoicePicker = useCallback(() => {
    if (!bookId) return;
    if (effective.ttsProvider === 'elevenlabs') {
      router.push(`/settings/voice?bookId=${bookId}` as Href);
    } else {
      router.push(`/settings/local-voice?bookId=${bookId}` as Href);
    }
  }, [bookId, effective.ttsProvider]);

  if (!bookId) return null;

  const speedOverridden = override?.speed !== undefined;
  const skippingOverridden = override?.skipping !== undefined;
  const providerOverridden = override?.ttsProvider !== undefined;
  const voiceOverridden =
    effective.ttsProvider === 'elevenlabs'
      ? override?.voiceId !== undefined
      : override?.localVoice !== undefined;

  const effectiveVoiceLabel =
    effective.ttsProvider === 'elevenlabs'
      ? (effective.voiceName ?? globalVoiceName ?? 'Default')
      : (effective.localVoice ?? globalLocalVoice ?? 'alloy');

  return (
    <Screen scroll padded={false}>
      <SectionHeader title="TTS provider" />
      <View style={[styles.section, { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }]}>
        <SegmentedControl
          options={PROVIDER_OPTIONS}
          value={effective.ttsProvider}
          onChange={setProviderOverride}
        />
        <View style={[styles.metaRow, { marginTop: spacing.sm, gap: spacing.md }]}>
          <Text style={{ color: colors.textMuted, fontSize: fontSize.caption, flex: 1 }}>
            {providerOverridden
              ? `Custom for this book — default is "${globalTtsProvider}".`
              : `Using default ("${globalTtsProvider}").`}
          </Text>
          {providerOverridden ? (
            <Pressable onPress={() => setProviderOverride(undefined)} hitSlop={8}>
              <Text
                style={{
                  color: colors.accent,
                  fontSize: fontSize.caption,
                  fontWeight: fontWeight.medium
                }}
              >
                Use default
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <SectionHeader title="Voice" />
      <View style={{ backgroundColor: colors.bgElevated }}>
        <ListItem
          title="Voice"
          subtitle={
            voiceOverridden
              ? `Custom for this book: ${effectiveVoiceLabel}`
              : `Using default: ${effectiveVoiceLabel}`
          }
          right={
            voiceOverridden ? (
              <Pressable onPress={clearVoiceOverride} hitSlop={8}>
                <Text
                  style={{
                    color: colors.accent,
                    fontSize: fontSize.caption,
                    fontWeight: fontWeight.medium,
                    paddingHorizontal: spacing.sm
                  }}
                >
                  Use default
                </Text>
              </Pressable>
            ) : undefined
          }
          onPress={openVoicePicker}
          showSeparator={false}
        />
      </View>

      <SectionHeader title="Speed" />
      <View style={[styles.section, { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }]}>
        <View style={[styles.row, { marginBottom: spacing.sm }]}>
          <Text
            style={{
              color: colors.text,
              fontSize: fontSize.h2,
              fontWeight: fontWeight.bold,
              flex: 1,
              textAlign: 'center'
            }}
          >
            {effective.speed.toFixed(2)}×
          </Text>
        </View>
        <Slider
          value={effective.speed}
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={SPEED_STEP}
          onChange={setSpeedOverride}
        />
        <View style={[styles.metaRow, { marginTop: spacing.sm, gap: spacing.md }]}>
          <Text style={{ color: colors.textMuted, fontSize: fontSize.caption, flex: 1 }}>
            {speedOverridden
              ? `Custom for this book — default is ${globalSpeed.toFixed(2)}×.`
              : `Using default (${globalSpeed.toFixed(2)}×).`}
          </Text>
          {speedOverridden ? (
            <Pressable onPress={() => setSpeedOverride(undefined)} hitSlop={8}>
              <Text
                style={{
                  color: colors.accent,
                  fontSize: fontSize.caption,
                  fontWeight: fontWeight.medium
                }}
              >
                Use default
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <SectionHeader title="Block skipping" />
      <View style={[styles.section, { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }]}>
        <SegmentedControl
          options={SKIPPING_OPTIONS}
          value={effective.skipping}
          onChange={setSkippingOverride}
        />
        <View style={[styles.metaRow, { marginTop: spacing.sm, gap: spacing.md }]}>
          <Text style={{ color: colors.textMuted, fontSize: fontSize.caption, flex: 1 }}>
            {skippingOverridden
              ? `Custom for this book — default is "${globalSkipping}".`
              : `Using default ("${globalSkipping}").`}
          </Text>
          {skippingOverridden ? (
            <Pressable onPress={() => setSkippingOverride(undefined)} hitSlop={8}>
              <Text
                style={{
                  color: colors.accent,
                  fontSize: fontSize.caption,
                  fontWeight: fontWeight.medium
                }}
              >
                Use default
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={[styles.note, { paddingHorizontal: spacing.lg, marginTop: spacing.md }]}>
        <Text
          style={{
            color: colors.textMuted,
            fontSize: fontSize.caption,
            lineHeight: fontSize.caption * 1.5
          }}
        >
          These settings apply only to this book. Changes take effect immediately — already-cached
          audio for this book gets re-synthesized when speed/voice changes; skipping is a runtime
          filter and applies to the next block transition.
        </Text>
      </View>

      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {},
  row: { flexDirection: 'row', alignItems: 'center' },
  metaRow: { flexDirection: 'row', alignItems: 'center' },
  note: {}
});
