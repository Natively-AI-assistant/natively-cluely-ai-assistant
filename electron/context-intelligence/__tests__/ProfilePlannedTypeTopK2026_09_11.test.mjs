// Only PLANNED profile types compete for the profile port's top-k (2026-09-11).
// Measured in technical-interview: "Tell me about your education — degree,
// school, and any relevant coursework" planned [RESUME, …] without
// JOB_DESCRIPTION, but the JD's requirement lines outscored the résumé's
// EDUCATION section on those words, filled 13 of 14 slots, were all rejected at
// the type gate, and the one résumé chunk that survived was the wrong one.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const { createProfileRetrievalPort } = await import(pathToFileURL(path.join(base, 'retrieval/profile-retrieval-port.js')).href);
const { MODE_POLICIES } = await import(pathToFileURL(path.join(base, 'policies/mode-policy-registry.js')).href);
const { decide } = await import(pathToFileURL(path.join(base, 'orchestration/orchestrator.js')).href);

const structuredResume = {
  identity: { name: 'Priya Nair', summary: 'Backend engineer' },
  skills: { languages: ['Go', 'TypeScript'] },
  experience: [{ role: 'Senior Engineer', company: 'Northwind', start_date: '2021', end_date: 'Present', bullets: ['Led the rate-limit service.'] }],
  projects: [],
  education: [{ degree: 'B.S. Computer Science', field: 'CS', institution: 'University of California, Berkeley', gpa: '3.8/4' }],
};
// A JD whose requirement lines are DENSE with degree / coursework / education vocabulary.
const jdReqs = Array.from({ length: 16 }, (_, i) => `Requirement ${i + 1}: a relevant degree in computer science or equivalent coursework; education in distributed systems; school projects or degree-level coursework in databases (${i}).`);
const structuredJd = {
  title: 'Staff Engineer', company: 'Pillarstream',
  requirements: jdReqs, nice_to_haves: ['degree coursework in ML', 'education in security'], responsibilities: ['Own the control plane'],
  technologies: ['Go'], keywords: ['degree', 'coursework', 'education'],
};
const port = () => createProfileRetrievalPort({
  docs: [
    { kind: 'resume', sourceId: 'psrc_res', versionId: 'v1', fileName: 'Resume (PI)', structured: structuredResume, rawText: '# Priya Nair\n## Education\nB.S. Computer Science, University of California, Berkeley, GPA 3.8/4' },
    { kind: 'jd', sourceId: 'psrc_jd', versionId: 'v1', fileName: 'JD (PI)', structured: structuredJd, rawText: jdReqs.join('\n') },
  ],
  allowedSourceTypes: MODE_POLICIES['technical-interview'].allowedSourceTypes,
  profileSources: MODE_POLICIES['technical-interview'].profileSources,
  userId: 'u1',
});

describe('profile port: planned types own the top-k', () => {
  test('a résumé education question in technical-interview reaches the EDUCATION section', async () => {
    const decision = decide({
      requestId: 'p', requestSequence: 1, surface: 'what-to-answer', modeId: 'technical-interview',
      scope: { userId: 'u1' }, sessionId: 's', transcriptQuestion: 'Tell me about your education — degree, school, and any relevant coursework.',
      hasAttachedDocuments: true,
    });
    assert.ok(!decision.retrievalPlan.sourceTypes.includes('JOB_DESCRIPTION'), JSON.stringify(decision.retrievalPlan.sourceTypes));
    const { evidence, attempts } = await port().retrieve({ decision });
    assert.ok(evidence.some((e) => /Berkeley/.test(e.content)), `education chunk must survive the top-k: ${JSON.stringify(evidence.map((e) => e.content.slice(0, 60)))} rejections=${JSON.stringify(attempts[0]?.rejections?.slice(0, 3))}`);
  });
  test('when the JD IS planned it still competes (comparison question)', async () => {
    const decision = decide({
      requestId: 'p2', requestSequence: 2, surface: 'what-to-answer', modeId: 'looking-for-work',
      scope: { userId: 'u1' }, sessionId: 's', transcriptQuestion: 'Does my education meet the degree requirements in the job description?',
      hasAttachedDocuments: true,
    });
    assert.ok(decision.retrievalPlan.sourceTypes.includes('JOB_DESCRIPTION'), JSON.stringify(decision.retrievalPlan.sourceTypes));
    const lfwPort = createProfileRetrievalPort({
      docs: [
        { kind: 'resume', sourceId: 'psrc_res', versionId: 'v1', fileName: 'Resume (PI)', structured: structuredResume, rawText: '' },
        { kind: 'jd', sourceId: 'psrc_jd', versionId: 'v1', fileName: 'JD (PI)', structured: structuredJd, rawText: jdReqs.join('\n') },
      ],
      allowedSourceTypes: MODE_POLICIES['looking-for-work'].allowedSourceTypes,
      profileSources: MODE_POLICIES['looking-for-work'].profileSources,
      userId: 'u1',
    });
    const { evidence } = await lfwPort.retrieve({ decision });
    assert.ok(evidence.some((e) => e.sourceType === 'JOB_DESCRIPTION'), 'JD evidence admitted when planned');
  });
});

describe('a self-introduction request reaches the identity section (2026-09-11)', () => {
  test('"could you give us a quick self-introduction?" serves the résumé identity chunk', async () => {
    const decision = decide({
      requestId: 'p3', requestSequence: 3, surface: 'what-to-answer', modeId: 'looking-for-work',
      scope: { userId: 'u1' }, sessionId: 's', transcriptQuestion: 'Great to meet you. To start, could you give us a quick self-introduction?',
      hasAttachedDocuments: true,
    });
    assert.notEqual(decision.retrievalPlan.path, 'FAST');
    const lfwPort = createProfileRetrievalPort({
      docs: [{ kind: 'resume', sourceId: 'psrc_res', versionId: 'v1', fileName: 'Resume (PI)', structured: structuredResume, rawText: '' }],
      allowedSourceTypes: MODE_POLICIES['looking-for-work'].allowedSourceTypes,
      profileSources: MODE_POLICIES['looking-for-work'].profileSources,
      userId: 'u1',
    });
    const { evidence } = await lfwPort.retrieve({ decision });
    assert.ok(evidence.some((e) => /Priya Nair/.test(e.content)), `identity chunk expected: ${JSON.stringify(evidence.map((e) => e.content.slice(0, 60)))}`);
  });
});
