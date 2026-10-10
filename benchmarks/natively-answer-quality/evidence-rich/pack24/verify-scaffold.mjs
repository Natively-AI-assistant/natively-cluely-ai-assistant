#!/usr/bin/env node
// pack24: is the frozen part of each enlarged pack exactly what the frozen benchmark holds?
//   node evidence-rich/pack24/verify-scaffold.mjs
// Per mode: every frozen manifest entry deep-equal to authoring/<mode>/manifest.json, every frozen source byte-identical,
// p24.json equal to the items re-derived from the frozen dev / dev2 / challenge files, the config made of this mode's
// files only, every new file id of this mode's prefix, and the pack's size as the app counts it.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const ER = path.join(HERE, '..');
const MODES = { sales: 'SALES', 'call-center': 'CC', lecture: 'LEC', seminar: 'SEM' };
const J = (f) => JSON.parse(fs.readFileSync(f, 'utf8')); const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 12);
let bad = 0; const fail = (s) => { bad++; console.log('  PROBLEM ' + s); };
for (const [mode, pfx] of Object.entries(MODES)) {
  const src = path.join(ER, 'authoring', mode), dst = path.join(HERE, 'authoring', mode);
  const frozen = J(path.join(src, 'manifest.json')); const base = J(path.join(src, 'configs.json')).find((c) => c.base);
  const man = J(path.join(dst, 'manifest.json')); const cfgs = J(path.join(dst, 'configs.json'));
  console.log(`${mode}:`);
  if (man.world !== frozen.world) fail('world line differs');
  const byId = new Map(man.files.map((f) => [f.id, f]));
  for (const id of base.files) {
    const a = frozen.files.find((f) => f.id === id), b = byId.get(id);
    if (!b) { fail(`frozen file ${id} missing from the manifest`); continue; }
    if (JSON.stringify(a) !== JSON.stringify(b)) fail(`frozen manifest entry ${id} differs`);
    const s = a.source ?? `src/${a.id}.md`;
    if (!fs.existsSync(path.join(dst, s)) || !fs.readFileSync(path.join(src, s)).equals(fs.readFileSync(path.join(dst, s)))) fail(`frozen source ${s} differs`);
  }
  const added = man.files.filter((f) => !base.files.includes(f.id));
  for (const f of added) { if (!f.id.startsWith(`${pfx}-REF-`)) fail(`added file ${f.id} is not of this mode`); if (f.mode !== mode) fail(`added file ${f.id} has mode ${f.mode}`); if (frozen.files.some((x) => x.id === f.id)) fail(`added file ${f.id} reuses a frozen id`); }
  if (cfgs.length !== 1 || cfgs[0].id !== `${mode}-p24` || !cfgs[0].base) fail('configs.json is not the one enlarged base config');
  const want = [...base.files, ...added.map((f) => f.id)].sort().join(','); if ([...(cfgs[0]?.files ?? [])].sort().join(',') !== want) fail('the config does not list exactly the frozen files plus the added ones');
  // p24.json re-derived
  const items = [];
  for (const [file, tag] of [['dev.json', 'D'], ['dev2.json', 'D2'], ['challenge.json', 'C1']]) for (const it of J(path.join(src, file)).items) {
    if (it.evidence_config !== base.id || (it.pi_state ?? 'none') !== 'none') continue;
    items.push({ ...it, id: `ER-P24-${pfx}-${tag}-${it.id.match(/-(\d+)$/)[1]}`, derived_from: it.id, evidence_config: `${mode}-p24`, conversation_id: it.conversation_id ? `P24-${it.conversation_id}` : it.conversation_id });
  }
  if (JSON.stringify({ mode, items }, null, 1) !== fs.readFileSync(path.join(dst, 'p24.json'), 'utf8')) fail('p24.json is not the re-derived frozen items');
  const nw = fs.existsSync(path.join(dst, 'p24-new.json')) ? J(path.join(dst, 'p24-new.json')).items : [];
  for (const it of nw) { if (!new RegExp(`^ER-P24-${pfx}-N-\\d{3}$`).test(it.id)) fail(`new item id ${it.id}`); if (it.evidence_config !== `${mode}-p24` || it.mode !== mode) fail(`new item ${it.id} config or mode`); }
  const chars = man.files.reduce((n, f) => n + fs.readFileSync(path.join(dst, f.source ?? `src/${f.id}.md`), 'utf8').length, 0);
  const stray = fs.readdirSync(path.join(dst, 'src')).filter((n) => !man.files.some((f) => path.basename(f.source ?? `src/${f.id}.md`) === n)); if (stray.length) fail(`files in src/ that no manifest entry names: ${stray.join(', ')}`);
  console.log(`  frozen files ${base.files.length}, added ${added.length} (${added.map((f) => `${f.id.replace(`${pfx}-REF-`, '')}:${f.format}:${f.status}`).join(' ')}); derived items ${items.length}, new items ${nw.length}; source characters ${chars} (about ${Math.ceil(chars / 4)} tokens); p24.json ${sha(fs.readFileSync(path.join(dst, 'p24.json')))}`);
}
console.log(bad ? `\n${bad} problem(s)` : '\nscaffold intact: every frozen entry, source and derived item is unchanged');
process.exit(bad ? 1 : 0);
