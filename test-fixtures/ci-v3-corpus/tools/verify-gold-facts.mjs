// Verifies every goldFacts string in questions.json appears VERBATIM in its goldDoc.
//
// The whole Phase 2 scoring model rests on this invariant (see SCHEMA.md): a chunk
// counts as gold iff it contains a goldFacts substring. If a goldFact is not
// actually in the document, every configuration scores a false miss on that
// question and the benchmark silently understates recall across the board.
//
// Run:  node test-fixtures/ci-v3-corpus/tools/verify-gold-facts.mjs
// Exit: 0 = all facts located, 1 = at least one unlocatable

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const bank = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'questions.json'), 'utf8'));

// Normalisation must match the scorer's. PDF extraction mangles whitespace and
// ligatures, so compare on a collapsed, case-folded form. We deliberately do NOT
// strip punctuation: "44%" and "N = 6" depend on it.
const norm = (s) => String(s)
  .replace(/ /g, ' ')
  .replace(/[‐-―]/g, '-')   // unicode dashes -> hyphen
  .replace(/[‘’]/g, "'")
  .replace(/[“”]/g, '"')
  .replace(/\s+/g, ' ')
  .toLowerCase()
  .trim();

const textCache = new Map();

// Use the PRODUCTION extractor, not a standalone PDF library. Gold labels must be
// verified against the exact text the app itself indexes — otherwise a fact could
// verify here and still be unreachable at retrieval time because the real parser
// renders it differently (ligatures, column order, table flattening).
const { extractSafeDocumentText } = require(
  path.join(repoRoot, 'dist-electron/electron/services/SafeDocumentTextExtractor.js'),
);

async function extract(relPath) {
  if (textCache.has(relPath)) return textCache.get(relPath);
  const abs = path.join(repoRoot, relPath);
  if (!fs.existsSync(abs)) throw new Error(`missing fixture: ${relPath}`);
  const result = await extractSafeDocumentText(abs);
  const text = typeof result === 'string' ? result : (result?.content ?? '');
  textCache.set(relPath, text);
  return text;
}

const results = [];
for (const q of bank.questions) {
  if (!q.goldDoc || !q.goldFacts?.length) {
    results.push({ id: q.id, status: 'SKIP', detail: 'no goldDoc/goldFacts (negative or judge-scored case)' });
    continue;
  }
  let text;
  try {
    text = norm(await extract(q.goldDoc));
  } catch (e) {
    results.push({ id: q.id, status: 'ERROR', detail: e.message });
    continue;
  }
  // A question passes if AT LEAST ONE goldFact is locatable — alternates like
  // ["N = 6", "N=6"] exist precisely because PDF extraction spacing is unstable.
  const found = q.goldFacts.filter((f) => text.includes(norm(f)));
  const missing = q.goldFacts.filter((f) => !text.includes(norm(f)));
  results.push({
    id: q.id,
    status: found.length ? 'OK' : 'FAIL',
    detail: found.length
      ? `${found.length}/${q.goldFacts.length} located` + (missing.length ? ` (absent: ${JSON.stringify(missing)})` : '')
      : `NONE of ${JSON.stringify(q.goldFacts)} found in ${q.goldDoc}`,
  });
}

const w = (s, n) => String(s).padEnd(n);
console.log(`${w('ID', 8)}${w('STATUS', 8)}DETAIL`);
for (const r of results) console.log(`${w(r.id, 8)}${w(r.status, 8)}${r.detail}`);

const fails = results.filter((r) => r.status === 'FAIL' || r.status === 'ERROR');
console.log(`\n${results.filter((r) => r.status === 'OK').length} ok · ${results.filter((r) => r.status === 'SKIP').length} skipped · ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
