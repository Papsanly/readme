import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { IconSymbol } from '@/src/components/ui';
import { useTheme } from '@/src/hooks/useTheme';
import type { Voice } from '@/src/types/voice';

export type VoiceCardProps = {
  voice: Voice;
  selected: boolean;
  onSelect: (voice: Voice) => void;
  onPreviewPlay: (voice: Voice) => void;
  onPreviewStop: () => void;
  isPreviewing: boolean;
};

const PREFERRED_LABEL_KEYS = ['accent', 'language', 'gender', 'age', 'use_case'] as const;

function formatLabels(labels: Voice['labels']): string | undefined {
  if (!labels) return undefined;
  const parts: string[] = [];
  for (const key of PREFERRED_LABEL_KEYS) {
    const value = labels[key];
    if (typeof value === 'string' && value.length > 0) {
      parts.push(value);
    }
  }
  if (parts.length === 0) {
    for (const value of Object.values(labels)) {
      if (typeof value === 'string' && value.length > 0) {
        parts.push(value);
        if (parts.length >= 3) break;
      }
    }
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

export function VoiceCard({
  voice,
  selected,
  onSelect,
  onPreviewPlay,
  onPreviewStop,
  isPreviewing
}: VoiceCardProps) {
  const { colors, radius, spacing, fontSize, fontWeight } = useTheme();
  const labelsLine = formatLabels(voice.labels);
  const hasPreview = typeof voice.previewUrl === 'string' && voice.previewUrl.length > 0;

  const handlePress = () => {
    Haptics.selectionAsync().catch(() => {});
    onSelect(voice);
  };

  const handlePreview = () => {
    if (!hasPreview) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (isPreviewing) {
      onPreviewStop();
    } else {
      onPreviewPlay(voice);
    }
  };

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`Select voice ${voice.name}`}
      style={({ pressed }) => [
        styles.container,
        {
          backgroundColor: colors.bgElevated,
          borderRadius: radius.lg,
          padding: spacing.lg,
          borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
          borderColor: selected ? colors.accent : colors.border,
          gap: spacing.md,
          opacity: pressed ? 0.9 : 1
        }
      ]}
    >
      <View style={styles.body}>
        <View style={styles.titleRow}>
          {selected ? (
            <View
              style={[styles.dot, { backgroundColor: colors.success, marginRight: spacing.sm }]}
            />
          ) : null}
          <Text
            style={{
              color: colors.text,
              fontSize: fontSize.bodyLg,
              fontWeight: fontWeight.semibold,
              flexShrink: 1
            }}
            numberOfLines={1}
          >
            {voice.name}
          </Text>
        </View>
        {labelsLine ? (
          <Text
            style={{
              color: colors.textMuted,
              fontSize: fontSize.caption,
              marginTop: 2
            }}
            numberOfLines={1}
          >
            {labelsLine}
          </Text>
        ) : null}
        {voice.description ? (
          <Text
            style={{
              color: colors.textMuted,
              fontSize: fontSize.body,
              marginTop: spacing.xs
            }}
            numberOfLines={2}
          >
            {voice.description}
          </Text>
        ) : null}
      </View>

      <Pressable
        onPress={handlePreview}
        disabled={!hasPreview}
        accessibilityRole="button"
        accessibilityLabel={
          isPreviewing ? `Stop preview of ${voice.name}` : `Preview ${voice.name}`
        }
        hitSlop={10}
        style={({ pressed }) => [
          styles.previewButton,
          {
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: isPreviewing ? colors.accent : colors.bg,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
            opacity: !hasPreview ? 0.4 : pressed ? 0.7 : 1
          }
        ]}
      >
        <IconSymbol
          name={isPreviewing ? 'pause.fill' : 'play.fill'}
          size={16}
          color={isPreviewing ? colors.accentText : colors.text}
        />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center' },
  body: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  previewButton: { alignItems: 'center', justifyContent: 'center' }
});
