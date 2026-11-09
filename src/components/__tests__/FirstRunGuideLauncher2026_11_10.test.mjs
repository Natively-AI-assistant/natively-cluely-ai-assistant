// First-run guide, launcher side (docs/superpowers/specs/2026-11-10-first-run-guide-design.md):
// starts when the Unlock Pro card closes, steps 1 and 5, and the trial-ended
// card waits while the guide runs. Source checks: these components need a DOM.
// Run: node --test src/components/__tests__/FirstRunGuideLauncher2026_11_10.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('closing the Plans card reports plans_closed with the user facts', () => {
  const host = read('src/components/onboarding/OrchestratedToasterHost.tsx');
  const plansCase = host.slice(host.indexOf("case 'plans':"), host.indexOf("case 'demo_video':"));
  assert.ok(plansCase.includes('onDismiss={closePlans}'), 'the plans card closes through closePlans');
  const closePlans = host.slice(host.indexOf('const closePlans'), host.indexOf('const openSettings'));
  assert.ok(closePlans.includes("type: 'plans_closed'"), 'closePlans dispatches plans_closed');
  assert.ok(/hasOwnAiKey/.test(host) && /launchCount/.test(host), 'facts carry own key and launch count');
});

test('the launcher marks its Start button and the meeting tabs for the guide', () => {
  assert.ok(read('src/components/Launcher.tsx').includes('data-guide="start"'));
  assert.ok(read('src/components/MeetingDetails.tsx').includes('data-guide="meeting-tabs"'));
});

test('LauncherGuide draws steps 1 and 5 and reports the meeting', () => {
  const g = read('src/components/guide/LauncherGuide.tsx');
  for (const s of ['[data-guide="start"]', '[data-guide="meeting-tabs"]', 'meeting_started', 'meeting_stopped',
    'notes_next', 'trial_unavailable', "'Start your first meeting.'", "'Your meeting, written up.'"]) {
    assert.ok(g.includes(s), s);
  }
});

test('App mounts LauncherGuide, holds the card slot, and holds back the trial-ended card while the guide runs', () => {
  const app = read('src/App.tsx');
  assert.ok(app.includes('<LauncherGuide'));
  assert.ok(app.includes("'first_run_guide'"), 'claims the orchestrator slot');
  assert.ok(app.includes("type: 'trial_out'"));
  assert.ok(/showTrialExpiredModal && !guideHoldsScreen/.test(app), 'the trial-ended card waits for the guide');
  assert.ok(/trialEndedOpen: \(showTrialExpiredModal \|\| trialEndedDue\) && !guideHoldsScreen/.test(app));
});
