// The judge client with two AgentRouter keys: a key that reports its quota spent hands over to the other one, and
// new calls stop only when both have said so. Offline: a copy of client.mjs in a temp directory (so the real
// probe-result.json and the real env file are never read), made-up keys, and a stubbed fetch.
//   node --test astra/client-keys.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KEY_A = 'made-up-key-AAAA-1111';
const KEY_B = 'made-up-key-BBBB-2222';
const QUOTA_403 = { status: 403, body: { error: { message: 'user quota is not enough (request id: x)', code: 'insufficient_user_quota' } } };
const POOL_402 = { status: 402, body: { error: { message: 'Budget pool quota has been exhausted. Please ask an administrator to increase the limit or select another budget pool.' } } };
const OK_200 = { status: 200, body: { id: 'r1', model: 'gpt-6-astra', choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { total_tokens: 3 } } };

// The line queue3.mjs watches for to stop starting new steps, taken from its source so the two cannot drift.
const queueSource = fs.readFileSync(path.join(HERE, 'queue3.mjs'), 'utf8');
const stopLiteral = queueSource.match(/if \(\/(.+?)\/\.test\(s\)\) rationed = true/);
assert.ok(stopLiteral, 'queue3.mjs still stops on a regex over the step output');
const QUEUE_STOP = new RegExp(stopLiteral[1]);

let seq = 0;
/** A fresh client (its own module state) over the given keys, probe record and per-key answers. */
async function client({ keys = { AGENTROUTER_API_KEY: KEY_A, AGENTROUTER_API_KEY_1: KEY_B }, probeKeyVar = 'AGENTROUTER_API_KEY', answer }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aq-client-keys-'));
  fs.copyFileSync(path.join(HERE, 'client.mjs'), path.join(dir, 'client.mjs'));
  fs.writeFileSync(path.join(dir, 'probe-result.json'), JSON.stringify({ ok: true, model_listed: true, requested_model: 'gpt-6-astra', key_var: probeKeyVar, unsupported_params: [], token_param: 'max_tokens' }));
  const envFile = path.join(dir, 'env');
  fs.writeFileSync(envFile, Object.entries(keys).map(([k, v]) => `${k}=${v}`).join('\n') + '\nOTHER=1\n');
  process.env.NATIVELY_ENV_FILE = envFile;
  const calls = [];
  const lines = [];
  const realFetch = globalThis.fetch; const realError = console.error;
  globalThis.fetch = async (url, init) => {
    const which = init.headers.Authorization === `Bearer ${KEY_A}` ? 'A' : init.headers.Authorization === `Bearer ${KEY_B}` ? 'B' : '?';
    calls.push(which);
    const a = await answer(which, calls.length);
    return { status: a.status, text: async () => (typeof a.body === 'string' ? a.body : JSON.stringify(a.body)), headers: { get: () => null } };
  };
  console.error = (...x) => { lines.push(x.join(' ')); };
  const m = await import(`${pathToFileURL(path.join(dir, 'client.mjs')).href}?case=${++seq}`);
  const restore = () => { globalThis.fetch = realFetch; console.error = realError; delete process.env.NATIVELY_ENV_FILE; fs.rmSync(dir, { recursive: true, force: true }); };
  return { m, calls, lines, restore };
}
const MSG = [{ role: 'user', content: 'x' }];

test('a key out of account quota hands the same call to the second key', async () => {
  const c = await client({ answer: (k) => (k === 'A' ? QUOTA_403 : OK_200) });
  try {
    const r = await c.m.chat(MSG);
    assert.equal(r.ok, true);
    assert.equal(r.key_var, 'AGENTROUTER_API_KEY_1');
    assert.equal(r.attempts, 1, 'the hand-over is not counted as a retry');
    assert.deepEqual(c.calls, ['A', 'B']);
    assert.equal(c.m.RATIONED, null);
    assert.equal(c.m.activeKeyVar(), 'AGENTROUTER_API_KEY_1');
    const again = await c.m.chat(MSG);
    assert.equal(again.ok, true);
    assert.deepEqual(c.calls, ['A', 'B', 'B'], 'later calls go straight to the key that answers');
    assert.equal(c.lines.length, 1);
    assert.match(c.lines[0], /AGENTROUTER_API_KEY is out of quota — continuing on AGENTROUTER_API_KEY_1/);
    assert.equal(QUEUE_STOP.test(c.lines[0]), false, 'a hand-over must not stop the queue');
  } finally { c.restore(); }
});

