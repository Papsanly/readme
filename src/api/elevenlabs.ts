import type { Voice, VoiceSettings, VoicesPage } from '@/src/types/voice';

const DEFAULT_BASE_URL = 'https://api.elevenlabs.io';
const DEFAULT_MODEL_ID = 'eleven_v3';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_PAGE_SIZE = 30;
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';
const DESCRIPTION_MAX_LEN = 240;
const ERROR_BODY_TRUNCATION = 1_000;

const SPEED_MIN = 0.7;
const SPEED_MAX = 1.2;

/**
 * Maximum concurrent TTS requests across the entire app. ElevenLabs free
 * tiers cap concurrent requests at 3; we limit ourselves to 2 to leave one
 * slot of headroom for retries and to avoid 429 `concurrent_limit_exceeded`
 * errors during streaming playback.
 */
const TTS_MAX_CONCURRENCY = 2;

let ttsInFlight = 0;
const ttsWaiters: (() => void)[] = [];

function acquireTtsSlot(): Promise<void> {
  return new Promise<void>(resolve => {
    const tryAcquire = (): void => {
      if (ttsInFlight < TTS_MAX_CONCURRENCY) {
        ttsInFlight += 1;
        resolve();
        return;
      }
      ttsWaiters.push(tryAcquire);
    };
    tryAcquire();
  });
}

function releaseTtsSlot(): void {
  ttsInFlight -= 1;
  const next = ttsWaiters.shift();
  if (next) next();
}

/** Thrown when no ElevenLabs API key is configured. */
export class MissingElevenLabsKeyError extends Error {
  constructor(message = 'EXPO_PUBLIC_ELEVENLABS_API_KEY is not set') {
    super(message);
    this.name = 'MissingElevenLabsKeyError';
  }
}

/** Thrown when ElevenLabs returns a non-2xx HTTP status or a malformed response. */
export class ElevenLabsError extends Error {
  readonly status?: number;
  readonly cause?: unknown;

  constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message);
    this.name = 'ElevenLabsError';
    this.status = options.status;
    this.cause = options.cause;
  }
}

export type ElevenLabsClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  /** Default model id used by `synthesize`. */
  modelId?: string;
  /** Per-request timeout in milliseconds. Defaults to 60_000. */
  requestTimeoutMs?: number;
};

export type ListVoicesOptions = {
  search?: string;
  pageSize?: number;
  nextPageToken?: string;
};

export type SynthesizeOptions = {
  voiceId: string;
  text: string;
  voiceSettings?: VoiceSettings;
};

/**
 * Per-character timing emitted by ElevenLabs' `/with-timestamps` endpoint.
 * `characters[i]` plays from `startTimesSec[i]` to `endTimesSec[i]`. The
 * indices line up 1:1 with the original input text characters (including
 * spaces and punctuation), so `text.charAt(i)` and `characters[i]` agree.
 */
export type TtsAlignment = {
  characters: string[];
  startTimesSec: number[];
  endTimesSec: number[];
};

export type SynthesizeWithTimestampsResult = {
  bytes: Uint8Array;
  alignment: TtsAlignment;
};

type RawAlignment = {
  characters?: unknown;
  character_start_times_seconds?: unknown;
  character_end_times_seconds?: unknown;
};

type RawWithTimestampsResponse = {
  audio_base64?: unknown;
  alignment?: RawAlignment;
  normalized_alignment?: RawAlignment;
};

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function coerceAlignment(raw: RawAlignment | undefined): TtsAlignment | undefined {
  if (!raw) return undefined;
  const chars = raw.characters;
  const starts = raw.character_start_times_seconds;
  const ends = raw.character_end_times_seconds;
  if (!Array.isArray(chars) || !Array.isArray(starts) || !Array.isArray(ends)) return undefined;
  const n = Math.min(chars.length, starts.length, ends.length);
  if (n === 0) return undefined;
  const characters: string[] = new Array(n);
  const startTimesSec: number[] = new Array(n);
  const endTimesSec: number[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    characters[i] = typeof chars[i] === 'string' ? (chars[i] as string) : '';
    startTimesSec[i] = typeof starts[i] === 'number' ? (starts[i] as number) : 0;
    endTimesSec[i] = typeof ends[i] === 'number' ? (ends[i] as number) : startTimesSec[i];
  }
  return { characters, startTimesSec, endTimesSec };
}

type RawVoice = {
  voice_id?: unknown;
  name?: unknown;
  category?: unknown;
  description?: unknown;
  preview_url?: unknown;
  labels?: unknown;
};

