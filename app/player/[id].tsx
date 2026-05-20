import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  CurrentPageView,
  OriginalView,
  OutlineSheet,
  PlayerControls,
  SleepTimerSheet
} from '@/src/components/player';
import { EmptyState, IconSymbol, ProgressBar } from '@/src/components/ui';
import { useAudioEngine } from '@/src/hooks/useAudioEngine';
import { useOriginalView } from '@/src/hooks/useOriginalView';
import { useSleepTimer } from '@/src/hooks/useSleepTimer';
import { useTheme } from '@/src/hooks/useTheme';
import { useLibraryStore } from '@/src/state/library';
import { usePlayerStore } from '@/src/state/player';
import { useSettingsStore } from '@/src/state/settings';
import { formatDuration } from '@/src/utils/format';
import { findSmartMainContentIndex } from '@/src/utils/mainContent';
import type { Book } from '@/src/types/book';
import type { OcrPage } from '@/src/types/ocr';
import type { ViewMode } from '@/src/types/settings';

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
  const sleepTimer = useSleepTimer();
  const { ocr: outlineOcr } = useOriginalView(book.id);

  const [sleepSheetOpen, setSleepSheetOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [requestedPage, setRequestedPage] = useState<number | undefined>(undefined);

  const isPdf = useMemo(() => /\.pdf$/i.test(book.source.name), [book.source.name]);
  const persistedMode = useSettingsStore(s => s.viewMode);
  const setPersistedMode = useSettingsStore(s => s.setViewMode);
  // Original view requires PDF; coerce to reflowed for image/txt sources.
  const viewMode: ViewMode = isPdf ? persistedMode : 'reflowed';

  const handleToggleViewMode = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    setPersistedMode(viewMode === 'reflowed' ? 'original' : 'reflowed');
  }, [viewMode, setPersistedMode]);

  const blocks = book.blocks;
  const totalBlocks = blocks.length;
  const safeIndex = totalBlocks > 0 ? Math.min(Math.max(currentBlockIndex, 0), totalBlocks - 1) : 0;
  const knownTotalPages = useMemo(() => getKnownTotalPages(book, blocks), [book, blocks]);
  const currentBlock = totalBlocks > 0 ? blocks[safeIndex] : undefined;
  const currentPage = requestedPage ?? currentBlock?.page ?? engine.currentPage ?? 1;
  const requestedPageHasBlocks =
    requestedPage != null && blocks.some(block => (block.page ?? 1) === requestedPage);
  const readyThroughPage = getReadyThroughPage(book, knownTotalPages);
  const requestedPageIsReady = requestedPage != null && requestedPage <= readyThroughPage;
  const requestedReadyPageHasNoBlocks =
    requestedPage != null && requestedPageIsReady && !requestedPageHasBlocks;
  const waitingForRequestedPage =
    requestedPage != null && !requestedPageHasBlocks && !requestedPageIsReady;

  useEffect(() => {
    if (requestedPage == null) return;
    if (knownTotalPages > 0 && requestedPage > knownTotalPages) {
      setRequestedPage(undefined);
      return;
    }
    const target = firstBlockIndexOnPage(blocks, requestedPage);
    if (target == null) return;
    setRequestedPage(undefined);
    engine.seekToBlockOffset(target, 0);
  }, [blocks, engine, knownTotalPages, requestedPage]);

  // Book-level smart start: skip cover/credits/TOC/front-matter pages instead
  // of trusting the first `isMainContent` block on the current page.
  const smartMainContentIndex = useMemo(() => findSmartMainContentIndex(blocks), [blocks]);

  const showSkipToMain =
    !waitingForRequestedPage &&
    !requestedReadyPageHasNoBlocks &&
    smartMainContentIndex != null &&
    smartMainContentIndex > safeIndex;

  const handleSkipToMain = useCallback(() => {
    if (smartMainContentIndex == null) return;
    Haptics.selectionAsync().catch(() => {});
    engine.seekToBlockOffset(smartMainContentIndex, 0);
    usePlayerStore.getState().play();
  }, [engine, smartMainContentIndex]);

  const handleOutlineSelect = useCallback(
    (blockIndex: number) => {
      Haptics.selectionAsync().catch(() => {});
      setOutlineOpen(false);
      engine.seekToBlockOffset(blockIndex, 0);
      usePlayerStore.getState().play();
    },
    [engine]
  );

  const handleSleepTimerPick = useCallback(
    (minutes: number) => {
      Haptics.selectionAsync().catch(() => {});
      sleepTimer.start(minutes);
      setSleepSheetOpen(false);
    },
    [sleepTimer]
  );

  const handleSleepTimerCancel = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    sleepTimer.cancel();
  }, [sleepTimer]);

  // Page navigation uses the known full PDF page count, not only pages whose
  // VLM blocks have already arrived. Unprocessed pages show a loading state.
  const canPrev = currentPage > 1 || totalBlocks > 0;
  const canNext = knownTotalPages > 0 ? currentPage < knownTotalPages : false;

  const handleRetryBlock = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    engine.retryCurrentBlock();
  }, [engine]);

  /**
   * Block tapped on the current page → seek to the block start. Live-seeks
   * if the target is the currently-loaded block, otherwise loads + plays.
   */
  const handleBlockTap = useCallback(
    (blockIndex: number) => {
      engine.seekToBlockOffset(blockIndex, 0);
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

  const handlePrevPage = useCallback(() => {
    if (currentPage > 1) {
      const prev = currentPage - 1;
      const target = firstBlockIndexOnPage(blocks, prev);
      if (target != null) {
        setRequestedPage(undefined);
        engine.seekToBlockOffset(target, 0);
      } else {
        setRequestedPage(prev);
        usePlayerStore.getState().pause();
      }
      return;
    }
    engine.goPrev();
  }, [blocks, currentPage, engine]);

  const handleNextPage = useCallback(() => {
    if (knownTotalPages <= 0 || currentPage >= knownTotalPages) {
      engine.goNext();
      return;
    }
    const next = currentPage + 1;
    const target = firstBlockIndexOnPage(blocks, next);
    if (target != null) {
      setRequestedPage(undefined);
      engine.seekToBlockOffset(target, 0);
    } else {
      setRequestedPage(next);
      usePlayerStore.getState().pause();
    }
  }, [blocks, currentPage, engine, knownTotalPages]);

  // ----- Body branches per book status ------------------------------------
  let body: ReactNode;
  if (book.status === 'failed') {
    body = (
      <EmptyState
        icon="tray"
        title="Processing failed"
        description={book.processingError?.trim() || 'This book could not be processed.'}
        ctaLabel="Open processing details"
        onCtaPress={() => router.replace(`/upload/${book.id}` as Href)}
      />
    );
  } else if (waitingForRequestedPage) {
    body = (
      <PageLoadingBody
        page={requestedPage ?? currentPage}
        totalPages={knownTotalPages}
        progress={book.processingProgress}
      />
    );
  } else if (requestedReadyPageHasNoBlocks) {
    body = <PageNoContentBody page={requestedPage ?? currentPage} totalPages={knownTotalPages} />;
  } else if (book.status === 'queued' || book.status === 'processing') {
    body = <ProcessingBody book={book} />;
  } else if (totalBlocks === 0) {
    body = (
      <EmptyState
        icon="tray"
        title="No content"
        description="This book is ready but contains no readable blocks."
      />
    );
  } else if (viewMode === 'original') {
    body = (
      <View style={styles.list}>
        <OriginalViewBody
          book={book}
          blocks={blocks}
          currentIndex={safeIndex}
          bottomInset={CONTROLS_INSET}
          onBlockTap={blockIndex => engine.seekToBlockOffset(blockIndex, 0)}
          onSwipePrev={canPrev ? handlePrevPage : undefined}
          onSwipeNext={canNext ? handleNextPage : undefined}
          canSwipePrev={canPrev}
          canSwipeNext={canNext}
        />
      </View>
    );
  } else {
    body = (
      <View style={styles.list}>
        <CurrentPageView
          blocks={blocks}
          currentIndex={safeIndex}
          bottomInset={CONTROLS_INSET}
          totalPages={knownTotalPages || engine.totalPages}
          errorMessage={engine.blockError}
          onRetry={handleRetryBlock}
          onBlockTap={handleBlockTap}
        />
      </View>
    );
  }

  const showControls =
    book.status === 'ready' &&
    (waitingForRequestedPage ||
      requestedReadyPageHasNoBlocks ||
      (totalBlocks > 0 && book.blocks[safeIndex] !== undefined));

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.screen, { backgroundColor: colors.bg }]}
    >
      <PlayerHeader
        title={book.title}
        bookId={book.id}
        viewMode={viewMode}
        canToggleViewMode={isPdf}
        onToggleViewMode={handleToggleViewMode}
        sleepTimerActive={sleepTimer.remainingSec != null}
        sleepTimerRemainingSec={sleepTimer.remainingSec}
        onOpenSleepTimer={() => setSleepSheetOpen(true)}
        onOpenOutline={() => setOutlineOpen(true)}
      />
      <View style={styles.body}>{body}</View>
      {showSkipToMain ? (
        <SkipToMainFab onPress={handleSkipToMain} bottomInset={CONTROLS_INSET + 16} />
      ) : null}
      {showControls ? (
        <View>
          <PlayerControls
            isPlaying={isPlaying}
            isLoadingBlock={engine.isLoadingBlock || waitingForRequestedPage}
            blockError={engine.blockError}
            positionSec={waitingForRequestedPage ? 0 : engine.pagePositionSec}
            durationSec={waitingForRequestedPage ? 0 : engine.pageDurationSec}
            currentPage={currentPage}
            totalPages={knownTotalPages || engine.totalPages}
            canPrev={canPrev}
            canNext={canNext}
            onTogglePlay={engine.togglePlay}
            onPrev={handlePrevPage}
            onNext={handleNextPage}
            onSeekBy={engine.seekBy}
            onSeekTo={handleSeekTo}
            onRetryCurrentBlock={engine.retryCurrentBlock}
          />
        </View>
      ) : null}
      <SleepTimerSheet
        visible={sleepSheetOpen}
        remainingSec={sleepTimer.remainingSec}
        onPick={handleSleepTimerPick}
        onCancel={handleSleepTimerCancel}
        onClose={() => setSleepSheetOpen(false)}
      />
      <OutlineSheet
        visible={outlineOpen}
        blocks={blocks}
        ocrPages={outlineOcr?.pages}
        currentIndex={safeIndex}
        onSelect={handleOutlineSelect}
        onClose={() => setOutlineOpen(false)}
      />
    </SafeAreaView>
  );
}

