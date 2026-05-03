import type { BlockType } from '@/src/types/book';
import type { SkippingMode } from '@/src/types/settings';
import type { VlmContext } from '@/src/types/vlm';

/**
 * Single source of truth for the BlockType enum. The `satisfies` clause makes
 * this a compile error if it ever drifts from the union in `types/book.ts`.
 */
export const BLOCK_TYPES = [
  'heading',
  'paragraph',
  'list',
  'quote',
  'caption',
  'figure',
  'page-number',
  'footnote',
  'header-footer',
  'toc',
  'service',
  'unknown'
] as const satisfies readonly BlockType[];

/** Minimal JSON Schema discriminated union covering what `emit_blocks` needs. */
export type JsonSchema =
  | {
      type: 'object';
      properties: Record<string, JsonSchema>;
      required?: string[];
      additionalProperties?: boolean;
      description?: string;
    }
  | {
      type: 'array';
      items: JsonSchema;
      description?: string;
    }
  | {
      type: 'string';
      enum?: readonly string[];
      minLength?: number;
      description?: string;
    }
  | {
      type: 'integer';
      enum?: readonly number[];
      minimum?: number;
      maximum?: number;
      description?: string;
    }
  | {
      type: 'boolean';
      description?: string;
    };

/** JSON Schema for the `emit_blocks` tool's `input` argument. */
export function buildEmitBlocksToolSchema(): JsonSchema {
  const blockSchema: JsonSchema = {
    type: 'object',
    description: 'A single narration-ready block extracted from the page.',
    properties: {
      type: {
        type: 'string',
        enum: BLOCK_TYPES,
        description: 'Semantic block class. Use "unknown" only when truly unsure.'
      },
      text: {
        type: 'string',
        minLength: 1,
        description:
          'TTS-normalized narration text. May include ElevenLabs audio tags inline. ' +
          'For figures, a 1-3 sentence spoken description.'
      },
      rawText: {
        type: 'string',
        description: 'Verbatim on-page text, before TTS normalization. Optional.'
      },
      caption: {
        type: 'string',
        description: 'Verbatim on-page caption text. Use only for figure blocks.'
      },
      isFigure: {
        type: 'boolean',
        description: 'True only for image/diagram/chart/table blocks.'
      },
      isMainContent: {
        type: 'boolean',
        description: 'See per-type matrix in the system prompt.'
      },
      level: {
        type: 'integer',
        enum: [1, 2],
        description: 'Heading depth. 1 = chapter-level, 2 = sub-section. Headings only.'
      }
    },
    required: ['type', 'text', 'isFigure', 'isMainContent'],
    additionalProperties: false
  };

  return {
    type: 'object',
    properties: {
      blocks: {
        type: 'array',
        items: blockSchema,
        description: 'Blocks in correct narration order.'
      }
    },
    required: ['blocks'],
    additionalProperties: false
  };
}

function skippingGuidance(mode: SkippingMode): string {
  switch (mode) {
    case 'main-only':
      return (
        'User wants ONLY main narrative content. Be aggressive in marking front-matter ' +
        '(epigraphs, acknowledgments, dedications, foreword, preface, copyright pages) as ' +
        '`service` unless they contain core book content. Set `isMainContent: false` for any ' +
        'block that is not part of the running narrative.'
      );
    case 'service-only':
      return (
        'User wants service elements skipped (page numbers, running heads/footers, isolated ' +
        'footnotes, ISBN/copyright lines). Keep all main content including front-matter ' +
        '(foreword, preface, dedications) as `isMainContent: true`.'
      );
    case 'none':
      return (
        'User wants everything narrated. Mark every block as `isMainContent: true` unless it is ' +
        'genuinely meaningless to a listener (bare page numbers, isolated SKUs/barcodes, ' +
        'standalone running headers that just repeat the chapter title).'
      );
  }
}

function glossarySection(glossary: VlmContext['glossary']): string {
  if (!glossary || glossary.length === 0) return '';
  const lines = glossary.map(g => `- "${g.term}" → pronounce as "${g.pronunciation}"`).join('\n');
  return [
    '## Pronunciation overrides',
    'When any of these terms appear on the page, replace the term in the `text` field with the',
    'phonetic spelling shown so ElevenLabs pronounces it correctly. Keep the original spelling in',
    '`rawText`.',
    '',
    lines
  ].join('\n');
}

function bookContextSection(ctx: VlmContext): string {
  if (!ctx.bookTitle && !ctx.bookDescription) return '';
  const parts: string[] = ['## Book context'];
  if (ctx.bookTitle) parts.push(`- Title: ${ctx.bookTitle}`);
  if (ctx.bookDescription) parts.push(`- Description: ${ctx.bookDescription}`);
  parts.push(
    'Use this context to disambiguate names, technical terms, and tone. Do not invent narration ' +
      'that is not on the page.'
  );
  return parts.join('\n');
}

function languageSection(language: string | undefined): string {
  if (language) {
    return [
      '## Language',
      `Narrate in ${language}. If the page contains text in another language, transliterate ` +
        'or translate only when narration in that language would be incomprehensible to the ' +
        'listener; otherwise preserve the original.'
    ].join('\n');
  }
  return [
    '## Language',
    'Match the language of the page. If the page is multilingual, keep each span in its ' +
      'original language.'
  ].join('\n');
}

