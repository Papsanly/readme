import type { VoiceSettings } from '@/src/types/voice';

const DEFAULT_TIMEOUT_MS = 60_000;
const ERROR_BODY_TRUNCATION = 1_000;
const DEFAULT_MODEL = 'tts-1';
const DEFAULT_VOICE = 'alloy';
/** Standard mp3 — same format as the ElevenLabs branch so the audio cache stays uniform. */
const RESPONSE_FORMAT = 'mp3';

/** Thrown when the OpenAI-compatible TTS server is not configured. */
export class MissingOpenAiTtsConfigError extends Error {
  constructor(message = 'OpenAI-compatible TTS provider is not configured') {
    super(message);
    this.name = 'MissingOpenAiTtsConfigError';
  }
}

/** Thrown when the OpenAI-compatible TTS server returns a non-2xx response. */
export class OpenAiTtsError extends Error {
  readonly status?: number;
  readonly cause?: unknown;

  constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message);
    this.name = 'OpenAiTtsError';
    this.status = options.status;
    this.cause = options.cause;
  }
}

export type OpenAiCompatibleTtsClientOptions = {
  /** Base URL of the server, e.g. `http://localhost:8880` or `https://api.openai.com`. */
  baseUrl: string;
  /** Optional bearer token. Most self-hosted servers don't require one. */
  apiKey?: string;
  /** Voice id (server-specific; e.g. `alloy`, `af_bella`, `en_US-amy-medium`). */
  defaultVoice?: string;
  /** Model id (server-specific; defaults to `tts-1` for compatibility). */
  defaultModel?: string;
  /** Per-request timeout in ms; defaults to 60s. */
  requestTimeoutMs?: number;
};

export type OpenAiSynthesizeOptions = {
  /** Overrides the client default. */
  voiceId?: string;
  text: string;
  voiceSettings?: VoiceSettings;
};

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…(${s.length - max} more chars)`;
}

/**
 * TTS client speaking the OpenAI `/v1/audio/speech` protocol. Works with
 * OpenAI itself as well as self-hosted servers like Kokoro-FastAPI and
 * openedai-speech.
 */
export class OpenAiCompatibleTtsClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly defaultVoice: string;
  private readonly defaultModel: string;
  private readonly requestTimeoutMs: number;

  constructor(options: OpenAiCompatibleTtsClientOptions) {
    if (!options.baseUrl) throw new MissingOpenAiTtsConfigError('baseUrl is required');
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.defaultVoice = options.defaultVoice ?? DEFAULT_VOICE;
    this.defaultModel = options.defaultModel ?? DEFAULT_MODEL;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async synthesize(opts: OpenAiSynthesizeOptions): Promise<Uint8Array> {
    const text = opts.text;
    if (!text) throw new OpenAiTtsError('synthesize: text is required');

    const url = `${this.baseUrl}/v1/audio/speech`;
    const body: Record<string, unknown> = {
      model: this.defaultModel,
      input: text,
      voice: opts.voiceId ?? this.defaultVoice,
      response_format: RESPONSE_FORMAT
    };
    const speed = opts.voiceSettings?.speed;
    if (typeof speed === 'number' && Number.isFinite(speed)) {
      body.speed = speed;
    }

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'audio/mpeg'
    };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new OpenAiTtsError(
          `OpenAI-compatible TTS timed out after ${this.requestTimeoutMs}ms`,
          {
            cause: err
          }
        );
      }
      throw new OpenAiTtsError(`OpenAI-compatible TTS request failed: ${url}`, { cause: err });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch {
        // Ignore.
      }
      throw new OpenAiTtsError(
        `OpenAI-compatible TTS returned HTTP ${response.status}: ${truncate(errorBody, ERROR_BODY_TRUNCATION)}`,
        { status: response.status }
      );
    }

    let buffer: ArrayBuffer;
    try {
      buffer = await response.arrayBuffer();
    } catch (err) {
      throw new OpenAiTtsError('OpenAI-compatible TTS response body could not be read', {
        cause: err
      });
    }
    const bytes = new Uint8Array(buffer);
    if (bytes.byteLength === 0) {
      throw new OpenAiTtsError('OpenAI-compatible TTS returned an empty audio body', {
        status: response.status
      });
    }
    return bytes;
  }
}
