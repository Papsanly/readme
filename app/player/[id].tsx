import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CurrentPageView, PlayerControls } from '@/src/components/player';
import { EmptyState, IconSymbol, ProgressBar } from '@/src/components/ui';
import { useAudioEngine } from '@/src/hooks/useAudioEngine';
import { useTheme } from '@/src/hooks/useTheme';
import { useLibraryStore } from '@/src/state/library';
import { usePlayerStore } from '@/src/state/player';
import type { Book } from '@/src/types/book';

const HEADER_BUTTON_SIZE = 36;
const CONTROLS_INSET = 220;

export default function PlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const bookId = typeof id === 'string' ? id : undefined;

  const book = useLibraryStore(s => (bookId ? s.books[bookId] : undefined));

  // Sync the player store to this book on mount and when the route changes.
  // We honor any saved progress on the book record at the moment of arrival;
  // subsequent progress writes (which happen *because* of this screen) must
  // not re-trigger this effect.
  useEffect(() => {
    if (!bookId) return;
    const player = usePlayerStore.getState();
    if (player.currentBookId !== bookId) {
      player.setBook(bookId);
    }
    const stored = useLibraryStore.getState().books[bookId];
    const savedIndex = stored?.progress.blockIndex ?? 0;
    const savedPos = stored?.progress.positionSec ?? 0;
    if (savedIndex !== usePlayerStore.getState().currentBlockIndex) {
      usePlayerStore.getState().setBlock(savedIndex);
    }
    if (savedPos > 0) {
      usePlayerStore.getState().setPosition(savedPos);
    }
  }, [bookId]);

  if (!bookId || !book) {
    return <BookNotFound />;
  }

  return <ReadyScreen book={book} />;
}

