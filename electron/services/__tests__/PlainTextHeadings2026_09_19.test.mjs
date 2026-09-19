// Plain-text heading detection (2026-09-19, owner-approved re-index).
// A PDF/DOCX extracts to plain text — no `#`, no bold — so the chunker saw ONE
// section and cut on size alone; a chunk held the tail of one project and the
// head of the next with nothing saying which was which. Measured with
// experiments/retrieval-scale on the mode path, the SAME documents as extracted
// text (answer chunk reaches the prompt, of 162, at 5k/15k/30k/70k tokens):
//   vectors, one file   142/132/123/127 → 152/151/146/150
//   lexical, one file   143/130/120/120 → 147/146/145/144
// — the committed chunker got WORSE as the file grew, which is the size effect
// users reported and markdown fixtures had hidden.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { semanticChunks, CHUNKER_VERSION } = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/services/modes/semanticChunker.js')).href);

const BULLETS = (i) => Array.from({ length: 6 }, (_, b) => `- Rebuilt the ingestion pipeline for rollout ${i}-${b}, improving p99 latency by ${20 + i + b}% with zero customer-facing downtime and a documented handover to the platform group.`);
const project = (i, boss) => [`Project Wicket-${100 + i} — Oakhaven Mutual (2019–2020)`, '', 'Stack: Go, Kafka, PostgreSQL', '', 'Highlights', '', ...BULLETS(i), '', 'Team', '', `Worked with ${3 + i} engineers under ${boss}; partnered with the Risk Engineering group.`, ''].join('\n');
const RESUME = ['Maya Okonkwo-Reyes', '', 'Staff Software Engineer — distributed systems, payments, reliability', '', 'maya@example.test · Lisbon, Portugal', '', 'Experience', '',
  ...['Greta Kovalenko', 'Otto Szabo', 'Priya Mbeki', 'Dagmar Thackeray', 'Hamid Novak'].map((b, i) => project(i, b))].join('\n');

describe('an extracted (plain-text) résumé chunks on its project titles', () => {
  const chunks = semanticChunks(RESUME);
  test('the chunk holding a project\'s team line names that project', () => {
    const c = chunks.find((x) => x.includes('Dagmar Thackeray'));
    assert.ok(c, 'team line chunk missing');
    assert.match(c, /^\[context: [^\]]*Wicket-103/, c.slice(0, 120));
    assert.ok(!/Wicket-104/.test(c), 'a chunk must not run on into the next project');
  });
  test('a label that recurs inside entries ("Highlights", "Team") is body text, not a section', () => {
    assert.ok(!chunks.some((c) => /^\[context: [^\]]*(?:Team|Highlights)\]/.test(c)), chunks.map((c) => c.slice(0, 60)).join('\n'));
    // …so an entry is a handful of chunks, not a fragment per label.
    assert.ok(chunks.length <= 5 * 3 + 3, `${chunks.length} chunks`);
  });
  test('fields, e-mail lines, bullets and sentences are never headings', () => {
    for (const bad of ['Stack: Go', 'maya@example.test', 'Rebuilt the ingestion', 'Worked with']) {
      assert.ok(!chunks.some((c) => new RegExp(`^\\[context: [^\\]]*${bad}`).test(c)), `"${bad}" became a heading`);
    }
  });
});

describe('labelled entry titles', () => {
  const svc = (i) => [`Service: atlas-api-${i}`, '', 'Overview', '', `atlas-api-${i} is owned by Growth Platform and backs the billing reconciler for region ${i}.`, '', 'SLOs', '', `- Availability target: 99.${10 + i}%`, `- p99 latency budget: ${100 + i} ms`, '', 'Runbook', '', ...Array.from({ length: 5 }, (_, s) => `${s + 1}. Check dashboard ${i}-${s}, scale the tier by ${2 + s} replicas if degraded, and escalate after ${15 + s} minutes of sustained impact on tenants.`), ''].join('\n');
  test('a label recurring with a DIFFERENT title each time opens a section per entry', () => {
    const chunks = semanticChunks(['Orbital Platform Handbook', '', ...Array.from({ length: 6 }, (_, i) => svc(i))].join('\n'));
    const c = chunks.find((x) => x.includes('99.13%'));
    assert.match(c, /^\[context: [^\]]*Service: atlas-api-3/, c.slice(0, 120));
    assert.ok(!c.includes('99.14%'), 'ran on into the next service');
  });
  test('one or two labelled lines are indistinguishable from a field, and are left alone', () => {
    const chunks = semanticChunks(['Profile', '', 'Location: Lisbon', '', 'Based in Portugal and open to relocation within the European Union for the right role.', '', 'Clearance: None', '', 'No government clearance is held at present.', ''].join('\n'));
    assert.ok(!chunks.some((c) => /^\[context: [^\]]*(?:Location|Clearance):/.test(c)), chunks.join('\n---\n'));
  });
});

describe('markdown is untouched', () => {
  test('a document with ATX headings never runs plain-text detection', () => {
    const md = ['# Handbook', '', '## Real Section', '', 'Standalone Title Case Line', '', 'Body text under the real section that mentions the standalone line above it.', ''].join('\n');
    const chunks = semanticChunks(md);
    assert.ok(!chunks.some((c) => /\[context: [^\]]*Standalone Title Case Line/.test(c)), chunks.join('\n---\n'));
  });
  test('the chunker version moved, so stored indexes are rebuilt once', () => assert.equal(CHUNKER_VERSION, 3));
});

describe('Windows line endings (CRLF) chunk exactly like LF', () => {
  // Found 2026-09-19: every chunker splits on "\n", the "\r" stayed on the line,
  // and the ATX heading pattern cannot cross it — a markdown file authored on
  // Windows had NO headings (same résumé: 36 chunks / 35 with a heading path as
  // LF, 12 chunks / 0 as CRLF). Platform-independent code, platform-dependent
  // input: this must hold on macOS and Windows alike.
  const MD = ['# Handbook', '', '## Service: atlas-api-1', '', 'Availability target is 99.91% for the primary region and its failover pair.', '', '## Service: atlas-api-2', '', 'Availability target is 99.42% for the secondary region only.', ''].join('\n');
  const variants = { CRLF: (t) => t.replace(/\n/g, '\r\n'), CR: (t) => t.replace(/\n/g, '\r') };
  for (const [name, to] of Object.entries(variants)) {
    test(`markdown, ${name}: same chunks, heading paths intact, no stray \\r`, () => {
      const lf = semanticChunks(MD);
      const other = semanticChunks(to(MD));
      assert.deepEqual(other, lf);
      assert.ok(lf.some((c) => /^\[context: Service: atlas-api-2\]/.test(c)), lf.join('\n---\n'));
      assert.ok(!other.some((c) => c.includes('\r')));
    });
    test(`plain text, ${name}: same chunks as LF`, () => {
      assert.deepEqual(semanticChunks(to(RESUME)), semanticChunks(RESUME));
    });
  }
  test('the shared Document Map and the row chunker normalise too', async () => {
    const { buildDocumentMap, tabularChunks } = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/services/modes/DocumentMap.js')).href);
    const csv = ['id,service,owner', ...Array.from({ length: 30 }, (_, i) => `INC-${i},svc-${i},Owner ${i}`)].join('\n');
    assert.deepEqual(tabularChunks(csv.replace(/\n/g, '\r\n')), tabularChunks(csv));
    assert.deepEqual(JSON.stringify(buildDocumentMap(MD.replace(/\n/g, '\r\n'))), JSON.stringify(buildDocumentMap(MD)));
  });
});