function maxPageFromBlocks(blocks: readonly Book['blocks'][number][]): number {
  let max = 0;
  for (const block of blocks) {
    const page = block.page ?? 1;
    if (page > max) max = page;
  }
  return max;
}

function getKnownTotalPages(book: Book, blocks: readonly Book['blocks'][number][]): number {
  const fromProgress = book.processingProgress?.total ?? 0;
  return Math.max(fromProgress, maxPageFromBlocks(blocks));
}

function getReadyThroughPage(book: Book, totalPages: number): number {
  const progress = book.processingProgress;
  if (!progress) return maxPageFromBlocks(book.blocks);
  if (progress.stage === 'done') return totalPages || progress.total;
  return Math.max(0, progress.done);
}

function firstBlockIndexOnPage(
  blocks: readonly Book['blocks'][number][],
  page: number
): number | null {
  for (let i = 0; i < blocks.length; i += 1) {
    if ((blocks[i]?.page ?? 1) === page) return i;
  }
  return null;
}

function SkipToMainFab({ onPress, bottomInset }: { onPress: () => void; bottomInset: number }) {
  const { colors, radius, spacing, fontSize, fontWeight } = useTheme();
  return (
    <View pointerEvents="box-none" style={[styles.fabWrap, { bottom: bottomInset }]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Skip to main content"
        style={({ pressed }) => [
          styles.fab,
          {
            backgroundColor: colors.accent,
            borderRadius: radius.lg,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            opacity: pressed ? 0.85 : 1,
            gap: spacing.xs
          }
        ]}
      >
        <IconSymbol name="forward.fill" size={16} color={colors.accentText} weight="semibold" />
        <Text
          style={{
            color: colors.accentText,
            fontSize: fontSize.body,
            fontWeight: fontWeight.semibold
          }}
        >
          Skip to main content
        </Text>
      </Pressable>
    </View>
  );
}

function PlayerHeader({
  title,
  bookId,
  viewMode,
  canToggleViewMode,
  onToggleViewMode,
  sleepTimerActive,
  sleepTimerRemainingSec,
  onOpenSleepTimer,
  onOpenOutline
}: {
  title: string;
  bookId?: string;
  viewMode?: ViewMode;
  canToggleViewMode?: boolean;
  onToggleViewMode?: () => void;
  sleepTimerActive?: boolean;
  sleepTimerRemainingSec?: number | null;
  onOpenSleepTimer?: () => void;
  onOpenOutline?: () => void;
}) {
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
      <View style={styles.headerActions}>
        {onOpenOutline ? (
          <Pressable
            onPress={onOpenOutline}
            accessibilityRole="button"
            accessibilityLabel="Open outline"
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
            <IconSymbol name="list.bullet" size={18} color={colors.text} weight="medium" />
          </Pressable>
        ) : null}
        {onOpenSleepTimer ? (
          <Pressable
            onPress={onOpenSleepTimer}
            accessibilityRole="button"
            accessibilityLabel={sleepTimerActive ? 'Sleep timer active' : 'Set sleep timer'}
            hitSlop={8}
            style={({ pressed }) => [
              styles.headerButton,
              sleepTimerActive ? styles.headerButtonPill : null,
              {
                height: HEADER_BUTTON_SIZE,
                width: sleepTimerActive ? undefined : HEADER_BUTTON_SIZE,
                borderRadius: HEADER_BUTTON_SIZE / 2,
                backgroundColor: sleepTimerActive ? colors.accent : colors.bgElevated,
                opacity: pressed ? 0.7 : 1,
                paddingHorizontal: sleepTimerActive ? spacing.sm : 0,
                gap: 4
              }
            ]}
          >
            <IconSymbol
              name="moon.zzz"
              size={18}
              color={sleepTimerActive ? colors.accentText : colors.text}
              weight="medium"
            />
            {sleepTimerActive && sleepTimerRemainingSec != null ? (
              <Text
                style={{
                  color: colors.accentText,
                  fontSize: fontSize.caption,
                  fontWeight: fontWeight.semibold
                }}
                numberOfLines={1}
              >
                {formatDuration(sleepTimerRemainingSec)}
              </Text>
            ) : null}
          </Pressable>
        ) : null}
        {canToggleViewMode && viewMode && onToggleViewMode ? (
          <Pressable
            onPress={onToggleViewMode}
            accessibilityRole="button"
            accessibilityLabel={
              viewMode === 'reflowed' ? 'Switch to original view' : 'Switch to reflowed view'
            }
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
            <IconSymbol
              name={viewMode === 'reflowed' ? 'doc.text' : 'text.alignleft'}
              size={18}
              color={colors.text}
              weight="medium"
            />
          </Pressable>
        ) : null}
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
    </View>
  );
}

