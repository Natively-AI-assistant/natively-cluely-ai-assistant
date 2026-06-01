// Real UI: critical context-isolation cases — identity answers must not leak
// JD/salary/assistant-identity.
import { test, expect, FIXTURES, cases } from './_shared.ts';
import { profilePaths, loadProfileThroughUI } from '../helpers/profile-loader-ui.ts';
import { injectTranscript, parseTranscript } from '../helpers/transcript-injector-ui.ts';
import { clickWhatToAnswer } from '../helpers/what-to-answer-ui.ts';
import { askManualQuestion } from '../helpers/manual-question-ui.ts';
import { UiLatencyRecorder } from '../helpers/latency-recorder-ui.ts';
import { gradeUiAnswer } from '../helpers/accuracy-grader-ui.ts';

// ALL critical isolation/identity/regression cases (no slice) — release-blockers
// that must each pass. DA-010 (regression_projects) included.
const iso = cases.filter(c => c.critical && (c.pattern === 'context_isolation' || c.pattern === 'identity_manual' || c.pattern === 'identity_interviewer' || c.pattern === 'regression_projects'));

test.describe('real UI — context isolation (critical)', () => {
  for (const tc of iso) {
    test(`${tc.testId} ${tc.pattern}`, async ({ natively }) => {
      const settings = await natively.settingsWindow();
      await loadProfileThroughUI(natively, settings, profilePaths(FIXTURES, tc.profileId));
      const overlay = await natively.overlayWindow().catch(() => settings);
      const rec = new UiLatencyRecorder();
      let text = '';
      if (tc.mode === 'what_to_answer') { await injectTranscript(overlay, parseTranscript(tc.transcript!) as any); text = (await clickWhatToAnswer(overlay, rec)).text; }
      else text = (await askManualQuestion(overlay, tc.question!, rec)).text;
      const g = gradeUiAnswer(tc, text);
      expect(g.passed, `${tc.testId}: ${g.failReasons.join(', ')} | ${text.slice(0,120)}`).toBeTruthy();
    });
  }
});
