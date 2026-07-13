import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

async function loadRedactor() {
  const distPath = path.resolve(__dirname, '../../../dist-electron/electron/utils/redactForLog.js');
  return import(pathToFileURL(distPath).href);
}

test('redactForLog scrubs API keys, bearer tokens, JWTs, and natively/Anthropic key shapes', async () => {
  const { redactForLog } = await loadRedactor();

  const inputs = [
    'auth: Bearer abc123def456ghi789jkl0mn',
    'natively_sk_THIS_SHOULD_BE_HIDDEN',
    'OpenAI key: sk-abcdefghijklmnopqrstu',
    'Groq key: gsk_ZZZZZZZZZZZZZZZZZZZZ',
    'Anthropic: sk-ant-api03-aaaaaaaaaaaaaaaaaaaa',
    'Google: AIzaAAAAAAAAAAAAAAAAAAAAA',
    'JWT cookie eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SXXXXXXXXXX',
  ];

  for (const input of inputs) {
    const out = redactForLog([input]);
    assert.ok(out.includes('[REDACTED]'), `expected redaction for: ${input}`);
    assert.ok(
      !out.includes('THIS_SHOULD_BE_HIDDEN') &&
      !out.includes('abc123def456ghi789jkl0mn') &&
      !out.includes('sk-abcdefghijklmnopqrstu') &&
      !out.includes('gsk_ZZZZZZZZZZZZZZZZZZZZ') &&
      !out.includes('sk-ant-api03-aaaaaaaaaaaaaaaaaaaa') &&
      !out.includes('AIzaAAAAAAAAAAAAAAAAAAAAA') &&
      !out.includes('SXXXXXXXXXX'),
      `unexpected raw credential leak in: ${out}`
    );
  }
});

test('redactForLog removes raw transcript / prompt / reference / screenshot fields and redacts sensitive keys', async () => {
  const { redactForLog } = await loadRedactor();

  const payload = {
    transcript: 'CANDIDATE_TRANSCRIPT_CANARY',
    prompt: 'INTERNAL_PROMPT_CANARY',
    referenceContent: 'RESUME_CANARY',
    screenshotPath: '/Users/me/Library/Application Support/.../shot.png',
    apiKey: 'sk-FOO',
    Authorization: 'Bearer ANOTHERSECRETTOKEN1234',
    chunkText: 'CHUNK_CANARY',
    safeMeta: { count: 12, providerName: 'openai', durationMs: 304 },
  };

  const out = redactForLog([payload]);
  // No raw sentinel survives.
  for (const canary of ['CANDIDATE_TRANSCRIPT_CANARY', 'INTERNAL_PROMPT_CANARY', 'RESUME_CANARY', 'CHUNK_CANARY', 'shot.png', 'sk-FOO', 'ANOTHERSECRETTOKEN1234']) {
    assert.ok(!out.includes(canary), `canary ${canary} should not leak — got: ${out}`);
  }
  // Safe metadata survives.
  assert.ok(out.includes('"providerName":"openai"'));
  assert.ok(out.includes('"durationMs":304'));
});

test('redactForLog redacts answer/content/text/output-shaped fields (2026-07-10 hardening)', async () => {
  const { redactForLog } = await loadRedactor();

  // These key names are not currently used by any real log call site (verified
  // during the Phase 4 privacy audit), but are exactly the kind of field an
  // LLM-heavy codebase adds later when logging a generation result. Cover them
  // proactively so a future `console.log({ answer, content })` cannot leak.
  const payload = {
    answer: 'FULL_ANSWER_CANARY',
    content: 'CONTENT_CANARY',
    text: 'TEXT_CANARY',
    output: 'OUTPUT_CANARY',
    aiResponse: 'AI_RESPONSE_CANARY',
    fullAnswer: 'FULL_ANSWER_FIELD_CANARY',
    // Unrelated keys with "content"/"text" as a SUBSTRING must NOT be swept —
    // only exact `content`/`text`/`output` and the listed suffix patterns.
    contentType: 'application/json',
    textColor: '#000000',
    modelId: 'gemini-3.1-flash',
  };

  const out = redactForLog([payload]);
  for (const canary of [
    'FULL_ANSWER_CANARY', 'CONTENT_CANARY', 'TEXT_CANARY', 'OUTPUT_CANARY',
    'AI_RESPONSE_CANARY', 'FULL_ANSWER_FIELD_CANARY',
  ]) {
    assert.ok(!out.includes(canary), `canary ${canary} should not leak — got: ${out}`);
  }
  // Non-content keys survive untouched.
  assert.ok(out.includes('application/json'), 'contentType value must not be swept (not an exact "content" key)');
  assert.ok(out.includes('#000000'), 'textColor value must not be swept (not an exact "text" key)');
  assert.ok(out.includes('gemini-3.1-flash'), 'modelId is a safe marker field');
});

test('redactForLog handles Error objects, arrays, and cyclic references', async () => {
  const { redactForLog } = await loadRedactor();

  const err = new Error('failure with token sk-XXXXXXXXXXXXXXXXXXXXX inside message');
  const out = redactForLog([err]);
  assert.ok(out.includes('[REDACTED]'));
  assert.ok(!out.includes('sk-XXXXXXXXXXXXXXXXXXXXX'));

  const cyclic = { name: 'meta' };
  cyclic.self = cyclic;
  const cyclicOut = redactForLog([cyclic]);
  assert.ok(cyclicOut.includes('[Circular]'));
});

test('main.ts global console wrapper uses redactArgsForLog', () => {
  const src = read('electron/main.ts');

  assert.match(src, /redactArgsForLog\(\[err\]\)/);
  assert.match(src, /redactArgsForLog\(\[reason\]\)/);
  assert.match(src, /console\.log\s*=\s*\(\.\.\.args:\s*any\[\]\)\s*=>\s*\{\s*logToFile\('\[LOG\] '\s*\+\s*redactArgsForLog\(args\)\);/);
  assert.match(src, /console\.warn\s*=\s*\(\.\.\.args:\s*any\[\]\)\s*=>\s*\{\s*logToFile\('\[WARN\] '\s*\+\s*redactArgsForLog\(args\)\);/);
  assert.match(src, /console\.error\s*=\s*\(\.\.\.args:\s*any\[\]\)\s*=>\s*\{\s*logToFile\('\[ERROR\] '\s*\+\s*redactArgsForLog\(args\)\);/);
});

test('redactForLog is registered as a real module loaded by main.ts', () => {
  const src = read('electron/main.ts');
  assert.match(src, /require\('\.\/utils\/redactForLog'\)\.redactForLog/);
});

test('redactForLog source defines the sensitive-key regex and value patterns', () => {
  const src = read('electron/utils/redactForLog.ts');

  assert.match(src, /SENSITIVE_KEY_RE\s*=\s*\/\(/);
  assert.match(src, /REMOVE_VALUE_KEY_RE\s*=\s*\/\(/);
  assert.match(src, /VALUE_PATTERNS/);
  assert.match(src, /export function redactForLog\(/);
  assert.match(src, /export function redactValue\(/);
});
