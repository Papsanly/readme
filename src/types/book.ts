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
};
