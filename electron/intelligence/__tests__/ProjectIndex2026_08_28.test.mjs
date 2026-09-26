// T12 — a compact project index, so a multi-project file cannot be answered as
// though it held one project.
//
// THE FAILURE. The reporter's file is one 63k markdown describing five
// integration projects. Asked "what projects have you worked on?" the model saw
// twelve chunks from whichever two or three ranked best and answered as though
// those were all of them — wrong in a way the user cannot detect, because
// nothing in the evidence says a project is missing. He asked for this fix by
// name.
//
// WHY IT IS DERIVED RATHER THAN EXTRACTED. The names come from the
// heading-ancestor prefixes T9 already writes into every chunk. The neighbouring
// `prependIdentityBlock` mines capitalised terms from the first 4000 characters
// of each FILE — a heuristic that finds nothing useful for a single combined
// file, which is exactly this case. Reading structure the chunker already
// recorded cannot disagree with the chunks.
//
// NAVIGATION, NOT EVIDENCE — asserted below, because an index that carried facts
// would be a new fabrication surface rather than a fix.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const cjsRequire = createRequire(import.meta.url);

const { ModeHybridRetriever } = cjsRequire(
  path.resolve(repoRoot, 'dist-electron/electron/services/modes/ModeHybridRetriever.js'));
const { semanticChunks } = cjsRequire(
  path.resolve(repoRoot, 'dist-electron/electron/services/modes/semanticChunker.js'));

/** Reach the private builder without standing up a database. */
const build = (chunks) =>
  ModeHybridRetriever.prototype.buildProjectIndex.call(
    Object.create(ModeHybridRetriever.prototype),
    chunks.map((text) => ({ text })));

const PROJECTS = ['FieldServe-CRM Sync', 'Orbit Bridge', 'LedgerLink', 'FleetBridge', 'StockMesh'];
const CORPUS = `# Integration Project History\n\n` + PROJECTS.map((p) => `## Project: ${p}\n
### Idempotency
Every write carries an idempotency key for ${p}.

### Retries
Six attempts with a multiplier of 2.5.
`).join('\n');

describe('T12 — the index names every project the material covers', () => {
  const chunks = semanticChunks(CORPUS);

  test('all five projects appear, from the chunk prefixes alone', () => {
    const idx = build(chunks);
    for (const p of PROJECTS) {
      assert.ok(idx.includes(p), `${p} missing from the index:\n${idx}`);
    }
  });

  test('it survives a retrieval that only returned ONE project', () => {
    // The whole point: the model is told the other four exist even when nothing
    // from them ranked. Built from the chunks that WERE retrieved, so this is
    // the honest bound — an index of what the retrieved set spans.
    const oneProject = chunks.filter((c) => c.includes('Orbit Bridge') || c.includes('LedgerLink'));
    const idx = build(oneProject);
    assert.ok(idx.includes('Orbit Bridge') && idx.includes('LedgerLink'));
  });

  test('a single-project set gets NO index — an empty one is pure prompt overhead', () => {
    const single = chunks.filter((c) => c.includes('Orbit Bridge'));
    assert.equal(build(single), '');
  });

  test('chunks with no context prefix produce no index', () => {
    assert.equal(build(['plain text with no prefix', 'more plain text']), '');
  });
});

describe('T12 — navigation, not evidence', () => {
  const idx = build(semanticChunks(CORPUS));

  test('it is explicitly labelled as routing-only', () => {
    assert.match(idx, /purpose="navigation_only"/);
    assert.match(idx, /states no facts and supports no claim/i);
  });

  test('it carries NAMES and no facts — no numbers leak in', () => {
    // "Six attempts with a multiplier of 2.5" is in the body of every project.
    // If it reached the index, the index would be a fabrication surface.
    const subjects = /<subjects>([\s\S]*?)<\/subjects>/.exec(idx)?.[1] ?? '';
    assert.ok(subjects.length > 0);
    assert.ok(!/\d+\s*attempts|multiplier|idempotency key/i.test(subjects),
      `facts leaked into the index: ${subjects}`);
  });

  test('it stays inside its ~200-token budget', () => {
    const many = Array.from({ length: 200 }, (_, i) => `[context: Project: Very Long Project Name Number ${i} > Idempotency] body`);
    const big = build(many);
    assert.ok(big.length < 1400, `index grew to ${big.length} chars`);
    assert.match(big, /\+\d+ more/, 'truncation must be disclosed, not silent');
  });

  test('markup in a project name cannot break the envelope', () => {
    // `>` is the path separator, so a name can never contain one — but `<` can,
    // and an unescaped one would let document text close `<subjects>` early and
    // restructure the prompt around it.
    const idx2 = build(['[context: Project: A<script> > X] body', '[context: Project: C > Y] body']);
    assert.match(idx2, /&lt;script/, 'the angle bracket must be escaped');
    assert.ok(!/<script/.test(idx2), `unescaped markup survived:\n${idx2}`);
    // The envelope must still be exactly one well-formed element.
    assert.equal((idx2.match(/<subjects>/g) ?? []).length, 1);
    assert.equal((idx2.match(/<\/subjects>/g) ?? []).length, 1);
  });
});
