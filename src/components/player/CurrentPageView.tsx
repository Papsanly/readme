import * as Haptics from 'expo-haptics';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type TextStyle
} from 'react-native';

import { useTheme } from '@/src/hooks/useTheme';
import { paths } from '@/src/storage/paths';
import type { Block } from '@/src/types/book';
import type { OcrBlock, OcrPage } from '@/src/types/ocr';
import type { SkippingMode } from '@/src/types/settings';

const TEXT_SCALE_STEPS = [0.85, 1, 1.15, 1.3, 1.5, 1.75] as const;
const MAX_FIGURE_HEIGHT_RATIO = 0.75;
const SERVICE_SKIP_TYPES: ReadonlySet<Block['type']> = new Set([
  'page-number',
  'header-footer',
  'footnote',
  'toc',
  'service'
]);

type FigureCrop = {
  pageUri: string;
  frameWidth: number;
  frameHeight: number;
  imageWidth: number;
  imageHeight: number;
  imageLeft: number;
  imageTop: number;
};

export type CurrentPageViewProps = {
  bookId: string;
  blocks: readonly Block[];
  currentIndex: number;
  /** Bottom padding so the bottom of the page text isn't hidden behind controls. */
  bottomInset: number;
  /** Total page count known from PDF processing, even if later pages are not loaded yet. */
  totalPages?: number;
  /** Reading skip mode; skipped blocks stay visible but are visually dimmed. */
  skipping: SkippingMode;
  /** OCR layout pages used to crop figure regions from the rendered PDF page. */
  ocrPages?: readonly OcrPage[];
  /** Optional error text — when present, the view shows a retry hint at the bottom. */
  errorMessage?: string;
  /** Tap handler for the retry hint. */
  onRetry?: () => void;
  /** Tap on a block jumps audio to that block's start. */
  onBlockTap: (blockIndex: number) => void;
  /** Long-press on a text block starts the add-pronunciation flow. */
  onAddPronunciation?: (sourceText: string) => void;
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
  bookId,
  blocks,
  currentIndex,
  bottomInset,
  totalPages: knownTotalPages,
  skipping,
  ocrPages,
  errorMessage,
  onRetry,
  onBlockTap,
  onAddPronunciation
}: CurrentPageViewProps) {
  const { colors, spacing, fontSize, fontWeight, radius } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const [textScale, setTextScale] = useState<number>(1);

  const safeIndex = blocks.length > 0 ? Math.min(Math.max(currentIndex, 0), blocks.length - 1) : -1;
  const pageNumber = safeIndex >= 0 ? (blocks[safeIndex]?.page ?? 1) : 0;
  const loadedPageCount = useMemo(() => {
    if (blocks.length === 0) return 0;
    const all = new Set<number>();
    for (const b of blocks) all.add(b.page ?? 1);
    return all.size;
  }, [blocks]);
  const totalPages = Math.max(knownTotalPages ?? 0, loadedPageCount);
  const scaledBodyFontSize = fontSize.bodyLg * textScale;
  const textScalePercent = Math.round(textScale * 100);
  const contentWidth = Math.max(180, windowWidth - spacing.lg * 2);
  const figureWidth = Math.max(160, contentWidth - 24 - spacing.sm * 2);

  // Blocks on this page only — recomputed on page change.
  const pageBlocks = useMemo(() => {
    if (pageNumber === 0) return [] as Block[];
    return blocks.filter(b => (b.page ?? 1) === pageNumber);
  }, [blocks, pageNumber]);

  const figureCropsByBlockIndex = useMemo(() => {
    const crops = new Map<number, FigureCrop>();
    for (const block of pageBlocks) {
      if (block.type !== 'figure') continue;
      const crop = buildFigureCrop(bookId, block, ocrPages, figureWidth);
      if (crop) crops.set(block.index, crop);
    }
    return crops;
  }, [bookId, figureWidth, ocrPages, pageBlocks]);

  // ScrollView ref + per-block y tracking for auto-scroll.
  const scrollRef = useRef<ScrollView>(null);
  const blockYRef = useRef<Map<number, number>>(new Map());

  const setBlockY = useCallback((blockIndex: number, y: number) => {
    blockYRef.current.set(blockIndex, y);
  }, []);

  const handleTextSizeIncrease = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    setTextScale(scale => TEXT_SCALE_STEPS.find(step => step > scale + 0.0001) ?? scale);
  }, []);

  const handleTextSizeDecrease = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    setTextScale(
      scale => [...TEXT_SCALE_STEPS].reverse().find(step => step < scale - 0.0001) ?? scale
    );
  }, []);

  const handleTextSizeReset = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    setTextScale(1);
  }, []);

  // Reset scroll & layout map on page change.
  useEffect(() => {
    blockYRef.current.clear();
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [pageNumber]);

  // Text-size changes alter block layout, so cached y-offsets need to be rebuilt.
  useEffect(() => {
    blockYRef.current.clear();
    lastScrolledIndexRef.current = -1;
  }, [textScale]);

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

  const onAddPronunciationRef = useRef(onAddPronunciation);
  onAddPronunciationRef.current = onAddPronunciation;
  const handleAddPronunciation = useCallback((sourceText: string) => {
    if (!onAddPronunciationRef.current) return;
    Haptics.selectionAsync().catch(() => {});
    onAddPronunciationRef.current(sourceText);
  }, []);

  if (totalPages === 0) return null;

  const canDecreaseTextSize = textScale > TEXT_SCALE_STEPS[0] + 0.0001;
  const canIncreaseTextSize = textScale < TEXT_SCALE_STEPS[TEXT_SCALE_STEPS.length - 1] - 0.0001;

  return (
    <View style={styles.container}>
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

        {pageBlocks.map(block => {
          const isCurrent = block.index === safeIndex;
          return (
            <BlockSpan
              key={block.id}
              block={block}
              isCurrent={isCurrent}
              isSkipped={!isCurrent && isSkippedForReading(block, skipping)}
              textColor={colors.text}
              accentColor={colors.accent}
              fontSize={scaledBodyFontSize}
              fontWeight={fontWeight.regular}
              captionFontSize={fontSize.caption}
              radius={radius.sm}
              cardRadius={radius.lg}
              paddingH={spacing.sm}
              paddingV={spacing.xs}
              figureCrop={figureCropsByBlockIndex.get(block.index)}
              mutedTextColor={colors.textMuted}
              cardBackgroundColor={colors.bgElevated}
              borderColor={colors.border}
              onTap={handleBlockTap}
              onLongPress={onAddPronunciation ? handleAddPronunciation : undefined}
              setBlockY={setBlockY}
            />
          );
        })}

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

      <TextSizeToolbar
        valueLabel={`${textScalePercent}%`}
        canDecrease={canDecreaseTextSize}
        canIncrease={canIncreaseTextSize}
        onDecrease={handleTextSizeDecrease}
        onIncrease={handleTextSizeIncrease}
        onReset={handleTextSizeReset}
      />
    </View>
  );
}

