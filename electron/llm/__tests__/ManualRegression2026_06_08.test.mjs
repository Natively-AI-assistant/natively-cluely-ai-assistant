// electron/llm/__tests__/ManualRegression2026_06_08.test.mjs
//
// Release 2026-06-08 — the REAL manual-send regression the user hit:
//   "who are you?" / "what is your name?" → "I'm Natively, an AI assistant." (WRONG)
//   skill questions → "Yes, X is one of the skills I work with." (too weak)
//   non-fast-path candidate questions → the generic self-intro (collapse)
// These tests pin the fixed deterministic manual fast-path behavior (profile-loaded).
//
// Since the Full-JIT policy (2026-07-07/08, commit 6e6189b4), this deterministic
// logic no longer renders a final `.answer` string — it SELECTS structured evidence
// (`items`/`selectedProjects`/etc.) for a downstream JIT prompt to phrase. Rewritten
// 2026-07-23 to assert against that evidence-selection shape instead of the old
// rendered-string contract. Ground truth captured via a runtime probe against the
// compiled module (not guessed) before rewriting.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { tryBuildManualProfileFastPathAnswer, isAssistantIdentityQuestion } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/manualProfileIntelligence.js')).href
);

// A loaded candidate profile (synthetic — never Evin-specific hardcoding).
const PROFILE = {
  identity: { name: 'Asha Rao' },
  name: 'Asha Rao',
  skills: ['Python', 'SQL', 'FastAPI', 'React'],
  experience: [{ role: 'Backend Engineer', company: 'DataForge' }],
  projects: [{ name: 'MetricFlow', description: 'a real-time analytics pipeline', technologies: ['Python', 'FastAPI'] }],
};
const fast = (q, profile = PROFILE) => tryBuildManualProfileFastPathAnswer({ question: q, profile, jobDescription: null, source: 'manual_input' });

const hasItem = (r, field, value) => r.items.some((f) => f.field === field && (value === undefined || JSON.stringify(f.value) === JSON.stringify(value)));

describe('Manual identity — candidate first-person, never "I\'m Natively"', () => {
  for (const q of ['who are you?', 'what is your name?', 'what should I call you?']) {
    test(`"${q}" → selects the candidate's own identity as evidence, no assistant identity`, () => {
      const r = fast(q);
      assert.ok(r, 'must fast-path');
      assert.equal(r.answer, undefined, 'Full-JIT policy: must not render a final answer string');
      assert.equal(r.answerType, 'identity_answer');
      assert.ok(hasItem(r, 'identity.name', 'Asha Rao'));
      assert.ok(!r.excludedContextLayers.includes('stable_identity'));
      assert.ok(r.excludedContextLayers.includes('assistant_identity'), 'must exclude the assistant\'s own identity');
    });
  }
  test('"introduce yourself" → selects identity + experience + project + skills evidence', () => {
    const r = fast('introduce yourself');
    assert.ok(r);
    assert.equal(r.answerType, 'identity_answer');
    assert.ok(hasItem(r, 'identity.name', 'Asha Rao'));
    assert.ok(hasItem(r, 'experience.0.role', 'Backend Engineer'));
    assert.ok(hasItem(r, 'experience.0.company', 'DataForge'));
    assert.ok(hasItem(r, 'projects.0.name', 'MetricFlow'));
    assert.ok(hasItem(r, 'skills.summary', ['Python', 'SQL', 'FastAPI', 'React']));
    assert.ok(r.excludedContextLayers.includes('assistant_identity'));
  });
  test('a "my name" SELF-query also selects the candidate\'s identity evidence (no second-person framing exists at this layer — that\'s a JIT-prompt phrasing concern)', () => {
    const r = fast('what is my name?');
    assert.ok(r);
    assert.equal(r.answerType, 'identity_answer');
    assert.ok(hasItem(r, 'identity.name', 'Asha Rao'));
  });
});

describe('Manual assistant-meta — answers about the app, NOT the candidate', () => {
  for (const q of ['are you an AI?', 'what is Natively?', 'who made Natively?', 'what model are you?']) {
    test(`"${q}" → bails to assistant path (fast-path returns null)`, () => {
      assert.equal(isAssistantIdentityQuestion(q), true);
      assert.equal(fast(q), null, 'assistant-meta must NOT be answered as the candidate');
    });
  }
});

