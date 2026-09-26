// Plain-text heading detection accepted Title Case and ALL CAPS only. Measured 2026-09-20 on the
// fixtures as a PDF extracts them: 7 of a job description's 80 headings and 2 of a résumé's 87 were
// never detected — "Minimum qualifications", "Must-have technical experience", "Location and working
// pattern", "Reporting line", "Interview process", "Career milestones", "Outside work" — every one of
// them sentence case, and every one a section holding a fact people ask about. Each was glued to the
// tail of the 1,000-character entry before it, and the VECTOR stack then missed "How many years of
// experience does the role require?", a purely lexical question, at every document size.
// Mode path, plain text, vectors, answer chunk in the prompt of 162: 152/151/150/151 → 159/159/157/158.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { semanticChunks } = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/services/modes/semanticChunker.js')).href);

const pod = (i) => [`Team profile: Growth Platform (Rampart pod ${i})`, '', 'Overview', '',
  `The pod owns the feature-flag platform and the ingestion pipeline for ledger ${i}. It is led by an engineering manager, runs its own deploy train, keeps a staffed on-call rotation through every quarter close, and currently has ${4 + i} engineers across two time zones.`, ''].join('\n');
const JD = ['Job description — Principal Engineer, Settlement Core', '', 'Company: Helix Meridian B.V.', '',
  'About the role', '', 'Helix Meridian runs clearing and settlement for European marketplaces. This document describes the role and how we hire.', '',
  ...Array.from({ length: 6 }, (_, i) => pod(i)),
  'Minimum qualifications', '', '- 9+ years building distributed backend systems, at least 3 of them operating a ledger in production.', '',
  'Location and working pattern', '', 'Hybrid: two days per week in the Rotterdam office (Tuesdays and Thursdays), remainder remote within the EU.', '',
  'Reporting line', '', 'This role reports to Dagny Verhoeven, Director of Ledger Infrastructure.', '',
  'Pricing tiers', '', '| Plan | Price |', '| --- | --- |', '| Team | $14 per seat |', ''].join('\n');
const ctxOf = (chunk) => chunk.match(/^\[context: ([^\]]+)\]/)?.[1] ?? '';

describe('sentence-case headings open their own section in extracted text', () => {
  const chunks = semanticChunks(JD);
  for (const [heading, fact] of [['Minimum qualifications', '9+ years'], ['Location and working pattern', 'Hybrid: two days'], ['Reporting line', 'Dagny Verhoeven'], ['Pricing tiers', '$14 per seat']]) {
    test(`"${heading}" heads the chunk that holds its fact`, () => {
      const c = chunks.find((x) => x.includes(fact));
      assert.ok(c, `no chunk holds "${fact}"`);
      assert.ok(ctxOf(c).split(' > ').includes(heading), `context was "${ctxOf(c)}"`);
      assert.ok(!/Team profile/.test(ctxOf(c)), 'the fact is still filed under the team entry before it');
      assert.ok(c.length < 400, `the fact is buried in a ${c.length}-character chunk`);
    });
  }
});

describe('structure decides, not case — what must NOT become a heading', () => {
  test('a run of short unpunctuated lines separated by blanks (achievement lines, an address block)', () => {
    const text = ['Career summary', '', 'Led the billing migration', '', 'Cut deploy time in half', '', 'Mentored four engineers', '', 'Spoke at two conferences', '',
      'Everything above happened between 2019 and 2023 while the team doubled in size, and none of it would have been possible without the platform group.'].join('\n');
    const heads = new Set(semanticChunks(text).flatMap((c) => ctxOf(c).split(' > ')));
    for (const line of ['Led the billing migration', 'Cut deploy time in half', 'Mentored four engineers']) assert.ok(!heads.has(line), `"${line}" became a heading`);
  });
  test('a sentence — terminal punctuation, or a break inside it', () => {
    const text = ['Overview', '', 'We hire carefully.', '', 'The process has five stages. Each takes a week.', '', '- recruiter screen', ''].join('\n');
    const heads = new Set(semanticChunks(text).flatMap((c) => ctxOf(c).split(' > ')));
    assert.ok(!heads.has('We hire carefully.') && !heads.has('We hire carefully'));
  });
  test('a once-only "Label: value" line stays a field', () => {
    const text = ['Project Harrier', '', 'Location: Rotterdam', '', 'The team ships the settlement ledger and owns its on-call rotation through every quarter close.', ''].join('\n');
    const heads = new Set(semanticChunks(text).flatMap((c) => ctxOf(c).split(' > ')));
    assert.ok(!heads.has('Location: Rotterdam'));
  });
  test('markdown is untouched: with any ATX heading present, plain-text detection does not run', () => {
    const md = ['# Handbook', '', 'Minimum qualifications', '', '- 9+ years building distributed systems.', '', '## Real heading', '', 'Body text for the real heading goes here.'].join('\n');
    const heads = new Set(semanticChunks(md).flatMap((c) => ctxOf(c).split(' > ')));
    assert.ok(!heads.has('Minimum qualifications'));
  });
});
