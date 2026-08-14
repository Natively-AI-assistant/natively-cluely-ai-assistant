// electron/services/__tests__/BrowserMetadataClassifier.test.mjs
//
// Tests the desktop AI metadata classifier + the hard policy engine. Imports the
// compiled modules from dist-electron/ (built by build:electron). These modules
// only import node:crypto, so no electron stub is needed.
//
// Run: npm run test:services
//   (build:electron compiles electron/**/*.ts → dist-electron/)

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../');
const svcPath = path.resolve(repoRoot, 'dist-electron/electron/services/browser-context/BrowserMetadataClassifierService.js');
const policyPath = path.resolve(repoRoot, 'dist-electron/electron/services/browser-context/policy.js');

let BrowserMetadataClassifierService, NO_PROVIDER_RESULT, decideFinalPolicy, CODING_AUTO_MIN_CONFIDENCE;

before(async () => {
  const svc = await import(pathToFileURL(svcPath).href);
  BrowserMetadataClassifierService = svc.BrowserMetadataClassifierService;
  NO_PROVIDER_RESULT = svc.NO_PROVIDER_RESULT;
  const pol = await import(pathToFileURL(policyPath).href);
  decideFinalPolicy = pol.decideFinalPolicy;
  CODING_AUTO_MIN_CONFIDENCE = pol.CODING_AUTO_MIN_CONFIDENCE;
});

const META = (over = {}) => ({
  host: 'assess.acme-corp.com',
  sanitizedUrl: 'https://assess.acme-corp.com/challenge/42',
  pathTokens: ['challenge', '42'],
  titleTokens: ['coding', 'challenge'],
  hasCodeEditorSignal: true,
  ...over,
});

// A fake LLM returning a fixed string; records the prompt it was given.
function fakeLLM(response) {
  const calls = [];
  return {
    calls,
    generateContentStructured: async (message) => {
      calls.push(message);
      return typeof response === 'function' ? response(message) : response;
    },
  };
}

describe('policy engine — hard overrides', () => {
  test('local sensitive flag forces blocked even if AI says coding', () => {
    const d = decideFinalPolicy({
      classification: { category: 'coding_problem', confidenceScore: 0.99, autoPolicyRecommendation: 'auto', reason: 'x' },
      localSensitive: true,
    });
    assert.equal(d.autoPolicy, 'blocked');
  });

  test('AI says Gmail is coding_problem → blocked (sensitive category override)', () => {
    const d = decideFinalPolicy({
      classification: { category: 'coding_problem', confidenceScore: 0.99, autoPolicyRecommendation: 'auto', reason: 'x' },
      localCategory: 'email',
    });
    assert.equal(d.autoPolicy, 'blocked');
    assert.equal(d.category, 'email');
  });

  test('AI category email is always blocked', () => {
    const d = decideFinalPolicy({
      classification: { category: 'email', confidenceScore: 0.2, autoPolicyRecommendation: 'auto', reason: 'x' },
    });
    assert.equal(d.autoPolicy, 'blocked');
    assert.equal(d.sensitivity, 'critical');
  });

  test('coding_problem auto only at >= 0.9 confidence', () => {
    const hi = decideFinalPolicy({ classification: { category: 'coding_problem', confidenceScore: 0.95, autoPolicyRecommendation: 'auto', reason: '' } });
    assert.equal(hi.autoPolicy, 'auto');
    const lo = decideFinalPolicy({ classification: { category: 'coding_problem', confidenceScore: 0.7, autoPolicyRecommendation: 'auto', reason: '' } });
    assert.equal(lo.autoPolicy, 'ask');
  });

  test('coding_editor → auto_if_high_confidence below threshold', () => {
    const d = decideFinalPolicy({ classification: { category: 'coding_editor', confidenceScore: 0.6, autoPolicyRecommendation: 'auto', reason: '' } });
    assert.equal(d.autoPolicy, 'auto_if_high_confidence');
  });

  test('developer_docs → ask; google_docs → manual; unknown → manual', () => {
    assert.equal(decideFinalPolicy({ classification: { category: 'developer_docs', confidenceScore: 0.8, autoPolicyRecommendation: 'auto', reason: '' } }).autoPolicy, 'ask');
    assert.equal(decideFinalPolicy({ classification: { category: 'google_docs_visible', confidenceScore: 0.8, autoPolicyRecommendation: 'auto', reason: '' } }).autoPolicy, 'manual');
    assert.equal(decideFinalPolicy({ classification: { category: 'unknown', confidenceScore: 0, autoPolicyRecommendation: 'auto', reason: '' } }).autoPolicy, 'manual');
  });

  test('CODING_AUTO_MIN_CONFIDENCE is 0.9', () => {
    assert.equal(CODING_AUTO_MIN_CONFIDENCE, 0.9);
  });
});

