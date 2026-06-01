// Real UI: cost recording smoke — confirms a real LLM-backed answer produces a
// non-zero estimated cost and token counts.
import { test, expect, FIXTURES, cases } from './_shared.ts';
import { profilePaths, loadProfileThroughUI } from '../helpers/profile-loader-ui.ts';
import { askManualQuestion } from '../helpers/manual-question-ui.ts';
import { UiLatencyRecorder } from '../helpers/latency-recorder-ui.ts';
import { recordCost } from '../helpers/cost-recorder-ui.ts';

test('real UI — cost recorded for an LLM-backed answer', async ({ natively }) => {
  const tc = cases.find(c => c.pattern === 'jd_alignment' && c.profileId === 'backend-engineer')!;
  const settings = await natively.settingsWindow();
  await loadProfileThroughUI(natively, settings, profilePaths(FIXTURES, tc.profileId));
  const overlay = await natively.overlayWindow().catch(() => settings);
  const rec = new UiLatencyRecorder();
  const r = await askManualQuestion(overlay, tc.question || 'how do I fit this JD?', rec);
  const cost = recordCost(tc.question || '', r.text, 'gemini-3.5-flash');
  console.log('cost:', JSON.stringify(cost));
  expect(cost.outputTokens).toBeGreaterThan(0);
  expect(cost.estimatedCostUsd).toBeGreaterThan(0);
});
