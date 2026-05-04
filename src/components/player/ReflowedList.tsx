import { useCallback, useEffect, useRef } from 'react';
import { FlatList, type ListRenderItem, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/src/hooks/useTheme';
import type { Block } from '@/src/types/book';
import type { SkippingMode } from '@/src/types/settings';

import { BlockItem } from './BlockItem';

const VIEW_POSITION = 0.3;
/** Rough height-per-item used for the one-shot initial offset jump. */
const ESTIMATED_ITEM_HEIGHT = 110;

export type ReflowedListProps = {
  blocks: readonly Block[];
  currentIndex: number;
  skipping: SkippingMode;
  /** Index of the block that failed to synthesize, if any. */
  erroredIndex?: number;
  /** Tapping a block routes here. */
  onSelect: (index: number) => void;
  /** Tapping the errored-block "retry" hint routes here. */
  onRetry?: (index: number) => void;
  /** Extra bottom padding so the last items aren't hidden behind the controls overlay. */
  bottomInset: number;
  style?: StyleProp<ViewStyle>;
};

function isSkipped(block: Block, skipping: SkippingMode): boolean {
  if (skipping === 'none') return false;
  return !block.isMainContent;
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
  const listRef = useRef<FlatList<Block>>(null);
  /**
   * Whether we've already performed the one-shot "land near the saved
   * block" jump. Subsequent scrolls are smooth, in-window animations driven
   * by `currentIndex` changes. Without this gate, every streaming append
   * (which grows `blocks.length`) re-triggered the auto-scroll, producing
   * the visible judder when opening a book.
   */
  const initialJumpDoneRef = useRef(false);

  // Smooth in-session scroll: only after the initial jump is done, and only
  // when the current index changes (not when streaming appends new blocks).
  useEffect(() => {
    if (!initialJumpDoneRef.current) return;
    if (currentIndex < 0 || currentIndex >= blocks.length) return;
    const list = listRef.current;
    if (!list) return;
    const id = requestAnimationFrame(() => {
      try {
        list.scrollToIndex({ index: currentIndex, viewPosition: VIEW_POSITION, animated: true });
      } catch {
        // Silently ignore — the next currentIndex change will try again.
      }
    });
    return () => cancelAnimationFrame(id);
  }, [currentIndex, blocks.length]);

  // One-shot initial jump. As soon as `blocks` has enough entries to contain
  // the saved index, scroll there *without animation* so the user doesn't see
  // the list scrolling past every block on its way down.
  useEffect(() => {
    if (initialJumpDoneRef.current) return;
    if (currentIndex <= 0) {
      // No saved position past the top — nothing to jump to.
      initialJumpDoneRef.current = true;
      return;
    }
    if (blocks.length <= currentIndex) return;
    const list = listRef.current;
    if (!list) return;
    initialJumpDoneRef.current = true;
    // `scrollToOffset` with an estimated item height avoids the
    // scrollToIndex retry loop (and its visible mid-jumps) when items
    // haven't been measured yet.
    list.scrollToOffset({
      offset: Math.max(0, ESTIMATED_ITEM_HEIGHT * currentIndex),
      animated: false
    });
  }, [blocks.length, currentIndex]);

  const handleScrollToIndexFailed = useCallback(
    (info: { index: number; highestMeasuredFrameIndex: number; averageItemLength: number }) => {
      const list = listRef.current;
      if (!list) return;
      // Soft fallback: drop into the rough neighborhood without animation,
      // and don't retry — retry loops are what cause the flicker.
      list.scrollToOffset({
        offset: Math.max(0, info.averageItemLength * info.index),
        animated: false
      });
    },
    []
  );

  const renderItem = useCallback<ListRenderItem<Block>>(
    ({ item, index }) => (
      <BlockItem
        block={item}
        index={index}
        isCurrent={index === currentIndex}
        isSkipped={isSkipped(item, skipping)}
        isErrored={erroredIndex === index}
        onPress={onSelect}
        onRetry={onRetry}
      />
    ),
    [currentIndex, skipping, erroredIndex, onSelect, onRetry]
  );

  const keyExtractor = useCallback((b: Block) => b.id, []);

  return (
    <FlatList<Block>
      ref={listRef}
      data={blocks as Block[]}
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
      // Keep enough off-screen rows around the current one so scrollToIndex hits.
      initialNumToRender={20}
      windowSize={11}
      removeClippedSubviews={false}
    />
  );
}
