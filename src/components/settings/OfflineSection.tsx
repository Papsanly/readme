import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { ProgressBar } from '@/src/components/ui';
import { useTheme } from '@/src/hooks/useTheme';
import {
  inspectPreloadProgress,
  preloadBookAudio,
  type PreloadProgress
} from '@/src/pipeline/preload';

export type OfflineSectionProps = {
  bookId: string;
};

/**
 * Per-book "Download for offline" control. Walks every playable block under
 * the book's current skipping mode and synthesizes the ones that aren't on
 * disk yet. Shows live progress, can be cancelled mid-flight, and exposes a
 * fresh snapshot whenever the section becomes visible.
 */
export function OfflineSection({ bookId }: OfflineSectionProps) {
  const { colors, spacing, fontSize, fontWeight, radius } = useTheme();

  const [snapshot, setSnapshot] = useState<PreloadProgress | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);

  const refreshSnapshot = useCallback(() => {
    void inspectPreloadProgress(bookId)
      .then(p => setSnapshot(p))
      .catch(() => {
        // Inspection is best-effort; if the audio dir can't be walked we
        // just show the "Download" button without numbers.
      });
  }, [bookId]);

  useEffect(() => {
    refreshSnapshot();
    return () => {
      abortRef.current?.abort();
    };
  }, [refreshSnapshot]);

  const handleStart = useCallback(() => {
    if (running) return;
    setError(undefined);
    setRunning(true);
    const ac = new AbortController();
    abortRef.current = ac;
    void preloadBookAudio(bookId, {
      signal: ac.signal,
      onProgress: p => setSnapshot(p)
    })
      .then(final => setSnapshot(final))
      .catch(err => {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setRunning(false);
        abortRef.current = null;
        refreshSnapshot();
      });
  }, [bookId, refreshSnapshot, running]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const confirmCancel = useCallback(() => {
    Alert.alert(
      'Stop downloading?',
      'In-flight requests will finish, but no new blocks will be synthesized.',
      [
        { text: 'Keep downloading', style: 'cancel' },
        { text: 'Stop', style: 'destructive', onPress: handleCancel }
      ]
    );
  }, [handleCancel]);

  const total = snapshot?.total ?? 0;
  const cached = snapshot?.cached ?? 0;
  const complete = total > 0 && cached >= total;
  const ratio = total > 0 ? cached / total : 0;

  return (
    <View style={[styles.wrap, { paddingHorizontal: spacing.lg, gap: spacing.sm }]}>
      <Text style={{ color: colors.textMuted, fontSize: fontSize.caption }}>
        Preloads every playable block under the current skipping mode so you can listen without a
        connection. Re-run any time to fill in newly added blocks.
      </Text>

      <View style={[styles.row, { gap: spacing.sm }]}>
        <Text
          style={{
            color: colors.text,
            fontSize: fontSize.body,
            fontWeight: fontWeight.medium,
            flex: 1
          }}
        >
          {total === 0
            ? 'No playable blocks yet'
            : complete
              ? `All ${total} blocks downloaded`
              : `${cached} / ${total} blocks downloaded`}
        </Text>
        {running ? (
          <Pressable
            onPress={confirmCancel}
            accessibilityRole="button"
            accessibilityLabel="Stop downloading"
            style={({ pressed }) => [
              {
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                borderRadius: radius.md,
                backgroundColor: colors.bgElevated,
                opacity: pressed ? 0.7 : 1
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
              Stop
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={handleStart}
            disabled={total === 0 || complete}
            accessibilityRole="button"
            accessibilityLabel={complete ? 'Already downloaded' : 'Start download'}
            style={({ pressed }) => [
              {
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                borderRadius: radius.md,
                backgroundColor: colors.accent,
                opacity: total === 0 || complete ? 0.35 : pressed ? 0.7 : 1
              }
            ]}
          >
            <Text
              style={{
                color: colors.accentText,
                fontSize: fontSize.body,
                fontWeight: fontWeight.semibold
              }}
            >
              {complete ? 'Downloaded' : 'Download'}
            </Text>
          </Pressable>
        )}
      </View>

      {total > 0 ? <ProgressBar progress={ratio} /> : null}

      {error ? (
        <Text style={{ color: colors.danger, fontSize: fontSize.caption }}>{error}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {},
  row: { flexDirection: 'row', alignItems: 'center' }
});