/**
 * Original-view body. OCR layout is produced during book processing
 * (alongside VLM analysis) and cached on disk; this component just reads
 * the cache and renders the current page. Pages still being processed
 * show a loading state; books processed before this feature shipped show
 * an "unavailable for this book" message.
 */
function OriginalViewBody({
  book,
  blocks,
  currentIndex,
  bottomInset,
  onBlockTap,
  onSwipePrev,
  onSwipeNext,
  canSwipePrev,
  canSwipeNext
}: {
  book: Book;
  blocks: Book['blocks'];
  currentIndex: number;
  bottomInset: number;
  onBlockTap: (vlmBlockIndex: number) => void;
  onSwipePrev?: () => void;
  onSwipeNext?: () => void;
  canSwipePrev?: boolean;
  canSwipeNext?: boolean;
}) {
  const { colors, fontSize, spacing } = useTheme();
  const safeIndex = blocks.length > 0 ? Math.min(Math.max(currentIndex, 0), blocks.length - 1) : 0;
  const currentPage = blocks[safeIndex]?.page ?? 1;

  const totalPages = useMemo(() => getKnownTotalPages(book, blocks), [book, blocks]);

  const { ocr, unsupported } = useOriginalView(book.id);

  if (unsupported) {
    return (
      <View style={[styles.processing, { padding: spacing.xl, gap: spacing.md }]}>
        <Text
          style={{
            color: colors.textMuted,
            fontSize: fontSize.body,
            textAlign: 'center'
          }}
        >
          Original view is only available for PDF books.
        </Text>
      </View>
    );
  }

  const ocrPage: OcrPage | undefined = ocr?.pages.find(p => p.pageIndex === currentPage);

  if (!ocrPage || ocrPage.blocks.length === 0) {
    const isProcessing = book.status === 'processing' || book.status === 'queued';
    return (
      <View style={[styles.processing, { padding: spacing.xl, gap: spacing.md }]}>
        <Text
          style={{
            color: colors.textMuted,
            fontSize: fontSize.body,
            textAlign: 'center'
          }}
        >
          {isProcessing
            ? `Page ${currentPage} layout is still being processed…`
            : 'Original view is unavailable for this book. Reimport it to enable overlays.'}
        </Text>
      </View>
    );
  }

  return (
    <OriginalView
      bookId={book.id}
      blocks={blocks}
      currentIndex={currentIndex}
      totalPages={totalPages}
      ocrPage={ocrPage}
      bottomInset={bottomInset}
      onBlockTap={onBlockTap}
      onSwipePrev={onSwipePrev}
      onSwipeNext={onSwipeNext}
      canSwipePrev={canSwipePrev}
      canSwipeNext={canSwipeNext}
    />
  );
}

