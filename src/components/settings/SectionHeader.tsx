import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/src/hooks/useTheme';

export type SectionHeaderProps = {
  title: string;
  style?: StyleProp<ViewStyle>;
};

export function SectionHeader({ title, style }: SectionHeaderProps) {
  const { colors, spacing, fontSize, fontWeight } = useTheme();
  return (
    <View
      style={[
        styles.container,
        {
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.lg,
          paddingBottom: spacing.sm
        },
        style
      ]}
    >
      <Text
        style={{
          color: colors.textMuted,
          fontSize: fontSize.caption,
          fontWeight: fontWeight.semibold,
          letterSpacing: 0.6,
          textTransform: 'uppercase'
        }}
      >
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {}
});
