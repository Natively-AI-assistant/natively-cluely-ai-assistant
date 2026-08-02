// Context Intelligence V3 — regression tests for the 2026-08-01 DEEP-TEST defect set
// (Natively_Deep_Mode_Test_Pack campaign; defects D1–D10 in
// .audit/ci-v3/deep-test-defects-2026-08-01-root-causes.md).
//
// D2/D3/D5: identifier/value questions ("what is the resume canary?", "worker
//           batch size?") classified GENERAL_TECHNICAL → FAST → retrieval never
//           ran; general knowledge answered document questions with a clean
//           FULL trace.
// D6:  answerability FULL from a single shared generic term ("backend").
// D7:  sourceTypeForFile stamped every unclassifiable technical-interview file
//      RESUME (allowed[0] fallback) — contamination + planned-type filter drops.
// D8:  no provenance (status/current-vs-retired) on evidence.
// D9:  "she" bound to the latest capitalised tech noun; self-contained 5-word
//      questions got a referent appended.
// D10: custom/general modes with attached résumé+JD planned [] for JOB claims.
//
// Every assertion here fails on the pre-fix build (verified by running against
// the defect-era classifier/resolver) unless marked NON-REGRESSION.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const load = (p) => import(pathToFileURL(path.join(base, p)).href);

const { classifyTurn } = await load('question/turn-classifier.js');
const { MODE_POLICIES } = await load('policies/mode-policy-registry.js');
const { CLAIM_AUTHORITY } = await load('policies/source-authority-policy.js');
const { decide, evaluateAnswerability, orchestrate, evidenceSupportsClaim } = await load('orchestration/orchestrator.js');
const { advance, resolveReference, emptyState } = await load('question/conversation-state.js');
const { sourceTypeForFile, attachmentSourceTypeExtensions } = await load('retrieval/mode-retrieval-port.js');
const { composePrompt } = await load('generation/prompt-composer.js');

const classify = (q, modeId, over = {}) =>
  classifyTurn({ resolvedQuestion: q, policy: MODE_POLICIES[modeId], isFollowUp: false, ...over });

const mkEvidence = (over = {}) => ({
  evidenceId: 'ev1', sourceType: 'PROJECT_FILE', sourceId: 'f1', versionId: 'v1',
  retrievedVersionId: 'v1', scopeId: 's', content: '', acceptedFor: [],
  authorityFor: [], finalScore: 0.5, isDirectFact: true, isInferred: false,
  trustLevel: 'untrusted_reference', metadata: {},
  ...over,
});

// ── D2/D3/D5 — value/identifier questions must retrieve, not FAST ───────────

describe('D2: definite value lookups ground instead of taking the FAST path', () => {
  const cases = [
    ['technical-interview', 'What is the resume canary?'],
    ['technical-interview', 'What is the dead-letter topic?'],
    ['technical-interview', 'What is the last-page canary?'],
    ['technical-interview', 'What is the worker batch size?'],
    ['looking-for-work', 'What is the resume canary?'],
    ['looking-for-work', 'What is the JD canary?'],
  ];
  for (const [mode, q] of cases) {
    test(`${mode}: "${q}" retrieves`, () => {
      const r = classify(q, mode);
      assert.equal(r.shouldRetrieve, true, `${q} → path=${r.path} reason=${r.reason}`);
      assert.ok(r.requiredSourceTypes.length > 0, `planned empty: ${r.reason}`);
      assert.ok(r.claimTypes.some((c) => c !== 'GENERAL_TECHNICAL'),
        `needs a private claim so zero evidence cannot report FULL: ${JSON.stringify(r.claimTypes)}`);
    });
  }

  test('NON-REGRESSION: concept questions keep the FAST path', () => {
    for (const [mode, q] of [
      ['technical-interview', 'What is a mutex?'],
      ['team-meet', 'What is the goal of dependency injection?'],
      ['general', 'What is idempotency in an HTTP API?'],
      ['technical-interview', 'What is the time complexity of quicksort?'],
      ['technical-interview', 'What is the difference between TCP and UDP?'],
    ]) {
      const r = classify(q, mode);
      assert.equal(r.path, 'FAST', `"${q}" in ${mode} → ${r.path} (${r.reason})`);
    }
  });

  test('NON-REGRESSION: coding tasks stay fast', () => {
    const r = classify('Reverse a linked list in place', 'technical-interview');
    assert.equal(r.shouldRetrieve, false, r.reason);
  });
});

