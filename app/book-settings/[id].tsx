import { Directory } from 'expo-file-system';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { OfflineSection, SectionHeader } from '@/src/components/settings';
import {
  Button,
  IconSymbol,
  ListItem,
  Screen,
  SegmentedControl,
  type SegmentedOption,
  Slider
} from '@/src/components/ui';
import { useEffectiveSettings } from '@/src/hooks/useEffectiveSettings';
import { useTheme } from '@/src/hooks/useTheme';
import {
  AlreadyProcessingError,
  cancelProcessing,
  isProcessing,
  processBook
} from '@/src/pipeline/processor';
import { deleteBookOcr } from '@/src/storage/ocr';
import { paths } from '@/src/storage/paths';
import { useLibraryStore } from '@/src/state/library';
import { useSettingsStore } from '@/src/state/settings';
import type { PronunciationOverride, SkippingMode, TtsProvider } from '@/src/types/settings';
import { upsertPronunciationOverride } from '@/src/utils/pronunciation';

const SPEED_MIN = 0.7;
const SPEED_MAX = 1.5;
const SPEED_STEP = 0.05;

const SKIPPING_OPTIONS: readonly SegmentedOption<SkippingMode>[] = [
  {
    value: 'main-only',
    label: 'Main only',
    description: 'Aggressive: skip everything not classified as main content.'
  },
  {
    value: 'service-only',
    label: 'Skip service',
    description: 'Skip page numbers, headers/footers, footnotes, table of contents.'
  },
  { value: 'none', label: 'Read all', description: 'Read every block, including service elements.' }
];

const PROVIDER_OPTIONS: readonly SegmentedOption<TtsProvider>[] = [
  { value: 'elevenlabs', label: 'ElevenLabs' },
  { value: 'local', label: 'Local server' }
];

/**
 * Per-book reading settings. Each control has a "Use default" link that
 * clears the override and falls back to the value from the global settings
 * tab. The visible value reflects the *effective* setting (override OR
 * default) so what you see is what the player will use.
 */
