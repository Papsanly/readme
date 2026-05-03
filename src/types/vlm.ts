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

/** Input to `VlmClient.analyzePage`. */
export type VlmAnalyzePageInput = {
  /** Base64-encoded PNG of the page. */
  imageBase64: string;
  context: VlmContext;
  pageNumber: number;
  totalPages: number;
};

/** Vision-language model client used by the processing pipeline. */
export interface VlmClient {
  analyzePage(input: VlmAnalyzePageInput): Promise<VlmPageResult>;
}
