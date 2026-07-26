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

const hasItem = (r, field, value) => r.items.some((f) => f.field === field && (value === undefined || JSON.stringify(f.value) === JSON.stringify(value)));

// Since the Full-JIT policy (2026-07-07/08, commit 6e6189b4), this layer only
// SELECTS structured evidence — it never renders `.answer` prose, so the old
// "quotes the real bullet" / "grammatically well-formed" assertions (which
// depended on a rendered string) no longer apply at this layer. Rewritten
// 2026-07-23 against a runtime probe of the compiled module: `findProfileSkill`
// grounds a skill ONLY via matching project technologies/description, never via
// an experience entry's `bullets`/`description` field (confirmed identical to
// the Kubernetes-no-grounding case in ManualRegression2026_06_08.test.mjs). So
// AWS (grounded only by an experience bullet, no matching project) selects just
// the bare skill name, while Redis (grounded by the RedisMart project) selects
// full project evidence. Grammar/phrasing of the final answer is now exclusively
// a downstream JIT-prompt-builder concern.
describe('skill-experience evidence selection reflects real grounding, not a bare one-liner', () => {
  test('"What\'s your experience with AWS?" selects only the bare skill name — an experience-entry bullet (no matching project) is not (yet) consulted for grounding at this layer', () => {
    const r = fast("What's your experience with AWS?");
    assert.ok(r);
    assert.equal(r.answer, undefined, 'Full-JIT policy: must not render a final answer string');
    assert.equal(r.answerType, 'skill_experience_answer');
    assert.ok(hasItem(r, 'skill.name', 'AWS'));
    assert.ok(!r.items.some((f) => f.field === 'skill.projects'), 'must not fabricate a project grounding');
    assert.ok(!JSON.stringify(r.items).match(/sub-80ms|pixel-streaming|EC2|Aetherbot/i), 'must not claim use at the ungrounded experience entry');
  });

  test('skill name evidence is properly cased (AWS, not "aws")', () => {
    const r = fast('Have you used AWS?');
    assert.ok(r);
    assert.ok(hasItem(r, 'skill.name', 'AWS'));
    assert.ok(!JSON.stringify(r.items).match(/\baws\b/), 'lowercase acronym must never appear in selected evidence');
  });

  test('"Have you worked with Redis in production-like settings?" selects the RedisMart project as grounding evidence', () => {
    const r = fast('Have you worked with Redis in production-like settings?');
    assert.ok(r);
    assert.equal(r.answer, undefined, 'Full-JIT policy: must not render a final answer string');
    assert.ok(hasItem(r, 'skill.projects', ['RedisMart']));
    assert.ok(r.items.some((f) => f.field === 'projects.0.description' && /caching|analytics|e-commerce/i.test(f.value)), 'must select the real project evidence');
  });

  test('"Have you used Redis?" selects the same RedisMart project evidence verbatim (grammar of the rendered answer is a JIT-prompt-builder concern, not testable at this layer)', () => {
    const r = fast('Have you used Redis?');
    assert.ok(r);
    assert.equal(r.answerType, 'skill_experience_answer');
    const desc = r.items.find((f) => f.field === 'projects.0.description');
    assert.ok(desc);
    assert.equal(desc.value, EVIN_PROFILE.projects[0].description, 'project description evidence must be selected byte-for-byte, not rewritten here');
  });

  test('an EXPERIENCE entry description phrased as a noun phrase is NOT consulted for grounding (only the bare skill name is selected — same as the AWS/Kubernetes cases)', () => {
    // The original fix guarded rendered-answer grammar for noun-phrase evidence.
    // Since findProfileSkill() never inspects experience-entry description/summary
    // text for grounding (confirmed via runtime probe), there is no experience
    // evidence to render ungrammatically in the first place — the fallback branch
    // this test used to exercise is unreachable at this layer.
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
    assert.equal(r.answer, undefined, 'Full-JIT policy: must not render a final answer string');
    assert.ok(hasItem(r, 'skill.name', 'Docker'));
    assert.ok(!JSON.stringify(r.items).match(/containerized|Beta Inc/i), 'must not fabricate grounding from the unlinked experience description');
  });

  test('an EXPERIENCE entry description phrased as a first-person bullet is likewise NOT consulted for grounding (same ungrounded-skill shape)', () => {
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
    assert.equal(r.answerType, 'skill_experience_answer');
    assert.ok(hasItem(r, 'skill.name', 'Kubernetes'));
    assert.ok(!JSON.stringify(r.items).match(/infrastructure automation|Gamma Inc/i), 'must not fabricate grounding from the unlinked experience description');
  });
});
