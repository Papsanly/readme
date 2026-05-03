import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/src/hooks/useTheme';

export type ProgressBarProps = {
  progress: number;
  height?: number;
  style?: StyleProp<ViewStyle>;
};

export function ProgressBar({ progress, height = 4, style }: ProgressBarProps) {
  const { colors, radius } = useTheme();
  const clamped = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));

  return (
    <View
      style={[
        {
          height,
          backgroundColor: colors.border,
          borderRadius: radius.full,
          overflow: 'hidden'
        },
        style
      ]}
    >
      <View
        style={{
          width: `${clamped * 100}%`,
          height: '100%',
          backgroundColor: colors.accent
        }}
      />
    </View>
  );
}
