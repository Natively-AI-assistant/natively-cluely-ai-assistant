#!/usr/bin/env node
// Compiles authored sources into FROZEN, content-hashed partition files:
//   dev.json      <- dev/*.json
//   holdout.json  <- holdout/*.json
//   final.json    <- the v1 frozen 848 (unchanged) + final/general.json + final/*-hard.json
// Validates references, chains, PI ids and that every needle occurs verbatim in the material it came from.
//   node build.mjs [dev|holdout|final ...] [--check]   (--check: validate only, write nothing)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const V1 = path.join(HERE, '..', '..', 'natively-answer-baseline', 'dataset', 'natively_benchmark_questions.json');
const sha256 = (s) => crypto.createHash('sha256').update(s ?? '', 'utf8').digest('hex');
const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const parts = args.filter(a => !a.startsWith('--'));
const WANT = parts.length ? parts : ['dev', 'holdout', 'final'];

const MODES = [
  { key: 'general', name: 'General' }, { key: 'sales', name: 'Sales' }, { key: 'recruiting', name: 'Recruiting' },
  { key: 'team-meet', name: 'Team Meet' }, { key: 'looking-for-work', name: 'Looking for work' }, { key: 'lecture', name: 'Lecture' },
  { key: 'technical-interview', name: 'Technical Interview' }, { key: 'seminar', name: 'Seminar' }, { key: 'call-center', name: 'Call Center' },
];
const MODE_NAME = Object.fromEntries(MODES.map(m => [m.key, m.name]));
const PI_ELIGIBLE = new Set(['looking-for-work', 'technical-interview']);

const pi = JSON.parse(fs.readFileSync(path.join(HERE, 'pi', 'profiles.json'), 'utf8'));
const PI_IDS = new Set();
for (const p of pi.profiles) { PI_IDS.add(p.id); PI_IDS.add(`${p.id}-RESUME`); PI_IDS.add(`${p.id}-JD`); }
const piText = (ref) => {
  if (!ref) return '';
  const base = pi.profiles.find(p => ref === p.id || ref.startsWith(p.id + '-'));
  if (!base) return '';
  if (ref.endsWith('-RESUME')) return base.resume.text;
  if (ref.endsWith('-JD')) return base.jd.text;
  return base.resume.text + '\n' + base.jd.text;
};
const norm = (s) => String(s ?? '').toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ');

