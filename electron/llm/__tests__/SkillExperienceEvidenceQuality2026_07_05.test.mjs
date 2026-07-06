/**
 * Regression test for the Profile Intelligence production-fix autopilot
 * (2026-07-05, docs/investigations/pi-production-fix-progress.md, Confirmed
 * Bug #2 + #2b). formatSkillExperience previously discarded the actual
 * grounded bullet/description and rendered a one-line non-answer
 * ("Yes, aws has been part of my work at Aetherbot AI.", lowercase skill
 * name) even when the resume has a specific, quotable bullet. Fixed by
 * capturing the matching bullet/description as evidence and appending it,
 * plus casing the skill name via the profile's own casing / a known-acronym
 * map instead of printing the raw lowercased regex match verbatim.
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
  skills: ['Java', 'Python', 'TypeScript', 'JavaScript', 'AWS', 'Redis'],
  experience: [
    {
      company: 'Aetherbot AI',
      role: 'Software Engineer Intern',
      bullets: [
        'Engineered a scalable pixel-streaming pipeline on AWS EC2, managing system trade-offs to reduce latency to sub-80ms for real-time interaction.',
      ],
    },
  ],
  projects: [
    {
      name: 'RedisMart',
      description: 'A high-performance e-commerce engine utilizing Redis caching and real-time analytics to optimize database performance and user experience.',
      technologies: ['React', 'Node.js', 'Redis'],
    },
  ],
};

const fast = (q) => tryBuildManualProfileFastPathAnswer({ question: q, profile: EVIN_PROFILE, source: 'manual_input' });

describe('skill-experience answers quote real grounded evidence, not a bare one-liner', () => {
  test('"What\'s your experience with AWS?" cites the actual EC2/sub-80ms bullet', () => {
    const r = fast("What's your experience with AWS?");
    assert.ok(r);
    assert.match(r.answer, /AWS/, 'skill name is present');
    assert.doesNotMatch(r.answer, /^Yes, aws has been part/, 'must not be the bare lowercase one-liner');
    assert.match(r.answer, /sub-80ms|pixel-streaming|EC2/i, 'must quote the real bullet evidence');
  });

  test('skill name is properly cased (AWS, not "aws")', () => {
    const r = fast('Have you used AWS?');
    assert.ok(r);
    assert.match(r.answer, /\bAWS\b/);
    assert.doesNotMatch(r.answer, /\baws\b/, 'lowercase acronym must never appear');
  });

  test('"Have you worked with Redis in production-like settings?" cites the RedisMart project description', () => {
    const r = fast('Have you worked with Redis in production-like settings?');
    assert.ok(r);
    assert.doesNotMatch(r.answer, /^Yes, redis has been part of RedisMart\.$/i, 'must not be the bare one-liner with no evidence');
    assert.match(r.answer, /caching|analytics|e-commerce/i, 'must quote the real project evidence');
  });

  test('project-description evidence is grammatically well-formed (no "Specifically, I a high-performance…")', () => {
    const r = fast('Have you used Redis?');
    assert.ok(r);
    assert.doesNotMatch(r.answer, /Specifically, I a\b/i, 'noun-phrase evidence must not be forced into a first-person verb clause');
  });

  test('an EXPERIENCE entry description phrased as a noun phrase (not a bullet) is also grammatically well-formed (code-review 2026-07-05 HIGH)', () => {
    // The original fix only guarded PROJECT descriptions against this grammar
    // bug; an experience entry's own `description`/`summary` field can be
    // phrased as a third-person noun phrase too (the extraction schema
    // doesn't constrain grammatical person), and the fallback branch
    // (no matching `bullets`, falls back to descOrSummary) always assumed
    // first-person until this fix.
    const r = tryBuildManualProfileFastPathAnswer({
      question: 'Have you used Docker?',
      profile: {
        identity: { name: 'Test User' }, name: 'Test User',
        skills: ['Docker', 'Kubernetes'],
        experience: [
          { company: 'Beta Inc', role: 'Engineer', description: 'A containerized microservices deployment pipeline using Docker and Kubernetes.' },
        ],
      },
      source: 'manual_input',
    });
    assert.ok(r);
    assert.doesNotMatch(r.answer, /Specifically, I a\b/i, 'noun-phrase experience description must not be forced into a first-person verb clause');
    assert.match(r.answer, /It's a containerized/i, 'noun-phrase evidence uses "It\'s ..." framing');
  });

  test('an EXPERIENCE entry description phrased as a first-person bullet still uses "Specifically, I ..." framing', () => {
    const r = tryBuildManualProfileFastPathAnswer({
      question: 'Have you used Kubernetes?',
      profile: {
        identity: { name: 'Test User' }, name: 'Test User',
        skills: ['Kubernetes'],
        experience: [
          { company: 'Gamma Inc', role: 'DevOps Engineer', description: 'Led infrastructure automation using Kubernetes across multiple cloud regions.' },
        ],
      },
      source: 'manual_input',
    });
    assert.ok(r);
    assert.match(r.answer, /Specifically, I led/i, 'first-person bullet-style description uses "Specifically, I ..." framing');
  });
});
