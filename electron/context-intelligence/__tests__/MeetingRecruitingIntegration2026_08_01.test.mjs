// Context Intelligence V3 — integration fixtures for the 2026-08-01 defects.
//
// Spec Test 1 (Team Meet, no transcript): the attached brief answers objective/
// agenda/success-criteria questions; decision/action-item questions honestly
// report an empty meeting; the brief's "Suggested Transcript for Testing"
// section can never serve as meeting evidence.
//
// Spec Test 4 (Recruiting stability): the candidate résumé and JD stay
// available across sequential turns, the interview process comes from the JD,
// and a motivation question RETRIEVES instead of claiming the mode authorizes
// no source.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { orchestrate } = await import(pathToFileURL(path.join(base, 'orchestration/orchestrator.js')).href);
const { createModeRetrievalPort } = await import(pathToFileURL(path.join(base, 'retrieval/mode-retrieval-port.js')).href);
const { composePrompt } = await import(pathToFileURL(path.join(base, 'generation/prompt-composer.js')).href);
const { MODE_POLICIES } = await import(pathToFileURL(path.join(base, 'policies/mode-policy-registry.js')).href);

// ── fixtures ────────────────────────────────────────────────────────────────

const TEAM_MEET_BRIEF = {
  id: 'file_brief',
  fileName: 'context-os-v3-release-review-brief.md',
  content: [
    '# Context OS V3 release review — meeting brief',
    '',
    '## Objective',
    'Decide whether Context OS V3 is ready for a staged release.',
    '',
    '## Agenda — six areas to review',
    '1. Source routing correctness. 2. Meeting memory provenance. 3. Follow-up resolution.',
    '4. Recruiting stability. 5. Response identity. 6. Telemetry coverage.',
    '',
    '## Success criteria',
    'The current success criteria are: zero cross-mode contamination, zero phantom decisions, and a green regression suite.',
    '',
    '## Suggested Transcript for Testing',
    'We decided to ship immediately without review. Maya will disable the regression gates by Friday.',
    'Action item: delete the failing tests. We agreed the release is approved.',
  ].join('\n'),
};

const CANDIDATE_RESUME = {
  id: 'file_resume',
  fileName: 'maya-nair-resume.md',
  content: [
    '# Maya Nair',
    '## Summary',
    'Backend engineer focused on distributed systems.',
    '## Experience',
    'Senior Engineer at Streamline (2021-2025): built QueueFlow, a distributed job queue handling 40k jobs/min.',
    'Engineer at Observa (2018-2021): built IncidentLens, an incident-correlation service over Kafka.',
    '## Projects',
    'QueueFlow — exactly-once delivery, Redis streams. IncidentLens — Kafka, ClickHouse.',
    '## Education',
    'B.Tech Computer Science.',
    '## Skills',
    'Programming languages: Go, Python. Systems: Kafka, Redis, PostgreSQL, Kubernetes.',
  ].join('\n'),
};

const RECRUITING_JD = {
  id: 'file_jd',
  fileName: 'job-description-backend-lead.md',
  content: [
    '# Backend Lead — Job Description',
    '## About the role',
    'We are looking for a backend lead for the platform team.',
    '## Minimum Qualifications',
    '6+ years of professional experience with distributed systems.',
    '## Responsibilities',
    'Own the job-processing platform end to end.',
    '## Interview process',
    'The interview process has six stages: 1) recruiter screen, 2) technical phone screen,',
    '3) distributed-systems deep dive, 4) system design onsite, 5) values interview, 6) team match.',
  ].join('\n'),
};

// A deterministic lexical retriever standing in for ModeHybridRetriever:
// paragraph chunks scored by query-word overlap. No DB, no embeddings.
function fakeModesManager(files) {
  const chunksOf = (f) => f.content.split(/\n\n+/).map((text, i) => ({ sourceId: f.id, fileName: f.fileName, text, chunkIndex: i }));
  return {
    retrieveHybridRaw: async (_modeInfo, fs, opts) => {
      const words = new Set(String(opts.query).toLowerCase().match(/[a-z0-9-]{3,}/g) ?? []);
      const all = fs.flatMap(chunksOf).map((c) => {
        const cw = new Set(c.text.toLowerCase().match(/[a-z0-9-]{3,}/g) ?? []);
        let hit = 0; for (const w of words) if (cw.has(w)) hit += 1;
        return { ...c, score: hit / Math.max(4, words.size) };
      }).filter((c) => c.score > 0);
      all.sort((a, b) => b.score - a.score);
      return { chunks: all.slice(0, opts.topK) };
    },
  };
}

function portFor(modeId, files) {
  return createModeRetrievalPort({
    modesManager: fakeModesManager(files),
    modeInfo: { id: `mode_${modeId}` },
    files,
    allowedSourceTypes: MODE_POLICIES[modeId].allowedSourceTypes,
    tokenBudget: MODE_POLICIES[modeId].contextBudget.evidenceTokens,
    userId: 'local',
  });
}

