/**
 * The popup's motion, after transitions.dev's recipes (text states swap,
 * success check, error state shake, shimmer text) on its motion tokens: the
 * custom properties at the top of popup.html, read here so the CSS and the
 * timers stay in step.
 *
 * Every helper leaves the end state right on its own. Under
 * prefers-reduced-motion the CSS keeps the fades and drops the travel, so
 * nothing here needs a second path, except the fold (collapse), which then
 * only fades.
 */

/** A duration token from popup.html's :root, in ms. */
function ms(token: string): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token)) || 0;
}

function easing(token: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim() || 'ease-out';
}

const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

const swaps = new WeakMap<HTMLElement, number>();

/**
 * Text states swap: what `el` shows leaves upward, blurred, then `update`
 * puts in its replacement, which arrives from below. An element showing
 * nothing takes the new content and arrives at once. A swap started during
 * another takes over: the last `update` wins.
 */
export function swapText(el: HTMLElement, update: () => void): void {
  window.clearTimeout(swaps.get(el));
  const arrive = (): void => {
    update();
    el.classList.remove('is-exit');
    el.classList.add('is-enter-start');
    void el.offsetWidth; // the start state has to be painted for the swap to replay
    el.classList.remove('is-enter-start');
  };
  const showing = el.textContent !== '' && el.getClientRects().length > 0;
  if (!showing) return arrive();
  el.classList.add('is-exit');
  swaps.set(el, window.setTimeout(arrive, ms('--duration-quick')));
}

/** Error state shake, replayable: remove, reflow, add. */
export function shake(el: HTMLElement): void {
  el.classList.remove('is-shaking');
  void el.offsetWidth;
  el.classList.add('is-shaking');
  el.addEventListener('animationend', () => el.classList.remove('is-shaking'), { once: true });
}

// ── Button labels ──────────────────────────────────────────

const holds = new WeakMap<HTMLButtonElement, number>();

function labelOf(btn: HTMLButtonElement): HTMLElement {
  return btn.querySelector<HTMLElement>('.label') ?? btn;
}

/** Remembers each button's resting label, so its busy and done states can return to it. */
export function initButtons(root: ParentNode): void {
  for (const btn of root.querySelectorAll<HTMLButtonElement>('button')) {
    btn.dataset.label = labelOf(btn).textContent?.trim() ?? '';
  }
}

/** The check that draws itself (success check), sized for a button label. */
function checkMark(): HTMLElement {
  const mark = document.createElement('span');
  mark.className = 't-success-check';
  mark.dataset.state = 'in';
  mark.setAttribute('aria-hidden', 'true');
  // Path length 11.7; the CSS dash is 13.
  mark.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7.5 5.5 10 11 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return mark;
}

export interface LabelState {
  /** Words to show; the resting label when left out (none beside a check). */
  text?: string;
  /** Working on it: the words shimmer and the button is aria-busy. */
  busy?: boolean;
  /** Done: a drawn check before the words. */
  done?: boolean;
}

/** Swaps the button's label in place: its resting words, busy words that shimmer, or a check. */
export function setButtonLabel(btn: HTMLButtonElement, next: LabelState = {}): void {
  window.clearTimeout(holds.get(btn));
  const text = next.text ?? (next.done ? '' : btn.dataset.label ?? '');
  if (next.busy) btn.setAttribute('aria-busy', 'true');
  else btn.removeAttribute('aria-busy');
  btn.toggleAttribute('data-done', !!next.done);
  // A shorter state ("Allow" → a check) keeps the width the button has now.
  btn.style.minWidth = next.busy || next.done ? `${btn.offsetWidth}px` : '';
  const label = labelOf(btn);
  swapText(label, () => {
    label.classList.toggle('t-shimmer', !!next.busy);
    if (next.busy) label.dataset.text = text;
    else delete label.dataset.text;
    const words = text || (next.done ? 'Done' : '');
    const wordsNode = text ? document.createTextNode(words) : Object.assign(document.createElement('span'), { className: 'sr-only', textContent: words });
    label.replaceChildren(...(next.done ? [checkMark()] : []), wordsNode);
  });
}

/** The resting label again, at once (for a button that is already out of sight). */
export function resetButtonLabel(btn: HTMLButtonElement): void {
  window.clearTimeout(holds.get(btn));
  window.clearTimeout(swaps.get(labelOf(btn)));
  btn.removeAttribute('aria-busy');
  btn.removeAttribute('data-done');
  btn.style.minWidth = '';
  const label = labelOf(btn);
  label.classList.remove('t-shimmer', 'is-exit', 'is-enter-start');
  delete label.dataset.text;
  label.textContent = btn.dataset.label ?? '';
}

/**
 * The check (with `text`) for `holdMs`, then the resting label again, or,
 * with `restore: false`, left for the caller to reset. Resolves when the hold
 * ends; a label change during the hold takes over and it never resolves.
 */
export function flashDone(btn: HTMLButtonElement, text = '', holdMs = 1400, restore = true): Promise<void> {
  setButtonLabel(btn, { text, done: true });
  return new Promise((resolve) => {
    holds.set(btn, window.setTimeout(() => {
      if (restore) setButtonLabel(btn);
      resolve();
    }, holdMs));
  });
}

// ── Folding away ───────────────────────────────────────────

/**
 * Folds `el` away (height, padding, border and margins to nothing, fading),
 * then `hide`s it and drops the inline animation, so what remains is the
 * hidden state with no jump. `margin` takes up a grid gap beside a row, so
 * the rows round it close in one move, not two.
 */
export async function collapse(
  el: HTMLElement,
  hide: () => void,
  margin: { top?: string; bottom?: string } = {},
): Promise<void> {
  const cs = getComputedStyle(el);
  const frames: Keyframe[] = reducedMotion()
    ? [{ opacity: 1 }, { opacity: 0 }]
    : [
        {
          height: `${el.offsetHeight}px`,
          opacity: 1,
          paddingTop: cs.paddingTop,
          paddingBottom: cs.paddingBottom,
          borderTopWidth: cs.borderTopWidth,
          borderBottomWidth: cs.borderBottomWidth,
          marginTop: cs.marginTop,
          marginBottom: cs.marginBottom,
        },
        {
          height: '0px',
          opacity: 0,
          paddingTop: '0px',
          paddingBottom: '0px',
          borderTopWidth: '0px',
          borderBottomWidth: '0px',
          marginTop: margin.top ?? '0px',
          marginBottom: margin.bottom ?? '0px',
        },
      ];
  el.style.overflow = 'hidden';
  const run = el.animate(frames, { duration: ms('--duration-fast'), easing: easing('--ease-smooth-out'), fill: 'forwards' });
  await run.finished.catch(() => {});
  hide();
  run.cancel();
  el.style.overflow = '';
}
