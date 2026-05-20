import { useMemo } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, IconSymbol } from '@/src/components/ui';
import { useTheme } from '@/src/hooks/useTheme';
import type { Block } from '@/src/types/book';
import type { OcrBlock, OcrPage } from '@/src/types/ocr';

export type OutlineSheetProps = {
  visible: boolean;
  blocks: readonly Block[];
  /** Optional OCR layout fallback; used to recover headings the VLM did not classify. */
  ocrPages?: readonly OcrPage[];
  /** Currently-playing block index (for the highlight). */
  currentIndex: number;
  onClose: () => void;
  /** Called with the target block index. The host should `setBlock` + play. */
  onSelect: (blockIndex: number) => void;
};

type OutlineEntry = {
  blockIndex: number;
  text: string;
  /** 0 — explicit TOC entry; 1 — heading depth 1; 2 — heading depth 2. */
  depth: 0 | 1 | 2;
  page?: number;
};

function normalizeOutlineText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function cleanOutlineText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function isOcrHeading(block: OcrBlock): boolean {
  const label = block.label.toLowerCase();
  const text = cleanOutlineText(block.text);
  if (text.length < 2) return false;
  if (/^by\b/i.test(text)) return false;
  if (/^next page\b/i.test(text)) return false;
  if (label.includes('pageheader') || label.includes('pagefooter')) return false;
  return label.includes('sectionheader') || label.includes('title') || label.includes('heading');
}

function firstBlockIndexOnPage(blocks: readonly Block[], page: number): number | null {
  for (let i = 0; i < blocks.length; i += 1) {
    if ((blocks[i]?.page ?? 1) === page) return i;
  }
  return null;
}

function blockTextMatchesOcrHeading(block: Block, headingText: string): boolean {
  const heading = normalizeOutlineText(headingText);
  if (heading.length === 0) return false;
  const blockText = normalizeOutlineText(block.rawText ?? block.text);
  return blockText === heading || blockText.includes(heading) || heading.includes(blockText);
}

function blockIndexForOcrHeading(
  blocks: readonly Block[],
  page: number,
  ocrBlock: OcrBlock
): number | null {
  const byOcrId = blocks.findIndex(block => block.ocrBlockIds?.includes(ocrBlock.id));
  if (byOcrId >= 0) return byOcrId;

  const byText = blocks.findIndex(
    block => (block.page ?? 1) === page && blockTextMatchesOcrHeading(block, ocrBlock.text)
  );
  if (byText >= 0) return byText;

  return firstBlockIndexOnPage(blocks, page);
}

function pushUniqueEntry(entries: OutlineEntry[], entry: OutlineEntry): void {
  const normalized = normalizeOutlineText(entry.text);
  if (normalized.length === 0) return;
  const duplicate = entries.some(
    existing => existing.page === entry.page && normalizeOutlineText(existing.text) === normalized
  );
  if (!duplicate) entries.push(entry);
}

function buildOutline(blocks: readonly Block[], ocrPages?: readonly OcrPage[]): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks[i];
    if (!b) continue;
    if (b.type === 'toc') {
      pushUniqueEntry(entries, { blockIndex: i, text: b.text, depth: 0, page: b.page });
      continue;
    }
    if (b.type === 'heading') {
      const depth: 1 | 2 = b.level === 2 ? 2 : 1;
      pushUniqueEntry(entries, { blockIndex: i, text: b.text, depth, page: b.page });
    }
  }

  for (const page of ocrPages ?? []) {
    for (const ocrBlock of page.blocks) {
      if (!isOcrHeading(ocrBlock)) continue;
      const blockIndex = blockIndexForOcrHeading(blocks, page.pageIndex, ocrBlock);
      if (blockIndex == null) continue;
      pushUniqueEntry(entries, {
        blockIndex,
        text: cleanOutlineText(ocrBlock.text),
        depth: 1,
        page: page.pageIndex
      });
    }
  }

  return entries.sort((a, b) => a.blockIndex - b.blockIndex || a.depth - b.depth);
}

export function OutlineSheet({
  visible,
  blocks,
  ocrPages,
  currentIndex,
  onClose,
  onSelect
}: OutlineSheetProps) {
  const { colors, radius, spacing, fontSize, fontWeight } = useTheme();

  const entries = useMemo(() => buildOutline(blocks, ocrPages), [blocks, ocrPages]);

  // Highlight the entry whose blockIndex is the largest one ≤ currentIndex.
  const activeEntryIndex = useMemo(() => {
    let best = -1;
    for (let i = 0; i < entries.length; i += 1) {
      if (entries[i].blockIndex <= currentIndex) best = i;
      else break;
    }
    return best;
  }, [entries, currentIndex]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        style={[styles.backdrop, { backgroundColor: colors.overlay }]}
        accessibilityRole="button"
        accessibilityLabel="Dismiss outline"
        onPress={onClose}
      />
      <SafeAreaView edges={['bottom']} style={styles.sheetAnchor}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.bg,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl
            }
          ]}
        >
          <View
            style={[
              styles.headerRow,
              {
                paddingHorizontal: spacing.lg,
                paddingTop: spacing.lg,
                paddingBottom: spacing.md
              }
            ]}
          >
            <Text
              style={{
                color: colors.text,
                fontSize: fontSize.title,
                fontWeight: fontWeight.semibold,
                flex: 1
              }}
            >
              Outline
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close outline"
              hitSlop={8}
              style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
            >
              <IconSymbol name="xmark" size={20} color={colors.textMuted} weight="medium" />
            </Pressable>
          </View>

          {entries.length === 0 ? (
            <View style={{ paddingVertical: spacing.xl }}>
              <EmptyState
                icon="tray"
                title="No outline"
                description="This book has no headings or table-of-contents entries."
              />
            </View>
          ) : (
            <FlatList
              data={entries}
              keyExtractor={item =>
                `${item.page ?? 'nopage'}-${item.blockIndex}-${item.depth}-${normalizeOutlineText(item.text)}`
              }
              contentContainerStyle={{
                paddingHorizontal: spacing.lg,
                paddingBottom: spacing.xl
              }}
              renderItem={({ item, index }) => {
                const active = index === activeEntryIndex;
                const indent = item.depth === 2 ? spacing.lg : item.depth === 1 ? 0 : 0;
                return (
                  <Pressable
                    onPress={() => onSelect(item.blockIndex)}
                    accessibilityRole="button"
                    accessibilityLabel={`Jump to ${item.text}`}
                    style={({ pressed }) => [
                      styles.row,
                      {
                        paddingVertical: spacing.sm,
                        paddingLeft: indent,
                        borderBottomColor: colors.border,
                        opacity: pressed ? 0.6 : 1,
                        gap: spacing.md
                      }
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        numberOfLines={2}
                        style={{
                          color: active ? colors.accent : colors.text,
                          fontSize: item.depth === 2 ? fontSize.body : fontSize.bodyLg,
                          fontWeight:
                            item.depth === 0
                              ? fontWeight.medium
                              : item.depth === 1
                                ? fontWeight.semibold
                                : fontWeight.regular
                        }}
                      >
                        {item.text}
                      </Text>
                    </View>
                    {item.page ? (
                      <Text
                        style={{
                          color: colors.textMuted,
                          fontSize: fontSize.caption
                        }}
                      >
                        p. {item.page}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              }}
              ItemSeparatorComponent={() => (
                <View
                  style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }}
                />
              )}
            />
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject },
  sheetAnchor: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: '20%'
  },
  sheet: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' }
});
