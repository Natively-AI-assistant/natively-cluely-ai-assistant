/**
 * Long non-streaming Natively answers get a deadline the server can meet (2026-11-12).
 *
 * natively-api lets a JSON DeepSeek answer run up to 30 s (DEEPSEEK_JSON_CAP_MS),
 * but chatWithGemini (the follow-up email) and generateMeetingSummary's Natively
 * rung used generateWithNatively's 8 s default. Live, 10-12 Nov: 180 requests in
 * 50 h were cancelled at 7.8-7.9 s while DeepSeek was still writing, paid for and
 * lost; a Natively-only user has nothing to fall back to.
 *
 * The deadline that actually reaches the request is checked by intercepting
 * generateWithNatively on a real LLMHelper. Platform-neutral.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const origLoad = Module._load;
Module._load = function patchedLoad(request) {
  if (request === 'electron') return { app: { getAppPath: () => '/tmp/fake-natively-app', getPath: () => '/tmp/fake-natively-app', isPackaged: false, isReady: () => false, on() {} }, ipcMain: { handle() {}, on() {} } };
  return origLoad.apply(this, arguments);
};
const mod = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/LLMHelper.js')).href);
const { NATIVELY_LONG_TEXT_TIMEOUT_MS } = mod;

test('the long-text deadline covers the server\'s JSON DeepSeek cap', () => {
  assert.equal(NATIVELY_LONG_TEXT_TIMEOUT_MS, 30_000);
});

test('chatWithGemini: both Natively calls carry the long-text deadline', () => {
  const src = readFileSync(path.resolve(__dirname, '../../LLMHelper.ts'), 'utf8');
  const calls = src.match(/this\.generateWithNatively\(cloudUserContent,[^\n]*/g) || [];
  assert.equal(calls.length, 2, 'the direct route and the provider list');
  for (const c of calls) assert.match(c, /\{ timeoutMs: NATIVELY_LONG_TEXT_TIMEOUT_MS \}/);
});

test('generateMeetingSummary: the Natively rung defaults to the long-text deadline; a caller\'s own still wins', async () => {
  const seen = [];
  const helper = Object.create(mod.LLMHelper.prototype);
  helper.hasNatively = () => true;
  helper.generateWithNatively = async (_u, _s, _i, opts) => { seen.push(opts?.timeoutMs); return 'summary text'; };
  helper.withTimeout = async (p, ms) => { seen.push(`outer:${ms}`); return p; };
  helper.processResponse = (t) => t;
  // Every rung ahead of Natively is absent on this bare instance.
  for (const k of ['customProvider', 'activeCurlProvider', 'antigravityClient']) helper[k] = null;
  helper.isLocalOnlyMode = false;
  let out;
  try { out = await helper.generateMeetingSummary('sys', 'ctx'); } catch (e) { out = `threw: ${e.message}`; }
  assert.equal(out, 'summary text', `reached the Natively rung (${out})`);
  assert.deepEqual(seen, [30_000, 'outer:35000']);
  seen.length = 0;
  await helper.generateMeetingSummary('sys', 'ctx', 'sys', { timeoutMs: 20_000 });
  assert.deepEqual(seen, [20_000, 'outer:25000']);
});
