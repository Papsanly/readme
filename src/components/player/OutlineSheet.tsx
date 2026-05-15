import { useMemo } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, IconSymbol } from '@/src/components/ui';
import { useTheme } from '@/src/hooks/useTheme';
import type { Block } from '@/src/types/book';

export type OutlineSheetProps = {
  visible: boolean;
  blocks: readonly Block[];
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

function buildOutline(blocks: readonly Block[]): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks[i];
    if (!b) continue;
    if (b.type === 'toc') {
      entries.push({ blockIndex: i, text: b.text, depth: 0, page: b.page });
      continue;
    }
    if (b.type === 'heading') {
      const depth: 1 | 2 = b.level === 2 ? 2 : 1;
      entries.push({ blockIndex: i, text: b.text, depth, page: b.page });
    }
  }
  return entries;
}

export function OutlineSheet({
  visible,
  blocks,
  currentIndex,
  onClose,
  onSelect
}: OutlineSheetProps) {
  const { colors, radius, spacing, fontSize, fontWeight } = useTheme();

  const entries = useMemo(() => buildOutline(blocks), [blocks]);

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
              keyExtractor={item => `${item.blockIndex}`}
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
