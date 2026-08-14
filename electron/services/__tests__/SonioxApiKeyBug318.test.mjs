/**
 * Regression tests for issue #318 — Soniox API key not working.
 *
 * TWO bug classes fixed:
 *
 * BUG A: getStoredCredentials returns masked keys ("sk-...XXXX"). SettingsOverlay
 *   was pre-populating STT key input fields with these masked values. On settings
 *   reopen, clicking "Test Connection" submitted the masked string — rejected by
 *   every provider. Fix: remove pre-population for all STT key fields; add a
 *   masked-key guard in handleSttKeySubmit.
 *
 * BUG B: STT key-save IPC handlers (set-soniox-api-key, set-deepgram-api-key,
 *   set-elevenlabs-api-key, set-azure-api-key, set-ibmwatson-api-key) did not
 *   call reconfigureSttProvider(). If the user selected a provider before entering
 *   the key, reconfigure ran with no key → fell back to GoogleSTT; saving the key
 *   later did not rebuild the pipeline. Fix: add reconfigureSttProvider() to all
 *   five handlers.
 */

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

// ─── BUG A: masked key pre-population ────────────────────────────────────────

test('SettingsOverlay does not pre-populate any STT key field from masked credential values', () => {
  const source = read('src/components/SettingsOverlay.tsx');

  const masked = [
    { pattern: /if\s*\(creds\.sttGroqKey\)\s*setSttGroqKey\(creds\.sttGroqKey\)/, name: 'sttGroqKey' },
    { pattern: /if\s*\(creds\.sttOpenaiKey\)\s*setSttOpenaiKey\(creds\.sttOpenaiKey\)/, name: 'sttOpenaiKey' },
    { pattern: /if\s*\(creds\.sttDeepgramKey\)\s*setSttDeepgramKey\(creds\.sttDeepgramKey\)/, name: 'sttDeepgramKey' },
    { pattern: /if\s*\(creds\.sttElevenLabsKey\)\s*setSttElevenLabsKey\(creds\.sttElevenLabsKey\)/, name: 'sttElevenLabsKey' },
    { pattern: /if\s*\(creds\.sttAzureKey\)\s*setSttAzureKey\(creds\.sttAzureKey\)/, name: 'sttAzureKey' },
    { pattern: /if\s*\(creds\.sttIbmKey\)\s*setSttIbmKey\(creds\.sttIbmKey\)/, name: 'sttIbmKey' },
    { pattern: /if\s*\(creds\.sttSonioxKey\)\s*setSttSonioxKey\(creds\.sttSonioxKey\)/, name: 'sttSonioxKey' },
  ];

  for (const { pattern, name } of masked) {
    assert.doesNotMatch(
      source,
      pattern,
      `${name} state must not be pre-populated from masked credential — submitting "sk-...XXXX" to any provider fails auth`,
    );
  }
});

test('SettingsOverlay handleSttKeySubmit rejects masked key values before testing', () => {
  const source = read('src/components/SettingsOverlay.tsx');

  // The source file contains the literal regex /^sk-\.\.\.[A-Za-z0-9]{4}$/.
  // We just need to confirm the guard exists near handleSttKeySubmit.
  const submitFnStart = source.indexOf('const handleSttKeySubmit');
  assert.ok(submitFnStart >= 0, 'handleSttKeySubmit must exist');
  const submitBlock = source.slice(submitFnStart, submitFnStart + 600);
  assert.match(
    submitBlock,
    /sk-/,
    'handleSttKeySubmit must contain a guard that rejects masked keys matching sk-...XXXX',
  );
  assert.match(
    submitBlock,
    /masked/,
    'handleSttKeySubmit guard must mention "masked" in its error message',
  );
});

// ─── BUG B: missing reconfigureSttProvider in all STT key handlers ────────────

const STT_KEY_HANDLERS = [
  'set-soniox-api-key',
  'set-deepgram-api-key',
  'set-elevenlabs-api-key',
  'set-azure-api-key',
  'set-ibmwatson-api-key',
];

for (const handlerName of STT_KEY_HANDLERS) {
  test(`${handlerName} IPC handler calls reconfigureSttProvider after saving the key`, () => {
    const source = read('electron/ipcHandlers.ts');

    const handlerStart = source.indexOf(`safeHandle('${handlerName}'`);
    assert.ok(handlerStart >= 0, `${handlerName} handler must exist in ipcHandlers.ts`);

    const nextHandlerStart = source.indexOf('safeHandle(', handlerStart + 1);
    const handlerBlock = source.slice(handlerStart, nextHandlerStart > handlerStart ? nextHandlerStart : handlerStart + 700);

    assert.match(
      handlerBlock,
      /reconfigureSttProvider/,
      `${handlerName} must call reconfigureSttProvider() so an already-active pipeline picks up the new key immediately`,
    );
  });
}

test('set-groq-stt-api-key IPC handler does not need reconfigureSttProvider (Groq STT uses RestSTT, no live WS)', () => {
  // Groq STT is REST-based — each transcription is a fresh HTTP call, so no persistent
  // connection needs rebuilding when the key changes. This test documents the intentional
  // omission so reviewers don't add reconfigureSttProvider() there unnecessarily.
  const source = read('electron/ipcHandlers.ts');
  const handlerStart = source.indexOf("safeHandle('set-groq-stt-api-key'");
  assert.ok(handlerStart >= 0, 'set-groq-stt-api-key handler must exist');
  // No assertion on reconfigureSttProvider — omission is intentional for Groq REST.
});
