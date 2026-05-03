import { router, type Href } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { SectionHeader } from '@/src/components/settings';
import { IconSymbol, ListItem, Screen } from '@/src/components/ui';
import { useTheme } from '@/src/hooks/useTheme';
import { useSettingsStore } from '@/src/state/settings';
import type { SkippingMode } from '@/src/types/settings';

const SKIPPING_LABELS: Record<SkippingMode, string> = {
  'main-only': 'Main content only',
  'service-only': 'Skip service elements',
  none: 'Read everything'
};

export default function SettingsScreen() {
  const { colors, spacing, fontSize, fontWeight } = useTheme();
  const voiceName = useSettingsStore(s => s.voiceName);
  const skipping = useSettingsStore(s => s.skipping);

  const goVoice = () => router.push('/settings/voice' as Href);
  const goSkipping = () => router.push('/settings/skipping' as Href);
  const goAbout = () => router.push('/settings/about' as Href);

  return (
    <Screen scroll padded={false}>
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
            fontWeight: fontWeight.bold
          }}
        >
          Settings
        </Text>
      </View>

      <SectionHeader title="Audio" />
      <View style={{ backgroundColor: colors.bgElevated }}>
        <ListItem
          title="Voice"
          right={<RightValue value={voiceName ?? 'Default'} />}
          onPress={goVoice}
        />
        <ListItem
          title="Block skipping"
          right={<RightValue value={SKIPPING_LABELS[skipping]} />}
          onPress={goSkipping}
          showSeparator={false}
        />
      </View>

      <SectionHeader title="About" />
      <View style={{ backgroundColor: colors.bgElevated }}>
        <ListItem title="About readme" onPress={goAbout} showSeparator={false} />
      </View>

      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}

function RightValue({ value }: { value: string }) {
  const { colors, spacing, fontSize } = useTheme();
  return (
    <View style={[styles.right, { gap: spacing.xs }]}>
      <Text
        style={{
          color: colors.textMuted,
          fontSize: fontSize.body,
          maxWidth: 180
        }}
        numberOfLines={1}
      >
        {value}
      </Text>
      <IconSymbol name="chevron.right" size={18} color={colors.textMuted} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {},
  right: { flexDirection: 'row', alignItems: 'center' }
});
