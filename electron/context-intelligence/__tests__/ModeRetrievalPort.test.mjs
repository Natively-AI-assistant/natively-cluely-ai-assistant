// Phase 6 — the shared mode-retrieval-port factory.
//
// Three surfaces construct the same fail-closed port (manual chat handler, WTA,
// runManualAnswer). The registry it declares decides what evidence a turn may
// see, and two inline copies of that construction is how the tokenizer copies
// drifted — so there is one factory, and this file pins its contract.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { createModeRetrievalPort } = await import(pathToFileURL(path.join(base, 'retrieval/mode-retrieval-port.js')).href);
const { decide } = await import(pathToFileURL(path.join(base, 'orchestration/orchestrator.js')).href);

const decision = decide({
  requestId: 'r1', requestSequence: 1, surface: 'what-to-answer',
  modeId: 'seminar', scope: { userId: 'local' }, sessionId: 's',
  manualQuestion: 'According to the document, what is the discount floor?',
});

const port = (chunks, files = [{ id: 'f1' }]) => createModeRetrievalPort({
  modesManager: { retrieveHybridRaw: async () => ({ chunks }) },
  modeInfo: { id: 'm1' }, files, tokenBudget: 3600, userId: 'local',
});

describe('mode retrieval port', () => {
  test('a declared file is admitted with full provenance', async () => {
    const r = await port([{ sourceId: 'f1', fileName: 'pricing.json', text: 'floor is 17 percent', chunkIndex: 0, score: 0.9 }])
      .retrieve({ decision });
    assert.equal(r.evidence.length, 1);
    const e = r.evidence[0];
    assert.equal(e.sourceType, 'REFERENCE_FILE');
    assert.equal(e.scopeId, 'u:local');
    assert.equal(e.versionId, 'legacy');
    assert.equal(e.retrievedVersionId, 'legacy');
  });

  test('fails CLOSED on a sourceId outside the declared file set', async () => {
    // A stale index row or another mode's file: under the old fail-open opt-ins
    // only the source-type lookup stood in the way. The factory declares
    // type, version AND scope per file precisely so this rejects.
    const r = await port([{ sourceId: 'ROGUE', text: 'leaked', chunkIndex: 0, score: 0.99 }])
      .retrieve({ decision });
    assert.equal(r.evidence.length, 0);
    assert.equal(r.attempts[0].rejections[0].reason, 'UNKNOWN_SOURCE_TYPE');
  });

  test('no mode / no files means no retrieval, not a throw', async () => {
    const p = createModeRetrievalPort({
      modesManager: { retrieveHybridRaw: async () => { throw new Error('must not be called'); } },
      modeInfo: null, files: [], tokenBudget: 3600, userId: 'local',
    });
    const r = await p.retrieve({ decision });
    assert.deepEqual(r.evidence, []);
  });

  test('a userId mismatch between port and turn rejects everything — the trap the factory exists to prevent', async () => {
    const p = createModeRetrievalPort({
      modesManager: { retrieveHybridRaw: async () => ({ chunks: [{ sourceId: 'f1', text: 'x', chunkIndex: 0, score: 0.9 }] }) },
      modeInfo: { id: 'm1' }, files: [{ id: 'f1' }], tokenBudget: 3600, userId: 'someone-else',
    });
    const r = await p.retrieve({ decision });
    assert.equal(r.evidence.length, 0, 'containment requires the SAME userId on registry and turn');
    assert.equal(r.attempts[0].rejections[0].reason, 'OUT_OF_SCOPE');
  });
});

// ── Regression: files must be TYPED, not all stamped REFERENCE_FILE ──────────
//
// Found by a live test run, not by the suite. The port stamped every mode file
// REFERENCE_FILE, so in Looking-for-Work a résumé was retrieved (2 candidates),
// admitted (2 admitted), and then discarded by claim authority because the turn
// authorized [RESUME, PROFILE_FACT] — ACCEPTED evidence 0. The user asked for
// their own CGPA and was told it "is not covered in the available evidence".
//
// Three modes were affected at once (Looking for Work, Technical Interview,
// Recruiting), which is why a single upstream cause was worth finding before
// treating them as separate defects.

const { sourceTypeForFile, classifyDocShape } = await import(
  pathToFileURL(path.join(base, 'retrieval/mode-retrieval-port.js')).href);

