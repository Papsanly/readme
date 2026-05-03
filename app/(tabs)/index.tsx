import * as Haptics from 'expo-haptics';
import { router, type Href } from 'expo-router';
import { useCallback, useMemo } from 'react';
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItem
} from 'react-native';

import { BookCard, BookListEmpty } from '@/src/components/library';
import { MiniPlayer } from '@/src/components/player';
import { IconSymbol, Screen } from '@/src/components/ui';
import { useTheme } from '@/src/hooks/useTheme';
import { cancelProcessing } from '@/src/pipeline/processor';
import { useLibraryStore } from '@/src/state/library';
import { usePlayerStore } from '@/src/state/player';
import { deleteBookFiles } from '@/src/storage/books';
import type { Book } from '@/src/types/book';

const ADD_BUTTON_SIZE = 44;

export default function LibraryScreen() {
  const { colors, spacing, fontSize, fontWeight } = useTheme();
  const books = useLibraryStore(s => s.books);

  const sortedBooks = useMemo<Book[]>(
    () => Object.values(books).sort((a, b) => b.createdAt - a.createdAt),
    [books]
  );

  const goToUpload = useCallback(() => {
    router.push('/(tabs)/upload');
  }, []);

  const handleAddPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    goToUpload();
  }, [goToUpload]);

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
          { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md }
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
        <Pressable
          onPress={handleAddPress}
          accessibilityRole="button"
          accessibilityLabel="Add book"
          hitSlop={8}
          style={({ pressed }) => [
            styles.addButton,
            {
              width: ADD_BUTTON_SIZE,
              height: ADD_BUTTON_SIZE,
              borderRadius: ADD_BUTTON_SIZE / 2,
              backgroundColor: colors.accent,
              opacity: pressed ? 0.85 : 1
            }
          ]}
        >
          <IconSymbol name="plus" size={22} color={colors.accentText} weight="semibold" />
        </Pressable>
      </View>

      {sortedBooks.length === 0 ? (
        <View style={styles.emptyWrap}>
          <BookListEmpty onAddBook={goToUpload} />
        </View>
      ) : (
        <FlatList
          data={sortedBooks}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing.lg,
            gap: spacing.md
          }}
          showsVerticalScrollIndicator={false}
        />
      )}

      <MiniPlayer />
    </Screen>
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
  header: { flexDirection: 'row', alignItems: 'center' },
  addButton: { alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { flex: 1 }
});
