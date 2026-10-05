#!/usr/bin/env node
// Recompute lexical detectors over replay files (detectors evolve; answers do not). node tools/redetect.mjs a.jsonl b.jsonl [--mode m]
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { lexicalDetectors } from '../validators/lexical.mjs';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const items = {}; for (const p of ['dev', 'holdout', 'final', 'supp-quant', 'supp-behavior']) { const f = path.join(ROOT, 'dataset', p + '.json'); if (fs.existsSync(f)) for (const i of JSON.parse(fs.readFileSync(f, 'utf8')).items) items[i.id] = i; }
const args = process.argv.slice(2); const mi = args.indexOf('--mode'); const mode = mi >= 0 ? args[mi + 1] : null;
for (const f of args.filter((a, i) => a.endsWith('.jsonl'))) {
  const rs = fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !mode || r.mode === mode);
  const agg = {};
  for (const r of rs) { const d = lexicalDetectors(r.answer, items[r.id]); const a = (agg[r.mode] ??= { n: 0, epistemic: 0, source_exposure: 0, coaching: 0, meta: 0, any: 0 }); a.n++; let any = false; for (const k of ['epistemic', 'source_exposure', 'coaching', 'meta']) if (d[k]) { a[k]++; any = true; } if (any) a.any++; }
  console.log(path.basename(f)); console.table(agg);
}
