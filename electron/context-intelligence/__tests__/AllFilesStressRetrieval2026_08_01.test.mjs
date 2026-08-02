// All-files-attached stress defects (deep-run 2 verbose log, 2026-08-01).
//
// Two verified live failures with every mode file attached simultaneously:
//
//   * turn 35 "What is TECH-PDF-START-481 associated with?" — the chunk holding
//     the identifier never became a candidate; sibling chunks of the same PDF
//     filled the pool.
//   * turn 39 "What is the last-page canary?" — pages 3–13 of a 14-page PDF
//     with per-page boilerplate consumed all six accepted slots; the last-page
//     chunk missed the topK cut entirely.
//
// Plus the post-commit-audit MEDIUM: the per-type diversity round-robin walked
// lists in lockstep and re-promoted retired chunks above current ones.
//
// All fixes are generic (identifier shape, positional compound, status
// partition, per-document interleave) — no fixture vocabulary below is load-
// bearing; codes are synthetic.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const load = (p) => import(pathToFileURL(path.join(base, p)).href);

const { createLegacyRetrievalPort } = await load('retrieval/legacy-retrieval-port.js');
const { decide } = await load('orchestration/orchestrator.js');

const registryFor = (ids, types = {}) => ({
  sourceTypes: new Map(ids.map((id) => [id, types[id] ?? 'REFERENCE_FILE'])),
  activeVersions: new Map(ids.map((id) => [id, 'v1'])),
  chunkVersions: new Map(ids.map((id) => [id, 'v1'])),
  sourceScopes: new Map(ids.map((id) => [id, { userId: 'u' }])),
});

const decisionFor = (q, modeId = 'sales') => decide({
  requestId: 'p', requestSequence: 1, surface: 'manual_chat', modeId,
  scope: { userId: 'u', modeId }, sessionId: 's', manualQuestion: q,
});

// ── Exact-identifier targeted retry ─────────────────────────────────────────

describe('stress: exact-identifier lookup triggers one targeted retry', () => {
  const flood = Array.from({ length: 6 }, (_, i) => ({
    sourceId: 'pdf', fileName: 'reference-dossier.pdf', chunkIndex: i + 2,
    text: `This section of the dossier is authoritative. Section ${i + 2}: generic architecture notes.`,
    score: 0.9 - i * 0.01,
  }));
  const identChunk = {
    sourceId: 'pdf', fileName: 'reference-dossier.pdf', chunkIndex: 0,
    text: 'Parser marker (start): DOC-CODE-471 appears on the opening page.', score: 0.3,
  };

  test('the identifier chunk is recovered and ranked first', async () => {
    const calls = [];
    const port = createLegacyRetrievalPort({
      registry: registryFor(['pdf']),
      retrieve: async (q) => {
        calls.push(q);
        return q.includes('DOC-CODE-471') && calls.length > 1 ? [identChunk, ...flood] : flood;
      },
    });
    const { evidence, attempts } = await port.retrieve({
      decision: decisionFor('What is DOC-CODE-471 associated with?'),
    });
    assert.equal(attempts.length, 2, `expected a targeted retry: ${attempts.map((a) => a.strategy).join(',')}`);
    assert.equal(attempts[1].strategy, 'targeted_exact_lookup');
    assert.ok(evidence.length > 0);
    assert.match(evidence[0].content, /DOC-CODE-471/,
      `identifier chunk must rank first: ${evidence.map((e) => e.chunkIndex).join(',')}`);
  });

  test('no retry when the identifier is already in admitted evidence', async () => {
    const port = createLegacyRetrievalPort({
      registry: registryFor(['pdf']),
      retrieve: async () => [identChunk, ...flood],
    });
    const { attempts } = await port.retrieve({
      decision: decisionFor('What is DOC-CODE-471 associated with?'),
    });
    assert.equal(attempts.length, 1, attempts.map((a) => a.strategy).join(','));
  });

  test('hyphenated prose is not an identifier and triggers nothing', async () => {
    const port = createLegacyRetrievalPort({
      registry: registryFor(['pdf']),
      retrieve: async () => flood,
    });
    const { attempts } = await port.retrieve({
      decision: decisionFor('Is the pipeline state-of-the-art end-to-end?'),
    });
    assert.equal(attempts.length, 1, attempts.map((a) => a.strategy).join(','));
  });
});

// ── Positional-page targeted retry ──────────────────────────────────────────

