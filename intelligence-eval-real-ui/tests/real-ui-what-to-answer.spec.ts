// Real UI: inject transcript → click the real "What to answer?" button → grade.
import { test, expect, FIXTURES, cases } from './_shared.ts';
import { profilePaths, loadProfileThroughUI } from '../helpers/profile-loader-ui.ts';
import { injectTranscript, parseTranscript } from '../helpers/transcript-injector-ui.ts';
import { clickWhatToAnswer } from '../helpers/what-to-answer-ui.ts';
import { UiLatencyRecorder } from '../helpers/latency-recorder-ui.ts';
import { gradeUiAnswer } from '../helpers/accuracy-grader-ui.ts';

const wta = cases.filter(c => c.mode === 'what_to_answer' && c.profileId === 'backend-engineer').slice(0, 5);

test.describe('real UI — what to answer', () => {
  for (const tc of wta) {
    test(`${tc.testId} ${tc.pattern}`, async ({ natively }) => {
      const settings = await natively.settingsWindow();
      await loadProfileThroughUI(natively, settings, profilePaths(FIXTURES, tc.profileId));
      const overlay = await natively.overlayWindow();
      await injectTranscript(overlay, parseTranscript(tc.transcript!) as any);
      const rec = new UiLatencyRecorder();
      const r = await clickWhatToAnswer(overlay, rec);
      expect(r.visibleConfirmed, 'suggested answer must be visible').toBeTruthy();
      const g = gradeUiAnswer(tc, r.text);
      if (!g.passed) console.warn(`${tc.testId} fail:`, g.failReasons, '| answer:', r.text.slice(0, 120));
      expect(g.passed, g.failReasons.join(', ')).toBeTruthy();
    });
  }
});
