import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Screen, SegmentedControl, type SegmentedOption } from '@/src/components/ui';
import { useTheme } from '@/src/hooks/useTheme';
import { useSettingsStore } from '@/src/state/settings';
import type { TtsProvider } from '@/src/types/settings';

const PROVIDER_OPTIONS: readonly SegmentedOption<TtsProvider>[] = [
  {
    value: 'elevenlabs',
    label: 'ElevenLabs',
    description: 'Hosted, paid. Highest quality. Voice picked in Settings → Voice.'
  },
  {
    value: 'local',
    label: 'Local server',
    description:
      'Free, runs on the developer machine (Kokoro). No setup needed once the bundled server is running.'
  }
];

export default function TtsProviderSettingsScreen() {
  const { colors, spacing, fontSize } = useTheme();
  const provider = useSettingsStore(s => s.ttsProvider);

  const setProvider = useCallback((next: TtsProvider) => {
    useSettingsStore.getState().setTtsProvider(next);
  }, []);

  return (
    <Screen scroll>
      <SegmentedControl<TtsProvider>
        options={PROVIDER_OPTIONS}
        value={provider}
        onChange={setProvider}
      />
      <View style={[styles.note, { paddingHorizontal: spacing.lg, marginTop: spacing.lg }]}>
        <Text style={{ color: colors.textMuted, fontSize: fontSize.caption }}>
          Switch instantly between cloud and local TTS. New synthesis goes to the selected provider;
          previously cached audio for a book stays valid until you change the voice or speed.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: {}
});
