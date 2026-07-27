/**
 * Answer-pipeline-rebuild Phase 2, RC-9 — regression for a confirmed live bug:
 * "what is dependency injection" was misclassified as `unknown_answer`
 * (permissive profileContextPolicy: 'allowed'), causing the full candidate
 * profile (~10.6K chars, factualBlockCount:1) to be injected into a request
 * that has nothing to do with the candidate. Confirmed live via the n=20
 * real-backend harness run (docs/answer-pipeline-rebuild/00_REPRODUCTION_RAW.json,
 * run phase0-repro-2026-07-27T17-47-25-680Z): 5/5 reps of
 * `case2c_dependency_injection` injected the raw profile
 * (promptAuditLatest.hasRawCandidateProfile === true), 100% deterministic —
 * not the intermittent kind of gap the earlier RC-2/RC-CICD sentinel leaks
 * were. A vocabulary sweep against sibling "what is X" phrasing (which
 * classify correctly) found 12 more common OOP/design-pattern/testing/infra
 * terms with the identical gap — same bug class as RC-2/RC-CICD: the term
 * was simply absent from the technical-concept vocabulary, so it fell through
 * to unknown_answer's relevance-gated (and here, apparently always-triggered)
 * profile policy.
 *
 * Fix: added a new SOFTWARE_ENGINEERING_CONCEPT_PATTERNS array (dependency
 * injection/IoC, design-pattern family, memory leak/load balancing, unit
 * testing/TDD/monorepo), consulted only by isLikelyTechnicalConcept — kept
 * OUT of TECHNICAL_SUBJECT_PATTERNS itself, mirroring DEVOPS_CICD_PATTERNS's
 * established design, since that array also feeds the project_followup_answer
 * negation guard and merging there would misroute genuine own-project
 * follow-ups ("how did you apply dependency injection in your project?").
 *
 * Two pre-existing quirks were found and confirmed UNRELATED to this fix
 * (identical before/after via git-stash isolation): "how did you use
 * dependency injection in your project?" routes to
 * skill_experience_answer/required (not project_followup_answer, but still
 * profile-permitting — asserted below), and "how did you implement unit
 * testing in your project?" routes to coding_question_answer/FORBIDDEN — a
 * project-specific question wrongly denied profile access. Both predate this
 * change (confirmed identical under git stash of this fix) and are out of
 * scope for RC-9; the second is flagged here as a known, NOT-asserted-clean
 * finding for a future pass rather than silently left undocumented.
 *
 * CODE REVIEW ROUND 2 (2026-07-27) found two more real HIGH issues in the
 * first version of this fix, both fixed here:
 *
 * 1. Plural forms of 5 of the 13 new terms never matched ("what are design
 *    patterns", "what causes memory leaks" [see below], "what are factory
 *    patterns", "what is the observer patterns", "what are memory leaks",
 *    "what are monorepos") because each pattern's trailing `\b` boundary
 *    can't match with a trailing "s" already consuming the word-character
 *    slot — the exact bug class this PR exists to close, just on plural
 *    phrasing. Fixed by adding `s?` (or reusing the existing `\w*`/`s?`
 *    already present on `load balanc\w*`/`solid principles?`) to all five.
 *
 * 2. The new vocabulary widened the technical_concept branch's surface into
 *    common behavioral-interview phrasing ("describe a time you set up load
 *    balancing under pressure", "describe how you improved test coverage
 *    with unit testing at your last job") that previously routed to
 *    behavioral_interview_answer/jd_fit_answer (profile required) and now
 *    got wrongly denied profile access, because that branch had no
 *    equivalent of the past-tense-personal-experience guard the sibling
 *    debugging-question branch already has. Fixed by factoring that guard
 *    out into a shared `isPastTensePersonalExperienceFrame`, widening its
 *    verb list (the failing examples use "set up"/"introduced"/"improved",
 *    none of which were in the original bug-focused list), and applying it
 *    to both branches.
 *
 * While verifying the plural fix, found ANOTHER pre-existing, unrelated gap:
 * "what causes memory leaks" still fails — not from pluralization, but
 * because `TECHNICAL_CONCEPT_PATTERNS` (the outer explain/what-is/describe
 * framing gate, checked before isLikelyTechnicalConcept is ever consulted)
 * doesn't recognize "what causes X" as a concept-question frame at all.
 * Confirmed via git-stash-free direct testing that this reproduces
 * IDENTICALLY on "what causes a deadlock" — an old DSA term this diff never
 * touched — so it's a pre-existing, structural gap in a shared, foundational
 * pattern array, not something introduced or worsened by SOFTWARE_ENGINEERING_
 * CONCEPT_PATTERNS. Out of scope for RC-9; not asserted clean below.
 *
 * Requires: npm run build:electron.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { planAnswer, profileContextPolicyFor } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/AnswerPlanner.js')).href
);
const p = (q) => planAnswer({ question: q, source: 'manual_input', speakerPerspective: 'user', hasCandidateProfile: true });

describe('RC-9 regression: software-engineering concept questions must not leak profile via unknown_answer', () => {
  const cases = [
    'what is dependency injection',
    'what is inversion of control',
    'what is a singleton pattern',
    'what is a design pattern',
    'what is the observer pattern',
    'what is a factory pattern',
    'what is solid principles',
    'what is a memory leak',
    'what is load balancing',
    'what is unit testing',
    'what is tdd',
    'what is a monorepo',
  ];
  for (const q of cases) {
    test(`"${q}" must classify as technical_concept_answer and forbid profile context`, () => {
      const r = p(q);
      assert.equal(r.answerType, 'technical_concept_answer', `got answerType=${r.answerType}`);
      assert.equal(profileContextPolicyFor(r.answerType), 'forbidden', `answerType ${r.answerType} has policy ${profileContextPolicyFor(r.answerType)}, expected 'forbidden'`);
    });
  }
});

describe('RC-9 fix must not regress genuine project follow-up routing (own-project phrasing stays profile-permitting)', () => {
  const projectFollowUps = [
    'why did you choose a singleton pattern for your project?',
    'why did you use a monorepo for your project?',
  ];
  for (const q of projectFollowUps) {
    test(`"${q}" must route to project_followup_answer with profile required`, () => {
      const r = p(q);
      assert.equal(r.answerType, 'project_followup_answer', `got answerType=${r.answerType}`);
      assert.equal(profileContextPolicyFor(r.answerType), 'required', `answerType ${r.answerType} has policy ${profileContextPolicyFor(r.answerType)}, expected 'required'`);
    });
  }

  // Pre-existing quirk (confirmed unrelated to this fix via git-stash
  // isolation — identical answerType/policy before and after): routes to
  // skill_experience_answer, not project_followup_answer, but the property
  // that matters (profile permitted) still holds.
  test('"how did you use dependency injection in your project?" must not forbid profile context', () => {
    const r = p('how did you use dependency injection in your project?');
    assert.notEqual(profileContextPolicyFor(r.answerType), 'forbidden', `answerType ${r.answerType} has policy ${profileContextPolicyFor(r.answerType)}, expected non-forbidden`);
  });

  // NOT asserted clean — flagged only. "how did you implement unit testing in
  // your project?" routes to coding_question_answer/FORBIDDEN, wrongly
  // denying profile access to a project-specific question. Confirmed
  // unrelated to this fix (identical under git stash); out of scope for RC-9.
  // Left undocumented-but-unasserted would silently hide a known gap, so it's
  // recorded here as a comment for a future root-cause pass instead.
});

describe('RC-9 code-review round 2: plural forms must classify identically to singular', () => {
  const plurals = [
    'what are some common design patterns',
    'explain design patterns',
    'what are design patterns',
    'what are factory patterns',
    'what is the observer patterns',
    'what are memory leaks',
    'what are monorepos',
  ];
  for (const q of plurals) {
    test(`"${q}" must classify as technical_concept_answer and forbid profile context`, () => {
      const r = p(q);
      assert.equal(r.answerType, 'technical_concept_answer', `got answerType=${r.answerType}`);
      assert.equal(profileContextPolicyFor(r.answerType), 'forbidden', `answerType ${r.answerType} has policy ${profileContextPolicyFor(r.answerType)}, expected 'forbidden'`);
    });
  }

  // Pre-existing, unrelated gap (confirmed via "what causes a deadlock", an
  // old untouched DSA term, reproducing identically): `TECHNICAL_CONCEPT_
  // PATTERNS` doesn't recognize "what causes X" as a concept-question frame
  // at all, regardless of which vocabulary term follows. Out of scope for
  // RC-9 — flagged, not asserted.
});

describe('RC-9 code-review round 2: technical-concept vocabulary must not deny profile on behavioral past-experience framing', () => {
  const behavioral = [
    'describe a time you set up load balancing under pressure',
    'describe a design pattern you introduced to fix a messy codebase',
    'describe how you improved test coverage with unit testing at your last job',
  ];
  for (const q of behavioral) {
    test(`"${q}" must not forbid profile context`, () => {
      const r = p(q);
      assert.notEqual(profileContextPolicyFor(r.answerType), 'forbidden', `answerType ${r.answerType} has policy ${profileContextPolicyFor(r.answerType)}, expected non-forbidden`);
    });
  }

  // The pre-existing debugging-branch guard this was factored out of must
  // keep working identically after the refactor.
  test('"tell me about a difficult bug you solved" must still route to behavioral, not debugging', () => {
    const r = p('tell me about a difficult bug you solved');
    assert.notEqual(r.answerType, 'debugging_question_answer', `got answerType=${r.answerType}`);
    assert.notEqual(profileContextPolicyFor(r.answerType), 'forbidden', `answerType ${r.answerType} has policy ${profileContextPolicyFor(r.answerType)}, expected non-forbidden`);
  });

  test('"what is a deadlock" must still classify as technical_concept_answer/forbidden (guard must not over-fire)', () => {
    const r = p('what is a deadlock');
    assert.equal(r.answerType, 'technical_concept_answer', `got answerType=${r.answerType}`);
    assert.equal(profileContextPolicyFor(r.answerType), 'forbidden');
  });
});
