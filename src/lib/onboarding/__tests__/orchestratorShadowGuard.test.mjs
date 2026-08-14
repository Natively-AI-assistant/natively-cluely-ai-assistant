// src/lib/onboarding/__tests__/orchestratorShadowGuard.test.mjs
//
// REGRESSION GUARD (2026-07-10) for the "stuck at startup / blank launcher"
// field bug.
//
// Root cause (bisected): src/lib/onboarding/orchestrator.mjs used to export a
// NO-OP `getOrchestrator()`. The app imports the orchestrator with an
// unqualified specifier ('./onboarding/orchestrator'); Vite's DEFAULT
// resolve.extensions order puts `.mjs` before `.ts`, so the PACKAGED bundle
// silently resolved the no-op `.mjs` stub instead of the real orchestrator.ts
// class. The stub's `start()` did nothing (no toasters ever), and its
// `getSnapshot()` returned a FRESH object literal on every call — which makes
// React's useSyncExternalStore infinite-render ("Maximum update depth"),
// unmounting the tree to a blank/black launcher.
//
// It was masked by two fragile guardrails: explicit `.ts` import extensions and
// a vite.config.mts `resolve.extensions` override (commit 6f32a64). This guard
// makes the FIX permanent and fail-loud: the `.mjs` companion must expose ONLY
// the pure decision predicate — no stateful orchestrator handle that could
// shadow the real singleton.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MJS = join(__dirname, '..', 'orchestrator.mjs');

test('orchestrator.mjs must NOT export a stateful getOrchestrator (shadow footgun)', async () => {
  const mod = await import('../orchestrator.mjs');
  assert.equal(
    typeof mod.getOrchestrator,
    'undefined',
    'orchestrator.mjs must not export getOrchestrator — it silently shadows the real orchestrator.ts singleton in the Vite bundle and reintroduces the blank-launcher infinite-render bug. Keep the real singleton exclusively in orchestrator.ts.',
  );
});

test('orchestrator.mjs exposes only the pure predicate + default state', async () => {
  const mod = await import('../orchestrator.mjs');
  // shouldShowToaster is what tests actually import; DEFAULT_USER_STATE is pure data.
  assert.equal(typeof mod.shouldShowToaster, 'function', 'shouldShowToaster must remain exported for tests');
  assert.equal(typeof mod.DEFAULT_USER_STATE, 'object', 'DEFAULT_USER_STATE must remain exported');
  // No stateful/handle-shaped exports.
  for (const banned of ['getOrchestrator', 'createNoopOrchestrator', 'OnboardingOrchestrator']) {
    assert.equal(mod[banned], undefined, `orchestrator.mjs must not export ${banned}`);
  }
});

test('orchestrator.mjs source defines no getSnapshot (the unstable-snapshot leak site)', () => {
  const src = readFileSync(MJS, 'utf8');
  // A getSnapshot returning a fresh literal was the infinite-render trigger.
  // The pure companion has no business DEFINING one. We scan only non-comment
  // lines so the header's cautionary mention of getSnapshot() doesn't false-trip.
  const codeLines = src
    .split('\n')
    .filter((l) => {
      const s = l.trim();
      return s && !s.startsWith('*') && !s.startsWith('//') && !s.startsWith('/*');
    });
  const definesGetSnapshot = codeLines.some((l) => /\bgetSnapshot\s*[:(]/.test(l));
  assert.equal(
    definesGetSnapshot,
    false,
    'orchestrator.mjs must not define getSnapshot — that stub was the useSyncExternalStore infinite-render source',
  );
});
