// src/lib/funnel/funnelInstall.mjs
//
// Registering this install with the server: solve a puzzle once, keep the token.
//
// The funnel endpoint takes no key, so an install id used to cost nothing to
// invent. Now every funnel request must carry a token the server signed for
// that install, and the server only signs one for a solved puzzle
// (natively-api lib/funnelInstall.js). A real install pays about a second of
// background work, once; someone minting made-up installs pays it for each,
// and more for each one after the first from the same address.
//
// WHAT THIS MUST NEVER DO
//   - Block the main thread. The solver works in slices of a few milliseconds
//     and yields between them. It never uses a worker thread: a worker's file
//     has to be found inside a packaged app, and that path differs on macOS
//     and Windows.
//   - Work during a meeting. It waits.
//   - Work, or call the server, while Usage statistics is off.
//   - Lose an event. Events wait in the queue until there is a token.
//
// Pure: hashing, clock, sleeping, fetch and token storage are all handed in.

import { powInput, leadingZeroBits } from './funnelPow.mjs';

/**
 * The hardest puzzle this app will take on. The server raises the difficulty
 * for an address that registers many installs in a day; a real install caught
 * behind such an address does not burn minutes of CPU for it, it tries again
 * later. 26 bits is about a minute on a fast machine and five on a slow one.
 */
export const INSTALL_MAX_BITS = 26;
/** How long the solver may hold the thread before it yields. */
export const INSTALL_SLICE_MS = 12;
/** Hashes between looks at the clock. Small enough that a slice cannot overrun by much. */
const BATCH = 128;

const MINUTE = 60_000;
export const INSTALL_RETRY_MS = Object.freeze({
  network: 5 * MINUTE,       // could not reach the server
  refused: 15 * MINUTE,      // the server did not like the challenge or the solution: ask again
  limited: 6 * 60 * MINUTE,  // this address has asked too often, or the puzzle is too hard for now
});
/** Registrations attempted per install per launch. A loop here would be a CPU loop. */
export const INSTALL_MAX_ATTEMPTS = 3;

/**
 * Find a solution to a challenge.
 *
 * @param {object} o
 * @param {string} o.challenge
 * @param {number} o.bits                 leading zero bits required
 * @param {(input: string) => ArrayLike<number>} o.sha256
 * @param {() => number} o.now
 * @param {() => Promise<void>} o.yieldFn  give the thread back (setImmediate)
 * @param {(ms: number) => Promise<void>} o.sleep
 * @param {() => boolean} [o.shouldAbort]  stop for good (telemetry turned off)
 * @param {() => boolean} [o.shouldPause]  wait (a meeting is running)
 * @returns {Promise<{ solution: string, hashes: number } | null>} null when aborted
 */
export async function solvePow({ challenge, bits, sha256, now, yieldFn, sleep, shouldAbort = () => false, shouldPause = () => false, sliceMs = INSTALL_SLICE_MS, pauseMs = 2000 }) {
  let n = 0;
  let sliceStart = now();
  for (;;) {
    for (let i = 0; i < BATCH; i++, n++) {
      if (leadingZeroBits(sha256(powInput(challenge, String(n)))) >= bits) return { solution: String(n), hashes: n + 1 };
    }
    if (now() - sliceStart >= sliceMs) {
      await yieldFn();
      if (shouldAbort()) return null;
      while (shouldPause()) {
        await sleep(pauseMs);
        if (shouldAbort()) return null;
      }
      sliceStart = now();
    }
  }
}

/**
 * @param {object} deps
 * @param {typeof fetch} deps.fetchImpl
 * @param {string} deps.challengeEndpoint
 * @param {string} deps.registerEndpoint
 * @param {(input: string) => ArrayLike<number>} deps.sha256
 * @param {() => number} deps.now
 * @param {() => Promise<void>} deps.yieldFn
 * @param {(ms: number) => Promise<void>} deps.sleep
 * @param {() => boolean} deps.isEnabled
 * @param {() => boolean} [deps.shouldPause]
 * @param {(installId: string) => string | undefined} deps.loadToken
 * @param {(installId: string, token: string) => void} deps.saveToken
 * @param {(installId: string) => void} deps.clearToken
 * @param {{ warn: (...a: unknown[]) => void }} [deps.log]
 */
