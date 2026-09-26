// Every card override is DEV-build only, and a forced card records nothing
// (toaster policy Phase 4, spec §10). A packaged renderer is a production
// build (import.meta.env.DEV false), so a URL or a window flag can no longer
// force a card, hide one, or open the review prompt there.
//
// Source assertions: these reads are spread over components that are not
// unit-rendered. The forcing itself is behavioural, in
// src/lib/onboarding/__tests__/orchestratorForceCard2026_09_26.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(src, rel), 'utf8');
const app = read('App.tsx');
const host = read('components/onboarding/OrchestratedToasterHost.tsx');
const review = read('components/ReviewPromptHost.tsx');
const ext = read('components/onboarding/BrowserExtensionToaster.tsx');

test('App forces a card through the orchestrator, in DEV only', () => {
  assert.ok(app.includes('const forced = import.meta.env.DEV ? forcedCardFromQuery(window.location.search, { adsAvailable: PREMIUM_ADS_AVAILABLE }) : null;'));
  assert.ok(app.includes('if (forced) orch.forceCard(forced);'));
  assert.ok(!app.includes("get('forceAd')"), 'no second path renders an ad');
});

test('App mounts no second review host', () => {
  assert.ok(!app.includes('shouldMountDevReviewHost'));
  assert.ok(!host.includes("params.get('review')"), 'the host has no dev skip to keep in sync');
});

test('?noorch is DEV-only', () => {
  assert.ok(app.includes("(import.meta.env.DEV && new URLSearchParams(window.location.search).get('noorch') === '1')"));
});

test('the host: a forced showing records nothing; isolate flags are DEV-only', () => {
  assert.ok(host.includes('const forced = state.forcedToasterId === activeId;'));
  assert.ok(host.includes('if (activeId && !forced && Object.prototype.hasOwnProperty.call(CARDS, activeId)) recorder.start(activeId);'));
  assert.equal((host.match(/get\('isolate'\)/g) || []).length, (host.match(/import\.meta\.env\.DEV && new URLSearchParams\(window\.location\.search\)\.get\('isolate'\)/g) || []).length);
});

test('ReviewPromptHost: forcing and the window helpers exist in DEV only', () => {
  const force = review.slice(review.indexOf('function isDevForceShow'), review.indexOf('}', review.indexOf('if (!dev) return false')));
  assert.ok(force.indexOf('if (!dev) return false') > -1 && force.indexOf('if (!dev) return false') < force.indexOf('params.get("review")'), 'DEV is checked before any flag');
  assert.ok(review.includes('if (typeof window === "undefined" || !import.meta.env.DEV) return'), 'helpers only in DEV');
});

test('the extension card has no override of its own', () => {
  assert.ok(!ext.includes('extToaster'));
  assert.ok(!ext.includes('testForceShow'));
});
