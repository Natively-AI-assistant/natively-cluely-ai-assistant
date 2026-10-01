// electron/llm/__tests__/OllamaVisionChainProbeBudget2026_09_22.test.mjs
//
// PR #590 (#571) made the vision chain AWAIT the Ollama vision-model probe, so
// the first screenshot finds an installed vision model instead of dead-ending.
// The probe runs before ANY provider is seated — cloud included — and was
// unbounded. Reproduced against a daemon that accepts and never answers:
//
//   screenshot 1: probe returned null after 5005ms
//   screenshot 2: probe returned null after 5001ms
//
// resolveOllamaVisionModelForChain caps the wait and remembers an empty result.
// These tests drive the REAL prototype methods against real HTTP servers.

import assert from 'node:assert/strict';
import { test, describe, after } from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { LLMHelper } = await import('../../../dist-electron/electron/LLMHelper.js');

const servers = [];
async function serve(handler) {
  const srv = http.createServer(handler);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  servers.push(srv);
  return `http://127.0.0.1:${srv.address().port}`;
}
after(() => { for (const s of servers) { s.closeAllConnections(); s.close(); } });

// Bare host — the constructor reaches for keychain and provider SDKs.
function host(ollamaUrl, overrides = {}) {
  const h = Object.create(LLMHelper.prototype);
  return Object.assign(h, {
    useOllama: true, ollamaVisionModel: null, ollamaModel: 'llama3.2', ollamaUrl,
    ollamaVisionCache: new Map(), ollamaVisionRefreshInFlight: null, ollamaVisionNegativeUntil: 0,
    ...overrides,
  });
}

describe('the vision chain never waits the full probe on a hung Ollama daemon', () => {
  test('first screenshot gives up well before the 5s fetch timeout', async () => {
    const url = await serve(() => { /* accept, never answer */ });
    const h = host(url);
    const t = Date.now();
    const model = await h.resolveOllamaVisionModelForChain();
    const ms = Date.now() - t;
    assert.equal(model, null);
    assert.ok(ms < 2500, `waited ${ms}ms — the chain must not inherit the 5s probe`);
  });

  test('an empty result is remembered — the next screenshot does not re-probe', async () => {
    let hits = 0;
    const url = await serve((req, res) => { hits++; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ models: [{ name: 'llama3.2' }] })); });
    const h = host(url);
    assert.equal(await h.resolveOllamaVisionModelForChain(), null, 'text-only install → no vision model');
    const firstHits = hits;
    assert.ok(firstHits > 0, 'the first screenshot must actually probe');
    const t = Date.now();
    assert.equal(await h.resolveOllamaVisionModelForChain(), null);
    assert.equal(hits, firstHits, 'second screenshot inside the TTL must not hit the daemon');
    assert.ok(Date.now() - t < 50);
  });
});

describe('#571 still holds: a cold first screenshot finds the installed vision model', () => {
  test('healthy daemon with a vision model → returned on the FIRST call', async () => {
    const url = await serve((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'llama3.2' }, { name: 'qwen3-vl:8b' }] }));
        const { name } = JSON.parse(body || '{}');
        res.end(JSON.stringify({ capabilities: name === 'qwen3-vl:8b' ? ['completion', 'vision'] : ['completion'] }));
      });
    });
    const h = host(url);
    assert.equal(await h.resolveOllamaVisionModelForChain(), 'qwen3-vl:8b');
  });

  test('a cached vision model short-circuits with no probe at all', async () => {
    const h = host('http://127.0.0.1:1', { ollamaVisionModel: 'llava:13b' });
    assert.equal(await h.resolveOllamaVisionModelForChain(), 'llava:13b');
  });

  test('Ollama not selected → null, no probe', async () => {
    const h = host('http://127.0.0.1:1', { useOllama: false });
    assert.equal(await h.resolveOllamaVisionModelForChain(), null);
  });

  test('a probe that outlives the budget still fills the cache for the next screenshot', async () => {
    const url = await serve((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'llava:13b' }] }));
        res.end(JSON.stringify({ capabilities: ['completion', 'vision'] }));
      }, 1200)); // two round-trips ≈ 2.4s > 1.5s budget
    });
    const h = host(url, { ollamaModel: 'llava:13b' });
    assert.equal(await h.resolveOllamaVisionModelForChain(), null, 'budget spent → chain proceeds without Ollama');
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(h.ollamaVisionModel, 'llava:13b', 'background probe completed and cached the model');
    assert.equal(await h.resolveOllamaVisionModelForChain(), 'llava:13b', 'cached model beats the negative memo');
  });
});

test('streamVisionWithFallback seats Ollama through the bounded resolver, not the raw probe', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../LLMHelper.ts'), 'utf8');
  const start = src.indexOf('private async *streamVisionWithFallback(');
  const end = src.indexOf('// ── Assemble the ordered chain', start);
  assert.ok(start > 0 && end > start, 'vision chain region not found');
  const region = src.slice(start, end);
  assert.match(region, /await this\.resolveOllamaVisionModelForChain\(\)/);
  assert.doesNotMatch(region, /await this\.refreshOllamaVisionModel\(\)/);
});
