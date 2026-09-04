/**
 * The Reranker panel must name the model that will actually run.
 *
 * `reranker:get-status` computed `effective` for the local branch as
 * `{ kind: 'local', id: builtIn.id }`, and `builtIn` is the hardcoded bundled
 * model. `localModelId` never entered the calculation, so selecting any
 * catalogue model — Jina v3.5, ms-marco, bge-large — left the panel saying
 * "BGE Reranker Base" while the seam ran something else. Its own comment
 * claimed the opposite: "resolved the same way the retrieval path resolves it —
 * so the panel cannot disagree with reality".
 *
 * Observed against the running app before the fix: `effective` stayed
 * `local:bge-reranker-base` across an ONNX selection and a GGUF selection.
 *
 * The resolution rule is asserted here rather than the IPC handler, because the
 * handler needs Electron's `app`. The rule is the part that was wrong.
 *
 * Run: `node --test electron/services/__tests__/RerankerStatusReportsSelection2026_09_04.test.mjs`
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);

const handlers = fs.readFileSync(path.join(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');
const { RERANKER_MODEL_CATALOG, findCatalogModel } =
  require(path.join(repoRoot, 'dist-electron/electron/rag/rerankerModelCatalog.js'));

/** The block that computes the status, isolated so unrelated edits cannot drift it. */
function statusBlock() {
  const start = handlers.indexOf("safeHandle('reranker:get-status'");
  assert.ok(start > 0, "reranker:get-status is gone");
  const end = handlers.indexOf("safeHandle('reranker:set-config'", start);
  return handlers.slice(start, end > 0 ? end : start + 8000);
}

test('the local branch reports the SELECTED model, not the bundled one', () => {
  const block = statusBlock();
  assert.match(block, /selectedLocal\?\.id \?\? builtIn\.id/,
    'effective must prefer the selected catalogue model over the bundled default');
  assert.doesNotMatch(block, /:\s*\{ kind: 'local', id: builtIn\.id \}/,
    'reporting builtIn.id unconditionally is the bug this test exists for');
});

test('a selection only counts once it is INSTALLED and supported', () => {
  // A half-downloaded model falls back to the bundled one at the seam, so
  // naming it here would put the panel back out of step with reality — the
  // same defect in the opposite direction.
  const block = statusBlock();
  assert.match(block, /statusOf\(entry\)\.state === 'installed'/);
  assert.match(block, /entry\.supported/);
});

test('the selected model is surfaced separately, so the UI need not re-derive it', () => {
  const block = statusBlock();
  assert.match(block, /selectedLocal,/, 'the status payload must carry it');

  const dts = fs.readFileSync(path.join(repoRoot, 'src/types/electron.d.ts'), 'utf8');
  assert.match(dts, /selectedLocal:\s*\{ id: string; name: string \} \| null/,
    'the renderer contract must declare it or TypeScript cannot see it');
});

test('every catalogue id the panel could select resolves to a real name', () => {
  // `selectedLocal` carries {id, name} straight from the catalogue, so a model
  // with no name would render an empty label rather than fail.
  for (const m of RERANKER_MODEL_CATALOG) {
    assert.equal(typeof m.id, 'string');
    assert.ok(m.name && m.name.length > 2, `${m.id} has no usable name`);
    assert.equal(findCatalogModel(m.id)?.id, m.id, `${m.id} is not findable by its own id`);
  }
});

test('the bundled model is still what an empty selection reports', () => {
  // The fallback has to survive: most users never pick a catalogue model, and
  // the panel must not go blank for them.
  const block = statusBlock();
  // Read from the source, not hardcoded: the bundled model changed once
  // already (bge-reranker-base -> ms-marco-MiniLM-L-6-v2 on 2026-09-04) and a
  // literal here turns that swap into a failure about the wrong thing.
  const localReranker = fs.readFileSync(path.join(repoRoot, 'electron/rag/LocalReranker.ts'), 'utf8');
  const bundled = localReranker.match(/const DEFAULT_RERANKER_MODEL = 'Xenova\/([^']+)'/)?.[1];
  assert.ok(bundled, 'DEFAULT_RERANKER_MODEL is gone from LocalReranker.ts');
  assert.match(block, new RegExp(`id: '${bundled}'`),
    'the status handler and LocalReranker must name the SAME bundled model');
  assert.match(block, /selectedLocal: \{ id: string; name: string \} \| null = null/,
    'no selection means null, which the ?? falls through to the bundled id');
});
