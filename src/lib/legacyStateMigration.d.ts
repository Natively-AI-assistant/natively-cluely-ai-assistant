export const SAFE_DEFAULT_MODEL: string;
export const SAFE_STT_PROVIDER: 'none';
export function sanitizeDefaultModel(model: string | undefined | null): string;
export function sanitizeSttProvider(
  provider: string | undefined | null,
): 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'local-whisper' | 'gigastt';