type RawVoicesResponse = {
  voices?: unknown;
  has_more?: unknown;
  next_page_token?: unknown;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function readEnvKey(): string | undefined {
  const v = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY;
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…(${s.length - max} more chars)`;
}

function clampSpeed(v: number): number {
  if (!Number.isFinite(v)) return 1;
  if (v < SPEED_MIN) return SPEED_MIN;
  if (v > SPEED_MAX) return SPEED_MAX;
  return v;
}

function coerceLabels(raw: unknown): Record<string, string> | undefined {
  if (!isObject(raw)) return undefined;
  const out: Record<string, string> = {};
  let count = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') {
      out[k] = v;
      count += 1;
    }
  }
  return count > 0 ? out : undefined;
}

function mapRawVoice(raw: unknown): Voice | undefined {
  if (!isObject(raw)) return undefined;
  const r = raw as RawVoice;
  if (typeof r.voice_id !== 'string' || r.voice_id.length === 0) return undefined;
  if (typeof r.name !== 'string' || r.name.length === 0) return undefined;

  const voice: Voice = { id: r.voice_id, name: r.name };

  if (typeof r.category === 'string' && r.category.length > 0) {
    voice.category = r.category;
  }
  if (typeof r.description === 'string' && r.description.length > 0) {
    voice.description = truncate(r.description, DESCRIPTION_MAX_LEN);
  }
  if (typeof r.preview_url === 'string' && r.preview_url.length > 0) {
    voice.previewUrl = r.preview_url;
  }
  const labels = coerceLabels(r.labels);
  if (labels) voice.labels = labels;

  return voice;
}

type ApiVoiceSettings = {
  stability?: number;
  similarity_boost?: number;
  style?: number;
  use_speaker_boost?: boolean;
  speed?: number;
};

function mapVoiceSettings(s: VoiceSettings | undefined): ApiVoiceSettings | undefined {
  if (!s) return undefined;
  const out: ApiVoiceSettings = {};
  if (typeof s.stability === 'number') out.stability = s.stability;
  if (typeof s.similarityBoost === 'number') out.similarity_boost = s.similarityBoost;
  if (typeof s.style === 'number') out.style = s.style;
  if (typeof s.useSpeakerBoost === 'boolean') out.use_speaker_boost = s.useSpeakerBoost;
  if (typeof s.speed === 'number') out.speed = clampSpeed(s.speed);
  return Object.keys(out).length > 0 ? out : undefined;
}

/** ElevenLabs REST client targeting the v1 voices and text-to-speech endpoints. */
export class ElevenLabsClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly modelId: string;
  private readonly requestTimeoutMs: number;

  constructor(options: ElevenLabsClientOptions = {}) {
    const apiKey = options.apiKey ?? readEnvKey();
    if (!apiKey) throw new MissingElevenLabsKeyError();
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.modelId = options.modelId ?? DEFAULT_MODEL_ID;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** List voices available to the API key, paginated by an opaque cursor. */
  async listVoices(opts: ListVoicesOptions = {}): Promise<VoicesPage> {
    const params = new URLSearchParams();
    params.set('page_size', String(opts.pageSize ?? DEFAULT_PAGE_SIZE));
    if (opts.search) params.set('search', opts.search);
    if (opts.nextPageToken) params.set('next_page_token', opts.nextPageToken);

    const url = `${this.baseUrl}/v2/voices?${params.toString()}`;
    const response = await this.fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        'xi-api-key': this.apiKey,
        accept: 'application/json'
      }
    });

    const rawBody = await response.text();
    if (!response.ok) {
      throw new ElevenLabsError(
        `ElevenLabs /v2/voices returned HTTP ${response.status}: ${truncate(rawBody, ERROR_BODY_TRUNCATION)}`,
        { status: response.status }
      );
    }

    let parsed: RawVoicesResponse;
    try {
      parsed = JSON.parse(rawBody) as RawVoicesResponse;
    } catch (err) {
      throw new ElevenLabsError(
        `ElevenLabs /v2/voices returned non-JSON body: ${truncate(rawBody, ERROR_BODY_TRUNCATION)}`,
        { status: response.status, cause: err }
      );
    }

    const voices: Voice[] = [];
    if (Array.isArray(parsed.voices)) {
      for (const raw of parsed.voices) {
        const mapped = mapRawVoice(raw);
        if (mapped) voices.push(mapped);
      }
    }

    const page: VoicesPage = {
      voices,
      hasMore: parsed.has_more === true
    };
    if (typeof parsed.next_page_token === 'string' && parsed.next_page_token.length > 0) {
      page.nextPageToken = parsed.next_page_token;
    }
    return page;
  }

  /**
   * Synthesize `text` to MP3 bytes using the streaming TTS endpoint, buffered
   * to completion. Gated by a process-wide semaphore (`TTS_MAX_CONCURRENCY`)
   * so that current-block synth, prefetch, and voice preview never together
   * exceed ElevenLabs' concurrent-request limit.
   */
  async synthesize(opts: SynthesizeOptions): Promise<Uint8Array> {
    const { voiceId, text } = opts;
    if (!voiceId) throw new ElevenLabsError('synthesize: voiceId is required');
    if (!text) throw new ElevenLabsError('synthesize: text is required');

    await acquireTtsSlot();
    try {
      const url =
        `${this.baseUrl}/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream` +
        `?output_format=${DEFAULT_OUTPUT_FORMAT}`;

      const body: Record<string, unknown> = {
        text,
        model_id: this.modelId
      };
      const settings = mapVoiceSettings(opts.voiceSettings);
      if (settings) body.voice_settings = settings;

      const response = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          'content-type': 'application/json',
          accept: 'audio/mpeg'
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        // Body is most likely a JSON/text error description here, not audio.
        let errorBody = '';
        try {
          errorBody = await response.text();
        } catch {
          // Ignore — we'll just report status.
        }
        throw new ElevenLabsError(
          `ElevenLabs TTS returned HTTP ${response.status}: ${truncate(errorBody, ERROR_BODY_TRUNCATION)}`,
          { status: response.status }
        );
      }

      let buffer: ArrayBuffer;
      try {
        buffer = await response.arrayBuffer();
      } catch (err) {
        throw new ElevenLabsError('ElevenLabs TTS response body could not be read', {
          cause: err
        });
      }

      const bytes = new Uint8Array(buffer);
      if (bytes.byteLength === 0) {
        throw new ElevenLabsError('ElevenLabs TTS returned an empty audio body', {
          status: response.status
        });
      }
      return bytes;
    } finally {
      releaseTtsSlot();
    }
  }

  /**
   * Synthesize and return per-character alignment alongside the audio.
   * Uses the `/with-timestamps` endpoint, which is non-streaming and
   * returns a JSON envelope with base64 audio + alignment arrays. Same
   * concurrency gate as `synthesize`.
   */
  async synthesizeWithTimestamps(opts: SynthesizeOptions): Promise<SynthesizeWithTimestampsResult> {
    const { voiceId, text } = opts;
    if (!voiceId) throw new ElevenLabsError('synthesizeWithTimestamps: voiceId is required');
    if (!text) throw new ElevenLabsError('synthesizeWithTimestamps: text is required');

    await acquireTtsSlot();
    try {
      const url =
        `${this.baseUrl}/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps` +
        `?output_format=${DEFAULT_OUTPUT_FORMAT}`;

      const body: Record<string, unknown> = {
        text,
        model_id: this.modelId
      };
      const settings = mapVoiceSettings(opts.voiceSettings);
      if (settings) body.voice_settings = settings;

      const response = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          'content-type': 'application/json',
          accept: 'application/json'
        },
        body: JSON.stringify(body)
      });

      const rawBody = await response.text();

      if (!response.ok) {
        throw new ElevenLabsError(
          `ElevenLabs TTS (with-timestamps) returned HTTP ${response.status}: ${truncate(rawBody, ERROR_BODY_TRUNCATION)}`,
          { status: response.status }
        );
      }

      let parsed: RawWithTimestampsResponse;
      try {
        parsed = JSON.parse(rawBody) as RawWithTimestampsResponse;
      } catch (err) {
        throw new ElevenLabsError(
          `ElevenLabs TTS (with-timestamps) returned non-JSON body: ${truncate(rawBody, ERROR_BODY_TRUNCATION)}`,
          { status: response.status, cause: err }
        );
      }

      if (typeof parsed.audio_base64 !== 'string' || parsed.audio_base64.length === 0) {
        throw new ElevenLabsError(
          'ElevenLabs TTS (with-timestamps) response missing `audio_base64`',
          { status: response.status }
        );
      }
      const bytes = base64ToBytes(parsed.audio_base64);
      if (bytes.byteLength === 0) {
        throw new ElevenLabsError('ElevenLabs TTS (with-timestamps) decoded to empty audio', {
          status: response.status
        });
      }
      // Prefer the alignment that mirrors original input characters; fall
      // back to the normalized one if the API ever drops the verbatim list.
      const alignment =
        coerceAlignment(parsed.alignment) ?? coerceAlignment(parsed.normalized_alignment);
      if (!alignment) {
        throw new ElevenLabsError(
          'ElevenLabs TTS (with-timestamps) response missing alignment data',
          { status: response.status }
        );
      }
      return { bytes, alignment };
    } finally {
      releaseTtsSlot();
    }
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ElevenLabsError(
          `ElevenLabs request timed out after ${this.requestTimeoutMs}ms: ${url}`,
          { cause: err }
        );
      }
      throw new ElevenLabsError(`ElevenLabs request failed: ${url}`, { cause: err });
    } finally {
      clearTimeout(timeout);
    }
  }
}

let cachedDefaultClient: ElevenLabsClient | undefined;

/** Lazy singleton ElevenLabs client backed by `EXPO_PUBLIC_ELEVENLABS_API_KEY`. */
export function getDefaultElevenLabsClient(): ElevenLabsClient {
  if (!cachedDefaultClient) {
    cachedDefaultClient = new ElevenLabsClient();
  }
  return cachedDefaultClient;
}
