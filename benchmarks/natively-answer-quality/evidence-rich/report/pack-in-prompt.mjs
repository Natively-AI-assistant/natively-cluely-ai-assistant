// Judge-free: on how many turns is every loaded file of the mode's pack in the prompt?
//   node evidence-rich/report/pack-in-prompt.mjs m1 m2 -- dev cf [--blind]
// Run from benchmarks/natively-answer-quality.
import { loadRun } from '../objective.mjs';
const argv = process.argv.slice(2).filter((a) => a !== '--blind'); const cut = argv.indexOf('--'); const tags = argv.slice(0, cut), sets = argv.slice(cut + 1);
for (const tag of tags) { const t = {}; let rows = 0, all = 0, some = 0, none = 0, fast = 0, fastRead = 0; const fastTtft = [], otherTtft = [];
  for (const s of sets) { const run = loadRun(`evidence-rich/results/er-${s}-${tag}`);
    for (const row of run.rows) { const item = run.ds.byId[row.benchmark_id]; const cfg = run.ds.configsById.get(row.evidence_config); const loaded = (cfg?.files ?? []).length; if (!loaded) continue;
      const u = (run.wire[row.benchmark_id]?.messages ?? []).map((m) => m.text ?? '').join('\n');
      const names = new Set([...u.matchAll(/<evidence ([^>]*)>/g)].map((m) => m[1]).filter((a) => /provenance="MODE_REFERENCE_FILE"/.test(a)).map((a) => (a.match(/source_name="([^"]*)"/) ?? [])[1]));
      const path = row.v3_trace?.path; const cls = row.v3_trace?.classifierPath ?? null; rows++;
      const state = names.size >= loaded ? 'all' : names.size === 0 ? 'none' : 'some'; if (state === 'all') all++; else if (state === 'some') some++; else none++;
      const planned = (row.v3_trace?.planned ?? []); const fastTurn = path === 'FAST'; if (fastTurn) { fast++; if (state === 'all') fastRead++; if (row.surface !== 'typed' && Number.isFinite(row.ttft_ms)) fastTtft.push(row.ttft_ms); } else if (row.surface !== 'typed' && Number.isFinite(row.ttft_ms)) otherTtft.push(row.ttft_ms);
      const k = `${item.mode} ${row.surface === 'typed' ? 'typed' : 'heard'}`; const e = t[k] = t[k] ?? { rows: 0, all: 0, some: 0, none: 0 }; e.rows++; e[state]++; } }
  const med = (v) => { const x = [...v].sort((a, b) => a - b); return x.length ? Math.round(x[Math.floor(x.length / 2)]) : NaN; };
  console.log(`${tag} (${sets.join('+')}): turns with a pack loaded ${rows}; whole pack in the prompt ${all}; some files missing ${some}; no file read ${none}; fast-path turns ${fast}, of which read the whole pack ${fastRead}; heard first word median: fast-path turns ${med(fastTtft)} ms (n ${fastTtft.length}), other turns ${med(otherTtft)} ms (n ${otherTtft.length})`);
  const bad = Object.entries(t).filter(([, e]) => e.some || e.none).map(([k, e]) => `${k}: ${e.some} missing a file, ${e.none} none (of ${e.rows})`); if (bad.length) console.log(`   ${bad.join(' | ')}`); }
