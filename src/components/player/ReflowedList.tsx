import { useCallback, useEffect, useMemo, useRef } from 'react';
import { FlatList, type ListRenderItem, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/src/hooks/useTheme';
import type { Block } from '@/src/types/book';
import type { SkippingMode } from '@/src/types/settings';

import { PageItem } from './PageItem';

const VIEW_POSITION = 0.3;
const ESTIMATED_PAGE_HEIGHT = 200;

export type ReflowedListProps = {
  blocks: readonly Block[];
  /** Index of the currently-playing block. The list derives the current page from it. */
  currentIndex: number;
  /** Skip mode — used to detect pages with zero playable blocks (visually dimmed). */
  skipping: SkippingMode;
  /** When the current block's audio synth failed, this is its index. */
  erroredIndex?: number;
  /** Called with the global block index of the page's first playable block. */
  onSelect: (firstBlockIndex: number) => void;
  /** Called when the user taps the failing current-page card. */
  onRetry?: () => void;
  /** Bottom padding so the last page card isn't hidden behind the controls overlay. */
  bottomInset: number;
  style?: StyleProp<ViewStyle>;
};

type PageGroup = {
  pageNumber: number;
  /** Combined narration text for the page. */
  combinedText: string;
  /** Global index of the first block on this page (any type). */
  firstBlockIndex: number;
  /** Global index of the first *playable* block (respects skip mode). */
  firstPlayableBlockIndex: number | null;
  hasAnyPlayable: boolean;
};

function isPlayableForGrouping(block: Block, skipping: SkippingMode): boolean {
  if (skipping === 'none') return true;
  if (skipping === 'main-only') return block.isMainContent;
  // 'service-only' — mirrors the playback rule in `useAudioEngine`.
  switch (block.type) {
    case 'page-number':
    case 'header-footer':
    case 'footnote':
    case 'toc':
    case 'service':
      return false;
    default:
      return true;
  }
}

function groupBlocksByPage(blocks: readonly Block[], skipping: SkippingMode): PageGroup[] {
  const groups = new Map<number, PageGroup>();
  blocks.forEach((b, i) => {
    const p = b.page ?? 1;
    const existing = groups.get(p);
    const playable = isPlayableForGrouping(b, skipping);
    if (!existing) {
      groups.set(p, {
        pageNumber: p,
        combinedText: b.text,
        firstBlockIndex: i,
        firstPlayableBlockIndex: playable ? i : null,
        hasAnyPlayable: playable
      });
    } else {
      existing.combinedText = existing.combinedText
        ? `${existing.combinedText}\n\n${b.text}`
        : b.text;
      if (playable) {
        existing.hasAnyPlayable = true;
        if (existing.firstPlayableBlockIndex == null) {
          existing.firstPlayableBlockIndex = i;
        }
      }
    }
  });
  return Array.from(groups.values()).sort((a, b) => a.pageNumber - b.pageNumber);
}

export function ReflowedList({
  blocks,
  currentIndex,
  skipping,
  erroredIndex,
  onSelect,
  onRetry,
  bottomInset,
  style
}: ReflowedListProps) {
  const { spacing } = useTheme();
  const listRef = useRef<FlatList<PageGroup>>(null);
  const initialJumpDoneRef = useRef(false);

  const pages = useMemo(() => groupBlocksByPage(blocks, skipping), [blocks, skipping]);

  const currentBlock =
    currentIndex >= 0 && currentIndex < blocks.length ? blocks[currentIndex] : undefined;
  const currentPageNumber = currentBlock?.page ?? 1;
  const currentPageIndex = pages.findIndex(p => p.pageNumber === currentPageNumber);
  const erroredBlock = erroredIndex != null ? blocks[erroredIndex] : undefined;
  const erroredPageNumber = erroredBlock?.page ?? null;

  // Smooth scroll when the *page* changes during playback. Uses
  // initialJumpDoneRef to skip the first render's animation (avoids the
  // judder we used to get when streaming appended new pages).
  useEffect(() => {
    if (!initialJumpDoneRef.current) return;
    if (currentPageIndex < 0) return;
    const list = listRef.current;
    if (!list) return;
    const id = requestAnimationFrame(() => {
      try {
        list.scrollToIndex({
          index: currentPageIndex,
          viewPosition: VIEW_POSITION,
          animated: true
        });
      } catch {
        // Will retry via the next page change.
      }
    });
    return () => cancelAnimationFrame(id);
  }, [currentPageIndex]);

  // One-shot initial jump (no animation, no retry loop).
  useEffect(() => {
    if (initialJumpDoneRef.current) return;
    if (currentPageIndex <= 0) {
      initialJumpDoneRef.current = true;
      return;
    }
    if (pages.length <= currentPageIndex) return;
    const list = listRef.current;
    if (!list) return;
    initialJumpDoneRef.current = true;
    list.scrollToOffset({
      offset: Math.max(0, ESTIMATED_PAGE_HEIGHT * currentPageIndex),
      animated: false
    });
  }, [currentPageIndex, pages.length]);

  const handleScrollToIndexFailed = useCallback(
    (info: { index: number; highestMeasuredFrameIndex: number; averageItemLength: number }) => {
      const list = listRef.current;
      if (!list) return;
      list.scrollToOffset({
        offset: Math.max(0, info.averageItemLength * info.index),
        animated: false
      });
    },
    []
  );

  const handlePagePress = useCallback(
    (pageNumber: number) => {
      const page = pages.find(p => p.pageNumber === pageNumber);
      if (!page) return;
      const target = page.firstPlayableBlockIndex ?? page.firstBlockIndex;
      if (target == null || target < 0) return;
      onSelect(target);
    },
    [pages, onSelect]
  );

  const handlePageRetry = useCallback(() => {
    onRetry?.();
  }, [onRetry]);

  const renderItem = useCallback<ListRenderItem<PageGroup>>(
    ({ item }) => (
      <PageItem
        pageNumber={item.pageNumber}
        text={item.combinedText}
        isCurrent={item.pageNumber === currentPageNumber}
        isSkipped={!item.hasAnyPlayable}
        isErrored={erroredPageNumber === item.pageNumber}
        onPress={handlePagePress}
        onRetry={handlePageRetry}
      />
    ),
    [currentPageNumber, erroredPageNumber, handlePagePress, handlePageRetry]
  );

  const keyExtractor = useCallback((p: PageGroup) => `page-${p.pageNumber}`, []);

  return (
    <FlatList<PageGroup>
      ref={listRef}
      data={pages}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      contentContainerStyle={{
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.md,
        paddingBottom: bottomInset + spacing.lg,
        gap: spacing.sm
      }}
      onScrollToIndexFailed={handleScrollToIndexFailed}
      showsVerticalScrollIndicator={false}
      style={style}
      initialNumToRender={8}
      windowSize={7}
      removeClippedSubviews={false}
    />
  );
}
