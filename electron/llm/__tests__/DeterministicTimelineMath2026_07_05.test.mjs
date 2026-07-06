/**
 * Regression test for the Profile Intelligence production-fix autopilot
 * (2026-07-05, docs/investigations/pi-production-fix-progress.md, Phase 4
 * item 5). Duration-at-company / total-internship-experience / gap-between-
 * roles are exact arithmetic over the resume's own start_date/end_date and
 * must never be left to the LLM (a wrong answer here is a pure math error).
 *
 * Tenure counting is INCLUSIVE of both the start and end calendar month
 * (June-August = 3 worked months, not 2) — this is how a candidate actually
 * describes their own tenure and matches the task's own expected values
 * (~3 months for a Jun-Aug internship, ~7 months total for a 3mo + 4mo pair).
 * This deliberately diverges from the EXCLUSIVE
 * premium/electron/knowledge/DocumentChunker.ts#calculateDurationMonths (an
 * internal skill-ranking signal, a different concern with a different
 * correctness bar). Gap-between-roles is the count of months strictly
 * BETWEEN two tenures (a March-end role followed by a June-start role
 * leaves April+May unaccounted for — 2 months, not 3).
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
const { tryBuildManualProfileFastPathAnswer } = mpi;

const EVIN_PROFILE = {
  identity: { name: 'Evin John' },
  name: 'Evin John',
  experience: [
    { company: 'EstroTech Robotics', role: 'AI & Full Stack Engineer Intern', start_date: '2025-06', end_date: '2025-08' },
    { company: 'Aetherbot AI', role: 'Software Engineer Intern', start_date: '2024-12', end_date: '2025-03' },
  ],
};

const fast = (q) => tryBuildManualProfileFastPathAnswer({ question: q, profile: EVIN_PROFILE, source: 'manual_input' });

describe('duration at a specific company (inclusive tenure)', () => {
  test('"How long were you at EstroTech Robotics?" -> 3 months (Jun, Jul, Aug)', () => {
    const r = fast('How long were you at EstroTech Robotics?');
    assert.ok(r, 'must fast-path deterministically');
    assert.match(r.answer, /EstroTech Robotics/);
    assert.match(r.answer, /3 months/);
  });
});

describe('total internship experience', () => {
  test('"What\'s your total internship experience?" -> 7 months across 2 internships (3 + 4)', () => {
    const r = fast("What's your total internship experience?");
    assert.ok(r);
    assert.match(r.answer, /2 internships/);
    assert.match(r.answer, /7 months/);
  });
});

describe('gap between two named roles (exclusive — months strictly between)', () => {
  test('"What\'s the gap between your Aetherbot and EstroTech roles?" -> 2 months (April, May)', () => {
    const r = fast("What's the gap between your Aetherbot and EstroTech roles?");
    assert.ok(r);
    assert.match(r.answer, /Aetherbot AI/);
    assert.match(r.answer, /EstroTech Robotics/);
    assert.match(r.answer, /2 months/);
  });

  test('back-to-back roles (no gap) are called out honestly', () => {
    const r = tryBuildManualProfileFastPathAnswer({
      question: "What's the gap between your first and second roles?",
      profile: {
        identity: { name: 'Test User' }, name: 'Test User',
        experience: [
          { company: 'Alpha Inc', role: 'Intern', start_date: '2025-01', end_date: '2025-03' },
          { company: 'Beta Inc', role: 'Intern', start_date: '2025-04', end_date: '2025-06' },
        ],
      },
      source: 'manual_input',
    });
    assert.ok(r);
    assert.match(r.answer, /no gap|back-to-back/i);
  });
});

describe('backward compatibility — missing dates fall through to the LLM path', () => {
  const NO_DATES_PROFILE = {
    identity: { name: 'Evin John' },
    name: 'Evin John',
    experience: [{ company: 'EstroTech Robotics', role: 'Intern' }],
  };
  test('"How long were you at EstroTech?" returns null (no dates to compute from)', () => {
    const r = tryBuildManualProfileFastPathAnswer({
      question: 'How long were you at EstroTech Robotics?', profile: NO_DATES_PROFILE, source: 'manual_input',
    });
    assert.equal(r, null);
  });
});

describe('qualifier guard (test-engineer + debugger confirmed regression)', () => {
  // Every sibling fast-path branch in this file (EXPERIENCE_PATTERNS,
  // PROJECT_PATTERNS, SKILL_PATTERNS, EDUCATION_PATTERNS) defers to the LLM
  // when the question carries a filter/qualifier/comparison the canned
  // template can't honor. The timeline-math block was shipped WITHOUT this
  // guard, so a filtered ask ("total experience IN PYTHON") or a comparison
  // ("how long at X COMPARED TO Y") silently got a canned answer that
  // completely ignores the filter/comparison, stated with full confidence
  // (usedDeterministicFastPath: true, no LLM fallback).
  test('"What is your total experience in Python?" defers to the LLM (qualifier: "in Python")', () => {
    const r = fast('What is your total experience in Python?');
    assert.equal(r, null, 'must NOT silently answer with the unfiltered total');
  });

  test('"How long were you at EstroTech compared to Aetherbot?" defers to the LLM (qualifier: comparison)', () => {
    const r = fast('How long were you at EstroTech compared to Aetherbot?');
    assert.equal(r, null, 'must NOT silently answer with just one company\'s duration');
  });

  test('unqualified duration/total/gap questions still fast-path (regression guard against over-correction)', () => {
    assert.ok(fast('How long were you at EstroTech Robotics?'));
    assert.ok(fast("What's your total internship experience?"));
    assert.ok(fast("What's the gap between your Aetherbot and EstroTech roles?"));
  });
});
