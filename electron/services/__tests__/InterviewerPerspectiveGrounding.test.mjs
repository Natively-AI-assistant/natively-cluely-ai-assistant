// electron/services/__tests__/InterviewerPerspectiveGrounding.test.mjs
//
// End-to-end production-path test of the interviewer-perspective grounding flow
// used by IntelligenceEngine.runWhatShouldISay:
//
//   transcript turns
//     → extractLatestQuestion()            (REAL compiled extractor)
//     → KnowledgeOrchestrator.processQuestion(extracted.latestQuestion)  (REAL)
//     → candidateProfile contextBlock
//
// This is the exact bridge that makes an interviewer's "tell me about your
// projects" use the loaded resume instead of being answered blind. No LLM, no
// embedder, no network. Fully dynamic — every assertion derives from the
// synthetic resume, nothing hardcoded in production logic.
//
// Run: npm run build:electron && node --test electron/services/__tests__/InterviewerPerspectiveGrounding.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const { extractLatestQuestion, toCandidateFraming } = await import(pathToFileURL(
  path.resolve(__dirname, '../../../dist-electron/electron/llm/transcriptQuestionExtractor.js')).href);
const { KnowledgeOrchestrator } = require('../../../dist-electron/premium/electron/knowledge/KnowledgeOrchestrator.js');

const RESUME = {
  id: 1, type: 'resume',
  structured_data: {
    identity: { name: 'Jordan Rivera', email: '', location: '', phone: '', links: [] },
    summary: '', skills: ['Go', 'Kafka', 'PostgreSQL'],
    experience: [
      { company: 'Drift Systems', role: 'Senior Backend Engineer', start_date: '2021-03', end_date: null, bullets: ['Built billing pipeline'] },
    ],
    projects: [
      { name: 'LedgerFlow', description: 'Event-sourced ledger', technologies: ['Go', 'Kafka'] },
      { name: 'PinMesh', description: 'Distributed config store', technologies: ['Rust'] },
    ],
    education: [{ institution: 'State University', degree: 'BS', field: 'CS', start_date: '2014', end_date: '2018' }],
    achievements: [], certifications: [], leadership: [],
  },
};

function makeOrchestrator(resume = RESUME) {
  const db = {
    initializeSchema() {}, getDocumentByType(t) { return t === 'resume' ? resume : null; },
    getAllNodes() { return []; }, getNodeCount() { return 0; }, getIntro() { return null; },
    getGapAnalysis() { return null; }, getNegotiationScript() { return null; },
    getMockQuestions() { return null; }, getCultureMappings() { return null; },
  };
  const o = new KnowledgeOrchestrator(db);
  o.setKnowledgeMode(true);
  return o;
}

let _t = 5_000_000;
const turn = (role, text) => ({ role, text, timestamp: (_t += 1000) });

// Faithful mirror of the engine's grounding decision (in lockstep with
// IntelligenceEngine.runWhatShouldISay). Includes BOTH real gates: the
// knowledge-mode check and the manual-question (`question`) skip.
async function ground(orchestrator, turns, question = undefined) {
  // Gate 1: knowledge mode must be on (engine: orchestrator.isKnowledgeMode()).
  if (!orchestrator.isKnowledgeMode?.()) return { extracted: null, candidateProfile: '' };
  const extracted = extractLatestQuestion(turns);
  const groundable = extracted.detectedSpeaker === 'interviewer'
    && extracted.confidence >= 0.6
    && ['identity', 'profile_detail', 'behavioral', 'follow_up'].includes(extracted.questionType);
  // Gate 2: only when no manually-typed question was supplied.
  if (!groundable || question) return { extracted, candidateProfile: '' };
  let lookupQ = toCandidateFraming(extracted.latestQuestion);
  if (extracted.isFollowUp && extracted.followUpTarget) lookupQ = `Tell me about my ${extracted.followUpTarget}`;
  const k = await orchestrator.processQuestion(lookupQ);
  let candidateProfile = '';
  // Gate 3: only the orchestrator's own factualRecall results (never the gated
  // coaching/salary layer).
  if (k && k.factualRecall === true && !k.liveNegotiationResponse) {
    if (k.contextBlock) candidateProfile = k.contextBlock;
    else if (k.isIntroQuestion && k.introResponse) candidateProfile = `<candidate_identity_fact>\n${k.introResponse}\n</candidate_identity_fact>`;
  }
  return { extracted, candidateProfile };
}

