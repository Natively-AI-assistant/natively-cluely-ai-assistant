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
 * Since the Full-JIT policy (2026-07-07/08, commit 6e6189b4), this layer only
 * SELECTS structured evidence — it never renders `.answer` prose, and
 * `usedDeterministicFastPath` is always false (there is no more prose
 * fast-path to flag). Rewritten 2026-07-23 against a runtime probe of the
 * compiled module: a "programming languages" ask selects ONLY the
 * `skills.languages` field (scoped, no frameworks); a general "skills" ask
 * selects the flat `skills` field containing the full mixed dump (languages
 * + frameworks). The original bug — falling through to the provider and
 * echoing the question — is no longer reachable at this layer since
 * `skills_answer` always resolves to a deterministic evidence selection now;
 * grammar/phrasing of the rendered answer is a downstream JIT-prompt-builder
 * concern. hasUnhandledQualifier is untouched by the Full-JIT policy (it's a
 * plain string predicate, not an answer-rendering function) so those
 * assertions are unchanged.
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

const hasItem = (r, field, value) => r.items.some((f) => f.field === field && (value === undefined || JSON.stringify(f.value) === JSON.stringify(value)));

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
  test('"What programming languages are you strongest in?" selects deterministic evidence, never falls through to the provider echo', () => {
    const r = fast('What programming languages are you strongest in?');
    assert.ok(r, 'must select evidence — this exact phrasing previously fell through to the provider and echoed the question');
    assert.equal(r.usedDeterministicEvidenceSelection, true);
    assert.equal(r.answer, undefined, 'Full-JIT policy: must not render a final answer string');
    assert.ok(hasItem(r, 'skills.languages', ['Java', 'Python', 'TypeScript', 'JavaScript', 'SQL', 'C++', 'Rust']));
  });

  test('evidence is scoped to LANGUAGES only, not the mixed frameworks dump', () => {
    const r = fast('What programming languages are you strongest in?');
    assert.ok(r);
    assert.ok(!r.items.some((f) => f.field === 'skills'), 'a "programming languages" ask must select the scoped skills.languages field, not the flat mixed skills field');
    assert.doesNotMatch(JSON.stringify(r.items), /React|Node\.js|FastAPI|Express/, 'a "programming languages" ask must not include frameworks');
  });

  test('"What languages do you know?" selects the SAME scoped languages evidence (pre-existing pattern, regression guard; phrasing distinction is a downstream JIT-prompt-builder concern, not testable at this layer)', () => {
    const r = fast('What languages do you know?');
    assert.ok(r);
    assert.equal(r.answer, undefined, 'Full-JIT policy: must not render a final answer string');
    assert.ok(hasItem(r, 'skills.languages', ['Java', 'Python', 'TypeScript', 'JavaScript', 'SQL', 'C++', 'Rust']));
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
  test('"What are your skills?" still selects the full mixed evidence (languages + frameworks), unlike the scoped languages-only asks above', () => {
    const r = fast('What are your skills?');
    assert.ok(r);
    assert.equal(r.answer, undefined, 'Full-JIT policy: must not render a final answer string');
    assert.ok(!r.items.some((f) => f.field === 'skills.languages'), 'general skills ask must select the flat mixed skills field, not the scoped languages field');
    const skillsItem = r.items.find((f) => f.field === 'skills');
    assert.ok(skillsItem, 'must select the flat skills field');
    assert.ok(skillsItem.value.includes('Java'), 'general skills ask should still include languages');
    assert.ok(['React', 'Node.js', 'FastAPI', 'Express'].some((v) => skillsItem.value.includes(v)), 'general skills ask should still include frameworks');
  });
});
