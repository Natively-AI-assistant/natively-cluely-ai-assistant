/**
 * Answer-pipeline-rebuild Phase 2, RC-2 — regression for a confirmed live bug:
 * "what is an api" and "what is a qraphql query" (GraphQL typo) were
 * misclassified as `unknown_answer` (permissive profileContextPolicy:
 * 'allowed'), causing the user's résumé/profile content to be injected into
 * what should be a generic technical-definition answer. Confirmed live via
 * a real-backend harness (docs/answer-pipeline-rebuild/00_REPRODUCTION_RAW.json):
 * 3/3 reps injected the profile block before the fix, 0/3 after.
 *
 * Fix: added "api"/"restful"/"graph ql" to TECHNICAL_SUBJECT_PATTERNS and a
 * typo-tolerant fallback (reusing the existing includesPlannerTerm/levenshtein1
 * word-fuzzy matcher) to isLikelyTechnicalConcept.
 *
 * A code-review pass on that fix (2026-07-27) found the broadened matcher also
 * reaches a SECOND call site — the negation guard for PROJECT_FOLLOWUP_PATTERNS
 * routing — where new exact trigger words like "framework" (only in the
 * typo-tolerant list, not the original exact patterns) would wrongly exclude a
 * genuine project follow-up ("what frameworks did you use in your project?")
 * from project_followup routing, recreating the same unknown_answer-leak bug
 * class for a different question shape. That guard was scoped back to the
 * exact TECHNICAL_SUBJECT_PATTERNS check only. The tests below cover both the
 * original bug and this discovered-during-review regression.
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
const p = (q) => planAnswer({ question: q, source: 'manual_input', speakerPerspective: 'user' });

describe('RC-2 regression: generic technical questions must not leak profile via unknown_answer', () => {
  const cases = [
    'what is an api',
    'what is a qraphql query',
    'what is a graph ql query',
    'what is restful api design',
    // Live-confirmed by the Phase 2 harness expansion (2026-07-27): "what is
    // CI/CD" classified identically to safe siblings (unknown_answer/allowed)
    // but, unlike them, actually leaked profile 3/3 live reps — this specific
    // profile's résumé happens to keyword-overlap with devops-adjacent terms,
    // which a downstream relevance-match then surfaced. Root cause: CI/CD
    // vocabulary was simply absent from TECHNICAL_SUBJECT_PATTERNS.
    'what is CI/CD',
    'what is ci cd',
    'what is cicd',
    'what is devops',
  ];
  for (const q of cases) {
    test(`"${q}" must NOT classify as unknown_answer and must forbid profile context`, () => {
      const r = p(q);
      assert.notEqual(r.answerType, 'unknown_answer', `got answerType=${r.answerType}`);
      assert.equal(profileContextPolicyFor(r.answerType), 'forbidden', `answerType ${r.answerType} has policy ${profileContextPolicyFor(r.answerType)}, expected 'forbidden'`);
    });
  }
});

describe('RC-2 fix must not regress genuine project follow-up routing (code-review 2026-07-27)', () => {
  // These must NOT classify as unknown_answer — they are legitimate project
  // drill-in questions the typo-tolerant broadening could otherwise exclude
  // from project_followup_answer via the shared isLikelyTechnicalConcept check.
  const projectFollowUps = [
    'what frameworks did you use in your project?',
    'what framework did you build it with?',
  ];
  for (const q of projectFollowUps) {
    test(`"${q}" must NOT fall through to unknown_answer`, () => {
      const r = p(q);
      assert.notEqual(r.answerType, 'unknown_answer', `got answerType=${r.answerType}`);
    });
  }
});

describe('CI/CD fix must not regress genuine project follow-up routing (code-review 2026-07-27, second finding)', () => {
  // Same bug class as the "framework" case above: a code-review pass on the
  // first version of the CI/CD fix found it added the new vocabulary directly
  // into TECHNICAL_SUBJECT_PATTERNS, which the project_followup_answer
  // negation guard (AnswerPlanner.ts ~line 2535) also consults directly —
  // live-confirmed to misroute these into unknown_answer/forbidden-profile
  // types instead of project_followup_answer/required. Fixed by moving the
  // CI/CD vocabulary into a separate DEVOPS_CICD_PATTERNS array consulted
  // only by isLikelyTechnicalConcept, not the negation guard.
  const projectFollowUps = [
    'how did you handle CI/CD?',
    'how did you handle CI/CD in your project?',
    'how did you design the devops setup?',
    'why did you choose jenkins?',
    'why did you choose jenkins for your project?',
  ];
  for (const q of projectFollowUps) {
    test(`"${q}" must route to project_followup_answer with profile required`, () => {
      const r = p(q);
      assert.equal(r.answerType, 'project_followup_answer', `got answerType=${r.answerType}`);
      assert.equal(profileContextPolicyFor(r.answerType), 'required', `answerType ${r.answerType} has policy ${profileContextPolicyFor(r.answerType)}, expected 'required'`);
    });
  }
});

describe('RC-2 fix must not misroute genuine profile/skill-experience questions containing curated typo-tolerant terms', () => {
  const profileQuestions = [
    'how did you use docker in your last role?',
    'what database have you worked with?',
  ];
  for (const q of profileQuestions) {
    test(`"${q}" must not be forced into a forbidden-profile technical_concept_answer`, () => {
      const r = p(q);
      // These are experience-framed ("have you", "in your last role") — they
      // should route to a profile-permitting type, not the generic concept type.
      assert.notEqual(r.answerType, 'technical_concept_answer', `got answerType=${r.answerType}`);
    });
  }
});
