// One place that flips `html[data-theme]`, and the dissolve that goes with it.
//
// Every window learns about a theme change on its own (`theme:changed` from
// ThemeManager), and used to answer it with a bare setAttribute — every surface
// jumped to its new palette in a single frame. macOS and iOS dissolve the whole
// screen instead, so this does the same: the View Transitions API snapshots the
// window, the attribute flips underneath, and the snapshot fades out over the
// live page. Old and new are cross-faded by the UA (plus-lighter), which stays
// exact for the translucent glass surfaces and the transparent overlay window —
// an "old stays opaque, new fades in on top" scheme would leave the old palette
// showing through every translucent pixel until it was removed.
//
// The timing lives in index.css (`:root[data-theme-switching]::view-transition-*`).
// It is 240ms on a strong ease-in-out: a whole-window dissolve is a swap, not an
// open/close, so it takes the symmetric curve, and no blur — a colour change
// never blurs.
//
// The live page underneath must not also animate its colours, or the toggles
// (`transition-all 300ms`), the ask-bar pill and every `transition-colors`
// surface would each run their own curve beneath the dissolve and land out of
// step with the rest. A blanket `* { transition: none }` while it runs fixes that
// but costs a full-document style recalculation at the exact moment the dissolve
// starts — measured 54-83ms dropped frames on the launcher, 3 runs in 5. So the
// colour transitions the flip starts are finished instead: swept inside the
// update callback (before any frame is captured) and, for stragglers, as the
// browser announces them (`transitionrun`). A handful of elements, no
// invalidation.
//
// The flip itself is expensive on a big window (the launcher restyles its whole
// tree and re-renders every theme-aware component — a plain snap with no
// dissolve drops 60-90ms frames there). While the update callback is pending the
// old snapshot stays on screen and the animation clock has not started, so all
// of that work is done INSIDE the callback: flip, force the restyle, let React
// commit, force layout again. The cost becomes a few ms of latency before the
// dissolve begins instead of a stalled frame in the middle of it.
//
// Only a *change event* animates. First paint, the authoritative re-read from
// main, and a hidden window all snap.

export const THEME_CACHE_KEY = 'natively_resolved_theme';
export const THEME_SWITCHING_ATTR = 'data-theme-switching';

// Documents whose dissolve is in flight, with the theme it is heading for.
//
// startViewTransition does NOT run its callback immediately: the UA captures the
// old snapshot first, so for a moment `data-theme` still holds the old value. A
// second change in that gap (a System switch broadcasts twice back to back)
// therefore must not touch the attribute — that would repaint the page before
// the capture and the "old" snapshot would already be the new theme. It only
// retargets `target`, which the callback reads when it finally runs. Once the
// callback has run (`applied`), the live page is already the "new" layer, so a
// later change flips the attribute directly and retargets what is fading in.
// Calling startViewTransition again would skip the running one and pop it.
/** @type {WeakMap<Document, { target: 'light' | 'dark', applied: boolean }>} */
const dissolving = new WeakMap();

// Colour-ish properties only: what a theme flip changes. A transform or size
// transition that happens to be running is not ours to cut short.
const COLOUR_PROPERTY = /(^|-)color$|shadow|^fill$|^stroke|filter/;

/**
 * Finish every running colour transition in the document. `getAnimations()`
 * flushes pending style first, so this sees the ones the flip just created —
 * before a frame is produced, which is what `transitionrun` cannot promise (its
 * events are dispatched in the next frame's steps).
 * @param {Document} doc
 */
export function settleColourTransitions(doc) {
  if (typeof doc.getAnimations !== 'function') return;
  for (const animation of doc.getAnimations()) {
    if (COLOUR_PROPERTY.test(animation.transitionProperty ?? '')) animation.finish();
  }
}

/** @param {TransitionEvent} event */
export function settleColourTransition(event) {
  if (!COLOUR_PROPERTY.test(event.propertyName ?? '')) return;
  const target = event.target;
  if (typeof target?.getAnimations !== 'function') return;
  const pseudo = event.pseudoElement || null;
  for (const animation of target.getAnimations()) {
    if (animation.transitionProperty !== event.propertyName) continue;
    if ((animation.effect?.pseudoElement ?? null) !== pseudo) continue;
    animation.finish();
  }
}

function persist(storage, resolved) {
  try {
    storage?.setItem(THEME_CACHE_KEY, resolved);
  } catch {
    // Storage can be blocked; the cache is only a first-paint hint.
  }
}

/**
 * @param {'light' | 'dark'} resolved
 * @param {{
 *   animate?: boolean,
 *   doc?: Document,
 *   storage?: Pick<Storage, 'setItem'> | null,
 * }} [options]
 * @returns {boolean} true when a dissolve was started
 */
export function applyResolvedTheme(resolved, options = {}) {
  const doc = options.doc ?? (typeof document === 'undefined' ? null : document);
  if (!doc) return false;
  const storage =
    options.storage === undefined
      ? (typeof localStorage === 'undefined' ? null : localStorage)
      : options.storage;
  const root = doc.documentElement;

  persist(storage, resolved);

  const running = dissolving.get(doc);
  if (running) {
    if (running.target === resolved) return false;
    running.target = resolved;
    if (running.applied) root.setAttribute('data-theme', resolved);
    return false;
  }
  if (root.getAttribute('data-theme') === resolved) return false;

  const flip = () => root.setAttribute('data-theme', resolved);

  const canDissolve =
    options.animate !== false &&
    typeof doc.startViewTransition === 'function' &&
    doc.visibilityState !== 'hidden';
  if (!canDissolve) {
    flip();
    return false;
  }

  const state = { target: resolved, applied: false };
  const flipToTarget = () => {
    state.applied = true;
    root.setAttribute('data-theme', state.target);
  };

  // Two macrotasks: React's scheduler commits the re-render the flip triggers on
  // a MessageChannel task, which the first hop lets through; the second is slack.
  // Not rAF — rendering may be suppressed while the callback is pending.
  const hop = () => new Promise((resolve) => setTimeout(resolve, 0));
  const flush = () => { void root.offsetHeight; };
  const update = async () => {
    flipToTarget();
    flush();
    settleColourTransitions(doc);
    await hop();
    await hop();
    flush();
    settleColourTransitions(doc);
  };

  let transition;
  root.setAttribute(THEME_SWITCHING_ATTR, '');
  dissolving.set(doc, state);
  doc.addEventListener?.('transitionrun', settleColourTransition, true);
  const settle = () => {
    doc.removeEventListener?.('transitionrun', settleColourTransition, true);
    dissolving.delete(doc);
    root.removeAttribute(THEME_SWITCHING_ATTR);
  };
  try {
    transition = doc.startViewTransition(update);
  } catch {
    settle();
    flip();
    return false;
  }
  // A skipped transition (window hidden mid-flight, document torn down) rejects
  // `ready`; that is not an error worth an unhandledrejection line.
  transition.ready?.catch?.(() => {});
  transition.updateCallbackDone?.catch?.(() => {});
  Promise.resolve(transition.finished).catch(() => {}).then(settle);
  return true;
}
