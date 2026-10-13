/** Max chars for overlay context editor paste (meeting prep, JD snippets, etc.). */
export const OVERLAY_CONTEXT_MAX_CHARS = 32000;

/** XML block injected into LLM context for overlay editor content. */
export function buildOverlayUserContextBlock(text: string | null | undefined): string {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) return '';
  return `<user_context>\n${trimmed}\n</user_context>`;
}