function ReadyScreen({ book }: { book: Book }) {
  const { colors } = useTheme();
  const currentBlockIndex = usePlayerStore(s => s.currentBlockIndex);
  const isPlaying = usePlayerStore(s => s.isPlaying);

  const engine = useAudioEngine(book.id);

  const blocks = book.blocks;
  const totalBlocks = blocks.length;
  const safeIndex = totalBlocks > 0 ? Math.min(Math.max(currentBlockIndex, 0), totalBlocks - 1) : 0;

  // Prev: always available (can rewind to start of current page) once the
  // book has any playable content. Next: enabled if any later page exists.
  const canPrev = totalBlocks > 0;
  const canNext = useMemo(() => {
    if (totalBlocks === 0) return false;
    const currentBlk = blocks[safeIndex];
    const currentPage = currentBlk?.page ?? 1;
    const pages = new Set<number>();
    for (const b of blocks) pages.add(b.page ?? 1);
    const sorted = Array.from(pages).sort((a, b) => a - b);
    const idx = sorted.indexOf(currentPage);
    return idx >= 0 && idx < sorted.length - 1;
  }, [blocks, safeIndex, totalBlocks]);

  const handleRetryBlock = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    engine.retryCurrentBlock();
  }, [engine]);

  /**
   * Word tapped on the current page → seek directly through the engine.
   * `seekToBlockOffset` does a live seek if the target block is the one
   * already loaded (works during playback, no re-synth) and falls back to
   * a load + post-load seek for any other block.
   */
  const handleWordTap = useCallback(
    (blockIndex: number, offsetSec: number) => {
      engine.seekToBlockOffset(blockIndex, offsetSec);
    },
    [engine]
  );

  /**
   * Player progress-bar drag committed → translate the page-level position
   * (seconds since the page started) to a `(blockIndex, offsetWithinBlock)`
   * pair, then dispatch via `setBlock` so the engine loads and seeks.
   *
   * Block durations: real values for blocks the user has already played
   * (cached on the engine) aren't accessible here, so we use the same
   * char-rate estimate as the page progress bar. The estimate only matters
   * for *which block* contains the target second; once the right block is
   * loaded the actual seek is in real audio time.
   */
  const handleSeekTo = useCallback(
    (pagePositionSec: number) => {
      if (totalBlocks === 0) return;
      const currentBlk = blocks[safeIndex];
      const currentPage = currentBlk?.page ?? 1;

      const pageBlocks: { index: number; estDuration: number }[] = [];
      for (let i = 0; i < blocks.length; i += 1) {
        const b = blocks[i];
        if ((b.page ?? 1) !== currentPage) continue;
        // Engine-reported real duration when the block has been loaded once,
        // text-length estimate otherwise — same numbers the page progress
        // bar uses, so the slider position lines up with the audio.
        pageBlocks.push({ index: i, estDuration: engine.estimateBlockDuration(b) });
      }
      if (pageBlocks.length === 0) return;

      let remaining = Math.max(0, pagePositionSec);
      let target = pageBlocks[0];
      let offsetWithinBlock = 0;
      for (let i = 0; i < pageBlocks.length; i += 1) {
        const pb = pageBlocks[i];
        if (remaining < pb.estDuration || i === pageBlocks.length - 1) {
          target = pb;
          offsetWithinBlock = Math.max(0, remaining);
          break;
        }
        remaining -= pb.estDuration;
      }

      engine.seekToBlockOffset(target.index, offsetWithinBlock);
    },
    [blocks, safeIndex, totalBlocks, engine]
  );

  // ----- Body branches per book status ------------------------------------
  let body: ReactNode;
  if (book.status === 'queued' || book.status === 'processing') {
    body = <ProcessingBody book={book} />;
  } else if (book.status === 'failed') {
    body = (
      <EmptyState
        icon="tray"
        title="Processing failed"
        description={book.processingError?.trim() || 'This book could not be processed.'}
        ctaLabel="Open processing details"
        onCtaPress={() => router.replace(`/upload/${book.id}` as Href)}
      />
    );
  } else if (totalBlocks === 0) {
    body = (
      <EmptyState
        icon="tray"
        title="No content"
        description="This book is ready but contains no readable blocks."
      />
    );
  } else {
    body = (
      <View style={styles.list}>
        <CurrentPageView
          blocks={blocks}
          currentIndex={safeIndex}
          bottomInset={CONTROLS_INSET}
          errorMessage={engine.blockError}
          onRetry={handleRetryBlock}
          onWordTap={handleWordTap}
          charOffsetToAudioSec={engine.charOffsetToAudioSec}
        />
      </View>
    );
  }

  const showControls =
    book.status === 'ready' && totalBlocks > 0 && book.blocks[safeIndex] !== undefined;

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.screen, { backgroundColor: colors.bg }]}
    >
      <PlayerHeader title={book.title} bookId={book.id} />
      <View style={styles.body}>{body}</View>
      {showControls ? (
        <View>
          <PlayerControls
            isPlaying={isPlaying}
            isLoadingBlock={engine.isLoadingBlock}
            blockError={engine.blockError}
            positionSec={engine.pagePositionSec}
            durationSec={engine.pageDurationSec}
            currentPage={engine.currentPage}
            totalPages={engine.totalPages}
            canPrev={canPrev}
            canNext={canNext}
            onTogglePlay={engine.togglePlay}
            onPrev={engine.goPrev}
            onNext={engine.goNext}
            onSeekBy={engine.seekBy}
            onSeekTo={handleSeekTo}
            onRetryCurrentBlock={engine.retryCurrentBlock}
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function PlayerHeader({ title, bookId }: { title: string; bookId?: string }) {
  const { colors, spacing, fontSize, fontWeight } = useTheme();

  const handleBack = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)' as Href);
  }, []);

  const handleOpenSettings = useCallback(() => {
    if (!bookId) return;
    Haptics.selectionAsync().catch(() => {});
    router.push(`/book-settings/${bookId}` as Href);
  }, [bookId]);

  return (
    <View
      style={[
        styles.header,
        {
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          borderBottomColor: colors.border
        }
      ]}
    >
      <Pressable
        onPress={handleBack}
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={8}
        style={({ pressed }) => [
          styles.headerButton,
          {
            width: HEADER_BUTTON_SIZE,
            height: HEADER_BUTTON_SIZE,
            borderRadius: HEADER_BUTTON_SIZE / 2,
            backgroundColor: colors.bgElevated,
            opacity: pressed ? 0.7 : 1
          }
        ]}
      >
        <IconSymbol name="chevron.left" size={18} color={colors.text} weight="medium" />
      </Pressable>
      <Text
        style={[
          styles.headerTitle,
          {
            color: colors.text,
            fontSize: fontSize.bodyLg,
            fontWeight: fontWeight.semibold
          }
        ]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {title}
      </Text>
      {bookId ? (
        <Pressable
          onPress={handleOpenSettings}
          accessibilityRole="button"
          accessibilityLabel="Reading settings"
          hitSlop={8}
          style={({ pressed }) => [
            styles.headerButton,
            {
              width: HEADER_BUTTON_SIZE,
              height: HEADER_BUTTON_SIZE,
              borderRadius: HEADER_BUTTON_SIZE / 2,
              backgroundColor: colors.bgElevated,
              opacity: pressed ? 0.7 : 1
            }
          ]}
        >
          <IconSymbol name="gear" size={18} color={colors.text} weight="medium" />
        </Pressable>
      ) : (
        <View style={{ width: HEADER_BUTTON_SIZE, height: HEADER_BUTTON_SIZE }} />
      )}
    </View>
  );
}

