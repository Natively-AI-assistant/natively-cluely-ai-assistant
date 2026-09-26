// electron/rag/__tests__/EmbeddingSelectionGuard.test.mjs
//
// Selecting a provider that cannot actually run must FAIL LOUDLY.
//
// The panel used to filter the selector down to available providers, so an
// unusable one could not be picked. That filter is a UI detail and it has since
// moved; the guarantee must not live only there.
//
// Without a guard the failure is silent and misleading: the choice is written to
// settings, the resolver correctly produces NO candidate for a keyless provider,
// resolve() falls through to the bundled model, and the user is left looking at
// "MiniLM" wondering why clicking "Gemini" selected something else.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const read = p => readFileSync(path.join(root, p), 'utf8');

const modPath = path.resolve(root, 'dist-electron/electron/rag/embeddingSelection.js');
const { validateEmbeddingSelection } = await import(pathToFileURL(modPath).href);

const CATALOG = [
  { id: 'natively', name: 'Natively', available: false, unavailableReason: 'no_key', models: [] },
  { id: 'gemini', name: 'Gemini', available: false, unavailableReason: 'no_key', models: [] },
  { id: 'openai', name: 'OpenAI', available: true, models: [{ id: 'text-embedding-3-small' }] },
  { id: 'ollama', name: 'Ollama', available: false, unavailableReason: 'not_running', models: [] },
  { id: 'custom', name: 'Custom endpoint', available: false, unavailableReason: 'not_configured', models: [] },
  { id: 'local', name: 'Built-in', available: true, models: [{ id: 'Xenova/all-MiniLM-L6-v2' }] },
];

describe('a usable provider is accepted', () => {
  test('an available cloud provider passes', () => {
    assert.equal(validateEmbeddingSelection('openai', CATALOG).ok, true);
  });

  test('the bundled model always passes — it needs nothing', () => {
    assert.equal(validateEmbeddingSelection('local', CATALOG).ok, true);
  });

  test('automatic mode is not a provider selection and is never blocked', () => {
    assert.equal(validateEmbeddingSelection(undefined, CATALOG).ok, true);
  });
});

describe('an unusable provider is refused with the REASON', () => {
  test('a keyless cloud provider is refused, naming the missing key', () => {
    const r = validateEmbeddingSelection('gemini', CATALOG);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'provider_unavailable');
    assert.match(r.message, /Gemini/);
    assert.match(r.message, /key/i, 'the message must say WHAT is missing');
  });

  test('a stopped Ollama is refused with a different reason than a missing key', () => {
    const r = validateEmbeddingSelection('ollama', CATALOG);
    assert.equal(r.ok, false);
    assert.match(r.message, /running/i);
    assert.doesNotMatch(r.message, /API key/i, 'Ollama needs no key — saying so would misdirect');
  });

  test('an unconfigured custom endpoint is refused with its own reason', () => {
    const r = validateEmbeddingSelection('custom', CATALOG);
    assert.equal(r.ok, false);
    assert.match(r.message, /endpoint/i);
  });

  test('a provider blocked by the privacy policy says so, not "no key"', () => {
    const blocked = CATALOG.map(p => p.id === 'gemini' ? { ...p, unavailableReason: 'blocked_by_policy' } : p);
    const r = validateEmbeddingSelection('gemini', blocked);
    assert.match(r.message, /privacy/i);
    assert.doesNotMatch(r.message, /key/i);
  });

  test('an unknown provider id is refused rather than written to settings', () => {
    const r = validateEmbeddingSelection('not-a-provider', CATALOG);
    assert.equal(r.ok, false);
  });
});

describe('the guard is actually wired into the write path', () => {
  test('set-config validates before persisting', () => {
    // A guard that runs after settings.set() would leave the bad choice stored.
    const ipc = read('electron/ipcHandlers.ts');
    const i = ipc.indexOf("safeHandle('embedding:set-config'");
    assert.notEqual(i, -1);
    // Window sized to the whole handler, not a guessed char count — a fixed
    // slice silently made writeAt -1 once the guard grew the body.
    const body = ipc.slice(i, ipc.indexOf("safeHandle('", i + 10));
    const guardAt = body.indexOf('validateEmbeddingSelection');
    const writeAt = body.indexOf("settings.set('embedding'");
    assert.notEqual(guardAt, -1, 'set-config must validate the selection');
    assert.notEqual(writeAt, -1, 'the write must be inside the handler window');
    assert.ok(guardAt < writeAt, 'validation must run BEFORE the write');
  });
});
