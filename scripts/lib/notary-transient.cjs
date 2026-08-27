'use strict';
/**
 * notary-transient.cjs — bounded retry for `xcrun notarytool submit --wait`.
 *
 * WHY THIS EXISTS (2026-08-26):
 *   A signed build died after ~55 minutes of successful work — both .apps packed,
 *   Developer-ID signed, notarized and stapled, both updater ZIPs written — because
 *   the 1.01 GB arm64 DMG upload to Apple's notary S3 bucket was reset mid-flight:
 *
 *     Error: abortedUpload(resumeRequest: … completedParts: [ …148 parts… ],
 *       error: The operation couldn't be completed. (Network.NWError error 54 -
 *       Connection reset by peer))
 *     ⨯ Command failed: xcrun notarytool submit …/Natively-2.8.7-arm64.dmg --wait
 *
 *   notarytool does NOT retry. The single `execFileSync` in afterAllArtifactBuild.cjs
 *   turned one dropped TCP connection into a full rebuild (another ~2× 28-minute app
 *   notarizations). Re-submitting is safe: an aborted upload never became a
 *   submission, it just expires server-side.
 *
 * THE RETRY PREDICATE — "did we reach a verdict?", NOT "does the text look network-y".
 *   The obvious implementation (match /Connection reset|ECONNRESET|…/ against the
 *   thrown message) is DEAD CODE on this path: with `stdio: 'inherit'` the child's
 *   output never reaches `err.message`, which is why the failure above surfaced as a
 *   bare "Command failed: xcrun notarytool submit …" with none of notarytool's text.
 *   Even with the output captured, a wording whitelist fails closed — miss one Apple
 *   phrasing and the retry silently never fires.
 *
 *   So we classify on the ABSENCE OF A VERDICT instead, which is safe by construction:
 *     - exit 0                        → success.
 *     - output shows a terminal status (Accepted/Invalid/Rejected) → DECIDED. Never
 *       retry: re-uploading a genuinely Invalid DMG costs 3 × ~25 min to reach the
 *       same rejection.
 *     - output shows an auth/usage failure                        → never retry; a
 *       bad credential is not going to fix itself in 30 seconds.
 *     - killed by a signal (Ctrl-C)                               → never retry.
 *     - non-zero with NO verdict at all → the submission never reached a decision.
 *       Nothing was rejected, so retrying is always safe. This is the abortedUpload
 *       shape, and it needs no knowledge of how Apple words the network error.
 *
 * SECRET SAFETY: the credential args are argv (`--password <app-specific-password>`
 * for the apple-id strategy), and the old failure printed the whole command line into
 * the build log. Every message this module emits runs through redactNotaryArgs().
 */

const { spawn } = require('node:child_process');

/** notarytool flags whose FOLLOWING argument is a secret or an account identifier. */
const CREDENTIAL_FLAGS = new Set([
  '--password',
  '--apple-id',
  '--team-id',
  '--key',
  '--key-id',
  '--issuer',
  '--keychain-profile',
  '--keychain',
]);

/** A decided notarization verdict. Reaching one means retrying cannot change it. */
const VERDICT_RE = /\bstatus:\s*(Accepted|Invalid|Rejected)\b/i;

/**
 * Auth / usage failures. Not fatal to get wrong — these fail in seconds, so a missed
 * phrasing costs a couple of pointless fast retries, never a re-upload of a decided
 * submission (that case is covered by VERDICT_RE, which is the expensive one to miss).
 */
// NOTE THE APOSTROPHES: notarytool emits TYPOGRAPHIC ones ("couldn’t"), not ASCII.
// Written with an ASCII apostrophe this pattern silently never matched, and a
// nonexistent-file error was retried three times before failing (caught by a live
// run against a bogus path, 2026-08-26). Every literal apostrophe below is ['’].
const AUTH_OR_USAGE_RE =
  /HTTP status code: 401|Unauthorized|Invalid credentials|unable to (?:authenticate|validate)|No Keychain password item found|Keychain profile .* (?:not found|does not exist)|couldn['’]t be opened because it doesn['’]t exist|is invalid for '<|Usage: notarytool|Unrecognized option|Missing (?:required )?(?:option|argument)|error 1519/i;

/**
 * Swift ArgumentParser (which notarytool is built on) exits 64 — the BSD EX_USAGE
 * code — for argument/validation errors, and 1 for runtime failures. That is a
 * structural signal, so it holds regardless of how Apple words the message.
 */
const EX_USAGE = 64;

/**
 * Network-class wording. NOT the gate (see the header) — used only to label the log
 * line, so a retry says "connection reset" rather than a vague "no verdict" when
 * Apple did tell us what happened. Shared with scripts/notarize.js, whose
 * @electron/notarize path DOES surface notarytool's text in err.message.
 */
const TRANSIENT_NETWORK_RE =
  /Connection reset by peer|NWError|abortedUpload|ECONNRESET|ETIMEDOUT|ENETDOWN|EPIPE|socket hang up|network connection was lost|Operation timed out|temporarily unavailable|Internet connection appears to be offline|No network route|NSURLErrorDomain|(?:^|[^0-9])-1009(?:[^0-9]|$)|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|Could not connect to the server/i;

/** @param {string} msg @returns {boolean} */
function isTransientNetworkMessage(msg) {
  return TRANSIENT_NETWORK_RE.test(String(msg || ''));
}

