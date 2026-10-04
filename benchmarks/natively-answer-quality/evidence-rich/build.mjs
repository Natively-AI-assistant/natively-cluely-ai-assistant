#!/usr/bin/env node
// evidence-rich-v1: turn the authored sources into the files a user would upload, lint the authored truth, and
// freeze the datasets.
//
//   node evidence-rich/build.mjs lint                  check authoring/ (dev in detail; holdout as counts only)
//   node evidence-rich/build.mjs evidence [--only ID]  build evidence/ from authoring/*/src (PDF, DOCX, text)
//   node evidence-rich/build.mjs freeze                write oracles/ + datasets/ with hashes (refuses on lint errors)
//   node evidence-rich/build.mjs verify                re-hash evidence/ and datasets/ against FREEZE.json
//
// Layout (see README.md):
//   authoring/            authored truth: manifests with facts, sources, configs, items. NEVER reaches the app.
//   authoring-holdout/    the blind items. The engineer never reads them; this script prints counts only and writes
//                         the detailed findings to authoring-holdout/<mode>/lint.txt for the author.
//   evidence/             ONLY what a user would upload. This directory is NATIVELY_E2E_REFERENCE_ROOT, so nothing
//                         outside it can be ingested by the app's fixture upload hook.
//   oracles/, datasets/   the frozen truth and questions, for the runner and the judge.
//
// PDF and DOCX are produced on macOS (headless Chrome, textutil). That is an authoring step: the produced binaries
// are committed and hashed, and the run itself uses only those files, on any platform.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AUTH = path.join(HERE, 'authoring');
const AUTH_H = path.join(HERE, 'authoring-holdout');
const EVID = path.join(HERE, 'evidence');
// ER_BENCH_DIR: write the frozen truth somewhere else (a smoke test of the rig on a partial corpus); default is here.
const OUT = process.env.ER_BENCH_DIR ? path.resolve(process.env.ER_BENCH_DIR) : HERE;
const ORACLES = path.join(OUT, 'oracles');
const DATASETS = path.join(OUT, 'datasets');
const APP_ROOT = path.resolve(process.env.ER_APP_ROOT || path.join(HERE, '..', '..', '..', '..', 'aq-fix2'));
const requireApp = createRequire(path.join(APP_ROOT, 'package.json'));

