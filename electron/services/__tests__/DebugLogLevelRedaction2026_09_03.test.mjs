/**
 * DebugLogLevelRedaction2026_09_03.test.mjs
 *
 * Guards the two-axis split in redactForLog: credentials are ALWAYS scrubbed
 * (no level relaxes them), user content is redacted at 'standard' and kept at
 * 'full'.
 *
 * The load-bearing test here is "credentials survive nothing at full". A
 * security assertion that can pass vacuously is worse than no assertion, so
 * each canary is paired with a MUTATION PROBE: the same payload under a
 * non-matching key, proving the canary string actually reaches the output and
 * the redaction — not a typo'd fixture — is what removed it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadRedactor() {
  const distPath = path.resolve(__dirname, '../../../dist-electron/electron/utils/redactForLog.js');
  return import(pathToFileURL(distPath).href);
}

// ── axis 1: credentials, unconditional ──────────────────────────────────────

test('credentials are redacted at FULL — the level never relaxes axis 1', async () => {
  const { redactForLog } = await loadRedactor();

  const credentials = {
    apiKey: 'CANARY_APIKEY',
    xApiKey: 'CANARY_XAPIKEY',
    authorization: 'CANARY_AUTHORIZATION',
    refreshToken: 'CANARY_REFRESHTOKEN',
    clientSecret: 'CANARY_CLIENTSECRET',
    password: 'CANARY_PASSWORD',
    cookie: 'CANARY_COOKIE',
    signature: 'CANARY_SIGNATURE',
    xTrialToken: 'CANARY_XTRIALTOKEN',
  };

  const out = redactForLog([credentials], 'full');

  for (const [key, canary] of Object.entries(credentials)) {
    assert.ok(!out.includes(canary), `credential leaked at full via key "${key}": ${out}`);
  }

  // MUTATION PROBE. Same values under keys that match NEITHER list. If these
  // do not survive, the test above proves nothing — the canaries would be
  // vanishing for some unrelated reason (serialization, truncation, a bad
  // fixture) rather than because CREDENTIAL_KEY_RE matched.
  const probe = redactForLog([{
    providerLabel: 'CANARY_APIKEY',
    displayName: 'CANARY_AUTHORIZATION',
    stageLabel: 'CANARY_COOKIE',
  }], 'full');
  assert.ok(probe.includes('CANARY_APIKEY'), `probe failed: value did not survive a non-sensitive key — the credential test is vacuous. Got: ${probe}`);
  assert.ok(probe.includes('CANARY_AUTHORIZATION'), `probe failed: ${probe}`);
  assert.ok(probe.includes('CANARY_COOKIE'), `probe failed: ${probe}`);
});

test('credential free-text patterns are scrubbed at FULL', async () => {
  const { redactForLog } = await loadRedactor();

  const secrets = [
    'natively_sk_LEAK_ONE',
    'sk-abcdefghijklmnopqrstuvwx',
    'gsk_ZZZZZZZZZZZZZZZZZZZZZZ',
    'AIzaAAAAAAAAAAAAAAAAAAAAAA',
    'sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaa',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.SIGNATUREPART',
    'Authorization header: Bearer abc123def456ghi789jkl0mn',
  ];

  for (const secret of secrets) {
    // Inside free text, not a property bag — this is the VALUE_PATTERNS path.
    const out = redactForLog([`[Provider] request failed with ${secret} attached`], 'full');
    assert.ok(out.includes('[REDACTED]'), `no redaction marker for: ${secret}`);
  }

  // MUTATION PROBE: a credential-shaped-but-not-matching string must survive,
  // proving free text is not being blanket-erased.
  const probe = redactForLog(['[Provider] request failed with PLAIN_DIAGNOSTIC_TEXT attached'], 'full');
  assert.ok(probe.includes('PLAIN_DIAGNOSTIC_TEXT'), `probe failed: free text is being erased wholesale. Got: ${probe}`);
});

test('a key matching BOTH lists resolves as a credential, not as content', async () => {
  const { redactForLog } = await loadRedactor();
  // `promptToken` ends in "token" (credential) and contains "prompt" (content).
  // Credentials are checked first, so it must redact even at full.
  const out = redactForLog([{ promptToken: 'CANARY_BOTH_LISTS' }], 'full');
  assert.ok(!out.includes('CANARY_BOTH_LISTS'), `credential precedence lost: ${out}`);
});

// ── axis 2: user content, level-dependent ───────────────────────────────────

test('user content is redacted at STANDARD — default behavior is unchanged', async () => {
  const { redactForLog } = await loadRedactor();

  const payload = {
    transcript: 'TRANSCRIPT_CANARY',
    prompt: 'PROMPT_CANARY',
    answer: 'ANSWER_CANARY',
    evidenceText: 'EVIDENCE_CANARY',
    chunkText: 'CHUNK_CANARY',
    userInput: 'USERINPUT_CANARY',
  };

  const out = redactForLog([payload], 'standard');
  for (const canary of Object.values(payload)) {
    assert.ok(!out.includes(canary), `content leaked at standard: ${canary} in ${out}`);
  }
});

test('user content is KEPT at FULL — this is the point of the feature', async () => {
  const { redactForLog } = await loadRedactor();

  const payload = {
    transcript: 'TRANSCRIPT_CANARY',
    prompt: 'PROMPT_CANARY',
    answer: 'ANSWER_CANARY',
    evidenceText: 'EVIDENCE_CANARY',
    chunkText: 'CHUNK_CANARY',
    userInput: 'USERINPUT_CANARY',
    content: 'CONTENT_CANARY',
    text: 'TEXT_CANARY',
  };

  const out = redactForLog([payload], 'full');
  for (const [key, canary] of Object.entries(payload)) {
    assert.ok(out.includes(canary), `content wrongly redacted at full for key "${key}": ${out}`);
  }
});

test('base64 / audio blobs stay REMOVED even at FULL — never readable, always huge', async () => {
  const { redactForLog } = await loadRedactor();
  const out = redactForLog([{ base64: 'BLOB_CANARY', audioData: 'AUDIO_CANARY' }], 'full');
  assert.ok(!out.includes('BLOB_CANARY'), `base64 kept at full: ${out}`);
  assert.ok(!out.includes('AUDIO_CANARY'), `audioData kept at full: ${out}`);
});

// ── truncation ──────────────────────────────────────────────────────────────

test('string cap is 120 at standard and 8000 at full', async () => {
  const { redactForLog } = await loadRedactor();
  const long = 'x'.repeat(9000);

  const std = JSON.parse(redactForLog([{ note: long }], 'standard'));
  assert.equal(std.note.length, 120, 'standard cap drifted from 120');

  const full = JSON.parse(redactForLog([{ note: long }], 'full'));
  assert.equal(full.note.length, 8000, 'full cap drifted from 8000');
});

// ── level binding ───────────────────────────────────────────────────────────

test('level binding defaults to standard and is settable process-wide', async () => {
  const { getLogRedactionLevel, setLogRedactionLevel, redactForLog } = await loadRedactor();

  assert.equal(getLogRedactionLevel(), 'standard', 'default level must be standard');

  // No explicit level argument — must follow the binding.
  assert.ok(!redactForLog([{ answer: 'BOUND_CANARY' }]).includes('BOUND_CANARY'));

  setLogRedactionLevel('full');
  try {
    assert.equal(getLogRedactionLevel(), 'full');
    assert.ok(redactForLog([{ answer: 'BOUND_CANARY' }]).includes('BOUND_CANARY'),
      'binding did not reach redactForLog — check the globalThis anchor');
  } finally {
    setLogRedactionLevel('standard');
  }
  assert.equal(getLogRedactionLevel(), 'standard');
});

test('the level binding is anchored on globalThis, not a module-local let', async () => {
  // scripts/build-electron.js runs esbuild with bundle:true over every .ts as
  // its own entry, so this module is inlined per bundle. A module-local flag
  // set by main.js would be invisible to ipcHandlers.js. Assert the anchor
  // exists so that trap cannot regress silently.
  const { setLogRedactionLevel } = await loadRedactor();
  setLogRedactionLevel('full');
  try {
    assert.equal(globalThis.__nativelyLogRedactionLevelV1__?.level, 'full',
      'level is not anchored on globalThis — per-bundle copies will diverge');
  } finally {
    setLogRedactionLevel('standard');
  }
});

// ── secrets-only helper (for pre-stringified trace producers) ───────────────

test('redactSecretsOnly strips credentials but keeps content at any level', async () => {
  const { redactSecretsOnly, setLogRedactionLevel } = await loadRedactor();

  setLogRedactionLevel('standard');
  try {
    const out = JSON.stringify(redactSecretsOnly({
      question: 'QUESTION_CANARY',
      answer: 'ANSWER_CANARY',
      apiKey: 'SECRET_CANARY',
    }));
    assert.ok(out.includes('QUESTION_CANARY'), `question dropped: ${out}`);
    assert.ok(out.includes('ANSWER_CANARY'), `answer dropped: ${out}`);
    assert.ok(!out.includes('SECRET_CANARY'), `credential leaked: ${out}`);
  } finally {
    setLogRedactionLevel('standard');
  }
});
