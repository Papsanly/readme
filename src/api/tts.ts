import { useSettingsStore } from '@/src/state/settings';
import type { VoiceSettings } from '@/src/types/voice';

import { ElevenLabsClient, getDefaultElevenLabsClient, type TtsAlignment } from './elevenlabs';
import { OpenAiCompatibleTtsClient } from './openaiTts';

export type { TtsAlignment } from './elevenlabs';

/**
 * Default URL of the bundled local TTS server (`openedai-speech` running
 * XTTS-v2). Override at build time via `EXPO_PUBLIC_LOCAL_TTS_URL` if you
 * run it on a different host or port — for example, on a real Android
 * device pointed at your computer's LAN IP. The Android emulator alias
 * `10.0.2.2` is the host machine's `localhost`.
 */
const DEFAULT_LOCAL_TTS_URL =
  process.env.EXPO_PUBLIC_LOCAL_TTS_URL && process.env.EXPO_PUBLIC_LOCAL_TTS_URL.length > 0
    ? process.env.EXPO_PUBLIC_LOCAL_TTS_URL
    : 'http://10.0.2.2:8000';

/**
 * Default voice id. `alloy` is mapped to an XTTS-v2 speaker by openedai-speech
 * when paired with the `tts-1-hd` model — the language is auto-detected from
 * the input text (en, ru, uk, pl, de, es, fr, it, nl, cs, ar, zh-cn, hu, ko,
 * ja, hi, tr, pt). Override via `EXPO_PUBLIC_LOCAL_TTS_VOICE`.
 */
const DEFAULT_LOCAL_TTS_VOICE =
  process.env.EXPO_PUBLIC_LOCAL_TTS_VOICE && process.env.EXPO_PUBLIC_LOCAL_TTS_VOICE.length > 0
    ? process.env.EXPO_PUBLIC_LOCAL_TTS_VOICE
    : 'alloy';

/**
 * `tts-1-hd` selects the XTTS-v2 path inside openedai-speech (multilingual,
 * GPU-accelerated). `tts-1` would route to Piper which is English-only.
 * Override via `EXPO_PUBLIC_LOCAL_TTS_MODEL`.
 */
const DEFAULT_LOCAL_TTS_MODEL =
  process.env.EXPO_PUBLIC_LOCAL_TTS_MODEL && process.env.EXPO_PUBLIC_LOCAL_TTS_MODEL.length > 0
    ? process.env.EXPO_PUBLIC_LOCAL_TTS_MODEL
    : 'tts-1-hd';

export type TtsSynthesizeOptions = {
  /** Voice id; for ElevenLabs this comes from the voice picker, for the local server from build-time defaults. */
  voiceId?: string;
  text: string;
  voiceSettings?: VoiceSettings;
};

/**
 * Audio bytes plus optional per-character alignment. Providers that
 * support timestamps (ElevenLabs) return both; providers that don't
 * (Kokoro / openedai-speech XTTS) return only `bytes`. Callers must
 * tolerate `alignment === undefined`.
 */
export type TtsSynthesizeResult = {
  bytes: Uint8Array;
  alignment?: TtsAlignment;
};

/** Provider-agnostic TTS surface used by the pipeline. */
export interface TtsClient {
  synthesize(opts: TtsSynthesizeOptions): Promise<TtsSynthesizeResult>;
}

/**
 * Wraps `ElevenLabsClient` so it implements the unified `TtsClient`
 * interface. Always uses the `with-timestamps` endpoint so we get a
 * per-character alignment back — the player's word-level seek and word
 * highlight rely on it. The cost is one JSON+base64 round-trip instead
 * of a streaming binary, which is fine for our short blocks.
 */
class ElevenLabsTtsAdapter implements TtsClient {
  constructor(private readonly inner: ElevenLabsClient) {}

  async synthesize(opts: TtsSynthesizeOptions): Promise<TtsSynthesizeResult> {
    if (!opts.voiceId) {
      throw new Error('ElevenLabs requires a voice — choose one in Settings → Voice.');
    }
    return this.inner.synthesizeWithTimestamps({
      voiceId: opts.voiceId,
      text: opts.text,
      voiceSettings: opts.voiceSettings
    });
  }
}

/**
 * Wraps `OpenAiCompatibleTtsClient` and overrides the caller's `voiceId`
 * with the *local* voice from settings (`localVoice`). The audio engine
 * forwards the ElevenLabs voice id from `settings.voiceId`, which would be
 * rejected by openedai-speech with `Error loading voice: <id>`; we ignore
 * that and use the user's local-voice pick instead. No alignment data —
 * XTTS-v2 / openedai-speech don't expose timestamps over the OpenAI
 * protocol, so word-level seek falls back to the engine's char-rate
 * estimate.
 */
class LocalTtsAdapter implements TtsClient {
  constructor(private readonly inner: OpenAiCompatibleTtsClient) {}

  async synthesize(opts: TtsSynthesizeOptions): Promise<TtsSynthesizeResult> {
    const localVoice = useSettingsStore.getState().localVoice;
    const bytes = await this.inner.synthesize({
      voiceId: localVoice,
      text: opts.text,
      voiceSettings: opts.voiceSettings
    });
    return { bytes };
  }
}

let cachedLocalClient: TtsClient | undefined;

function getLocalClient(): TtsClient {
  if (!cachedLocalClient) {
    cachedLocalClient = new LocalTtsAdapter(
      new OpenAiCompatibleTtsClient({
        baseUrl: DEFAULT_LOCAL_TTS_URL,
        defaultVoice: DEFAULT_LOCAL_TTS_VOICE,
        defaultModel: DEFAULT_LOCAL_TTS_MODEL,
        // XTTS-v2 on CPU/GPU takes longer than ElevenLabs on long blocks,
        // especially after a cold start. 3 minutes covers typical worst-case
        // synthesis times before we declare the server unresponsive.
        requestTimeoutMs: 180_000
      })
    );
  }
  return cachedLocalClient;
}

/**
 * Resolve the active TTS client based on the current `ttsProvider` setting.
 * Re-reads on every call so flipping the provider in Settings takes effect
 * immediately for the next synthesis.
 */
export function getTtsClient(): TtsClient {
  const provider = useSettingsStore.getState().ttsProvider;
  if (provider === 'local') return getLocalClient();
  return new ElevenLabsTtsAdapter(getDefaultElevenLabsClient());
}