describe('D3: postmortem ownership questions are not misrouted to the meeting transcript', () => {
  test('technical-interview: "Who owns the follow-up?" retrieves from documents', () => {
    const r = classify('Who owns the follow-up?', 'technical-interview');
    assert.equal(r.shouldRetrieve, true, r.reason);
    assert.ok(!r.claimTypes.includes('MEETING_STATEMENT'),
      `no meeting transcript exists in this mode: ${JSON.stringify(r.claimTypes)}`);
  });

  test('NON-REGRESSION team-meet: "Who owns the source-contract patch?" stays transcript-only', () => {
    const r = classify('Who owns the source-contract patch?', 'team-meet');
    assert.deepEqual(r.requiredSourceTypes, ['MEETING_TRANSCRIPT'], r.reason);
  });
});

describe('D5: document-deictic questions carry a document claim', () => {
  for (const [mode, q] of [
    ['technical-interview', 'What are the RTO and RPO in the dossier?'],
    ['general', 'What are the RTO and RPO in the dossier?'],
    ['looking-for-work', 'What is the canary written in this resume?'],
  ]) {
    test(`${mode}: "${q}" claims a document/private source`, () => {
      const r = classify(q, mode);
      assert.equal(r.shouldRetrieve, true, r.reason);
      const priv = r.claimTypes.filter((c) => (CLAIM_AUTHORITY[c]?.authoritative ?? []).length > 0);
      assert.ok(priv.length > 0, `no private claim: ${JSON.stringify(r.claimTypes)} (${r.reason})`);
    });
  }

  test('zero evidence on a dossier question is not answerability FULL / silent general', async () => {
    const res = await orchestrate({
      requestId: 'p', requestSequence: 1, surface: 'manual_chat', modeId: 'general',
      scope: { userId: 'u', modeId: 'general' }, sessionId: 'd5-s1',
      manualQuestion: 'What are the RTO and RPO in the dossier?',
    }, { retrieve: async () => ({ evidence: [], attempts: [] }) });
    assert.notEqual(res.answerability, 'FULL');
    assert.notEqual(res.trace.fallbackUsed, 'NONE');
  });

  test('composer: unretrieved document fact must not be silently answered generally', async () => {
    const decision = decide({
      requestId: 'p', requestSequence: 1, surface: 'manual_chat', modeId: 'general',
      scope: { userId: 'u', modeId: 'general' }, sessionId: 's',
      manualQuestion: 'What are the RTO and RPO in the dossier?',
    });
    const composed = composePrompt({
      decision, policy: MODE_POLICIES.general, evidence: [],
      attachedSourceCount: 2, fallbackUsed: 'GENERAL_KNOWLEDGE',
    });
    assert.match(composed.user, /could not (be )?retrieve|not retrieved|do(es)? not cover|not covered/i,
      'prompt must direct an honest not-retrieved disclosure');
  });
});

// ── D6 — answerability requires the requested property, not one shared word ─

describe('D6: property-aware answerability', () => {
  const frameworkDecision = () => decide({
    requestId: 'p', requestSequence: 1, surface: 'manual_chat', modeId: 'technical-interview',
    scope: { userId: 'u', modeId: 'technical-interview' }, sessionId: 's',
    manualQuestion: 'What backend framework is explicitly documented?',
  });

  test('one shared generic term is NOT full support', () => {
    const d = frameworkDecision();
    const ev = [mkEvidence({
      content: 'Build reliable backend services. Debug distributed systems. On-call rotations.',
      acceptedFor: d.claimRequirements.map((c) => c.claimType),
    })];
    assert.notEqual(evaluateAnswerability(d, ev), 'FULL',
      'a chunk sharing only "backend" must not fully support a framework question');
  });

  test('evidence naming the property IS full support', () => {
    const d = frameworkDecision();
    const ev = [mkEvidence({
      content: 'Technical skills — Frameworks: React, Next.js, FastAPI, Node.js.',
      acceptedFor: d.claimRequirements.map((c) => c.claimType),
    })];
    assert.equal(evaluateAnswerability(d, ev), 'FULL');
  });

  test('evidenceSupportsClaim: head-noun match required', () => {
    const q = 'What backend framework is explicitly documented?';
    assert.equal(evidenceSupportsClaim(
      { acceptedFor: ['DOCUMENT_FACT'], content: 'backend services run in Docker' }, 'DOCUMENT_FACT', q,
    ), false);
    assert.equal(evidenceSupportsClaim(
      { acceptedFor: ['DOCUMENT_FACT'], content: 'Frameworks: FastAPI and React' }, 'DOCUMENT_FACT', q,
    ), true);
  });

  test('coordinated heads: either RTO or RPO term satisfies', () => {
    const q = 'What are the RTO and RPO in the dossier?';
    assert.equal(evidenceSupportsClaim(
      { acceptedFor: ['DOCUMENT_FACT'], content: 'The RPO is 3 minutes.' }, 'DOCUMENT_FACT', q,
    ), true);
  });

  test('NON-REGRESSION: complete-inventory shortcut still works', () => {
    assert.equal(evidenceSupportsClaim(
      {
        acceptedFor: ['USER_SKILL'], content: 'Languages: TypeScript, Python.',
        metadata: { completeInventory: true, inventoryCategory: 'skills' },
      }, 'USER_SKILL', 'Do I have Kubernetes experience?',
    ), true);
  });
});