function TextSizeToolbar({
  valueLabel,
  canDecrease,
  canIncrease,
  onDecrease,
  onIncrease,
  onReset
}: {
  valueLabel: string;
  canDecrease: boolean;
  canIncrease: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
  onReset: () => void;
}) {
  const { colors, fontSize, fontWeight } = useTheme();
  return (
    <View
      style={[
        styles.textSizeToolbar,
        {
          backgroundColor: colors.bgElevated,
          borderColor: colors.border,
          paddingHorizontal: 4,
          paddingVertical: 4,
          gap: 2
        }
      ]}
    >
      <TextSizeButton label="−" onPress={onDecrease} disabled={!canDecrease} />
      <Pressable
        onPress={onReset}
        accessibilityRole="button"
        accessibilityLabel="Reset text size"
        hitSlop={6}
        style={({ pressed }) => [styles.textSizeLabel, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Text
          style={{
            color: colors.textMuted,
            fontSize: fontSize.caption,
            fontWeight: fontWeight.semibold,
            minWidth: 42,
            textAlign: 'center'
          }}
        >
          {valueLabel}
        </Text>
      </Pressable>
      <TextSizeButton label="+" onPress={onIncrease} disabled={!canIncrease} />
    </View>
  );
}

function TextSizeButton({
  label,
  onPress,
  disabled
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label === '+' ? 'Increase text size' : 'Decrease text size'}
      hitSlop={8}
      style={({ pressed }) => [
        styles.textSizeButton,
        { opacity: disabled ? 0.3 : pressed ? 0.6 : 1 }
      ]}
    >
      <Text
        style={{
          color: colors.text,
          fontSize: 22,
          fontWeight: '700',
          lineHeight: 24
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function buildFigureCrop(
  bookId: string,
  block: Block,
  ocrPages: readonly OcrPage[] | undefined,
  maxWidth: number
): FigureCrop | undefined {
  const pageNumber = block.page ?? 1;
  const ocrPage = ocrPages?.find(page => page.pageIndex === pageNumber);
  if (!ocrPage || !block.ocrBlockIds || block.ocrBlockIds.length === 0) return undefined;

  const idSet = new Set(block.ocrBlockIds);
  const aligned = ocrPage.blocks.filter(ocrBlock => idSet.has(ocrBlock.id));
  if (aligned.length === 0) return undefined;

  const visualBlocks = aligned.filter(isVisualOcrBlock);
  const cropBlocks = visualBlocks.length > 0 ? visualBlocks : aligned;
  const bbox = unionBbox(cropBlocks, ocrPage.width, ocrPage.height);
  if (!bbox) return undefined;

  const [x1, y1, x2, y2] = bbox;
  const cropWidth = Math.max(1, x2 - x1);
  const cropHeight = Math.max(1, y2 - y1);
  const maxHeight = Math.max(140, maxWidth * MAX_FIGURE_HEIGHT_RATIO);
  const frameWidth = maxWidth;
  const scale = Math.min(frameWidth / cropWidth, maxHeight / cropHeight);
  const frameHeight = cropHeight * scale;
  const horizontalInset = Math.max(0, (frameWidth - cropWidth * scale) / 2);

  return {
    pageUri: paths.bookPage(bookId, pageNumber),
    frameWidth,
    frameHeight,
    imageWidth: ocrPage.width * scale,
    imageHeight: ocrPage.height * scale,
    imageLeft: horizontalInset - x1 * scale,
    imageTop: -y1 * scale
  };
}

function isVisualOcrBlock(block: OcrBlock): boolean {
  const label = block.label.toLowerCase();
  return (
    label.includes('picture') ||
    label.includes('image') ||
    label.includes('figure') ||
    label.includes('diagram') ||
    label.includes('chart') ||
    label.includes('table')
  );
}

function unionBbox(
  blocks: readonly OcrBlock[],
  pageWidth: number,
  pageHeight: number
): [number, number, number, number] | undefined {
  if (blocks.length === 0) return undefined;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const block of blocks) {
    x1 = Math.min(x1, block.bbox[0]);
    y1 = Math.min(y1, block.bbox[1]);
    x2 = Math.max(x2, block.bbox[2]);
    y2 = Math.max(y2, block.bbox[3]);
  }
  const margin = 6;
  return [
    Math.max(0, x1 - margin),
    Math.max(0, y1 - margin),
    Math.min(pageWidth, x2 + margin),
    Math.min(pageHeight, y2 + margin)
  ];
}

function FigureBlock({
  block,
  crop,
  textColor,
  accentColor,
  backgroundColor,
  borderColor,
  fontSize: fs,
  captionFontSize,
  fontWeight,
  radius
}: {
  block: Block;
  crop?: FigureCrop;
  textColor: string;
  accentColor: string;
  backgroundColor: string;
  borderColor: string;
  fontSize: number;
  captionFontSize: number;
  fontWeight: TextStyle['fontWeight'];
  radius: number;
}) {
  const annotation = figureAnnotation(block);
  return (
    <View
      style={[
        styles.figureCard,
        {
          backgroundColor,
          borderColor,
          borderRadius: radius
        }
      ]}
    >
      {crop ? (
        <View
          style={[
            styles.figureImageFrame,
            {
              width: crop.frameWidth,
              height: crop.frameHeight,
              borderColor,
              borderRadius: 8
            }
          ]}
        >
          <Image
            source={{ uri: crop.pageUri }}
            resizeMode="contain"
            style={{
              position: 'absolute',
              left: crop.imageLeft,
              top: crop.imageTop,
              width: crop.imageWidth,
              height: crop.imageHeight
            }}
          />
        </View>
      ) : null}

      <View style={styles.figureAnnotationBlock}>
        <View style={[styles.figurePill, { backgroundColor: withAlpha(accentColor, 0.16) }]}>
          <Text
            style={{
              color: accentColor,
              fontSize: captionFontSize,
              fontWeight: '700'
            }}
          >
            Image
          </Text>
        </View>
        <Text
          style={{
            color: textColor,
            fontSize: Math.max(captionFontSize, fs * 0.82),
            fontWeight,
            lineHeight: Math.max(captionFontSize, fs * 0.82) * 1.4
          }}
        >
          {annotation}
        </Text>
      </View>
    </View>
  );
}

function figureAnnotation(block: Block): string {
  const text = block.text.trim();
  const caption = block.caption?.trim();
  if (text.length > 0) return text;
  if (caption && caption.length > 0) return caption;
  return 'Figure from the original page.';
}

function isSkippedForReading(block: Block, skipping: SkippingMode): boolean {
  if (skipping === 'none') return false;
  if (skipping === 'main-only') return !block.isMainContent;
  return SERVICE_SKIP_TYPES.has(block.type);
}

type BlockSpanProps = {
  block: Block;
  isCurrent: boolean;
  isSkipped: boolean;
  textColor: string;
  mutedTextColor: string;
  accentColor: string;
  cardBackgroundColor: string;
  borderColor: string;
  fontSize: number;
  captionFontSize: number;
  fontWeight: TextStyle['fontWeight'];
  radius: number;
  cardRadius: number;
  paddingH: number;
  paddingV: number;
  figureCrop?: FigureCrop;
  onTap: (blockIndex: number) => void;
  onLongPress?: (sourceText: string) => void;
  setBlockY: (blockIndex: number, y: number) => void;
};

const BlockSpan = memo(function BlockSpan({
  block,
  isCurrent,
  isSkipped,
  textColor,
  mutedTextColor,
  accentColor,
  cardBackgroundColor,
  borderColor,
  fontSize: fs,
  captionFontSize,
  fontWeight: fw,
  radius,
  cardRadius,
  paddingH,
  paddingV,
  figureCrop,
  onTap,
  onLongPress,
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

  const handleLongPress = useCallback(() => {
    onLongPress?.(block.rawText ?? block.text);
  }, [block.rawText, block.text, onLongPress]);

  const isFigure = block.type === 'figure';
  const displayTextColor = isSkipped ? mutedTextColor : textColor;

  return (
    <Pressable
      onPress={handlePress}
      onLongPress={handleLongPress}
      delayLongPress={350}
      onLayout={handleLayout}
      accessibilityRole="button"
      accessibilityLabel={`${isFigure ? 'Figure' : 'Block'} ${block.index + 1}: ${block.text.slice(0, 80)}`}
      accessibilityHint={onLongPress ? 'Long press to add a pronunciation override.' : undefined}
      style={({ pressed }) => [
        {
          backgroundColor: isCurrent ? withAlpha(accentColor, 0.18) : 'transparent',
          borderRadius: radius,
          paddingHorizontal: paddingH,
          paddingVertical: paddingV,
          opacity: pressed ? 0.65 : isSkipped ? 0.42 : 1
        }
      ]}
    >
      {isFigure ? (
        <FigureBlock
          block={block}
          crop={figureCrop}
          textColor={displayTextColor}
          accentColor={accentColor}
          backgroundColor={cardBackgroundColor}
          borderColor={borderColor}
          fontSize={fs}
          captionFontSize={captionFontSize}
          fontWeight={fw}
          radius={cardRadius}
        />
      ) : (
        <Text
          style={{
            color: displayTextColor,
            fontSize: fs,
            fontWeight: fw,
            lineHeight: fs * 1.5
          }}
        >
          {block.text}
        </Text>
      )}
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
  container: { flex: 1 },
  pageHeader: { borderBottomWidth: StyleSheet.hairlineWidth },
  errorBox: { borderWidth: 1 },
  figureCard: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 12
  },
  figureImageFrame: {
    alignSelf: 'center',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: '#FFFFFF'
  },
  figureAnnotationBlock: {
    alignItems: 'flex-start',
    gap: 8
  },
  figurePill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3
  },
  textSizeToolbar: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6
  },
  textSizeButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center'
  },
  textSizeLabel: {
    paddingHorizontal: 6,
    paddingVertical: 8
  }
});
