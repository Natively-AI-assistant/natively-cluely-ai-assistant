#!/usr/bin/env node
// Writes docs/EVIDENCE-CORPUS.md from the frozen manifest and datasets: every synthetic artifact, its status, its
// main facts, its intended conflicts and which benchmark categories rest on it. Holdout use is counted, never listed.
//   node evidence-rich/corpus-doc.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const man = readJson(path.join(HERE, 'oracles', 'evidence-manifest.json'));
const fr = readJson(path.join(HERE, 'FREEZE.json'));
const sets = Object.fromEntries(['dev', 'holdout', 'supp-counterfactual', 'supp-isolation'].map((s) => [s, readJson(path.join(HERE, 'datasets', `${s}.json`))]));
const NAMES = { general: 'General', sales: 'Sales', recruiting: 'Recruiting', 'team-meet': 'Team Meet', 'looking-for-work': 'Looking for work', lecture: 'Lecture', 'technical-interview': 'Technical Interview', seminar: 'Seminar', 'call-center': 'Call Center', profiles: 'Profile Intelligence (résumé + job description)' };
const use = {};
for (const [s, ds] of Object.entries(sets)) for (const it of ds.items) {
  const ids = new Set([...(it.oracle?.source_ids ?? []), ...(it.oracle?.required_facts ?? []).map((r) => String(r.fact).split('#')[0]), ...(it.oracle?.forbidden_claims ?? []).map((r) => String(r.fact ?? '').split('#')[0])]);
  for (const id of ids) { const u = (use[id] ??= { dev: 0, holdout: 0, 'supp-counterfactual': 0, 'supp-isolation': 0, cats: new Set(), conds: new Set() }); u[s]++; if (s !== 'holdout') { if (it.category) u.cats.add(it.category); u.conds.add(it.condition); } }
}
const L = [];
L.push('# Evidence corpus — evidence-rich-v1', '');
L.push(`Frozen ${fr.frozen_at}. Manifest \`${man.manifest_sha256.slice(0, 12)}\`. Everything here is synthetic: invented people, companies, projects and policies. Nothing in this index is visible to Natively; it sees only the uploaded files.`, '');
const base = man.files.filter((f) => !f.variant_of);
L.push('| Mode | Files | of them outdated / draft / informal | Words | Facts recorded | Counterfactual variants |', '|---|---:|---:|---:|---:|---:|');
for (const m of Object.keys(NAMES)) {
  const fs_ = base.filter((f) => f.mode === m); if (!fs_.length) continue;
  L.push(`| ${NAMES[m]} | ${fs_.length} | ${fs_.filter((f) => f.status !== 'current').length} | ${fs_.reduce((n, f) => n + (f.words ?? 0), 0)} | ${fs_.reduce((n, f) => n + f.facts.length, 0)} | ${man.files.filter((f) => f.variant_of && f.mode === m).length} |`);
}
L.push(`| **All** | ${base.length} | ${base.filter((f) => f.status !== 'current').length} | ${base.reduce((n, f) => n + (f.words ?? 0), 0)} | ${base.reduce((n, f) => n + f.facts.length, 0)} | ${man.files.filter((f) => f.variant_of).length} |`, '');
L.push(`Datasets: ${Object.entries(fr.datasets).map(([k, v]) => `${k} ${v.items}`).join(', ')}.`, '');
for (const m of Object.keys(NAMES)) {
  const fs_ = man.files.filter((f) => f.mode === m); if (!fs_.length) continue;
  L.push(`## ${NAMES[m]}`, '');
  if (man.worlds?.[m]) L.push(man.worlds[m], '');
  for (const f of fs_.filter((x) => !x.variant_of)) {
    const u = use[f.id];
    L.push(`### ${f.id}`, '');
    L.push(`* File: \`${f.filename}\` (${f.format}, ${f.words ?? '?'} words). ${f.title ?? ''}`);
    L.push(`* Status: **${f.status}**${f.effective_date ? `, dated ${f.effective_date}` : ''}, authority ${f.authority}${f.supersedes?.length ? `, supersedes ${f.supersedes.join(', ')}` : ''}. Type: ${f.document_type ?? 'n/a'}.`);
    L.push(`* Purpose and main facts (${f.facts.length} recorded): ${f.facts.slice(0, 6).map((x) => x.statement).join(' ')}${f.facts.length > 6 ? ' …' : ''}`);
    if (f.intentional_conflicts?.length) L.push(`* Intended conflicts: ${f.intentional_conflicts.map((c) => `${c.this_value ?? '?'} here vs ${c.other_value ?? '?'} in ${c.with_file} (${c.resolution})`).join('; ')}.`);
    if (f.must_not_infer?.length) L.push(`* Must not be inferred: ${f.must_not_infer.join(' ')}`);
    L.push(`* Used by: ${u ? `dev ${u.dev}, holdout ${u.holdout}, counterfactual ${u['supp-counterfactual']}, isolation ${u['supp-isolation']} items; categories: ${[...u.cats].sort().join(', ') || 'n/a'}; conditions: ${[...u.conds].sort().join(', ') || 'n/a'}` : 'no item directly (background / distractor material)'}.`);
    const vs = fs_.filter((x) => x.variant_of === f.id);
    if (vs.length) L.push(`* Counterfactual variants: ${vs.map((v) => `\`${v.id}\` (${v.variant_note ?? 'changed lines'})`).join('; ')}.`);
    L.push('');
  }
}
fs.mkdirSync(path.join(HERE, 'docs'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'docs', 'EVIDENCE-CORPUS.md'), L.join('\n') + '\n');
console.log(`docs/EVIDENCE-CORPUS.md written: ${base.length} files, ${man.files.length - base.length} variants`);
