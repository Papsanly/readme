import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import {
  Pressable,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle
} from 'react-native';

import { useTheme } from '@/src/hooks/useTheme';

export type CardProps = {
  children: ReactNode;
  onPress?: (e: GestureResponderEvent) => void;
  style?: StyleProp<ViewStyle>;
};

export function Card({ children, onPress, style }: CardProps) {
  const { colors, radius, spacing } = useTheme();
  const baseStyle: ViewStyle = {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    padding: spacing.lg
  };

  if (onPress) {
    const handlePress = (e: GestureResponderEvent) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      onPress(e);
    };
    return (
      <Pressable
        onPress={handlePress}
        style={({ pressed }) => [baseStyle, { opacity: pressed ? 0.85 : 1 }, style]}
      >
        {children}
      </Pressable>
    );
  }

  return <View style={[baseStyle, style]}>{children}</View>;
}
