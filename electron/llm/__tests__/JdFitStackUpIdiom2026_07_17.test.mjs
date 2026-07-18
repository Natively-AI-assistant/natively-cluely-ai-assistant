// electron/llm/__tests__/JdFitStackUpIdiom2026_07_17.test.mjs
//
// Campaign 2 (longsession, 2026-07-17): "The JD calls for 8+ years and deep Go
// or Java expertise — how do you stack up there?" (script-a press A9) was
// misrouted to technical_concept_answer — the answer type meant for neutral
// "what is Redis?"-style explanations, which FORBIDS the resume/jd context
// layers entirely. Root cause: the bare `\bstack\b` inside DSA_PATTERNS
// (electron/llm/AnswerPlanner.ts) and TECHNICAL_SUBJECT_PATTERNS matched the
// comparison IDIOM "stack up" (= "measure up / compare"), not the data-
// structure noun. The existing `textNoTechStack` normalizer already
// neutralized "tech stack" / "full-stack" for exactly this class of false
// positive but never covered "stack up".
//
// Live-proven: run against the real backend (test/harness-longsession,
// script-a press A9, MiniMax-M3) with candidateProfileChars:0 in the
// [TRACE:LONGCTX] prompt_assembled trace, and the model answered with the
// blanket CORE_IDENTITY "reveal internals" refusal ("I can't share that
// information.") instead of the candidate's actual Go experience — because
// technical_concept_answer's forbidden layers dropped resume+jd from the
// prompt for a genuine JD-comparison question.
//
// The fix neutralizes "stack(s/ed) up" → "measure(s/ed) up" in
// textNoTechStack (same normalizer, same fix shape as tech-stack/full-stack),
// fixes the ONE call site that was still checking isLikelyTechnicalConcept
// against the raw (un-neutralized) text instead of textNoTechStack, fixes
// classifyUnmatchedFallback's own independent bare-\bstack\b collision by
// passing it textNoTechStack too, and adds an explicit JD_FIT_PATTERNS entry
// so an explicit "the JD calls for X — how do you stack up?" routes to the
// MORE PRECISE jd_fit_answer (resume + jd required) rather than merely falling
// through to a safe-but-JD-blind profile_fact/project_answer bucket.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { planAnswer } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/AnswerPlanner.js')).href
);

const p = (q, source = 'what_to_answer', speaker = 'interviewer', hasCandidateProfile = true) =>
  planAnswer({ question: q, source, speakerPerspective: speaker, hasCandidateProfile });

describe('"stack up" idiom no longer collides with the DSA/technical-concept `stack` noun', () => {
  test('the exact live-failing question routes to jd_fit_answer, not technical_concept_answer', () => {
    const r = p('The JD calls for 8+ years and deep Go or Java expertise — how do you stack up there?');
    assert.equal(r.answerType, 'jd_fit_answer');
  });

  test('jd_fit_answer requires BOTH resume and jd context layers', () => {
    const r = p('The JD calls for 8+ years and deep Go or Java expertise — how do you stack up there?');
    assert.ok(r.requiredContextLayers.includes('resume'), 'resume must be required');
    assert.ok(r.requiredContextLayers.includes('jd'), 'jd must be required');
    assert.ok(!r.forbiddenContextLayers.includes('resume'), 'resume must NOT be forbidden');
    assert.ok(!r.forbiddenContextLayers.includes('jd'), 'jd must NOT be forbidden');
  });

  test('a bare "how do you stack up?" (no JD-requirement frame) still avoids technical_concept_answer', () => {
    // Without the explicit "JD calls for / requires" frame, the new JD_FIT_PATTERNS
    // entry does not fire, but the idiom neutralization + textNoTechStack fixes at
    // the DSA/technical-concept and classifyUnmatchedFallback call sites must still
    // prevent the bare \bstack\b collision from forcing the profile-forbidden route.
    const r = p('So how do you stack up against the other candidates?');
    assert.notEqual(r.answerType, 'technical_concept_answer');
  });

  test('a genuine data-structure "stack" question is UNAFFECTED (stays technical, profile forbidden)', () => {
    // Regression guard: the idiom-specific "stack up" replacement must not touch
    // ordinary DSA usage of the word "stack" on its own.
    const r = p('how would you optimize a stack?');
    assert.equal(r.answerType, 'technical_concept_answer');
    assert.equal(r.profileContextPolicy, 'forbidden');
  });

  test('"what tech stack did you use?" is still project_followup (the pre-existing tech-stack guard is untouched)', () => {
    const r = p('what tech stack did you use?');
    assert.equal(r.answerType, 'project_followup_answer');
  });
});
