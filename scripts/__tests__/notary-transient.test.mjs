// Unit tests for scripts/lib/notary-transient.cjs — the bounded retry that wraps
// `xcrun notarytool submit --wait` on the macOS signed-build path.
//
// This code only ever runs on macOS, but every decision it makes is pure: the
// classifier takes a captured {code, signal, output} and the retry loop takes its
// runner and its sleep as parameters. So the whole thing is exercised from either
// host, with no Apple account, no network, and no waiting.
//
// The fixtures below are the REAL notarytool output shapes, including the verbatim
// tail of the 2026-08-26 failure that motivated the retry.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  redactNotaryArgs,
  classifyNotarySubmitFailure,
  notarytoolSubmitWithRetry,
  isTransientNetworkMessage,
  extractSubmissionIds,
  parseSubmissionStatus,
  shouldRetryNotarizeThrow,
} = require('../lib/notary-transient.cjs');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// The build that died on 2026-08-26: the upload was reset at part 148 of the
// 1.01 GB arm64 DMG. Note there is NO `status:` line anywhere — Apple never
// reached a verdict, which is exactly what makes a retry safe.
const ABORTED_UPLOAD = `Conducting pre-submission checks for Natively-2.8.7-arm64.dmg and initiating connection to the Apple notary service...
Submission ID received
  id: 1fc52d33-8223-4f10-bd9b-d3e57041caeb
Error: abortedUpload(resumeRequest: SotoS3.S3.ResumeMultipartUploadRequest(uploadRequest: SotoS3.S3.CreateMultipartUploadRequest(acl: nil, bucket: "notary-submissions-prod"), uploadId: "C1Yu5crB", completedParts: [SotoS3.S3.CompletedPart(eTag: Optional("\\"066a630c8ba415b79c2ab440aeaa0d94\\""), partNumber: Optional(148))]), error: The operation couldn't be completed. (Network.NWError error 54 - Connection reset by peer))`;

const REJECTED = `Conducting pre-submission checks…
Submission ID received
  id: aaaa-bbbb
Waiting for processing to complete.
Current status: In Progress....
Processing complete
  id: aaaa-bbbb
  status: Invalid`;

const ACCEPTED_BUT_NONZERO = `Processing complete
  id: aaaa-bbbb
  status: Accepted`;

const AUTH_401 = `Conducting pre-submission checks…
Error: HTTP status code: 401. Unable to authenticate with the App Store Connect API key.`;

// ---------------------------------------------------------------------------
// redactNotaryArgs — no app-specific password may reach a build log.
// ---------------------------------------------------------------------------

test('redactNotaryArgs hides the value after every credential flag', () => {
  const args = [
    'notarytool', 'submit', '/release/Natively.dmg',
    '--apple-id', 'evin@example.com',
    '--password', 'abcd-efgh-ijkl-mnop',
    '--team-id', 'BJM29W3UQ6',
    '--wait',
  ];
  const safe = redactNotaryArgs(args).join(' ');
  assert.ok(!safe.includes('abcd-efgh-ijkl-mnop'), 'app-specific password leaked');
  assert.ok(!safe.includes('evin@example.com'), 'apple id leaked');
  assert.ok(!safe.includes('BJM29W3UQ6'), 'team id leaked');
  assert.ok(safe.includes('/release/Natively.dmg'), 'the target path must stay readable');
  assert.equal(safe.match(/<redacted>/g).length, 3);
});

test('redactNotaryArgs covers the api-key and keychain strategies too', () => {
  const safe = redactNotaryArgs([
    '--key', '/Users/evin/Downloads/AuthKey.p8',
    '--key-id', 'T9GPZ92M7K',
    '--issuer', '11111111-2222-3333-4444-555555555555',
    '--keychain-profile', 'natively-notary',
  ]).join(' ');
  assert.equal(safe, '--key <redacted> --key-id <redacted> --issuer <redacted> --keychain-profile <redacted>');
});

test('redactNotaryArgs tolerates a trailing credential flag with no value', () => {
  assert.deepEqual(redactNotaryArgs(['--wait', '--password']), ['--wait', '--password']);
});

// ---------------------------------------------------------------------------
// classifyNotarySubmitFailure — "did we reach a verdict?", not "does it look network-y".
// ---------------------------------------------------------------------------

