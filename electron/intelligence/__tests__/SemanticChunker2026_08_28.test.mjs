// T9 (RC9) — chunks carried only their LEAF heading, so project identity was
// absent from the chunk text.
//
// A reference file with five projects x six identically-named sections produced
// five "Idempotency" chunks that are near-neighbours in embedding space with
// nothing to tell them apart. Measured in experiments/chunk-sweep: entity
// anchoring takes top-1-correct-project from 1/5 to 5/5 WITH heading-path
// prefixes and from 0/5 to 1/5 without them (project precision 0.60 vs 0.08).
// The two fixes only work as a pair, and production had neither.
//
// It is also the mechanism behind the reporter's third symptom — splitting the
// 63k file into per-project files helped a lot but not fully. The FILENAME put
// back the identity the chunk text had dropped. Heading paths put it back in the
// text, where it works for a single combined file too.
//
// Chunk SIZE was measured NOT to be the problem — budget-survival is 25/25 at
// every size up to 1250 tokens and production's ~225 already sits inside the
// measured 300-512 sweet spot — so this suite asserts BOUNDARIES and IDENTITY,
// and treats the size guardrails as guardrails rather than targets.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);

const { semanticChunks, contextPrefix, approxTokens, CHUNKER_VERSION, DEFAULT_CHUNK_OPTIONS } =
  cjsRequire(path.resolve(repoRoot, 'dist-electron/electron/services/modes/semanticChunker.js'));

// The reporter's shape: several projects, each with the same section names.
const CORPUS = `# Integration Project History

## Project: FieldServe-CRM Sync

### Idempotency
Every write carries an idempotency key. The key format is IDK-FS-1.
Duplicate submissions within the window are collapsed.

### Retries
Six attempts with a multiplier of 2.5.

## Project: Orbit Bridge

### Idempotency
Every write carries an idempotency key. The key format is IDK-OB-1.
Duplicate submissions within the window are collapsed.

### Retries
Four attempts with a multiplier of 1.8.
`;

