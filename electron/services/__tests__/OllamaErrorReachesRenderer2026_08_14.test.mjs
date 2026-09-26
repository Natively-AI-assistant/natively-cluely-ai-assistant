// F-119 regression pin (audit/autopilot-2026-08-14).
//
// LLMHelper.notifyRendererOllamaError() broadcasts a deliberate user-facing
// notification on 'ollama-error' when Ollama is unreachable / has no models
// AND the fallback also failed. Repo-wide, exactly one file referenced the
// channel: the producer. No preload method subscribed, so the user saw a
// silent hang. Live-reproduced in scripts/audit/F-119-repro.mjs.
//
// Contracts pinned here: preload exposes onOllamaError wired to the
// 'ollama-error' channel, and the renderer (App.tsx) consumes it into the
// pull-status banner's 'failed' state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..', '..');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.ts'), 'utf8');
const appTsx = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');

test('preload subscribes onOllamaError to the ollama-error channel', () => {
  // lastIndexOf: the first occurrence is the interface declaration; the
  // implementation (with the ipcRenderer wiring) comes later in the file.
  const idx = preload.lastIndexOf('onOllamaError:');
  assert.notEqual(idx, -1, 'preload must expose onOllamaError (F-119)');
  const body = preload.slice(idx, idx + 400);
  assert.ok(
    /ipcRenderer\.on\('ollama-error'/.test(body),
    'onOllamaError must subscribe to the ollama-error channel'
  );
  assert.ok(
    /removeListener\('ollama-error'/.test(body),
    'onOllamaError must return an unsubscribe that removes the listener'
  );
});

test('App.tsx consumes onOllamaError into the failed banner state', () => {
  const idx = appTsx.indexOf('onOllamaError');
  assert.notEqual(idx, -1, 'App.tsx must register an onOllamaError listener (F-119)');
  const body = appTsx.slice(idx, idx + 500);
  // The listener may set the banner inline, OR delegate to a local helper that
  // does. Both transient failure notices were routed through a shared
  // showTransientBannerFailure() so they share one cancellable reset timer
  // instead of leaking a timer per event — a refactor that preserved the
  // user-visible behaviour but defeated a pin that only looked for the inline
  // call. Follow one level of indirection; the banner reaching 'failed' is the
  // contract, not where the call is written.
  const direct = /setOllamaPullStatus\('failed'\)/.test(body);
  const viaHelper = [...body.matchAll(/\b([a-z][A-Za-z0-9_]*)\s*\(/g)]
    .map(m => m[1])
    .some(name => {
      const hIdx = appTsx.indexOf(`const ${name} =`);
      return hIdx !== -1 && /setOllamaPullStatus\('failed'\)/.test(appTsx.slice(hIdx, hIdx + 600));
    });
  assert.ok(
    direct || viaHelper,
    "the listener must surface the failure via the banner's 'failed' state, " +
    'either inline or through a local helper that does'
  );
});
