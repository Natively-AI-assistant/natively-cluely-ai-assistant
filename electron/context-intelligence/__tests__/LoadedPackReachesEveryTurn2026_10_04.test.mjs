// A file of the mode handed over whole is not removed from the prompt by the claim-authority gate (2026-10-04).
//
// Measured on main with the evidence-rich benchmark (333 dev + counterfactual turns, every mode holding a realistic
// pack of 6–9 files that fits the prompt): the whole pack was in the prompt on 305 of them. The other 28:
//
//  (a) 16 turns, 14 of them in Recruiting: a file was removed by the CLAIM-AUTHORITY gate. On a heard Recruiting
//      turn the needed claims are about the candidate, and the mode's own hiring job description (typed
//      JOB_DESCRIPTION) cannot evidence those, so it was dropped from the pack, also when the candidate asked what
//      the role pays, how much travel it has, or whether they would carry the pager. The same file is in the prompt
//      on typed turns. The planned-type gate already admits a mode's own attachments; this one did not.
//  (b) 10 turns the classifier answers from general knowledge read nothing (a pack larger than a small corpus is
//      not read on such a turn). Measured and NOT landed: it cost about a point on the general turns that need no
//      document (evidence-rich benchmark, E8). Only (a) is in this change.
//
// What an item may SUPPORT is unchanged: acceptedFor and evidenceSupportsClaim still keep a job description from
// counting as support for a claim about the candidate or the user. Only its presence in the prompt changes, and
// only for a file of the mode that is handed over whole.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = (p) => import(pathToFileURL(path.resolve(process.cwd(), 'dist-electron/electron', p)).href);
const { orchestrate, decide, evidenceSupportsClaim } = await dist('context-intelligence/orchestration/orchestrator.js');
const { MODE_POLICIES } = await dist('context-intelligence/policies/mode-policy-registry.js');
const { createModeRetrievalPort, referenceCorpusTokens, isWholePackCorpus, sourceTypeForFile, WHOLE_PACK_MAX_TOKENS, SMALL_CORPUS_MAX_TOKENS } = await dist('context-intelligence/retrieval/mode-retrieval-port.js');

const filler = (n) => 'The quarterly review covered staffing, tooling and the support rota in the usual detail. '.repeat(n);

// A hiring pack: the role's job description, the candidate's résumé, and four reference documents.
const JD = { id: 'jd', fileName: 'Platform_Lead_JD.docx', content: `# Job description — Platform Lead\n\nRole: Platform Lead, Ledger Infrastructure\nCompensation range: $182,000 to $214,000 base.\n\n## Responsibilities\n\nLead a team of six. Travel: up to four planning weeks a year at the Tulsa office.\nOn call: the lead is secondary, one week in eight.\n\n## Requirements\n\n8+ years of professional experience building distributed systems.\n${filler(10)}` };
const RESUME = { id: 'cv', fileName: 'Dana_Whitlow_Resume.pdf', content: `Dana Whitlow\n\nSummary\nPlatform engineer.\n\nExperience\nStaff Engineer, Corvane Systems, 2019 to present. Led the migration of the billing reconciler.\n\nEducation\nBSc Computer Science, 2011.\n\nSkills\nGo, PostgreSQL, Kafka.\n${filler(10)}` };
const REFS = ['Process_Guide', 'Team_Brief', 'Benefits_Overview', 'Scorecard'].map((n, i) => ({ id: `r${i}`, fileName: `${n}.pdf`, content: `${n.replace(/_/g, ' ')}.\n${filler(14)}\nSection ${i} ends here.` }));
const HIRING_PACK = [JD, RESUME, ...REFS];
const REC = MODE_POLICIES.recruiting;

