/** The most characters of a model name the overlay's model selector shows, spaces included. */
export const MODEL_SELECTOR_MAX_CHARS = 16;

/**
 * The first MODEL_SELECTOR_MAX_CHARS characters of a model name, with no
 * ellipsis: the rest is simply not shown. Counted by code point so an emoji
 * or other astral character is never split in half.
 */
export function modelSelectorLabelText(name: string): string {
  return Array.from(name).slice(0, MODEL_SELECTOR_MAX_CHARS).join('').trimEnd();
}
