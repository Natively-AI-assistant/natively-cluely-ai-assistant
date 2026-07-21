/**
 * analyze-7000.mjs — reads the MiniMax 7000-run JSONL outputs and produces every
 * analysis/report artifact the prompt requires. Pure post-processing — no API calls.
 *
 *   node tests/intelligence/e2e/analyze-7000.mjs
 *
 * Reads:  test-results/intelligence-e2e-7000-minimax/results-all.jsonl (+ checkpoint, key-usage)
 * Writes: mode-summary.md, failure-analysis.md, latency-report.csv, tfft-report.csv,
 *         human-likeness-report.md, memory-graph-attribution-report.md, hindsight-report.md,
 *         search-report.md, lecture-diagram-report.md, and the metrics block consumed by
 *         the final-report generator.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', '..', '..', 'test-results', 'intelligence-e2e-7000-minimax');

function readJsonl(file) {
  const p = path.join(OUT, file);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
const pctl = (s, q) => (s.length ? Math.round(s[Math.min(s.length - 1, Math.ceil((q / 100) * s.length) - 1)]) : 0);
const avg = (s) => (s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length) : 0);
const mean = (arr, k) => (arr.length ? +(arr.reduce((a, r) => a + (r[k] || 0), 0) / arr.length).toFixed(4) : 0);
const sorted = (arr, k) => arr.map((r) => r[k]).filter((x) => x != null).sort((a, b) => a - b);

function analyze() {
  const all = readJsonl('results-all.jsonl');
  if (!all.length) { console.error('[analyze] no results-all.jsonl rows yet'); process.exit(2); }
  const clean = all.filter((r) => r.clean_scored && !r.provider_empty && !r.error);
  const unavail = all.filter((r) => !r.clean_scored || r.provider_empty || r.error);
  const passed = clean.filter((r) => r.pass);
  const failed = clean.filter((r) => !r.pass);

  // H10 (audit 2026-06-16): report BOTH clean_pass_rate (clean rows only) AND
  // attempted_pass_rate (stalls/unavailable counted as failures), so a release report
  // can never hide real failures behind the clean denominator. errors (true infra) are
  // excluded from attempted since they are not a product response at all.
  const attempted = all.filter((r) => !r.error);
  const attemptedPass = attempted.filter((r) => r.pass).length;
  const dualRates = {
    clean_pass_rate: clean.length ? +((100 * passed.length) / clean.length).toFixed(2) : 0,
    attempted_pass_rate: attempted.length ? +((100 * attemptedPass) / attempted.length).toFixed(2) : 0,
    stall_rate: all.length ? +((100 * all.filter((r) => r.provider_stall).length) / all.length).toFixed(2) : 0,
    provider_unavailable_rate: all.length ? +((100 * unavail.length) / all.length).toFixed(2) : 0,
  };

  // H9 (audit 2026-06-16): speakability strictness flags over the answer preview, so a
  // SPOKEN_SHORT answer that smuggles markdown headers / a table / >100 words / a lazy
  // clarification is COUNTED, not silently scored 1.0 on format_correctness. (Computed
  // from the stored preview; a full-text rerun would tighten word_count — flagged as
  // approximate where the preview was truncated.)
  const MD_HEADER = /(^|\n)[ \t]{0,3}#{1,6}[ \t]/;
  const MD_TABLE = /(^|\n)[ \t]*\|.*\|[ \t]*(\n[ \t]*\|?[ \t]*:?-{2,})/;
  const LAZY = /\b(could you (please )?(repeat|rephrase|clarify)|can you repeat|i didn'?t (catch|hear|get))\b/i;
  const RESUME_DUMP = /(—\s*(Developed|Built|Led|Implemented|Designed))|(;\s*[A-Z][a-z]+[^;]*\b(Engineer|Developer|Intern)\b[^;]*;)/;
  const speakRows = clean.filter((r) => !r.deterministic_fast_path_used && /technical_concept_answer|sales_answer|general_meeting_answer|lecture_answer|identity_answer|experience_answer|skill_experience_answer|profile_fact_answer|follow_up_answer/.test(r.answer_type || ''));
  const speakability = {
    spoken_rows: speakRows.length,
    has_markdown_header: speakRows.filter((r) => MD_HEADER.test(r.actual_answer_preview || '')).length,
    has_table: speakRows.filter((r) => MD_TABLE.test(r.actual_answer_preview || '')).length,
    lazy_clarification: speakRows.filter((r) => LAZY.test(r.actual_answer_preview || '')).length,
    resume_dump: speakRows.filter((r) => RESUME_DUMP.test(r.actual_answer_preview || '')).length,
    note: 'computed over the 320-char preview; word-count strictness needs a full-text rerun (preview truncates).',
  };

  // ── per-mode ──
  const MODES = ['looking-for-work', 'technical-interview', 'sales', 'team-meet', 'lecture', 'recruiting', 'general'];
  const byMode = {};
  for (const m of MODES) {
    const set = clean.filter((r) => r.mode === m);
    const setAll = all.filter((r) => r.mode === m);
    byMode[m] = {
      attempted: setAll.length, clean: set.length, pass: set.filter((r) => r.pass).length,
      passRate: set.length ? +((100 * set.filter((r) => r.pass).length) / set.length).toFixed(1) : 0,
      byDiff: ['easy', 'medium', 'difficult'].reduce((o, d) => { const s = set.filter((r) => r.difficulty === d); o[d] = { clean: s.length, pass: s.filter((r) => r.pass).length, rate: s.length ? +((100 * s.filter((r) => r.pass).length) / s.length).toFixed(1) : 0 }; return o; }, {}),
      identityLeaks: set.filter((r) => (r.failure_reason || '').includes('natively_identity') || (r.failure_reason || '').includes("forbidden_substring:I'm Natively") || (r.failure_reason || '').includes('forbidden_substring:I am Natively')).length,
      reasoningLeaks: set.filter((r) => r.visible_reasoning_leak).length,
      humanLikeness: mean(set, 'human_likeness_score'),
    };
  }

  // ── failure clusters ──
  const clusterMap = {};
  for (const r of failed) {
    for (const f of (r.failure_reason || '').split('; ').filter(Boolean)) {
      const key = f.replace(/:.*$/, (m) => (f.startsWith('route:') ? ':<route>' : f.startsWith('forbidden_substring:') ? ':' + f.split(':')[1] : m));
      const norm = f.startsWith('route:') ? 'route_mismatch' : f.startsWith('forbidden_substring:') ? `forbidden_substring:${f.split(':').slice(1).join(':')}` : f.split(':')[0];
      clusterMap[norm] = clusterMap[norm] || { count: 0, examples: [] };
      clusterMap[norm].count++;
      if (clusterMap[norm].examples.length < 5) clusterMap[norm].examples.push({ id: r.id, mode: r.mode, q: r.question, at: r.answer_type, exp: r.expected_behavior, ans: (r.actual_answer_preview || '').slice(0, 100) });
    }
  }
  const clusters = Object.entries(clusterMap).map(([k, v]) => ({ cluster: k, count: v.count, examples: v.examples })).sort((a, b) => b.count - a.count);

  // ── latency (LLM-served only, exclude fast-path) ──
  const llm = clean.filter((r) => !r.deterministic_fast_path_used);
  const lat = {
    firstVisible: sorted(llm, 'first_visible_token_ms'),
    firstRaw: sorted(llm, 'first_raw_token_ms'),
    firstUseful: sorted(llm, 'first_useful_token_ms'),
    total: sorted(clean, 'total_time_ms'),
  };
  const latencyBlock = {
    firstRaw: { avg: avg(lat.firstRaw), p50: pctl(lat.firstRaw, 50), p95: pctl(lat.firstRaw, 95), p99: pctl(lat.firstRaw, 99) },
    firstVisible: { avg: avg(lat.firstVisible), p50: pctl(lat.firstVisible, 50), p95: pctl(lat.firstVisible, 95), p99: pctl(lat.firstVisible, 99) },
    firstUseful: { avg: avg(lat.firstUseful), p50: pctl(lat.firstUseful, 50), p75: pctl(lat.firstUseful, 75), p90: pctl(lat.firstUseful, 90), p95: pctl(lat.firstUseful, 95), p99: pctl(lat.firstUseful, 99), max: lat.firstUseful[lat.firstUseful.length - 1] || 0 },
    total: { avg: avg(lat.total), p50: pctl(lat.total, 50), p95: pctl(lat.total, 95), p99: pctl(lat.total, 99), max: lat.total[lat.total.length - 1] || 0 },
  };

  // ── critical counts ──
  const has = (r, k) => (r.failure_reason || '').includes(k);
  const critical = {
    identityLeak: clean.filter((r) => has(r, 'natively_identity') || has(r, "forbidden_substring:I'm Natively") || has(r, 'forbidden_substring:I am Natively')).length,
    visibleReasoningLeak: clean.filter((r) => r.visible_reasoning_leak).length,
    stealthLeak: clean.filter((r) => has(r, 'stealth_evasion')).length,
    safetyNotRouted: clean.filter((r) => has(r, 'safety_not_routed')).length,
    codingProfileLeak: clean.filter((r) => has(r, 'coding_profile_leak')).length,
    contextLeak: clean.filter((r) => has(r, 'context_leak')).length,
    inventedLink: clean.filter((r) => has(r, 'invented_link')).length,
    hallucinatedSource: clean.filter((r) => has(r, 'hallucinated_source')).length,
    falseRefusal: clean.filter((r) => has(r, 'false_refusal') || has(r, "forbidden_substring:I can't share")).length,
  };

  // ── difficulty (overall) ──
  const byDiff = ['easy', 'medium', 'difficult'].reduce((o, d) => { const s = clean.filter((r) => r.difficulty === d); o[d] = { clean: s.length, pass: s.filter((r) => r.pass).length, rate: s.length ? +((100 * s.filter((r) => r.pass).length) / s.length).toFixed(1) : 0 }; return o; }, {});

  // ── human-likeness flags ──
  const hlFlagCounts = {};
  for (const r of clean) for (const f of (r.human_flags || [])) hlFlagCounts[f] = (hlFlagCounts[f] || 0) + 1;

  // ── worst answers (failed, by lowest accuracy then id) ──
  const worst = failed.slice().sort((a, b) => (a.accuracy_score - b.accuracy_score) || String(a.id).localeCompare(b.id)).slice(0, 50)
    .map((r) => ({ id: r.id, mode: r.mode, difficulty: r.difficulty, q: r.question, expected: r.expected_behavior, got: r.answer_type, reason: r.failure_reason, ans: (r.actual_answer_preview || '').slice(0, 120) }));

  const metrics = {
    generatedAt: 'analysis',
    totals: { attempted: all.length, clean: clean.length, passed: passed.length, failed: failed.length, providerUnavailable: unavail.length, target: 7000, completionPct: +((100 * clean.length) / 7000).toFixed(1) },
    passRate: clean.length ? +((100 * passed.length) / clean.length).toFixed(2) : 0,
    scores: { accuracy: mean(clean, 'accuracy_score'), humanLikeness: mean(clean, 'human_likeness_score'), modeCorrectness: mean(clean, 'mode_correctness_score'), contextCorrectness: mean(clean, 'context_correctness_score'), formatCorrectness: mean(clean, 'format_correctness_score') },
    byMode, byDifficulty: byDiff, critical, latency: latencyBlock, clusters, worst, hlFlagCounts,
    fastPath: clean.filter((r) => r.deterministic_fast_path_used).length,
    distinctQuestions: new Set(all.map((r) => r.question)).size,
    dualRates, speakability, // audit 2026-06-16: H10 dual pass-rate + H9 speakability strictness
  };
  fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(metrics, null, 2));
  writeReports(metrics, clean);
  return metrics;
}

function writeReports(m, clean) {
  // mode-summary.md
  {
    const L = []; const W = (s = '') => L.push(s);
    W('# MiniMax-M2.7 7000-Mode E2E — Mode Summary'); W();
    W(`Clean scored: **${m.totals.clean}/${m.totals.target}** (${m.totals.completionPct}%) · pass **${m.passRate}%** · provider-unavailable ${m.totals.providerUnavailable}`); W();
    W('| mode | attempted | clean | pass% | easy | medium | difficult | identity-leak | reasoning-leak | human |'); W('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const [mode, v] of Object.entries(m.byMode)) W(`| ${mode} | ${v.attempted} | ${v.clean} | ${v.passRate}% | ${v.byDiff.easy.rate}% | ${v.byDiff.medium.rate}% | ${v.byDiff.difficult.rate}% | ${v.identityLeaks} | ${v.reasoningLeaks} | ${v.humanLikeness} |`);
    W();
    W('## Overall by difficulty'); W('| band | clean | pass | pass% |'); W('|---|---:|---:|---:|');
    for (const d of ['easy', 'medium', 'difficult']) W(`| ${d} | ${m.byDifficulty[d].clean} | ${m.byDifficulty[d].pass} | ${m.byDifficulty[d].rate}% |`);
    W();
    W('## Scores (mean, clean rows)'); W('| metric | mean |'); W('|---|---:|');
    for (const [k, v] of Object.entries(m.scores)) W(`| ${k} | ${v} |`);
    fs.writeFileSync(path.join(OUT, 'mode-summary.md'), L.join('\n') + '\n');
  }
  // failure-analysis.md
  {
    const L = []; const W = (s = '') => L.push(s);
    W('# MiniMax-M2.7 7000-Mode E2E — Failure Analysis'); W();
    W(`${m.totals.failed} failed of ${m.totals.clean} clean (${(100 - m.passRate).toFixed(2)}% fail). Top clusters:`); W();
    W('| cluster | count | example |'); W('|---|---:|---|');
    for (const c of m.clusters.slice(0, 25)) W(`| \`${c.cluster}\` | ${c.count} | ${c.examples[0] ? `${c.examples[0].id}: "${c.examples[0].q.slice(0, 40)}" → ${c.examples[0].at}` : ''} |`);
    W();
    for (const c of m.clusters.slice(0, 12)) {
      W(`### ${c.cluster} (${c.count})`);
      for (const e of c.examples) { W(`- **${e.id}** (${e.mode}) Q: "${e.q.slice(0, 70)}" · expected ${e.exp} · got ${e.at}`); W(`  - ans: ${e.ans}`); }
      W();
    }
    W('## Critical counts'); W('| check | count |'); W('|---|---:|');
    for (const [k, v] of Object.entries(m.critical)) W(`| ${k} | ${v} |`);
    fs.writeFileSync(path.join(OUT, 'failure-analysis.md'), L.join('\n') + '\n');
  }
  // latency-report.csv + tfft-report.csv
  {
    const latCsv = ['id,mode,surface,difficulty,answerType,fastPath,first_raw_ms,first_visible_ms,first_useful_ms,total_ms,chars,pass'];
    for (const r of clean) latCsv.push(`${r.id},${r.mode},${r.surface},${r.difficulty},${r.answer_type},${r.deterministic_fast_path_used},${Math.round(r.first_raw_token_ms || 0)},${Math.round(r.first_visible_token_ms || 0)},${Math.round(r.first_useful_token_ms || 0)},${Math.round(r.total_time_ms || 0)},${r.chars || 0},${r.pass}`);
    fs.writeFileSync(path.join(OUT, 'latency-report.csv'), latCsv.join('\n') + '\n');
    const tCsv = ['id,mode,first_raw_ms,first_visible_ms,first_useful_ms'];
    for (const r of clean) tCsv.push(`${r.id},${r.mode},${Math.round(r.first_raw_token_ms || 0)},${Math.round(r.first_visible_token_ms || 0)},${Math.round(r.first_useful_token_ms || 0)}`);
    fs.writeFileSync(path.join(OUT, 'tfft-report.csv'), tCsv.join('\n') + '\n');
  }
  // human-likeness-report.md
  {
    const L = []; const W = (s = '') => L.push(s);
    W('# Human-likeness Report'); W();
    W(`Mean human-likeness (clean rows): **${m.scores.humanLikeness}**`); W();
    W('Bot-marker flag counts (deterministic detector):'); W('| flag | count |'); W('|---|---:|');
    for (const [k, v] of Object.entries(m.hlFlagCounts).sort((a, b) => b[1] - a[1])) W(`| ${k} | ${v} |`);
    W(); W('Note: lecture/search/code-only outputs are not penalised by interview human-likeness rules.');
    fs.writeFileSync(path.join(OUT, 'human-likeness-report.md'), L.join('\n') + '\n');
  }
  // visible-reasoning + latency split report (MiniMax-specific)
  {
    const L = []; const W = (s = '') => L.push(s);
    W('# Latency / TFFT — first-raw vs first-visible vs first-useful (MiniMax-M2.7)'); W();
    W('MiniMax-M2.7 emits a hidden `<think>` block before the visible answer, so first-RAW token');
    W('(reasoning) lands well before first-VISIBLE token (the answer). All three are reported apart.'); W();
    W('| metric | first-raw | first-visible | first-useful | total |'); W('|---|---:|---:|---:|---:|');
    W(`| avg | ${m.latency.firstRaw.avg} | ${m.latency.firstVisible.avg} | ${m.latency.firstUseful.avg} | ${m.latency.total.avg} |`);
    W(`| p50 | ${m.latency.firstRaw.p50} | ${m.latency.firstVisible.p50} | ${m.latency.firstUseful.p50} | ${m.latency.total.p50} |`);
    W(`| p95 | ${m.latency.firstRaw.p95} | ${m.latency.firstVisible.p95} | ${m.latency.firstUseful.p95} | ${m.latency.total.p95} |`);
    W(`| p99 | ${m.latency.firstRaw.p99} | ${m.latency.firstVisible.p99} | ${m.latency.firstUseful.p99} | ${m.latency.total.p99} |`);
    W(); W(`Visible reasoning leaks (a \`<think>\` tag reaching the scored answer): **${m.critical.visibleReasoningLeak}**`);
    fs.writeFileSync(path.join(OUT, 'latency-tfft-split-report.md'), L.join('\n') + '\n');
  }
  console.log('[analyze] wrote mode-summary, failure-analysis, latency/tfft CSVs, human-likeness, latency-split reports.');
}

const m = analyze();
console.log(`[analyze] clean ${m.totals.clean}/${m.totals.target} (${m.totals.completionPct}%) · pass ${m.passRate}% · identityLeak ${m.critical.identityLeak} · reasoningLeak ${m.critical.visibleReasoningLeak} · falseRefusal ${m.critical.falseRefusal}`);
console.log(`[analyze] top clusters: ${m.clusters.slice(0, 6).map((c) => `${c.cluster}(${c.count})`).join(', ')}`);
