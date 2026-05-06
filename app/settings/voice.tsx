import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, View } from 'react-native';

import { SectionHeader, VoiceCard } from '@/src/components/settings';
import { Button, IconSymbol, Screen, Slider } from '@/src/components/ui';
import { useTheme } from '@/src/hooks/useTheme';
import { useVoicePreview } from '@/src/hooks/useVoicePreview';
import {
  ElevenLabsError,
  MissingElevenLabsKeyError,
  getDefaultElevenLabsClient
} from '@/src/api/elevenlabs';
import { useLocalSearchParams } from 'expo-router';

import { useEffectiveSettings } from '@/src/hooks/useEffectiveSettings';
import { invalidateVoice } from '@/src/pipeline/tts';
import { useLibraryStore } from '@/src/state/library';
import { useSettingsStore } from '@/src/state/settings';
import type { Voice, VoicesPage } from '@/src/types/voice';

const SEARCH_DEBOUNCE_MS = 300;
const SPEED_MIN = 0.7;
const SPEED_MAX = 1.5;
const SPEED_STEP = 0.05;

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; voices: Voice[]; nextPageToken?: string; loadingMore: boolean }
  | { kind: 'error'; reason: 'missing-key' | 'generic'; message: string };

export default function VoiceSettingsScreen() {
  const { colors, spacing, fontSize, fontWeight } = useTheme();

  // When opened via /settings/voice?bookId=X, picks land in that book's
  // override; otherwise they update the global default. Speed control
  // always edits the global default.
  const params = useLocalSearchParams<{ bookId?: string }>();
  const bookId = typeof params.bookId === 'string' ? params.bookId : undefined;
  const effective = useEffectiveSettings(bookId);

  const speed = useSettingsStore(s => s.speed);
  const voiceId = effective.voiceId;
  const setSpeed = useSettingsStore(s => s.setSpeed);
  const setVoice = useCallback(
    (newId?: string, newName?: string) => {
      if (bookId) {
        useLibraryStore.getState().setSettingsOverride(bookId, {
          voiceId: newId,
          voiceName: newName
        });
      } else {
        useSettingsStore.getState().setVoice(newId, newName);
      }
    },
    [bookId]
  );

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [state, setState] = useState<LoadState>({ kind: 'idle' });
  const requestSeqRef = useRef(0);

  const preview = useVoicePreview();

  // Debounce search input.
  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const fetchPage = useCallback(
    async (search: string, pageToken: string | undefined): Promise<VoicesPage> => {
      const client = getDefaultElevenLabsClient();
      return client.listVoices({
        search: search.length > 0 ? search : undefined,
        nextPageToken: pageToken
      });
    },
    []
  );

  const loadInitial = useCallback(
    async (search: string) => {
      const seq = ++requestSeqRef.current;
      setState({ kind: 'loading' });
      try {
        const page = await fetchPage(search, undefined);
        if (seq !== requestSeqRef.current) return;
        setState({
          kind: 'loaded',
          voices: page.voices,
          nextPageToken: page.nextPageToken,
          loadingMore: false
        });
      } catch (err) {
        if (seq !== requestSeqRef.current) return;
        if (err instanceof MissingElevenLabsKeyError) {
          setState({
            kind: 'error',
            reason: 'missing-key',
            message: 'ElevenLabs API key missing. Set EXPO_PUBLIC_ELEVENLABS_API_KEY in .env.'
          });
          return;
        }
        const message =
          err instanceof ElevenLabsError || err instanceof Error
            ? err.message
            : 'Could not load voices';
        setState({ kind: 'error', reason: 'generic', message });
      }
    },
    [fetchPage]
  );

  const loadMore = useCallback(async () => {
    if (state.kind !== 'loaded' || !state.nextPageToken || state.loadingMore) return;
    const seq = requestSeqRef.current;
    setState({ ...state, loadingMore: true });
    try {
      const page = await fetchPage(debouncedSearch, state.nextPageToken);
      if (seq !== requestSeqRef.current) return;
      setState(prev => {
        if (prev.kind !== 'loaded') return prev;
        return {
          kind: 'loaded',
          voices: [...prev.voices, ...page.voices],
          nextPageToken: page.nextPageToken,
          loadingMore: false
        };
      });
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      const message = err instanceof Error ? err.message : 'Could not load more voices';
      setState(prev => (prev.kind === 'loaded' ? { ...prev, loadingMore: false } : prev));
      Alert.alert('Could not load more voices', message);
    }
  }, [debouncedSearch, fetchPage, state]);

  // Refetch whenever the debounced search changes.
  useEffect(() => {
    void loadInitial(debouncedSearch);
  }, [debouncedSearch, loadInitial]);

  const handleSelect = useCallback(
    (voice: Voice) => {
      // Stop any ongoing preview before applying the change.
      preview.stop();
      setVoice(voice.id, voice.name);
      // Fire-and-forget cache invalidation. When editing a per-book override,
      // only that book's cache needs clearing; other books still use their
      // previous voice. When editing the global default, every book gets
      // its cache cleared (matching the old behavior).
      if (bookId) {
        void invalidateVoice(bookId).catch(() => undefined);
        Alert.alert('Voice updated', `This book will use ${voice.name}.`);
        return;
      }
      const books = useLibraryStore.getState().books;
      const ids = Object.keys(books);
      if (ids.length === 0) {
        Alert.alert('Voice updated', `Future audio will use ${voice.name}.`);
        return;
      }
      void Promise.all(ids.map(id => invalidateVoice(id).catch(() => undefined)))
        .then(() => {
          Alert.alert(
            'Voice updated',
            `Future audio will use ${voice.name}. Cached audio was cleared so the next blocks resynthesize.`
          );
        })
        .catch(() => {
          // We already swallowed individual failures above.
        });
    },
    [preview, setVoice, bookId]
  );

  const speedLabel = useMemo(() => `${speed.toFixed(2)}×`, [speed]);

  return (
    <Screen scroll padded={false}>
      <SectionHeader title="Speech speed" />
      <View
        style={{
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.lg
        }}
      >
        <Text
          style={{
            color: colors.text,
            fontSize: fontSize.h1,
            fontWeight: fontWeight.bold,
            textAlign: 'center',
            marginBottom: spacing.md
          }}
        >
          {speedLabel}
        </Text>
        <Slider
          value={speed}
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={SPEED_STEP}
          onChange={setSpeed}
        />
        <View style={[styles.speedBoundsRow, { marginTop: spacing.xs }]}>
          <Text style={{ color: colors.textMuted, fontSize: fontSize.caption }}>
            {SPEED_MIN.toFixed(2)}×
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: fontSize.caption }}>
            {SPEED_MAX.toFixed(2)}×
          </Text>
        </View>
        <Text
          style={{
            color: colors.textMuted,
            fontSize: fontSize.caption,
            marginTop: spacing.md
          }}
        >
          Cached audio at the current voice will be reused. Changes apply on the next block.
        </Text>
      </View>

      <SectionHeader title="Voices" />
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
        <View
          style={[
            styles.searchRow,
            {
              backgroundColor: colors.bgElevated,
              borderRadius: 12,
              borderColor: colors.border,
              paddingHorizontal: spacing.md,
              gap: spacing.sm
            }
          ]}
        >
          <IconSymbol name="text.alignleft" size={16} color={colors.textMuted} />
          <TextInput
            value={searchInput}
            onChangeText={setSearchInput}
            placeholder="Search voices…"
            placeholderTextColor={colors.textMuted}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            style={[
              styles.searchInput,
              {
                color: colors.text,
                fontSize: fontSize.body
              }
            ]}
          />
        </View>

        <VoiceListBody
          state={state}
          voiceId={voiceId}
          previewingVoiceId={preview.previewingVoiceId}
          onPreviewPlay={preview.play}
          onPreviewStop={preview.stop}
          onSelect={handleSelect}
          onRetry={() => void loadInitial(debouncedSearch)}
          onLoadMore={() => void loadMore()}
        />

        <View style={{ height: spacing.xl }} />
      </View>
    </Screen>
  );
}

