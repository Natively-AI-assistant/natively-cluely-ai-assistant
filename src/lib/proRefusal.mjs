// What to show for a failed IPC answer that may be a Pro refusal
// (electron/services/proGate.ts proRefusal: error 'pro_required', the words in
// `message`). Every Pro handler refuses the same way since 2026-11-07; screens
// that show `error` as text call this so they never show the bare code.

export const PRO_REQUIRED_FALLBACK = 'This is part of Natively Pro. Activate a licence or start the free trial to use it.';

/** True when this answer is a Pro (or trial) refusal. */
export function isProRefusal(res) {
  return !!res && typeof res === 'object' && res.error === 'pro_required';
}

/** The text to show for a failed answer: the Pro sentence, its own error, or the fallback. */
export function failureText(res, fallback) {
  if (isProRefusal(res)) {
    return typeof res.message === 'string' && res.message.trim() ? res.message : PRO_REQUIRED_FALLBACK;
  }
  const err = res && typeof res === 'object' ? res.error : undefined;
  return typeof err === 'string' && err.trim() ? err : fallback;
}
