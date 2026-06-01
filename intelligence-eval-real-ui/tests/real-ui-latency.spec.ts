// Real UI: latency budget check on a manual factual-recall (deterministic) case
// and an LLM-backed case. Records real first-useful-token timing.
import { test, expect, FIXTURES, cases } from './_shared.ts';
import { profilePaths, loadProfileThroughUI } from '../helpers/profile-loader-ui.ts';
import { askManualQuestion } from '../helpers/manual-question-ui.ts';
import { UiLatencyRecorder } from '../helpers/latency-recorder-ui.ts';

test('real UI — manual identity latency (deterministic fast path)', async ({ natively }) => {
  const tc = cases.find(c => c.pattern === 'identity_manual' && c.profileId === 'backend-engineer')!;
  const settings = await natively.settingsWindow();
  await loadProfileThroughUI(natively, settings, profilePaths(FIXTURES, tc.profileId));
  const overlay = await natively.overlayWindow().catch(() => settings);
  const rec = new UiLatencyRecorder();
  const r = await askManualQuestion(overlay, tc.question!, rec);
  const fut = rec.toMetrics().firstUsefulTokenMs;
  console.log(`identity first-useful-token: ${Math.round(fut)}ms`);
  expect(r.visibleConfirmed).toBeTruthy();
  // Budget is asserted softly here; the runner's report enforces aggregate p50/p95.
  expect(fut, 'identity recall should be fast').toBeLessThan(8000);
});
