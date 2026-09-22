import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('trial IPC handlers do not return raw trial tokens to the renderer', () => {
  const source = read('electron/ipcHandlers.ts');
  const startStart = source.search(/safeHandle\(['"]trial:start['"]/);
  const statusStart = source.search(/safeHandle\(['"]trial:status['"]/, startStart);
  const startHandler = source.slice(startStart, statusStart);
  const localStart = source.search(/safeHandle\(['"]trial:get-local['"]/);
  const convertStart = source.search(/safeHandle\(['"]trial:convert['"]/, localStart);
  const localHandler = source.slice(localStart, convertStart);

  assert.ok(startStart >= 0, 'trial:start handler should exist');
  assert.ok(localStart >= 0, 'trial:get-local handler should exist');
  // The property under test is that the RAW TOKEN never reaches the renderer —
  // not the exact punctuation of the return statement. The previous assertion
  // pinned the literal `return { ok: true, ...safeData, hasToken: ... }` and so
  // failed the moment a safe boolean (`persisted`) was appended, which is a
  // change that cannot leak anything. Asserting the property keeps the guard
  // strict against the leak while allowing additive non-secret fields.
  assert.match(startHandler, /const \{ trial_token, \.\.\.safeData \} = data/,
    'the token must be destructured OUT of the returned object');
  assert.match(startHandler, /return \{ ok: true, \.\.\.safeData,[^}]*hasToken: Boolean\(data\.trial_token\)/,
    'the handler must return safeData plus a boolean presence flag');
  assert.doesNotMatch(startHandler, /return \{ ok: true, \.\.\.data \}/,
    'spreading the raw response would republish the token');
  // Belt and braces: no return statement in this handler may name the token.
  for (const line of startHandler.split('\n')) {
    if (/^\s*return\b/.test(line)) {
      assert.doesNotMatch(line, /(^|[^.\w])trial_token\b(?!\s*,\s*\.\.\.)/,
        `a return statement referenced trial_token: ${line.trim()}`);
    }
  }
  assert.doesNotMatch(localHandler, /trialToken:\s*token/);
});

test('renderer trial type definitions exclude token-bearing fields', () => {
  const preload = read('electron/preload.ts');
  const electronTypes = read('src/types/electron.d.ts');
  const combined = `${preload}\n${electronTypes}`;

  assert.doesNotMatch(combined, /startTrial:[^\n]*trial_token\?/);
  assert.doesNotMatch(combined, /getLocalTrial:[^\n]*trialToken\?/);
  assert.match(combined, /startTrial:[^\n]*hasToken\?/);
  assert.match(combined, /getLocalTrial:[^\n]*hasToken: boolean/);
});
