export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32
} as const;

export type Spacing = typeof spacing;

export const radius = {
  sm: 8,
  md: 12,
  lg: 14,
  xl: 20,
  full: 9999
} as const;

export type Radius = typeof radius;