export const MODES = [
  { key: 'general', name: 'General', pfx: 'GEN' }, { key: 'sales', name: 'Sales', pfx: 'SALES' },
  { key: 'recruiting', name: 'Recruiting', pfx: 'REC' }, { key: 'team-meet', name: 'Team Meet', pfx: 'TEAM' },
  { key: 'looking-for-work', name: 'Looking for work', pfx: 'LFW' }, { key: 'lecture', name: 'Lecture', pfx: 'LEC' },
  { key: 'technical-interview', name: 'Technical Interview', pfx: 'TI' }, { key: 'seminar', name: 'Seminar', pfx: 'SEM' },
  { key: 'call-center', name: 'Call Center', pfx: 'CC' },
];
const PI_MODES = new Set(['looking-for-work', 'technical-interview']);
export const PI_STATES = { none: [], A: ['PI-A-RESUME', 'PI-A-JD'], 'A-RESUME': ['PI-A-RESUME'], 'A-JD': ['PI-A-JD'], B: ['PI-B-RESUME', 'PI-B-JD'], 'B-RESUME': ['PI-B-RESUME'], 'B-JD': ['PI-B-JD'] };
const FORMATS = new Set(['pdf', 'docx', 'md', 'txt', 'csv', 'go', 'py', 'kt', 'ts', 'js', 'sql', 'java', 'json', 'yaml', 'yml', 'html']);
const STATUS = new Set(['current', 'outdated', 'draft', 'informal']);
const CONDITIONS = ['grounded_single', 'multi_source', 'conflict_stale', 'irrelevant_source', 'missing_evidence', 'followup'];
const PI_CONDITIONS = new Set(['resume_only', 'jd_only', 'resume_jd', 'resume_jd_relevant_ref', 'resume_jd_irrelevant_ref', 'profile_conflicting_ref', 'no_pi', 'profile_b']);
const ACTIONS = new Set(['answer_directly', 'answer_with_calculation', 'answer_then_scope_authority', 'surface_conflict', 'prefer_current_source', 'make_current_decision', 'decline_to_invent_stay_useful', 'defer_to_verify', 'explain', 'write_code', 'probe_candidate', 'answer_candidate_question', 'continue_previous_answer']);
const RESP = new Set(['spoken_reply', 'private_explanation', 'private_advice', 'code', 'words_to_say']);
const FORBID = new Set(['stale', 'draft', 'fabrication', 'other_profile', 'other_mode', 'unauthorized_promise', 'false_denial', 'over_deferral']);
// dev2 (2026-10-04, Evin: "you can increase the questions per mode instead of 30 if needed, no cap"): 40 more
// development items per mode on the SAME documents, in authoring/<mode>/dev2.json, ids ER-D2-<PFX>-NNN. A separate
// partition, so the frozen dev and holdout series are unchanged.
const WANT = { dev2: { grounded_single: 15, multi_source: 8, conflict_stale: 7, irrelevant_source: 4, missing_evidence: 4, followup: 2 }, dev: { grounded_single: 11, multi_source: 6, conflict_stale: 5, irrelevant_source: 3, missing_evidence: 3, followup: 2 }, holdout: { grounded_single: 7, multi_source: 4, conflict_stale: 3, irrelevant_source: 2, missing_evidence: 2, followup: 2 } };

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const exists = (f) => fs.existsSync(f);
const norm = (s) => String(s ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const normLc = (s) => norm(s).toLowerCase();
// Page markers the parser inserts ("-- 1 of 2 --", "[Page 2]") and all whitespace are dropped before a needle is looked for.
const squash = (s) => norm(String(s ?? '').replace(/--\s*\d+\s*of\s*\d+\s*--/g, ' ').replace(/\[Page \d+\]/g, ' ')).replace(/\s+/g, '');
const words = (s) => (String(s).match(/\S+/g) ?? []).length;

// ---------------------------------------------------------------- load authoring
function loadMode(key) {
  const dir = path.join(AUTH, key);
  if (!exists(path.join(dir, 'manifest.json'))) return null;
  const manifest = readJson(path.join(dir, 'manifest.json'));
  const opt = (f, d) => (exists(path.join(dir, f)) ? readJson(path.join(dir, f)) : d);
  return { key, dir, manifest, variants: opt('variants.json', []), configs: opt('configs.json', []), dev: opt('dev.json', null), dev2: opt('dev2.json', null), cf: opt('cf.json', null) };
}
function loadAll() {
  const packs = {};
  for (const k of [...MODES.map((m) => m.key), 'profiles']) { const p = loadMode(k); if (p) packs[k] = p; }
  return packs;
}
/** Every uploadable document: base files and variants, keyed by id, with its source text after patches. */
function documents(packs, problems = []) {
  const docs = new Map();
  for (const p of Object.values(packs)) {
    for (const f of p.manifest.files ?? []) {
      const src = path.join(p.dir, f.source ?? `src/${f.id}.md`);
      if (!exists(src)) { problems.push(`${f.id}: source missing (${path.relative(HERE, src)})`); continue; }
      if (docs.has(f.id)) problems.push(`${f.id}: duplicate file id`);
      docs.set(f.id, { ...f, pack: p.key, text: fs.readFileSync(src, 'utf8'), variant_of: null, srcExt: path.extname(src).slice(1) });
    }
  }
  for (const p of Object.values(packs)) {
    for (const v of p.variants ?? []) {
      const base = docs.get(v.base);
      if (!base) { problems.push(`${v.id}: base ${v.base} not found`); continue; }
      let text = base.text;
      for (const r of v.replace ?? []) {
        const n = text.split(r.find).length - 1;
        if (n !== 1) { problems.push(`${v.id}: "find" occurs ${n} times in ${v.base} (must be 1): ${JSON.stringify(String(r.find).slice(0, 60))}`); continue; }
        text = text.replace(r.find, () => r.with);
      }
      const changed = new Map((v.facts_changed ?? []).map((c) => [c.fact, c]));
      const removed = new Set(v.facts_removed ?? []);
      const facts = (base.facts ?? []).filter((f) => !removed.has(f.id)).map((f) => (changed.has(f.id) ? { ...f, ...changed.get(f.id), id: f.id } : f));
      for (const [id, c] of changed) if (!(base.facts ?? []).some((f) => f.id === id)) facts.push({ id, statement: c.statement, doc_needles: c.doc_needles ?? [] });
      docs.set(v.id, { ...base, id: v.id, text, facts, variant_of: v.base, variant_note: v.note ?? null, changed_facts: [...changed.keys()], removed_facts: [...removed] });
    }
  }
  return docs;
}
const docDir = (id) => id.replace(/~/g, '__');
const evidencePath = (d) => path.join(EVID, 'files', docDir(d.id), d.filename);
const factRef = (docs, ref) => { const [id, fid] = String(ref).split('#'); const d = docs.get(id); return d ? (d.facts ?? []).find((f) => f.id === fid) ?? null : null; };

// ---------------------------------------------------------------- lint
function safeEval(expr) {
  if (!/^[\d\s+\-*/().,%]+$/.test(expr)) return null;
  try { return Function(`"use strict"; return (${expr.replace(/,/g, '')});`)(); } catch { return null; }
}
/**
 * An oracle may name a base file while the case loads a counterfactual variant of it. The reference means "this fact
 * in the file that is loaded", so it is rewritten to the variant's id (same fact id; a changed fact carries the
 * variant's statement and needles).
 */
export function bindToLoaded(item, configs, docs) {
  const cfg = configs.get(item.evidence_config);
  const loaded = new Set([...(cfg?.files ?? []), ...(PI_STATES[item.pi_state ?? 'none'] ?? [])]);
  const byBase = new Map([...loaded].map((id) => [docs.get(id)?.variant_of, id]).filter(([b]) => b));
  const fix = (id) => (id && !loaded.has(id) && byBase.has(id) ? byBase.get(id) : id);
  const ref = (r) => { if (!r || r === 'CONVERSATION') return r; const [id, fid] = String(r).split('#'); return fid ? `${fix(id)}#${fid}` : fix(id); };
  const o = item.oracle ?? {};
  return { ...item, oracle: { ...o,
    required_facts: (o.required_facts ?? []).map((x) => ({ ...x, fact: ref(x.fact) })), optional_facts: (o.optional_facts ?? []).map((x) => (x.fact ? { ...x, fact: ref(x.fact) } : x)),
    forbidden_claims: (o.forbidden_claims ?? []).map((x) => (x.fact ? { ...x, fact: ref(x.fact) } : x)),
    source_ids: (o.source_ids ?? []).map(fix), source_priority: (o.source_priority ?? []).map(fix), known_conflicts: (o.known_conflicts ?? []).map((k) => ({ ...k, sources: (k.sources ?? []).map(fix) })) } };
}
function lintItems({ items: rawItems, mode, set, docs, configs, corpusText, questionsSeen }) {
  const items = rawItems.map((it) => bindToLoaded(it, configs, docs));
  const E = [], W = [];
  const m = MODES.find((x) => x.key === mode);
  const idRe = set === 'iso' ? /^ER-ISO-\d{3}$/ : new RegExp(`^ER-${set === 'dev' ? 'D' : set === 'dev2' ? 'D2' : set === 'holdout' ? 'H' : 'CF'}-${m.pfx}-`);
  const counts = Object.fromEntries(CONDITIONS.map((c) => [c, 0]));
  const ids = new Set();
  for (const it of items) {
    const at = it.id ?? '(no id)';
    const e = (s) => E.push(`${at}: ${s}`), w = (s) => W.push(`${at}: ${s}`);
    if (!idRe.test(String(it.id))) e('id does not match the scheme');
    if (ids.has(it.id)) e('duplicate id'); ids.add(it.id);
    if (it.mode !== mode) e(`mode is ${it.mode}`);
    if (!((it.surface === 'hotkey' && it.speaker === 'other') || (it.surface === 'typed' && it.speaker === 'user'))) e('surface/speaker pair invalid');
    if (typeof it.question !== 'string' || it.question.trim().length < 3) e('question missing');
    if (it.prior_transcript != null && !(Array.isArray(it.prior_transcript) && it.prior_transcript.every((l) => ['other', 'user'].includes(l.speaker) && typeof l.text === 'string'))) e('prior_transcript malformed');
    const cfg = configs.get(it.evidence_config);
    if (!cfg) e(`evidence_config ${it.evidence_config} not found`); else if (cfg.mode !== mode) e('evidence_config belongs to another mode');
    if (!(it.pi_state in PI_STATES)) e(`pi_state ${it.pi_state} invalid`);
    if (!PI_MODES.has(mode) && it.pi_state !== 'none' && set !== 'iso') e('pi_state must be none in this mode');
    if (PI_MODES.has(mode) && !PI_CONDITIONS.has(it.pi_condition)) e(`pi_condition ${it.pi_condition} invalid`);
    if (!CONDITIONS.includes(it.condition)) e(`condition ${it.condition} invalid`); else counts[it.condition]++;
    const o = it.oracle ?? {};
    if (!o.expected_behavior_note) e('oracle.expected_behavior_note missing');
    if (!ACTIONS.has(o.expected_action)) e(`expected_action ${o.expected_action} invalid`);
    if (!RESP.has(o.expected_response_type)) e(`expected_response_type ${o.expected_response_type} invalid`);
    const loaded = new Set([...(cfg?.files ?? []), ...(PI_STATES[it.pi_state] ?? [])]);
    const loadedBase = new Set([...loaded].map((id) => docs.get(id)?.variant_of ?? id));
    for (const rf of o.required_facts ?? []) {
      if (rf.fact === 'CONVERSATION') continue;
      const [fid] = String(rf.fact).split('#');
      if (!factRef(docs, rf.fact)) { e(`required fact ${rf.fact} does not resolve`); continue; }
      if (!loaded.has(fid)) e(`required fact ${rf.fact}: its file is not loaded in ${it.evidence_config}/${it.pi_state}${loadedBase.has(fid) ? ' (a variant of it is: reference the variant id)' : ''}`);
    }
    for (const of of o.optional_facts ?? []) if (of.fact && of.fact !== 'CONVERSATION' && !factRef(docs, of.fact)) e(`optional fact ${of.fact} does not resolve`);
    const reqNeedles = new Set((o.required_facts ?? []).flatMap((r) => r.answer_needles ?? []).map(normLc));
    for (const fc of o.forbidden_claims ?? []) {
      if (!FORBID.has(fc.kind)) e(`forbidden kind ${fc.kind} invalid`);
      if (fc.fact && !factRef(docs, fc.fact)) e(`forbidden fact ${fc.fact} does not resolve`);
      for (const n of fc.answer_needles ?? []) {
        if (reqNeedles.has(normLc(n))) e(`forbidden answer needle "${n}" is also a required one`);
        if (normLc(it.question).includes(normLc(n))) w(`forbidden answer needle "${n}" occurs in the question itself`);
        if ([...reqNeedles].some((r) => r.includes(normLc(n)))) w(`forbidden answer needle "${n}" is a substring of a required needle`);
      }
    }
    for (const s of o.source_ids ?? []) if (!['PI:RESUME', 'PI:JD', 'CONVERSATION'].includes(s) && !docs.has(s)) e(`source id ${s} not found`);
    for (const s of o.source_ids ?? []) if (docs.has(s) && !loaded.has(s)) e(`source ${s} is not loaded in ${it.evidence_config}/${it.pi_state}`);
    if (['missing_evidence', 'irrelevant_source'].includes(it.condition) && (o.required_facts ?? []).some((r) => r.fact !== 'CONVERSATION')) w(`${it.condition} item has document-required facts`);
    if (['grounded_single', 'multi_source', 'conflict_stale'].includes(it.condition) && !(o.required_facts ?? []).length && !(o.known_conflicts ?? []).length) w(`${it.condition} item has no required facts`);
    if (it.condition === 'multi_source' && new Set([...(o.source_ids ?? [])]).size < 2) w('multi_source item lists fewer than two sources');
    if (o.requires_calculation) {
      const c = o.calculation_oracle;
      if (!c || !Array.isArray(c.accepted_forms) || !c.accepted_forms.length) e('calculation_oracle.accepted_forms missing');
      else if (typeof c.expression === 'string') { const v = safeEval(c.expression); if (v != null && typeof c.result === 'number' && Math.abs(v - c.result) > 0.005 * Math.max(1, Math.abs(c.result))) e(`calculation: expression gives ${v}, oracle says ${c.result}`); }
    }
    if (o.requires_code_validation && !(o.code_oracle?.tests?.length)) e('code_oracle.tests missing');
    // paraphrase check: 6 consecutive words of the question copied from a loaded document
    const qw = normLc(it.question).replace(/[^a-z0-9$%.' ]+/g, ' ').split(/\s+/).filter(Boolean);
    for (let i = 0; i + 6 <= qw.length; i++) { const g = qw.slice(i, i + 6).join(' '); if (corpusText.includes(g)) { w(`question copies six consecutive words from a document: "${g}"`); break; } }
    const qk = normLc(it.question);
    if (questionsSeen.has(qk) && !(it.conversation_id)) w('same question text already used in this mode'); questionsSeen.add(qk);
  }
  // chains
  const chains = {};
  for (const it of items) if (it.conversation_id) (chains[it.conversation_id] ??= []).push(it);
  for (const [cid, xs] of Object.entries(chains)) {
    const t = xs.map((x) => x.turn_index).sort((a, b) => a - b);
    if (t.some((v, i) => v !== i + 1)) E.push(`${cid}: turn_index not 1..n`);
    if (new Set(xs.map((x) => `${x.evidence_config}|${x.pi_state}`)).size > 1) E.push(`${cid}: a chain must keep one evidence_config and pi_state`);
  }
  for (const it of items) if (!it.conversation_id && it.turn_index !== 1) E.push(`${it.id}: turn_index must be 1 outside a chain`);
  return { E, W, counts };
}

function lint({ quiet = false } = {}) {
  const packs = loadAll();
  const problems = [];
  const docs = documents(packs, problems);
  const out = { errors: [...problems], warnings: [], summary: {} };
  // manifests
  const filenames = new Map();
  for (const d of docs.values()) {
    const e = (s) => out.errors.push(`${d.id}: ${s}`), w = (s) => out.warnings.push(`${d.id}: ${s}`);
    if (!FORMATS.has(d.format)) e(`format ${d.format} not supported`);
    if (!STATUS.has(d.status)) e(`status ${d.status} invalid`);
    if (typeof d.authority !== 'number') e('authority missing');
    if (!d.filename || !d.filename.toLowerCase().endsWith('.' + d.format)) e(`filename ${d.filename} does not end with .${d.format}`);
    if (!d.variant_of) { const k = d.filename.toLowerCase(); if (filenames.has(k)) e(`filename ${d.filename} also used by ${filenames.get(k)}`); filenames.set(k, d.id); }
    const fids = new Set();
    for (const f of d.facts ?? []) {
      if (fids.has(f.id)) e(`duplicate fact id ${f.id}`); fids.add(f.id);
      if (!f.statement) e(`fact ${f.id} has no statement`);
      if (!(f.doc_needles ?? []).length) w(`fact ${f.id} has no doc_needles`);
      for (const n of f.doc_needles ?? []) if (!d.text.includes(n)) e(`fact ${f.id}: needle ${JSON.stringify(n)} is not a verbatim substring of the source`);
    }
    if (/\b(benchmark|oracle|distractor|synthetic)\b/i.test(d.text)) w('document contains a benchmark word (benchmark / oracle / distractor / synthetic)');
    if (/\bER-(D|H|CF|ISO)-/.test(d.text)) e('document contains a benchmark id');
    for (const c of d.intentional_conflicts ?? []) {
      const other = docs.get(c.with_file);
      if (!other) { e(`conflict with unknown file ${c.with_file}`); continue; }
      if (c.resolution && c.resolution !== 'unresolved' && c.other_value && d.authority > other.authority && d.text.includes(c.other_value) && String(c.other_value).length > 3) w(`the winning document also contains the losing value ${JSON.stringify(c.other_value)}`);
    }
  }
  // configs
  const configs = new Map();
  for (const p of Object.values(packs)) {
    if (p.key === 'profiles') continue;
    const bases = (p.configs ?? []).filter((c) => c.base);
    if (bases.length !== 1) out.errors.push(`${p.key}: needs exactly one base config, has ${bases.length}`);
    for (const c of p.configs ?? []) {
      if (configs.has(c.id)) out.errors.push(`${c.id}: duplicate config id`);
      if (c.mode !== p.key) out.errors.push(`${c.id}: mode ${c.mode} in ${p.key}/configs.json`);
      const names = new Set();
      for (const f of c.files ?? []) {
        const d = docs.get(f);
        if (!d) { out.errors.push(`${c.id}: file ${f} not found`); continue; }
        if (d.pack !== p.key) out.errors.push(`${c.id}: file ${f} belongs to ${d.pack}`);
        if (names.has(d.filename)) out.errors.push(`${c.id}: two files named ${d.filename}`); names.add(d.filename);
      }
      configs.set(c.id, c);
    }
  }
  // items
  for (const p of Object.values(packs)) {
    if (p.key === 'profiles') continue;
    const corpusText = normLc([...docs.values()].filter((d) => d.pack === p.key || d.pack === 'profiles').map((d) => d.text).join('\n')).replace(/[^a-z0-9$%.' ]+/g, ' ').replace(/\s+/g, ' ');
    const seen = new Set();
    const s = (out.summary[p.key] = { documents: (p.manifest.files ?? []).length, variants: (p.variants ?? []).length, configs: (p.configs ?? []).length, words: (p.manifest.files ?? []).reduce((n, f) => n + words(docs.get(f.id)?.text ?? ''), 0), facts: (p.manifest.files ?? []).reduce((n, f) => n + (f.facts ?? []).length, 0) });
    if (p.dev) {
      const r = lintItems({ items: p.dev.items ?? [], mode: p.key, set: 'dev', docs, configs, corpusText, questionsSeen: seen });
      out.errors.push(...r.E); out.warnings.push(...r.W); s.dev = (p.dev.items ?? []).length; s.dev_conditions = r.counts;
      for (const [c, n] of Object.entries(WANT.dev)) if (r.counts[c] !== n) out.warnings.push(`${p.key} dev: ${r.counts[c]} ${c} items, brief asks ${n}`);
    } else out.errors.push(`${p.key}: dev.json missing`);
    if (p.dev2) {
      // Linted after dev with the same `seen` set, so a dev2 question that repeats a dev question is flagged.
      const r = lintItems({ items: p.dev2.items ?? [], mode: p.key, set: 'dev2', docs, configs, corpusText, questionsSeen: seen });
      out.errors.push(...r.E); out.warnings.push(...r.W); s.dev2 = (p.dev2.items ?? []).length; s.dev2_conditions = r.counts;
      for (const [c, n] of Object.entries(WANT.dev2)) if (r.counts[c] !== n) out.warnings.push(`${p.key} dev2: ${r.counts[c]} ${c} items, brief asks ${n}`);
    }
    if (p.cf) {
      const items = expandCf(p.cf, p.key);
      const r = lintItems({ items, mode: p.key, set: 'cf', docs, configs, corpusText, questionsSeen: new Set() });
      out.errors.push(...r.E); out.warnings.push(...r.W.filter((x) => !/same question text/.test(x))); s.cf = items.length; s.cf_families = (p.cf.families ?? []).length;
    } else out.errors.push(`${p.key}: cf.json missing`);
    const hf = path.join(AUTH_H, p.key, 'holdout.json');
    if (exists(hf)) {
      const h = readJson(hf);
      const r = lintItems({ items: h.items ?? [], mode: p.key, set: 'holdout', docs, configs, corpusText, questionsSeen: seen });
      for (const [c, n] of Object.entries(WANT.holdout)) if (r.counts[c] !== n) r.W.push(`holdout: ${r.counts[c]} ${c} items, brief asks ${n}`);
      // BLIND: nothing of the holdout is printed but counts. The detail goes to a file for the author.
      fs.writeFileSync(path.join(AUTH_H, p.key, 'lint.txt'), [`errors (${r.E.length})`, ...r.E, '', `warnings (${r.W.length})`, ...r.W, ''].join('\n'));
      s.holdout = (h.items ?? []).length; s.holdout_errors = r.E.length; s.holdout_warnings = r.W.length; s.holdout_conditions = r.counts;
      out.holdoutErrors = (out.holdoutErrors ?? 0) + r.E.length;
    } else out.errors.push(`${p.key}: holdout.json missing`);
  }
  const iso = path.join(AUTH, 'isolation', 'items.json');
  if (exists(iso)) {
    const all = resolveIso(readJson(iso).items, configs, out.errors);
    out.summary.isolation = { items: all.length, sequences: new Set(all.map((i) => i.sequence_id).filter(Boolean)).size, by_kind: all.reduce((a, i) => { a[i.iso_kind] = (a[i.iso_kind] ?? 0) + 1; return a; }, {}) };
    const allText = normLc([...docs.values()].map((d) => d.text).join('\n')).replace(/[^a-z0-9$%.' ]+/g, ' ').replace(/\s+/g, ' ');
    for (const m of MODES) {
      const r = lintItems({ items: all.filter((i) => i.mode === m.key), mode: m.key, set: 'iso', docs, configs, corpusText: allText, questionsSeen: new Set() });
      out.errors.push(...r.E); out.warnings.push(...r.W.filter((w) => !/has no required facts|document-required facts/.test(w)));
    }
    const seq = {};
    for (const i of all) if (i.sequence_id) (seq[i.sequence_id] ??= []).push(i.seq_index);
    for (const [k, v] of Object.entries(seq)) if ([...v].sort((a, b) => a - b).some((x, j) => x !== j + 1)) out.errors.push(`${k}: seq_index not 1..n`);
  }
  if (!quiet) {
    console.log(JSON.stringify(out.summary, null, 1));
    console.log(`\nerrors ${out.errors.length} (dev/corpus), holdout errors ${out.holdoutErrors ?? 0} (see authoring-holdout/<mode>/lint.txt), warnings ${out.warnings.length}`);
    for (const e of out.errors) console.log('  E ' + e);
    for (const w of out.warnings) console.log('  W ' + w);
  }
  return { out, packs, docs, configs };
}

/** Isolation items name "@base" / "@none" instead of a config id; resolved here against the modes' own configs. */
export function resolveIso(items, configs, errors = []) {
  const list = [...configs.values()];
  const pick = (mode, tag) => (tag === '@base' ? list.find((c) => c.mode === mode && c.base) : tag === '@none' ? list.find((c) => c.mode === mode && !(c.files ?? []).length) : configs.get(tag));
  return items.map((it) => {
    const c = pick(it.mode, it.evidence_config);
    if (!c) errors.push(`${it.id}: evidence_config ${it.evidence_config} cannot be resolved for ${it.mode}`);
    const wo = it.world_override ? Object.fromEntries(Object.entries(it.world_override).map(([k, v]) => [k, pick(k, v)?.id ?? v])) : undefined;
    return { ...it, evidence_config: c?.id ?? it.evidence_config, ...(wo ? { world_override: wo } : {}) };
  });
}
export function expandCf(cf, mode) {
  const items = [];
  for (const fam of cf.families ?? []) {
    for (const v of fam.variants ?? []) {
      items.push({
        id: `${fam.family}${v.variant}`, mode, surface: fam.surface, speaker: fam.speaker, question: fam.question, prior_transcript: fam.prior_transcript ?? null,
        conversation_id: null, turn_index: 1, evidence_config: v.evidence_config, pi_state: v.pi_state ?? 'none', pi_condition: v.pi_condition ?? fam.pi_condition,
        condition: v.condition ?? cfCondition(v.evidence_state), category: fam.category ?? 'counterfactual', difficulty: fam.difficulty ?? 'medium',
        cf_family: fam.family, cf_variant: v.variant, evidence_state: v.evidence_state, oracle: v.oracle,
      });
    }
  }
  return items;
}
function cfCondition(state) {
  const s = String(state ?? '');
  if (/conflict/.test(s)) return 'conflict_stale';
  if (/no_|absent|none|missing/.test(s)) return 'missing_evidence';
  return 'grounded_single';
}

// ---------------------------------------------------------------- evidence files
const CSS = `body{font-family:Helvetica,Arial,sans-serif;font-size:10.5pt;line-height:1.38;color:#111;margin:0}
h1{font-size:17pt;margin:0 0 8pt}h2{font-size:13pt;margin:14pt 0 5pt}h3{font-size:11pt;margin:10pt 0 4pt}
table{border-collapse:collapse;width:100%;margin:6pt 0 10pt}th,td{border:0.6pt solid #888;padding:3pt 5pt;text-align:left;vertical-align:top}
th{background:#eee}code,pre{font-family:Menlo,monospace;font-size:9pt}pre{background:#f4f4f4;padding:6pt;white-space:pre-wrap}
blockquote{border-left:2pt solid #bbb;margin:6pt 0;padding-left:8pt;color:#333}hr{border:0;border-top:0.6pt solid #999;margin:10pt 0}`;
async function mdToHtml(md, title) {
  const { marked } = await import(pathToFileURL(requireApp.resolve('marked')).href);
  const body = marked.parse(md, { gfm: true });
  return `<!doctype html><html><head><meta charset="utf-8"><title>${String(title ?? '').replace(/[<&]/g, ' ')}</title><style>@page{size:A4;margin:18mm 17mm}${CSS}</style></head><body>${body}</body></html>`;
}
const CHROME = process.env.ER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/** Headless Chrome writes the PDF and then does not exit on this machine, so: wait for the file, then stop it. */
async function chromePdf(html, out, profileDir) {
  fs.rmSync(out, { force: true });
  const child = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-pdf-header-footer', `--user-data-dir=${profileDir}`, `--print-to-pdf=${out}`, pathToFileURL(html).href], { stdio: 'ignore' });
  let last = -1, stable = 0;
  for (let i = 0; i < 300 && stable < 3; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const size = exists(out) ? fs.statSync(out).size : -1;
    stable = size > 0 && size === last ? stable + 1 : 0; last = size;
    if (child.exitCode != null && size > 0) break;
  }
  if (child.exitCode == null) child.kill('SIGKILL');
  if (!(last > 0)) throw new Error('chrome did not write the PDF');
}
async function buildOne(d, tmp) {
  const out = evidencePath(d);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (d.format === 'pdf' || d.format === 'docx') {
    const html = path.join(tmp, `${docDir(d.id)}.html`);
    fs.writeFileSync(html, await mdToHtml(d.text, d.title ?? d.filename));
    if (d.format === 'pdf') {
      await chromePdf(html, out, path.join(tmp, 'chrome'));
    } else {
      execFileSync('/usr/bin/textutil', ['-convert', 'docx', '-output', out, html], { stdio: 'ignore', timeout: 60000 });
    }
  } else {
    fs.writeFileSync(out, d.text);
  }
  if (!exists(out) || !fs.statSync(out).size) throw new Error(`${d.id}: ${d.format} was not produced`);
  return out;
}
/** What the app's parser libraries read back from the built file (same libraries, same versions as the app). */
async function extractText(file, format) {
  const buf = fs.readFileSync(file);
  if (format === 'pdf') {
    const { PDFParse } = await import(pathToFileURL(requireApp.resolve('pdf-parse')).href);
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    try { const r = await parser.getText(); return r.text ?? (r.pages ?? []).map((p) => p.text).join('\n'); } finally { await parser.destroy?.(); }
  }
  if (format === 'docx') { const mammoth = requireApp('mammoth'); return (await mammoth.extractRawText({ buffer: buf })).value; }
  return buf.toString('utf8');
}
async function buildEvidence(only) {
  const { docs } = lint({ quiet: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'er-build-'));
  const report = [];
  for (const d of docs.values()) {
    if (only && !only.includes(d.id)) continue;
    const out = await buildOne(d, tmp);
    let text = '', err = null;
    try { text = await extractText(out, d.format); } catch (e) { err = String(e.message ?? e); }
    // Compared with all whitespace removed: a PDF wraps lines and breaks after hyphens ("e-\nmail"), which is not a lost fact.
    const nt = squash(text);
    const lost = [];
    for (const f of d.facts ?? []) for (const n of f.doc_needles ?? []) if (!nt.includes(squash(n))) lost.push(`${f.id}:${n}`);
    report.push({ id: d.id, format: d.format, bytes: fs.statSync(out).size, extracted_chars: text.length, source_chars: d.text.length, parse_error: err, needles: (d.facts ?? []).reduce((n, f) => n + (f.doc_needles ?? []).length, 0), needles_lost_in_parse: lost });
    console.log(`${d.id.padEnd(46)} ${d.format.padEnd(5)} ${String(fs.statSync(out).size).padStart(8)} B  extracted ${String(text.length).padStart(6)} chars  ${err ? 'PARSE ERROR ' + err : lost.length ? `needles lost ${lost.length}: ${lost.slice(0, 4).join(' | ')}` : 'ok'}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(ORACLES, { recursive: true });
  if (!only) fs.writeFileSync(path.join(ORACLES, 'build-report.json'), JSON.stringify(report, null, 1));
  const bad = report.filter((r) => r.parse_error || r.needles_lost_in_parse.length);
  console.log(`\n${report.length} files built, ${bad.length} with a parse problem or lost needles`);
}

// ---------------------------------------------------------------- freeze
function freeze(partial = false) {
  const { out, packs, docs, configs } = lint({ quiet: true });
  if (partial && OUT === HERE) { console.error('--partial needs ER_BENCH_DIR (never into the real freeze)'); process.exit(2); }
  if (!partial && (out.errors.length || (out.holdoutErrors ?? 0))) { console.error(`refusing to freeze: ${out.errors.length} errors, ${out.holdoutErrors ?? 0} holdout errors (run lint)`); process.exit(2); }
  fs.mkdirSync(ORACLES, { recursive: true }); fs.mkdirSync(DATASETS, { recursive: true });
  const files = [];
  const texts = {};
  for (const d of docs.values()) {
    const p = evidencePath(d);
    if (!exists(p)) { if (partial) continue; console.error(`evidence file missing for ${d.id} (run: build.mjs evidence)`); process.exit(2); }
    const buf = fs.readFileSync(p);
    files.push({
      id: d.id, mode: d.pack === 'profiles' ? 'profiles' : d.pack, filename: d.filename, format: d.format, path: path.relative(EVID, p).split(path.sep).join('/'),
      sha256: sha256(buf), bytes: buf.length, source_sha256: sha256(d.text), words: words(d.text), document_type: d.document_type ?? null, title: d.title ?? null,
      status: d.status, effective_date: d.effective_date ?? null, authority: d.authority, supersedes: d.supersedes ?? [], variant_of: d.variant_of, variant_note: d.variant_note ?? null,
      facts: d.facts ?? [], intentional_conflicts: d.intentional_conflicts ?? [], must_not_infer: d.must_not_infer ?? [],
    });
    texts[d.id] = d.text;
  }
  files.sort((a, b) => a.id.localeCompare(b.id));
  const worlds = Object.fromEntries(Object.values(packs).map((p) => [p.key, p.manifest.world ?? null]));
  const manifest = { name: 'evidence-rich-v1', schema_version: 1, pi_states: PI_STATES, worlds, files };
  const manifestSha = sha256(JSON.stringify(manifest));
  fs.writeFileSync(path.join(ORACLES, 'evidence-manifest.json'), JSON.stringify({ ...manifest, manifest_sha256: manifestSha }, null, 1));
  fs.writeFileSync(path.join(ORACLES, 'evidence-texts.json'), JSON.stringify({ manifest_sha256: manifestSha, texts }, null, 1));
  const idf = path.join(AUTH, 'profiles', 'identities.json');
  if (exists(idf)) fs.copyFileSync(idf, path.join(ORACLES, 'pi-identities.json'));
  const cfgList = [...configs.values()].map((c) => ({ id: c.id, mode: c.mode, base: !!c.base, files: c.files ?? [] }));
  if (partial) for (const m of MODES) if (!cfgList.some((c) => c.mode === m.key && c.base)) cfgList.push({ id: `${m.key}-none`, mode: m.key, base: true, files: [] });
  const modes = MODES.map(({ key, name }) => ({ key, name }));
  const sets = { dev: [], holdout: [], 'supp-counterfactual': [], 'supp-isolation': [], dev2: [] };
  for (const m of MODES) {
    const p = packs[m.key];
    if (!p) continue;
    sets.dev.push(...(p.dev?.items ?? []));
    sets.dev2.push(...(p.dev2?.items ?? []));
    sets['supp-counterfactual'].push(...expandCf(p.cf ?? {}, m.key));
    if (exists(path.join(AUTH_H, m.key, 'holdout.json'))) sets.holdout.push(...readJson(path.join(AUTH_H, m.key, 'holdout.json')).items);
  }
  const iso = path.join(AUTH, 'isolation', 'items.json');
  if (exists(iso)) sets['supp-isolation'].push(...resolveIso(readJson(iso).items, configs));
  const frozen = { name: 'evidence-rich-v1', frozen_at: new Date().toISOString(), manifest_sha256: manifestSha, datasets: {} };
  for (const [name, items] of Object.entries(sets)) {
    if (name === 'dev2' && !items.length) continue;   // not authored yet: nothing to freeze
    const body = { schema_version: 1, partition: name, manifest_sha256: manifestSha, modes, configs: cfgList, items: items.map((it) => ({ partition: name, ...bindToLoaded(it, configs, docs) })) };
    const h = sha256(JSON.stringify(body));
    fs.writeFileSync(path.join(DATASETS, `${name}.json`), JSON.stringify({ dataset_name: `evidence-rich-v1-${name}`, dataset_sha256: h, ...body }, null, 1));
    frozen.datasets[name] = { items: items.length, sha256: h };
    console.log(`${name.padEnd(22)} ${String(items.length).padStart(4)} items  ${h.slice(0, 12)}`);
  }
  frozen.evidence_files = files.length;
  fs.writeFileSync(path.join(OUT, 'FREEZE.json'), JSON.stringify(frozen, null, 1));
  console.log(`manifest ${manifestSha.slice(0, 12)}  ${files.length} evidence files\nfrozen → FREEZE.json`);
}

function verify() {
  const fr = readJson(path.join(OUT, 'FREEZE.json'));
  const man = readJson(path.join(ORACLES, 'evidence-manifest.json'));
  let bad = 0;
  for (const f of man.files) { const p = path.join(EVID, f.path); if (!exists(p) || sha256(fs.readFileSync(p)) !== f.sha256) { bad++; console.log(`MISMATCH ${f.id}`); } }
  const { manifest_sha256, ...body } = man;
  if (sha256(JSON.stringify(body)) !== manifest_sha256 || manifest_sha256 !== fr.manifest_sha256) { bad++; console.log('MISMATCH evidence-manifest.json'); }
  for (const [name, meta] of Object.entries(fr.datasets)) {
    const { dataset_name, dataset_sha256, ...b } = readJson(path.join(DATASETS, `${name}.json`));
    if (sha256(JSON.stringify(b)) !== dataset_sha256 || dataset_sha256 !== meta.sha256) { bad++; console.log(`MISMATCH dataset ${name}`); }
  }
  // nothing but uploadable files under evidence/
  const stray = [];
  const known = new Set(man.files.map((f) => f.path));
  (function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else { const rel = path.relative(EVID, p).split(path.sep).join('/'); if (!known.has(rel)) stray.push(rel); } } })(EVID);
  for (const s of stray) { bad++; console.log(`STRAY file under evidence/: ${s}`); }
  console.log(bad ? `verify: ${bad} problem(s)` : `verify: ok (${man.files.length} files, ${Object.keys(fr.datasets).length} datasets, frozen ${fr.frozen_at})`);
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
  if (cmd === 'lint') { const { out } = lint(); process.exit(out.errors.length || (out.holdoutErrors ?? 0) ? 1 : 0); }
  else if (cmd === 'evidence') await buildEvidence(only);
  else if (cmd === 'freeze') freeze(process.argv.includes('--partial'));
  else if (cmd === 'verify') verify();
  else { console.error('usage: build.mjs lint | evidence [--only ID,ID] | freeze | verify'); process.exit(2); }
}
