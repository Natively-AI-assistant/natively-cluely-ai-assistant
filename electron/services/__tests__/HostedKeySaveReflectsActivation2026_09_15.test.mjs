// A key save must return AFTER its activation settled (2026-09-15).
//
// CONFIRMED LIVE, real OpenRouter key, real app (isolated userData, CDP):
//
//   T0 BEFORE key   : provider=local  eligible=false reason=provider-not-selected
//   save returned in 2ms: {"success":true}
//   T1 IMMEDIATELY  : provider=local  eligible=false reason=provider-not-selected   <-- what the panel renders
//   T+1000ms        : provider=openrouter model=voyageai/rerank-2.5-lite eligible=true
//
// RerankerSettings.saveKey() awaits setRerankerHostedKey and then calls
// refreshStatus() straight away. The IPC returns in 2ms; activation needs one
// OpenRouter catalogue fetch (~hundreds of ms). So the panel refreshed against
// settings that had not been written yet and told the user their freshly pasted,
// perfectly valid key was "provider-not-selected" — the provider only appeared
// if they navigated away and came back.
//
// The CREDENTIAL write stays independent of the network, which is why
// activateHostedRetrieval is fire-and-forget: a save must never fail because
// OpenRouter is unreachable. Only the HANDLER's return waits. The key is
// already durable by then, so a slow or failed activation cannot lose it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(process.cwd());
const cm = fs.readFileSync(path.join(repoRoot, 'electron/services/CredentialsManager.ts'), 'utf8');
const ipc = fs.readFileSync(path.join(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');

describe('the activation is awaitable', () => {
  test('CredentialsManager retains the in-flight activation', () => {
    assert.match(cm, /public whenHostedRetrievalSettled\s*\([^)]*\)\s*:\s*Promise<void>/,
      'handlers need a handle to await; a bare void call cannot be observed');
    assert.match(cm, /this\._hostedActivation\s*=/,
      'the promise must be retained, not discarded');
  });

  test('awaiting it can never reject — a failed activation must not fail the save', () => {
    const i = cm.indexOf('whenHostedRetrievalSettled');
    const body = cm.slice(i, cm.indexOf('\n    }', i));
    assert.ok(/catch/.test(body),
      `a rejected activation must settle, not propagate: ${body.slice(0, 200)}`);
  });
});

describe('every key handler waits for it before answering', () => {
  const handlers = [
    "safeHandle('reranker:set-hosted-key'",
    "safeHandle('reranker:set-openrouter-key'",
    "safeHandle('embedding:set-voyage-key'",
    "safeHandle('embedding:set-openrouter-key'",
  ];

  for (const h of handlers) {
    test(`${h.match(/'([^']+)'/)[1]} awaits the activation`, () => {
      const start = ipc.indexOf(h);
      assert.ok(start > 0, `${h} must exist`);
      const end = ipc.indexOf('safeHandle(', start + 20);
      const body = ipc.slice(start, end > 0 ? end : start + 3000);
      assert.ok(/await .*whenHostedRetrievalSettled\(\)/.test(body),
        'without this the renderer refreshes against settings the activation has '
        + `not written yet: ${body.slice(0, 300)}`);
    });
  }
});

describe('the wait is bounded — a save must never hang on the network', () => {
  // listOpenRouterRerankModels uses AbortSignal.timeout(10_000)
  // (openrouterRerankModels.ts:25). Awaiting the activation unbounded would
  // therefore let an unreachable OpenRouter spin the Save button for ten
  // seconds. The activation is allowed to take that long; the HANDLER is not.
  // Past the cap it returns and the activation still lands — the panel is then
  // briefly stale, which is the old behaviour and strictly better than a
  // ten-second spinner.
  test('whenHostedRetrievalSettled takes a timeout with a sane default', () => {
    assert.match(cm, /whenHostedRetrievalSettled\s*\(\s*timeoutMs\s*(:|=)/,
      'the wait must be bounded by the caller, not by the network');
    const i = cm.indexOf('public whenHostedRetrievalSettled');
    const body = cm.slice(i, cm.indexOf('\n    }', i));
    assert.ok(/Promise\.race/.test(body),
      `the cap must actually race the activation: ${body.slice(0, 300)}`);
    const dflt = body.match(/timeoutMs\s*(?::\s*number\s*)?=\s*(\d+)/);
    assert.ok(dflt, 'there must be a default cap');
    const ms = Number(dflt[1]);
    assert.ok(ms > 0 && ms < 10_000,
      `the cap must be shorter than the 10s catalogue fetch it is protecting against; got ${ms}`);
  });

  test('the timer never keeps the process alive', () => {
    const i = cm.indexOf('public whenHostedRetrievalSettled');
    const body = cm.slice(i, cm.indexOf('\n    }', i));
    assert.ok(/unref\(\)/.test(body),
      'a pending setTimeout in the main process is a leaked handle; unref it');
  });
});