let seq = 0;
const req = (modeId, q, files, extra = {}) => ({
  requestId: `lp${++seq}`, requestSequence: seq, surface: 'what-to-answer', modeId, scope: { userId: 'local' },
  sessionId: `lp-${seq}`, transcriptQuestion: q, hasAttachedDocuments: true, attachedSourceCount: files.length,
  attachedFileNames: files.map((f) => f.fileName), attachedCorpusTokens: referenceCorpusTokens(files), ...extra,
});
const port = (modeId, files, calls = { n: 0 }) => createModeRetrievalPort({
  modesManager: { retrieveHybridRaw: async () => { calls.n++; return { chunks: files.map((f, i) => ({ sourceId: f.id, fileName: f.fileName, text: f.content.slice(0, 400), chunkIndex: i, score: 0.5 })) }; } },
  modeInfo: { id: 'm1' }, files, tokenBudget: 1800, userId: 'local', allowedSourceTypes: MODE_POLICIES[modeId].allowedSourceTypes,
});
const filesIn = (r) => new Set(r.evidence.filter((e) => e.provenance === 'MODE_REFERENCE_FILE').map((e) => e.sourceId));

describe('fixture', () => {
  test('the pack fits, is not small, and the shape detector types the JD and the résumé', () => {
    const t = referenceCorpusTokens(HIRING_PACK);
    assert.ok(t > SMALL_CORPUS_MAX_TOKENS && t <= WHOLE_PACK_MAX_TOKENS, String(t));
    assert.equal(isWholePackCorpus(HIRING_PACK), true);
    assert.equal(sourceTypeForFile(JD.fileName, JD.content, REC.allowedSourceTypes), 'JOB_DESCRIPTION');
    assert.equal(sourceTypeForFile(RESUME.fileName, RESUME.content, REC.allowedSourceTypes), 'CANDIDATE_FILE');
  });
});

describe('(a) a file of the mode handed over whole is not removed by the claim-authority gate', () => {
  for (const q of [
    'How much would I be on the road for this? I\'ve got two kids, so I need to know.',
    'Before we get too deep, can I just ask what this pays?',
    'Would I be carrying the pager myself, or is that more the team\'s thing?',
    'Tell me about the billing reconciler migration you led at Corvane.',
  ]) {
    test(`heard, Recruiting: "${q.slice(0, 48)}…" — every file of the pack is in the evidence`, async () => {
      const r = await orchestrate(req('recruiting', q, HIRING_PACK), port('recruiting', HIRING_PACK));
      assert.ok(r.decision.retrievalPlan.shouldRetrieve, 'fixture: the turn retrieves');
      assert.deepEqual([...filesIn(r)].sort(), HIRING_PACK.map((f) => f.id).sort());
      assert.ok(r.evidence.some((e) => e.sourceId === 'jd' && /up to four planning weeks a year/.test(e.content)), 'the job description, whole');
    });
  }

  test('what the job description may SUPPORT is unchanged: never a claim about the candidate', async () => {
    const r = await orchestrate(req('recruiting', 'Tell me about the billing reconciler migration you led at Corvane.', HIRING_PACK), port('recruiting', HIRING_PACK));
    const jd = r.evidence.find((e) => e.sourceId === 'jd');
    assert.ok(jd);
    assert.equal(jd.sourceType, 'JOB_DESCRIPTION');
    for (const claim of jd.acceptedFor) assert.ok(!/^(USER_|CANDIDATE_)/.test(claim), `the JD accepted for ${claim}`);
    for (const claim of ['CANDIDATE_EXPERIENCE', 'CANDIDATE_SKILL', 'USER_EMPLOYMENT', 'USER_SKILL']) {
      assert.equal(evidenceSupportsClaim(jd, claim, 'Has she led a migration?'), false, claim);
    }
  });

  test('a pack too large to hand over whole keeps the gate exactly as it was', async () => {
    const big = HIRING_PACK.map((f) => ({ ...f, content: f.content + filler(120) }));
    assert.equal(isWholePackCorpus(big), false);
    const q = 'Tell me about the billing reconciler migration you led at Corvane.';
    const r = await orchestrate(req('recruiting', q, big), port('recruiting', big));
    const needed = new Set(r.decision.claimRequirements.filter((c) => c.authority === 'PRIVATE_SOURCE_REQUIRED').map((c) => c.claimType));
    if (needed.size) for (const e of r.evidence.filter((x) => x.provenance === 'MODE_REFERENCE_FILE')) assert.ok(e.acceptedFor.some((c) => needed.has(c)), `${e.sourceId} kept without authority`);
  });
});
