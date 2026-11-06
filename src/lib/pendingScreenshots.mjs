// Screenshots still being taken when the user sends (2026-11-06).
//
// ⌘/Ctrl+H hides the overlay, grabs the screen, writes the PNG and builds the
// tray preview before the image reaches the tray, about half a second on a
// Mac. ⌘/Ctrl+Enter or Enter pressed inside that gap used to send without it,
// and the image then landed in the tray and rode along with the NEXT question.
// The send paths now wait for captures in flight (capped) and take them along;
// a capture taken by a send is `claimed`, so its late tray add is skipped.

/** How long a send waits for a capture in flight before going without it. */
export const PENDING_SHOT_WAIT_MS = 1500;

/**
 * @template {{ path: string }} T
 * @returns {{
 *   track: (capture: Promise<T | null | undefined>) => Promise<T | null>,
 *   inFlight: () => boolean,
 *   settle: (timeoutMs?: number) => Promise<T[]>,
 *   claimed: (path: string) => boolean,
 * }}
 */
export function createPendingScreenshots() {
  /** @type {Set<Promise<T | null>>} */
  const flying = new Set();
  /** @type {Set<string>} */
  const taken = new Set();

  return {
    /** Register a capture; resolves to its result (null on failure / none). */
    track(capture) {
      const p = Promise.resolve(capture).then(
        (shot) => (shot && shot.path ? shot : null),
        () => null,
      );
      flying.add(p);
      p.then(() => flying.delete(p));
      return p;
    },

    inFlight() {
      return flying.size > 0;
    },

    /**
     * Wait for every capture in flight (at most `timeoutMs`) and claim the
     * ones that finished. Never rejects. Resolves at once when none is flying.
     */
    async settle(timeoutMs = PENDING_SHOT_WAIT_MS) {
      if (flying.size === 0) return [];
      const pending = [...flying];
      /** @type {(T | null)[]} */
      const done = [];
      pending.forEach((p, i) => p.then((shot) => { done[i] = shot; }));
      let timer;
      await Promise.race([
        Promise.all(pending),
        new Promise((r) => { timer = setTimeout(r, timeoutMs); }),
      ]);
      clearTimeout(timer);
      /** @type {T[]} */
      const shots = [];
      for (const shot of done) {
        if (shot && !taken.has(shot.path)) {
          taken.add(shot.path);
          shots.push(shot);
        }
      }
      return shots;
    },

    /** Whether a send already took this capture (skip its tray add). */
    claimed(path) {
      return taken.has(path);
    },
  };
}
