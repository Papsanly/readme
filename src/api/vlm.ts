import {
  buildVlmSystemPrompt,
  buildEmitBlocksToolSchema,
  BLOCK_TYPES
} from '@/src/pipeline/prompt';
import type { Block, BlockType } from '@/src/types/book';
import type { VlmAnalyzePageInput, VlmBlock, VlmClient, VlmPageResult } from '@/src/types/vlm';
import { newId } from '@/src/utils/id';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_TIMEOUT_MS = 120_000;
const ANTHROPIC_VERSION = '2023-06-01';
const TOOL_NAME = 'emit_blocks';
const ERROR_BODY_TRUNCATION = 1_000;
const BLOCK_TYPE_SET: ReadonlySet<BlockType> = new Set(BLOCK_TYPES);

/** Thrown when no Anthropic API key is configured. */
export class MissingAnthropicKeyError extends Error {
  constructor(message = 'EXPO_PUBLIC_ANTHROPIC_API_KEY is not set') {
    super(message);
    this.name = 'MissingAnthropicKeyError';
  }
}

/** Thrown when Anthropic returns a malformed or unexpected response. */
export class VlmResponseError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'VlmResponseError';
    this.cause = cause;
  }
}

type AnthropicTextBlock = { type: 'text'; text: string };
type AnthropicToolUseBlock = { type: 'tool_use'; id: string; name: string; input: unknown };
type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | { type: string };

type AnthropicMessageResponse = {
  id?: string;
  type?: string;
  role?: string;
  model?: string;
  content?: AnthropicContentBlock[];
  stop_reason?: string;
};

