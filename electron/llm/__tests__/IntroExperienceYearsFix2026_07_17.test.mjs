// electron/llm/__tests__/IntroExperienceYearsFix2026_07_17.test.mjs
//
// Campaign 2 (longsession, 2026-07-17): generateCandidateIntro (ContextAssembler.ts)
// previously gave the model only role/company/skill NAMES for a self-introduction —
// never the candidate's total years of experience, even though a résumé's summary
// line often states it explicitly ("Senior backend engineer with 10 years of
// experience..."). Live-proven on a real harness run (test/harness-longsession,
// script-a press A1, real MiniMax-M3): the generated intro said "the last few
// years" instead of the real, computable figure ("10 years") for a résumé whose
// experience entries (Aug 2014 - present) deterministically compute to ~10 years
// via PostProcessor.computeTotalExperience — the SAME calculation the
// isIdentityDirect fast path (KnowledgeOrchestrator.ts) already uses correctly for
// "years of experience"-shaped direct questions; generateCandidateIntro just never
// received it for the intro-question shape specifically.
//
// Fix: generateCandidateIntro now computes totalExperienceYears internally (no
// call-site signature change — both AOTPipeline.preComputeIntro and
// ContextAssembler.assemblePromptContext's JIT fallback get the fix for free) and
// includes it in the prompt's "Candidate background" block plus an explicit rule
// telling the model to state the exact figure rather than a vague substitute.
//
// Source-level assertion (matches this file's sibling IntroNameLeadGenerator test's
// established pattern) — the real generation is exercised by the harness/E2E path.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const src = fs.readFileSync(path.join(repoRoot, 'premium/electron/knowledge/ContextAssembler.ts'), 'utf8');
const fnStart = src.indexOf('function generateCandidateIntro');
const fn = src.slice(fnStart, fnStart + 4200);

describe('generateCandidateIntro includes the candidate\'s total years of experience', () => {
  test('imports the same deterministic computeTotalExperience the isIdentityDirect fast path uses', () => {
    assert.match(src.slice(0, fnStart), /import\s*\{\s*computeTotalExperience\s*\}\s*from\s*['"]\.\/PostProcessor['"]/, 'computeTotalExperience must be imported from PostProcessor (not re-derived)');
  });

  test('the prompt computes totalExperienceYears from the resume', () => {
    assert.match(fn, /const\s+totalExperienceYears\s*=\s*computeTotalExperience\(resume\)/);
  });

  test('the "Candidate background" block includes the years figure when present', () => {
    assert.match(fn, /Total years of professional experience:\s*\$\{totalExperienceYears\}/);
  });

  test('the RULES block explicitly instructs the model to state the exact figure, not a vague substitute', () => {
    assert.match(fn, /STATE THE EXACT YEARS OF EXPERIENCE/i);
    assert.match(fn, /the last few years/i, 'the anti-pattern phrase must be named so the model avoids it');
  });

  test('the years figure is gated on totalExperienceYears > 0 (no "0 years" leak for a resume with no computable experience)', () => {
    assert.match(fn, /totalExperienceYears > 0 \? `\\n- Total years of professional experience/);
  });
});

describe('computeTotalExperience produces a real, non-zero figure for the p01 fixture resume shape', () => {
  test('Aug 2014 - present (4 sequential roles) computes a real figure, not a "few years" hand-wave', async () => {
    const modPath = path.resolve(__dirname, '../../../dist-electron/premium/electron/knowledge/PostProcessor.js');
    const { computeTotalExperience } = await import(`file://${modPath}`);
    const resume = {
      experience: [
        { start_date: '2022-03', end_date: null }, // Stripe, present (open-ended -> "now")
        { start_date: '2019-08', end_date: '2022-02' }, // Datadog
        { start_date: '2017-07', end_date: '2019-07' }, // prior role
        { start_date: '2014-08', end_date: '2017-06' }, // first role
      ],
    };
    const years = computeTotalExperience(resume);
    // Not pinned to an exact value (the open-ended role resolves against the
    // REAL current date, not a mocked clock, so the exact figure drifts over
    // time) — the fix's contract is "compute a real, specific figure from the
    // sequential 2014-present roles", which any value comfortably in the
    // "career of a decade" range satisfies. A brittle exact-year assertion
    // would itself become a stale-test liability as real time passes.
    assert.ok(years >= 8 && years <= 15, `expected a real double-digit-ish figure for Aug 2014-present, got ${years}`);
  });

  test('an empty experience list returns 0 (the >0 gate correctly suppresses the years line)', async () => {
    const modPath = path.resolve(__dirname, '../../../dist-electron/premium/electron/knowledge/PostProcessor.js');
    const { computeTotalExperience } = await import(`file://${modPath}`);
    assert.equal(computeTotalExperience({ experience: [] }), 0);
    assert.equal(computeTotalExperience({}), 0);
  });
});