test('both keys spent: new calls stop, and the queue sees its stop line', async () => {
  const c = await client({ answer: (k) => (k === 'A' ? QUOTA_403 : POOL_402) });
  try {
    const r = await c.m.chat(MSG);
    assert.equal(r.ok, false);
    assert.deepEqual(c.calls, ['A', 'B']);
    assert.ok(c.m.RATIONED);
    assert.ok(c.lines.some((l) => QUEUE_STOP.test(l)), 'the last line matches what queue3.mjs stops on');
    const after = await c.m.chat(MSG);
    assert.equal(after.rationed, true);
    assert.equal(c.calls.length, 2, 'no request is sent once both keys are spent');
  } finally { c.restore(); }
});

test('starts on the key the probe answered on, and falls back to the first key from there', async () => {
  const c = await client({ probeKeyVar: 'AGENTROUTER_API_KEY_1', answer: (k) => (k === 'B' ? POOL_402 : OK_200) });
  try {
    assert.equal(c.m.activeKeyVar(), 'AGENTROUTER_API_KEY_1');
    const r = await c.m.chat(MSG);
    assert.equal(r.ok, true);
    assert.equal(r.key_var, 'AGENTROUTER_API_KEY');
    assert.deepEqual(c.calls, ['B', 'A']);
  } finally { c.restore(); }
  const d = await client({ probeKeyVar: 'AGENTROUTER_API_KEY_1', answer: (k) => (k === 'B' ? POOL_402 : QUOTA_403) });
  try {
    const r = await d.m.chat(MSG);
    assert.equal(r.ok, false);
    assert.deepEqual(d.calls, ['B', 'A']);
    assert.match(d.m.RATIONED, /account quota exhausted/);
    assert.ok(d.lines.some((l) => QUEUE_STOP.test(l)));
  } finally { d.restore(); }
});

test('eight calls in flight while the first key dies all land on the second', async () => {
  const c = await client({ answer: async (k) => { await new Promise((r) => setTimeout(r, k === 'A' ? 20 : 5)); return k === 'A' ? QUOTA_403 : OK_200; } });
  try {
    const out = await Promise.all(Array.from({ length: 8 }, () => c.m.chat(MSG)));
    assert.equal(out.filter((r) => r.ok && r.key_var === 'AGENTROUTER_API_KEY_1').length, 8);
    assert.equal(c.m.RATIONED, null);
    assert.equal(c.calls.filter((k) => k === 'A').length, 8);
    assert.equal(c.calls.filter((k) => k === 'B').length, 8);
    assert.equal(c.lines.length, 1, 'the hand-over is announced once');
  } finally { c.restore(); }
});

test('neither key can leave the module in an error text or a log line', async () => {
  const c = await client({ answer: () => ({ status: 400, body: `rejected ${KEY_A} and ${KEY_B}; Authorization: Bearer ${KEY_B}` }) });
  try {
    const r = await c.m.chat(MSG);
    assert.equal(r.ok, false);
    assert.equal(r.error.includes(KEY_A) || r.error.includes(KEY_B), false);
    assert.equal(c.m.scrub(`x ${KEY_A} y ${KEY_B}`).includes('made-up-key'), false);
    assert.equal(JSON.stringify(c.m.keyVars()).includes('made-up-key'), false);
  } finally { c.restore(); }
  const d = await client({ answer: (k) => (k === 'A' ? QUOTA_403 : POOL_402) });
  try {
    await d.m.chat(MSG);
    assert.equal(d.lines.some((l) => l.includes(KEY_A) || l.includes(KEY_B)), false);
  } finally { d.restore(); }
});

test('one key in the env file: as before, the first refusal stops new calls', async () => {
  const c = await client({ keys: { AGENTROUTER_API_KEY: KEY_A }, answer: () => QUOTA_403 });
  try {
    assert.deepEqual(c.m.keyVars(), ['AGENTROUTER_API_KEY']);
    const r = await c.m.chat(MSG);
    assert.equal(r.ok, false);
    assert.deepEqual(c.calls, ['A']);
    assert.match(c.m.RATIONED, /account quota exhausted/);
  } finally { c.restore(); }
  // The same value under both names is one key, not two.
  const d = await client({ keys: { AGENTROUTER_API_KEY: KEY_A, AGENTROUTER_API_KEY_1: KEY_A }, answer: () => POOL_402 });
  try {
    assert.deepEqual(d.m.keyVars(), ['AGENTROUTER_API_KEY']);
    await d.m.chat(MSG);
    assert.deepEqual(d.calls, ['A']);
    assert.match(d.m.RATIONED, /402 ration exhausted/);
  } finally { d.restore(); }
});
