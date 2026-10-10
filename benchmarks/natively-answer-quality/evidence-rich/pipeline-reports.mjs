#!/usr/bin/env node
// Data sections of docs/REFERENCE-EVIDENCE-REPORT.md and docs/PI-EVIDENCE-REPORT.md, from the runs' own records
// (no judge). Prints Markdown; the prose around it is written by hand.
//   node evidence-rich/pipeline-reports.mjs --runs evidence-rich/results/er-dev-base,evidence-rich/results/er-cf-base,... [--which reference|pi]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRun, funnel, bench, norm, answerOf, PI_MODES } from './objective.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const runs = String(opt('runs', '')).split(',').filter(Boolean).map((r) => loadRun(path.resolve(HERE, '..', r)));
const which = opt('which', 'both');
const B = bench();
const MODES = ['general', 'sales', 'recruiting', 'team-meet', 'looking-for-work', 'lecture', 'technical-interview', 'seminar', 'call-center'];
const pc = (n, d) => (d ? `${(100 * n / d).toFixed(1)} % (${n}/${d})` : '–');
const sq = (t) => norm(String(t ?? '').replace(/--\s*\d+\s*of\s*\d+\s*--/g, ' ').replace(/\[Page \d+\]/g, ' ')).replace(/\s+/g, '');
const APP_FALLBACK_RE = /didn.t come through from the AI provider|couldn.t generate an answer just now|No answer came back this time|did not produce an answer in time/i;

const recs = [];
for (const run of runs) for (const row of run.rows) {
  const item = run.ds.byId[row.benchmark_id];
  if (!item || row.error_type === 'environment_state_unverified' || row.success === false || APP_FALLBACK_RE.test(answerOf(row))) continue;
  recs.push({ row, item, fn: funnel(item, row, run), partition: run.header.partition });
}

