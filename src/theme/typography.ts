import type { TextStyle } from 'react-native';

export const fontSize = {
  caption: 12,
  body: 15,
  bodyLg: 17,
  title: 20,
  h2: 24,
  h1: 32
} as const;

export type FontSize = typeof fontSize;

export const fontWeight: Record<
  'regular' | 'medium' | 'semibold' | 'bold',
  TextStyle['fontWeight']
> = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700'
};

export type FontWeight = typeof fontWeight;