export default function BookSettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const bookId = typeof id === 'string' ? id : undefined;

  const { colors, spacing, fontSize, fontWeight } = useTheme();
  const effective = useEffectiveSettings(bookId);
  const book = useLibraryStore(s => (bookId ? s.books[bookId] : undefined));
  const override = useLibraryStore(s => (bookId ? s.books[bookId]?.settingsOverride : undefined));
  const globalSpeed = useSettingsStore(s => s.speed);
  const globalSkipping = useSettingsStore(s => s.skipping);
  const globalTtsProvider = useSettingsStore(s => s.ttsProvider);
  const globalVoiceName = useSettingsStore(s => s.voiceName);
  const globalLocalVoice = useSettingsStore(s => s.localVoice);
  const globalPronunciations = useSettingsStore(s => s.pronunciations);
  const [reprocessing, setReprocessing] = useState(false);
  const [pronunciationTerm, setPronunciationTerm] = useState('');
  const [pronunciationValue, setPronunciationValue] = useState('');

  const setSpeedOverride = useCallback(
    (value: number | undefined) => {
      if (!bookId) return;
      useLibraryStore.getState().setSettingsOverride(bookId, { speed: value });
    },
    [bookId]
  );

  const setSkippingOverride = useCallback(
    (value: SkippingMode | undefined) => {
      if (!bookId) return;
      useLibraryStore.getState().setSettingsOverride(bookId, { skipping: value });
    },
    [bookId]
  );

  const setProviderOverride = useCallback(
    (value: TtsProvider | undefined) => {
      if (!bookId) return;
      useLibraryStore.getState().setSettingsOverride(bookId, { ttsProvider: value });
    },
    [bookId]
  );

  const setBookPronunciations = useCallback(
    (items: PronunciationOverride[] | undefined) => {
      if (!bookId) return;
      useLibraryStore.getState().setSettingsOverride(bookId, { pronunciations: items });
    },
    [bookId]
  );

  const clearVoiceOverride = useCallback(() => {
    if (!bookId) return;
    if (effective.ttsProvider === 'elevenlabs') {
      // `voiceId` and `voiceName` are paired — clear both.
      useLibraryStore
        .getState()
        .setSettingsOverride(bookId, { voiceId: undefined, voiceName: undefined });
    } else {
      useLibraryStore.getState().setSettingsOverride(bookId, { localVoice: undefined });
    }
  }, [bookId, effective.ttsProvider]);

  const openVoicePicker = useCallback(() => {
    if (!bookId) return;
    if (effective.ttsProvider === 'elevenlabs') {
      router.push(`/settings/voice?bookId=${bookId}` as Href);
    } else {
      router.push(`/settings/local-voice?bookId=${bookId}` as Href);
    }
  }, [bookId, effective.ttsProvider]);

  const runReprocess = useCallback(async (): Promise<void> => {
    if (!bookId || !book) return;
    if (reprocessing) return;
    setReprocessing(true);
    try {
      // Abort any in-flight job for this book before wiping its state.
      if (isProcessing(bookId)) cancelProcessing(bookId);

      // Wipe per-book caches so the new pipeline run regenerates everything
      // from the canonical source PDF on disk. Audio is keyed by block id;
      // since reprocessing produces fresh ids the old mp3s would be orphans
      // anyway, so we drop the whole audio dir.
      deleteBookOcr(bookId);
      try {
        const audioDir = new Directory(paths.bookAudioDir(bookId));
        if (audioDir.exists) audioDir.delete();
      } catch (err) {
        console.warn(
          `[book-settings] failed to wipe audio dir for ${bookId}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      try {
        const pagesDir = new Directory(paths.bookPagesDir(bookId));
        if (pagesDir.exists) pagesDir.delete();
      } catch (err) {
        console.warn(
          `[book-settings] failed to wipe pages dir for ${bookId}: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      useLibraryStore.getState().updateBook(bookId, {
        blocks: [],
        coverUri: undefined,
        processingError: undefined,
        processingProgress: undefined,
        status: 'queued',
        progress: { blockIndex: 0, positionSec: 0, updatedAt: Date.now() }
      });

      // Derive ext from the book source name; fall back to pdf.
      const extMatch = /\.([A-Za-z0-9]+)$/.exec(book.source.name);
      const ext = (extMatch?.[1] ?? 'pdf').toLowerCase();
      const storedUri = paths.bookSource(bookId, ext);

      // Fire-and-forget: navigate to the player which will surface the
      // streaming progress UI for the new run.
      void processBook({
        bookId,
        storedUri,
        ext,
        title: book.title,
        bookTitle: book.title
      }).catch(err => {
        if (err instanceof AlreadyProcessingError) return;
        console.warn(
          `[book-settings] reprocess failed for ${bookId}: ${err instanceof Error ? err.message : String(err)}`
        );
      });

      router.replace(`/player/${bookId}` as Href);
    } finally {
      setReprocessing(false);
    }
  }, [bookId, book, reprocessing]);

  const confirmReprocess = useCallback(() => {
    if (!bookId || !book) return;
    Alert.alert(
      'Reprocess this book?',
      'Wipes blocks, audio cache, page renders, and OCR for this book, then re-runs the full processing pipeline on the source file. Re-pays for VLM and OCR.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reprocess', style: 'destructive', onPress: () => void runReprocess() }
      ]
    );
  }, [bookId, book, runReprocess]);

  const handleAddPronunciation = useCallback(() => {
    const next = upsertPronunciationOverride(
      override?.pronunciations,
      pronunciationTerm,
      pronunciationValue
    );
    setBookPronunciations(next.length > 0 ? next : undefined);
    setPronunciationTerm('');
    setPronunciationValue('');
  }, [override?.pronunciations, pronunciationTerm, pronunciationValue, setBookPronunciations]);

  const handleRemovePronunciation = useCallback(
    (item: PronunciationOverride) => {
      const remove = () => {
        const next = (override?.pronunciations ?? []).filter(existing => existing.id !== item.id);
        setBookPronunciations(next.length > 0 ? next : undefined);
      };
      Alert.alert(
        'Delete book pronunciation?',
        `Remove pronunciation override for "${item.term}"?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: remove }
        ]
      );
    },
    [override?.pronunciations, setBookPronunciations]
  );

  if (!bookId) return null;

  const speedOverridden = override?.speed !== undefined;
  const skippingOverridden = override?.skipping !== undefined;
  const providerOverridden = override?.ttsProvider !== undefined;
  const voiceOverridden =
    effective.ttsProvider === 'elevenlabs'
      ? override?.voiceId !== undefined
      : override?.localVoice !== undefined;
  const bookPronunciations = override?.pronunciations ?? [];
  const canSavePronunciation =
    pronunciationTerm.trim().length > 0 && pronunciationValue.trim().length > 0;

  const effectiveVoiceLabel =
    effective.ttsProvider === 'elevenlabs'
      ? (effective.voiceName ?? globalVoiceName ?? 'Default')
      : (effective.localVoice ?? globalLocalVoice ?? 'alloy');

  return (
    <Screen scroll padded={false}>
      <SectionHeader title="TTS provider" />
      <View style={[styles.section, { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }]}>
        <SegmentedControl
          options={PROVIDER_OPTIONS}
          value={effective.ttsProvider}
          onChange={setProviderOverride}
        />
        <View style={[styles.metaRow, { marginTop: spacing.sm, gap: spacing.md }]}>
          <Text style={{ color: colors.textMuted, fontSize: fontSize.caption, flex: 1 }}>
            {providerOverridden
              ? `Custom for this book — default is "${globalTtsProvider}".`
              : `Using default ("${globalTtsProvider}").`}
          </Text>
          {providerOverridden ? (
            <Pressable onPress={() => setProviderOverride(undefined)} hitSlop={8}>
              <Text
                style={{
                  color: colors.accent,
                  fontSize: fontSize.caption,
                  fontWeight: fontWeight.medium
                }}
              >
                Use default
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <SectionHeader title="Voice" />
      <View style={{ backgroundColor: colors.bgElevated }}>
        <ListItem
          title="Voice"
          subtitle={
            voiceOverridden
              ? `Custom for this book: ${effectiveVoiceLabel}`
              : `Using default: ${effectiveVoiceLabel}`
          }
          right={
            voiceOverridden ? (
              <Pressable onPress={clearVoiceOverride} hitSlop={8}>
                <Text
                  style={{
                    color: colors.accent,
                    fontSize: fontSize.caption,
                    fontWeight: fontWeight.medium,
                    paddingHorizontal: spacing.sm
                  }}
                >
                  Use default
                </Text>
              </Pressable>
            ) : undefined
          }
          onPress={openVoicePicker}
          showSeparator={false}
        />
      </View>

      <SectionHeader title="Speed" />
      <View style={[styles.section, { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }]}>
        <View style={[styles.row, { marginBottom: spacing.sm }]}>
          <Text
            style={{
              color: colors.text,
              fontSize: fontSize.h2,
              fontWeight: fontWeight.bold,
              flex: 1,
              textAlign: 'center'
            }}
          >
            {effective.speed.toFixed(2)}×
          </Text>
        </View>
        <Slider
          value={effective.speed}
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={SPEED_STEP}
          onChange={setSpeedOverride}
        />
        <View style={[styles.metaRow, { marginTop: spacing.sm, gap: spacing.md }]}>
          <Text style={{ color: colors.textMuted, fontSize: fontSize.caption, flex: 1 }}>
            {speedOverridden
              ? `Custom for this book — default is ${globalSpeed.toFixed(2)}×.`
              : `Using default (${globalSpeed.toFixed(2)}×).`}
          </Text>
          {speedOverridden ? (
            <Pressable onPress={() => setSpeedOverride(undefined)} hitSlop={8}>
              <Text
                style={{
                  color: colors.accent,
                  fontSize: fontSize.caption,
                  fontWeight: fontWeight.medium
                }}
              >
                Use default
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <SectionHeader title="Block skipping" />
      <View style={[styles.section, { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }]}>
        <SegmentedControl
          options={SKIPPING_OPTIONS}
          value={effective.skipping}
          onChange={setSkippingOverride}
        />
        <View style={[styles.metaRow, { marginTop: spacing.sm, gap: spacing.md }]}>
          <Text style={{ color: colors.textMuted, fontSize: fontSize.caption, flex: 1 }}>
            {skippingOverridden
              ? `Custom for this book — default is "${globalSkipping}".`
              : `Using default ("${globalSkipping}").`}
          </Text>
          {skippingOverridden ? (
            <Pressable onPress={() => setSkippingOverride(undefined)} hitSlop={8}>
              <Text
                style={{
                  color: colors.accent,
                  fontSize: fontSize.caption,
                  fontWeight: fontWeight.medium
                }}
              >
                Use default
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <SectionHeader title="Pronunciations" />
      <View
        style={[
          styles.section,
          { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md }
        ]}
      >
        <Text style={{ color: colors.textMuted, fontSize: fontSize.caption }}>
          Effective dictionary: {effective.pronunciations.length} total (
          {globalPronunciations.length} global + {bookPronunciations.length} for this book).
          Book-specific entries are added on top of global entries and take precedence for matching
          terms.
        </Text>

        <View style={{ gap: spacing.xs }}>
          <Text
            style={{
              color: colors.text,
              fontSize: fontSize.body,
              fontWeight: fontWeight.semibold
            }}
          >
            Term in this book
          </Text>
          <TextInput
            value={pronunciationTerm}
            onChangeText={setPronunciationTerm}
            autoCapitalize="none"
            autoCorrect={false}
            style={[
              styles.input,
              {
                backgroundColor: colors.bgElevated,
                borderColor: colors.border,
                borderRadius: 12,
                color: colors.text,
                fontSize: fontSize.body,
                paddingHorizontal: spacing.md
              }
            ]}
          />
        </View>

        <View style={{ gap: spacing.xs }}>
          <Text
            style={{
              color: colors.text,
              fontSize: fontSize.body,
              fontWeight: fontWeight.semibold
            }}
          >
            Pronounce as
          </Text>
          <TextInput
            value={pronunciationValue}
            onChangeText={setPronunciationValue}
            autoCapitalize="none"
            autoCorrect={false}
            style={[
              styles.input,
              {
                backgroundColor: colors.bgElevated,
                borderColor: colors.border,
                borderRadius: 12,
                color: colors.text,
                fontSize: fontSize.body,
                paddingHorizontal: spacing.md
              }
            ]}
          />
        </View>

        <Button
          title="Add for this book"
          onPress={handleAddPronunciation}
          disabled={!canSavePronunciation}
          fullWidth
        />

        {bookPronunciations.length > 0 ? (
          <View style={{ gap: spacing.sm }}>
            {bookPronunciations.map(item => (
              <View
                key={item.id}
                style={[
                  styles.pronunciationItem,
                  {
                    backgroundColor: colors.bgElevated,
                    borderRadius: 12,
                    padding: spacing.md,
                    gap: spacing.md
                  }
                ]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    style={{
                      color: colors.text,
                      fontSize: fontSize.body,
                      fontWeight: fontWeight.semibold
                    }}
                    numberOfLines={1}
                  >
                    {item.term}
                  </Text>
                  <Text
                    style={{ color: colors.textMuted, fontSize: fontSize.caption, marginTop: 2 }}
                    numberOfLines={2}
                  >
                    Book pronounces as: {item.pronunciation}
                  </Text>
                </View>
                <Pressable
                  onPress={() => handleRemovePronunciation(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete book pronunciation for ${item.term}`}
                  hitSlop={8}
                  style={({ pressed }) => [styles.deleteButton, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <IconSymbol name="trash" size={20} color={colors.danger} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : (
          <Text style={{ color: colors.textMuted, fontSize: fontSize.caption }}>
            No book-specific pronunciations yet. Global pronunciations still apply.
          </Text>
        )}
      </View>

      <View style={[styles.note, { paddingHorizontal: spacing.lg, marginTop: spacing.md }]}>
        <Text
          style={{
            color: colors.textMuted,
            fontSize: fontSize.caption,
            lineHeight: fontSize.caption * 1.5
          }}
        >
          These settings apply only to this book. Changes take effect immediately — already-cached
          audio for this book gets re-synthesized when speed/voice changes; skipping is a runtime
          filter and applies to the next block transition.
        </Text>
      </View>

      <SectionHeader title="Offline" />
      <OfflineSection bookId={bookId} />

      {__DEV__ ? (
        <>
          <SectionHeader title="Dev tools" />
          <View
            style={[
              styles.section,
              { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.sm }
            ]}
          >
            <Pressable
              onPress={confirmReprocess}
              disabled={reprocessing}
              accessibilityRole="button"
              accessibilityLabel="Reprocess book"
              style={({ pressed }) => [
                {
                  paddingVertical: spacing.md,
                  paddingHorizontal: spacing.lg,
                  borderRadius: 12,
                  backgroundColor: colors.bgElevated,
                  borderWidth: 1,
                  borderColor: colors.danger,
                  opacity: reprocessing ? 0.5 : pressed ? 0.7 : 1,
                  alignItems: 'center'
                }
              ]}
            >
              <Text
                style={{
                  color: colors.danger,
                  fontSize: fontSize.body,
                  fontWeight: fontWeight.semibold
                }}
              >
                {reprocessing ? 'Reprocessing…' : 'Reprocess book'}
              </Text>
            </Pressable>
            <Text
              style={{
                color: colors.textMuted,
                fontSize: fontSize.caption,
                lineHeight: fontSize.caption * 1.5
              }}
            >
              Dev only. Wipes blocks + audio + page renders + OCR cache, then re-runs the full
              pipeline on the stored source. Re-charges for VLM and datalab.
            </Text>
          </View>
        </>
      ) : null}

      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {},
  row: { flexDirection: 'row', alignItems: 'center' },
  metaRow: { flexDirection: 'row', alignItems: 'center' },
  input: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth
  },
  pronunciationItem: { flexDirection: 'row', alignItems: 'center' },
  deleteButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  note: {}
});
