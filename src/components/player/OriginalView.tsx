/**
 * Original View: shows the rasterized PDF page with OCR block polygons
 * overlaid on top. The block currently being read is emphasized; blocks
 * that VLM skipped are dimmed; tapping any aligned block seeks audio to
 * that block.
 *
 * Navigation:
 *   - Horizontal swipe → previous / next page (only when not zoomed in).
 *   - Vertical scroll → moves through the current page when content
 *     overflows the viewport (also drives panning in two-axis when zoomed).
 *   - Floating zoom toolbar (bottom-right): −, reset (%), +.
 */

import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import { useTheme } from '@/src/hooks/useTheme';
import { paths } from '@/src/storage/paths';
import type { Block } from '@/src/types/book';
import type { OcrBlock, OcrPage } from '@/src/types/ocr';

export type OriginalViewProps = {
  bookId: string;
  blocks: readonly Block[];
  currentIndex: number;
  /** Total page count of the book (for the "Page N of M" label). */
  totalPages: number;
  /** OCR layout for the page currently being displayed. */
  ocrPage: OcrPage;
  bottomInset: number;
  /** Tap on an aligned OCR block jumps the audio engine to its VLM block. */
  onBlockTap: (vlmBlockIndex: number) => void;
  /** Swipe-right (or call) to move to the previous page (audio block boundary). */
  onSwipePrev?: () => void;
  /** Swipe-left (or call) to move to the next page. */
  onSwipeNext?: () => void;
  canSwipePrev?: boolean;
  canSwipeNext?: boolean;
};

type BlockStatus = 'past' | 'current' | 'future' | 'skipped';

type RenderedBlock = {
  ocr: OcrBlock;
  status: BlockStatus;
  vlmIndex?: number;
  block?: Block;
  /** 1-based reading order within the currently displayed page. */
  readingOrder?: number;
  /** Bbox in display pixels (already scaled by `pageScale`). */
  displayBbox: { left: number; top: number; width: number; height: number };
};

const HORIZONTAL_PADDING = 16;
const TOP_PADDING = 12;
const BOTTOM_EXTRA = 24;
/** Discrete zoom steps cycled by the +/- buttons. 1 = fit-to-width. */
const ZOOM_STEPS = [1, 1.5, 2, 2.75, 4] as const;
/** Min horizontal pixel travel to register a page swipe. */
const SWIPE_THRESHOLD_PX = 50;
const BASE_BADGE_SIZE = 18;

const BLOCK_TYPE_COLORS: Readonly<Record<Block['type'], string>> = {
  heading: '#7C3AED',
  paragraph: '#2563EB',
  list: '#059669',
  quote: '#D97706',
  caption: '#0891B2',
  figure: '#EA580C',
  'page-number': '#64748B',
  footnote: '#9333EA',
  'header-footer': '#64748B',
  toc: '#DB2777',
  service: '#6B7280',
  unknown: '#111827'
};