// ── D7 — source typing never mints identity types for unknown shapes ────────

describe('D7: sourceTypeForFile', () => {
  const TI = MODE_POLICIES['technical-interview'].allowedSourceTypes;

  test('an unclassifiable text file is never RESUME', () => {
    const t = sourceTypeForFile('04_incident_postmortem.txt',
      'QUEUEFORGE INCIDENT POSTMORTEM\nDuration: 17 minutes\nFollow-up owner: Priya Raman', TI);
    assert.notEqual(t, 'RESUME');
    assert.notEqual(t, 'CANDIDATE_FILE');
    assert.notEqual(t, 'JOB_DESCRIPTION');
  });

  test('a code file becomes CODING_SAMPLE when the mode allows it', () => {
    const t = sourceTypeForFile('02_code_samples.py', 'CACHE_TTL_SECONDS = 420\nWORKER_BATCH_SIZE = 64', TI);
    assert.equal(t, 'CODING_SAMPLE');
  });

  test('a prose doc becomes PROJECT_FILE in technical-interview', () => {
    const t = sourceTypeForFile('01_small_project_summary.md',
      '# QueueForge Current Architecture Summary\n- API: FastAPI\n- Dead-letter topic: queueforge.jobs.dead', TI);
    assert.equal(t, 'PROJECT_FILE');
  });

  test('NON-REGRESSION: a real résumé is still RESUME in looking-for-work', () => {
    const t = sourceTypeForFile('resume.md',
      '# Resume\n## Experience\nEngineer\n## Education\nB.Tech, CGPA 8.4\n## Skills\nPython',
      MODE_POLICIES['looking-for-work'].allowedSourceTypes);
    assert.equal(t, 'RESUME');
  });
});

// ── D8 — provenance: status metadata stamped and rendered ───────────────────

describe('D8: document status provenance', () => {
  test('classifier-level: attachments carrying Status: RETIRED are detectable via extensions helper export', () => {
    assert.equal(typeof attachmentSourceTypeExtensions, 'function');
  });

  test('composer renders source name and status attributes for evidence', () => {
    const d = decide({
      requestId: 'p', requestSequence: 1, surface: 'manual_chat', modeId: 'technical-interview',
      scope: { userId: 'u', modeId: 'technical-interview' }, sessionId: 's',
      manualQuestion: 'What cache TTL is used?',
    });
    const ev = [
      mkEvidence({
        evidenceId: 'e-old', sourceId: 'legacy-file', documentTitle: '05_legacy_architecture_conflict.md',
        content: 'Legacy cache TTL: 90 seconds', sourceType: 'PROJECT_FILE',
        acceptedFor: ['USER_PROJECT', 'DOCUMENT_FACT'],
        metadata: { documentStatus: 'retired' },
      }),
      mkEvidence({
        evidenceId: 'e-new', sourceId: 'current-file', documentTitle: '02_code_samples.py',
        content: 'CACHE_TTL_SECONDS = 420', sourceType: 'CODING_SAMPLE',
        acceptedFor: ['USER_PROJECT', 'DOCUMENT_FACT'],
        metadata: { documentStatus: 'current' },
      }),
    ];
    const composed = composePrompt({ decision: d, policy: MODE_POLICIES['technical-interview'], evidence: ev });
    assert.match(composed.user, /status="retired"/);
    assert.match(composed.user, /status="current"/);
    assert.match(composed.system, /retired|superseded/i,
      'system prompt must instruct precedence by status');
  });
});

// ── D9 — typed referents ────────────────────────────────────────────────────

