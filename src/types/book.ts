export type BlockType =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'quote'
  | 'caption'
  | 'figure'
  | 'page-number'
  | 'footnote'
  | 'header-footer'
  | 'toc'
  | 'service'
  | 'unknown';

export type Block = {
  id: string;
  index: number;
  page?: number;
  type: BlockType;
  // extension: heading depth, used by reflowed view
  level?: 1 | 2;
  text: string;
  rawText?: string;
  imageUri?: string;
  caption?: string;
  isMainContent: boolean;
  /**
   * OCR block ids (from datalab marker) that this narration block visually
   * represents on the page. Set during processing when the VLM is given the
   * OCR layout alongside the image. Used by the Original View to draw
   * polygon overlays. Empty/undefined means "no overlay" (skipped block).
   */
  ocrBlockIds?: string[];
};

export type BookStatus = 'queued' | 'processing' | 'ready' | 'failed';

export type BookSource = {
  kind: 'file' | 'url';
  name: string;
  uri: string;
  mime: string;
};

export type BookProgress = {
  blockIndex: number;
  positionSec: number;
  updatedAt: number;
};

export type ProcessingProgress = {
  stage: 'rendering' | 'analyzing' | 'done';
  done: number;
  total: number;
};

/**
 * Per-book overrides for the global reading settings. Any field that's
 * `undefined` falls back to the global value in `useSettingsStore`. Use
 * `useEffectiveSettings` to resolve the merged view.
 */
export type BookSettingsOverride = {
  speed?: number;
  skipping?: import('./settings').SkippingMode;
  ttsProvider?: import('./settings').TtsProvider;
  voiceId?: string;
  voiceName?: string;
  localVoice?: string;
};

export type Book = {
  id: string;
  title: string;
  source: BookSource;
  coverUri?: string;
  createdAt: number;
  status: BookStatus;
  processingError?: string;
  processingProgress?: ProcessingProgress;
  blocks: Block[];
  progress: BookProgress;
  /** Optional reading-settings override; merged on top of global settings. */
  settingsOverride?: BookSettingsOverride;
};
