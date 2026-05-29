import { router, type Href } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItem
} from 'react-native';

import { BookCard, BookListEmpty } from '@/src/components/library';
import { MiniPlayer } from '@/src/components/player';
import { EmptyState, Screen } from '@/src/components/ui';
import { useTheme } from '@/src/hooks/useTheme';
import { cancelProcessing } from '@/src/pipeline/processor';
import { useLibraryStore } from '@/src/state/library';
import { usePlayerStore } from '@/src/state/player';
import { deleteBookFiles } from '@/src/storage/books';
import type { Book, BookStatus } from '@/src/types/book';

type LibraryFilter = 'all' | 'ready' | 'processing' | 'failed';
type LibrarySort = 'recent' | 'title' | 'progress' | 'status';

const FILTER_OPTIONS: readonly { value: LibraryFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'ready', label: 'Ready' },
  { value: 'processing', label: 'Processing' },
  { value: 'failed', label: 'Failed' }
];

const SORT_OPTIONS: readonly { value: LibrarySort; label: string; shortLabel: string }[] = [
  { value: 'recent', label: 'Recently added', shortLabel: 'Recent' },
  { value: 'title', label: 'Title A–Z', shortLabel: 'A–Z' },
  { value: 'progress', label: 'Progress', shortLabel: 'Progress' },
  { value: 'status', label: 'Status', shortLabel: 'Status' }
];

const STATUS_RANK: Record<BookStatus, number> = {
  ready: 0,
  processing: 1,
  queued: 2,
  failed: 3
};