test('an aborted upload reached no verdict, so it retries', () => {
  const c = classifyNotarySubmitFailure({ code: 1, output: ABORTED_UPLOAD });
  assert.equal(c.retriable, true);
  assert.equal(c.reason, 'network');
});

test('a failure with NO captured output at all still retries', () => {
  // The pre-fix call site used stdio:'inherit', so nothing but the exit code was
  // ever available. A wording whitelist would have been dead code here; verdict
  // absence is what makes the retry fire.
  const c = classifyNotarySubmitFailure({ code: 1, output: '' });
  assert.equal(c.retriable, true);
  assert.equal(c.reason, 'no-verdict');
});

test('a decided Invalid verdict NEVER retries', () => {
  // The expensive mistake to get wrong: 3 × ~25 min of re-upload to reach the
  // same rejection.
  const c = classifyNotarySubmitFailure({ code: 1, output: REJECTED });
  assert.equal(c.retriable, false);
  assert.equal(c.reason, 'verdict:Invalid');
});

test('an Accepted verdict with a non-zero exit does not retry either', () => {
  const c = classifyNotarySubmitFailure({ code: 1, output: ACCEPTED_BUT_NONZERO });
  assert.equal(c.retriable, false);
  assert.equal(c.reason, 'verdict:Accepted');
});

test('auth failures do not retry', () => {
  assert.deepEqual(classifyNotarySubmitFailure({ code: 1, output: AUTH_401 }), {
    retriable: false,
    reason: 'auth-or-usage',
  });
});

// Verbatim from a live `xcrun notarytool submit /nonexistent.dmg --wait`, 2026-08-26.
// The apostrophes here are TYPOGRAPHIC (’), which is exactly how the first cut of
// AUTH_OR_USAGE_RE — written with ASCII apostrophes — silently never matched and
// retried a hopeless argument error three times.
const MISSING_FILE = `Error: The value '/nonexistent/definitely-not-a.dmg' is invalid for '<file-path>': The file couldn’t be opened because it doesn’t exist.
Help:  <file-path>  Path to the archive
Usage: notarytool submit [<options>] <file-path>
  See 'notarytool submit --help' for more information.`;

test('a bad argument does not retry — structurally, via exit 64 (EX_USAGE)', () => {
  // Swift ArgumentParser's usage exit code. Holds no matter how Apple words it.
  const c = classifyNotarySubmitFailure({ code: 64, signal: null, output: MISSING_FILE });
  assert.equal(c.retriable, false);
  assert.equal(c.reason, 'usage');
});

test('the same argument error is caught by wording alone, apostrophes and all', () => {
  // Belt and braces: if a future notarytool stops using 64, the text still matches.
  const c = classifyNotarySubmitFailure({ code: 1, signal: null, output: MISSING_FILE });
  assert.equal(c.retriable, false);
  assert.equal(c.reason, 'auth-or-usage');
});

test('the ASCII-apostrophe spelling is matched too', () => {
  const c = classifyNotarySubmitFailure({
    code: 1,
    output: "Error: The file couldn't be opened because it doesn't exist.",
  });
  assert.equal(c.retriable, false);
});

test('a Ctrl-C (signal kill) does not retry', () => {
  const c = classifyNotarySubmitFailure({ code: null, signal: 'SIGINT', output: '' });
  assert.equal(c.retriable, false);
  assert.equal(c.reason, 'interrupted:SIGINT');
});

test('exit 0 is not a failure', () => {
  assert.equal(classifyNotarySubmitFailure({ code: 0, output: '' }).retriable, false);
});

// The label-only regex, shared with scripts/notarize.js's @electron/notarize path.
// On THAT path it is the actual gate (not just a label), because @electron/notarize
// gives us only a thrown message — no exit code, no verdict line — so verdict-absence
// cannot be used there.
test('isTransientNetworkMessage recognises the notary network signatures', () => {
  assert.ok(isTransientNetworkMessage('Network.NWError error 54 - Connection reset by peer'));
  assert.ok(isTransientNetworkMessage('socket hang up'));
  assert.ok(!isTransientNetworkMessage('The staple and validate action failed! Error 65.'));
});

test('a full network outage is transient — it must not abort the build', () => {
  // 2026-08-27: a signed build died mid-notarization when the machine lost its network
  // route. The retry fired once, then the SECOND attempt returned this shape, which
  // matched no signature, so it was classified non-transient and the build aborted —
  // on precisely the condition the retry exists to ride out. Verbatim from that run:
  const offline =
    'Error: HTTPError(statusCode: nil, error: Error Domain=NSURLErrorDomain Code=-1009 ' +
    '"The Internet connection appears to be offline." UserInfo={_kCFStreamErrorCodeKey=50, ' +
    '_NSURLErrorNWPathKey=unsatisfied (No network route)})';
  assert.ok(isTransientNetworkMessage(offline));
});

