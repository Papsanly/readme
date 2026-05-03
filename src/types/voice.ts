export type Voice = {
  id: string;
  name: string;
  description?: string;
  previewUrl?: string;
  category?: string;
  labels?: Record<string, string>;
};