/** Build the full system prompt for a single VLM page-analysis call. */
export function buildVlmSystemPrompt(ctx: VlmContext): string {
  const sections: string[] = [
    '# Role',
    'You are an OCR + TTS-normalization assistant for an audiobook generator. You receive one',
    'page image at a time and emit narration-ready blocks in correct reading order. The output',
    'feeds directly into ElevenLabs text-to-speech, so audible quality is the only acceptable bar.',
    '',
    '# Output protocol',
    'You MUST call the `emit_blocks` tool exactly once with `{ blocks: VlmBlock[] }`. Do not',
    'produce any text response outside the tool call. Do not call any other tool.',
    '',
    '# TTS normalization rules',
    '## Punctuation drives prosody',
    '- Use commas for short, natural pauses inside a clause.',
    '- Use periods for full sentence breaks.',
    '- Use em-dashes ("—") for parenthetical emphasis or interruption.',
    '- Use ellipses ("...") sparingly for trailing thought.',
    '',
    '## Expand non-spoken forms into spoken form',
    '- Abbreviations: `Dr.` → `Doctor`, `Mr.` → `Mister`, `St.` → `Saint` (or `Street` from',
    '  context), `etc.` → `et cetera`, `vs.` → `versus`, `e.g.` → `for example`.',
    '- Years: `2025` → `twenty twenty-five`, `1999` → `nineteen ninety-nine`.',
    '- Times: `12:30 PM` → `twelve thirty PM`, `08:05` → `eight oh five`.',
    '- Currency: `$1,234.56` → `one thousand two hundred thirty-four dollars and fifty-six',
    '  cents`. `€10` → `ten euros`.',
    '- Units: `25 km/h` → `twenty-five kilometers per hour`, `5 kg` → `five kilograms`,',
    '  `3.5 GHz` → `three point five gigahertz`.',
    '- Roman numerals in chapter titles or regnal names: convert to cardinal/ordinal when',
    '  natural — `Chapter IV` → `Chapter Four`, `Henry VIII` → `Henry the Eighth`.',
    '- URLs / emails: read as `dot` and `at`, omit protocol noise unless meaningful.',
    '- Standalone numerals → spelled out where it reads naturally; keep numerals when the',
    '  exact figure matters in technical content.',
    '',
    '## Audio tags (use sparingly)',
    'Inline ElevenLabs audio tags only where context warrants them — fiction dialogue, dramatic',
    'narration. Available tags include `[whispers]`, `[laughs softly]`, `[sighs]`, `[pause]`.',
    'Place them inside `text`, immediately before the affected span. Do NOT add tags to',
    'expository, technical, or factual content. Never tag a heading.',
    '',
    '## Reading flow',
    '- Combine sentences across hard line breaks.',
    '- Repair words split by end-of-line hyphenation (`know-\\nledge` → `knowledge`).',
    '- Preserve paragraph boundaries — emit a new `paragraph` block per paragraph.',
    '- Never invent narration that is not on the page. Never paraphrase factual content.',
    '',
    '# Block classification',
    '- `heading`: chapter, section, or sub-section title. Set `level: 1` for chapter-level,',
    '  `level: 2` for sub-sections. Do not nest deeper.',
    '- `paragraph`: body prose.',
    '- `list`: a bulleted or numbered list. Emit one block per logical list group. Convert',
    '  bullets/numbers into spoken connectives ("First, ... Second, ...") when natural;',
    '  otherwise drop the markers.',
    '- `quote`: block quote or pull quote.',
    '- `caption`: figure or table caption — emit as a SEPARATE block from the figure itself.',
    '- `figure`: image, diagram, chart, or table. Set `isFigure: true`. Put a concise spoken',
    '  description (1-3 sentences) of what the figure shows in `text`. If the page also has a',
    '  printed caption, copy its verbatim text into `caption` AND emit a separate `caption`',
    '  block immediately after the figure.',
    '- `page-number`: a running page number.',
    '- `footnote`: a footnote or endnote.',
    '- `header-footer`: a running head or running footer.',
    '- `toc`: a table-of-contents entry.',
    '- `service`: copyright lines, ISBN, "Printed in...", colophon, legal boilerplate, and any',
    '  other element that is not part of the content.',
    '- `unknown`: fallback only when classification is genuinely impossible.',
    '',
    '# isMainContent matrix',
    '- `heading | paragraph | list | quote | caption | figure` → always `true`.',
    '- `page-number | footnote | header-footer | toc | service` → always `false`.',
    '- `unknown` → use best judgment based on whether a listener would expect to hear it.',
    'This field is emitted independently of the user skipping mode below — the player decides',
    'what to actually skip.',
    '',
    '# Skipping mode (informational)',
    skippingGuidance(ctx.skipping),
    '',
    '# Reading order',
    '- Top-to-bottom, left-to-right by default.',
    '- Multi-column layouts: finish the left column before moving to the right column (or the',
    '  reverse direction for right-to-left scripts).',
    '- For sidebars, callouts, pull quotes embedded mid-flow: emit them at the point where a',
    '  reader would naturally pause — typically after the paragraph they interrupt.',
    '- For figures with surrounding text: emit the figure (and its caption) at the position',
    '  where the printed page references or introduces it.',
    '',
    bookContextSection(ctx),
    '',
    glossarySection(ctx.glossary),
    '',
    languageSection(ctx.language),
    '',
    '# Final reminder',
    'Emit exactly one tool call to `emit_blocks`. The `blocks` array must be in narration order.',
    'Every block must include `type`, `text`, `isFigure`, and `isMainContent`. Omit `level`,',
    '`rawText`, and `caption` unless they apply.'
  ];

  return sections.filter(s => s.length > 0).join('\n');
}
