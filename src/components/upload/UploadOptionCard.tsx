import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { IconSymbol, type IconName } from '@/src/components/ui';
import { useTheme } from '@/src/hooks/useTheme';

const ICON_BADGE_SIZE = 48;

export type UploadOptionCardProps = {
  icon: IconName;
  title: string;
  description: string;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function UploadOptionCard({
  icon,
  title,
  description,
  onPress,
  disabled = false,
  style
}: UploadOptionCardProps) {
  const { colors, radius, spacing, fontSize, fontWeight } = useTheme();

  const handlePress = () => {
    if (disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={description}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.container,
        {
          backgroundColor: colors.bgElevated,
          borderRadius: radius.lg,
          padding: spacing.lg,
          gap: spacing.md,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1
        },
        style
      ]}
    >
      <View
        style={[
          styles.iconBadge,
          {
            width: ICON_BADGE_SIZE,
            height: ICON_BADGE_SIZE,
            borderRadius: ICON_BADGE_SIZE / 2,
            backgroundColor: colors.bg
          }
        ]}
      >
        <IconSymbol name={icon} size={22} color={colors.accent} weight="medium" />
      </View>

      <View style={styles.body}>
        <Text
          numberOfLines={1}
          style={{
            color: colors.text,
            fontSize: fontSize.bodyLg,
            fontWeight: fontWeight.semibold
          }}
        >
          {title}
        </Text>
        <Text
          numberOfLines={2}
          style={{
            color: colors.textMuted,
            fontSize: fontSize.body,
            marginTop: 2
          }}
        >
          {description}
        </Text>
      </View>

      <IconSymbol name="chevron.right" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center' },
  iconBadge: { alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0 }
});
