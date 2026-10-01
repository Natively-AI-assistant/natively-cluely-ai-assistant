// Dev-only prompt recorder (electron/llm/promptDebug.ts, 2026-09-29).
//
// The recorder wraps globalThis.fetch so the exact request each provider
// received can be shown. These tests pin its safety properties: inert without
// NATIVELY_PROMPT_DEBUG=1, never records headers or URL query strings, blocked
// hosts are answered locally without a network call, and the wrapped request
// reaches the network byte-for-byte unchanged.
//
// Platform: pure Node — identical on macOS and Windows.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const modFile = path.resolve(process.cwd(), 'dist-electron/electron/llm/promptDebug.js');

async function freshImport() {
  // The build emits CommonJS, cached by path: drop the cache entry so each test
  // evaluates a new module (its install flag and block list are module state).
  delete require.cache[modFile];
  return require(modFile);
}

describe('prompt recorder', () => {
  test('inert unless NATIVELY_PROMPT_DEBUG=1', async () => {
    delete process.env.NATIVELY_PROMPT_DEBUG;
    const g = globalThis;
    const before = g.fetch;
    const m = await freshImport('off');
    assert.equal(m.isPromptDebugEnabled(), false);
    assert.equal(g.fetch, before, 'fetch was wrapped with the flag off');
  });

  test('records the body, never headers or the query string, and passes the request through unchanged', async () => {
    const calls = [];
    const g = globalThis;
    const original = g.fetch;
    g.fetch = async (input, init) => { calls.push({ input, init }); return new Response('data: {"ok":1}\n\n', { status: 200 }); };
    process.env.NATIVELY_PROMPT_DEBUG = '1';
    process.env.NATIVELY_PROMPT_DEBUG_FILE = path.join(process.env.TMPDIR || '/tmp', `pd-${Date.now()}.jsonl`);
    delete g.__nativelyPromptDebug;
    try {
      const m = await freshImport('on');
      m.installPromptDebug();
      const body = JSON.stringify({ model: 'deepseek-flash', temperature: 0.2, seed: 7, messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'Hello?' }] });
      const init = { method: 'POST', headers: { authorization: 'Bearer SECRET-KEY', 'x-goog-api-key': 'SECRET2' }, body };
      const res = await g.fetch('https://api.deepseek.com/chat/completions?key=SECRET3', init);
      assert.equal(await res.text(), 'data: {"ok":1}\n\n', 'the SDK must read the original body');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].init, init, 'init must reach the network unchanged');
      assert.equal(calls[0].input, 'https://api.deepseek.com/chat/completions?key=SECRET3');
      await new Promise((r) => setTimeout(r, 20));
      const st = m.getPromptDebugState();
      assert.equal(st.records.length, 1);
      const rec = st.records[0];
      assert.equal(rec.provider, 'deepseek');
      assert.equal(rec.system, 'SYS');
      assert.deepEqual(rec.messages, [{ role: 'user', text: 'Hello?' }]);
      assert.equal(rec.params.seed, 7);
      const serialized = JSON.stringify(st);
      assert.doesNotMatch(serialized, /SECRET/, 'a credential or query string was recorded');
      assert.equal(rec.path, '/chat/completions');
    } finally {
      g.fetch = original;
      delete process.env.NATIVELY_PROMPT_DEBUG;
      delete process.env.NATIVELY_PROMPT_DEBUG_FILE;
    }
  });

  test('a blocked host is captured and answered locally — nothing is sent', async () => {
    const calls = [];
    const g = globalThis;
    const original = g.fetch;
    g.fetch = async (input, init) => { calls.push(input); return new Response('{}', { status: 200 }); };
    process.env.NATIVELY_PROMPT_DEBUG = '1';
    process.env.NATIVELY_PROMPT_DEBUG_BLOCK_HOSTS = 'api.anthropic.com';
    process.env.NATIVELY_PROMPT_DEBUG_FILE = path.join(process.env.TMPDIR || '/tmp', `pd-${Date.now()}-b.jsonl`);
    delete g.__nativelyPromptDebug;
    try {
      const m = await freshImport('block');
      m.installPromptDebug();
      const res = await g.fetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: JSON.stringify({ model: 'claude-x', system: 'CLAUDE SYS', messages: [{ role: 'user', content: 'Q' }] }) });
      assert.equal(res.status, 401);
      assert.equal(calls.length, 0, 'a blocked request reached the network');
      const rec = m.getPromptDebugState().records[0];
      assert.equal(rec.blocked, true);
      assert.equal(rec.system, 'CLAUDE SYS');
    } finally {
      g.fetch = original;
      delete process.env.NATIVELY_PROMPT_DEBUG;
      delete process.env.NATIVELY_PROMPT_DEBUG_BLOCK_HOSTS;
      delete process.env.NATIVELY_PROMPT_DEBUG_FILE;
    }
  });

  test('non-LLM traffic (GET, non-JSON, embeddings) passes through unrecorded', async () => {
    const g = globalThis;
    const original = g.fetch;
    g.fetch = async () => new Response('{}', { status: 200 });
    process.env.NATIVELY_PROMPT_DEBUG = '1';
    process.env.NATIVELY_PROMPT_DEBUG_FILE = path.join(process.env.TMPDIR || '/tmp', `pd-${Date.now()}-c.jsonl`);
    delete g.__nativelyPromptDebug;
    try {
      const m = await freshImport('pass');
      m.installPromptDebug();
      await g.fetch('https://example.com/health');
      await g.fetch('https://api.voyageai.com/v1/embeddings', { method: 'POST', body: JSON.stringify({ input: ['x'], model: 'voyage' }) });
      await g.fetch('https://example.com/upload', { method: 'POST', body: 'not json' });
      assert.equal(m.getPromptDebugState().records.length, 0);
    } finally {
      g.fetch = original;
      delete process.env.NATIVELY_PROMPT_DEBUG;
      delete process.env.NATIVELY_PROMPT_DEBUG_FILE;
    }
  });
});