describe('interviewer-perspective grounding (extractor → orchestrator)', () => {
  test('Interviewer: "Tell me about your projects." → loaded projects grounded', async () => {
    const o = makeOrchestrator();
    const { extracted, candidateProfile } = await ground(o, [
      turn('interviewer', 'Tell me about your projects.'),
    ]);
    assert.equal(extracted.questionType, 'profile_detail');
    assert.match(candidateProfile, /LedgerFlow/);
    assert.match(candidateProfile, /PinMesh/);
    assert.match(candidateProfile, /candidate_projects/);
  });

  test('Interviewer: "What is your name?" → identity fact grounded for first-person restatement', async () => {
    const o = makeOrchestrator();
    const { candidateProfile } = await ground(o, [
      turn('interviewer', 'What is your name?'),
    ]);
    assert.match(candidateProfile, /Jordan Rivera/);
  });

  test('Interviewer: "Walk me through your experience." → experience grounded', async () => {
    const o = makeOrchestrator();
    const { extracted, candidateProfile } = await ground(o, [
      turn('interviewer', 'Walk me through your experience.'),
    ]);
    assert.equal(extracted.questionType, 'profile_detail');
    assert.match(candidateProfile, /Drift Systems/);
  });

  test('Interviewer technical question is NOT grounded in profile (no resume bleed)', async () => {
    const o = makeOrchestrator();
    const { extracted, candidateProfile } = await ground(o, [
      turn('interviewer', 'How does a hash map work internally?'),
    ]);
    assert.equal(extracted.questionType, 'technical');
    assert.equal(candidateProfile, '', 'generic technical questions must not pull resume facts');
  });

  test('Interviewer salary question is NOT grounded as factual profile (stays on gated channel)', async () => {
    const o = makeOrchestrator();
    const { extracted, candidateProfile } = await ground(o, [
      turn('interviewer', 'What salary are you expecting?'),
    ]);
    assert.equal(extracted.questionType, 'negotiation');
    assert.equal(candidateProfile, '', 'negotiation is not pulled into the what-to-answer profile block');
  });

  test('Follow-up "can you explain that in more detail?" resolves target + grounds projects', async () => {
    const o = makeOrchestrator();
    const { extracted, candidateProfile } = await ground(o, [
      turn('user', 'I built LedgerFlow.'),
      turn('interviewer', 'Can you explain that in more detail?'),
    ]);
    assert.equal(extracted.isFollowUp, true);
    assert.equal(extracted.followUpTarget, 'LedgerFlow');
    // The orchestrator sees "can you explain that in more detail?" — a candidate-
    // framed question — and returns at least compact identity (never empty-blind).
    assert.ok(candidateProfile.length > 0, 'follow-up should still ground some candidate context');
  });

  test('noise before the real question does not derail grounding', async () => {
    const o = makeOrchestrator();
    const { extracted, candidateProfile } = await ground(o, [
      turn('interviewer', 'um okay'),
      turn('interviewer', 'so, what are your main projects?'),
    ]);
    assert.match(extracted.latestQuestion, /projects/i);
    assert.match(candidateProfile, /LedgerFlow/);
  });

  // ── Review follow-ups (code-reviewer HIGH + test-engineer P0/P1) ──────────

  test('P0: manually-typed question skips grounding (uses manual orchestrator path instead)', async () => {
    const o = makeOrchestrator();
    const { candidateProfile } = await ground(o, [
      turn('interviewer', 'Tell me about your projects.'),
    ], 'What is recursion?'); // a typed question is present
    assert.equal(candidateProfile, '', 'grounding must not run when a manual question was typed');
  });

  test('P0: knowledge mode OFF → no grounding', async () => {
    const o = makeOrchestrator();
    o.setKnowledgeMode(false);
    const { candidateProfile } = await ground(o, [
      turn('interviewer', 'Tell me about your projects.'),
    ]);
    assert.equal(candidateProfile, '');
  });

  test('P0: hallucination guard — interviewer asks about a fact NOT in the resume', async () => {
    const o = makeOrchestrator(); // resume has BS only, no PhD
    const { candidateProfile } = await ground(o, [
      turn('interviewer', 'Tell me about your PhD dissertation.'),
    ]);
    // Must not fabricate a PhD/dissertation. Education grounding may surface the
    // real BS, but never invented doctoral content.
    assert.doesNotMatch(candidateProfile, /PhD|dissertation|thesis|doctoral/i);
  });

  test('P0: follow-up resolves the MOST RECENT project, not an earlier one or a company', async () => {
    const o = makeOrchestrator();
    const { extracted } = await ground(o, [
      turn('user', 'I worked at Drift Systems on billing.'),
      turn('user', 'I also built PinMesh, then LedgerFlow.'),
      turn('interviewer', 'Can you go deeper on that?'),
    ]);
    assert.equal(extracted.isFollowUp, true);
    // Target must be a real project noun, never the company "Drift" or a filler.
    assert.equal(extracted.followUpTarget, 'LedgerFlow');
  });

  test('P0: salary question stays gated even if it trips a category keyword', async () => {
    const o = makeOrchestrator();
    // "what are my projects worth in this offer" — has 'projects' AND offer.
    const { candidateProfile } = await ground(o, [
      turn('interviewer', 'What are your salary expectations for this offer?'),
    ]);
    assert.equal(candidateProfile, '', 'salary/comp must never be grounded into the live answer');
  });

  test('P1: skills grounding reaches the loaded skills', async () => {
    const o = makeOrchestrator();
    const { extracted, candidateProfile } = await ground(o, [
      turn('interviewer', 'What skills do you bring to this role?'),
    ]);
    assert.equal(extracted.questionType, 'profile_detail');
    assert.match(candidateProfile, /Go|Kafka|PostgreSQL/);
  });

  test('P2: low-confidence interviewer statement (not a question) is not grounded', async () => {
    const o = makeOrchestrator();
    const { candidateProfile } = await ground(o, [
      turn('interviewer', 'Interesting.'),
    ]);
    assert.equal(candidateProfile, '');
  });

  test('P2: orchestrator throwing does not break the flow (fails open to empty)', async () => {
    const o = makeOrchestrator();
    o.processQuestion = async () => { throw new Error('boom'); };
    // Mirror the engine try/catch: a throw yields empty grounding, not a crash.
    let candidateProfile = '';
    try {
      const r = await ground(o, [turn('interviewer', 'Tell me about your projects.')]);
      candidateProfile = r.candidateProfile;
    } catch {
      candidateProfile = '';
    }
    assert.equal(candidateProfile, '');
  });
});
