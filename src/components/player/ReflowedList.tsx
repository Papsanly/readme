import { useCallback, useEffect, useRef } from 'react';
import { FlatList, type ListRenderItem, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/src/hooks/useTheme';
import type { Block } from '@/src/types/book';
import type { SkippingMode } from '@/src/types/settings';

import { BlockItem } from './BlockItem';

const VIEW_POSITION = 0.3;
const SCROLL_RETRY_MS = 80;

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

  const scrollToCurrent = useCallback(
    (index: number, animated: boolean) => {
      const list = listRef.current;
      if (!list) return;
      if (index < 0 || index >= blocks.length) return;
      try {
        list.scrollToIndex({ index, viewPosition: VIEW_POSITION, animated });
      } catch (err) {
        // FlatList throws synchronously when the index isn't yet measured.
        // The `onScrollToIndexFailed` handler below will retry.
        console.warn('[player] scrollToIndex threw', err);
      }
    },
    [blocks.length]
  );

  // Auto-scroll when the current block changes (and on first mount once data is present).
  useEffect(() => {
    if (currentIndex < 0) return;
    if (blocks.length === 0) return;
    // Defer until after layout so item heights have been measured.
    const id = requestAnimationFrame(() => scrollToCurrent(currentIndex, true));
    return () => cancelAnimationFrame(id);
  }, [currentIndex, blocks.length, scrollToCurrent]);

  const handleScrollToIndexFailed = useCallback(
    (info: { index: number; highestMeasuredFrameIndex: number; averageItemLength: number }) => {
      const list = listRef.current;
      if (!list) return;
      // First, get into the neighborhood — then re-attempt the centered scroll.
      const offset = Math.max(0, info.averageItemLength * info.index);
      list.scrollToOffset({ offset, animated: false });
      setTimeout(() => scrollToCurrent(info.index, true), SCROLL_RETRY_MS);
    },
    [scrollToCurrent]
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
