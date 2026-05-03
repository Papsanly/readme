import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ProcessingView } from '@/src/components/upload';
import { Button, EmptyState, IconSymbol, Screen } from '@/src/components/ui';
import { useTheme } from '@/src/hooks/useTheme';
import { cancelProcessing, isProcessing, processBook } from '@/src/pipeline/processor';
import { useLibraryStore } from '@/src/state/library';
import { usePlayerStore } from '@/src/state/player';
import { deleteBookFiles, type SupportedExtension } from '@/src/storage/books';
import type { Book } from '@/src/types/book';

const SUPPORTED_EXTS: ReadonlySet<string> = new Set(['pdf', 'png', 'jpg', 'jpeg', 'txt']);

const CLOSE_BUTTON_SIZE = 36;

function extFromStoredUri(uri: string): SupportedExtension | undefined {
  const match = /\/source\.([a-z0-9]+)(?:\?|#|$)/i.exec(uri);
  if (!match) return undefined;
  const v = match[1].toLowerCase();
  return SUPPORTED_EXTS.has(v) ? (v as SupportedExtension) : undefined;
}

function extFromMime(mime: string): SupportedExtension | undefined {
  switch (mime.split(';')[0].trim().toLowerCase()) {
    case 'application/pdf':
      return 'pdf';
    case 'image/png':
      return 'png';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'text/plain':
      return 'txt';
    default:
      return undefined;
  }
}

export default function UploadProcessingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const bookId = typeof id === 'string' ? id : undefined;

  const book = useLibraryStore(s => (bookId ? s.books[bookId] : undefined));

  // When the book reaches 'ready', forward to the player. The replace runs
  // exactly once per status change.
  useEffect(() => {
    if (book?.status === 'ready' && bookId) {
      router.replace(`/player/${bookId}` as Href);
    }
  }, [book?.status, bookId]);

  if (!bookId || !book) {
    return (
      <Screen>
        <CloseButton />
        <EmptyState
          icon="tray"
          title="Book not found"
          description="The book you were uploading is no longer available."
          ctaLabel="Back to Library"
          onCtaPress={() => router.replace('/(tabs)' as Href)}
        />
      </Screen>
    );
  }

  if (book.status === 'ready') {
    // Brief intermediate render until the redirect effect lands.
    return (
      <Screen>
        <CloseButton />
      </Screen>
    );
  }

  if (book.status === 'failed') {
    return (
      <Screen>
        <CloseButton />
        <FailedView book={book} />
      </Screen>
    );
  }

  return (
    <Screen>
      <CloseButton />
      <ProcessingView
        title={book.title}
        coverUri={book.coverUri}
        stage={book.processingProgress?.stage ?? 'rendering'}
        done={book.processingProgress?.done ?? 0}
        total={book.processingProgress?.total ?? 0}
        onCancel={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          cancelProcessing(book.id);
        }}
      />
    </Screen>
  );
}

function CloseButton() {
  const { colors, spacing } = useTheme();
  return (
    <View style={[styles.closeRow, { paddingVertical: spacing.xs }]} pointerEvents="box-none">
      <Pressable
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          router.back();
        }}
        accessibilityRole="button"
        accessibilityLabel="Close"
        hitSlop={8}
        style={({ pressed }) => [
          styles.closeButton,
          {
            width: CLOSE_BUTTON_SIZE,
            height: CLOSE_BUTTON_SIZE,
            borderRadius: CLOSE_BUTTON_SIZE / 2,
            backgroundColor: colors.bgElevated,
            opacity: pressed ? 0.7 : 1
          }
        ]}
      >
        <IconSymbol name="xmark" size={16} color={colors.text} weight="medium" />
      </Pressable>
    </View>
  );
}

function FailedView({ book }: { book: Book }) {
  const { colors, spacing, fontSize, fontWeight } = useTheme();

  const handleRetry = useCallback(() => {
    if (isProcessing(book.id)) return;
    const ext = extFromStoredUri(book.source.uri) ?? extFromMime(book.source.mime);
    if (!ext) {
      // Source is no longer recoverable; surface the same UI but with a clearer
      // error in the store so the user can delete and re-upload.
      useLibraryStore.getState().setStatus(book.id, 'failed', 'Cannot determine source format');
      return;
    }
    useLibraryStore.getState().setStatus(book.id, 'queued', undefined);
    void processBook({
      bookId: book.id,
      storedUri: book.source.uri,
      ext,
      title: book.title
    }).catch((err: unknown) => {
      console.warn('processBook retry failed:', err);
    });
  }, [book.id, book.source.uri, book.source.mime, book.title]);

  const handleDelete = useCallback(() => {
    cancelProcessing(book.id);
    useLibraryStore.getState().removeBook(book.id);
    if (usePlayerStore.getState().currentBookId === book.id) {
      usePlayerStore.getState().clear();
    }
    deleteBookFiles(book.id).catch((err: unknown) => {
      console.warn('deleteBookFiles failed:', err);
    });
    router.back();
  }, [book.id]);

  const detail = book.processingError?.trim() || 'Unknown error';

  return (
    <View style={[styles.failed, { padding: spacing.lg, gap: spacing.lg }]}>
      <View
        style={[
          styles.errorIcon,
          {
            backgroundColor: colors.bgElevated,
            marginBottom: spacing.sm
          }
        ]}
      >
        <IconSymbol name="xmark" size={28} color={colors.danger} weight="medium" />
      </View>

      <Text
        style={{
          color: colors.text,
          fontSize: fontSize.h2,
          fontWeight: fontWeight.semibold,
          textAlign: 'center'
        }}
      >
        Processing failed
      </Text>

      <Text
        style={{
          color: colors.textMuted,
          fontSize: fontSize.body,
          textAlign: 'center',
          maxWidth: 320
        }}
      >
        {detail}
      </Text>

      <View style={[styles.actions, { gap: spacing.sm }]}>
        <Button
          title="Delete"
          variant="secondary"
          onPress={handleDelete}
          style={styles.actionFlex}
        />
        <Button title="Retry" variant="primary" onPress={handleRetry} style={styles.actionFlex} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  closeRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  closeButton: { alignItems: 'center', justifyContent: 'center' },
  failed: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center'
  },
  actions: { flexDirection: 'row', alignSelf: 'stretch' },
  actionFlex: { flex: 1 }
});