describe('Manual skill-experience — real evidence, not "X is one of the skills"', () => {
  test('"How have you used Python?" → selects the skill plus its grounding project as evidence', () => {
    const r = fast('How have you used Python?');
    assert.ok(r);
    assert.equal(r.answer, undefined, 'Full-JIT policy: must not render a final answer string');
    assert.equal(r.answerType, 'skill_experience_answer');
    assert.ok(hasItem(r, 'skill.name', 'Python'));
    assert.ok(hasItem(r, 'skill.projects', ['MetricFlow']));
    assert.ok(hasItem(r, 'projects.0.name', 'MetricFlow'));
  });
  test('"Where have you used FastAPI?" → same evidence shape, keyed to FastAPI', () => {
    const r = fast('Where have you used FastAPI?');
    assert.ok(r);
    assert.equal(r.answerType, 'skill_experience_answer');
    assert.ok(hasItem(r, 'skill.name', 'FastAPI'));
    assert.ok(hasItem(r, 'skill.projects', ['MetricFlow']));
  });
  test('"Have you used FastAPI?" → identical evidence selection (no yes/no framing exists at this layer — that\'s a JIT-prompt phrasing concern)', () => {
    const r = fast('Have you used FastAPI?');
    assert.ok(r);
    assert.equal(r.answerType, 'skill_experience_answer');
    assert.ok(hasItem(r, 'skill.name', 'FastAPI'));
    assert.ok(hasItem(r, 'skill.projects', ['MetricFlow']));
  });
  test('a skill listed but with NO grounding project → evidence selection does NOT fabricate a role/project link (code-review HIGH)', () => {
    // Kubernetes is in skills but only a Frontend-Designer role with no project link → the
    // evidence layer must select ONLY the bare skill name, no skill.projects field, and no
    // trace of the unrelated role/company (that fabrication guard is what the old answer-level
    // "central to what I built at PixelCo" assertion was protecting against).
    const r = fast('How have you used Kubernetes?', {
      identity: { name: 'Asha Rao' }, name: 'Asha Rao', skills: ['Kubernetes', 'Python'],
      experience: [{ role: 'Frontend Designer', company: 'PixelCo' }], projects: [],
    });
    assert.ok(r);
    assert.equal(r.answerType, 'skill_experience_answer');
    assert.ok(hasItem(r, 'skill.name', 'Kubernetes'));
    assert.ok(!r.items.some((f) => f.field === 'skill.projects'), 'must not fabricate a project grounding');
    assert.ok(!JSON.stringify(r.items).match(/Frontend Designer|PixelCo/i), 'must not claim use at an unlinked role');
    assert.ok(!r.selectedExperiences || r.selectedExperiences.length === 0, 'must not select the unlinked role as evidence');
  });
  test('a skill NOT grounded by any project — an experience-entry description alone is not (yet) consulted for grounding at this layer', () => {
    // findProfileSkill() only checks profileProjects() technologies/description for grounding;
    // it does not inspect experience-entry `description` text. So this profile (skill backed
    // only by an experience description, no matching project) selects just the bare skill name,
    // same as the Kubernetes case above — confirmed via runtime probe, not assumed.
    const r = fast('How have you used Python?', {
      identity: { name: 'Asha Rao' }, name: 'Asha Rao', skills: ['Python'],
      experience: [{ role: 'Data Analyst', company: 'Acme', description: 'Used Python for analysis' }], projects: [],
    });
    assert.ok(r);
    assert.equal(r.answerType, 'skill_experience_answer');
    assert.ok(hasItem(r, 'skill.name', 'Python'));
    assert.ok(!r.items.some((f) => f.field === 'skill.projects'));
  });
});

describe('Manual non-intro questions do NOT collapse to the generic intro', () => {
  test('JD-fit / skill-rating / gap do not fast-path at all (they reach the contract-injected LLM)', () => {
    // These should NOT deterministically fast-path to any evidence selection — they defer
    // entirely to the contract-injected LLM in ipcHandlers.
    for (const q of ['Why should we hire you?', 'Rate your Python skills out of 10.', 'What gap do you have for this role?']) {
      assert.equal(fast(q), null, `"${q}" must not fast-path`);
    }
  });
});