function VoiceListBody({
  state,
  voiceId,
  previewingVoiceId,
  onPreviewPlay,
  onPreviewStop,
  onSelect,
  onRetry,
  onLoadMore
}: {
  state: LoadState;
  voiceId: string | undefined;
  previewingVoiceId: string | undefined;
  onPreviewPlay: (voice: Voice) => void;
  onPreviewStop: () => void;
  onSelect: (voice: Voice) => void;
  onRetry: () => void;
  onLoadMore: () => void;
}) {
  const { colors, spacing, fontSize } = useTheme();

  if (state.kind === 'idle' || state.kind === 'loading') {
    return (
      <View style={[styles.center, { paddingVertical: spacing.xl }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (state.kind === 'error') {
    return (
      <View style={[styles.errorBox, { gap: spacing.md, paddingVertical: spacing.lg }]}>
        <IconSymbol
          name={state.reason === 'missing-key' ? 'key.fill' : 'tray'}
          size={24}
          color={colors.warning}
        />
        <Text
          style={{
            color: colors.text,
            fontSize: fontSize.body,
            textAlign: 'center'
          }}
        >
          {state.reason === 'missing-key' ? state.message : 'Could not load voices.'}
        </Text>
        {state.reason === 'generic' ? (
          <Text
            style={{
              color: colors.textMuted,
              fontSize: fontSize.caption,
              textAlign: 'center'
            }}
            numberOfLines={3}
          >
            {state.message}
          </Text>
        ) : null}
        {state.reason === 'generic' ? (
          <Button title="Retry" onPress={onRetry} variant="secondary" />
        ) : null}
      </View>
    );
  }

  if (state.voices.length === 0) {
    return (
      <View style={[styles.center, { paddingVertical: spacing.xl }]}>
        <Text style={{ color: colors.textMuted, fontSize: fontSize.body }}>
          No voices match your search.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.sm }}>
      {state.voices.map(voice => (
        <VoiceCard
          key={voice.id}
          voice={voice}
          selected={voice.id === voiceId}
          onSelect={onSelect}
          onPreviewPlay={onPreviewPlay}
          onPreviewStop={onPreviewStop}
          isPreviewing={previewingVoiceId === voice.id}
        />
      ))}
      {state.nextPageToken ? (
        <View style={{ marginTop: spacing.sm }}>
          <Button
            title="Load more"
            onPress={onLoadMore}
            variant="secondary"
            loading={state.loadingMore}
            fullWidth
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  speedBoundsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    borderWidth: StyleSheet.hairlineWidth
  },
  searchInput: { flex: 1, paddingVertical: 0 },
  center: { alignItems: 'center', justifyContent: 'center' },
  errorBox: { alignItems: 'center', justifyContent: 'center' }
});