function PageLoadingBody({
  page,
  totalPages,
  progress
}: {
  page: number;
  totalPages: number;
  progress?: Book['processingProgress'];
}) {
  const { colors, spacing, fontSize, fontWeight } = useTheme();
  const stage = progress?.stage ?? 'analyzing';
  const done = progress?.done ?? 0;
  const total = progress?.total ?? totalPages;
  const progressLabel = total > 0 ? `${done} / ${total}` : 'starting';
  const active = stage !== 'done' && (total <= 0 || done < total);
  const detail =
    stage === 'rendering'
      ? `Pages rendered: ${progressLabel}. Waiting for page ${page}.`
      : `Pages ready: ${progressLabel}. Waiting for page ${page} to finish.`;

  return (
    <View style={[styles.processing, { padding: spacing.xl, gap: spacing.md }]}>
      {active ? <ActivityIndicator size="large" color={colors.accent} /> : null}
      <Text
        style={{
          color: colors.text,
          fontSize: fontSize.h2,
          fontWeight: fontWeight.semibold,
          textAlign: 'center'
        }}
      >
        Page {page} of {totalPages || '?'}
      </Text>
      <Text
        style={{
          color: colors.textMuted,
          fontSize: fontSize.body,
          textAlign: 'center',
          lineHeight: fontSize.body * 1.4
        }}
      >
        {active ? detail : 'This page has not been loaded yet.'}
      </Text>
    </View>
  );
}

function PageNoContentBody({ page, totalPages }: { page: number; totalPages: number }) {
  const { colors, spacing, fontSize, fontWeight } = useTheme();

  return (
    <View style={[styles.processing, { padding: spacing.xl, gap: spacing.md }]}>
      <Text
        style={{
          color: colors.text,
          fontSize: fontSize.h2,
          fontWeight: fontWeight.semibold,
          textAlign: 'center'
        }}
      >
        Page {page} of {totalPages || '?'}
      </Text>
      <Text
        style={{
          color: colors.textMuted,
          fontSize: fontSize.body,
          textAlign: 'center',
          lineHeight: fontSize.body * 1.4
        }}
      >
        This page has been processed, but it has no readable narration blocks. Use Next to continue.
      </Text>
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
  headerButtonPill: { flexDirection: 'row' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { flex: 1, textAlign: 'center', marginHorizontal: 8 },
  body: { flex: 1 },
  list: { flex: 1, marginTop: 8 },
  processing: { flex: 1, alignItems: 'stretch', justifyContent: 'center' },
  fabWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center'
  },
  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8
  }
});