export default function LibraryScreen() {
  const { colors, radius, spacing, fontSize, fontWeight } = useTheme();
  const books = useLibraryStore(s => s.books);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [sort, setSort] = useState<LibrarySort>('recent');
  const [sortOpen, setSortOpen] = useState(false);

  const allBooks = useMemo<Book[]>(() => Object.values(books), [books]);

  const visibleBooks = useMemo<Book[]>(() => {
    const needle = normalizeSearch(query);
    return allBooks
      .filter(book => matchesFilter(book, filter))
      .filter(book => matchesSearch(book, needle))
      .sort((a, b) => compareBooks(a, b, sort));
  }, [allBooks, filter, query, sort]);

  const selectedSortLabel =
    SORT_OPTIONS.find(option => option.value === sort)?.shortLabel ?? 'Sort';

  const goToUpload = useCallback(() => {
    router.push('/(tabs)/upload');
  }, []);

  const handleBookPress = useCallback((book: Book) => {
    // The `/player/[id]` route is added in Phase 4C; the typed-routes union
    // does not yet include it, so we cast through `Href`.
    router.push(`/player/${book.id}` as Href);
  }, []);

  const handleBookLongPress = useCallback((book: Book) => {
    showBookActions(book);
  }, []);

  const renderItem = useCallback<ListRenderItem<Book>>(
    ({ item }) => (
      <BookCard book={item} onPress={handleBookPress} onLongPress={handleBookLongPress} />
    ),
    [handleBookPress, handleBookLongPress]
  );

  const keyExtractor = useCallback((book: Book) => book.id, []);

  return (
    <Screen padded={false}>
      <View
        style={[
          styles.header,
          { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm }
        ]}
      >
        <Text
          style={{
            color: colors.text,
            fontSize: fontSize.h1,
            fontWeight: fontWeight.bold,
            flex: 1
          }}
        >
          Library
        </Text>
        {allBooks.length > 0 ? (
          <Pressable
            onPress={() => setSortOpen(open => !open)}
            accessibilityRole="button"
            accessibilityLabel="Sort library"
            style={({ pressed }) => [
              styles.sortButton,
              {
                backgroundColor: colors.bgElevated,
                borderColor: colors.border,
                borderRadius: radius.full,
                paddingHorizontal: spacing.md,
                opacity: pressed ? 0.7 : 1
              }
            ]}
          >
            <Text
              style={{
                color: colors.text,
                fontSize: fontSize.caption,
                fontWeight: fontWeight.semibold
              }}
              numberOfLines={1}
            >
              {selectedSortLabel} ▾
            </Text>
          </Pressable>
        ) : null}
      </View>

      {allBooks.length === 0 ? (
        <View style={styles.emptyWrap}>
          <BookListEmpty onAddBook={goToUpload} />
        </View>
      ) : (
        <>
          <View style={[styles.controls, { paddingHorizontal: spacing.lg, gap: spacing.sm }]}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search books..."
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              accessibilityLabel="Search books"
              style={[
                styles.searchInput,
                {
                  backgroundColor: colors.bgElevated,
                  borderColor: colors.border,
                  borderRadius: radius.md,
                  color: colors.text,
                  fontSize: fontSize.body,
                  paddingHorizontal: spacing.md
                }
              ]}
            />

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.filterRow, { gap: spacing.sm }]}
            >
              {FILTER_OPTIONS.map(option => (
                <FilterChip
                  key={option.value}
                  label={`${option.label} ${countForFilter(allBooks, option.value)}`}
                  active={filter === option.value}
                  onPress={() => setFilter(option.value)}
                />
              ))}
            </ScrollView>

            <Text style={{ color: colors.textMuted, fontSize: fontSize.caption }}>
              {visibleBooks.length} of {allBooks.length} books
            </Text>
          </View>

          {visibleBooks.length === 0 ? (
            <EmptyState
              icon="tray"
              title="No matches"
              description="Try changing the search query, filter, or sort order."
              style={styles.emptyWrap}
            />
          ) : (
            <FlatList
              data={visibleBooks}
              keyExtractor={keyExtractor}
              renderItem={renderItem}
              contentContainerStyle={{
                paddingHorizontal: spacing.lg,
                paddingTop: spacing.md,
                paddingBottom: spacing.lg,
                gap: spacing.md
              }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            />
          )}
        </>
      )}

      <MiniPlayer />

      {sortOpen && allBooks.length > 0 ? (
        <>
          <Pressable
            style={styles.sortBackdrop}
            accessibilityRole="button"
            accessibilityLabel="Close sort menu"
            onPress={() => setSortOpen(false)}
          />
          <View
            pointerEvents="box-none"
            style={[
              styles.sortDropdownLayer,
              {
                top: spacing.md + 40,
                right: spacing.lg
              }
            ]}
          >
            <SortDropdown
              value={sort}
              onChange={next => {
                setSort(next);
                setSortOpen(false);
              }}
            />
          </View>
        </>
      ) : null}
    </Screen>
  );
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function matchesSearch(book: Book, needle: string): boolean {
  if (!needle) return true;
  return `${book.title} ${book.source.name}`.toLowerCase().includes(needle);
}

function matchesFilter(book: Book, filter: LibraryFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'processing':
      return book.status === 'processing' || book.status === 'queued';
    default:
      return book.status === filter;
  }
}

function countForFilter(books: readonly Book[], filter: LibraryFilter): number {
  return books.filter(book => matchesFilter(book, filter)).length;
}

function compareBooks(a: Book, b: Book, sort: LibrarySort): number {
  switch (sort) {
    case 'title': {
      const byTitle = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
      return byTitle || b.createdAt - a.createdAt;
    }
    case 'progress': {
      const byProgress = bookProgressRatio(b) - bookProgressRatio(a);
      return byProgress || b.createdAt - a.createdAt;
    }
    case 'status': {
      const byStatus = STATUS_RANK[a.status] - STATUS_RANK[b.status];
      return byStatus || b.createdAt - a.createdAt;
    }
    case 'recent':
    default:
      return b.createdAt - a.createdAt;
  }
}

function bookProgressRatio(book: Book): number {
  const total = book.blocks.length;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, book.progress.blockIndex / total));
}

