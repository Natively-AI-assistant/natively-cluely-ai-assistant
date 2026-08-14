// electron/services/__tests__/RouterInclusionBias.test.mjs
// Verifies the inclusion-bias routing in KnowledgeOrchestrator.processQuestion:
//   - clearly-generic questions → FULL bypass (null), clean factual answer
//   - candidate-directed questions → full retrieval/assembly path
//   - ambiguous questions (GENERAL intent, no framing, not generic) → COMPACT
//     identity injected in contextBlock (inclusion bias), heavy retrieval skipped
//   - compact identity is dynamic (any resume), self-labeled, XML-safe
// Replicates the decision logic; does not touch the DB or LLM.
// Run: node --test electron/services/__tests__/RouterInclusionBias.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// --- Mirror of the relevant predicates (kept in sync with IntentClassifier) ---
const CANDIDATE_REF_REGEX = /\b(you|your|yours|yourself|you've|you're|you'd|you'll|ya|we|our|ours|ourselves|us|me|my|mine|myself)\b/i;
const IDENTITY_DIRECT_PATTERNS = [
  'what is my name', 'who am i', 'what role am i', 'my current role',
];
const GENERIC_QUESTION_PATTERNS = [
  'what is a ', 'what is an ', 'what is the ', 'explain ', 'how does ',
  'how to ', 'implement a ', 'difference between ', 'write a function ',
];
function isGenericKnowledgeQuestion(q) {
  const x = q.toLowerCase().trim();
  if (CANDIDATE_REF_REGEX.test(x)) return false;
  if (IDENTITY_DIRECT_PATTERNS.some(p => x.includes(p))) return false;
  return GENERIC_QUESTION_PATTERNS.some(p => x.includes(p));
}
// Minimal intent stand-in: candidate-directed intents the router treats specially
function classifyIntentLite(q) {
  const x = q.toLowerCase();
  if (IDENTITY_DIRECT_PATTERNS.some(p => x.includes(p))) return 'INTRO';
  if (/\b(salary|compensation|negotiate|offer)\b/.test(x)) return 'NEGOTIATION';
  if (/\b(project|skill|experience|education)\b/.test(x)) return 'PROFILE_DETAIL';
  return 'GENERAL';
}

// --- Mirror of buildCompactIdentityBlock (production, dynamic from resume/JD) ---
function escapeXmlLite(s) {
  return s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] || c));
}
function buildCompactIdentityBlock(resume, jd) {
  if (!resume) return '';
  const name = resume.identity?.name?.trim();
  const latest = resume.experience?.[0];
  const facts = [];
  if (name) facts.push(`Name: ${escapeXmlLite(name)}`);
  if (latest?.role) facts.push(`Current role: ${escapeXmlLite(latest.role)}${latest.company ? ` at ${escapeXmlLite(latest.company)}` : ''}`);
  if (jd?.title) facts.push(`Target role: ${escapeXmlLite(jd.title)}${jd.company ? ` at ${escapeXmlLite(jd.company)}` : ''}`);
  if (facts.length === 0) return '';
  return `<candidate_identity>\n${facts.join('\n')}\n</candidate_identity>\n` +
    `The above identifies the user. If the question is about the user (their fit, their decisions, their situation), answer from it in first person. If the question is a generic/technical one, ignore this block and answer normally.`;
}

// --- Mirror of the routing decision in processQuestion ---
const CANDIDATE_DIRECTED = new Set(['INTRO', 'PROFILE_DETAIL', 'NEGOTIATION', 'COMPANY_RESEARCH']);
const CANDIDATE_FRAMING_REGEX = /\b(you|your|yours|yourself|you've|you're|you'd|you'll|we|our|ours|us|me|my|mine|myself)\b/i;