type AnthropicVlmClientOptions = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Defaults to 120_000. */
  requestTimeoutMs?: number;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function readEnvKey(): string | undefined {
  const v = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…(${s.length - max} more chars)`;
}

function findToolUseInput(content: AnthropicContentBlock[] | undefined): unknown {
  if (!content) return undefined;
  for (const block of content) {
    if (block.type === 'tool_use' && (block as AnthropicToolUseBlock).name === TOOL_NAME) {
      return (block as AnthropicToolUseBlock).input;
    }
  }
  return undefined;
}

function coerceLevel(v: unknown): 1 | 2 | undefined {
  if (v === 1 || v === 2) return v;
  return undefined;
}

function coerceOptionalString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function validateVlmBlock(raw: unknown): VlmBlock | undefined {
  if (!isObject(raw)) return undefined;

  const { type, text, isFigure, isMainContent, rawText, caption, level, ocrBlockIds } = raw;

  if (typeof type !== 'string' || !BLOCK_TYPE_SET.has(type as BlockType)) return undefined;
  if (typeof text !== 'string' || text.length === 0) return undefined;
  if (typeof isFigure !== 'boolean') return undefined;
  if (typeof isMainContent !== 'boolean') return undefined;

  const block: VlmBlock = {
    type: type as BlockType,
    text,
    isFigure,
    isMainContent
  };

  const rt = coerceOptionalString(rawText);
  if (rt) block.rawText = rt;

  const cap = coerceOptionalString(caption);
  if (cap) block.caption = cap;

  const lvl = coerceLevel(level);
  if (lvl) block.level = lvl;

  if (Array.isArray(ocrBlockIds)) {
    const ids: string[] = [];
    for (const id of ocrBlockIds) {
      if (typeof id === 'string' && id.length > 0) ids.push(id);
    }
    if (ids.length > 0) block.ocrBlockIds = ids;
  }

  return block;
}

function parsePageResult(input: unknown): VlmPageResult {
  if (!isObject(input) || !Array.isArray(input.blocks)) {
    throw new VlmResponseError(
      `tool_use input is missing a "blocks" array. Got: ${truncate(JSON.stringify(input), ERROR_BODY_TRUNCATION)}`
    );
  }

  const out: VlmBlock[] = [];
  for (let i = 0; i < input.blocks.length; i += 1) {
    const validated = validateVlmBlock(input.blocks[i]);
    if (validated) {
      out.push(validated);
    } else {
      console.warn(
        `[vlm] dropping malformed block at index ${i}: ${truncate(JSON.stringify(input.blocks[i]), 200)}`
      );
    }
  }

  return { blocks: out };
}

/** Anthropic Claude vision client targeting `claude-sonnet-4-6` with tool-use output. */
export class AnthropicVlmClient implements VlmClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;

  constructor(options: AnthropicVlmClientOptions = {}) {
    const apiKey = options.apiKey ?? readEnvKey();
    if (!apiKey) throw new MissingAnthropicKeyError();
    this.apiKey = apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Run the VLM on a single page image and return narration-ready blocks. */
  async analyzePage(input: VlmAnalyzePageInput): Promise<VlmPageResult> {
    const system = buildVlmSystemPrompt(input.context);
    const toolSchema = buildEmitBlocksToolSchema();

    // OCR layout JSON — flat list, model maps narration blocks to these ids
    // via the `ocrBlockIds` field in its tool output. Truncate per-block text
    // so a page of long blocks doesn't blow the prompt budget.
    const ocrJson = JSON.stringify(
      input.ocrBlocks.map(b => ({ id: b.id, label: b.label, text: b.text.slice(0, 600) }))
    );

    const body = {
      model: this.model,
      max_tokens: 8192,
      system,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: input.imageMimeType ?? 'image/png',
                data: input.imageBase64
              }
            },
            {
              type: 'text',
              text: [
                `Page ${input.pageNumber} of ${input.totalPages}.`,
                'Emit narration blocks via the emit_blocks tool.',
                '',
                'OCR layout blocks for this page (use the ids in your ocrBlockIds field):',
                ocrJson
              ].join('\n')
            }
          ]
        }
      ],
      tools: [
        {
          name: TOOL_NAME,
          description: 'Emit narration-ready blocks from the page in correct reading order.',
          input_schema: toolSchema
        }
      ],
      tool_choice: { type: 'tool', name: TOOL_NAME }
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new VlmResponseError(
          `Anthropic request timed out after ${this.requestTimeoutMs}ms`,
          err
        );
      }
      throw new VlmResponseError('Anthropic request failed before receiving a response', err);
    } finally {
      clearTimeout(timeout);
    }

    const rawBody = await response.text();
    if (!response.ok) {
      throw new VlmResponseError(
        `Anthropic returned HTTP ${response.status}: ${truncate(rawBody, ERROR_BODY_TRUNCATION)}`
      );
    }

    let parsed: AnthropicMessageResponse;
    try {
      parsed = JSON.parse(rawBody) as AnthropicMessageResponse;
    } catch (err) {
      throw new VlmResponseError(
        `Anthropic returned non-JSON body: ${truncate(rawBody, ERROR_BODY_TRUNCATION)}`,
        err
      );
    }

    const toolInput = findToolUseInput(parsed.content);
    if (toolInput === undefined) {
      throw new VlmResponseError(
        `Anthropic response is missing a "${TOOL_NAME}" tool_use block. Body: ${truncate(rawBody, ERROR_BODY_TRUNCATION)}`
      );
    }

    return parsePageResult(toolInput);
  }
}

let cachedDefaultClient: VlmClient | undefined;

/** Lazy singleton VlmClient backed by `EXPO_PUBLIC_ANTHROPIC_API_KEY`. */
export function getDefaultVlmClient(): VlmClient {
  if (!cachedDefaultClient) {
    cachedDefaultClient = new AnthropicVlmClient();
  }
  return cachedDefaultClient;
}

/** Convert a VLM block plus page/index metadata into a partial app `Block`. */
export function vlmBlockToBlock(
  vlm: VlmBlock,
  page: number,
  index: number
): Omit<Block, 'imageUri'> {
  const block: Omit<Block, 'imageUri'> = {
    id: newId('blk'),
    index,
    page,
    type: vlm.type,
    text: vlm.text,
    isMainContent: vlm.isMainContent
  };
  if (vlm.rawText) block.rawText = vlm.rawText;
  if (vlm.caption) block.caption = vlm.caption;
  if (vlm.level) block.level = vlm.level;
  if (vlm.ocrBlockIds && vlm.ocrBlockIds.length > 0) block.ocrBlockIds = vlm.ocrBlockIds;
  return block;
}
