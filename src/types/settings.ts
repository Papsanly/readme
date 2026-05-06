export type SkippingMode = 'main-only' | 'service-only' | 'none';

/**
 * Where to send TTS requests.
 *
 * `elevenlabs` — hosted ElevenLabs (paid, requires `EXPO_PUBLIC_ELEVENLABS_API_KEY`).
 *
 * `local` — Kokoro-FastAPI on the developer's LAN. URL/voice/model are baked
 * in (see `src/api/tts.ts`); user just toggles between providers.
 */
export type TtsProvider = 'elevenlabs' | 'local';

export type AppSettings = {
  voiceId?: string;
  voiceName?: string;
  speed: number;
  skipping: SkippingMode;
  ttsProvider: TtsProvider;
  /** Voice id sent to the local server when `ttsProvider === 'local'`. */
  localVoice?: string;
};
