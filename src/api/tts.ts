import { useSettingsStore } from '@/src/state/settings';
import type { VoiceSettings } from '@/src/types/voice';

import { ElevenLabsClient, getDefaultElevenLabsClient } from './elevenlabs';
import { OpenAiCompatibleTtsClient } from './openaiTts';

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

/** Provider-agnostic TTS surface used by the pipeline. */
export interface TtsClient {
  synthesize(opts: TtsSynthesizeOptions): Promise<Uint8Array>;
}

/**
 * Wraps `ElevenLabsClient` so it implements the unified `TtsClient` interface
 * (the underlying client requires a non-optional `voiceId`, while the unified
 * surface allows it to be omitted for the local provider).
 */
class ElevenLabsTtsAdapter implements TtsClient {
  constructor(private readonly inner: ElevenLabsClient) {}

  async synthesize(opts: TtsSynthesizeOptions): Promise<Uint8Array> {
    if (!opts.voiceId) {
      throw new Error('ElevenLabs requires a voice — choose one in Settings → Voice.');
    }
    return this.inner.synthesize({
      voiceId: opts.voiceId,
      text: opts.text,
      voiceSettings: opts.voiceSettings
    });
  }
}

let cachedLocalClient: OpenAiCompatibleTtsClient | undefined;

function getLocalClient(): TtsClient {
  if (!cachedLocalClient) {
    cachedLocalClient = new OpenAiCompatibleTtsClient({
      baseUrl: DEFAULT_LOCAL_TTS_URL,
      defaultVoice: DEFAULT_LOCAL_TTS_VOICE,
      defaultModel: DEFAULT_LOCAL_TTS_MODEL
    });
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