/**
 * Replace the value following every credential flag with `<redacted>`.
 * @param {string[]} args
 * @returns {string[]}
 */
function redactNotaryArgs(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    out.push(args[i]);
    if (CREDENTIAL_FLAGS.has(args[i]) && i + 1 < args.length) {
      out.push('<redacted>');
      i++;
    }
  }
  return out;
}

/**
 * Decide whether a failed `notarytool submit --wait` may be retried.
 * @param {{code: number|null, signal?: string|null, output?: string}} result
 * @returns {{retriable: boolean, reason: string}}
 */
function classifyNotarySubmitFailure(result) {
  const { code, signal = null, output = '' } = result || {};
  if (code === 0) return { retriable: false, reason: 'succeeded' };
  if (signal) return { retriable: false, reason: `interrupted:${signal}` };
  if (code === EX_USAGE) return { retriable: false, reason: 'usage' };

  const verdict = VERDICT_RE.exec(output);
  if (verdict) return { retriable: false, reason: `verdict:${verdict[1]}` };
  if (AUTH_OR_USAGE_RE.test(output)) return { retriable: false, reason: 'auth-or-usage' };

  return {
    retriable: true,
    reason: isTransientNetworkMessage(output) ? 'network' : 'no-verdict',
  };
}

/** Default runner: stream the child's output live AND capture it for classification. */
function runCapture(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const MAX_CAPTURE = 256 * 1024; // notarytool's abortedUpload dump is ~15 KB; cap anyway.
    const tap = (stream, sink) => {
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        if (output.length < MAX_CAPTURE) output += chunk;
        // Echo to keep the live progress the old stdio:'inherit' gave us — but a
        // write to a vanished parent stdout (build piped through `head`, terminal
        // killed) throws EPIPE from inside this handler, where it would escape the
        // promise and crash mid-notarization instead of being classified. The
        // capture buffer is what the classifier reads, so losing the echo is fine.
        try {
          sink.write(chunk);
        } catch {
          /* parent stream gone — keep capturing */
        }
      });
    };
    tap(child.stdout, process.stdout);
    tap(child.stderr, process.stderr);
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, output }));
  });
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Last few output lines, bounded — the abortedUpload dump is one enormous line. */
function outputTail(output, limit = 500) {
  return String(output || '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .slice(-3)
    .join(' | ')
    .slice(0, limit);
}

/**
 * `xcrun notarytool submit <target> <creds> --wait`, retried while no verdict is reached.
 *
 * Only the SUBMIT is retried — never the DMG build. The bytes on disk are unchanged
 * and already Developer-ID signed, so re-submitting the same file is correct and
 * avoids re-running `ditto` + `hdiutil` over a gigabyte per attempt.
 *
 * @param {object} opts
 * @param {string} opts.target                  .dmg/.app/.zip to submit
 * @param {string[]} [opts.credArgs]            notarytool credential args (never logged raw)
 * @param {number} [opts.maxAttempts=3]
 * @param {number} [opts.baseDelayMs=30000]     linear backoff: 30s, 60s, …
 * @param {Function} [opts.run]                 (cmd, args) => Promise<{code, signal, output}>
 * @param {Function} [opts.sleep]                (ms) => Promise<void>
 * @param {Console} [opts.log]
 * @returns {Promise<{code: number, signal: ?string, output: string, attempts: number}>}
 */
async function notarytoolSubmitWithRetry(opts) {
  const {
    target,
    credArgs = [],
    maxAttempts = 3,
    baseDelayMs = 30_000,
    run = runCapture,
    sleep = defaultSleep,
    log = console,
  } = opts || {};

  if (!target) throw new Error('[notary-retry] target is required');

  const args = ['notarytool', 'submit', target, ...credArgs, '--wait'];
  const safeCmd = ['xcrun', ...redactNotaryArgs(args)].join(' ');

  let last = null;
  let reason = 'unknown';
  let attemptsMade = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attemptsMade = attempt;
    const result = await run('xcrun', args);
    if (result.code === 0) return { ...result, attempts: attempt };

    last = result;
    const verdict = classifyNotarySubmitFailure(result);
    reason = verdict.reason;
    if (!verdict.retriable || attempt >= maxAttempts) break;

    const delayMs = baseDelayMs * attempt;
    log.warn(
      `[notary-retry] submit did not reach a verdict (${reason}) on attempt ${attempt}/${maxAttempts} — ` +
        `retrying in ${Math.round(delayMs / 1000)}s. The upload restarts from scratch; ` +
        'the aborted one expires on Apple’s side, so nothing is double-submitted.'
    );
    await sleep(delayMs);
  }

  const tail = outputTail(last && last.output);
  throw new Error(
    `[notary-retry] ${safeCmd} failed (${reason}) after ${attemptsMade === 1 ? '1 attempt' : `${attemptsMade} attempts`}` +
      `; exit=${last ? last.code : 'null'}${last && last.signal ? ` signal=${last.signal}` : ''}` +
      (tail ? `\n[notary-retry] last output: ${tail}` : '')
  );
}

module.exports = {
  CREDENTIAL_FLAGS,
  EX_USAGE,
  VERDICT_RE,
  AUTH_OR_USAGE_RE,
  TRANSIENT_NETWORK_RE,
  isTransientNetworkMessage,
  redactNotaryArgs,
  classifyNotarySubmitFailure,
  notarytoolSubmitWithRetry,
  runCapture,
};
