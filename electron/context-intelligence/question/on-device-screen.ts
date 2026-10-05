// electron/context-intelligence/question/on-device-screen.ts
//
// Text read off a screenshot that was KEPT ON THIS DEVICE (2026-10-01).
//
// "Keep screenshots on this device" was enforced on image bytes only. The text
// a local model read off such a screenshot was stored like any other screen
// text and then travelled as plain prose — to a cloud model the moment the
// user switched to one, from the description cache, and in Direct Assist's
// history.
//
// The mark is IN THE TEXT, on purpose. A flag on the conversation turn, a
// column in the cache and a field on Direct Assist's history would be three
// places to forget; the text itself passes through all of them and through
// whatever is added next. Two things read it:
//   • the history renderers, which show such text only when the turn stays on
//     this device and otherwise put ON_DEVICE_SCREEN_WITHHELD in its place;
//   • the last boundary before any cloud provider, which refuses a payload
//     that carries it.
// Pure: no imports, so the prompt code and the transport can both use it.

/** Leads every description made while screenshots were being kept on this device. */
export const ON_DEVICE_SCREEN_MARK = '[kept on this device · not for cloud models]';

/**
 * What a model that may NOT have the text is shown instead. Never a silent
 * gap: with nothing there, a follow-up is told no screenshot was ever sent,
 * which is worse than being told it cannot be read here.
 */
export const ON_DEVICE_SCREEN_WITHHELD =
  '[a screenshot was attached on this turn and was kept on this device — its '
  + 'contents are NOT available to this model. Say that it was kept on the device '
  + 'rather than denying a screenshot was sent, and never guess what it showed.]';

/** What the user is told when a cloud provider is refused such a payload. */
export const ON_DEVICE_SCREEN_REFUSED_MESSAGE =
  'This conversation includes text from a screenshot that was kept on this device, '
  + 'so it was not sent to a cloud provider. Pick a model that runs on this device '
  + 'for this question, or start a new conversation.';

export function hasOnDeviceScreenText(text: unknown): boolean {
  return typeof text === 'string' && text.includes(ON_DEVICE_SCREEN_MARK);
}

/** Idempotent. Empty text stays empty: there is nothing to keep. */
export function markOnDeviceScreenText(text: unknown): string {
  const body = String(text ?? '').trim();
  if (!body) return '';
  return hasOnDeviceScreenText(body) ? body : `${ON_DEVICE_SCREEN_MARK} ${body}`;
}
