#!/usr/bin/env node
// Supplementary set derived mechanically from the FROZEN dev set (an addendum; the frozen datasets are untouched).
//
//   supp-oracle-sources  every dev case whose oracle names at least one reference file, asked again with ONLY the
//                        files its oracle names loaded in its mode (sources, conflict sources, the files of required,
//                        optional and forbidden facts, calculation inputs). Same question, same profile state, same
//                        upload path. It holds the question fixed and removes the choice among 6–9 files, so the
//                        difference to the baseline row is what passage selection cost.
//   node evidence-rich/build-supp.mjs oracle-sources
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const dev = readJson(path.join(HERE, 'datasets', 'dev.json'));
const man = readJson(path.join(HERE, 'oracles', 'evidence-manifest.json'));
const files = new Map(man.files.map((f) => [f.id, f]));
const isRef = (id) => files.has(id) && files.get(id).mode !== 'profiles';
function named(it) {
  const o = it.oracle ?? {};
  const ids = [...(o.source_ids ?? []), ...(o.source_priority ?? []), ...(o.known_conflicts ?? []).flatMap((k) => k.sources ?? []),
    ...[...(o.required_facts ?? []), ...(o.optional_facts ?? []), ...(o.forbidden_claims ?? [])].map((x) => String(x.fact ?? '').split('#')[0]),
    ...Object.values(o.calculation_oracle?.inputs ?? {}).flat().map((v) => String(v).split('#')[0])];
  return [...new Set(ids.filter((id) => isRef(id) && files.get(id).mode === it.mode))];
}
const groups = new Map(); // a chain shares one config: the union of its turns' files
for (const it of dev.items) { const g = it.conversation_id ?? it.id; const s = groups.get(g) ?? new Set(); for (const id of named(it)) s.add(id); groups.set(g, s); }
const loadedBefore = new Map(dev.configs.map((c) => [c.id, new Set(c.files)]));
const configs = [...dev.configs]; const items = [];
for (const it of dev.items) {
  const g = it.conversation_id ?? it.id; const want = [...groups.get(g)];
  if (!want.length) continue; // nothing of the mode's files is named: not a reference-evidence case
  // only files that were loaded in the original case (an oracle may name a file as "must not be used" that the case never loaded)
  const had = loadedBefore.get(it.evidence_config) ?? new Set();
  const keep = want.filter((id) => had.has(id));
  if (!keep.length) continue;
  const cid = `os-${g}`;
  if (!configs.some((c) => c.id === cid)) configs.push({ id: cid, mode: it.mode, base: false, files: keep.sort() });
  items.push({ ...it, partition: 'supp-oracle-sources', evidence_config: cid, derived_from: { partition: 'dev', evidence_config: it.evidence_config } });
}
const body = { schema_version: 1, partition: 'supp-oracle-sources', manifest_sha256: man.manifest_sha256, derived_from: { dataset: 'dev', sha256: dev.dataset_sha256 }, modes: dev.modes, configs, items };
const h = sha256(JSON.stringify(body));
fs.writeFileSync(path.join(HERE, 'datasets', 'supp-oracle-sources.json'), JSON.stringify({ dataset_name: 'evidence-rich-v1-supp-oracle-sources', dataset_sha256: h, ...body }, null, 1));
const fr = readJson(path.join(HERE, 'FREEZE.json'));
fr.addenda = { ...(fr.addenda ?? {}), 'supp-oracle-sources': { items: items.length, sha256: h, built_at: new Date().toISOString(), derived_from: 'dev (same questions and oracles; only the files loaded in the case\'s own mode change)' } };
fs.writeFileSync(path.join(HERE, 'FREEZE.json'), JSON.stringify(fr, null, 1));
const n = items.map((i) => configs.find((c) => c.id === i.evidence_config).files.length);
const by = {}; for (const i of items) by[i.mode] = (by[i.mode] ?? 0) + 1;
console.log(`supp-oracle-sources: ${items.length} items, ${h.slice(0, 12)}; files per case: ${[1, 2, 3, 4, 5].map((k) => `${k}:${n.filter((x) => x === k).length}`).join(' ')} more:${n.filter((x) => x > 5).length}`);
console.log(by);
