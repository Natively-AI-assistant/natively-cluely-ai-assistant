// electron/llm/__tests__/ManualRegression2026_06_08.test.mjs
//
// Release 2026-06-08 — the REAL manual-send regression the user hit:
//   "who are you?" / "what is your name?" -> "I'm OpenOffer, an AI assistant." (WRONG)
//   skill questions → "Yes, X is one of the skills I work with." (too weak)
//   non-fast-path candidate questions → the generic self-intro (collapse)
// These tests pin the fixed deterministic manual fast-path behavior (profile-loaded).

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

describe('Manual identity — candidate first-person, never "I\'m Natively"', () => {
  for (const q of ['who are you?', 'what is your name?', 'what should I call you?']) {
    test(`"${q}" → first-person candidate name, no assistant identity`, () => {
      const r = fast(q);
      assert.ok(r, 'must fast-path');
      assert.match(r.answer, /My name is Asha Rao/i);
      assert.doesNotMatch(r.answer, /I'?m Natively|AI assistant|Your name is/i);
    });
  }
  test('"introduce yourself" → first-person intro', () => {
    const r = fast('introduce yourself');
    assert.ok(r);
    assert.match(r.answer, /^I'?m Asha Rao|^My name is Asha Rao/i);
    assert.doesNotMatch(r.answer, /I'?m Natively|AI assistant/i);
  });
  test('a "my name" SELF-query stays second-person ("Your name is…")', () => {
    const r = fast('what is my name?');
    assert.ok(r);
    assert.match(r.answer, /Your name is Asha Rao/i);
  });
});

describe('Manual assistant-meta — answers about the app, NOT the candidate', () => {
  for (const q of ['are you an AI?', 'what is OpenOffer?', 'who made you?', 'what model are you?']) {
    test(`"${q}" → bails to assistant path (fast-path returns null)`, () => {
      assert.equal(isAssistantIdentityQuestion(q), true);
      assert.equal(fast(q), null, 'assistant-meta must NOT be answered as the candidate');
    });
  }
});

describe('Manual skill-experience — real evidence, not "X is one of the skills"', () => {
  test('"How have you used Python?" → where/how evidence', () => {
    const r = fast('How have you used Python?');
    assert.ok(r);
    assert.doesNotMatch(r.answer, /one of the skills I work with/i);
    assert.match(r.answer, /MetricFlow|DataForge|Backend Engineer/i);
    assert.match(r.answer, /\bI'?ve used\b/i);
  });
  test('"Where have you used FastAPI?" → a place/project', () => {
    const r = fast('Where have you used FastAPI?');
    assert.ok(r);
    assert.doesNotMatch(r.answer, /one of the skills I work with/i);
    assert.match(r.answer, /MetricFlow|DataForge/i);
  });
  test('"Have you used FastAPI?" → yes + evidence', () => {
    const r = fast('Have you used FastAPI?');
    assert.ok(r);
    assert.match(r.answer, /^Yes/i);
    assert.doesNotMatch(r.answer, /one of the skills I work with/i);
  });
  test('a skill listed but with NO grounding project/role → honest, NOT a fabricated role claim (code-review HIGH)', () => {
    // Kubernetes is in skills but only a Frontend-Designer role with no link → must NOT
    // assert "central to what I built at PixelCo" (falsifiable hallucination). Honest.
    const r = fast('How have you used Kubernetes?', {
      identity: { name: 'Asha Rao' }, name: 'Asha Rao', skills: ['Kubernetes', 'Python'],
      experience: [{ role: 'Frontend Designer', company: 'PixelCo' }], projects: [],
    });
    assert.ok(r);
    assert.doesNotMatch(r.answer, /one of the skills I work with/i);
    assert.doesNotMatch(r.answer, /central to what I built|core part of the work/i, 'must not fabricate role grounding');
    assert.doesNotMatch(r.answer, /Frontend Designer|PixelCo/i, 'must not claim use at an unlinked role');
    assert.match(r.answer, /part of my toolkit|isn'?t highlighted/i, 'honest fallback');
  });
  test('a skill grounded by an experience description IS credited to that role', () => {
    const r = fast('How have you used Python?', {
      identity: { name: 'Asha Rao' }, name: 'Asha Rao', skills: ['Python'],
      experience: [{ role: 'Data Analyst', company: 'Acme', description: 'Used Python for analysis' }], projects: [],
    });
    assert.ok(r);
    assert.match(r.answer, /Data Analyst|Acme/i, 'genuinely grounded role is credited');
  });
});

describe('Manual non-intro questions do NOT collapse to the generic intro', () => {
  test('JD-fit / skill-rating / gap do not fast-path to the self-intro (they reach the contract-injected LLM)', () => {
    // These should NOT return the deterministic intro text. They either fast-path to a
    // jd-fit/skill answer or return null (→ contract-injected LLM in ipcHandlers).
    for (const q of ['Why should we hire you?', 'Rate your Python skills out of 10.', 'What gap do you have for this role?']) {
      const r = fast(q);
      if (r) {
        assert.doesNotMatch(r.answer, /One project I'?m proud of is|I work mainly with/i, `"${q}" must not be the generic intro`);
      }
    }
  });
});
