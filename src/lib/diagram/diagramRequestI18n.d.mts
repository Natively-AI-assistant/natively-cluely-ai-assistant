import type { DiagramRequest } from './diagramRequest.mjs';

/** Which of the four supported non-English languages the text is in, or null. */
export function detectRequestLanguage(text: string | null | undefined): 'es' | 'ru' | 'zh' | 'ja' | null;

/**
 * A turn said in Spanish, Russian, Chinese or Japanese: a fresh request for a
 * drawing, or a follow-up on the one on the table. Null when it is neither, or
 * when the text is in none of these languages.
 */
export function resolveOtherLanguageRequest(input?: {
  question?: string | null;
  activeDesign?: { artifactId?: string; artifact?: string; view?: string; source?: string; foreground?: boolean } | null;
  answerType?: string | null;
  questionTypes?: readonly string[] | null;
}): DiagramRequest | null;
