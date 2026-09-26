// IPC bridge wiring — a ratchet against handlers nothing can reach.
//
// WHY THIS EXISTS
//
// A `safeHandle('x', …)` with no matching `ipcRenderer.invoke('x')` in
// preload.ts is dead in a shipped app. There is no generic passthrough:
// `e2eInvoke` is the only one and it is undefined unless NATIVELY_E2E=1. Three
// handlers were found in that state on 2026-08-29, including
// `context-intelligence:rollout-metrics` — the sole reader of the contamination
// rate, abort conditions and latency percentiles that recordTurnMetrics
// computes on EVERY turn. All of it was collected and unreadable.
//
// The same audit found the mirror-image defect in the renderer: settings code
// calling `window.electronAPI?.invoke?.('ensure-ollama-running')` behind a
// @ts-ignore. Optional chaining on a method that does not exist short-circuits
// silently, so the result was always undefined and the UI reported Ollama
// "not found" WITHOUT EVER TRYING TO START IT.
//
// Both checks are structural and cheap. Neither can prove a channel is USED,
// only that it is reachable — which is the half that kept failing.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

const HANDLER_SRC = read('electron/ipcHandlers.ts') + '\n' + read('electron/main.ts');
const PRELOAD_SRC = read('electron/preload.ts');

const handlers = new Set(
  [...HANDLER_SRC.matchAll(/safeHandle\(\s*'([^']+)'/g)].map((m) => m[1]),
);
const bridged = new Set(
  [...PRELOAD_SRC.matchAll(/ipcRenderer\.(?:invoke|send)\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
);

// Reachable through the NATIVELY_E2E-gated `e2eInvoke` passthrough, by design.
const E2E_PREFIX = '__e2e__:';

// Known-unbridged as of 2026-08-29. This list may SHRINK freely; growing it
// means a new handler shipped that nothing can call, which is the bug. Each
// entry is a real question for its owner, not an endorsement.
const KNOWN_UNBRIDGED = new Set([
  // A complete custom/curl provider feature with no reachable entry point.
  'get-curl-providers', 'save-curl-provider', 'delete-curl-provider',
  'switch-to-curl-provider', 'switch-to-custom-provider',
  // Model-selector window controls.
  'show-model-selector', 'hide-model-selector',
  // Window/session controls with no caller.
  'center-and-show-window', 'close-settings-window', 'reset-queues',
  'invalidate-natively-usage-cache', 'restart-ollama',
  // Exercised directly by their own suites rather than the renderer.
  'dev:thinking-budget-bench', 'skills:reap-stages',
  // Non-streaming predecessor of 'gemini-chat-stream', which is the only chat
  // channel preload bridges. Left registered, not deleted, because that is its
  // owner's call — but nothing in a shipped app reaches it.
  'gemini-chat',
]);

describe('IPC bridge wiring', () => {
  test('every registered handler is reachable from the renderer', () => {
    const unreachable = [...handlers]
      .filter((c) => !c.startsWith(E2E_PREFIX))
      .filter((c) => !bridged.has(c))
      .filter((c) => !KNOWN_UNBRIDGED.has(c))
      .sort();
    assert.deepEqual(unreachable, [],
      'These handlers have no ipcRenderer.invoke in preload.ts, so nothing in a ' +
      'shipped app can call them. Add a preload binding, or add the channel to ' +
      'KNOWN_UNBRIDGED with a reason:\n  ' + unreachable.join('\n  '));
  });

  test('the allowlist has not gone stale', () => {
    // An entry that is now bridged, or whose handler was deleted, is noise that
    // makes the real list harder to read.
    const stale = [...KNOWN_UNBRIDGED]
      .filter((c) => bridged.has(c) || !handlers.has(c)).sort();
    assert.deepEqual(stale, [],
      'KNOWN_UNBRIDGED entries that are now bridged or no longer exist — remove them');
  });

  test('preload exposes no generic invoke outside the E2E gate', () => {
    // The containment argument for the curated bridge (F-117): an unconditional
    // passthrough lets any renderer code reach every production channel.
    const generic = [...PRELOAD_SRC.matchAll(/^\s*invoke\s*:\s*\(/gm)];
    assert.equal(generic.length, 0,
      'a generic `invoke` on the exposed API defeats the curated bridge');
    assert.match(PRELOAD_SRC, /NATIVELY_E2E === '1'[\s\S]{0,200}e2eInvoke/,
      'e2eInvoke must stay gated on NATIVELY_E2E');
  });

  test('no renderer code calls the nonexistent generic invoke', () => {
    // This is the shape that silently no-ops: `?.invoke?.(...)` on an API that
    // has no `invoke`. It cannot throw, so it fails as "the feature did
    // nothing" rather than as an error anyone sees.
    const offenders = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(e.name)) continue;
        const src = fs.readFileSync(p, 'utf8');
        for (const m of src.matchAll(/electronAPI\s*\??\.\s*invoke\s*\??\s*\(\s*['"]([^'"]+)/g)) {
          const line = src.slice(0, m.index).split('\n').length;
          // Commented-out references are not calls.
          const text = src.split('\n')[line - 1] ?? '';
          if (text.trim().startsWith('//')) continue;
          offenders.push(`${path.relative(REPO, p)}:${line} → '${m[1]}'`);
        }
      }
    };
    walk(path.join(REPO, 'src'));
    assert.deepEqual(offenders, [],
      'electronAPI has no generic `invoke`; these calls short-circuit to ' +
      'undefined and the feature silently does nothing:\n  ' + offenders.join('\n  '));
  });
});
