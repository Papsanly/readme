import { useColorScheme } from 'react-native';

import { palettes, type ColorScheme, type Palette } from '@/src/theme/colors';
import { radius, spacing, type Radius, type Spacing } from '@/src/theme/spacing';
import { fontSize, fontWeight, type FontSize, type FontWeight } from '@/src/theme/typography';

export type Theme = {
  scheme: ColorScheme;
  colors: Palette;
  spacing: Spacing;
  radius: Radius;
  fontSize: FontSize;
  fontWeight: FontWeight;
};

export function useTheme(): Theme {
  const scheme: ColorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return {
    scheme,
    colors: palettes[scheme],
    spacing,
    radius,
    fontSize,
    fontWeight
  };
}
