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
  /**
   * The sends waiting right now, oldest first: each collects the captures
   * that finish while it waits. A capture is claimed the moment it finishes,
   * inside its own promise, so the capture handler's `claimed()` check, which
   * runs after that, already sees it (2026-11-06: claiming after the wait
   * came too late, and the image was also added to the tray).
   * @type {Set<T[]>}
   */
  const waiting = new Set();

  return {
    /** Register a capture; resolves to its result (null on failure / none). */
    track(capture) {
      const p = Promise.resolve(capture).then(
        (shot) => {
          const done = shot && shot.path ? shot : null;
          const send = waiting.values().next().value;
          if (done && send && !taken.has(done.path)) {
            taken.add(done.path);
            send.push(done);
          }
          return done;
        },
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
     * Wait for every capture in flight (at most `timeoutMs`) and take the
     * ones that finished meanwhile. Never rejects. Resolves at once when none
     * is flying. A capture finishing after the wait is not taken: it goes to
     * the tray, for the next question.
     */
    async settle(timeoutMs = PENDING_SHOT_WAIT_MS) {
      if (flying.size === 0) return [];
      const pending = [...flying];
      /** @type {T[]} */
      const shots = [];
      waiting.add(shots);
      let timer;
      try {
        await Promise.race([
          Promise.all(pending),
          new Promise((r) => { timer = setTimeout(r, timeoutMs); }),
        ]);
      } finally {
        clearTimeout(timer);
        waiting.delete(shots);
      }
      return shots;
    },

    /** Whether a send already took this capture (skip its tray add). */
    claimed(path) {
      return taken.has(path);
    },
  };
}
