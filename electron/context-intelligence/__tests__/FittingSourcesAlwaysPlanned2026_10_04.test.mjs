// What fits is read, whatever the plan named (2026-10-04, E16). See decide() in orchestrator.ts.
//
// Measured on the evidence-rich dev set: heard "How often are you carrying the
// pager these days, and what's the incident load like?" (Technical Interview)
// planned reference files, project files, coding samples, the job description
// and the meeting — not the résumé — and the answer gave another company's
// on-call checklist as the candidate's own rota. Typed "why am I leaving
// lumenquay" (Looking for work) planned PROFILE_FACT only and the user's own
// interview notes, the whole 2,254-token pack, were not read.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { decide } = await import(pathToFileURL(path.join(base, 'orchestration/orchestrator.js')).href);

const req = (extra) => ({ requestId: 'r', requestSequence: 1, scope: { userId: 'u' }, sessionId: 's', ...extra });
const PROFILE = { tokens: 3200, docs: 2 };
const PACK = { hasAttachedDocuments: true, attachedCorpusTokens: 2254, attachedSourceCount: 1, attachedFileNames: ['interview_notes.md'] };

describe('a turn that retrieves plans the whole profile and the whole pack when they fit', () => {
  test('Technical Interview, heard, a document-shaped question about the candidate: the résumé is planned', () => {
    const d = decide(req({ surface: 'what-to-answer', modeId: 'technical-interview', transcriptQuestion: "How often are you carrying the pager these days, and what's the incident load like?", ...PACK, profileWhole: PROFILE }));
    assert.equal(d.retrievalPlan.shouldRetrieve, true);
    assert.ok(d.retrievalPlan.sourceTypes.includes('RESUME'), JSON.stringify(d.retrievalPlan.sourceTypes));
    assert.ok(d.retrievalPlan.sourceTypes.includes('JOB_DESCRIPTION'));
    assert.ok(d.retrievalPlan.sourceTypes.includes('REFERENCE_FILE'));
    assert.equal(d.retrievalPlan.wholeProfile, true);
  });
  test('Looking for work, typed, a personal question: the pack (the user\'s own notes) is planned', () => {
    const d = decide(req({ surface: 'manual-chat', modeId: 'looking-for-work', manualQuestion: 'why am I leaving lumenquay - give me the short version I can say out loud', ...PACK, profileWhole: PROFILE }));
    assert.equal(d.retrievalPlan.shouldRetrieve, true);
    assert.ok(d.retrievalPlan.sourceTypes.includes('REFERENCE_FILE'), JSON.stringify(d.retrievalPlan.sourceTypes));
    assert.ok(d.retrievalPlan.sourceTypes.includes('RESUME'));
  });
});

describe('what it does not change', () => {
  test('a mode whose policy does not allow the résumé never plans it', () => {
    const d = decide(req({ surface: 'what-to-answer', modeId: 'sales', transcriptQuestion: 'What does the Operations plan cost per vehicle on annual billing?', ...PACK, profileWhole: PROFILE }));
    assert.ok(!d.retrievalPlan.sourceTypes.includes('RESUME'), JSON.stringify(d.retrievalPlan.sourceTypes));
  });
  test('a profile too large to hand over whole is not forced into the plan', () => {
    const d = decide(req({ surface: 'what-to-answer', modeId: 'technical-interview', transcriptQuestion: 'What does section 3 of the design brief say about read rate?', ...PACK, profileWhole: { tokens: 9000, docs: 2 } }));
    assert.notEqual(d.retrievalPlan.wholeProfile, true);
  });
  test('a turn that does not retrieve (a coding task) still plans nothing', () => {
    const d = decide(req({ surface: 'what-to-answer', modeId: 'technical-interview', transcriptQuestion: 'implement two sum in python and explain the complexity', profileWhole: PROFILE }));
    assert.ok(!d.retrievalPlan.sourceTypes.includes('RESUME'), JSON.stringify(d.retrievalPlan.sourceTypes));
  });
  test('no claim is added by the widening', () => {
    const a = decide(req({ surface: 'what-to-answer', modeId: 'technical-interview', transcriptQuestion: 'What does the design brief say the peak factor is?', ...PACK }));
    const b = decide(req({ surface: 'what-to-answer', modeId: 'technical-interview', transcriptQuestion: 'What does the design brief say the peak factor is?', ...PACK, profileWhole: PROFILE }));
    assert.deepEqual(b.requiredClaims ?? b.claimRequirements ?? null, a.requiredClaims ?? a.claimRequirements ?? null);
  });
});
