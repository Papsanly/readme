export type Voice = {
  id: string;
  name: string;
  description?: string;
  previewUrl?: string;
  category?: string;
  labels?: Record<string, string>;
};

/** A single page of results from `ElevenLabsClient.listVoices`. */
export type VoicesPage = {
  voices: Voice[];
  hasMore: boolean;
  nextPageToken?: string;
};

/** Per-request voice tuning passed through to the ElevenLabs synthesize endpoint. */
export type VoiceSettings = {
  stability?: number;
  similarityBoost?: number;
  style?: number;
  useSpeakerBoost?: boolean;
  speed?: number;
};
