// Real UI: manual question input → real chat stream → grade UI-visible answer.
import { test, expect, FIXTURES, cases } from './_shared.ts';
import { profilePaths, loadProfileThroughUI } from '../helpers/profile-loader-ui.ts';
import { askManualQuestion } from '../helpers/manual-question-ui.ts';
import { UiLatencyRecorder } from '../helpers/latency-recorder-ui.ts';
import { gradeUiAnswer } from '../helpers/accuracy-grader-ui.ts';

const manual = cases.filter(c => c.mode === 'manual_input' && c.profileId === 'backend-engineer').slice(0, 5);

test.describe('real UI — manual input', () => {
  for (const tc of manual) {
    test(`${tc.testId} ${tc.pattern}: ${tc.question}`, async ({ natively }) => {
      const settings = await natively.settingsWindow();
      await loadProfileThroughUI(natively, settings, profilePaths(FIXTURES, tc.profileId));
      const overlay = await natively.overlayWindow().catch(() => settings);
      const rec = new UiLatencyRecorder();
      const r = await askManualQuestion(overlay, tc.question!, rec);
      expect(r.visibleConfirmed, 'answer must be visible in the UI').toBeTruthy();
      const g = gradeUiAnswer(tc, r.text);
      if (!g.passed) console.warn(`${tc.testId} fail:`, g.failReasons, '| answer:', r.text.slice(0, 120));
      expect(g.passed, g.failReasons.join(', ')).toBeTruthy();
    });
  }
});