describe('classifier — provider fallback + parsing', () => {
  test('no LLM → NO_PROVIDER_RESULT (unknown/manual)', async () => {
    const svc = new BrowserMetadataClassifierService(null);
    const r = await svc.classify(META());
    assert.deepEqual(r, NO_PROVIDER_RESULT);
    assert.equal(r.category, 'unknown');
    assert.equal(r.autoPolicyRecommendation, 'manual');
  });

  test('uses generateContentStructured (the existing provider stack)', async () => {
    const llm = fakeLLM('{"category":"coding_problem","confidenceScore":0.95,"autoPolicyRecommendation":"auto","reason":"problem url"}');
    const svc = new BrowserMetadataClassifierService(llm);
    const r = await svc.classify(META());
    assert.equal(llm.calls.length, 1);
    assert.equal(r.category, 'coding_problem');
    assert.equal(r.confidenceScore, 0.95);
  });

  test('parses fenced JSON with trailing prose', async () => {
    const llm = fakeLLM('```json\n{"category":"coding_editor","confidenceScore":0.7,"autoPolicyRecommendation":"auto_if_high_confidence","reason":"editor"}\n```\nHope that helps!');
    const svc = new BrowserMetadataClassifierService(llm);
    const r = await svc.classify(META());
    assert.equal(r.category, 'coding_editor');
  });

  test('unparseable output → conservative fallback', async () => {
    const llm = fakeLLM('I cannot classify this page.');
    const svc = new BrowserMetadataClassifierService(llm);
    const r = await svc.classify(META());
    assert.equal(r.category, 'unknown');
    assert.equal(r.autoPolicyRecommendation, 'manual');
  });

  test('invalid category in JSON → fallback', async () => {
    const llm = fakeLLM('{"category":"rm -rf","confidenceScore":1,"autoPolicyRecommendation":"auto","reason":"x"}');
    const svc = new BrowserMetadataClassifierService(llm);
    const r = await svc.classify(META());
    assert.equal(r.category, 'unknown');
  });

  test('LLM throw (provider chain exhausted) → fallback, not a crash', async () => {
    const svc = new BrowserMetadataClassifierService({
      generateContentStructured: async () => { throw new Error('All reasoning models failed'); },
    });
    const r = await svc.classify(META());
    assert.equal(r.category, 'unknown');
    assert.equal(r.autoPolicyRecommendation, 'manual');
  });

  test('confidence is clamped to 0..1', async () => {
    const llm = fakeLLM('{"category":"coding_problem","confidenceScore":7,"autoPolicyRecommendation":"auto","reason":"x"}');
    const svc = new BrowserMetadataClassifierService(llm);
    const r = await svc.classify(META());
    assert.equal(r.confidenceScore, 1);
  });

  test('prompt sends a SANITIZED url (host+path) but never a raw query string or secret', async () => {
    const llm = fakeLLM('{"category":"unknown","confidenceScore":0,"autoPolicyRecommendation":"manual","reason":"x"}');
    const svc = new BrowserMetadataClassifierService(llm);
    // Upstream forgot to sanitize and passed a raw URL with a session token +
    // email in the path — the desktop re-sanitizer must still scrub it.
    await svc.classify(
      META({ sanitizedUrl: 'https://assess.acme-corp.com/challenge/42?session=SECRET123&email=me@x.com' }),
    );
    const prompt = llm.calls[0];
    // Host + descriptive path ARE present (so the model can recognize the site)...
    assert.ok(prompt.includes('assess.acme-corp.com'), 'host should reach the prompt for recognition');
    assert.ok(prompt.includes('/challenge'), 'descriptive path should reach the prompt');
    // ...but the query string and its secrets are gone.
    assert.ok(!prompt.includes('SECRET123'), 'session token must never reach the prompt');
    assert.ok(!prompt.includes('me@x.com'), 'email must never reach the prompt');
    assert.ok(!prompt.includes('session='), 'raw query string must be stripped');
    assert.ok(prompt.includes('SafeWebsiteMetadata'), 'prompt should declare metadata-only input');
  });

  test('desktop re-sanitizer strips a raw query string even if extension sent one', async () => {
    const llm = fakeLLM('{"category":"unknown","confidenceScore":0,"autoPolicyRecommendation":"manual","reason":"x"}');
    const svc = new BrowserMetadataClassifierService(llm);
    await svc.classify(META({ sanitizedUrl: 'https://x.com/p/550e8400-e29b-41d4-a716-446655440000?t=AbCdEf0123456789xyz' }));
    const prompt = llm.calls[0];
    assert.ok(!prompt.includes('446655440000'), 'UUID path segment should be redacted');
    assert.ok(!prompt.includes('AbCdEf0123456789xyz'), 'query token must be stripped');
  });
});

describe('classifier — caching', () => {
  test('second classify of same metadata is served from cache (one LLM call)', async () => {
    const llm = fakeLLM('{"category":"coding_problem","confidenceScore":0.95,"autoPolicyRecommendation":"auto","reason":"x"}');
    const svc = new BrowserMetadataClassifierService(llm);
    await svc.classify(META());
    await svc.classify(META());
    assert.equal(llm.calls.length, 1, 'expected cache hit on second call');
  });

  test('failed result has a short TTL (re-queries after 1h)', async () => {
    let t = 1_000_000;
    const llm = fakeLLM('not json'); // → failed fallback
    const svc = new BrowserMetadataClassifierService(llm, { now: () => t });
    await svc.classify(META());
    t += 61 * 60 * 1000; // 61 minutes later
    await svc.classify(META());
    assert.equal(llm.calls.length, 2, 'failed result should expire after ~1h');
  });
});

describe('classifyAndDecide — end to end', () => {
  test('unknown coding-like page with AI high confidence → auto via policy', async () => {
    const llm = fakeLLM('{"category":"coding_problem","confidenceScore":0.95,"autoPolicyRecommendation":"auto","reason":"x"}');
    const svc = new BrowserMetadataClassifierService(llm);
    const { decision } = await svc.classifyAndDecide(META());
    assert.equal(decision.autoPolicy, 'auto');
    assert.equal(decision.category, 'coding_problem');
  });

  test('localSensitive overrides even a confident coding AI verdict', async () => {
    const llm = fakeLLM('{"category":"coding_problem","confidenceScore":0.99,"autoPolicyRecommendation":"auto","reason":"x"}');
    const svc = new BrowserMetadataClassifierService(llm);
    const { decision } = await svc.classifyAndDecide(META(), true);
    assert.equal(decision.autoPolicy, 'blocked');
  });
});
