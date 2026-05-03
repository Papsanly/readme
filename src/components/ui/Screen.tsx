import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { useTheme } from '@/src/hooks/useTheme';

export type ScreenProps = {
  children: ReactNode;
  padded?: boolean;
  scroll?: boolean;
  edges?: readonly Edge[];
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
};

export function Screen({
  children,
  padded = true,
  scroll = false,
  edges = ['top', 'left', 'right'],
  style,
  contentStyle
}: ScreenProps) {
  const { colors, spacing } = useTheme();
  const paddingStyle: ViewStyle = padded ? { padding: spacing.lg } : {};

  return (
    <SafeAreaView edges={edges} style={[styles.container, { backgroundColor: colors.bg }, style]}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[paddingStyle, contentStyle]}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, paddingStyle, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 }
});
