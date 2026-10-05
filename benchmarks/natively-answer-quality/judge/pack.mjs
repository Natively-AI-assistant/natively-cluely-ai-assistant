#!/usr/bin/env node
// Builds BLIND judge batches from one or more run directories.
//   node judge/pack.mjs --name <batchset> --runs results/<run1>[,results/<run2>...] [--size 20] [--ids a,b] [--sample N --seed s]
// The judge sees: mode, role, surface, question, conversation, evidence, forbidden material, answer (gist stripped).
// It never sees run ids, iteration, commit, timing, or which system produced the answer. Answers to the SAME item from
// different runs are placed in DIFFERENT batches, and order is shuffled with a seeded RNG.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const name = opt('name'); if (!name) throw new Error('--name required');
const runs = String(opt('runs', '')).split(',').filter(Boolean).map(r => path.resolve(ROOT, r));
const SIZE = Number(opt('size', 20));
const seed = opt('seed', name);
const onlyIds = opt('ids') ? new Set(opt('ids').split(',')) : null;
const sampleN = opt('sample') ? Number(opt('sample')) : null;

let s = crypto.createHash('sha256').update(seed).digest().readUInt32LE(0);
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export const ROLES = {
  general: 'USER: anyone, no specialised role. OTHER PARTY: whoever they are talking to. Natively: the most useful next thing, following the actual situation, no forced persona.',
  sales: 'USER: the seller / account executive. OTHER PARTY: the prospect / customer. Natively: words the seller can say next (or private help when the seller types).',
  recruiting: 'USER: the recruiter / interviewer. OTHER PARTY: the candidate. Natively: helps the recruiter — the next probe, an evaluation of the answer, or the recruiter\'s own answer when the CANDIDATE asks the recruiter something.',
  'team-meet': 'USER: a team member or lead in a meeting. OTHER PARTY: colleagues. Natively: constructive words for the user in the meeting.',
  'looking-for-work': 'USER: the job candidate. OTHER PARTY: the interviewer / recruiter. Natively: what the candidate says, in first person. Résumé/JD (if in evidence) are the candidate\'s own.',
  lecture: 'USER: a student / learner. OTHER PARTY: the professor (lecture audio). Natively: private explanation for the student; need not be speakable.',
  'technical-interview': 'USER: the candidate. OTHER PARTY: the technical interviewer. Natively: explanation, reasoning, code, complexity, system design the candidate can use. Résumé/JD (if in evidence) are the candidate\'s own.',
  seminar: 'USER: the presenter / researcher defending their work. OTHER PARTY: examiner / audience. Natively: the presenter\'s answer, grounded in the attached material.',
  'call-center': 'USER: the support agent. OTHER PARTY: the customer. Natively: words the agent says next (short, customer-facing), or private help when the agent types.',
};
const OTHER_LABEL = { general: 'OTHER PERSON', sales: 'PROSPECT', recruiting: 'CANDIDATE', 'team-meet': 'COLLEAGUE', 'looking-for-work': 'INTERVIEWER', lecture: 'PROFESSOR', 'technical-interview': 'INTERVIEWER', seminar: 'EXAMINER', 'call-center': 'CUSTOMER' };
const stripGist = (t) => String(t ?? '').replace(/\[\[GIST\]\][\s\S]*$/, '').trim();
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