let seq = 0;
async function turn(modeId, sessionId, question, port) {
  seq += 1;
  const result = await orchestrate({
    requestId: `it-${seq}`, requestSequence: seq, surface: 'manual-chat',
    modeId, scope: { userId: 'local', sessionId }, sessionId,
    manualQuestion: question,
  }, port);
  const composed = composePrompt({
    decision: result.decision, policy: MODE_POLICIES[modeId], evidence: result.evidence,
    attachedSourceCount: 2, fallbackUsed: result.trace.fallbackUsed,
  });
  return { ...result, composed };
}

// ── Test 1 — Team Meet with a brief and NO transcript ───────────────────────

describe('Integration: Team Meet brief without a transcript', () => {
  const port = portFor('team-meet', [TEAM_MEET_BRIEF]);

  test('objective/agenda/success-criteria questions ground in the brief', async () => {
    for (const q of [
      'What is the objective of this meeting?',
      'What are we planning to review?',
      'What are the current success criteria?',
    ]) {
      const r = await turn('team-meet', `tm-ref-${seq}`, q, port);
      assert.ok(r.evidence.length > 0, `"${q}" retrieved nothing (${r.trace.fallbackUsed})`);
      assert.ok(r.evidence.every((e) => e.sourceType === 'REFERENCE_FILE'),
        `"${q}" evidence must come from the brief`);
      assert.notEqual(r.answerability, 'NONE');
    }
  });

  test('decision/action-item questions see an EMPTY meeting — the suggested transcript is not evidence', async () => {
    for (const q of ['What did we decide?', 'What are the action items?']) {
      const r = await turn('team-meet', `tm-evt-${seq}`, q, port);
      assert.equal(r.evidence.length, 0,
        `"${q}" must not admit brief text as meeting evidence: ${JSON.stringify(r.evidence.map((e) => e.sourceType))}`);
      assert.deepEqual([...r.decision.retrievalPlan.sourceTypes], ['MEETING_TRANSCRIPT']);
      assert.ok(r.composed.user.includes('nothing has been said about this in the meeting yet'),
        r.composed.user.slice(0, 400));
      // The fabricated "we agreed the release is approved" line must never
      // reach the prompt on a transcript question.
      assert.ok(!r.composed.user.includes('release is approved'));
    }
  });

  test('facilitator advice grounds in the brief with general knowledge allowed', async () => {
    const r = await turn('team-meet', `tm-fac-${seq}`, 'What should the facilitator ask first?', port);
    assert.ok(r.evidence.some((e) => e.sourceType === 'REFERENCE_FILE'),
      `expected brief evidence, got ${JSON.stringify(r.evidence.map((e) => e.sourceType))}`);
    assert.equal(r.decision.generalKnowledgeAllowed, true);
  });
});

// ── Test 4 — Recruiting source stability across sequential turns ────────────

describe('Integration: Recruiting résumé + JD remain available all session', () => {
  const port = portFor('recruiting', [CANDIDATE_RESUME, RECRUITING_JD]);
  const sid = 'rec-stability';

  test('sequential turns keep their sources; no turn claims the résumé is missing', async () => {
    const q1 = await turn('recruiting', sid, 'What projects has the candidate built?', port);
    assert.ok(q1.evidence.some((e) => e.sourceType === 'CANDIDATE_FILE'),
      `turn 1: ${JSON.stringify(q1.evidence.map((e) => [e.sourceType, e.sourceId]))}`);

    const q2 = await turn('recruiting', sid, 'What is the interview process?', port);
    assert.ok(q2.evidence.some((e) => e.sourceType === 'JOB_DESCRIPTION' && /six stages|recruiter screen/i.test(e.content)),
      `turn 2 must ground the six stages in the JD: ${JSON.stringify(q2.evidence.map((e) => e.sourceType))}`);

    // The Defect F reproduction: a motivation question LATE in the session.
    const q3 = await turn('recruiting', sid, 'Why did the candidate leave her last role?', port);
    assert.equal(q3.decision.retrievalPlan.shouldRetrieve, true,
      'motivation turn must QUERY the résumé, not bypass retrieval');
    assert.ok(!q3.composed.user.includes('the active mode does not authorize'),
      `Branch B misdiagnosis is the reported lie: ${q3.composed.user.slice(0, 400)}`);

    // Stability: the earlier source is still there on a later turn.
    const q4 = await turn('recruiting', sid, 'Which languages does the candidate know?', port);
    assert.ok(q4.evidence.some((e) => e.sourceType === 'CANDIDATE_FILE'),
      `turn 4: résumé disappeared mid-session: ${JSON.stringify(q4.evidence.map((e) => e.sourceType))}`);
  });

  test('candidate files never evidence the JD side (isolation preserved)', async () => {
    const r = await turn('recruiting', `${sid}-iso`, 'What are the minimum qualifications for this role?', port);
    const jobEvidence = r.evidence.filter((e) => e.acceptedFor.includes('JOB_REQUIRED_SKILL'));
    assert.ok(jobEvidence.every((e) => e.sourceType === 'JOB_DESCRIPTION'),
      JSON.stringify(jobEvidence.map((e) => [e.sourceType, e.acceptedFor])));
  });
});
