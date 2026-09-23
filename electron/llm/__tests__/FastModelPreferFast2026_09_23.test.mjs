// The two remaining consumers of the fast model.
//
// `preferFast` was vestigial — the source literally said "retained for API
// compatibility; ordering no longer depends on it" over a `void opts`. It now
// means what its name says, and a source assertion keeps it that way.
//
// `generateQueryRewrite` already hand-rolled this exact shape, so moving it onto
// the seam deletes a duplicate rather than adding a layer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);
const { LLMHelper } = require(path.resolve(root, 'dist-electron/electron/LLMHelper.js'));

const helper = () => {
  const h = Object.create(LLMHelper.prototype);
  Object.assign(h, {
    _client: null, _openaiClient: null, _claudeClient: null, _groqClient: null, _deepseekClient: null,
    isLocalOnlyMode: false, nativelyKey: null,
    getDisabledProviderFamilies: () => [], assertOutboundScopes: () => {}, rateLimiters: {},
  });
  return h;
};

test('preferFast:true consults the fast model before building the ladder', async () => {
  const h = helper();
  h.callFastModel = async () => '{"fast":true}';
  assert.equal(await h.generateContentStructured('x', { preferFast: true }), '{"fast":true}');
});

// NOTE: this is a GUARD, not a red-green test — it passes before the change too,
// because nothing consulted the fast model then either. It exists to stop a
// later edit widening the fast path to every structured call.
test('preferFast is NOT consulted without the flag — the ladder owns normal calls', async () => {
  let fastCalled = false;
  const h = helper();
  h.callFastModel = async () => { fastCalled = true; return '{"fast":true}'; };
  try { await h.generateContentStructured('x'); } catch { /* no providers configured */ }
  assert.equal(fastCalled, false);
});

test('preferFast is load-bearing in source, so it cannot go vestigial again', () => {
  const src = fs.readFileSync(path.join(root, 'electron/LLMHelper.ts'), 'utf8');
  const i = src.indexOf('public async generateContentStructured');
  const body = src.slice(i, i + 3000);
  assert.match(body, /opts\?\.preferFast[\s\S]{0,200}callFastModel/,
    'preferFast must reach callFastModel — it was previously a no-op behind `void opts`');
  assert.doesNotMatch(body, /void opts;/, 'the vestigial marker must be gone');
});

test('generateQueryRewrite uses the seam and falls back to its own chain', async () => {
  const h = helper();
  h.callFastModel = async () => 'rewritten';
  assert.equal(await h.generateQueryRewrite('q'), 'rewritten');

  const h2 = helper();
  h2.callFastModel = async () => null;
  assert.equal(await h2.generateQueryRewrite('q'), '', 'no fast model and no chain → empty, never a throw');
});