describe('stress: last-page questions recover the extremal chunk', () => {
  // Primary query returns only middle pages (the live turn-39 shape); the
  // stripped retry query surfaces the last-page chunk as well.
  const midPages = [12, 6, 9, 2, 11, 10].map((i, k) => ({
    sourceId: 'pdf', fileName: 'system-dossier.pdf', chunkIndex: i,
    text: `This section is part of the current dossier and is authoritative. Page ${i + 1}: routine detail.`,
    score: 0.8 - k * 0.001,
  }));
  const lastPage = {
    sourceId: 'pdf', fileName: 'system-dossier.pdf', chunkIndex: 13,
    text: 'Parser marker (end): END-MARK-915 canary closes the document.', score: 0.4,
  };

  test('the last-page chunk wins despite a lower similarity score', async () => {
    let n = 0;
    const port = createLegacyRetrievalPort({
      registry: registryFor(['pdf']),
      retrieve: async () => (++n === 1 ? midPages : [...midPages, lastPage]),
    });
    const { evidence, attempts } = await port.retrieve({
      decision: decisionFor('What is the last-page canary?'),
    });
    assert.equal(attempts.length, 2, attempts.map((a) => a.strategy).join(','));
    assert.equal(attempts[1].strategy, 'targeted_positional');
    assert.equal(evidence[0]?.chunkIndex, 13,
      `extremal chunk must rank first: ${evidence.map((e) => e.chunkIndex).join(',')}`);
  });

  test('first-page direction boosts the minimum chunk index', async () => {
    let n = 0;
    const firstPage = { ...lastPage, chunkIndex: 0, text: 'Parser marker (start): START-MARK-118 opens the document.' };
    const port = createLegacyRetrievalPort({
      registry: registryFor(['pdf']),
      retrieve: async () => (++n === 1 ? midPages : [...midPages, firstPage]),
    });
    const { evidence } = await port.retrieve({
      decision: decisionFor('What is on the first page of the document?'),
    });
    assert.equal(evidence[0]?.chunkIndex, 0, evidence.map((e) => e.chunkIndex).join(','));
  });

  test('a bare positional word ("last quarter") does not trigger document targeting', async () => {
    const port = createLegacyRetrievalPort({
      registry: registryFor(['pdf']),
      retrieve: async () => midPages,
    });
    const { attempts } = await port.retrieve({
      decision: decisionFor('What was revenue last quarter?'),
    });
    assert.equal(attempts.length, 1, attempts.map((a) => a.strategy).join(','));
  });

  test('a single-chunk document gets no free positional boost', async () => {
    let n = 0;
    const oneChunkDoc = {
      sourceId: 'memo', fileName: 'short-memo.md', chunkIndex: 0,
      text: 'A short memo with routine content.', score: 0.5,
    };
    const port = createLegacyRetrievalPort({
      registry: registryFor(['pdf', 'memo']),
      retrieve: async () => (++n === 1 ? midPages : [...midPages, lastPage, oneChunkDoc]),
    });
    const { evidence } = await port.retrieve({
      decision: decisionFor('What is the last-page canary?'),
    });
    assert.equal(evidence[0]?.chunkIndex, 13, evidence.map((e) => `${e.sourceId}#${e.chunkIndex}`).join(','));
  });
});

// ── Status-partitioned diversity fill (audit MEDIUM) ────────────────────────

describe('stress: diversity round-robin cannot re-promote retired chunks', () => {
  const registry = registryFor(['res', 'proj'], { res: 'RESUME', proj: 'PROJECT_FILE' });
  const chunks = [
    { sourceId: 'res', fileName: 'resume.md', chunkIndex: 0, text: 'Current skill A.', score: 0.9 },
    { sourceId: 'res', fileName: 'resume.md', chunkIndex: 1, text: 'Current skill B.', score: 0.8 },
    { sourceId: 'res', fileName: 'resume.md', chunkIndex: 2, text: 'Current skill C.', score: 0.7 },
    { sourceId: 'proj', fileName: 'notes.md', chunkIndex: 0, text: 'Current note.', score: 0.6 },
    { sourceId: 'proj', fileName: 'old-notes.md', chunkIndex: 1, text: 'Retired note X.', score: 0.95, metadata: { documentStatus: 'retired' } },
    { sourceId: 'proj', fileName: 'old-notes.md', chunkIndex: 2, text: 'Retired note Y.', score: 0.85, metadata: { documentStatus: 'retired' } },
  ];

  test('every current chunk precedes every retired chunk in the accepted slice', async () => {
    const port = createLegacyRetrievalPort({ registry, retrieve: async () => chunks });
    const { evidence } = await port.retrieve({
      decision: decisionFor('Walk me through my project architecture.', 'technical-interview'),
    });
    const isRetired = (e) => e.metadata?.documentStatus === 'retired';
    assert.ok(evidence.some(isRetired),
      `scenario must admit retired chunks to be meaningful: ${evidence.map((e) => e.sourceId).join(',')}`);
    const firstRetired = evidence.findIndex(isRetired);
    const lastCurrent = evidence.map(isRetired).lastIndexOf(false);
    assert.ok(firstRetired > lastCurrent,
      `retired chunk re-promoted above current: ${evidence.map((e) => `${e.content}${isRetired(e) ? '(R)' : ''}`).join(' | ')}`);
  });
});