const records = [];
const datasets = {};
for (const dir of runs) {
  const header = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
  const dsFile = path.resolve(ROOT, header.dataset_file);
  const ds = datasets[dsFile] ??= JSON.parse(fs.readFileSync(dsFile, 'utf8'));
  const items = Object.fromEntries(ds.items.map(i => [i.id, i]));
  const rows = readJsonl(path.join(dir, 'natively_benchmark_full.jsonl'));
  const byId = Object.fromEntries(rows.map(r => [r.benchmark_id, r]));
  for (const r of rows) {
    if (onlyIds && !onlyIds.has(r.benchmark_id)) continue;
    const it = items[r.benchmark_id];
    if (!it) continue;
    const head = it.conversation_id ? ds.items.find(x => x.conversation_id === it.conversation_id && x.turn_index === 1) : it;
    const conv = [];
    const other = OTHER_LABEL[it.mode];
    for (const l of head.prior_transcript ?? []) conv.push(`${l.speaker === 'other' ? other : 'USER (spoken)'}: ${l.text}`);
    if (it.conversation_id) {
      for (const p of ds.items.filter(x => x.conversation_id === it.conversation_id && x.turn_index < it.turn_index).sort((a, b) => a.turn_index - b.turn_index)) {
        conv.push(`${p.speaker === 'other' ? other + ' (heard)' : 'USER (typed to Natively)'}: ${p.question}`);
        const pr = byId[p.id];
        conv.push(`NATIVELY: ${stripGist(pr?.rendered_answer ?? pr?.raw_answer ?? '')}`);
      }
    }
    const ctxRef = head.context_ref;
    const piRef = it.pi_ref ?? head.pi_ref ?? null;
    const evidence = [];
    const forbidden = [];
    if (ctxRef) evidence.push(ctxRef);
    if (piRef) {
      const p = ds.pi_profiles.find(x => piRef === x.id || piRef.startsWith(x.id + '-'));
      const docs = piRef.endsWith('-RESUME') ? ['RESUME'] : piRef.endsWith('-JD') ? ['JD'] : ['RESUME', 'JD'];
      for (const d of docs) (it.pi_eligible ? evidence : forbidden).push(`${p.id}:${d}`);
    }
    const answer = r.rendered_answer ?? r.raw_answer ?? '';
    const jid = crypto.createHash('sha256').update(`${header.run_id}|${r.benchmark_id}`).digest('hex').slice(0, 12);
    records.push({
      jid, run_id: header.run_id, benchmark_id: r.benchmark_id, dsFile,
      item: {
        jid, mode: it.mode, role: ROLES[it.mode], surface: it.speaker === 'other' ? 'heard' : 'typed',
        question: it.question, conversation: conv, evidence_ids: evidence, forbidden_ids: forbidden,
        answer: stripGist(answer) || '(empty response)',
      },
    });
  }
}

let pool = records;
if (sampleN) pool = shuffle([...new Set(records.map(r => r.benchmark_id))]).slice(0, sampleN).flatMap(id => records.filter(r => r.benchmark_id === id));

// Batches per mode; the same benchmark_id never twice in one batch.
const outDir = path.join(HERE, 'batches', name);
fs.mkdirSync(outDir, { recursive: true });
const map = {};
let bn = 0;
const modes = [...new Set(pool.map(r => r.item.mode))];
for (const mode of modes) {
  const recs = shuffle(pool.filter(r => r.item.mode === mode));
  const batches = [];
  for (const r of recs) {
    let b = batches.find(b => b.length < SIZE && !b.some(x => x.benchmark_id === r.benchmark_id));
    if (!b) { b = []; batches.push(b); }
    b.push(r);
  }
  for (const b of batches) {
    const id = `b${String(++bn).padStart(3, '0')}-${mode}`;
    const lib = {};
    for (const r of b) {
      const ds = datasets[r.dsFile];
      for (const e of [...r.item.evidence_ids, ...r.item.forbidden_ids]) {
        if (lib[e]) continue;
        if (e.includes(':')) {
          const [pid, kind] = e.split(':');
          const p = ds.pi_profiles.find(x => x.id === pid);
          lib[e] = { title: kind === 'RESUME' ? `the user's résumé (${p.candidate_name})` : `the job description the user is targeting`, text: kind === 'RESUME' ? p.resume.text : p.jd.text };
        } else lib[e] = { title: ds.contexts[e].title, text: ds.contexts[e].text };
      }
    }
    fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify({ batch: id, instructions: 'Judge every item per CHARTER.md. evidence_ids / forbidden_ids refer to material_library.', material_library: lib, items: b.map(r => r.item) }, null, 1));
    for (const r of b) map[r.jid] = { run_id: r.run_id, benchmark_id: r.benchmark_id, batch: id };
  }
}
fs.mkdirSync(path.join(HERE, 'maps'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'maps', `${name}.json`), JSON.stringify(map));
console.log(`${Object.keys(map).length} items -> ${bn} batches in ${path.relative(ROOT, outDir)}`);
