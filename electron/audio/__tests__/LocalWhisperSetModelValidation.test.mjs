// Regression test for IPC-side validation of local Whisper model ids
// (2026-07-08). The catalog membership gate runs in main.ts at startup, but
// IPC handlers writing model ids to disk bypass it. Without validation, an
// invalid/retired id can be persisted (renderer UI no longer sees it in the
// catalog) and only crashes on the NEXT startup preload.
//
// Guards:
//   1. local-whisper-set-model rejects unknown ids.
//   2. local-whisper-set-channel-config rejects unknown mic / system ids
//      when non-empty, but allows empty strings (= "clear override").

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function readSrc(relPath) {
  return fs.readFileSync(path.resolve(root, relPath), 'utf8');
}

function findSafeHandleBody(source, channel) {
  // Match the safeHandle call by its channel literal. The listener arg is an
  // arrow function `async (...) => { ... }`. Its OUTER body starts at the
  // `=>` arrow token, not at the parameter-list '(' — the '(' we hit at the
  // listener-arg beginning belongs to the parameter list (e.g. `( _,
  // modelId: string)`), not the body. So: walk to the `=>`, then the next
  // non-whitespace char is either `(...)` (expression body) or `{...}`
  // (block body). Capture from there to its matching close.
  const re = new RegExp(`safeHandle\\(\\s*['"]${channel}['"]\\s*,`, 'm');
  const m = source.match(re);
  assert.ok(m, `expected safeHandle(${channel} in source`);
  // Find the arrow '=>' after the listener parameter list.
  const arrowIdx = source.indexOf('=>', m.index + m[0].length);
  assert.ok(arrowIdx > -1, `expected '=>' arrow in safeHandle(${channel} listener`);
  // Walk forward from the arrow to the body's opening token.
  let i = arrowIdx + 2;
  while (i < source.length && /\s/.test(source[i])) i++;
  assert.ok(source[i] === '{' || source[i] === '(', `expected '{' or '(' after => in safeHandle(${channel}`);
  const openTok = source[i];
  const closeTok = openTok === '{' ? '}' : ')';
  const openIdx = i;
  // Walk to the matching close, balancing the SAME bracket type and skipping
  // strings + template literals + nested parens/braces inside the body.
  let depth = 1;
  let j = openIdx + 1;
  for (; j < source.length && depth > 0; j++) {
    const ch = source[j];
    if (ch === openTok) depth++;
    else if (ch === closeTok) depth--;
    else if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      j++;
      for (; j < source.length && source[j] !== quote; j++) {
        if (source[j] === '\\') j++;
      }
    }
    else if (ch === '/' && source[j + 1] === '/') {
      const nl = source.indexOf('\n', j);
      j = nl === -1 ? source.length : nl;
    }
    else if (ch === '/' && source[j + 1] === '*') {
      const end = source.indexOf('*/', j + 2);
      j = end === -1 ? source.length : end + 1;
    }
  }
  return source.slice(openIdx, j - 1);
}

function stripCommentsAndStrings(source) {
  // Strip block comments, line comments, and string literals so substring
  // assertions are not fooled by commented-out code or docstrings.
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const nx = source[i + 1];
    if (ch === '/' && nx === '/') {
      const nl = source.indexOf('\n', i);
      i = nl === -1 ? source.length : nl;
      continue;
    }
    if (ch === '/' && nx === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

test("local-whisper-set-model validates the id against MODEL_CATALOG_IDS", () => {
  const src = readSrc('electron/ipcHandlers.ts');
  const body = stripCommentsAndStrings(findSafeHandleBody(src, 'local-whisper-set-model'));
  assert.ok(
    body.includes('MODEL_CATALOG_IDS.has(modelId)'),
    "local-whisper-set-model must consult MODEL_CATALOG_IDS before persisting",
  );
  // Error message text in the source uses a template literal — stripCommentsAndStrings
  // removes the string contents entirely, so the rejection-error assertion must
  // match against the source string BEFORE stripping.
  const rawBody = findSafeHandleBody(readSrc('electron/ipcHandlers.ts'), 'local-whisper-set-model');
  assert.ok(
    rawBody.includes('Unknown local Whisper model'),
    "local-whisper-set-model must return a clear rejection error for unknown ids",
  );
  assert.ok(
    body.includes("SettingsManager.getInstance().set(") && body.includes("modelId"),
    "local-whisper-set-model must still persist via SettingsManager after validation passes",
  );
});

test('local-whisper-set-channel-config validates non-empty mic/system ids', () => {
  const src = readSrc('electron/ipcHandlers.ts');
  const body = stripCommentsAndStrings(findSafeHandleBody(src, 'local-whisper-set-channel-config'));
  assert.ok(
    body.includes('MODEL_CATALOG_IDS.has(cfg.micModelId)'),
    "channel-config handler must validate the mic id",
  );
  assert.ok(
    body.includes('MODEL_CATALOG_IDS.has(cfg.systemModelId)'),
    "channel-config handler must validate the system id",
  );
  // Empty strings must still be accepted (= clear override).
  assert.ok(
    body.includes('cfg.micModelId&&!MODEL_CATALOG_IDS.has(cfg.micModelId)') || body.includes('cfg.micModelId&& !MODEL_CATALOG_IDS') || body.includes('cfg.micModelId && !MODEL_CATALOG_IDS'),
    "channel-config handler must allow empty-string mic ids (clear override)",
  );
  assert.ok(
    body.includes('cfg.systemModelId&&!MODEL_CATALOG_IDS.has(cfg.systemModelId)') || body.includes('cfg.systemModelId&& !MODEL_CATALOG_IDS') || body.includes('cfg.systemModelId && !MODEL_CATALOG_IDS'),
    "channel-config handler must allow empty-string system ids (clear override)",
  );
});

test('renderer LocalWhisperModelPanel surfaces the recovery notice', () => {
  const src = readSrc('src/components/LocalWhisperModelPanel.tsx');
  assert.ok(
    src.includes('localWhisperGetRecoveryNotice'),
    'renderer must call localWhisperGetRecoveryNotice on mount',
  );
  assert.ok(
    src.includes('recoveryNotice'),
    'renderer must store the notice in component state',
  );
  assert.ok(
    src.includes('Recovered local transcription') || src.includes('recovered local transcription'),
    'renderer must render a user-visible banner for the recovery notice',
  );
});