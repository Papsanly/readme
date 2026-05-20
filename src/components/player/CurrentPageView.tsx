import * as Haptics from 'expo-haptics';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type TextStyle
} from 'react-native';

import { useTheme } from '@/src/hooks/useTheme';
import type { Block } from '@/src/types/book';

export type CurrentPageViewProps = {
  blocks: readonly Block[];
  currentIndex: number;
  /** Bottom padding so the bottom of the page text isn't hidden behind controls. */
  bottomInset: number;
  /** Total page count known from PDF processing, even if later pages are not loaded yet. */
  totalPages?: number;
  /** Optional error text — when present, the view shows a retry hint at the bottom. */
  errorMessage?: string;
  /** Tap handler for the retry hint. */
  onRetry?: () => void;
  /** Tap on a block jumps audio to that block's start. */
  onBlockTap: (blockIndex: number) => void;
};

/**
 * Displays exactly one page at a time — the page that the audio engine is
 * currently reading. As the engine crosses a page boundary, the body
 * swaps to the next page automatically.
 *
 * Each block on the page is its own `Pressable` with onLayout-tracked
 * y-position. On `currentIndex` change we auto-scroll the current block
 * into view and highlight it with an accent background. Tapping a block
 * jumps audio to the block's start.
 */
export function CurrentPageView({
  blocks,
  currentIndex,
  bottomInset,
  totalPages: knownTotalPages,
  errorMessage,
  onRetry,
  onBlockTap
}: CurrentPageViewProps) {
  const { colors, spacing, fontSize, fontWeight, radius } = useTheme();

  const safeIndex = blocks.length > 0 ? Math.min(Math.max(currentIndex, 0), blocks.length - 1) : -1;
  const pageNumber = safeIndex >= 0 ? (blocks[safeIndex]?.page ?? 1) : 0;
  const loadedPageCount = useMemo(() => {
    if (blocks.length === 0) return 0;
    const all = new Set<number>();
    for (const b of blocks) all.add(b.page ?? 1);
    return all.size;
  }, [blocks]);
  const totalPages = Math.max(knownTotalPages ?? 0, loadedPageCount);

  // Blocks on this page only — recomputed on page change.
  const pageBlocks = useMemo(() => {
    if (pageNumber === 0) return [] as Block[];
    return blocks.filter(b => (b.page ?? 1) === pageNumber);
  }, [blocks, pageNumber]);

  // ScrollView ref + per-block y tracking for auto-scroll.
  const scrollRef = useRef<ScrollView>(null);
  const blockYRef = useRef<Map<number, number>>(new Map());

  const setBlockY = useCallback((blockIndex: number, y: number) => {
    blockYRef.current.set(blockIndex, y);
  }, []);

  // Reset scroll & layout map on page change.
  useEffect(() => {
    blockYRef.current.clear();
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [pageNumber]);

  // Scroll the current block into the upper portion of the viewport when
  // the audio engine crosses a block boundary.
  const lastScrolledIndexRef = useRef<number>(-1);
  useEffect(() => {
    if (safeIndex < 0) return;
    if (lastScrolledIndexRef.current === safeIndex) return;
    // Defer one tick so onLayout from any newly-rendered block has run.
    const id = setTimeout(() => {
      const y = blockYRef.current.get(safeIndex);
      if (y === undefined) return;
      lastScrolledIndexRef.current = safeIndex;
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 64), animated: true });
    }, 16);
    return () => clearTimeout(id);
  }, [safeIndex, pageBlocks]);

  // Stable handler so memoized BlockSpan doesn't re-render when parent does.
  const onBlockTapRef = useRef(onBlockTap);
  onBlockTapRef.current = onBlockTap;
  const handleBlockTap = useCallback((blockIndex: number) => {
    Haptics.selectionAsync().catch(() => {});
    onBlockTapRef.current(blockIndex);
  }, []);

  if (totalPages === 0) return null;

  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={{
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.lg,
        paddingBottom: bottomInset + spacing.lg,
        gap: spacing.sm
      }}
      showsVerticalScrollIndicator={false}
    >
      <View
        style={[
          styles.pageHeader,
          {
            borderBottomColor: colors.border,
            paddingBottom: spacing.sm,
            marginBottom: spacing.xs
          }
        ]}
      >
        <Text
          style={{
            color: colors.textMuted,
            fontSize: fontSize.caption,
            fontWeight: fontWeight.medium,
            letterSpacing: 0.5,
            textTransform: 'uppercase'
          }}
        >
          Page {pageNumber} of {totalPages}
        </Text>
      </View>

      {pageBlocks.map(block => (
        <BlockSpan
          key={block.id}
          block={block}
          isCurrent={block.index === safeIndex}
          textColor={colors.text}
          accentColor={colors.accent}
          fontSize={fontSize.bodyLg}
          fontWeight={fontWeight.regular}
          radius={radius.sm}
          paddingH={spacing.sm}
          paddingV={spacing.xs}
          onTap={handleBlockTap}
          setBlockY={setBlockY}
        />
      ))}

      {errorMessage ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry current page"
          style={({ pressed }) => [
            styles.errorBox,
            {
              backgroundColor: colors.bgElevated,
              borderColor: colors.danger,
              borderRadius: radius.md,
              padding: spacing.md,
              opacity: pressed ? 0.8 : 1
            }
          ]}
        >
          <Text
            style={{
              color: colors.danger,
              fontSize: fontSize.caption,
              fontWeight: fontWeight.medium
            }}
            numberOfLines={3}
          >
            {errorMessage}
          </Text>
          <Text
            style={{
              color: colors.danger,
              fontSize: fontSize.caption,
              fontWeight: fontWeight.semibold,
              marginTop: 4
            }}
          >
            Tap to retry
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

type BlockSpanProps = {
  block: Block;
  isCurrent: boolean;
  textColor: string;
  accentColor: string;
  fontSize: number;
  fontWeight: TextStyle['fontWeight'];
  radius: number;
  paddingH: number;
  paddingV: number;
  onTap: (blockIndex: number) => void;
  setBlockY: (blockIndex: number, y: number) => void;
};

const BlockSpan = memo(function BlockSpan({
  block,
  isCurrent,
  textColor,
  accentColor,
  fontSize: fs,
  fontWeight: fw,
  radius,
  paddingH,
  paddingV,
  onTap,
  setBlockY
}: BlockSpanProps) {
  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => {
      setBlockY(block.index, e.nativeEvent.layout.y);
    },
    [block.index, setBlockY]
  );

  const handlePress = useCallback(() => {
    onTap(block.index);
  }, [block.index, onTap]);

  return (
    <Pressable
      onPress={handlePress}
      onLayout={handleLayout}
      accessibilityRole="button"
      accessibilityLabel={`Block ${block.index + 1}: ${block.text.slice(0, 80)}`}
      style={({ pressed }) => [
        {
          backgroundColor: isCurrent ? withAlpha(accentColor, 0.18) : 'transparent',
          borderRadius: radius,
          paddingHorizontal: paddingH,
          paddingVertical: paddingV,
          opacity: pressed ? 0.65 : 1
        }
      ]}
    >
      <Text
        style={{
          color: textColor,
          fontSize: fs,
          fontWeight: fw,
          lineHeight: fs * 1.5
        }}
      >
        {block.text}
      </Text>
    </Pressable>
  );
});

/** Overlay an alpha onto a hex color (`#RRGGBB` or `#RGB`); returns rgba string. */
function withAlpha(color: string, alpha: number): string {
  const m6 = /^#?([\da-fA-F]{6})$/.exec(color);
  if (m6) {
    const n = parseInt(m6[1], 16);
    const r = (n >> 16) & 0xff;
    const g = (n >> 8) & 0xff;
    const b = n & 0xff;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const m3 = /^#?([\da-fA-F]{3})$/.exec(color);
  if (m3) {
    const r = parseInt(m3[1][0] + m3[1][0], 16);
    const g = parseInt(m3[1][1] + m3[1][1], 16);
    const b = parseInt(m3[1][2] + m3[1][2], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

const styles = StyleSheet.create({
  pageHeader: { borderBottomWidth: StyleSheet.hairlineWidth },
  errorBox: { borderWidth: 1 }
});
