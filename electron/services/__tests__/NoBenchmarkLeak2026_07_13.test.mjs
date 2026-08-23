// electron/services/__tests__/NoBenchmarkLeak2026_07_13.test.mjs
//
// Plan requirement (section 4): "Add a generic no-benchmark-leak check that scans
// edited product code for thesis-specific terms/fact anchors while allowlisting
// fixture/manifests/docs only." The document-grounding benchmark uses a specific
// thesis PDF; PRODUCTION retrieval/ranking code must never hardcode that thesis's
// entities, values, or field names (a benchmark that passes via hardcoded answers
// is invalid). Fixtures, tests, and docs are allowed to reference them.
//
// This is a REGRESSION GUARD for the 2026-07-13 removal of the
// `mercuryControllerScoreAdjust` / `mercuryControllerQuery` rules from
// ModeContextRetriever.ts and documentGroundedPrompt.ts. It fails if any of the
// benchmark thesis's proper nouns reappear in scanned production source.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(__dirname, '../..');

// Proper nouns / fact anchors that appear ONLY in the benchmark thesis. A match in
// production code means a thesis-specific rule leaked in. These are entities and
// values, not generic vocabulary — "voltage" or "controller" are legitimate; a
// specific model name or the exact spec value is not.
const FORBIDDEN_ANCHORS = [
  /\bmercury\s*x1\b/i,
  /\bjetson\s+(?:xavier|nano)\b/i,
  /\besp32\b/i,
  /\bopenvla(?:-oft)?\b/i,
  /\bagenticvla\b/i,
  /\bpymycobot\b/i,
  /\belephant\s+robotics\b/i,
  /\bhuawei\s+munich\b/i,
];

// Only scan production SOURCE. Tests, fixtures, docs, and the compiled bundle are
// allowed to name the thesis (they ARE the benchmark, or verify against it).
const SCAN_DIRS = ['services', 'intelligence', 'llm'];
const ALLOW_PATH = /(__tests__|\.test\.|fixtures?|test-fixtures|\.md$|dist-electron)/;

function collectSourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (ALLOW_PATH.test(full)) continue;
    if (entry.isDirectory()) out.push(...collectSourceFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

test('production retrieval/ranking source contains no benchmark-thesis-specific anchors', () => {
  const files = SCAN_DIRS.flatMap((d) => {
    const dir = path.join(electronRoot, d);
    return fs.existsSync(dir) ? collectSourceFiles(dir) : [];
  });
  assert.ok(files.length > 20, `expected to scan many production files, got ${files.length}`);

  const leaks = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    // Strip line + block comments so an illustrative EXAMPLE in a comment
    // ("e.g. a Mercury X1 controller question") does not count as a hardcoded rule.
    // Only EXECUTABLE code is a real leak.
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');
    for (const re of FORBIDDEN_ANCHORS) {
      const m = code.match(re);
      if (m) leaks.push(`${path.relative(electronRoot, file)}: "${m[0]}"`);
    }
  }

  assert.deepEqual(
    leaks,
    [],
    `Benchmark-thesis anchors found in production code (hardcoding leak):\n  ${leaks.join('\n  ')}`,
  );
});
