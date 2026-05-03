export type SkippingMode = 'main-only' | 'service-only' | 'none';

export type AppSettings = {
  voiceId?: string;
  voiceName?: string;
  speed: number;
  skipping: SkippingMode;
};