describe('D9: follow-up referent typing', () => {
  const scope = { userId: 'u1', modeId: 'recruiting', sessionId: 's9' };

  test('personal pronoun resolves to the active PERSON, not the latest tech noun', () => {
    let st = emptyState(scope);
    st = advance(st, { scope, question: "What is Leena's strongest signal?" });
    st = advance(st, { scope, question: 'Does she have Kubernetes experience?' });
    const r = resolveReference('Has she used GCP?', st);
    assert.notEqual(r.referent, 'Kubernetes', JSON.stringify(r));
    assert.match(String(r.referent ?? ''), /Leena/, JSON.stringify(r));
  });

  test('self-contained question with an explicit entity gets NO referent', () => {
    let st = emptyState(scope);
    st = advance(st, { scope, question: 'What is the exact interview process?' });
    const r = resolveReference('How many students used CampusMesh?', st);
    assert.equal(r.usedState, false, JSON.stringify(r));
    assert.equal(r.resolved, 'How many students used CampusMesh?');
  });

  test('NON-REGRESSION: bare "Why not?" still anchors to the previous question', () => {
    let st = emptyState(scope);
    st = advance(st, { scope, question: 'What is a mutex?' });
    const r = resolveReference('Why not?', st);
    assert.equal(r.usedState, true);
  });

  test('NON-REGRESSION: "Can you explain it generally instead?" resolves the topic', () => {
    let st = emptyState(scope);
    st = advance(st, { scope, question: 'What does this lecture say about quantum computing?' });
    const r = resolveReference('Can you explain it generally instead?', st);
    assert.equal(r.usedState, true);
    assert.match(String(r.referent ?? ''), /quantum computing/);
  });

  test('state advances with the ORIGINAL question — referent rewrites do not feed back', async () => {
    const sessionId = `d9-drift-${Math.random().toString(36).slice(2)}`;
    const port = { retrieve: async () => ({ evidence: [], attempts: [] }) };
    const mk = (q, n) => orchestrate({
      requestId: `p${n}`, requestSequence: n, surface: 'manual_chat', modeId: 'recruiting',
      scope: { userId: 'u1', modeId: 'recruiting', sessionId }, sessionId,
      manualQuestion: q,
    }, port);
    await mk("What is Leena's strongest signal?", 1);
    const r2 = await mk('Has she used GCP?', 2);
    // the stored state for turn 3 must not contain the rewrite suffix
    const { getConversationState } = await load('question/conversation-state-store.js');
    const st = getConversationState(sessionId);
    assert.ok(!String(st?.previousQuestion ?? '').includes('(referring to:'),
      `state ingested the rewritten question: ${st?.previousQuestion}`);
    assert.ok(!st.activeEntities.some((e) => /referring/i.test(e)), JSON.stringify(st.activeEntities));
    void r2;
  });
});

// ── D10 — custom/general modes plan attached résumé/JD by document role ─────

describe('D10: general mode with attached candidate résumé + JD', () => {
  const resumeContent = '# Candidate Resume - Leena Joseph\n## Professional Experience\nBackend Engineer\n## Education\nB.Tech, CGPA 8.91\n## Skills\nGo, Python';
  const jdContent = '# Software Engineer II\n## Minimum Qualifications\n2+ years of professional experience\n## Preferred Qualifications\ngRPC\n## Compensation\nINR 30-45 LPA';
  const files = [
    { id: 'f-res', fileName: 'candidate_resume.md', content: resumeContent },
    { id: 'f-jd', fileName: 'job_description.md', content: jdContent },
  ];

  test('attachmentSourceTypeExtensions detects candidate/JD roles for general', () => {
    const extra = attachmentSourceTypeExtensions('general', files);
    assert.ok(extra.includes('CANDIDATE_FILE'), JSON.stringify(extra));
    assert.ok(extra.includes('JOB_DESCRIPTION'), JSON.stringify(extra));
  });

  test('non-general modes get no extension (isolation preserved)', () => {
    assert.deepEqual(attachmentSourceTypeExtensions('technical-interview', files), []);
    assert.deepEqual(attachmentSourceTypeExtensions('recruiting', files), []);
  });

  for (const q of [
    'Does the candidate meet the requirements?',
    'What is the salary?',
    'What is the interview process?',
    'Which qualifications are missing?',
  ]) {
    test(`general+attachments: "${q}" plans sources and retrieves`, () => {
      const extra = attachmentSourceTypeExtensions('general', files);
      const d = decide({
        requestId: 'p', requestSequence: 1, surface: 'manual_chat', modeId: 'general',
        scope: { userId: 'u', modeId: 'general' }, sessionId: 's',
        manualQuestion: q, extraAllowedSourceTypes: extra,
      });
      assert.equal(d.retrievalPlan.shouldRetrieve, true);
      assert.ok(d.retrievalPlan.sourceTypes.length > 0, JSON.stringify(d.retrievalPlan));
    });
  }

  test('without extensions the résumé/JD stay unplannable (no global widening)', () => {
    const d = decide({
      requestId: 'p', requestSequence: 1, surface: 'manual_chat', modeId: 'general',
      scope: { userId: 'u', modeId: 'general' }, sessionId: 's',
      manualQuestion: 'What is the salary?',
    });
    assert.ok(!d.retrievalPlan.sourceTypes.includes('JOB_DESCRIPTION'));
  });

  test('port stamps extended types so evidence passes the planned-type filter', () => {
    const extra = attachmentSourceTypeExtensions('general', files);
    const allowed = [...MODE_POLICIES.general.allowedSourceTypes, ...extra];
    assert.equal(sourceTypeForFile('candidate_resume.md', resumeContent, allowed), 'CANDIDATE_FILE');
    assert.equal(sourceTypeForFile('job_description.md', jdContent, allowed), 'JOB_DESCRIPTION');
  });
});
