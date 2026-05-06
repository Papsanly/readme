import * as Haptics from 'expo-haptics';
import { memo } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle
} from 'react-native';

import { useTheme } from '@/src/hooks/useTheme';

const COLLAPSED_TEXT_LINES = 6;

export type PageItemProps = {
  pageNumber: number;
  /** Combined narration text for the page (paragraphs joined). */
  text: string;
  isCurrent: boolean;
  /** When true, the card is dimmed because the page contains no playable blocks. */
  isSkipped?: boolean;
  /** When true, the card shows a subtle error state (current-page synth failed). */
  isErrored?: boolean;
  /** Tap → start playback of this page. Disabled when there's nothing to play. */
  onPress: (pageNumber: number) => void;
  /** Tap on errored card → retry. */
  onRetry?: (pageNumber: number) => void;
  style?: StyleProp<ViewStyle>;
};

function PageItemImpl({
  pageNumber,
  text,
  isCurrent,
  isSkipped,
  isErrored,
  onPress,
  onRetry,
  style
}: PageItemProps) {
  const { colors, radius, spacing, fontSize, fontWeight } = useTheme();

  const handlePress = (_e: GestureResponderEvent) => {
    Haptics.selectionAsync().catch(() => {});
    if (isErrored && onRetry) {
      onRetry(pageNumber);
      return;
    }
    onPress(pageNumber);
  };

  const accent = isCurrent ? colors.accent : 'transparent';
  const bg = isCurrent ? colors.bgElevated : 'transparent';
  const opacity = isSkipped && !isCurrent ? 0.45 : 1;

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`Page ${pageNumber}${isCurrent ? ', current' : ''}${
        isErrored ? ', failed' : ''
      }`}
      style={({ pressed }) => [
        styles.container,
        {
          backgroundColor: bg,
          borderColor: accent,
          borderRadius: radius.md,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.md,
          opacity: pressed ? Math.max(0.6, opacity * 0.85) : opacity
        },
        style
      ]}
    >
      <View style={[styles.row, { gap: spacing.sm }]}>
        <Text
          style={{
            color: colors.textMuted,
            fontSize: fontSize.caption,
            fontWeight: fontWeight.medium,
            flex: 1
          }}
          numberOfLines={1}
        >
          Page {pageNumber}
        </Text>
        {isErrored ? <View style={[styles.errorDot, { backgroundColor: colors.danger }]} /> : null}
      </View>

      <Text
        style={{
          color: colors.text,
          fontSize: fontSize.body,
          fontWeight: isCurrent ? fontWeight.medium : fontWeight.regular,
          marginTop: spacing.xs,
          lineHeight: fontSize.body * 1.5
        }}
        numberOfLines={isCurrent ? undefined : COLLAPSED_TEXT_LINES}
        ellipsizeMode="tail"
      >
        {text}
      </Text>

      {isErrored ? (
        <Text
          style={{
            color: colors.danger,
            fontSize: fontSize.caption,
            marginTop: spacing.xs,
            fontWeight: fontWeight.medium
          }}
        >
          Tap to retry
        </Text>
      ) : null}
    </Pressable>
  );
}

export const PageItem = memo(PageItemImpl);

const styles = StyleSheet.create({
  container: {
    borderWidth: 1
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  errorDot: {
    width: 8,
    height: 8,
    borderRadius: 4
  }
});
