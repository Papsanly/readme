import type { BlockType } from './book';
import type { SkippingMode } from './settings';

/** Single narration-ready block emitted by the VLM for one page. */
export type VlmBlock = {
  type: BlockType;
  /** TTS-normalized text, may include inline ElevenLabs audio tags. */
  text: string;
  /** Verbatim on-page text, before TTS normalization. */
  rawText?: string;
  /** Verbatim on-page caption, used only for figure blocks. */
  caption?: string;
  /** True only when this block represents an image, diagram, chart, or table. */
  isFigure: boolean;
  /** Drives downstream skipping; see prompt for the per-type matrix. */
  isMainContent: boolean;
  /** Heading depth: 1 for chapter-level, 2 for sub-section. */
  level?: 1 | 2;
  /**
   * OCR block ids (from the datalab layout passed alongside the image) whose
   * visual region this narration block represents. Used for Original View
   * polygon overlays. Empty when no OCR id corresponds (e.g. fully-skipped
   * service elements emitted only for completeness).
   */
  ocrBlockIds?: string[];
};

/** Result of analyzing a single page. */
export type VlmPageResult = {
  blocks: VlmBlock[];
};

/** Per-book context that personalizes VLM extraction. */
export type VlmContext = {
  bookTitle?: string;
  bookDescription?: string;
  /** Pronunciation hints injected into the system prompt. */
  glossary?: { term: string; pronunciation: string }[];
  skipping: SkippingMode;
  /** Force a target language; omit to let the model match the page. */
  language?: string;
};

/** A minimal view of an OCR block for the VLM input — id, label, raw text. */
export type VlmOcrBlockHint = {
  id: string;
  label: string;
  text: string;
};

/**
 * Image MIME types accepted by the Anthropic vision API. Other source
 * formats must be converted to one of these before calling `analyzePage`.
 */
export type VlmImageMimeType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

/** Input to `VlmClient.analyzePage`. */
export type VlmAnalyzePageInput = {
  /** Base64-encoded image bytes (must match `imageMimeType`). */
  imageBase64: string;
  /** MIME type of `imageBase64`. Defaults to `image/png` if omitted. */
  imageMimeType?: VlmImageMimeType;
  context: VlmContext;
  pageNumber: number;
  totalPages: number;
  /**
   * datalab OCR layout blocks for this page. Passed in the user content
   * alongside the image so the model can reference them via `ocrBlockIds`.
   */
  ocrBlocks: VlmOcrBlockHint[];
};

/** Vision-language model client used by the processing pipeline. */
export interface VlmClient {
  analyzePage(input: VlmAnalyzePageInput): Promise<VlmPageResult>;
}
