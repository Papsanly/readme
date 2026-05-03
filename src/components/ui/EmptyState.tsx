import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/src/hooks/useTheme';

import { Button } from './Button';
import { IconSymbol, type IconName } from './IconSymbol';

export type EmptyStateProps = {
  icon: IconName;
  title: string;
  description?: string;
  ctaLabel?: string;
  onCtaPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function EmptyState({
  icon,
  title,
  description,
  ctaLabel,
  onCtaPress,
  style
}: EmptyStateProps) {
  const { colors, spacing, fontSize, fontWeight } = useTheme();

  return (
    <View style={[styles.container, { padding: spacing.xl }, style]}>
      <View
        style={[
          styles.iconWrap,
          {
            backgroundColor: colors.bgElevated,
            marginBottom: spacing.lg
          }
        ]}
      >
        <IconSymbol name={icon} size={28} color={colors.textMuted} />
      </View>
      <Text
        style={{
          color: colors.text,
          fontSize: fontSize.title,
          fontWeight: fontWeight.semibold,
          textAlign: 'center'
        }}
      >
        {title}
      </Text>
      {description ? (
        <Text
          style={{
            color: colors.textMuted,
            fontSize: fontSize.body,
            textAlign: 'center',
            marginTop: spacing.sm,
            maxWidth: 300
          }}
        >
          {description}
        </Text>
      ) : null}
      {ctaLabel && onCtaPress ? (
        <View style={{ marginTop: spacing.xl }}>
          <Button title={ctaLabel} onPress={onCtaPress} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center'
  }
});