export function OriginalView({
  bookId,
  blocks,
  currentIndex,
  totalPages,
  ocrPage,
  bottomInset,
  onBlockTap,
  onSwipePrev,
  onSwipeNext,
  canSwipePrev = true,
  canSwipeNext = true
}: OriginalViewProps) {
  const { colors, fontSize, fontWeight, spacing } = useTheme();
  const { width: windowWidth } = useWindowDimensions();

  const safeIndex = blocks.length > 0 ? Math.min(Math.max(currentIndex, 0), blocks.length - 1) : -1;
  const pageNumber = ocrPage.pageIndex;

  // ----- Zoom -------------------------------------------------------------
  const [zoom, setZoom] = useState<number>(1);
  const handleZoomIn = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    setZoom(z => {
      const next = ZOOM_STEPS.find(s => s > z + 0.0001);
      return next ?? z;
    });
  }, []);
  const handleZoomOut = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    setZoom(z => {
      const lower = [...ZOOM_STEPS].reverse().find(s => s < z - 0.0001);
      return lower ?? z;
    });
  }, []);
  const handleZoomReset = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    setZoom(1);
  }, []);

  // Reset zoom on page change so each page starts fit-to-width.
  const lastPageForZoomRef = useRef(pageNumber);
  useEffect(() => {
    if (lastPageForZoomRef.current !== pageNumber) {
      lastPageForZoomRef.current = pageNumber;
      setZoom(1);
    }
  }, [pageNumber]);

  // Reverse-lookup: OCR block id → VLM block index. Built directly from
  // `Block.ocrBlockIds` produced by the VLM during processing.
  const ocrIdToVlmIndex = useMemo<Map<string, number>>(() => {
    const m = new Map<string, number>();
    for (let i = 0; i < blocks.length; i += 1) {
      const block = blocks[i];
      if ((block.page ?? 1) !== pageNumber) continue;
      if (!block.ocrBlockIds) continue;
      for (const id of block.ocrBlockIds) m.set(id, i);
    }
    return m;
  }, [blocks, pageNumber]);

  const pageOrderByVlmIndex = useMemo<Map<number, number>>(() => {
    const m = new Map<number, number>();
    let order = 1;
    for (let i = 0; i < blocks.length; i += 1) {
      const block = blocks[i];
      if ((block.page ?? 1) !== pageNumber) continue;
      m.set(i, order);
      order += 1;
    }
    return m;
  }, [blocks, pageNumber]);

  const baseContentWidth = windowWidth - HORIZONTAL_PADDING * 2;
  const basePageScale = ocrPage.width > 0 ? baseContentWidth / ocrPage.width : 1;
  const pageScale = basePageScale * zoom;
  const displayPageWidth = ocrPage.width * pageScale;
  const displayPageHeight = ocrPage.height * pageScale;

  // For each OCR block on the current page, compute its display bbox + status.
  const rendered = useMemo<RenderedBlock[]>(() => {
    const out: RenderedBlock[] = [];
    for (const ocrBlock of ocrPage.blocks) {
      const [x1, y1, x2, y2] = ocrBlock.bbox;
      const left = x1 * pageScale;
      const top = y1 * pageScale;
      const width = Math.max(0, (x2 - x1) * pageScale);
      const height = Math.max(0, (y2 - y1) * pageScale);
      const vlmIndex = ocrIdToVlmIndex.get(ocrBlock.id);
      const block = vlmIndex === undefined ? undefined : blocks[vlmIndex];
      let status: BlockStatus;
      if (vlmIndex === undefined) status = 'skipped';
      else if (vlmIndex === safeIndex) status = 'current';
      else if (vlmIndex < safeIndex) status = 'past';
      else status = 'future';
      out.push({
        ocr: ocrBlock,
        status,
        vlmIndex,
        block,
        readingOrder: vlmIndex === undefined ? undefined : pageOrderByVlmIndex.get(vlmIndex),
        displayBbox: { left, top, width, height }
      });
    }
    return out;
  }, [blocks, ocrPage, ocrIdToVlmIndex, pageOrderByVlmIndex, safeIndex, pageScale]);

  // Page PNG cached at processing time.
  const pageUri = useMemo(() => paths.bookPage(bookId, pageNumber), [bookId, pageNumber]);

  // Vertical scroll ref to keep current block in view.
  const scrollRef = useRef<ScrollView>(null);
  const lastScrolledForCurrent = useRef<string | undefined>(undefined);

  useEffect(() => {
    const current = rendered.find(b => b.status === 'current');
    if (!current) return;
    if (current.ocr.id === lastScrolledForCurrent.current) return;
    lastScrolledForCurrent.current = current.ocr.id;
    const targetY = Math.max(0, current.displayBbox.top - 80);
    scrollRef.current?.scrollTo({ y: targetY, animated: true });
  }, [rendered]);

  // Reset scroll on page change.
  const lastPageRef = useRef<number>(pageNumber);
  useEffect(() => {
    if (lastPageRef.current !== pageNumber) {
      lastPageRef.current = pageNumber;
      lastScrolledForCurrent.current = undefined;
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [pageNumber]);

  const handleBlockPress = useCallback(
    (rb: RenderedBlock) => {
      // Direct alignment — jump straight to the narration block.
      if (rb.vlmIndex !== undefined) {
        Haptics.selectionAsync().catch(() => {});
        onBlockTap(rb.vlmIndex);
        return;
      }
      // Skipped block (page number, decoration). Pick the closest aligned
      // block on the page by bbox-center distance so the tap still does
      // something useful — usually the user means "start narrating from
      // around here".
      const tapCx = rb.displayBbox.left + rb.displayBbox.width / 2;
      const tapCy = rb.displayBbox.top + rb.displayBbox.height / 2;
      let bestIdx = -1;
      let bestDist = Infinity;
      for (const other of rendered) {
        if (other.vlmIndex === undefined) continue;
        const cx = other.displayBbox.left + other.displayBbox.width / 2;
        const cy = other.displayBbox.top + other.displayBbox.height / 2;
        const dx = cx - tapCx;
        const dy = cy - tapCy;
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
          bestDist = d;
          bestIdx = other.vlmIndex;
        }
      }
      if (bestIdx < 0) return;
      Haptics.selectionAsync().catch(() => {});
      onBlockTap(bestIdx);
    },
    [onBlockTap, rendered]
  );

  // Horizontal-swipe page navigation. Only enabled at zoom = 1 so the user
  // can pan a zoomed page horizontally without flipping pages by accident.
  const handleSwipeLeft = useCallback(() => {
    if (canSwipeNext) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      onSwipeNext?.();
    }
  }, [canSwipeNext, onSwipeNext]);
  const handleSwipeRight = useCallback(() => {
    if (canSwipePrev) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      onSwipePrev?.();
    }
  }, [canSwipePrev, onSwipePrev]);

  const swipeGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(zoom <= 1.0001 && (!!onSwipePrev || !!onSwipeNext))
        .activeOffsetX([-30, 30])
        .failOffsetY([-20, 20])
        .onEnd(e => {
          'worklet';
          if (e.translationX < -SWIPE_THRESHOLD_PX) runOnJS(handleSwipeLeft)();
          else if (e.translationX > SWIPE_THRESHOLD_PX) runOnJS(handleSwipeRight)();
        }),
    [zoom, onSwipePrev, onSwipeNext, handleSwipeLeft, handleSwipeRight]
  );

  const isZoomed = zoom > 1.0001;
  const canZoomIn = zoom < ZOOM_STEPS[ZOOM_STEPS.length - 1] - 0.0001;
  const canZoomOut = zoom > 1.0001;

  return (
    <View style={styles.container}>
      <GestureDetector gesture={swipeGesture}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{
            paddingHorizontal: HORIZONTAL_PADDING,
            paddingTop: TOP_PADDING,
            paddingBottom: bottomInset + BOTTOM_EXTRA
          }}
          showsVerticalScrollIndicator={false}
        >
          <View
            style={[
              styles.pageHeader,
              {
                borderBottomColor: colors.border,
                paddingBottom: spacing.sm,
                marginBottom: spacing.sm
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
              Page {pageNumber}
              {totalPages > 0 ? ` of ${totalPages}` : ''} · Original
            </Text>
          </View>

          <ScrollView
            // Remount on page change. Keeps the horizontal scroll offset from
            // sticking to a stale value (e.g. user was zoomed in and panned
            // right; auto-advance to the next page resets zoom to 1, but the
            // SV's contentOffset would otherwise stay at 300px → blank
            // viewport until the next state change forces a relayout).
            key={pageNumber}
            horizontal
            scrollEnabled={isZoomed}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              alignItems: 'center',
              minWidth: '100%'
            }}
          >
            <View
              style={{
                width: displayPageWidth,
                height: displayPageHeight,
                backgroundColor: '#FFFFFF'
              }}
            >
              <Image
                source={{ uri: pageUri }}
                style={{ width: displayPageWidth, height: displayPageHeight }}
                resizeMode="contain"
              />
              {rendered.map(rb => (
                <BlockOverlay
                  key={rb.ocr.id}
                  rb={rb}
                  onPress={() => handleBlockPress(rb)}
                  paletteMuted={colors.textMuted}
                />
              ))}
            </View>
          </ScrollView>
        </ScrollView>
      </GestureDetector>

      <View
        style={[
          styles.zoomToolbar,
          {
            backgroundColor: colors.bgElevated,
            borderColor: colors.border
          }
        ]}
        pointerEvents="box-none"
      >
        <ZoomButton
          label="−"
          onPress={handleZoomOut}
          disabled={!canZoomOut}
          color={colors.text}
          mutedColor={colors.textMuted}
        />
        <Pressable
          onPress={handleZoomReset}
          disabled={!isZoomed}
          accessibilityRole="button"
          accessibilityLabel="Reset zoom"
          hitSlop={6}
          style={({ pressed }) => [
            styles.zoomLabel,
            {
              opacity: !isZoomed ? 0.5 : pressed ? 0.6 : 1
            }
          ]}
        >
          <Text
            style={{
              color: colors.textMuted,
              fontSize: fontSize.caption,
              fontWeight: fontWeight.semibold,
              minWidth: 36,
              textAlign: 'center'
            }}
          >
            {Math.round(zoom * 100)}%
          </Text>
        </Pressable>
        <ZoomButton
          label="+"
          onPress={handleZoomIn}
          disabled={!canZoomIn}
          color={colors.text}
          mutedColor={colors.textMuted}
        />
      </View>
    </View>
  );
}

