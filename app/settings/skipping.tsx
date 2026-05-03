import { StyleSheet, Text, View } from 'react-native';

import { Screen, SegmentedControl, type SegmentedOption } from '@/src/components/ui';
import { useTheme } from '@/src/hooks/useTheme';
import { useSettingsStore } from '@/src/state/settings';
import type { SkippingMode } from '@/src/types/settings';

const OPTIONS: readonly SegmentedOption<SkippingMode>[] = [
  {
    value: 'main-only',
    label: 'Main content only',
    description: 'Skip front-matter, footnotes, page numbers, headers and footers. Aggressive.'
  },
  {
    value: 'service-only',
    label: 'Service elements only',
    description: 'Keep all main content. Skip page numbers, headers, footnotes.'
  },
  {
    value: 'none',
    label: 'Read everything',
    description: 'Read every block, including service elements.'
  }
];

export default function SkippingSettingsScreen() {
  const { colors, spacing, fontSize } = useTheme();
  const skipping = useSettingsStore(s => s.skipping);
  const setSkipping = useSettingsStore(s => s.setSkipping);

  return (
    <Screen scroll>
      <SegmentedControl options={OPTIONS} value={skipping} onChange={setSkipping} />
      <View style={[styles.captionBox, { marginTop: spacing.lg }]}>
        <Text
          style={{
            color: colors.textMuted,
            fontSize: fontSize.caption
          }}
        >
          This setting affects new books. Already-processed books keep their classification, but the
          player respects the new mode.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  captionBox: {}
});
