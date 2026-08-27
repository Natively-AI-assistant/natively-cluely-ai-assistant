'use strict';
/**
 * notary-preflight.cjs — fail a signed build in seconds when the notary service
 * is unreachable, instead of ~10 minutes in.
 *
 * WHY (2026-08-27): two signed builds in a row spent the full tsc + Vite + Rust +
 * pack + Developer-ID-sign sequence and then died at the FIRST network call:
 *
 *   Error Domain=NSURLErrorDomain Code=-1009 "The Internet connection appears to
 *   be offline." … _NSURLErrorNWPathKey=unsatisfied (No network route)
 *
 * scripts/lib/notary-transient.cjs now retries that, which is right for a blip —
 * but retrying a machine with no route just spends the retry budget to reach the
 * same failure. Neither helps if the connection was never there. Checking first
 * costs about a second and turns a ten-minute dead end into an immediate answer.
 *
 * DELIBERATELY NARROW: reachability only. It does NOT validate credentials or
 * predict Apple-side outcomes — a build that passes preflight can still fail
 * notarization, and that is fine. A false "unreachable" would block a working
 * build, so the check errs toward passing: multiple attempts, and any successful
 * connection is enough.
 */

const net = require('node:net');

/** notarytool's control plane — the host in the -1009 failure above. */
const NOTARY_HOST = 'appstoreconnect.apple.com';
const NOTARY_PORT = 443;

/**
 * Should the preflight run at all?
 * @param {{platform: string, env: Record<string,string|undefined>}} ctx
 * @returns {{run: boolean, reason: string}}
 */
function decidePreflight({ platform, env }) {
  if (env.NATIVELY_SKIP_NOTARY_PREFLIGHT === '1') {
    return { run: false, reason: 'NATIVELY_SKIP_NOTARY_PREFLIGHT=1 — skipping (offline packaging).' };
  }
  if (platform !== 'darwin') {
    return { run: false, reason: `platform is ${platform}, not darwin — nothing here notarizes.` };
  }
  if (env.NATIVELY_SKIP_NOTARIZE === '1') {
    // Honour the same escape hatch scripts/notarize.js uses; a build that will
    // not notarize must not be blocked by the notary being unreachable.
    return { run: false, reason: 'NATIVELY_SKIP_NOTARIZE=1 — this build will not notarize.' };
  }
  return { run: true, reason: 'signed darwin build — notarization will need the network.' };
}

/** Default connector: resolve + TCP-connect, resolving true/false, never throwing. */
function tcpProbe({ host, port, timeoutMs }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok, detail) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* best effort */ }
      resolve({ ok, detail });
    };
    const socket = net.connect({ host, port });
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true, 'connected'));
    socket.once('timeout', () => done(false, `no response within ${timeoutMs}ms`));
    socket.once('error', (err) => done(false, err && err.code ? err.code : String(err && err.message)));
  });
}

/**
 * Is the notary host reachable? Retries before declaring failure, because a
 * single dropped probe must not block an otherwise fine build.
 *
 * @param {object} [opts]
 * @param {string} [opts.host]
 * @param {number} [opts.port]
 * @param {number} [opts.timeoutMs=6000]
 * @param {number} [opts.attempts=2]
 * @param {Function} [opts.probe]  injectable ({host,port,timeoutMs}) => Promise<{ok,detail}>
 * @param {Function} [opts.sleep]  injectable (ms) => Promise<void>
 * @returns {Promise<{ok: boolean, attempts: number, detail: string}>}
 */
async function checkNotaryReachable(opts = {}) {
  const {
    host = NOTARY_HOST,
    port = NOTARY_PORT,
    timeoutMs = 6000,
    attempts = 2,
    probe = tcpProbe,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = opts;

  let detail = 'no attempt made';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await probe({ host, port, timeoutMs });
    if (result && result.ok) return { ok: true, attempts: attempt, detail: result.detail || 'connected' };
    detail = (result && result.detail) || 'unknown';
    if (attempt < attempts) await sleep(1000);
  }
  return { ok: false, attempts, detail };
}

module.exports = { NOTARY_HOST, NOTARY_PORT, decidePreflight, checkNotaryReachable, tcpProbe };