test('DNS and unreachable-host failures are transient too', () => {
  for (const m of ['getaddrinfo ENOTFOUND appstoreconnect.apple.com', 'EAI_AGAIN', 'connect EHOSTUNREACH', 'connect ENETUNREACH']) {
    assert.ok(isTransientNetworkMessage(m), `${m} should be transient`);
  }
});

test('a rejection that merely CONTAINS a number like 1009 is not mistaken for offline', () => {
  // The -1009 alternation is digit-bounded so an unrelated id cannot trip it.
  assert.ok(!isTransientNetworkMessage('status: Invalid — ticket 21009 rejected'));
});

// ---------------------------------------------------------------------------
// notarytoolSubmitWithRetry — injected runner + sleep, so nothing here waits.
// ---------------------------------------------------------------------------

/**
 * Runner that replays a queue of SUBMIT results and answers `info`/`wait` probes
 * separately. The two must be distinguishable: since 2026-08-27 a failed submit
 * asks Apple about the submission it created before re-uploading, so a runner that
 * lumped them together would mis-count uploads.
 */
function fakeRunner(results, probeResults = {}) {
  const calls = [];
  const submits = [];
  const run = async (cmd, args) => {
    calls.push({ cmd, args });
    if (args.includes('info')) return probeResults.info ?? { code: 1, output: 'not found' };
    if (args.includes('wait')) return probeResults.wait ?? { code: 1, output: 'timed out' };
    submits.push({ cmd, args });
    return results[Math.min(submits.length - 1, results.length - 1)];
  };
  return { run, calls, submits };
}

const silent = { warn() {}, log() {}, error() {} };

test('a dropped upload retries and succeeds on the next attempt', async () => {
  const { run, submits } = fakeRunner([
    { code: 1, signal: null, output: ABORTED_UPLOAD },
    { code: 0, signal: null, output: 'status: Accepted' },
  ]);
  const slept = [];
  const res = await notarytoolSubmitWithRetry({
    target: '/release/Natively-2.8.7-arm64.dmg',
    credArgs: ['--keychain-profile', 'natively-notary'],
    run,
    sleep: async (ms) => slept.push(ms),
    log: silent,
  });

  assert.equal(res.attempts, 2);
  assert.equal(submits.length, 2, 'two uploads');
  assert.deepEqual(slept, [30_000], 'default backoff is 30s on the first retry');
});

test('the retry re-submits the SAME file — it never rebuilds the DMG', async () => {
  const { run, submits } = fakeRunner([
    { code: 1, signal: null, output: ABORTED_UPLOAD },
    { code: 0, signal: null, output: '' },
  ]);
  await notarytoolSubmitWithRetry({
    target: '/release/Natively-2.8.7-arm64.dmg',
    credArgs: ['--keychain-profile', 'natively-notary'],
    run,
    sleep: async () => {},
    log: silent,
  });
  for (const call of submits) {
    assert.equal(call.cmd, 'xcrun');
    assert.deepEqual(call.args, [
      'notarytool', 'submit', '/release/Natively-2.8.7-arm64.dmg',
      '--keychain-profile', 'natively-notary', '--wait',
    ]);
  }
});

test('an Invalid verdict fails on the FIRST attempt — no re-upload, no sleep', async () => {
  const { run, calls } = fakeRunner([{ code: 1, signal: null, output: REJECTED }]);
  const slept = [];
  await assert.rejects(
    () => notarytoolSubmitWithRetry({
      target: '/release/Natively.dmg', run, sleep: async (ms) => slept.push(ms), log: silent,
    }),
    /verdict:Invalid/
  );
  assert.equal(calls.length, 1, 'a decided rejection must not be re-uploaded');
  assert.deepEqual(slept, []);
});

test('the failure message reports attempts ACTUALLY made, not the cap', async () => {
  const { run } = fakeRunner([{ code: 64, signal: null, output: MISSING_FILE }]);
  const err = await notarytoolSubmitWithRetry({
    target: '/release/Natively.dmg', maxAttempts: 3, run, sleep: async () => {}, log: silent,
  }).then(() => null, (e) => e);
  assert.match(err.message, /after 1 attempt\b/);
});

