/**
 * There is exactly ONE rerank seam, and it stays that way.
 *
 * Natively now has four things that can rerank — the bundled ONNX
 * cross-encoder, the GGUF runtime, the hosted OpenRouter/Jina providers, and an
 * installed extension. They are alternatives at a single point, not a pipeline:
 * `ModeHybridRetriever.maybeRerankCandidates` resolves ONE of them and runs it
 * inside ONE budget with ONE fallback.
 *
 * A second call site would quietly break three separate guarantees at once —
 * the 1200ms race would no longer bound the work, a failed reranker could be
 * retried by another stage instead of falling back to the existing order, and
 * the per-turn telemetry would describe only one of the runs. None of that
 * fails visibly: reranking has no error surface, so a doubled stage looks like
 * latency and slightly different answers.
 *
 * `ModeSpeculativeRerank.test.mjs` guards that the CALLERS gate on the flag; it
 * says nothing about how many seams exist. This pins the count.
 *
 * Comments are stripped before counting, so prose mentioning `resolvePort()` —
 * rerankerConfig.ts has one — cannot fail this, and rewording a comment cannot
 * either.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const electronDir = path.join(repoRoot, 'electron');

/** Remove block and line comments so only executable text is counted. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([^:])\/\/.*$/gm, '$1');
}

function productionSources() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) out.push(full);
    }
  };
  walk(electronDir);
  return out;
}

test('exactly one production file reaches the extension seam', () => {
  const callers = productionSources().filter((file) =>
    /\.resolvePort\s*\(/.test(stripComments(fs.readFileSync(file, 'utf8'))),
  );

  assert.deepEqual(
    callers.map((f) => path.relative(repoRoot, f)),
    ['electron/services/modes/ModeHybridRetriever.ts'],
    'an extension reranker must be resolved at one seam only. A second resolvePort() ' +
    'call means two rerank stages: the budget race no longer bounds the work, and a ' +
    'failure falls through to another stage instead of to the existing ordering.',
  );
});

test('that seam is entered from exactly one place', () => {
  const src = stripComments(
    fs.readFileSync(path.join(electronDir, 'services/modes/ModeHybridRetriever.ts'), 'utf8'),
  );

  const invocations = src.match(/this\.maybeRerankCandidates\s*\(/g) ?? [];
  assert.equal(invocations.length, 1,
    `maybeRerankCandidates is invoked ${invocations.length} times; it must be exactly once`);

  const definitions = src.match(/private\s+async\s+maybeRerankCandidates\s*\(/g) ?? [];
  assert.equal(definitions.length, 1, 'there must be exactly one seam implementation');
});

test('the seam still runs under a bounded race', () => {
  // The single call site is only safe because it is raced against a budget. If
  // the budget disappears, one seam is no better than two.
  const src = stripComments(
    fs.readFileSync(path.join(electronDir, 'services/modes/ModeHybridRetriever.ts'), 'utf8'),
  );
  assert.match(src, /RERANK_BUDGET_MS/, 'the rerank budget constant must still exist');
  assert.match(src, /Promise\.race/, 'the rerank must still be raced against that budget');

  // And the race must surround the seam, not sit elsewhere in the file.
  const callIndex = src.indexOf('this.maybeRerankCandidates(');
  const raceIndex = src.lastIndexOf('Promise.race', callIndex + 2000);
  assert.ok(
    raceIndex > -1 && Math.abs(raceIndex - callIndex) < 2000,
    'the Promise.race guarding the rerank must sit next to the seam call',
  );
});

test('the comment stripper does not itself create false results', () => {
  // A guard on the guard: if stripComments were too greedy it could delete real
  // code and make the counts above pass vacuously.
  const stripped = stripComments([
    '/* resolvePort() in a block comment */',
    '// resolvePort() in a line comment',
    'const url = "https://example.com"; // trailing',
    'thing.resolvePort();',
  ].join('\n'));

  assert.equal((stripped.match(/\.resolvePort\s*\(/g) ?? []).length, 1);
  assert.match(stripped, /https:\/\/example\.com/, 'a URL must survive comment stripping');
});