function SortDropdown({
  value,
  onChange
}: {
  value: LibrarySort;
  onChange: (value: LibrarySort) => void;
}) {
  const { colors, radius, spacing, fontSize, fontWeight } = useTheme();
  return (
    <View
      style={[
        styles.sortDropdown,
        {
          backgroundColor: colors.bgElevated,
          borderColor: colors.border,
          borderRadius: radius.lg
        }
      ]}
    >
      {SORT_OPTIONS.map((option, index) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [
              styles.sortDropdownItem,
              {
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                borderTopColor: colors.border,
                borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                opacity: pressed ? 0.65 : 1
              }
            ]}
          >
            <Text
              style={{
                color: active ? colors.accent : colors.text,
                fontSize: fontSize.body,
                fontWeight: active ? fontWeight.semibold : fontWeight.medium,
                flex: 1
              }}
            >
              {option.label}
            </Text>
            {active ? (
              <Text
                style={{
                  color: colors.accent,
                  fontSize: fontSize.body,
                  fontWeight: fontWeight.bold
                }}
              >
                ✓
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function FilterChip({
  label,
  active,
  onPress
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors, radius, spacing, fontSize, fontWeight } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.filterChip,
        {
          backgroundColor: active ? colors.accent : colors.bgElevated,
          borderColor: active ? colors.accent : colors.border,
          borderRadius: radius.full,
          paddingHorizontal: spacing.md,
          opacity: pressed ? 0.75 : 1
        }
      ]}
    >
      <Text
        style={{
          color: active ? colors.accentText : colors.text,
          fontSize: fontSize.caption,
          fontWeight: active ? fontWeight.semibold : fontWeight.medium
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function showBookActions(book: Book) {
  Alert.alert(book.title, undefined, [
    {
      text: 'Rename',
      onPress: () => promptRename(book)
    },
    {
      text: 'Delete',
      style: 'destructive',
      onPress: () => confirmDelete(book)
    },
    { text: 'Cancel', style: 'cancel' }
  ]);
}

function promptRename(book: Book) {
  if (Platform.OS !== 'ios') {
    Alert.alert('Rename not supported', 'Renaming books is only available on iOS in this MVP.', [
      { text: 'OK', style: 'cancel' }
    ]);
    return;
  }
  Alert.prompt(
    'Rename book',
    undefined,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Save',
        onPress: (value?: string) => applyRename(book.id, value)
      }
    ],
    'plain-text',
    book.title
  );
}

function applyRename(bookId: string, value: string | undefined) {
  const next = value?.trim();
  if (!next) return;
  useLibraryStore.getState().updateBook(bookId, { title: next });
}

function confirmDelete(book: Book) {
  Alert.alert(
    'Delete book?',
    `"${book.title}" will be removed from your library. This cannot be undone.`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void performDelete(book.id);
        }
      }
    ]
  );
}

async function performDelete(bookId: string): Promise<void> {
  try {
    cancelProcessing(bookId);
  } catch (err) {
    console.warn(`Failed to cancel processing for ${bookId}`, err);
  }

  useLibraryStore.getState().removeBook(bookId);

  if (usePlayerStore.getState().currentBookId === bookId) {
    usePlayerStore.getState().clear();
  }

  try {
    await deleteBookFiles(bookId);
  } catch (err) {
    console.warn(`Failed to delete files for ${bookId}`, err);
  }
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sortButton: {
    minHeight: 32,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 128
  },
  sortBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20
  },
  sortDropdownLayer: {
    position: 'absolute',
    zIndex: 21,
    elevation: 12
  },
  sortDropdown: {
    width: 184,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden'
  },
  sortDropdownItem: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center'
  },
  controls: { width: '100%' },
  searchInput: {
    height: 44,
    borderWidth: StyleSheet.hairlineWidth
  },
  filterRow: { paddingRight: 16 },
  filterChip: {
    minHeight: 34,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth
  },
  emptyWrap: { flex: 1 }
});