// ── Per-document interleave within a type ───────────────────────────────────

describe('stress: a small file is not starved by a large sibling of the same type', () => {
  const registry = registryFor(['big', 'small']);
  const big = Array.from({ length: 8 }, (_, i) => ({
    sourceId: 'big', fileName: 'large-dossier.pdf', chunkIndex: i,
    text: `Dossier section ${i} with broadly similar content.`, score: 0.9 - i * 0.01,
  }));
  const small = {
    sourceId: 'small', fileName: 'summary.md', chunkIndex: 0,
    text: 'The summary states the worker count is twelve.', score: 0.5,
  };

  test('the small file keeps a slot near the front', async () => {
    const port = createLegacyRetrievalPort({ registry, retrieve: async () => [...big, small] });
    const { evidence } = await port.retrieve({
      decision: decisionFor('What does the documentation say about workers?'),
    });
    const idx = evidence.findIndex((e) => e.sourceId === 'small');
    assert.ok(idx !== -1, `small file starved: ${evidence.map((e) => e.sourceId).join(',')}`);
    assert.ok(idx <= 1, `small file must interleave near the front, got position ${idx}`);
  });
});

// ── Exact-duplicate suppression ─────────────────────────────────────────────

describe('stress: exact duplicate chunks are dropped, near-duplicates are kept', () => {
  const registry = registryFor(['doc']);
  const chunks = [
    { sourceId: 'doc', fileName: 'doc.md', chunkIndex: 0, text: 'Identical boilerplate paragraph.', score: 0.9 },
    { sourceId: 'doc', fileName: 'doc.md', chunkIndex: 1, text: 'Identical boilerplate paragraph.', score: 0.85 },
    { sourceId: 'doc', fileName: 'doc.md', chunkIndex: 2, text: 'Identical boilerplate paragraph, but this one ends with the fact: threshold is 42.', score: 0.4 },
  ];

  test('the duplicate is suppressed and the distinct chunk survives', async () => {
    const port = createLegacyRetrievalPort({ registry, retrieve: async () => chunks });
    const { evidence } = await port.retrieve({
      decision: decisionFor('What is the threshold in the doc?'),
    });
    const texts = evidence.map((e) => e.content);
    assert.equal(new Set(texts).size, texts.length, `duplicates admitted: ${texts.join(' | ')}`);
    assert.ok(texts.some((t) => t.includes('threshold is 42')), texts.join(' | '));
  });
});

// ── Imperative generative requests (live turns 65/67) ───────────────────────
//
// "Give one tailored distributed-systems interview question." planned NO
// sources in the 2026-08-01 live run and refused with "cannot be answered
// from the available material". Fixed at the decision layer earlier in this
// campaign; pinned here so imperative phrasing keeps planning candidate
// material while ungrounded generative asks stay FAST.

describe('stress: imperative generative requests plan candidate sources', () => {
  test('tailored interview-question requests ground in candidate material', () => {
    for (const q of [
      'Give one tailored distributed-systems interview question.',
      'Suggest an interview question based on her resume.',
    ]) {
      const d = decisionFor(q, 'recruiting');
      assert.equal(d.retrievalPlan.shouldRetrieve, true, q);
      assert.ok(d.retrievalPlan.sourceTypes.includes('CANDIDATE_FILE'),
        `${q} => ${d.retrievalPlan.sourceTypes.join(',')}`);
    }
  });

  test('an ungrounded generative ask stays FAST', () => {
    const d = decisionFor('Give me a good icebreaker.', 'recruiting');
    assert.equal(d.retrievalPlan.shouldRetrieve, false);
  });
});