function ProcessingBody({ book }: { book: Book }) {
  const { colors, spacing, fontSize, fontWeight } = useTheme();
  const stage = book.processingProgress?.stage ?? 'rendering';
  const done = book.processingProgress?.done ?? 0;
  const total = book.processingProgress?.total ?? 0;
  const ratio = total > 0 ? done / total : 0;

  const handleOpenDetails = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    router.replace(`/upload/${book.id}` as Href);
  }, [book.id]);

  return (
    <View
      style={[
        styles.processing,
        {
          padding: spacing.xl,
          gap: spacing.lg
        }
      ]}
    >
      <Text
        style={{
          color: colors.text,
          fontSize: fontSize.h2,
          fontWeight: fontWeight.semibold,
          textAlign: 'center'
        }}
        numberOfLines={2}
      >
        {book.title}
      </Text>
      <ProgressBar progress={ratio} />
      <Text
        style={{
          color: colors.textMuted,
          fontSize: fontSize.body,
          textAlign: 'center'
        }}
      >
        {labelForStage(stage)} {total > 0 ? `${done} / ${total}` : '…'}
      </Text>
      <Pressable
        onPress={handleOpenDetails}
        accessibilityRole="button"
        accessibilityLabel="Tap to view processing details"
        hitSlop={8}
        style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1, marginTop: spacing.sm }]}
      >
        <Text
          style={{
            color: colors.accent,
            fontSize: fontSize.body,
            fontWeight: fontWeight.medium,
            textAlign: 'center'
          }}
        >
          Tap to view processing details
        </Text>
      </Pressable>
    </View>
  );
}

function labelForStage(stage: 'rendering' | 'analyzing' | 'done'): string {
  switch (stage) {
    case 'rendering':
      return 'Rendering pages';
    case 'analyzing':
      return 'Analyzing pages';
    case 'done':
      return 'Wrapping up';
  }
}

function BookNotFound() {
  const { colors } = useTheme();
  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.screen, { backgroundColor: colors.bg }]}
    >
      <PlayerHeader title="Player" />
      <View style={styles.body}>
        <EmptyState
          icon="tray"
          title="Book not found"
          description="The book you tried to open is no longer available."
          ctaLabel="Back to Library"
          onCtaPress={() => router.replace('/(tabs)' as Href)}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  headerButton: { alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', marginHorizontal: 8 },
  body: { flex: 1 },
  list: { flex: 1, marginTop: 8 },
  processing: { flex: 1, alignItems: 'stretch', justifyContent: 'center' }
});
