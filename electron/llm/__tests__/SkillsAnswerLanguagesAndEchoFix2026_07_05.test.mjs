/**
 * Regression test for the Profile Intelligence production-fix ROUND 2
 * (2026-07-05, docs/investigations/pi-production-fix-round2-progress.md,
 * RC3). "What programming languages are you strongest in?" fell through
 * SKILL_PATTERNS entirely (no pattern matched "strongest") and reached the
 * provider, which echoed a rephrased question back as the "answer"
 * ("What programming languages do you work with?", 44 chars) instead of
 * ever answering — skills_answer should never need the provider at all.
 *
 * Fixed by:
 *   1. Adding "strongest/best/most skilled" language phrasings to
 *      SKILL_PATTERNS.
 *   2. Exempting the "strongest/best languages/skills" self-rating
 *      superlative from hasUnhandledQualifier (it's a whole-list framing,
 *      not a filter the canned template can't honor — distinct from "which
 *      PROJECT used GraphQL", a genuine subset filter).
 *   3. Adding formatProgrammingLanguages — when the profile has categorized
 *      skills (skills.languages), a "programming languages" ask answers
 *      precisely from that category instead of the full mixed skills dump.
 *
 * Requires: npm run build:electron.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mpi = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/manualProfileIntelligence.js')).href
);
const { tryBuildManualProfileFastPathAnswer, hasUnhandledQualifier } = mpi;

const EVIN_PROFILE = {
  identity: { name: 'Evin John' },
  name: 'Evin John',
  skills: {
    languages: ['Java', 'Python', 'TypeScript', 'JavaScript', 'SQL', 'C++', 'Rust'],
    frameworks: ['Next.js', 'React', 'Node.js', 'FastAPI', 'Express'],
  },
};

const fast = (q) => tryBuildManualProfileFastPathAnswer({ question: q, profile: EVIN_PROFILE, source: 'manual_input' });

describe('"strongest in" languages phrasing fast-paths instead of echoing the question', () => {
  test('"What programming languages are you strongest in?" answers deterministically', () => {
    const r = fast('What programming languages are you strongest in?');
    assert.ok(r, 'must fast-path — this exact phrasing previously fell through to the provider and echoed the question');
    assert.equal(r.usedDeterministicFastPath, true);
    assert.match(r.answer, /Java|Python|TypeScript|JavaScript/);
    assert.doesNotMatch(r.answer, /^What programming languages/i, 'must never echo the question back as the answer');
  });

  test('answer is scoped to LANGUAGES only, not the mixed frameworks dump', () => {
    const r = fast('What programming languages are you strongest in?');
    assert.ok(r);
    assert.doesNotMatch(r.answer, /React|Node\.js|FastAPI|Express/, 'a "programming languages" ask must not include frameworks');
  });

  test('"What languages do you know?" still fast-paths (pre-existing pattern, regression guard)', () => {
    const r = fast('What languages do you know?');
    assert.ok(r);
    assert.match(r.answer, /Java|Python/);
  });
});

describe('hasUnhandledQualifier: superlative self-rating vs. genuine filter', () => {
  test('"strongest/best languages" is NOT treated as an unhandled qualifier', () => {
    assert.equal(hasUnhandledQualifier('what programming languages are you strongest in'), false);
    assert.equal(hasUnhandledQualifier('what skills are you best at'), false);
  });

  test('a genuine filter/selection question IS still treated as an unhandled qualifier (regression guard)', () => {
    assert.equal(hasUnhandledQualifier('which project used graphql'), true);
    assert.equal(hasUnhandledQualifier('what skills are most relevant to this role'), true);
  });
});

describe('general skills question is unaffected (regression guard)', () => {
  test('"What are your skills?" still returns the full mixed list', () => {
    const r = fast('What are your skills?');
    assert.ok(r);
    assert.match(r.answer, /Java/);
    assert.match(r.answer, /React|Node\.js|FastAPI|Express/, 'general skills ask should still include frameworks');
  });
});
