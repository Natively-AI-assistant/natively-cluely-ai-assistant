// src/components/ui/bannerStack.mjs
//
// The bookkeeping behind the Transitions.dev banner stack
// (UpcomingCalendarCard.css): which banners are on screen, at what depth,
// and whether each is entering, at rest, or leaving.
//
// The one rule that matters: a surviving banner NEVER changes its position in
// the list. Depth lives in `data-depth` only. React reorders DOM nodes to match
// array order, and Chromium treats a moved node as removed and re-inserted,
// which cancels its running transition. A stack ordered front-first would make
// every depth shift, and the leaving banner, snap instead of animate. So new
// banners are appended, leaving banners stay put until they are dropped, and
// depth is just a number on each entry.
//
// Pure, with no React and no DOM, so the tests run it directly.

/**
 * @template T
 * @typedef {{ key: string, item: T, depth: number, phase: 'enter' | 'rest' | 'leaving' }} StackEntry
 */

/**
 * The next stack from the previous one and the target, front first.
 *
 * - A surviving entry keeps its place and takes its new depth.
 * - A new key is appended. It enters, unless `alreadyArrived(key)` says it
 *   was on screen before (e.g. the card remounted), in which case it rests.
 * - A key no longer targeted starts leaving where it is, at its last depth.
 * - A key that comes back while still leaving is revived in place.
 *
 * @template T
 * @param {StackEntry<T>[]} prev
 * @param {{ key: string, item: T }[]} target
 * @param {(key: string) => boolean} [alreadyArrived]
 * @returns {StackEntry<T>[]}
 */
export function reconcileStack(prev, target, alreadyArrived = () => false) {
  const depthOf = new Map(target.map((t, i) => [t.key, i]));
  const next = prev.map((e) => {
    const depth = depthOf.get(e.key);
    if (depth === undefined) return e.phase === 'leaving' ? e : { ...e, phase: 'leaving' };
    return { ...e, item: target[depth].item, depth, phase: e.phase === 'enter' ? 'enter' : 'rest' };
  });
  const known = new Set(prev.map((e) => e.key));
  target.forEach((t, depth) => {
    if (!known.has(t.key)) {
      next.push({ key: t.key, item: t.item, depth, phase: alreadyArrived(t.key) ? 'rest' : 'enter' });
    }
  });
  return next;
}

/**
 * Every entering banner comes to rest. Called after the reflow that commits
 * its `.is-enter` start state.
 *
 * @template T
 * @param {StackEntry<T>[]} entries
 * @returns {StackEntry<T>[]}
 */
export function settleEntering(entries) {
  return entries.some((e) => e.phase === 'enter')
    ? entries.map((e) => (e.phase === 'enter' ? { ...e, phase: 'rest' } : e))
    : entries;
}

/**
 * Removes the given keys once their leave has played. A key that was revived
 * in the meantime is kept.
 *
 * @template T
 * @param {StackEntry<T>[]} entries
 * @param {string[]} keys
 * @returns {StackEntry<T>[]}
 */
export function dropLeft(entries, keys) {
  const gone = new Set(keys);
  return entries.filter((e) => !(e.phase === 'leaving' && gone.has(e.key)));
}

/**
 * The arrival order for a stack that fills from empty: the furthest banner
 * first, each later one landing in front and pushing the others back, so the
 * soonest ends on top. For [a, b, c] (front first): [c], then [b, c], then
 * [a, b, c].
 *
 * @template T
 * @param {T[]} target
 * @returns {T[][]}
 */
export function arrivalSteps(target) {
  return target.map((_, i) => target.slice(target.length - 1 - i));
}

/** Placeholder slots are keyed by depth; `slot:0` stands in for an empty front. */
export const SLOT_PREFIX = 'slot:';

/**
 * Pads a front-first target with placeholder slots so the stack is always
 * `size` deep. A slot's key is its depth, so when a real item arrives the
 * slot it displaces is the one that leaves, out the back, like the fourth
 * banner in the snippet.
 *
 * @template T
 * @param {{ key: string, item: T }[]} target
 * @param {number} [size]
 * @returns {{ key: string, item: T | null }[]}
 */
export function padStack(target, size = 3) {
  const real = target.slice(0, size);
  const slots = [];
  for (let depth = real.length; depth < size; depth++) slots.push({ key: `${SLOT_PREFIX}${depth}`, item: null });
  return [...real, ...slots];
}

/** @param {string} key */
export function isSlotKey(key) {
  return key.startsWith(SLOT_PREFIX);
}