function loadSources(dir) {
  const d = path.join(HERE, dir);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => f.endsWith('.json')).sort().map(f => ({ file: path.join(dir, f), ...JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')) }));
}

function compileSources(sources, partition) {
  const contexts = {}; const items = []; const problems = [];
  for (const src of sources) {
    const mode = src.mode;
    if (!MODE_NAME[mode]) { problems.push(`${src.file}: unknown mode ${mode}`); continue; }
    for (const c of src.contexts ?? []) {
      if (contexts[c.id]) problems.push(`${src.file}: duplicate context id ${c.id}`);
      contexts[c.id] = { ...c, mode, sha256: sha256(c.text), word_count: c.text.trim().split(/\s+/).length };
    }
    for (const it of src.items ?? []) {
      const id = it.local_id;
      const pfx = id.replace(/-\d+$/, '');
      const conv = it.chain_id ? `${pfx}-${it.chain_id}` : null;
      items.push({
        id, mode, mode_name: MODE_NAME[mode], partition: src.partition ?? partition, source_file: src.file,
        category: it.category, difficulty: it.difficulty, length_class: it.length_class,
        speaker: it.speaker, surface: it.speaker === 'other' ? 'hotkey' : 'typed',
        question: it.question, context_condition: it.context_condition, context_type: it.context_ref ? 'document' : it.prior_transcript ? 'transcript' : 'none',
        context_ref: it.context_ref ?? null, prior_transcript: it.prior_transcript ?? null,
        conversation_id: conv, turn_index: it.turn_index ?? 1,
        cross_mode_test: false, cross_mode_group: null,
        tags: it.tags ?? [], expected_answer_type: it.expected_answer_type ?? null,
        claim_trap: it.claim_trap ?? 'none', needles: it.needles ?? [], evidence_required: !!it.evidence_required,
        pi_ref: it.pi_ref ?? null, pi_eligible: PI_ELIGIBLE.has(mode),
      });
    }
  }
  return { contexts, items, problems };
}

function validate(ds) {
  const problems = [];
  const ids = new Set();
  const chains = {};
  for (const it of ds.items) {
    if (ids.has(it.id)) problems.push(`duplicate id ${it.id}`); ids.add(it.id);
    if (!['other', 'user'].includes(it.speaker)) problems.push(`${it.id}: bad speaker ${it.speaker}`);
    if (!it.question?.trim()) problems.push(`${it.id}: empty question`);
    if (it.context_ref && !ds.contexts[it.context_ref]) problems.push(`${it.id}: unknown context ${it.context_ref}`);
    if (it.pi_ref && !PI_IDS.has(it.pi_ref)) problems.push(`${it.id}: unknown pi_ref ${it.pi_ref}`);
    if (it.conversation_id) (chains[it.conversation_id] ??= []).push(it);
    // needles must be findable in the material the item carries (its chain's turn-1 material for later turns)
    if (it.needles?.length) {
      const head = it.conversation_id ? ds.items.find(x => x.conversation_id === it.conversation_id && x.turn_index === 1) ?? it : it;
      const material = norm([
        head.context_ref ? ds.contexts[head.context_ref]?.text : '',
        ...(head.prior_transcript ?? []).map(l => l.text),
        piText(it.pi_ref ?? head.pi_ref),
        it.question,
      ].join('\n'));
      for (const n of it.needles) if (!material.includes(norm(n))) problems.push(`${it.id}: needle not in material: ${JSON.stringify(n)}`);
    }
  }
  for (const [cid, turns] of Object.entries(chains)) {
    const idx = turns.map(t => t.turn_index).sort((a, b) => a - b);
    if (idx.some((v, i) => v !== i + 1)) problems.push(`chain ${cid}: turn indexes ${idx}`);
    if (new Set(turns.map(t => t.speaker)).size > 1) problems.push(`chain ${cid}: mixed speakers`);
    if (new Set(turns.map(t => t.mode)).size > 1) problems.push(`chain ${cid}: mixed modes`);
  }
  return problems;
}

function freeze(name, partition, ds) {
  const body = { schema_version: 2, partition, modes: MODES.filter(m => ds.items.some(i => i.mode === m.key)), pi_profiles: pi.profiles, contexts: ds.contexts, items: ds.items };
  const dataset_sha256 = sha256(JSON.stringify(body));
  return { dataset_name: name, dataset_sha256, ...body };
}

function report(label, ds) {
  const by = (k) => ds.items.reduce((o, i) => ((o[i[k] ?? 'null'] = (o[i[k] ?? 'null'] ?? 0) + 1), o), {});
  console.log(`\n== ${label}: ${ds.items.length} items, ${Object.keys(ds.contexts).length} contexts`);
  for (const k of ['mode', 'context_condition', 'speaker', 'claim_trap', 'pi_ref', 'partition']) console.log(`  ${k}:`, JSON.stringify(by(k)));
  console.log(`  chains: ${new Set(ds.items.filter(i => i.conversation_id).map(i => i.conversation_id)).size}, with needles: ${ds.items.filter(i => i.needles?.length).length}`);
}

let failed = false;
for (const part of WANT) {
  let ds;
  if (part === 'final') {
    const v1 = JSON.parse(fs.readFileSync(V1, 'utf8'));
    const side = fs.existsSync(path.join(HERE, 'v1-annotations.json')) ? JSON.parse(fs.readFileSync(path.join(HERE, 'v1-annotations.json'), 'utf8')) : {};
    const frozen = v1.items.map(i => ({
      ...i, partition: 'final-frozen', source_file: 'v1', claim_trap: side[i.id]?.claim_trap ?? null, needles: side[i.id]?.needles ?? [],
      evidence_required: side[i.id]?.evidence_required ?? null, pi_ref: null, pi_eligible: PI_ELIGIBLE.has(i.mode),
    }));
    const extra = compileSources(loadSources('final'), 'final');
    ds = { contexts: { ...Object.fromEntries(Object.entries(v1.contexts).map(([k, c]) => [k, { ...c }])), ...extra.contexts }, items: [...frozen, ...extra.items] };
    extra.problems.forEach(p => console.log('  source problem:', p));
  } else {
    const c = compileSources(loadSources(part), part);
    c.problems.forEach(p => console.log('  source problem:', p));
    ds = { contexts: c.contexts, items: c.items };
  }
  const problems = validate(ds);
  report(part, ds);
  if (problems.length) { failed = true; console.log(`  ${problems.length} problem(s):`); problems.slice(0, 60).forEach(p => console.log('   -', p)); }
  if (!CHECK) {
    const out = freeze(`natively-answer-quality-${part}`, part, ds);
    fs.writeFileSync(path.join(HERE, `${part}.json`), JSON.stringify(out, null, 1));
    console.log(`  wrote ${part}.json sha256 ${out.dataset_sha256.slice(0, 12)}`);
  }
}
process.exit(failed && CHECK ? 1 : 0);