export function createInstallRegistrar(deps) {
  const log = deps.log || { warn() {} };
  const maxBits = deps.maxBits ?? INSTALL_MAX_BITS;
  const attempts = new Map();   // install id -> registrations tried this launch
  const retryAt = new Map();    // install id -> not before
  const inFlight = new Map();   // install id -> promise
  const stats = { registered: 0, attempts: 0, hashes: 0, failed: {} };
  const fail = (installId, reason, wait) => {
    stats.failed[reason] = (stats.failed[reason] || 0) + 1;
    retryAt.set(installId, deps.now() + wait);
    return { failed: reason };
  };

  async function register(installId) {
    attempts.set(installId, (attempts.get(installId) || 0) + 1);
    stats.attempts++;
    const post = async (url, body) => {
      const res = await deps.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      let json = null;
      try { json = await res.json(); } catch { /* an unreadable body is handled as a failure below */ }
      return { res, json };
    };

    let asked;
    try { asked = await post(deps.challengeEndpoint, { install_id: installId }); } catch { return fail(installId, 'network', INSTALL_RETRY_MS.network); }
    if (asked.res.status === 429) return fail(installId, 'challenge_limit', INSTALL_RETRY_MS.limited);
    if (!asked.res.ok || typeof asked.json?.challenge !== 'string' || !Number.isInteger(asked.json?.difficulty)) {
      return fail(installId, `challenge_http_${asked.res.status}`, INSTALL_RETRY_MS.network);
    }
    const { challenge, difficulty } = asked.json;
    // Too hard for now: this address has registered many installs today. Not
    // worth minutes of anyone's CPU; the price falls back at UTC midnight.
    if (difficulty > maxBits) return fail(installId, 'too_hard', INSTALL_RETRY_MS.limited);

    const solved = await solvePow({
      challenge, bits: difficulty, sha256: deps.sha256, now: deps.now, yieldFn: deps.yieldFn, sleep: deps.sleep,
      shouldAbort: () => !deps.isEnabled(), shouldPause: deps.shouldPause,
    });
    if (!solved) return { skipped: 'aborted' };
    stats.hashes += solved.hashes;

    let answer;
    try { answer = await post(deps.registerEndpoint, { challenge, solution: solved.solution }); } catch { return fail(installId, 'network', INSTALL_RETRY_MS.network); }
    const token = answer.json?.install_token;
    if (!answer.res.ok || typeof token !== 'string' || !token) {
      // The challenge expired while a meeting held the solver, or the server
      // restarted with a new key: ask for a fresh one next time.
      return fail(installId, `register_${answer.json?.error || `http_${answer.res.status}`}`, INSTALL_RETRY_MS.refused);
    }
    try { deps.saveToken(installId, token); } catch (e) { log.warn('[Funnel] could not store the install token:', e?.message || e); }
    stats.registered++;
    return { token };
  }

  /**
   * The token for an install, registering it first if it has none.
   * Resolves { token } | { skipped } | { failed }. Never throws.
   */
  async function ensureToken(installId) {
    try {
      if (typeof installId !== 'string' || !installId) return { skipped: 'no_install' };
      const have = deps.loadToken(installId);
      if (typeof have === 'string' && have) return { token: have };
      if (!deps.isEnabled()) return { skipped: 'disabled' };
      if (deps.shouldPause?.()) return { skipped: 'paused' };
      if (inFlight.has(installId)) return inFlight.get(installId);
      if (deps.now() < (retryAt.get(installId) || 0)) return { skipped: 'waiting' };
      if ((attempts.get(installId) || 0) >= INSTALL_MAX_ATTEMPTS) return { skipped: 'attempts' };
      const p = register(installId).catch((e) => { log.warn('[Funnel] registration failed:', e?.message || e); return fail(installId, 'error', INSTALL_RETRY_MS.network); })
        .finally(() => { inFlight.delete(installId); });
      inFlight.set(installId, p);
      return p;
    } catch (e) {
      log.warn('[Funnel] registration failed:', e?.message || e);
      return { failed: 'error' };
    }
  }

  /** The server refused this install's token: forget it, so the next attempt registers again. */
  function invalidate(installId) {
    try { deps.clearToken(installId); } catch { /* best effort */ }
    retryAt.delete(installId);
  }

  return { ensureToken, invalidate, stats: () => ({ ...stats, failed: { ...stats.failed } }) };
}
