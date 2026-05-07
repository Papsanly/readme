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
      },
      ocrBlockIds: {
        type: 'array',
        items: { type: 'string' },
        description:
          'OCR block ids from the layout list provided in the user message. List every ' +
          'OCR block whose visual region this narration block represents. Multiple ids when ' +
          'you merged blocks (e.g. list items into prose). Empty array if no OCR block ' +
          'corresponds.'
      }
    },
    required: ['type', 'text', 'isFigure', 'isMainContent', 'ocrBlockIds'],
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
  const target = language
    ? `${language}`
    : "the dominant language of the page's body text (paragraphs, headings — " +
      'NOT labels inside figures or stray foreign abbreviations)';
  return [
    '## Language',
    `Narrate ALL output in ${target}. This applies to every \`text\` field, including:`,
    '- Body text (paragraphs, headings, lists, captions, footnotes).',
    '- **Figure descriptions** — the spoken description in `text` must be in the dominant',
    '  narration language even if the labels INSIDE the figure are in a different language.',
    '  Do not switch to English (or any other language) just because a chart axis or a UI',
    '  screenshot has foreign text on it.',
    '',
    '### Foreign abbreviations, acronyms, technical terms, proper nouns',
    '',
    '**HARD CONSTRAINT**: the `text` field must contain ONLY characters of the target',
    `language's alphabet (plus standard punctuation, digits, spaces). NO Latin letters,`,
    'NO original-script foreign characters, NO mixed-alphabet artifacts. Every foreign',
    'abbreviation, acronym, technical term, and proper noun MUST be expanded into the target',
    "language's phonetic spelling. The verbatim original goes in `rawText` only.",
    '',
    '**DO NOT character-map** Latin letters to visually similar letters in the target',
    'alphabet. Use phonetic transliteration based on how a native speaker would actually',
    'pronounce the term. Common Latin → Russian mistakes to avoid:',
    '- Latin **X** is pronounced **"кс"** (e.g. EXA → "экса"), NOT "х"',
    '- Latin **C** is **"к"** or **"ц"** depending on context, NOT "с"',
    '- Latin **H** is **"х"** or silent depending on origin, NOT "н"',
    '- Latin **W** is **"в"**, NOT "ш"',
    '- Latin **N** is **"н"**, NOT "и"',
    '- Latin **Y** is **"и"** or **"й"**, NOT "у"',
    '',
    '**Use only standard target-alphabet letters**. For Russian use the Russian Cyrillic',
    'alphabet (А-Я, а-я, including Ё/ё, Й/й). Do not use Ukrainian (Є, Ї, Ґ), Belarusian',
    '(Ў), or other Cyrillic-variant letters even if they look phonetically close.',
    '',
    '**Word-style vs letter-style for abbreviations** — choose ONE per term:',
    '- Pronounceable as a single word (3+ letters forming a natural syllable) →',
    '  spell as one continuous word, NO hyphens or spaces between letters.',
    '- Pronounced as a sequence of letter-names → spell each letter separately,',
    '  joined with hyphens. Use this only when the term cannot be pronounced as a word.',
    '',
    'Examples — dominant language **Russian**:',
    '- Word-style (no hyphens): NATO → "нато"; NASA → "наса"; AJAX → "аякс"; EXA → "экса".',
    '- Letter-style (hyphens): USB → "ю-эс-би"; PDF → "пэ-дэ-эф"; FBI → "эф-би-ай"; HTML → "эйч-ти-эм-эл".',
    '- Proper nouns: Apple → "эппл"; Microsoft → "майкрософт"; iPhone → "айфон".',
    '- Diagram with English UI labels → describe in Russian, not in English.',
    '',
    '**WRONG examples to avoid**:',
    '- ❌ "программа EXA" (Latin in `text`) — must be "программа экса"',
    '- ❌ "формат PDF" (Latin in `text`) — must be "формат пэ-дэ-эф"',
    '- ❌ "є-кс-а" or "ЄКСА" (wrong alphabet — that\'s Ukrainian Є, not Russian Э)',
    '- ❌ "э-к-с-а" (over-hyphenated word that should be a single word "экса")',
    '- ❌ "Mixed латиница and кириллица in one word"',
    '',
    'Examples — dominant language **English**:',
    '- "the city of Moscow", `rawText`: "the city of Москва"',
    '- "the company Yandex", `rawText`: "the company Яндекс"',
    '- A diagram with French/Spanish/Russian labels → describe in English.',
    '',
    '### Exception: full-sentence quotations',
    'A complete sentence or paragraph-length quotation in another language stays in the original',
    "language (TTS will speak it with that language's pronunciation). Transliteration applies",
    'only to isolated terms, abbreviations, and short technical names embedded in narration.'
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
    '# OCR layout reference',
    'Alongside the page image, the user content includes a JSON list of OCR layout blocks for',
    'this page. Each entry has `id`, `label` (e.g. "Text", "SectionHeader", "Picture",',
    '"PageHeader"), and the raw on-page text.',
    '',
    'For every narration block you emit, set `ocrBlockIds` to the list of OCR ids whose visual',
    'region the narration block represents. Powers the Original View overlay.',
    '',
    '- 1-to-1 paragraph match: one OCR id.',
    '- You merged several OCR blocks (list items, table rows, chunked text) into one narration',
    '  block: include all of them.',
    '- For `figure` blocks: include the OCR id of the picture/diagram region (and any inner',
    '  sub-block ids that compose the figure). Caption is a separate block per the rules above —',
    '  give the caption block the OCR caption id.',
    '- Service elements (page-number, header-footer, footnote, toc, service): still emit them as',
    '  blocks per classification, with their corresponding OCR id, so overlays line up.',
    '- If no OCR block corresponds (rare — e.g. you described a region that the layout did not',
    '  segment), pass an empty array `[]`.',
    '- Use each OCR id at most once across the page — no double-claiming.',
    '',
    '# Final reminder',
    'Emit exactly one tool call to `emit_blocks`. The `blocks` array must be in narration order.',
    'Every block must include `type`, `text`, `isFigure`, `isMainContent`, and `ocrBlockIds`.',
    'Omit `level`, `rawText`, and `caption` unless they apply.'
  ];

  return sections.filter(s => s.length > 0).join('\n');
}