test('a persistent network failure gives up after maxAttempts with backoff', async () => {
  const { run, submits } = fakeRunner([{ code: 1, signal: null, output: ABORTED_UPLOAD }]);
  const slept = [];
  await assert.rejects(
    () => notarytoolSubmitWithRetry({
      target: '/release/Natively.dmg',
      maxAttempts: 3,
      baseDelayMs: 30_000,
      run,
      sleep: async (ms) => slept.push(ms),
      log: silent,
    }),
    /network/
  );
  assert.equal(submits.length, 3, 'three uploads');
  assert.deepEqual(slept, [30_000, 60_000], 'linear backoff, and no sleep after the last attempt');
});

test('the thrown error never contains a credential value', async () => {
  const { run } = fakeRunner([{ code: 1, signal: null, output: ABORTED_UPLOAD }]);
  const err = await notarytoolSubmitWithRetry({
    target: '/release/Natively.dmg',
    credArgs: ['--apple-id', 'evin@example.com', '--password', 'abcd-efgh-ijkl-mnop'],
    maxAttempts: 1,
    run,
    sleep: async () => {},
    log: silent,
  }).then(() => null, (e) => e);

  assert.ok(err, 'expected a rejection');
  assert.ok(!err.message.includes('abcd-efgh-ijkl-mnop'), 'password leaked into the build log');
  assert.ok(!err.message.includes('evin@example.com'), 'apple id leaked into the build log');
  assert.match(err.message, /<redacted>/);
  assert.match(err.message, /Natively\.dmg/);
});

test('the retry warning never contains a credential value', async () => {
  const { run } = fakeRunner([
    { code: 1, signal: null, output: ABORTED_UPLOAD },
    { code: 0, signal: null, output: '' },
  ]);
  const warnings = [];
  await notarytoolSubmitWithRetry({
    target: '/release/Natively.dmg',
    credArgs: ['--password', 'abcd-efgh-ijkl-mnop'],
    run,
    sleep: async () => {},
    log: { warn: (m) => warnings.push(m), log() {}, error() {} },
  });
  assert.equal(warnings.length, 1);
  assert.ok(!warnings[0].includes('abcd-efgh-ijkl-mnop'));
});

test('a bounded error message survives the enormous abortedUpload dump', async () => {
  const huge = `${ABORTED_UPLOAD}${'x'.repeat(50_000)}`;
  const { run } = fakeRunner([{ code: 1, signal: null, output: huge }]);
  const err = await notarytoolSubmitWithRetry({
    target: '/release/Natively.dmg', maxAttempts: 1, run, sleep: async () => {}, log: silent,
  }).then(() => null, (e) => e);
  assert.ok(err.message.length < 1500, `error message not bounded: ${err.message.length} chars`);
});

test('a target is required', async () => {
  await assert.rejects(() => notarytoolSubmitWithRetry({}), /target is required/);
});


// ---------------------------------------------------------------------------
// Recovery via submission id — added 2026-08-27.
//
// Three builds died locally while their submission was ALIVE on Apple's side:
// one came back Accepted, and a single retry round left three ids at "In Progress".
// Each of those builds re-uploaded ~1 GB, or gave up, for work Apple already had.
// ---------------------------------------------------------------------------

test('extractSubmissionIds pulls the ids notarytool printed, oldest first', () => {
  const out = 'Submission ID received\n  id: 11111111-2222-3333-4444-555555555555\n' +
              'Submission ID received\n  id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  assert.deepEqual(extractSubmissionIds(out), [
    '11111111-2222-3333-4444-555555555555',
    'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  ]);
  assert.deepEqual(extractSubmissionIds('no ids here'), []);
});

test('parseSubmissionStatus reads every terminal and pending state', () => {
  assert.equal(parseSubmissionStatus('  status: Accepted'), 'Accepted');
  assert.equal(parseSubmissionStatus('Current status: In Progress....'), 'In Progress');
  assert.equal(parseSubmissionStatus('  status: Invalid'), 'Invalid');
  assert.equal(parseSubmissionStatus('nothing'), null);
});

