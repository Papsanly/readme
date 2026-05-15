import * as DocumentPicker from 'expo-document-picker';
import { router, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { UploadOptionCard, UrlSheet } from '@/src/components/upload';
import { Screen } from '@/src/components/ui';
import { useTheme } from '@/src/hooks/useTheme';
import { processBook } from '@/src/pipeline/processor';
import { useLibraryStore } from '@/src/state/library';
import {
  DownloadError,
  UnsupportedFormatError,
  importLocalFile,
  importUrl,
  type SupportedExtension
} from '@/src/storage/books';
import type { Book, BookSource } from '@/src/types/book';

const FILE_PICKER_TYPES = ['application/pdf', 'image/*', 'text/plain', 'text/html'];

const MIME_BY_EXT: Readonly<Record<SupportedExtension, string>> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  txt: 'text/plain',
  html: 'text/html',
  htm: 'text/html'
};

type FileInput = { kind: 'file'; asset: DocumentPicker.DocumentPickerAsset };
type UrlInput = { kind: 'url'; url: string };
type UploadInput = FileInput | UrlInput;

function stripExtension(filename: string): string {
  const base = filename.split('/').pop() ?? filename;
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(0, i) : base;
}

function describeImportError(err: unknown): string {
  if (err instanceof UnsupportedFormatError) {
    return err.hint ? `${err.message}\n${err.hint}` : err.message;
  }
  if (err instanceof DownloadError) {
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

export default function UploadScreen() {
  const { colors, spacing, fontSize, fontWeight } = useTheme();
  const [urlSheetVisible, setUrlSheetVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  const handlePickFile = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: FILE_PICKER_TYPES,
        copyToCacheDirectory: true,
        multiple: false
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      await startUpload({ kind: 'file', asset });
    } catch (err) {
      Alert.alert('Could not import', describeImportError(err));
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const handleOpenUrl = useCallback(() => {
    if (busy) return;
    setUrlSheetVisible(true);
  }, [busy]);

  const handleSubmitUrl = useCallback(
    async (url: string) => {
      setUrlSheetVisible(false);
      if (busy) return;
      setBusy(true);
      try {
        await startUpload({ kind: 'url', url });
      } catch (err) {
        Alert.alert('Could not import', describeImportError(err));
      } finally {
        setBusy(false);
      }
    },
    [busy]
  );

  return (
    <Screen scroll>
      <Text
        style={{
          color: colors.text,
          fontSize: fontSize.h1,
          fontWeight: fontWeight.bold,
          marginBottom: spacing.lg
        }}
      >
        Add a Book
      </Text>

      <View style={[styles.options, { gap: spacing.md }]}>
        <UploadOptionCard
          icon="arrow.up.doc"
          title="Pick a file"
          description="PDF, image (PNG/JPG/WEBP/GIF), HTML, or text"
          onPress={() => {
            void handlePickFile();
          }}
          disabled={busy}
        />
        <UploadOptionCard
          icon="link"
          title="From URL"
          description="Paste a link to a document, image, or HTML page"
          onPress={handleOpenUrl}
          disabled={busy}
        />
      </View>

      <Text
        style={{
          color: colors.textMuted,
          fontSize: fontSize.caption,
          marginTop: spacing.xl,
          textAlign: 'center'
        }}
      >
        Processing happens in the background and you can keep using the app.
      </Text>

      <UrlSheet
        visible={urlSheetVisible}
        onClose={() => setUrlSheetVisible(false)}
        onSubmit={url => {
          void handleSubmitUrl(url);
        }}
      />
    </Screen>
  );
}

async function startUpload(input: UploadInput): Promise<void> {
  const now = Date.now();

  if (input.kind === 'file') {
    const { asset } = input;
    const imported = await importLocalFile({
      sourceUri: asset.uri,
      mime: asset.mimeType ?? '',
      name: asset.name
    });
    const title = stripExtension(asset.name) || 'Imported document';
    const source: BookSource = {
      kind: 'file',
      name: asset.name,
      uri: imported.storedUri,
      mime: asset.mimeType ?? MIME_BY_EXT[imported.ext] ?? ''
    };
    enqueueBook(imported.bookId, title, source, imported.storedUri, imported.ext, now);
    return;
  }

  const imported = await importUrl({ url: input.url });
  const title = imported.suggestedTitle || 'Imported document';
  const source: BookSource = {
    kind: 'url',
    name: input.url,
    uri: imported.storedUri,
    mime: MIME_BY_EXT[imported.ext] ?? ''
  };
  enqueueBook(imported.bookId, title, source, imported.storedUri, imported.ext, now);
}

function enqueueBook(
  bookId: string,
  title: string,
  source: BookSource,
  storedUri: string,
  ext: SupportedExtension,
  now: number
): void {
  const initialBook: Book = {
    id: bookId,
    title,
    source,
    createdAt: now,
    status: 'queued',
    blocks: [],
    progress: { blockIndex: 0, positionSec: 0, updatedAt: now }
  };
  useLibraryStore.getState().addBook(initialBook);

  router.replace(`/upload/${bookId}` as Href);

  void processBook({ bookId, storedUri, ext, title }).catch((err: unknown) => {
    console.warn('processBook failed:', err);
  });
}

const styles = StyleSheet.create({
  options: { width: '100%' }
});
