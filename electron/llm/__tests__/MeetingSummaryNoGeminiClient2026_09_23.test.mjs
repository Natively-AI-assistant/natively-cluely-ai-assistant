// electron/llm/__tests__/MeetingSummaryNoGeminiClient2026_09_23.test.mjs
//
// Issue #588: with no Gemini key, generateMeetingSummary still ran the
// Flash-Lite and Flash retry loops. Both helpers throw "Gemini client not
// initialized" on entry, so each call logged six failures and slept 1s+2s
// twice before reaching the Gemini Pro rung, which already skipped itself.
// On a cold start the section-prompt compiler makes that call once per
// seeded note section.
//
// This drives the real ladder on a helper with no provider configured and
// asserts it fails fast, without attempting either Gemini rung.

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

// LLMHelper constructs ModelVersionManager, which reads app.getPath('userData');
// there is no `app` under ELECTRON_RUN_AS_NODE. Same stub as
// LiveDeadlineRouteTable2026_09_06.test.mjs.
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'summary-no-gemini-test-'));
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

test('no Gemini client: the summary ladder skips Flash-Lite and Flash instead of retrying them', async () => {
  const h = new LLMHelper(undefined, false);
  assert.equal(h.client ?? null, null, 'precondition: no Gemini client');

  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };
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

  const geminiAttempts = warnings.filter(w => /Gemini (Flash-Lite|Flash) attempt/.test(w));
  assert.deepEqual(geminiAttempts, [], 'no Flash-Lite / Flash attempt should be made without a client');
  // The old loops slept 1s + 2s per rung (6s total) before giving up.
  assert.ok(elapsed < 2000, `ladder should fail fast without a client, took ${elapsed}ms`);
});
