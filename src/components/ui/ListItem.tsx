import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import {
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

export type ListItemProps = {
  title: string;
  subtitle?: string;
  leftIcon?: IconName;
  right?: ReactNode;
  onPress?: (e: GestureResponderEvent) => void;
  showSeparator?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function ListItem({
  title,
  subtitle,
  leftIcon,
  right,
  onPress,
  showSeparator = true,
  style
}: ListItemProps) {
  const { colors, spacing, fontSize, fontWeight } = useTheme();

  const content = (
    <View
      style={[
        styles.container,
        {
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.lg,
          borderBottomColor: colors.border,
          borderBottomWidth: showSeparator ? StyleSheet.hairlineWidth : 0
        }
      ]}
    >
      {leftIcon ? (
        <IconSymbol
          name={leftIcon}
          size={20}
          color={colors.textMuted}
          style={{ marginRight: spacing.md }}
        />
      ) : null}
      <View style={styles.textBlock}>
        <Text
          style={{
            color: colors.text,
            fontSize: fontSize.bodyLg,
            fontWeight: fontWeight.medium
          }}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={{
              color: colors.textMuted,
              fontSize: fontSize.body,
              marginTop: 2
            }}
            numberOfLines={2}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.right}>
        {right ??
          (onPress ? <IconSymbol name="chevron.right" size={18} color={colors.textMuted} /> : null)}
      </View>
    </View>
  );

  if (!onPress) {
    return <View style={style}>{content}</View>;
  }

  const handlePress = (e: GestureResponderEvent) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress(e);
  };

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }, style]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center' },
  textBlock: { flex: 1 },
  right: { marginLeft: 8 }
});
