import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { IconSymbol, ProgressBar } from '@/src/components/ui';
import { useTheme } from '@/src/hooks/useTheme';
import { useLibraryStore } from '@/src/state/library';
import { usePlayerStore } from '@/src/state/player';

const BAR_HEIGHT = 64;
const COVER_SIZE = 40;
const SNIPPET_MAX_CHARS = 40;

export type MiniPlayerProps = {
  /**
   * Optional override for the bar tap. Defaults to navigating to the player
   * screen for the current book.
   */
  onPress?: () => void;
};

function makeSnippet(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return undefined;
  if (cleaned.length <= SNIPPET_MAX_CHARS) return cleaned;
  return `${cleaned.slice(0, SNIPPET_MAX_CHARS - 1).trimEnd()}…`;
}

export function MiniPlayer({ onPress }: MiniPlayerProps) {
  const currentBookId = usePlayerStore(s => s.currentBookId);
  const currentBlockIndex = usePlayerStore(s => s.currentBlockIndex);
  const isPlaying = usePlayerStore(s => s.isPlaying);

  const book = useLibraryStore(s => (currentBookId ? s.books[currentBookId] : undefined));

  // If a current book id was set but the book no longer exists in the library
  // (e.g. it was deleted), proactively clear the player so the bar disappears
  // and the rest of the app stops referencing a missing record.
  useEffect(() => {
    if (currentBookId && !book) {
      usePlayerStore.getState().clear();
    }
  }, [currentBookId, book]);

  const { colors, radius, spacing, fontSize, fontWeight } = useTheme();
  const [coverFailed, setCoverFailed] = useState(false);

  if (!currentBookId || !book) return null;

  const totalBlocks = book.blocks.length;
  const safeIndex = totalBlocks > 0 ? Math.min(Math.max(currentBlockIndex, 0), totalBlocks - 1) : 0;
  const currentBlock = totalBlocks > 0 ? book.blocks[safeIndex] : undefined;
  const snippet = makeSnippet(currentBlock?.text);
  // Page-level position summary — feels like "I'm on page X of Y" rather
  // than "block 47 of 218". Falls back to a snippet of the current block's
  // text if the book has no page metadata (e.g. plain-text imports).
  const allPages = new Set<number>();
  for (const b of book.blocks) allPages.add(b.page ?? 1);
  const totalPages = allPages.size;
  const currentPage = currentBlock?.page ?? 1;
  const pageSubtitle = totalBlocks > 0 ? `Page ${currentPage} of ${totalPages}` : 'Preparing…';
  const subtitle = snippet ?? pageSubtitle;
  const ratio = totalPages > 0 ? Math.min(1, currentPage / totalPages) : 0;
  const showPlaceholder = !book.coverUri || coverFailed;

  const goToPlayer = () => {
    // The `/player/[id]` route lands in Phase 4C; cast through `Href` so the
    // typed-routes union doesn't reject the not-yet-known pathname.
    router.push(`/player/${currentBookId}` as Href);
  };

  const handlePress = () => {
    Haptics.selectionAsync().catch(() => {});
    if (onPress) {
      onPress();
    } else {
      goToPlayer();
    }
  };

  const handleToggle = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (isPlaying) {
      usePlayerStore.getState().pause();
    } else {
      usePlayerStore.getState().play();
      // Mount the player screen so it can pick up the playback request.
      goToPlayer();
    }
  };

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`Now playing: ${book.title}`}
      style={({ pressed }) => [
        styles.container,
        {
          height: BAR_HEIGHT,
          backgroundColor: colors.bgElevated,
          borderTopColor: colors.border,
          paddingHorizontal: spacing.md,
          gap: spacing.md,
          opacity: pressed ? 0.9 : 1
        }
      ]}
    >
      <View
        style={[
          styles.cover,
          {
            width: COVER_SIZE,
            height: COVER_SIZE,
            borderRadius: radius.sm,
            backgroundColor: colors.border
          }
        ]}
      >
        {showPlaceholder ? (
          <IconSymbol name="book" size={18} color={colors.textMuted} />
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
            fontSize: fontSize.body,
            fontWeight: fontWeight.semibold
          }}
        >
          {book.title}
        </Text>
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={{
            color: colors.textMuted,
            fontSize: fontSize.caption,
            marginTop: 2
          }}
        >
          {subtitle}
        </Text>
      </View>

      <Pressable
        onPress={handleToggle}
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
        hitSlop={12}
        style={({ pressed }) => [styles.toggle, { opacity: pressed ? 0.6 : 1 }]}
      >
        <IconSymbol
          name={isPlaying ? 'pause.fill' : 'play.fill'}
          size={26}
          color={colors.text}
          weight="medium"
        />
      </Pressable>

      <View style={styles.progress} pointerEvents="none">
        <ProgressBar progress={ratio} height={2} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth
  },
  cover: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  coverImage: { width: '100%', height: '100%' },
  body: { flex: 1, minWidth: 0 },
  toggle: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  progress: { position: 'absolute', left: 0, right: 0, bottom: 0 }
});