function route(question, resume, jd) {
  if (!resume) return { decision: 'bypass-no-resume' };
  const intent = classifyIntentLite(question);
  const hasFraming = CANDIDATE_FRAMING_REGEX.test(question);

  if (isGenericKnowledgeQuestion(question)) {
    return { decision: 'full-bypass', intent };
  }
  const isCandidateDirected = CANDIDATE_DIRECTED.has(intent) || hasFraming;
  if (!isCandidateDirected) {
    const block = buildCompactIdentityBlock(resume, jd);
    return block
      ? { decision: 'compact-identity', intent, contextBlock: block, systemPromptInjection: '' }
      : { decision: 'bypass-no-identity', intent };
  }
  return { decision: 'full-path', intent };
}

const RESUME = {
  identity: { name: 'Test Candidate' },
  experience: [{ role: 'Backend Engineer', company: 'ExampleCo' }],
};
const JD = { title: 'Senior Backend Engineer', company: 'TargetCorp' };

describe('inclusion bias: clearly-generic → full bypass', () => {
  for (const q of ['what is a binary search tree', 'explain the tcp handshake', 'how to reverse a linked list', 'write a function to sort an array']) {
    test(`"${q}" → full-bypass`, () => {
      assert.strictEqual(route(q, RESUME, JD).decision, 'full-bypass');
    });
  }
});

describe('inclusion bias: candidate-directed → full path', () => {
  for (const q of ['what is my name', 'tell me about my projects', 'how should i negotiate salary', 'what are your strongest skills']) {
    test(`"${q}" → full-path`, () => {
      assert.strictEqual(route(q, RESUME, JD).decision, 'full-path');
    });
  }
});

describe('inclusion bias: ambiguous → compact identity (the fix)', () => {
  // Not generic, GENERAL intent, no candidate framing — the false-skip risk bucket.
  for (const q of ['would taking this role be a smart move', 'is that a reasonable thing to prioritize', 'rate the seniority of this position']) {
    test(`"${q}" → compact-identity in contextBlock`, () => {
      const r = route(q, RESUME, JD);
      assert.strictEqual(r.decision, 'compact-identity', `expected compact-identity, got ${r.decision} (intent=${r.intent})`);
      assert.strictEqual(r.systemPromptInjection, '', 'must NOT replace the base system prompt');
      assert.match(r.contextBlock, /<candidate_identity>/, 'identity goes in contextBlock');
      assert.match(r.contextBlock, /Test Candidate/);
      assert.match(r.contextBlock, /Senior Backend Engineer at TargetCorp/);
    });
  }
});

describe('inclusion bias: guards & dynamism', () => {
  test('no resume → bypass even for ambiguous', () => {
    assert.strictEqual(route('would this be a good move', null, null).decision, 'bypass-no-resume');
  });

  test('compact identity is fully dynamic — works for any candidate (no hardcoding)', () => {
    const r1 = route('is this a good move', { identity: { name: 'Alice A' }, experience: [{ role: 'PM', company: 'Co1' }] }, { title: 'Director', company: 'Co2' });
    const r2 = route('is this a good move', { identity: { name: 'Bob B' }, experience: [{ role: 'SRE', company: 'Co3' }] }, { title: 'Staff SRE', company: 'Co4' });
    assert.match(r1.contextBlock, /Alice A/);
    assert.match(r1.contextBlock, /Director at Co2/);
    assert.match(r2.contextBlock, /Bob B/);
    assert.match(r2.contextBlock, /Staff SRE at Co4/);
  });

  test('compact identity escapes XML metacharacters in resume data', () => {
    const r = route('is this a good move', { identity: { name: 'A <script> B' }, experience: [{ role: 'Eng & Lead', company: 'X>Y' }] }, null);
    assert.match(r.contextBlock, /A &lt;script&gt; B/);
    assert.match(r.contextBlock, /Eng &amp; Lead/);
    assert.doesNotMatch(r.contextBlock, /<script>/);
  });

  test('resume-only (no JD) still injects identity without target role', () => {
    const r = route('is this a good move', RESUME, null);
    assert.strictEqual(r.decision, 'compact-identity');
    assert.match(r.contextBlock, /Backend Engineer at ExampleCo/);
    assert.doesNotMatch(r.contextBlock, /Target role/);
  });
});