const RESUME_TEXT = `# Evin John\n## Summary\nEngineer...\n## Experience\n### Intern\n## Projects\n### Natively\n## Education\n**CGPA:** 7.5/10\n`;
const JD_TEXT = `# Software Engineer II — Google\n## Minimum Qualifications\n- 2+ years of professional experience\n## Preferred Qualifications\n## Responsibilities\n# About the Role\n## Compensation\n`;

describe('document typing', () => {
  test('shape is read from structure, not just the filename', () => {
    assert.equal(classifyDocShape('evinjohn_resume.md', RESUME_TEXT), 'resume');
    assert.equal(classifyDocShape('Google_SWE_II_JD.md', JD_TEXT), 'job_description');
    // A badly-named file must follow its content — this is the direction that
    // matters, because a JD misread as a résumé IS the contamination case.
    assert.equal(classifyDocShape('resume.md', JD_TEXT), 'job_description');
    assert.equal(classifyDocShape('thesis.pdf', 'Chapter 1 Introduction ...'), 'other');
  });

  test('the SAME résumé types differently per mode — the ownership mismatch', () => {
    // Looking for Work: it is the user's own.
    assert.equal(sourceTypeForFile('resume.md', RESUME_TEXT, ['RESUME', 'JOB_DESCRIPTION', 'PROFILE_FACT']), 'RESUME');
    // Recruiting: it is someone else's, and RESUME is not authorized there.
    assert.equal(sourceTypeForFile('resume.md', RESUME_TEXT, ['CANDIDATE_FILE', 'JOB_DESCRIPTION', 'REFERENCE_FILE']), 'CANDIDATE_FILE');
    // Seminar: neither is authorized, so it stays a plain reference file.
    assert.equal(sourceTypeForFile('resume.md', RESUME_TEXT, ['REFERENCE_FILE', 'MEETING_TRANSCRIPT']), 'REFERENCE_FILE');
  });

  test('never upgrades a file into a source the mode forbids', () => {
    assert.equal(sourceTypeForFile('jd.md', JD_TEXT, ['REFERENCE_FILE']), 'REFERENCE_FILE');
  });

  test('a typed résumé is actually ACCEPTED for a résumé claim', async () => {
    const { decide } = await import(pathToFileURL(path.join(base, 'orchestration/orchestrator.js')).href);
    const d = decide({
      requestId: 'r', requestSequence: 1, surface: 'manual-chat', modeId: 'looking-for-work',
      scope: { userId: 'u1' }, sessionId: 's', manualQuestion: 'What is my CGPA?',
    });
    const p = createModeRetrievalPort({
      modesManager: { retrieveHybridRaw: async () => ({ chunks: [
        { sourceId: 'f1', fileName: 'resume.md', text: 'Education CUSAT CGPA: 7.5/10', chunkIndex: 0, score: 0.8 },
      ] }) },
      modeInfo: { id: 'm1' },
      files: [{ id: 'f1', fileName: 'resume.md', content: RESUME_TEXT }],
      allowedSourceTypes: ['RESUME', 'JOB_DESCRIPTION', 'PROFILE_FACT', 'REFERENCE_FILE'],
      tokenBudget: 1500, userId: 'u1',
    });
    const r = await p.retrieve({ decision: d });
    assert.equal(r.evidence.length, 1, 'the résumé must survive claim authority, not just retrieval');
    assert.equal(r.evidence[0].sourceType, 'RESUME');
  });

  test('and a JD still cannot answer a user-skill claim', async () => {
    const { orchestrate } = await import(pathToFileURL(path.join(base, 'orchestration/orchestrator.js')).href);
    const p = createModeRetrievalPort({
      modesManager: { retrieveHybridRaw: async () => ({ chunks: [
        { sourceId: 'jd', fileName: 'jd.md', text: 'Kubernetes and Docker required.', chunkIndex: 0, score: 0.99 },
      ] }) },
      modeInfo: { id: 'm1' },
      files: [{ id: 'jd', fileName: 'jd.md', content: JD_TEXT }],
      allowedSourceTypes: ['RESUME', 'JOB_DESCRIPTION', 'PROFILE_FACT'],
      tokenBudget: 1500, userId: 'u1',
    });
    const r = await orchestrate({
      requestId: 'r', requestSequence: 1, surface: 'manual-chat', modeId: 'looking-for-work',
      scope: { userId: 'u1' }, sessionId: 's', manualQuestion: 'Do I have Kubernetes experience?',
    }, p);
    assert.notEqual(r.answerability, 'FULL',
      'typing files correctly must NOT reopen the JD-as-experience trap');
  });
});
