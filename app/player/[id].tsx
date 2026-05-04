import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PlayerControls, ReflowedList } from '@/src/components/player';
import { EmptyState, IconSymbol, ProgressBar } from '@/src/components/ui';
import { nextPlayableBlockIndex, useAudioEngine } from '@/src/hooks/useAudioEngine';
import { useTheme } from '@/src/hooks/useTheme';
import { useLibraryStore } from '@/src/state/library';
import { usePlayerStore } from '@/src/state/player';
import { useSettingsStore } from '@/src/state/settings';
import type { Book } from '@/src/types/book';

const HEADER_BUTTON_SIZE = 36;
const SPEED_CYCLE = [0.85, 1.0, 1.15, 1.3] as const;
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
  const speed = useSettingsStore(s => s.speed);
  const skipping = useSettingsStore(s => s.skipping);
  const voiceName = useSettingsStore(s => s.voiceName);

  const currentBlockIndex = usePlayerStore(s => s.currentBlockIndex);
  const isPlaying = usePlayerStore(s => s.isPlaying);

  const engine = useAudioEngine(book.id);

  const blocks = book.blocks;
  const totalBlocks = blocks.length;
  const safeIndex = totalBlocks > 0 ? Math.min(Math.max(currentBlockIndex, 0), totalBlocks - 1) : 0;

  const canPrev = useMemo(
    () =>
      totalBlocks > 0 && nextPlayableBlockIndex(blocks, safeIndex, 'backward', skipping) != null,
    [blocks, safeIndex, skipping, totalBlocks]
  );
  const canNext = useMemo(
    () => totalBlocks > 0 && nextPlayableBlockIndex(blocks, safeIndex, 'forward', skipping) != null,
    [blocks, safeIndex, skipping, totalBlocks]
  );

  const erroredIndex = engine.blockError ? safeIndex : undefined;

  const handleSelectBlock = useCallback((index: number) => {
    usePlayerStore.getState().setBlock(index);
  }, []);

  const handleRetryBlock = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    engine.retryCurrentBlock();
  }, [engine]);

  const handleCycleSpeed = useCallback(() => {
    const current = useSettingsStore.getState().speed;
    let nextIdx = SPEED_CYCLE.findIndex(v => Math.abs(v - current) < 0.01) + 1;
    if (nextIdx >= SPEED_CYCLE.length) nextIdx = 0;
    useSettingsStore.getState().setSpeed(SPEED_CYCLE[nextIdx]);
  }, []);

  const handleOpenVoice = useCallback(() => {
    router.push('/settings/voice' as Href);
  }, []);

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
        <ReflowedList
          blocks={blocks}
          currentIndex={safeIndex}
          skipping={skipping}
          erroredIndex={erroredIndex}
          onSelect={handleSelectBlock}
          onRetry={handleRetryBlock}
          bottomInset={CONTROLS_INSET}
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
      <PlayerHeader title={book.title} />
      <View style={styles.body}>{body}</View>
      {showControls ? (
        <View>
          <PlayerControls
            isPlaying={isPlaying}
            isLoadingBlock={engine.isLoadingBlock}
            blockError={engine.blockError}
            positionSec={engine.positionSec}
            durationSec={engine.durationSec}
            speed={speed}
            voiceName={voiceName}
            canPrev={canPrev}
            canNext={canNext}
            onTogglePlay={engine.togglePlay}
            onPrev={engine.goPrev}
            onNext={engine.goNext}
            onSeekBy={engine.seekBy}
            onCycleSpeed={handleCycleSpeed}
            onOpenVoice={handleOpenVoice}
            onRetryCurrentBlock={engine.retryCurrentBlock}
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function PlayerHeader({ title }: { title: string }) {
  const { colors, spacing, fontSize, fontWeight } = useTheme();

  const handleBack = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)' as Href);
  }, []);

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
      <View style={{ width: HEADER_BUTTON_SIZE, height: HEADER_BUTTON_SIZE }} />
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
