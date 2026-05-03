export type ColorScheme = 'light' | 'dark';

export type Palette = {
  bg: string;
  bgElevated: string;
  text: string;
  textMuted: string;
  border: string;
  accent: string;
  accentText: string;
  danger: string;
  success: string;
  warning: string;
  overlay: string;
};

const light: Palette = {
  bg: '#FFFFFF',
  bgElevated: '#F5F5F7',
  text: '#0B0B0F',
  textMuted: '#6B7280',
  border: '#E5E7EB',
  accent: '#3B5BFE',
  accentText: '#FFFFFF',
  danger: '#DC2626',
  success: '#16A34A',
  warning: '#F59E0B',
  overlay: 'rgba(0, 0, 0, 0.4)'
};

const dark: Palette = {
  bg: '#0B0B0F',
  bgElevated: '#16161B',
  text: '#F5F5F7',
  textMuted: '#9CA3AF',
  border: '#2A2A31',
  accent: '#6F86FF',
  accentText: '#0B0B0F',
  danger: '#F87171',
  success: '#4ADE80',
  warning: '#FBBF24',
  overlay: 'rgba(0, 0, 0, 0.6)'
};

export const palettes: Record<ColorScheme, Palette> = { light, dark };