function ZoomButton({
  label,
  onPress,
  disabled,
  color,
  mutedColor
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  color: string;
  mutedColor: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label === '+' ? 'Zoom in' : 'Zoom out'}
      hitSlop={8}
      style={({ pressed }) => [
        styles.zoomButton,
        {
          opacity: disabled ? 0.3 : pressed ? 0.6 : 1
        }
      ]}
    >
      <Text
        style={{
          color: disabled ? mutedColor : color,
          fontSize: 22,
          fontWeight: '600',
          lineHeight: 24
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

type BlockOverlayProps = {
  rb: RenderedBlock;
  onPress: () => void;
  paletteMuted: string;
};

function BlockOverlay({ rb, onPress, paletteMuted }: BlockOverlayProps) {
  const { left, top, width, height } = rb.displayBbox;
  const aligned = rb.vlmIndex !== undefined;
  const typeColor = rb.block ? BLOCK_TYPE_COLORS[rb.block.type] : paletteMuted;
  const [, y1, , y2] = rb.ocr.bbox;
  const badgeScale = Math.max(0.8, Math.min(4, height / Math.max(1, y2 - y1)));
  const badgeSize = BASE_BADGE_SIZE * badgeScale;

  let backgroundColor: string;
  let borderColor: string;
  let borderWidth: number;
  let borderStyle: 'solid' | 'dashed' = 'solid';

  switch (rb.status) {
    case 'current':
      backgroundColor = withAlpha(typeColor, 0.34);
      borderColor = typeColor;
      borderWidth = 2;
      break;
    case 'past':
      backgroundColor = withAlpha(typeColor, 0.16);
      borderColor = withAlpha(typeColor, 0.7);
      borderWidth = 1;
      break;
    case 'future':
      backgroundColor = withAlpha(typeColor, 0.1);
      borderColor = withAlpha(typeColor, 0.62);
      borderWidth = 1;
      break;
    case 'skipped':
      backgroundColor = withAlpha(paletteMuted, 0.06);
      borderColor = withAlpha(paletteMuted, 0.55);
      borderWidth = 1;
      borderStyle = 'dashed';
      break;
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        aligned
          ? `Jump to ${rb.ocr.label} block`
          : `${rb.ocr.label} block (skipped) — tap jumps to nearest narration block`
      }
      style={({ pressed }) => [
        {
          position: 'absolute',
          left,
          top,
          width,
          height,
          backgroundColor,
          borderColor,
          borderWidth,
          borderStyle,
          borderRadius: 2,
          opacity: pressed ? 0.65 : 1
        }
      ]}
    >
      {rb.readingOrder != null ? (
        <View
          pointerEvents="none"
          style={[
            styles.orderBadge,
            {
              minWidth: badgeSize,
              height: badgeSize,
              borderBottomRightRadius: 6 * badgeScale,
              paddingHorizontal: 4 * badgeScale,
              backgroundColor: typeColor
            }
          ]}
        >
          <Text
            style={[
              styles.orderBadgeText,
              {
                fontSize: 10 * badgeScale,
                lineHeight: 12 * badgeScale
              }
            ]}
          >
            {rb.readingOrder}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

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
  zoomToolbar: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2
  },
  zoomButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center'
  },
  zoomLabel: {
    paddingHorizontal: 6,
    paddingVertical: 8
  },
  orderBadge: {
    position: 'absolute',
    left: -1,
    top: -1,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopLeftRadius: 2
  },
  orderBadgeText: {
    color: '#FFFFFF',
    fontWeight: '800'
  }
});
