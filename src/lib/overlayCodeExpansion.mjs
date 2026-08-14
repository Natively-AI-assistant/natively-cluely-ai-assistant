const EAGER_CODE_EXPANSION_INTENTS = new Set(['what_to_answer', 'chat']);

export const CODE_EXPANSION_TRANSITION = {
  type: 'spring',
  duration: 0.28,
  bounce: 0.16,
  restDelta: 0.5,
  restSpeed: 12,
};

/**
 * Returns true when an incoming answer token proves the row will render as a
 * code card. The renderer uses this to grow the overlay before React mounts the
 * code-styled row; the scroll/visibility scanner still owns later contraction.
 */
export function shouldEagerExpandForCodeToken(intent, token, previousText = '') {
  if (!EAGER_CODE_EXPANSION_INTENTS.has(intent) || typeof token !== 'string') return false;
  return `${typeof previousText === 'string' ? previousText : ''}${token}`.includes('```');
}

export function shouldHoldEagerCodeExpansion({
  hasCodeElements,
  hasVisibleCodeElement,
  eagerExpansionHold,
}) {
  return Boolean(eagerExpansionHold && !hasCodeElements && !hasVisibleCodeElement);
}