describe('T9 — every chunk names the project it belongs to', () => {
  const chunks = semanticChunks(CORPUS);

  test('the two identically-named Idempotency sections are distinguishable', () => {
    const idem = chunks.filter((c) => /Idempotency/.test(c));
    assert.equal(idem.length, 2, `expected one chunk per project, got ${idem.length}`);
    assert.ok(idem.some((c) => /FieldServe-CRM Sync/.test(c)), 'FieldServe identity missing');
    assert.ok(idem.some((c) => /Orbit Bridge/.test(c)), 'Orbit Bridge identity missing');
    // The pre-T9 failure in one line: both chunks were textually near-identical
    // apart from the key, which is exactly what embeddings cannot separate.
    assert.notEqual(idem[0].replace(/IDK-\w+-\d/, ''), idem[1].replace(/IDK-\w+-\d/, ''));
  });

  test('every chunk under a project carries that project in its context path', () => {
    for (const c of chunks) {
      if (!/\[context:/.test(c)) continue;
      assert.match(c, /\[context: Project: (FieldServe-CRM Sync|Orbit Bridge)/);
    }
  });

  test('the document-level heading is NOT repeated in every chunk', () => {
    // It is identical on every chunk of the file, so it costs tokens everywhere
    // and discriminates between nothing.
    for (const c of chunks) {
      assert.ok(!/\[context: Integration Project History/.test(c), c.slice(0, 120));
    }
  });

  test('the path is the ANCESTOR chain, not just the parent', () => {
    assert.equal(contextPrefix([
      { level: 1, text: 'Doc' }, { level: 2, text: 'Project: X' }, { level: 3, text: 'Idempotency' },
    ]), '[context: Project: X > Idempotency]');
  });

  test('a flat document with no headings still chunks, with no empty prefix', () => {
    const flat = semanticChunks('Just one paragraph of prose with no heading at all.');
    assert.equal(flat.length, 1);
    assert.ok(!/\[context:/.test(flat[0]), flat[0]);
  });
});

describe('T9 — boundaries are semantic; size is a guardrail, not a target', () => {
  test('a fenced code block is never split, even when oversized', () => {
    const body = Array.from({ length: 600 }, (_, i) => `    line_${i} = compute(${i})`).join('\n');
    const doc = `# Doc\n\n## Sample\n\n\`\`\`python\n${body}\n\`\`\`\n`;
    const chunks = semanticChunks(doc);
    const withFence = chunks.filter((c) => c.includes('```'));
    assert.equal(withFence.length, 1, 'a fenced block must live in exactly one chunk');
    assert.ok(withFence[0].includes('line_0 ='), 'start of the block missing');
    assert.ok(withFence[0].includes('line_599 ='), 'end of the block missing — it was split');
    // Deliberately allowed to exceed the cap: half a code block is unreadable,
    // not smaller.
    assert.ok(approxTokens(withFence[0]) > DEFAULT_CHUNK_OPTIONS.maxTokens);
  });

  test('a markdown table is never split', () => {
    const rows = Array.from({ length: 300 }, (_, i) => `| row${i} | value${i} |`).join('\n');
    const doc = `# Doc\n\n## Table\n\n| key | value |\n| --- | --- |\n${rows}\n`;
    const chunks = semanticChunks(doc);
    const withTable = chunks.filter((c) => c.includes('| row0 |'));
    assert.equal(withTable.length, 1);
    assert.ok(withTable[0].includes('| row299 |'), 'the table was split — half a table is wrong evidence');
  });

  test('an oversized PROSE unit is subdivided, and never mid-sentence', () => {
    const sentence = 'The retry policy is six attempts with a multiplier of two point five. ';
    const doc = `# Doc\n\n## Long\n\n${sentence.repeat(400)}\n`;
    const chunks = semanticChunks(doc);
    assert.ok(chunks.length > 1, 'an oversized prose unit must be subdivided');
    for (const c of chunks) {
      const body = c.split('\n').slice(1).join('\n');
      if (!body.trim()) continue;
      assert.ok(!/\bmultiplier of two point$/.test(body.trim()), 'split mid-sentence');
    }
  });

  test('tiny sibling units MERGE rather than each taking a top-K slot', () => {
    // The failure this prevents: cosine similarity favours short focused texts,
    // so an unmerged two-line fragment outranks the paragraph that answers the
    // question while carrying no evidence.
    const doc = `# Doc\n\n## Facts\n\n${Array.from({ length: 12 }, (_, i) => `Fact ${i} is short.`).join('\n\n')}\n`;
    const chunks = semanticChunks(doc);
    assert.ok(chunks.length < 12, `expected merging, got ${chunks.length} chunks for 12 tiny units`);
  });

  test('a heading with no body is still retrievable', () => {
    const chunks = semanticChunks('# Doc\n\n## Empty Section\n');
    assert.ok(chunks.some((c) => /Empty Section/.test(c)));
  });

  test('chunking is deterministic', () => {
    assert.deepEqual(semanticChunks(CORPUS), semanticChunks(CORPUS));
  });
});

describe('T9 — the five prefix consumers still match', () => {
  // D3 requires each of these proven, because substituting the format rather
  // than appending to it would break section-targeted retrieval, the
  // section-restore pass and the prompt's SECTION-TAGGED RELEVANCE rule at once.
  const CONSUMERS = [
    ['ModeHybridRetriever.ts:1118', /^\[Section\s+[\d.]+\s*\|/],
    ['ModeHybridRetriever.ts:1216', /^\[Section\s+([\d.]+)\s*\|/],
    ['ModeHybridRetriever.ts:1802', /^\[Section\s+([\d.]+)\s*\|/],
    ['ModeHybridRetriever.ts:2020', /^\[Section\s+([\d.]+)/],
    ['documentGroundedPrompt.ts:699', /\[Section\s+([\d.]+)/],
  ];

  const tagged = semanticChunks(
    '# Doc\n\n## Project: X\n\n### Idempotency\n\nThe key format is IDK-1.\n',
    {},
    () => '[Section 2.3 | p4]',
  );

  test('the tag stays at position 0, with the path AFTER it', () => {
    assert.ok(tagged.length > 0);
    for (const c of tagged) {
      assert.match(c, /^\[Section 2\.3 \| p4\]/, `the tag must stay at position 0:\n${c}`);
    }
    // The document-title chunk legitimately has no ancestry to report, so the
    // ordering is asserted on the chunks that DO carry a path.
    const withPath = tagged.filter((c) => c.includes('[context:'));
    assert.ok(withPath.length > 0, 'no chunk carried a context path');
    for (const c of withPath) {
      assert.match(c, /^\[Section 2\.3 \| p4\] \[context: /,
        `the path must follow the tag, never replace it:\n${c}`);
    }
  });

  for (const [where, re] of CONSUMERS) {
    test(`still matched by ${where}`, () => {
      for (const c of tagged) {
        assert.match(c, re, `${where} no longer matches:\n${c}`);
      }
    });
  }

  test('the section NUMBER extracted is still the section number', () => {
    // A path containing digits ("4.2 Training") must not be captured instead.
    const num = tagged[0].match(/^\[Section\s+([\d.]+)\s*\|/)?.[1];
    assert.equal(num, '2.3');
  });
});

describe('T9 — the index is invalidated when the chunker changes', () => {
  test('CHUNKER_VERSION exists and is past v1', () => {
    // `needsReindexing` compares a hash of the RAW SOURCE. A chunker change does
    // not alter the source, so without this version in that hash the index keeps
    // old chunk text and old vectors while the query path produces new chunk
    // text — silently, with no error. This is the guard for that.
    assert.equal(typeof CHUNKER_VERSION, 'number');
    assert.ok(CHUNKER_VERSION >= 2);
  });
});
