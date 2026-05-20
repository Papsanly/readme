import type { Block } from '@/src/types/book';

const SERVICE_TYPES: ReadonlySet<Block['type']> = new Set([
  'page-number',
  'header-footer',
  'footnote',
  'toc',
  'service'
]);

const PROSE_TYPES: ReadonlySet<Block['type']> = new Set(['paragraph', 'quote']);
const START_TYPES: ReadonlySet<Block['type']> = new Set([
  'heading',
  'paragraph',
  'list',
  'quote',
  'caption',
  'figure'
]);

const MIN_PROSE_CHARS_FOR_MAIN_PAGE = 220;
const MIN_PROSE_BLOCKS_FOR_MAIN_PAGE = 2;

const FRONT_MATTER_RE =
  /\b(table of contents|contents|copyright|isbn|all rights reserved|editor-in-chief|contributing editors|graphic design|writers|shout-outs|brought to you|cover|title page|credits|acknowledg(?:e)?ments|dedication|about the author)\b/i;

function compactText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function isRuntimeContentBlock(block: Block): boolean {
  if (SERVICE_TYPES.has(block.type)) return false;
  if (!block.isMainContent) return false;
  return START_TYPES.has(block.type) || block.type === 'unknown';
}

function isProseBlock(block: Block): boolean {
  return PROSE_TYPES.has(block.type) && isRuntimeContentBlock(block);
}

function pageNumberOf(block: Block): number {
  return block.page ?? 1;
}

type IndexedBlock = {
  index: number;
  block: Block;
};

function groupBlocksByPage(blocks: readonly Block[]): IndexedBlock[][] {
  const pages = new Map<number, IndexedBlock[]>();
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block) continue;
    const page = pageNumberOf(block);
    const existing = pages.get(page);
    if (existing) existing.push({ index, block });
    else pages.set(page, [{ index, block }]);
  }
  return Array.from(pages.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, pageBlocks]) => pageBlocks);
}

function isLikelyTocOrFrontMatterPage(pageBlocks: readonly IndexedBlock[]): boolean {
  const pageText = compactText(
    pageBlocks.map(({ block }) => block.rawText ?? block.text).join(' ')
  );
  if (FRONT_MATTER_RE.test(pageText)) return true;

  const contentBlocks = pageBlocks.filter(({ block }) => isRuntimeContentBlock(block));
  if (contentBlocks.length === 0) return true;

  const proseBlocks = contentBlocks.filter(({ block }) => isProseBlock(block));
  const proseChars = proseBlocks.reduce(
    (sum, { block }) => sum + compactText(block.rawText ?? block.text).length,
    0
  );
  const hasSustainedProse =
    proseBlocks.length >= MIN_PROSE_BLOCKS_FOR_MAIN_PAGE ||
    proseChars >= MIN_PROSE_CHARS_FOR_MAIN_PAGE;

  const tocLikeBlocks = pageBlocks.filter(({ block }) => block.type === 'toc').length;
  const listLikeBlocks = contentBlocks.filter(({ block }) => block.type === 'list').length;
  const shortBlocks = contentBlocks.filter(
    ({ block }) => compactText(block.rawText ?? block.text).length < 140
  ).length;

  if (!hasSustainedProse && tocLikeBlocks >= Math.max(1, contentBlocks.length / 3)) return true;
  if (!hasSustainedProse && listLikeBlocks >= Math.max(2, contentBlocks.length / 2)) return true;
  if (!hasSustainedProse && shortBlocks >= Math.max(3, contentBlocks.length * 0.75)) return true;

  return false;
}

function firstContentIndexOnCandidatePage(pageBlocks: readonly IndexedBlock[]): number | null {
  const firstBody = pageBlocks.find(({ block }) => isProseBlock(block));
  if (!firstBody) {
    return pageBlocks.find(({ block }) => isRuntimeContentBlock(block))?.index ?? null;
  }

  // If the page has a heading immediately before the first body paragraph,
  // start from that heading. This preserves natural "Chapter title → text"
  // playback instead of dropping the title.
  const headingBeforeBody = pageBlocks
    .filter(
      ({ index, block }) =>
        index < firstBody.index && block.type === 'heading' && isRuntimeContentBlock(block)
    )
    .at(-1);

  return headingBeforeBody?.index ?? firstBody.index;
}

/**
 * Book-level "start of real content" heuristic.
 *
 * Per-page VLM classification is intentionally local: cover titles, credits,
 * contents pages, ads, and decorative headings can still be marked as
 * `isMainContent` because they are meaningful on that page. The player-level
 * skip needs a wider view, so this scans the whole processed book and picks
 * the first page that contains sustained prose, then starts at that page's
 * heading/prose block.
 */
export function findSmartMainContentIndex(blocks: readonly Block[]): number | null {
  const pages = groupBlocksByPage(blocks);

  for (const pageBlocks of pages) {
    if (isLikelyTocOrFrontMatterPage(pageBlocks)) continue;

    const proseBlocks = pageBlocks.filter(({ block }) => isProseBlock(block));
    const proseChars = proseBlocks.reduce(
      (sum, { block }) => sum + compactText(block.rawText ?? block.text).length,
      0
    );
    const hasEnoughProse =
      proseBlocks.length >= MIN_PROSE_BLOCKS_FOR_MAIN_PAGE ||
      proseChars >= MIN_PROSE_CHARS_FOR_MAIN_PAGE;

    if (!hasEnoughProse) continue;

    return firstContentIndexOnCandidatePage(pageBlocks);
  }

  // Deliberately no fallback to the first `isMainContent` block: on many books
  // cover, credits, and TOC entries are locally meaningful, but they are not
  // the start of the actual text. Until sustained prose is observed, hide the
  // skip target instead of jumping to the wrong page.
  return null;
}
