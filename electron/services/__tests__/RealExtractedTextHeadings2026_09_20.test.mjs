// What REAL files extract to — not a simulation. Found 2026-09-20 by printing the campaign's fixtures
// to real PDFs (Electron printToPDF) and real DOCX (textutil), then reading them back through the
// app's own extractor (pdf-parse / mammoth):
//   · PDF:  blank-line ratio 0.02, lines hard-wrapped near 80 chars, bullet marks gone, "[Page N]"
//           markers. The blank-line heading detector found 0 of 36…425 headings on all twelve files and
//           the answer chunk reached the prompt for 103–129 of 162 questions (markdown: 159).
//   · DOCX: a blank line after EVERY paragraph, so each line of a config block "stood alone" and became
//           a heading: 1,252 false headings in one 70k handbook, median chunk 113 characters.
// The text below has the exact shape the extractor produced.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { semanticChunks } = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/services/modes/semanticChunker.js')).href);
const ctxOf = (c) => c.match(/^\[context: ([^\]]+)\]/)?.[1] ?? '';
const headsOf = (chunks) => new Set(chunks.flatMap((c) => ctxOf(c).split(' > ')).filter(Boolean));

const pod = (i, lead) => [
  `Team profile: Growth Platform (Hollow pod ${i})`,
  'Overview',
  `The pod owns the partner API gateway and the ingestion pipeline. It is led by ${lead}`,
  `Szabo and currently has ${4 + i} engineers.`,
  'What you would do here',
  'Decommission the feature-flag platform using ClickHouse and Elasticsearch, with',
  `a target of moving cold-start time by ${40 + i}%.`,
  'Harden the fraud-scoring service using Cassandra and Envoy, with a target of',
  `moving deploy frequency by ${60 + i}%.`,
];
const PDF = ['[Page 1]', 'Job description — Principal Engineer,', 'Settlement Core', 'Company: Helix Meridian B.V.', 'Role: Principal Engineer',
  'About the role', 'Helix Meridian runs clearing and settlement for European marketplaces. This',
  'document describes the role, the teams you would work with, and how we hire.',
  ...pod(0, 'Greta'), ...pod(1, 'Otto'), '', '[Page 2]', ...pod(2, 'Priya'), ...pod(3, 'Dagmar'),
  'Minimum qualifications', '9+ years building distributed backend systems, at least 3 of them operating a',
  'ledger or payments system in production.',
  'Reporting line', 'This role reports to Dagny Verhoeven, Director of Ledger Infrastructure.',
  'Incidents', 'INC-1020-0: throughput regression after a Kubernetes upgrade; it was resolved in',
  '118 minutes by Leopold Eklund.',
  'Pricing tiers', 'Plan \tPrice \tMinimum', 'Team \t$14 per seat 5 seats', 'Business \t$24 per seat 25 seats'].join('\n');

describe('a real PDF\'s text: no blank lines, hard-wrapped', () => {
  const chunks = semanticChunks(PDF); const heads = headsOf(chunks);
  for (const [heading, fact] of [['Minimum qualifications', '9+ years building'], ['Reporting line', 'Dagny Verhoeven'], ['Team profile: Growth Platform (Hollow pod 2)', 'led by Priya'], ['Pricing tiers', '$14 per seat']]) {
    test(`"${heading}" heads the chunk that holds its fact`, () => {
      const c = chunks.find((x) => x.includes(fact)); assert.ok(c, `no chunk holds "${fact}"`);
      assert.ok(ctxOf(c).split(' > ').includes(heading), `context was "${ctxOf(c)}"`);
    });
  }
  test('a wrapped continuation is not a heading — even when it starts with a number', () => {
    for (const bad of ['118 minutes by Leopold Eklund.', '118 minutes by Leopold Eklund', 'Szabo and currently has 4 engineers.', 'a target of moving cold-start time by 40%.', 'ledger or payments system in production.'])
      assert.ok(!heads.has(bad), `"${bad}" became a heading`);
  });
  test('"Label: value" fields and table rows are not headings', () => {
    for (const bad of ['Role: Principal Engineer', 'Company: Helix Meridian B.V.', 'Plan \tPrice \tMinimum']) assert.ok(![...heads].some((h) => h.startsWith(bad.slice(0, 12))), bad);
  });
  test('nothing is lost: every word of the document is in some chunk', () => {
    const all = chunks.join('\n'); for (const w of PDF.split(/\s+/).filter((x) => x.length > 3 && !/^\[Page/.test(x) && !/^\d+\]$/.test(x))) assert.ok(all.includes(w), `lost "${w}"`);
  });
  test('short documents (< 30 lines) keep the blank-line rules — dense mode needs evidence of a wrap width', () => {
    const tiny = ['Summary', '', 'Backend engineer with ten years in payments.', '', 'Skills', '', '- Go', '- Rust'].join('\n');
    assert.ok(headsOf(semanticChunks(tiny)).has('Skills'));
  });
});

describe('a real DOCX\'s text: a blank line after every paragraph', () => {
  const svc = (i) => [`Service: Beacon-sync-${i}`, '', 'Overview', '', `Beacon-sync-${i} is owned by Core Identity. Primary contact is Stellan Abernathy. It backs the partner API gateway.`, '',
    'SLOs', '', `Availability target: 99.${20 + i}%`, '', 'Configuration', '', `Beacon.sync.${i}.pool.max_connections = ${215 + i}`, '', `Beacon.sync.${i}.retry.max_attempts = 9`, '', `Beacon.sync.${i}.timeout_ms = 1331`, ''];
  const DOCX = ['Orbital Platform Engineering Handbook', '', ...[0, 1, 2, 3].flatMap(svc)].join('\n');
  const chunks = semanticChunks(DOCX); const heads = headsOf(chunks);
  test('config keys and numeric-valued fields never become headings', () => {
    for (const h of heads) assert.ok(!/=|max_connections|timeout_ms|Availability target/.test(h), `"${h}" became a heading`);
  });
  test('the recurring entry title still does, and keeps its config with it', () => {
    assert.ok(heads.has('Service: Beacon-sync-2'));
    const c = chunks.find((x) => x.includes('Beacon.sync.2.timeout_ms')); assert.ok(ctxOf(c).includes('Service: Beacon-sync-2'), ctxOf(c));
  });
});
