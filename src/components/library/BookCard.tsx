import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { IconSymbol, ProgressBar } from '@/src/components/ui';
import { useTheme } from '@/src/hooks/useTheme';
import type { Book } from '@/src/types/book';
import { formatDuration } from '@/src/utils/format';

const COVER_WIDTH = 60;
const COVER_HEIGHT = 80;
/** Rough average seconds per block. Used for the ready-state listening estimate. */
const BLOCK_DURATION_ESTIMATE_SEC = 12;

export type BookCardProps = {
  book: Book;
  onPress: (book: Book) => void;
  onLongPress: (book: Book) => void;
  style?: StyleProp<ViewStyle>;
};

export function BookCard({ book, onPress, onLongPress, style }: BookCardProps) {
  const { colors, radius, spacing, fontSize, fontWeight } = useTheme();
  const [coverFailed, setCoverFailed] = useState(false);

  const showPlaceholder = !book.coverUri || coverFailed;

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress(book);
  };

  const handleLongPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onLongPress(book);
  };

  return (
    <Pressable
      onPress={handlePress}
      onLongPress={handleLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={book.title}
      style={({ pressed }) => [
        styles.container,
        {
          backgroundColor: colors.bgElevated,
          borderRadius: radius.lg,
          padding: spacing.md,
          gap: spacing.md,
          opacity: pressed ? 0.85 : 1
        },
        style
      ]}
    >
      <View
        style={[
          styles.cover,
          {
            width: COVER_WIDTH,
            height: COVER_HEIGHT,
            borderRadius: radius.sm,
            backgroundColor: colors.border
          }
        ]}
      >
        {showPlaceholder ? (
          <IconSymbol name="book" size={24} color={colors.textMuted} />
        ) : (
          <Image
            source={{ uri: book.coverUri }}
            style={styles.coverImage}
            contentFit="cover"
            transition={150}
            cachePolicy="memory-disk"
            onError={() => setCoverFailed(true)}
            accessibilityIgnoresInvertColors
          />
        )}
      </View>

      <View style={styles.body}>
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={{
            color: colors.text,
            fontSize: fontSize.bodyLg,
            fontWeight: fontWeight.semibold
          }}
        >
          {book.title}
        </Text>
        <View style={{ marginTop: spacing.xs }}>
          <BookCardStatus book={book} />
        </View>
      </View>

      <IconSymbol name="chevron.right" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

function BookCardStatus({ book }: { book: Book }) {
  const { colors, spacing, fontSize } = useTheme();

  switch (book.status) {
    case 'queued':
      return (
        <Text style={{ color: colors.textMuted, fontSize: fontSize.body }} numberOfLines={1}>
          Queued
        </Text>
      );

    case 'processing': {
      const progress = book.processingProgress;
      const subtitle = progress
        ? `Processing • ${progress.stage} ${progress.done}/${progress.total}`
        : 'Processing…';
      const ratio = progress && progress.total > 0 ? progress.done / progress.total : 0;
      return (
        <View>
          <Text style={{ color: colors.textMuted, fontSize: fontSize.body }} numberOfLines={1}>
            {subtitle}
          </Text>
          <ProgressBar progress={ratio} style={{ marginTop: spacing.xs }} />
        </View>
      );
    }

    case 'failed': {
      const detail = book.processingError?.trim() || 'Unknown error';
      return (
        <View>
          <Text
            style={{ color: colors.danger, fontSize: fontSize.body }}
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            Failed: {detail}
          </Text>
          <Text
            style={{
              color: colors.textMuted,
              fontSize: fontSize.caption,
              marginTop: 2
            }}
          >
            Tap to retry
          </Text>
        </View>
      );
    }

    case 'ready': {
      const blocksCount = book.blocks.length;
      const estimateSec = blocksCount * BLOCK_DURATION_ESTIMATE_SEC;
      const ratio = blocksCount > 0 ? book.progress.blockIndex / blocksCount : 0;
      const summary =
        blocksCount > 0
          ? `${blocksCount} block${blocksCount === 1 ? '' : 's'} • ${formatDuration(estimateSec)}`
          : 'Ready';
      return (
        <View>
          <Text style={{ color: colors.textMuted, fontSize: fontSize.body }} numberOfLines={1}>
            {summary}
          </Text>
          {blocksCount > 0 ? (
            <ProgressBar progress={ratio} style={{ marginTop: spacing.xs }} />
          ) : null}
        </View>
      );
    }
  }
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center' },
  cover: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  coverImage: { width: '100%', height: '100%' },
  body: { flex: 1, minWidth: 0 }
});
