// First-run guide: wiring for the final-review fixes (2026-11-10).
// Run: node --test src/components/__tests__/FirstRunGuideReview2026_11_10.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('main owns the facts, the meeting reconcile and the ended meeting id', () => {
  const store = read('electron/services/firstRunGuideStore.ts');
  assert.ok(store.includes("event.type === 'plan_changed'") && store.includes('factsProvider()'), 'plan_changed facts come from main, not the renderer');
  assert.ok(store.includes('reconcileGuide('), 'restart and plans_closed reconcile with a running meeting');
  assert.ok(/atLaunch: !launchReconciled/.test(store), 'the launch reconcile runs once per process');
  const ipc = read('electron/ipcHandlers.ts');
  assert.ok(ipc.includes('configureGuideStore('));
  assert.ok(ipc.includes('TRIAL_SENTINEL_KEY') && /trialSentinel: TRIAL_SENTINEL_KEY/.test(ipc));
  assert.ok(/safeHandle\('guide:dispatch'[^\n]*dispatchGuideFromWindow\(event\)/.test(ipc), 'windows go through the validated path');
  const main = read('electron/main.ts');
  assert.ok(main.includes("applyGuideEvent({ type: 'meeting_saved', meetingId })"), 'main reports the saved meeting');
});

test('the launcher opens the saved meeting, asks main about the trial, and never leaves the guide invisible', () => {
  const g = read('src/components/guide/LauncherGuide.tsx');
  assert.ok(g.includes('state?.endedMeetingId'));
  assert.ok(!g.includes('getRecentMeetings'), 'no guessing from the list');
  assert.ok(g.includes('getLocalTrial') && g.includes('trialEventFromLocal('));
  assert.ok(!g.includes('getOrchestrator().getUserState()'));
  assert.ok(g.includes("tr('Continue the guide')"), 'a way back when the step is not on screen');
});

test('Settings uses the honest step 6 title', () => {
  const g = read('src/components/guide/SettingsGuide.tsx');
  assert.ok(g.includes('planStepTitle('));
  assert.ok(!g.includes('ALMOST_GONE_MS'));
});

test('App keeps trying for the card slot until it holds it', () => {
  const app = read('src/App.tsx');
  const fx = app.slice(app.indexOf("claimExternalCard('first_run_guide'"), app.indexOf("releaseExternalCard('first_run_guide')"));
  assert.ok(fx.includes('orch.subscribe('), 'retries when the orchestrator changes');
});