if (which !== 'pi') {
  console.log('## Ingestion: every upload of every run\n');
  const ing = runs.flatMap((r) => r.ingest);
  const first = new Map(); for (const i of ing) if (!first.has(i.evidence_id)) first.set(i.evidence_id, i);
  console.log('| Mode | Uploads | Distinct files | Uploaded | Same bytes as frozen | Parsed (text extracted) | Index ready | Fact strings surviving the parser | Facts with every string surviving |');
  console.log('|---|---:|---:|---|---|---|---|---|---|');
  for (const m of [...MODES, 'ALL']) {
    const xs = ing.filter((i) => m === 'ALL' || i.mode === m); if (!xs.length) continue;
    const s = (f) => xs.filter(f).length;
    const nt = xs.reduce((a, i) => a + (i.needles_total ?? 0), 0), ns = xs.reduce((a, i) => a + (i.needles_survived ?? 0), 0);
    const ft = xs.reduce((a, i) => a + (i.facts_total ?? 0), 0), fs_ = xs.reduce((a, i) => a + (i.facts_fully_survived ?? 0), 0);
    console.log(`| ${m} | ${xs.length} | ${new Set(xs.map((i) => i.evidence_id)).size} | ${pc(s((i) => i.file_uploaded), xs.length)} | ${pc(s((i) => i.binary_sha_matches), xs.length)} | ${pc(s((i) => i.file_parse_success), xs.length)} | ${pc(s((i) => i.index_status === 'ready'), xs.length)} | ${pc(ns, nt)} | ${pc(fs_, ft)} |`);
  }
  const byFmt = {};
  for (const i of first.values()) { const k = i.format; (byFmt[k] ??= { n: 0, nt: 0, ns: 0, chars: 0 }); byFmt[k].n++; byFmt[k].nt += i.needles_total ?? 0; byFmt[k].ns += i.needles_survived ?? 0; }
  console.log(`\nBy format (distinct files): ${Object.entries(byFmt).map(([k, v]) => `${k} ${v.n} files, ${v.ns}/${v.nt} strings`).join('; ')}.`);
  const lost = [...first.values()].filter((i) => (i.needles_lost ?? []).length);
  console.log(lost.length ? `Strings lost in parsing: ${lost.map((i) => `${i.evidence_id} (${i.needles_lost.length})`).join(', ')}.` : 'No recorded fact string was lost in parsing.');
  const st = {}; for (const i of ing) st[i.index_status ?? 'null'] = (st[i.index_status ?? 'null'] ?? 0) + 1;
  console.log(`Index status at the end of each upload: ${JSON.stringify(st)}. Upload time: median ${[...ing].map((i) => i.upload_ms).sort((a, b) => a - b)[Math.floor(ing.length / 2)]} ms.`);

  console.log('\n## Retrieval: cases whose answer rests on at least one reference file\n');
  console.log('| Mode | Cases | Retrieval planned | Right file in the prompt (all needed) | (at least one needed) | Every needed fact in the prompt | Only wrong files in the prompt | No reference text in the prompt |');
  console.log('|---|---:|---|---|---|---|---|---|');
  const refCases = recs.filter((r) => r.fn.file_uploaded !== null);
  for (const m of [...MODES, 'ALL']) {
    const xs = refCases.filter((r) => m === 'ALL' || r.item.mode === m); if (!xs.length) continue;
    const s = (f) => xs.filter(f).length;
    const noRef = s((r) => !(r.row.prompt_evidence ?? []).some((e) => e.provenance === 'MODE_REFERENCE_FILE'));
    const traced = xs.filter((r) => r.fn.doc_fact_reached_prompt !== null);
    console.log(`| ${m} | ${xs.length} | ${pc(s((r) => r.fn.read_whole || r.fn.retrieval_attempted), xs.length)} | ${pc(s((r) => r.fn.correct_source_retrieved), xs.length)} | ${pc(s((r) => r.fn.any_correct_source_retrieved), xs.length)} | ${pc(traced.filter((r) => r.fn.doc_fact_reached_prompt).length, traced.length)} | ${pc(s((r) => r.fn.wrong_source_retrieved), xs.length)} | ${pc(noRef, xs.length)} |`);
  }
  console.log('\nBy number of sources the answer needs and by corpus path:\n');
  console.log('| Slice | Cases | Every needed fact in the prompt |\n|---|---:|---|');
  const sl = { 'one source file': (r) => (r.item.oracle.source_ids ?? []).filter((s) => B.files.has(s)).length === 1, 'two or more source files': (r) => (r.item.oracle.source_ids ?? []).filter((s) => B.files.has(s)).length >= 2,
    'corpus read whole (≤ 1,400 tokens)': (r) => r.fn.read_whole, 'corpus retrieved (larger)': (r) => !r.fn.read_whole, 'heard (hotkey)': (r) => r.row.surface === 'hotkey', 'typed': (r) => r.row.surface === 'typed',
    'conflict / stale cases': (r) => r.item.condition === 'conflict_stale', 'calculation cases': (r) => !!r.item.oracle.requires_calculation };
  for (const [k, f] of Object.entries(sl)) { const xs = refCases.filter((r) => f(r) && r.fn.doc_fact_reached_prompt !== null); console.log(`| ${k} | ${xs.length} | ${pc(xs.filter((r) => r.fn.doc_fact_reached_prompt).length, xs.length)} |`); }
  const st2 = refCases.filter((r) => r.item.condition === 'conflict_stale' && r.fn.stale_source_retrieved !== null);
  console.log(`\nConflict / stale cases (${st2.length}): an outdated or draft file was in the prompt in ${st2.filter((r) => r.fn.stale_source_retrieved).length}; the outdated value itself in ${st2.filter((r) => r.fn.stale_value_in_prompt).length}; the current fact in ${st2.filter((r) => r.fn.doc_fact_reached_prompt).length}; current fact in and outdated value out in ${st2.filter((r) => r.fn.doc_fact_reached_prompt && !r.fn.stale_value_in_prompt).length}; outdated value in and current fact out in ${st2.filter((r) => !r.fn.doc_fact_reached_prompt && r.fn.stale_value_in_prompt).length}.`);
  const ev = refCases.map((r) => r.fn.evidence_items_in_prompt); const refN = refCases.map((r) => new Set((r.row.prompt_evidence ?? []).filter((e) => e.provenance === 'MODE_REFERENCE_FILE').map((e) => e.source_name)).size);
  const med = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
  console.log(`Evidence passages in the prompt per case: median ${med(ev)}, max ${Math.max(...ev)}. Distinct reference files in the prompt per case: median ${med(refN)}, max ${Math.max(...refN)} (the packs hold 6 to 9 files).`);
  const fb = {}; for (const r of refCases) { const k = `${r.fn.retrieval_path ?? '?'} / ${r.fn.answerability ?? '?'} / ${r.fn.v3_fallback ?? '?'}`; fb[k] = (fb[k] ?? 0) + 1; }
  console.log(`The app's own verdict per turn (path / answerability / fallback): ${Object.entries(fb).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n}`).join('; ')}.`);
  const deg = {}; for (const r of recs) for (const x of r.row.v3_trace?.retrieval ?? []) if (x.degraded) deg[x.degraded] = (deg[x.degraded] ?? 0) + 1;
  console.log(`Retrieval passes the app marked as degraded: ${JSON.stringify(deg)} (of ${recs.length} turns).`);
}

if (which !== 'reference') {
  console.log('\n## Profile Intelligence: every profile load\n');
  const loads = runs.flatMap((r) => r.pi).filter((p) => p.pi_state !== 'none');
  console.log('| State | Loads | Transition | Ingest ok | Résumé structured | JD structured | Extraction mode | Median load time |');
  console.log('|---|---:|---|---|---|---|---|---:|');
  const keys = [...new Set(loads.map((p) => `${p.pi_state}|${p.transition}`))].sort();
  for (const k of keys) {
    const xs = loads.filter((p) => `${p.pi_state}|${p.transition}` === k); const [st, tr] = k.split('|');
    const wantR = /^(A|B)$|RESUME/.test(st), wantJ = /^(A|B)$|JD/.test(st);
    console.log(`| ${st} | ${xs.length} | ${tr} | ${pc(xs.filter((p) => p.profile_loaded).length, xs.length)} | ${wantR ? pc(xs.filter((p) => p.resume_parsed).length, xs.length) : 'n/a'} | ${wantJ ? pc(xs.filter((p) => p.jd_parsed).length, xs.length) : 'n/a'} | ${[...new Set(xs.map((p) => p.resume_extraction_mode ?? 'n/a'))].join(', ')} | ${[...xs].map((p) => p.ms).sort((a, b) => a - b)[Math.floor(xs.length / 2)]} ms |`);
  }
  const residue = loads.filter((p) => (p.other_profile_residue ?? []).length);
  console.log(`\nLoads after which the stored profile still held strings of the other profile: ${residue.length} of ${loads.length}${residue.length ? ` (${[...new Set(residue.flatMap((p) => p.other_profile_residue))].join(', ')})` : ''}.`);
  const dels = runs.flatMap((r) => r.pi).filter((p) => p.transition === 'user_delete');
  for (const d of dels) console.log(`After a user-style delete: résumé structured ${d.state?.hasStructuredResume}, JD structured ${d.state?.hasStructuredJD}, knowledge nodes ${d.state?.nodeCount}, strings of a deleted profile still in the stored profile data: ${(d.other_profile_residue ?? []).length ? d.other_profile_residue.join(', ') : 'none'}.`);

  console.log('\n## What the stored profile holds, fact by fact\n');
  console.log('For each fact of the résumé / JD in the manifest: are its recorded strings present in the structured profile the app stores (`profileGetProfile()`)? The raw text is indexed separately and can still reach a prompt.\n');
  console.log('| Document | Facts | Every string in the structured profile | Some | None |\n|---|---:|---|---|---|');
  for (const st of ['A', 'B']) {
    const load = loads.filter((p) => p.pi_state === st).at(-1); if (!load) continue;
    const text = sq(JSON.stringify(load.profile_data ?? {}));
    for (const id of B.manifest.pi_states[st]) {
      const f = B.files.get(id); let all = 0, some = 0, none = 0; const lostFacts = [];
      for (const x of f.facts) { const h = (x.doc_needles ?? []).map((n) => text.includes(sq(n))); if (h.every(Boolean)) all++; else if (h.some(Boolean)) some++; else { none++; lostFacts.push(x.id); } }
      console.log(`| ${id} | ${f.facts.length} | ${pc(all, f.facts.length)} | ${pc(some, f.facts.length)} | ${pc(none, f.facts.length)} |`);
    }
    const s = load.state ?? {};
    console.log(`\nProfile ${st} as stored: name "${s.resumeName}", ${s.resumeExperienceCount} experience entries, ${s.resumeProjectCount} project entries, ${s.resumeBulletCount} bullets, ${s.resumeEducationCount} education entries ${JSON.stringify(s.resumeEducation ?? [])}, ${s.resumeSkillCount} skills; JD title "${s.jdTitle}", company "${s.jdCompany}"; knowledge nodes ${s.nodeCount}; derived artifacts ${JSON.stringify(s.aot ?? {})}.`);
    const d = load.profile_data ?? {};
    console.log(`Experience entries: ${(d.experience ?? []).map((e) => `${e.role} @ ${e.company} (${e.start_date ?? '?'}–${e.end_date ?? 'now'}, ${(e.bullets ?? []).length} bullets)`).join(' | ')}`);
    console.log(`First project entries: ${(d.projects ?? []).slice(0, 8).map((p) => JSON.stringify(p.name)).join(', ')}${(d.projects ?? []).length > 8 ? ', …' : ''}`);
    console.log(`Derived persona line: ${JSON.stringify(d.compactPersona ?? null)}`);
    console.log(`Gap analysis: ${JSON.stringify((d.gapAnalysis?.gaps ?? []).map((g) => g.skill))}, match ${d.gapAnalysis?.match_percentage ?? '?'} %.\n`);
  }

  console.log('## Profile evidence in the prompt, cases whose answer rests on résumé / JD\n');
  console.log('| Slice | Cases | Profile sources offered to the turn | Right kind of profile evidence in the prompt | Every needed profile fact in the prompt |\n|---|---:|---|---|---|');
  const piCases = recs.filter((r) => r.fn.correct_profile_reached_prompt !== null);
  const slices = { 'all': () => true, 'Looking for work': (r) => r.item.mode === 'looking-for-work', 'Technical Interview': (r) => r.item.mode === 'technical-interview', 'profile A': (r) => String(r.row.pi_state).startsWith('A'), 'profile B': (r) => String(r.row.pi_state).startsWith('B'),
    'résumé only loaded': (r) => /RESUME$/.test(r.row.pi_state), 'JD only loaded': (r) => /JD$/.test(r.row.pi_state), 'heard': (r) => r.row.surface === 'hotkey', 'typed': (r) => r.row.surface === 'typed' };
  for (const [k, f] of Object.entries(slices)) {
    const xs = piCases.filter(f); const t = xs.filter((r) => r.fn.pi_fact_reached_prompt !== null);
    console.log(`| ${k} | ${xs.length} | ${pc(xs.filter((r) => r.fn.pi_retrieval_attempted).length, xs.length)} | ${pc(xs.filter((r) => r.fn.correct_profile_reached_prompt).length, xs.length)} | ${pc(t.filter((r) => r.fn.pi_fact_reached_prompt).length, t.length)} |`);
  }
  const piRows = recs.filter((r) => PI_MODES.has(r.item.mode) && r.fn.pi_loaded);
  console.log(`\nRows with a profile loaded in a profile mode: ${piRows.length}. Other profile's identity strings in the prompt: ${piRows.filter((r) => r.fn.wrong_profile_reached_prompt).length}. Rows in the seven other modes with a profile loaded: ${recs.filter((r) => !PI_MODES.has(r.item.mode) && r.fn.pi_loaded).length}, of which profile evidence in the prompt: ${recs.filter((r) => r.fn.pi_in_forbidden_mode_prompt).length}.`);
  const missedFacts = {};
  for (const r of piCases) for (const q of r.fn.required.filter((x) => x.is_pi && x.reached_prompt_all === false)) if (r.partition !== 'holdout') missedFacts[q.fact] = (missedFacts[q.fact] ?? 0) + 1;
  console.log(`Profile facts most often missing from the prompt when needed (dev and supplementary sets): ${Object.entries(missedFacts).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `${k} ×${n}`).join(', ') || 'none'}.`);
}
