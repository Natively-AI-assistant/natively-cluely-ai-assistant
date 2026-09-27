/**
 * Width of the overlay's model selector button AND of the dropdown it opens,
 * so their edges line up and the button no longer changes width with the
 * model. 141px, by owner request (176 read as too wide).
 *
 * What fits (Inter/SF, 12px medium; the fallback to Segoe UI on Windows runs
 * about as wide):
 * - button: 105px of label. "Gemini 3.8 Flash" is 96. The Groq GPT-OSS labels
 *   (111-113) fade out at the edge (ModelSelectorLabel).
 * - dropdown: 117px of label on an unchecked row, 99px on the checked one
 *   (its check takes the rest). "Gemini 3.1 Flash Lite" (119) and
 *   "DeepSeek V4.1 Flash" (121) end in an ellipsis; the owner chose 141 over
 *   the 146 that fits them.
 *
 * Dropdown rows start their label 13px from the left edge (1px border + 4px
 * panel padding + pl-2). The button's label space starts at the same 13px
 * (1px border + pl-3); a name that fits is centred in it (ModelSelectorLabel).
 */
export const MODEL_SELECTOR_WIDTH = 141;

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
