import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/src/hooks/useTheme';

import { IconSymbol } from './IconSymbol';

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
};

export type SegmentedControlProps<T extends string> = {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  style
}: SegmentedControlProps<T>) {
  const { colors, radius, spacing, fontSize, fontWeight } = useTheme();

  const handlePress = (next: T) => {
    if (next === value) return;
    Haptics.selectionAsync().catch(() => {});
    onChange(next);
  };

  return (
    <View style={[{ gap: spacing.sm }, style]}>
      {options.map(option => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => handlePress(option.value)}
            style={({ pressed }) => [
              styles.row,
              {
                borderRadius: radius.lg,
                padding: spacing.lg,
                backgroundColor: colors.bgElevated,
                borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
                borderColor: selected ? colors.accent : colors.border,
                opacity: pressed ? 0.85 : 1
              }
            ]}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
          >
            <View style={styles.text}>
              <Text
                style={{
                  color: colors.text,
                  fontSize: fontSize.bodyLg,
                  fontWeight: fontWeight.semibold
                }}
              >
                {option.label}
              </Text>
              {option.description ? (
                <Text
                  style={{
                    color: colors.textMuted,
                    fontSize: fontSize.body,
                    marginTop: 4
                  }}
                >
                  {option.description}
                </Text>
              ) : null}
            </View>
            {selected ? <IconSymbol name="checkmark" size={20} color={colors.accent} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  text: { flex: 1 }
});
