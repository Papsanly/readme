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
import type { Block } from '@/src/types/book';

const BLOCK_TEXT_LINES = 4;
const ERROR_DOT_SIZE = 8;

export type BlockItemProps = {
  block: Block;
  index: number;
  isCurrent: boolean;
  isSkipped: boolean;
  isErrored: boolean;
  onPress: (index: number) => void;
  onRetry?: (index: number) => void;
  style?: StyleProp<ViewStyle>;
};

function blockSubtitle(block: Block): string {
  const number = `Block ${block.index + 1}`;
  if (block.type === 'paragraph' || block.type === 'unknown') return number;
  return `${number} • ${humanizeType(block.type)}`;
}

function humanizeType(t: Block['type']): string {
  switch (t) {
    case 'header-footer':
      return 'header / footer';
    case 'page-number':
      return 'page number';
    case 'toc':
      return 'table of contents';
    default:
      return t;
  }
}

function BlockItemImpl({
  block,
  index,
  isCurrent,
  isSkipped,
  isErrored,
  onPress,
  onRetry,
  style
}: BlockItemProps) {
  const { colors, radius, spacing, fontSize, fontWeight } = useTheme();

  const handlePress = (_e: GestureResponderEvent) => {
    Haptics.selectionAsync().catch(() => {});
    if (isErrored && onRetry) {
      onRetry(index);
      return;
    }
    onPress(index);
  };

  const accent = isCurrent ? colors.accent : 'transparent';
  const bg = isCurrent ? colors.bgElevated : 'transparent';
  const opacity = isSkipped && !isCurrent ? 0.45 : 1;

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`Block ${index + 1}${isCurrent ? ', current' : ''}${
        isSkipped ? ', skipped' : ''
      }${isErrored ? ', failed' : ''}`}
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
          {blockSubtitle(block)}
        </Text>
        {isSkipped ? (
          <View
            style={[
              styles.pill,
              {
                backgroundColor: colors.border,
                paddingHorizontal: spacing.sm
              }
            ]}
          >
            <Text
              style={{
                color: colors.textMuted,
                fontSize: fontSize.caption,
                fontWeight: fontWeight.medium
              }}
            >
              skipped
            </Text>
          </View>
        ) : null}
        {isErrored ? (
          <View
            style={[styles.errorDot, { backgroundColor: colors.danger }]}
            accessibilityLabel="audio failed"
          />
        ) : null}
      </View>

      <Text
        style={{
          color: colors.text,
          fontSize: fontSize.body,
          fontWeight: isCurrent ? fontWeight.medium : fontWeight.regular,
          marginTop: spacing.xs,
          lineHeight: fontSize.body * 1.45
        }}
        numberOfLines={isCurrent ? undefined : BLOCK_TEXT_LINES}
        ellipsizeMode="tail"
      >
        {block.text}
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

export const BlockItem = memo(BlockItemImpl);

const styles = StyleSheet.create({
  container: {
    borderWidth: 1
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  pill: {
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center'
  },
  errorDot: {
    width: ERROR_DOT_SIZE,
    height: ERROR_DOT_SIZE,
    borderRadius: ERROR_DOT_SIZE / 2
  }
});
