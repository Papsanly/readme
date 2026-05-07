/**
 * Types for the Original View feature: per-page OCR layout (polygon, label,
 * text) returned by datalab.to, plus alignment to the VLM-extracted blocks
 * the audio engine reads.
 */

export type OcrBlockId = string;

/**
 * One block in a page's layout — datalab `block_type` (e.g. "Text",
 * "SectionHeader", "Picture", "Caption", "PageHeader"), polygon and bbox in
 * the rasterized page's pixel space, and the raw text content.
 */
export type OcrBlock = {
  id: OcrBlockId;
  /** 1-based page number. */
  pageIndex: number;
  /** Datalab block label. */
  label: string;
  /** Plain-text content (may be empty for pictures). */
  text: string;
  /** Polygon `[x, y][]` in pixels of the rasterization datalab performed. */
  polygon: [number, number][];
  /** Axis-aligned bbox `[x1, y1, x2, y2]`. */
  bbox: [number, number, number, number];
};

export type OcrPage = {
  pageIndex: number;
  /** Page rasterization width in pixels (datalab's coordinate space). */
  width: number;
  /** Page rasterization height in pixels. */
  height: number;
  blocks: OcrBlock[];
};

/**
 * The full OCR layout for a book, produced by datalab marker during the
 * processing pipeline. Cached on disk; the alignment to narration blocks
 * lives directly on `Block.ocrBlockIds`.
 */
export type BookOcr = {
  /** Schema version for forward-compat / migration. */
  version: 1;
  bookId: string;
  /** Generation timestamp (ms since epoch). */
  generatedAt: number;
  pages: OcrPage[];
};
