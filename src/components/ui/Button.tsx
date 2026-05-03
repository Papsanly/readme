import * as Haptics from 'expo-haptics';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle
} from 'react-native';

import { useTheme } from '@/src/hooks/useTheme';

import { IconSymbol, type IconName } from './IconSymbol';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = {
  title: string;
  onPress?: (e: GestureResponderEvent) => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  fullWidth?: boolean;
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  style,
  fullWidth = false
}: ButtonProps) {
  const { colors, radius, spacing, fontSize, fontWeight } = useTheme();

  const heights: Record<ButtonSize, number> = { sm: 36, md: 44, lg: 52 };
  const paddings: Record<ButtonSize, number> = {
    sm: spacing.md,
    md: spacing.lg,
    lg: spacing.lg
  };
  const fontSizes: Record<ButtonSize, number> = {
    sm: fontSize.body,
    md: fontSize.body,
    lg: fontSize.bodyLg
  };
  const iconSizes: Record<ButtonSize, number> = { sm: 16, md: 18, lg: 20 };

  const isDisabled = disabled || loading;

  const palette = (() => {
    switch (variant) {
      case 'primary':
        return {
          bg: colors.accent,
          fg: colors.accentText,
          border: 'transparent'
        };
      case 'secondary':
        return {
          bg: colors.bgElevated,
          fg: colors.text,
          border: colors.border
        };
      case 'ghost':
        return {
          bg: 'transparent',
          fg: colors.accent,
          border: 'transparent'
        };
    }
  })();

  const handlePress = (e: GestureResponderEvent) => {
    if (isDisabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress?.(e);
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
          borderWidth: variant === 'secondary' ? StyleSheet.hairlineWidth : 0,
          borderRadius: radius.md,
          height: heights[size],
          paddingHorizontal: paddings[size],
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
          alignSelf: fullWidth ? 'stretch' : 'auto'
        },
        style
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <View style={styles.row}>
          {icon ? (
            <IconSymbol name={icon} size={iconSizes[size]} color={palette.fg} style={styles.icon} />
          ) : null}
          <Text
            style={{
              color: palette.fg,
              fontSize: fontSizes[size],
              fontWeight: fontWeight.semibold
            }}
            numberOfLines={1}
          >
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  icon: { marginRight: 8 }
});
