// electron/llm/__tests__/MeetingSummaryDeadGeminiKey2026_11_15.test.mjs
//
// With a Gemini key the API rejects (invalid, expired, billing), generateMeetingSummary
// retried it on every rung: Flash-Lite x3, Flash x3, Pro x5 = 11 requests per call,
// with 1+2+1+2+2+4+8+16+32 s of backoff. A fresh database seeds ~112 note sections and
// the section-prompt compiler makes one summary call per section, so a dead key cost
// ~1,200 rejected requests on first launch (2026-11-15, Windows dev profile).
//
// The sibling of MeetingSummaryNoGeminiClient2026_09_23 (no client at all): here the
// client exists and every Gemini call fails with a permanent key error. One request,
// then the ladder leaves Gemini.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const cjs = createRequire(path.join(root, 'package.json'));

// Same electron stub as MeetingSummaryNoGeminiClient2026_09_23.test.mjs.
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'summary-dead-gemini-test-'));
const electronStub = new Module('electron');
electronStub.exports = {
  app: {
    isReady: () => true,
    getPath: (n) => (n === 'userData' ? tmpUserData : os.tmpdir()),
    getAppPath: () => root,
    getName: () => 'natively-test',
    getVersion: () => '0.0.0-test',
    isPackaged: false,
    on: () => {},
  },
  shell: { openPath: async () => '' },
  safeStorage: { isEncryptionAvailable: () => false },
  ipcMain: { on: () => {}, handle: () => {}, removeAllListeners: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
  desktopCapturer: { getSources: async () => [] },
  net: { isOnline: () => true },
};
electronStub.loaded = true;
cjs.cache[cjs.resolve('electron')] = electronStub;

const { LLMHelper } = cjs(path.join(root, 'dist-electron/electron/LLMHelper.js'));

const DEAD_KEY = '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}';

test('a rejected Gemini key: one Gemini request, then the summary ladder moves on', async () => {
  const h = new LLMHelper(undefined, false);
  let geminiCalls = 0;
  const reject = async () => { geminiCalls++; throw new Error(DEAD_KEY); };
  h.client = { models: { generateContent: reject } };
  h.generateContent = reject;   // Flash-Lite rung
  h.generateWithFlash = reject; // Flash rung

  const origWarn = console.warn;
  console.warn = () => {};
  const started = Date.now();
  try {
    await assert.rejects(
      h.generateMeetingSummary('Summarise.', 'Alice: we ship Friday.'),
      /Failed to generate summary after all fallback attempts/,
    );
  } finally {
    console.warn = origWarn;
  }
  const elapsed = Date.now() - started;

  assert.equal(geminiCalls, 1, 'a dead key is asked once, not on every rung and retry');
  // The old ladder slept 1+2 (Flash-Lite) + 1+2 (Flash) + 2+4+8+16+32 (Pro) seconds.
  assert.ok(elapsed < 2000, `a dead key should fail fast, took ${elapsed}ms`);
});

test('a transient Gemini error (429) still walks the retries', async () => {
  const h = new LLMHelper(undefined, false);
  let geminiCalls = 0;
  const busy = async () => { geminiCalls++; throw new Error('429 RESOURCE_EXHAUSTED: rate limit'); };
  h.client = { models: { generateContent: busy } };
  h.generateContent = busy;
  // Stop after Flash-Lite's 3 tries: Flash succeeds, so the test does not sleep through Pro.
  h.generateWithFlash = async () => { geminiCalls++; return 'Summary.'; };
  h.processResponse = (t) => t;

  const origWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await h.generateMeetingSummary('Summarise.', 'Alice: we ship Friday.'), 'Summary.');
  } finally {
    console.warn = origWarn;
  }
  assert.equal(geminiCalls, 4, 'Flash-Lite retried 3 times on a rate limit, then Flash answered');
});