test('an already-Accepted submission short-circuits the re-upload entirely', async () => {
  const { run, submits } = fakeRunner(
    [{ code: 1, signal: null, output: ABORTED_UPLOAD }],
    { info: { code: 0, output: '  status: Accepted' } }
  );
  const res = await notarytoolSubmitWithRetry({
    target: '/release/Natively.dmg', run, sleep: async () => {}, log: silent,
  });
  assert.equal(res.code, 0);
  assert.equal(res.recoveredSubmissionId, '1fc52d33-8223-4f10-bd9b-d3e57041caeb');
  assert.equal(submits.length, 1, 'must NOT upload again — Apple already accepted it');
});

test('"In Progress" is NOT treated as recoverable — it carries no information', async () => {
  // MEASURED 2026-08-27, correcting an earlier wrong assumption: a submission record
  // is created when Apple accepts the REQUEST, not when the upload completes, so an
  // aborted upload sits In Progress indefinitely (five did, for over an hour; a
  // `notarytool wait` on one was still blocked after 60+ minutes). It looks identical
  // to a live submission, so waiting on it would block for the full timeout and then
  // need the re-upload anyway.
  const { run, submits, calls } = fakeRunner(
    [{ code: 1, signal: null, output: ABORTED_UPLOAD }, { code: 0, signal: null, output: '' }],
    { info: { code: 0, output: '  status: In Progress' } }
  );
  const res = await notarytoolSubmitWithRetry({
    target: '/release/Natively.dmg', run, sleep: async () => {}, log: silent,
  });
  assert.equal(res.code, 0);
  assert.equal(submits.length, 2, 'must re-submit rather than wait');
  assert.ok(!calls.some((c) => c.args.includes('wait')), 'must never block on `notarytool wait`');
});

// ---------------------------------------------------------------------------
// shouldRetryNotarizeThrow — the @electron/notarize (.app) path, which gets only a
// thrown message. Gating on WORDING lost twice: HTTPClientError.connectTimeout
// matched nothing on 2026-08-27 and two builds aborted without a single retry.
// It now asks "was a verdict reached?" and fails OPEN on anything unrecognised.
// ---------------------------------------------------------------------------

test('THE REGRESSION: connectTimeout is retried (it aborted two builds silently)', () => {
  assert.equal(
    shouldRetryNotarizeThrow('Failed with unexpected result: \n\nError: HTTPClientError.connectTimeout'),
    true
  );
});

test('an empty "unexpected result" is retried rather than swallowed', () => {
  assert.equal(shouldRetryNotarizeThrow('Failed to notarize via notarytool.  Failed with unexpected result: '), true);
});

test('an unrecognised error fails OPEN — a missed signature costs a whole rebuild', () => {
  assert.equal(shouldRetryNotarizeThrow('Some brand new Apple error nobody has seen'), true);
});

test('a decided verdict is never retried', () => {
  assert.equal(shouldRetryNotarizeThrow('  status: Invalid'), false);
  assert.equal(shouldRetryNotarizeThrow('  status: Accepted'), false);
});

test('auth failures and staple races are not retried by this gate', () => {
  assert.equal(shouldRetryNotarizeThrow('Error: No Keychain password item found for profile: x'), false);
  // Staple is the submission having SUCCEEDED — notarize.js recovers it separately.
  assert.equal(shouldRetryNotarizeThrow('The staple and validate action failed! Error 65.'), false);
});

test('a submission Apple already REJECTED stops immediately — no further uploads', async () => {
  const { run, submits } = fakeRunner(
    [{ code: 1, signal: null, output: ABORTED_UPLOAD }],
    { info: { code: 0, output: '  status: Invalid' } }
  );
  await assert.rejects(
    () => notarytoolSubmitWithRetry({
      target: '/release/Natively.dmg', maxAttempts: 3, run, sleep: async () => {}, log: silent,
    }),
    /verdict:Invalid/
  );
  assert.equal(submits.length, 1);
});

test('when the id is unknown to Apple, the normal re-upload still happens', async () => {
  // An upload that aborted before the bytes landed leaves an id that never reaches a
  // verdict — waiting on it would hang, so re-submitting is correct there.
  const { run, submits } = fakeRunner(
    [{ code: 1, signal: null, output: ABORTED_UPLOAD }, { code: 0, signal: null, output: '' }],
    { info: { code: 1, output: 'Error: submission does not exist' } }
  );
  const res = await notarytoolSubmitWithRetry({
    target: '/release/Natively.dmg', run, sleep: async () => {}, log: silent,
  });
  assert.equal(res.code, 0);
  assert.equal(submits.length, 2, 'falls back to a real re-submit');
});
