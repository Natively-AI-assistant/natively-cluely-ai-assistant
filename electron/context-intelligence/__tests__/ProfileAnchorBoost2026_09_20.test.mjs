// The profile port's intent boosts rank a section by its TYPE, blind to whether it holds what the
// question NAMES. Measured 2026-09-20 with the structuring LLM's real output for a 15k-token résumé:
// "How many engineers did you work with on Project Cinder-115?" fired the project intent and all six
// evidence slots went to structured sections about four OTHER projects, while the raw chunk naming
// Cinder-115 was cut at the cap. Lexical questions reached the prompt 50% of the time, sibling facts
// 58% — 100% with structured data absent, so better structuring meant worse retrieval.
// Red-checked by running this file with NATIVELY_RETRIEVAL_ANCHOR_BOOST=0.00001.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.cwd(), 'dist-electron/electron');
const load = (p) => import(pathToFileURL(path.join(root, p)).href);
const { createProfileRetrievalPort } = await load('context-intelligence/retrieval/profile-retrieval-port.js');
const { orchestrate } = await load('context-intelligence/orchestration/orchestrator.js');
const { resolveModePolicy } = await load('context-intelligence/policies/mode-policy-registry.js');

const { questionContentWords, buildLexicalStats, anchorTerms, anchorCoverage } = await load('services/modes/lexicalTokens.js');

const MODE = 'looking-for-work';
const policy = resolveModePolicy(MODE);
const NAMES = ['Vellum', 'Tundra', 'Drift', 'Tallgrass', 'Cinder', 'Harrier', 'Nimbus', 'Isthmus', 'Gantry', 'Fathom'];
// 40 projects in the raw text — what a long résumé looks like once extracted from a PDF.
const RAW = ['Maya Okonkwo-Reyes', 'Staff Software Engineer', '', 'Projects', '',
  ...Array.from({ length: 40 }, (_, i) => `Project ${NAMES[i % 10]}-${100 + i} — Marlowe & Finch (${2000 + (i % 20)})\nStack: Kotlin, PostgreSQL\n\n- Rebuilt the billing reconciler for the payments group, improving p99 latency by ${20 + i}%.\n- Worked with ${3 + (i % 9)} engineers under ${['Anneke Jablonski', 'Tomas Reyes', 'Ingrid Solberg'][i % 3]}; partnered with the Partner Integrations group.\n`)].join('\n');
// …of which the structuring LLM kept four, as it did live.
const structured = {
  identity: { name: 'Maya Okonkwo-Reyes' },
  experience: [{ company: 'Sablefin Logistics', role: 'Staff Software Engineer', start_date: '2012-01', end_date: null, bullets: [] }],
  projects: [0, 1, 2, 3].map((i) => ({ name: `Project ${NAMES[i]}-${100 + i}`, description: `Rebuilt the billing reconciler and ingestion services at Marlowe & Finch with a team of engineers using Kotlin and PostgreSQL.`, technologies: ['Kotlin', 'PostgreSQL'] })),
  skills: { languages: ['Kotlin'] }, education: [], achievements: [], certifications: [], leadership: [],
};
const docs = [{ kind: 'resume', sourceId: 'p-resume', versionId: 'v1', fileName: 'resume.pdf', structured, rawText: RAW }];
const ask = (q) => orchestrate({ requestId: 'r', requestSequence: 1, surface: 'manual_chat', modeId: MODE, scope: { userId: 'u' }, sessionId: `s-${Math.random()}`, manualQuestion: q, hasAttachedDocuments: true, profileOnlyDocuments: true },
  createProfileRetrievalPort({ docs, allowedSourceTypes: policy.allowedSourceTypes, profileSources: policy.profileSources, userId: 'u' }));

describe('profile port: a chunk that holds what the question names outranks sections boosted by type', () => {
  test('a project the structuring LLM did NOT keep is still answerable from the raw text', async () => {
    const r = await ask('How many engineers did you work with on Project Cinder-104?');
    assert.ok(r.evidence.some((e) => /Cinder-104/.test(e.content) && /Worked with 7 engineers/.test(e.content)),
      `raw chunk missing; evidence was:\n${r.evidence.map((e) => `  ${e.finalScore.toFixed(2)} ${e.content.slice(0, 70)}`).join('\n')}`);
  });
  test('control: the fixture really does fill the cap with other projects\' structured sections', async () => {
    const r = await ask('How many engineers did you work with on Project Cinder-104?');
    assert.ok(r.evidence.filter((e) => /Project (Vellum|Tundra|Drift|Tallgrass)-10[0-3]/.test(e.content) && !/Cinder-104/.test(e.content)).length >= 2);
  });
  test('a project the LLM DID keep still surfaces its structured section', async () => {
    const r = await ask('Tell me about Project Tundra-101.');
    assert.ok(r.evidence.some((e) => /Project Tundra-101/.test(e.content)));
  });
});

// Two things the first cut got wrong, both found by measurement rather than by reading the code:
describe('what may anchor, and when the boost applies', () => {
  test('function words never anchor — "how" is rarer in a résumé than the project\'s own name', () => {
    const words = questionContentWords('How many engineers did you work with on Project Cinder-104?');
    for (const w of ['how', 'you', 'did', 'with']) assert.equal(words.has(w), false, w);
    assert.ok(words.has('cinder-104') || words.has('cinder'));
    // With "how" counted, the chunk naming the project covered 0.59 of the anchor weight — a hair under
    // the 0.6 bar — and 7 of 12 sibling questions lost their boost.
    const chunks = RAW.split(/\n(?=Project )/);
    const stats = buildLexicalStats(chunks);
    const cov = (ws) => anchorCoverage(anchorTerms(ws, stats), stats.sets[chunks.findIndex((c) => c.includes('Cinder-104'))]);
    assert.ok(cov(words) >= 0.6, `content-word coverage ${cov(words)}`);
  });
  // Third, and NOT unit-tested here: anchors that a fifth of the corpus shares rank nothing. "Who does
  // this role report to?" — "role" and "report" each sit in just under half of a résumé + JD's chunks,
  // the answer says "reports to" (no stemming), and an unconditioned boost handed all six slots to team
  // blurbs. BM25 had the reporting line first by 0.702 to 0.700, a near-tie no small fixture reproduces
  // robustly (two attempts failed with AND without the guard). The guard (PROFILE_ANCHOR_MAX_SHARE) is
  // verified by the offline gate instead: experiments/retrieval-scale/run-profile.mjs, question j07 at
  // all four sizes, lexical column 100%.
  // The other: an UNGATED boost gave a chunk sharing one minor anchor +0.004, which lifted a résumé bullet
  // from 0.605 past the skills inventory that is policy-admitted at a fixed 0.600 — "Do I have Kubernetes
  // experience?" went FULL → PARTIAL. That case is pinned where it was caught:
  // ProfileSourceRouting2026_07_31 › "Do I have Kubernetes experience? → complete inventory + JD side, FULL".
});
