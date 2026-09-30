#!/usr/bin/env node
// Natively answer-generation baseline runner.
//
// MEASUREMENT ONLY. It never edits prompts, routing, parameters, or answers, and it never
// retries a failed generation to hide the failure. See README.md for the full contract.
//
//   NATIVELY_ROOT=<app root> node benchmarks/natively-answer-baseline/run.mjs [options]
//
//   --dataset <file>     frozen questions (default dataset/natively_benchmark_questions.json)
//   --mode a,b           templateType keys: sales,recruiting,team-meet,looking-for-work,lecture,technical-interview,seminar,call-center
//   --category c         only this category
//   --id ID[,ID]         only these benchmark ids (chains run whole)
//   --limit N            first N units per mode (smoke runs)
//   --run-id <id>        name the run (default nb-<date>-<dataset sha8>)
//   --resume <run-id>    continue an interrupted run (incomplete chains are moved aside and re-run whole)
//   --warmup N           warm-up requests before measuring (default 3, excluded from the data)
//   --timeout ms         per-request timeout (default 90000)
//   --plan               print the execution plan and exit
//   --no-export          do not build review/summary files at the end
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { APP_ROOT, connectApp } from './lib/cdp.mjs';
import { structureMetrics, diagnosticFlags, sha256 } from './lib/metrics.mjs';
import * as app from './lib/app.mjs';

export const HARNESS_VERSION = '2.0.0';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : d; };
const list = (v) => (v && v !== true ? String(v).split(',').map(s => s.trim()).filter(Boolean) : []);

const PARTITION = opt('partition', 'dev');
const datasetPath = path.resolve(opt('dataset', path.join(HERE, 'dataset', `${PARTITION}.json`)));
const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
{
  const { dataset_name, dataset_sha256, ...body } = dataset;
  const actual = sha256(JSON.stringify(body));
  if (actual !== dataset_sha256) { console.error(`dataset hash mismatch: file says ${dataset_sha256}, content hashes to ${actual}. Refusing to run a modified dataset.`); process.exit(2); }
}
const MODE_ORDER = dataset.modes.map(m => m.key);

let items = dataset.items;
if (list(opt('mode')).length) items = items.filter(i => list(opt('mode')).includes(i.mode));
if (opt('category')) items = items.filter(i => i.category === opt('category'));
if (list(opt('id')).length) {
  const want = new Set(list(opt('id')));
  const chains = new Set(items.filter(i => want.has(i.id) && i.conversation_id).map(i => i.conversation_id));
  items = items.filter(i => want.has(i.id) || (i.conversation_id && chains.has(i.conversation_id)));
}

// ---- units: a standalone row or a whole chain, grouped so mode/context switches are minimal ----
function buildUnits(all) {
  const units = [];
  const seen = new Set();
  for (const it of all) {
    if (it.conversation_id) {
      if (seen.has(it.conversation_id)) continue;
      seen.add(it.conversation_id);
      units.push(all.filter(x => x.conversation_id === it.conversation_id).sort((a, b) => a.turn_index - b.turn_index));
    } else units.push([it]);
  }
  const groupKey = (u) => `${u[0].context_ref ?? ''}|${u[0].pi_ref ?? ''}`;
  const out = [];
  for (const mk of MODE_ORDER) {
    const mu = units.filter(u => u[0].mode === mk);
    const keys = [...new Set(mu.map(groupKey))].sort((a, b) => (a === '|' ? -1 : b === '|' ? 1 : mu.findIndex(u => groupKey(u) === a) - mu.findIndex(u => groupKey(u) === b)));
    for (const k of keys) out.push(...mu.filter(u => groupKey(u) === k));
  }
  const limit = Number(opt('limit', 0));
  if (limit) {
    const per = {};
    return out.filter(u => (per[u[0].mode] = (per[u[0].mode] ?? 0) + 1) <= limit);
  }
  return out;
}
const units = buildUnits(items);

if (opt('plan')) {
  const per = {};
  for (const u of units) { per[u[0].mode] = per[u[0].mode] || { units: 0, rows: 0 }; per[u[0].mode].units++; per[u[0].mode].rows += u.length; }
  console.log(`dataset ${dataset.dataset_sha256}\nunits ${units.length}, rows ${units.reduce((n, u) => n + u.length, 0)}`);
  for (const [m, s] of Object.entries(per)) console.log(`  ${m}: ${s.units} units / ${s.rows} rows`);
  process.exit(0);
}

// ---- run identity ----
const git = (cwd, ...a) => spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).stdout?.trim() ?? '';
const runId = opt('resume') && opt('resume') !== true ? opt('resume') : (opt('run-id') && opt('run-id') !== true ? opt('run-id') : `aq-${PARTITION}-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '-')}-${dataset.dataset_sha256.slice(0, 8)}`);
const runDir = path.join(HERE, 'results', runId);
fs.mkdirSync(runDir, { recursive: true });
const F = {
  rows: path.join(runDir, 'natively_benchmark_full.jsonl'),
  wire: path.join(runDir, 'natively_benchmark_wire.jsonl'),
  systems: path.join(runDir, 'systems.json'),
  header: path.join(runDir, 'run.json'),
  aside: path.join(runDir, 'incomplete_rows.jsonl'),
};
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const systems = fs.existsSync(F.systems) ? JSON.parse(fs.readFileSync(F.systems, 'utf8')) : {};

let existing = readJsonl(F.rows);
if (opt('resume')) {
  // A chain is only trustworthy whole. Move partial chains aside (kept, not deleted) and re-run them.
  const byChain = {};
  for (const r of existing) if (r.conversation_id) (byChain[r.conversation_id] ??= []).push(r);
  const want = {};
  for (const it of dataset.items) if (it.conversation_id) want[it.conversation_id] = (want[it.conversation_id] ?? 0) + 1;
  const partial = new Set(Object.entries(byChain).filter(([id, rs]) => rs.length !== want[id]).map(([id]) => id));
  if (partial.size) {
    const moved = existing.filter(r => partial.has(r.conversation_id));
    fs.appendFileSync(F.aside, moved.map(r => JSON.stringify(r)).join('\n') + '\n');
    existing = existing.filter(r => !partial.has(r.conversation_id));
    fs.writeFileSync(F.rows, existing.map(r => JSON.stringify(r)).join('\n') + (existing.length ? '\n' : ''));
    const movedIds = new Set(moved.map(r => r.benchmark_id));
    const keptWire = readJsonl(F.wire).filter(r => !movedIds.has(r.benchmark_id));
    fs.writeFileSync(F.wire, keptWire.map(r => JSON.stringify(r)).join('\n') + (keptWire.length ? '\n' : ''));
    console.log(`resume: moved ${moved.length} rows of ${partial.size} incomplete chain(s) aside`);
  }
}
const done = new Set(existing.map(r => r.benchmark_id));
const todo = units.filter(u => !u.every(i => done.has(i.id)));
console.log(`run ${runId}: ${todo.length}/${units.length} units to do (${todo.reduce((n, u) => n + u.length, 0)} rows)`);
if (!todo.length) { console.log('nothing to do'); }

// ---- connect + profile ----
const envText = fs.readFileSync(path.resolve(process.env.NATIVELY_ENV_FILE || path.join(HERE, '..', '..', '.env')), 'utf8');
const dsKey = (envText.match(/^DEEPSEEK_API_KEY=(.*)$/m)?.[1] ?? '').trim().replace(/^["']|["']$/g, '').trim();
if (!dsKey) { console.error('DEEPSEEK_API_KEY not found in the env file (set NATIVELY_ENV_FILE).'); process.exit(2); }

const c = await connectApp();
if (!(await app.recorderEnabled(c))) { console.error('prompt recorder is off. Launch the instance with NATIVELY_E2E=1 NATIVELY_PROMPT_DEBUG=1 (npm run dev:agent).'); process.exit(2); }
const profile = await app.setupProfile(c, { deepseekKey: dsKey });
const gm = await app.builtinModeId(c, 'general').catch(() => 'mode_general_default');
console.log('llm config:', JSON.stringify(profile.config));

// ---- header ----
const appPkg = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8'));
const dirty = git(APP_ROOT, 'status', '--porcelain');
const header = fs.existsSync(F.header) ? JSON.parse(fs.readFileSync(F.header, 'utf8')) : {
  run_id: runId,
  harness_version: HARNESS_VERSION,
  partition: PARTITION,
  dataset_sha256: dataset.dataset_sha256,
  dataset_file: path.relative(HERE, datasetPath),
  git_commit: git(APP_ROOT, 'rev-parse', 'HEAD'),
  git_branch: git(APP_ROOT, 'rev-parse', '--abbrev-ref', 'HEAD'),
  git_dirty: dirty.length > 0,
  git_dirty_paths: dirty ? dirty.split('\n').length : 0,
  git_subject: git(APP_ROOT, 'log', '-1', '--format=%s'),
  shared_checkout: (() => { const top = path.resolve(HERE, '..', '..'); return top === APP_ROOT ? null : { path: top, head: git(top, 'rev-parse', 'HEAD'), branch: git(top, 'rev-parse', '--abbrev-ref', 'HEAD'), dirty_paths: git(top, 'status', '--porcelain').split('\n').filter(Boolean).length, note: 'not measured: the run used the isolated app_root above' }; })(),
  app_version: appPkg.version,
  app_root: APP_ROOT,
  started_at: new Date().toISOString(),
  finished_at: null,
  provider_model_config: profile.config,
  llm_keys_in_profile: ['deepseek'],
  default_config_before_keys: profile.before,
  pro_enabled_via_e2e_hook: profile.pro,
  os: `${os.type()} ${os.release()} ${os.arch()}`,
  node: process.version,
  warmup_requests: Number(opt('warmup', 3)),
  request_timeout_ms: Number(opt('timeout', 90000)),
  concurrency: 1,
  sessions: [],
};
header.sessions.push({ started_at: new Date().toISOString(), resumed: !!opt('resume') });
const saveHeader = () => fs.writeFileSync(F.header, JSON.stringify(header, null, 2) + '\n');
saveHeader();

// ---- warm-up (excluded from the data) ----
const WARM = Number(opt('warmup', 3));
async function warmUp() {
  await app.activateMode(c, gm);
  const asks = [['hotkey', 'What is a queue?'], ['typed', 'What is a stack?'], ['hotkey', 'What is a hash table?']].slice(0, WARM);
  for (const [surface, q] of asks) {
    await app.resetSession(c); await app.clearRecorder(c);
    const r = await app.timedAsk(c, { surface, question: q, timeoutMs: 90000 });
    await app.collectWire(c);
    console.log(`warm-up ${surface}: ttft ${r.firstTokenMs?.toFixed?.(0)} ms total ${r.totalMs?.toFixed?.(0)} ms (excluded)`);
  }
}
if (todo.length && WARM > 0) await warmUp();

// ---- context modes ----
// v2: documents are attached to the BUILT-IN mode itself (what a user gets by uploading a file to that mode),
// and removed when the next unit needs different material, so the built-in persona is always the one measured.
const modeCache = {};
async function modeFor(unit) {
  const it = unit[0];
  const id = modeCache[it.mode] ?? (modeCache[it.mode] = await app.builtinModeId(c, it.mode));
  const files = (await c.launcher.evaluate(`window.electronAPI.modesGetReferenceFiles(${JSON.stringify(id)})`)) ?? [];
  const ctx = it.context_ref ? dataset.contexts[it.context_ref] : null;
  const keep = files.filter(f => ctx && (f.fileName ?? f.file_name) === ctx.file_name);
  for (const f of files) if (!keep.includes(f)) {
    const r = await c.launcher.evaluate(`window.electronAPI.modesDeleteReferenceFile(${JSON.stringify(f.id)})`);
    if (r && r.success === false) throw new Error('delete reference file failed: ' + JSON.stringify(r));
  }
  let index = null;
  if (ctx && !keep.length) {
    const add = await c.invoke('__e2e__:add-reference-file', { modeId: id, fileName: ctx.file_name, content: ctx.text });
    if (!add?.success) throw new Error(`add-reference-file failed for ${ctx.id}: ${add?.error}`);
    await c.invoke('__e2e__:prewarm-mode', id);
    for (let i = 0; i < 40; i++) {
      const st = await c.invoke('__e2e__:index-status', id);
      const sx = st?.statuses ?? [];
      if (sx.length && sx.every(x => x.status === 'ready')) break;
      await new Promise(r => setTimeout(r, 500));
    }
  }
  if (ctx) index = (await c.invoke('__e2e__:index-status', id))?.statuses ?? [];
  const after = (await c.launcher.evaluate(`window.electronAPI.modesGetReferenceFiles(${JSON.stringify(id)})`)) ?? [];
  if (after.length !== (ctx ? 1 : 0)) throw new Error(`mode ${it.mode} has ${after.length} files, wanted ${ctx ? 1 : 0}`);
  return { id, name: `built-in ${it.mode}${ctx ? ' + ' + ctx.id : ''}`, custom: !!ctx, index, key: `${id}|${ctx?.id ?? ''}` };
}

// ---- row builder ----
const bool = (v) => (v === true ? true : v === false ? false : null);
const norm = (s) => String(s ?? '').toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, ' ');
function buildRow({ item, unit, modeInfo, m, wire, wsum, evidence, priorTurns, order, firstInMode, rowIndex, startedAt, piState, promptAll }) {
  const finalText = m.final ?? null;
  const raw = m.raw ?? '';
  const shown = finalText ?? raw;
  const note = wsum?.note ?? null;
  const facts = note?.extra?.turnFacts ?? null;
  const usage = wsum?.response?.usage ?? null;
  const inTok = usage?.prompt_tokens ?? usage?.gemini?.promptTokenCount ?? null;
  const outTok = usage?.completion_tokens ?? usage?.gemini?.candidatesTokenCount ?? null;
  const totTok = usage?.total_tokens ?? usage?.gemini?.totalTokenCount ?? null;
  const cached = usage?.prompt_cache_hit_tokens ?? usage?.prompt_tokens_details?.cached_tokens ?? usage?.gemini?.cachedContentTokenCount ?? null;
  const ttft = m.firstTokenMs == null ? null : +m.firstTokenMs.toFixed(1);
  const total = m.totalMs == null ? null : +m.totalMs.toFixed(1);
  const after = ttft != null && total != null ? +(total - ttft).toFixed(1) : null;
  const tps = outTok != null && after != null && after > 0 ? +(outTok / (after / 1000)).toFixed(2) : null;
  const sm = structureMetrics(shown);
  const diag = diagnosticFlags(shown);
  const empty = !shown.trim();
  const timeout = !!m.timedOut;
  const errText = m.err ? String(m.err).slice(0, 500) : null;
  const success = !timeout && !empty && !errText;
  const chatRecs = wire.records.filter(r => r.messages?.length);
  const noteRecs = chatRecs.filter(r => r.note);
  const expectsRef = !!modeInfo.custom; // the active mode has a document attached (chain turns 2+ inherit it)
  const groundedTx = item.context_type;
  return {
    benchmark_id: item.id, run_id: runId, run_order: order,
    mode: item.mode, mode_name: item.mode_name, category: item.category, difficulty: item.difficulty, length_class: item.length_class,
    question: item.question, speaker: item.speaker, surface_path: item.surface,
    context_condition: item.context_condition, context_type: groundedTx,
    context: {
      reference_file: item.context_ref ? { id: item.context_ref, title: dataset.contexts[item.context_ref].title, file_name: dataset.contexts[item.context_ref].file_name, sha256: dataset.contexts[item.context_ref].sha256, word_count: dataset.contexts[item.context_ref].word_count } : null,
      prior_transcript: item.prior_transcript,
      active_mode_id: modeInfo.id, active_mode_name: modeInfo.name, custom_mode: modeInfo.custom, reference_index: modeInfo.index,
    },
    reference_attached: expectsRef, reference_evidence_in_prompt: evidence.referenceEvidence, profile_evidence_in_prompt: evidence.profileEvidence, evidence_types: evidence.evidenceTypes,
    partition: item.partition ?? PARTITION, claim_trap: item.claim_trap ?? null, evidence_required: item.evidence_required ?? null,
    pi_ref: item.pi_ref ?? null, pi_eligible: item.pi_eligible ?? null, pi_state: piState,
    needles: item.needles ?? [], needles_in_prompt: (item.needles ?? []).map(n => norm(promptAll).includes(norm(n))), needles_in_answer: (item.needles ?? []).map(n => norm(shown).includes(norm(n))),
    pi_leak: !!evidence.profileEvidence && !item.pi_eligible,
    served_by_llm: chatRecs.length > 0,
    contamination: (!expectsRef && evidence.referenceEvidence) || (evidence.profileEvidence && !item.pi_eligible),
    conversation_id: item.conversation_id, turn_index: item.turn_index, chain_length: item.conversation_id ? unit.length : null, prior_turns: priorTurns,
    cross_mode_test: item.cross_mode_test, cross_mode_group: item.cross_mode_group,
    tags: item.tags, expected_answer_type: item.expected_answer_type,
    ...(item.coding_intent ? { coding_intent: item.coding_intent, ti_group: item.ti_group } : {}),
    ...(item.source_support ? { source_support: item.source_support } : {}),

    provider: wsum?.provider ?? null, model: wsum?.response?.response_model ?? wsum?.model ?? null, configured_model: wsum?.model ?? null,
    tier: note?.tier ?? null, action: facts?.personaAction ?? note?.action ?? null, surface: facts?.surface ?? null, chatSurface: note?.chatSurface ?? null,
    note_surface: note?.surface ?? null, note_mode: note?.mode ?? null,
    prompt_builder: note?.promptSource ?? null,
    v2_active: facts ? (facts.v2PersonaNull === false ? true : facts.v2PersonaNull === true ? false : null) : null,
    legacy_prompt_active: note?.promptSource ? note.promptSource !== 'v3' : null,
    wta_prompt_active: note?.promptSource ? (/wta|what_to_answer/i.test(note.promptSource) && note.promptSource !== 'v3') : null,
    tiny_prompt_active: note?.tier ? note.tier === 'tiny' : null,
    document_grounding_active: wsum ? evidence.referenceEvidence || evidence.profileEvidence : null,
    coding_contract_active: facts && 'codingTask' in facts ? bool(facts.codingTask) : null,
    coding_shape: facts?.codingShape ?? null,
    vision_contract_active: note?.extra && 'hasImages' in note.extra ? bool(note.extra.hasImages) : null,
    generation_params: wsum?.params ?? null,
    system_prompt_sha: wsum?.system_sha ?? null, system_prompt_chars: wsum?.system_chars ?? null,
    finish_reason: wsum?.response?.finish_reason ?? null, response_id: wsum?.response?.response_id ?? null, system_fingerprint: wsum?.response?.system_fingerprint ?? null,

    cold_start: rowIndex === 0 && WARM === 0, first_in_mode_session: firstInMode, warm: !(rowIndex === 0 && WARM === 0),
    ttft_ms: ttft, total_latency_ms: total, generation_after_first_token_ms: after,
    last_token_ms: m.lastTokenMs == null ? null : +m.lastTokenMs.toFixed(1), final_event_ms: m.finalEventMs == null ? null : +m.finalEventMs.toFixed(1),
    request_dispatch_ms: wsum?.dispatch_ms_after_t0 ?? null,
    stream_events: m.tokenEvents, generation_ids: m.generationIds, multiple_generations: (m.generationIds?.length ?? 0) > 1,
    input_tokens: inTok, output_tokens: outTok, total_tokens: totTok, cached_input_tokens: cached, tokens_per_second: tps,
    first_chunk: m.firstChunk,
    raw_answer: raw, rendered_answer: finalText !== null && finalText !== raw ? finalText : null, answer_differs_raw_vs_rendered: finalText !== null && finalText !== raw,
    raw_answer_sha256: sha256(raw), rendered_answer_sha256: finalText !== null ? sha256(finalText) : null,
    heard_question: m.heardQuestion,
    ...sm,
    ...diag.flags, diagnostic_matches: diag.matched,

    success, error_type: success ? null : timeout ? 'timeout' : errText ? 'app_error' : empty ? 'empty_response' : 'unknown', error_message: errText, timeout,
    usage_scope: chatRecs.length === 0 ? 'none' : chatRecs.length === 1 ? 'single_request' : 'first_request_of_multiple',
    second_pass_requests: Math.max(0, chatRecs.length - 1),
    retry_count: Math.max(0, noteRecs.length - 1), provider_retry: chatRecs.some(r => !r.status || r.status >= 400) && chatRecs.length > 1,
    llm_request_count: chatRecs.length, empty_response: empty,
    started_at: startedAt, finished_at: new Date().toISOString(),
  };
}

// ---- execution ----
function persist(row, wire, wsum, w) {
  fs.appendFileSync(F.rows, JSON.stringify(row) + '\n');
  if (w.main) systems[w.main.systemSha] = w.main.system;
  fs.appendFileSync(F.wire, JSON.stringify({
    benchmark_id: row.benchmark_id,
    wire: wsum,
    messages: w.main?.messages ?? null,
    other_requests: w.records.filter(r => r !== w.main && r.messages?.length).map(r => ({ provider: r.provider, model: r.model, status: r.status, systemSha: r.systemSha, note: r.note?.surface ?? null, messages: r.messages })),
  }) + '\n');
}
const uiFormat = (turns) => turns.map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text}`).slice(-20).join('\n');
const spoken = (a) => (a ?? '').replace(/\[\[GIST\]\][\s\S]*$/, '').trim();

let order = existing.length, rowIndex = 0, activeModeId = null, curPi = undefined;
const modesUsed = new Set(existing.map(r => r.context?.active_mode_id));
const startedRun = Date.now();
for (const unit of todo) {
  const modeInfo = await modeFor(unit);
  if (activeModeId !== modeInfo.key) {
    await app.activateMode(c, modeInfo.id); activeModeId = modeInfo.key; await new Promise(r => setTimeout(r, 300));
    const active = (await app.listModes(c)).filter(x => x.isActive).map(x => x.id);
    if (active.length !== 1 || active[0] !== modeInfo.id) { console.error(`mode activation failed: wanted ${modeInfo.id}, active ${JSON.stringify(active)}`); process.exit(3); }
  }
  const firstInMode = !modesUsed.has(modeInfo.id); modesUsed.add(modeInfo.id);
  const wantPi = unit[0].pi_ref ?? null;
  if (curPi === undefined || curPi.ref !== wantPi) {
    try { curPi = await app.ensurePi(c, dataset.pi_profiles ?? [], wantPi); console.log(`pi -> ${wantPi ?? 'none'} ${JSON.stringify({ r: curPi.hasStructuredResume, j: curPi.hasStructuredJD, mode: curPi.resumeExtractionMode })}`); }
    catch (e) { console.error('PI setup failed: ' + e); process.exit(3); }
  }
  const history = []; // typed chain: overlay-format turns; hotkey chain: transcript lines
  for (const item of unit) {
    const startedAt = new Date().toISOString();
    let priorTurns = null;
    if (item.turn_index === 1) {
      await app.resetSession(c);
      if (item.prior_transcript) await app.injectLines(c, item.prior_transcript);
    } else {
      if (item.surface === 'hotkey') {
        const last = history.filter(h => h.role === 'assistant').at(-1);
        const lines = [{ speaker: 'user', text: spoken(last?.text) }].filter(l => l.text);
        priorTurns = history.map(h => ({ role: h.role === 'assistant' ? 'user_spoken_answer' : 'other_party', text: h.role === 'assistant' ? spoken(h.text) : h.text }));
        if (lines.length) await app.injectLines(c, lines);
      } else {
        priorTurns = history.map(h => ({ role: h.role, text: h.role === 'assistant' ? spoken(h.text) : h.text }));
      }
    }
    await app.clearRecorder(c);
    let m;
    try {
      m = await app.timedAsk(c, { surface: item.surface, question: item.question, uiContext: item.surface === 'typed' && item.turn_index > 1 ? uiFormat(priorTurns.map(t => ({ role: t.role, text: t.text }))) : '', timeoutMs: Number(opt('timeout', 90000)) });
    } catch (e) {
      // A CDP/connection failure is infrastructure, not a product result: stop, do not record garbage.
      console.error(`infrastructure failure on ${item.id}: ${String(e).slice(0, 300)}\nresume with: --resume ${runId}`);
      header.finished_at = null; saveHeader(); fs.writeFileSync(F.systems, JSON.stringify(systems));
      process.exit(3);
    }
    // A timed-out or errored generation may still be running in production: let it drain so it cannot
    // emit into the next row's listener (ids are also recorded per row).
    if (m.timedOut || m.err) await new Promise(r => setTimeout(r, 10000));
    const w = await app.collectWire(c);
    const wsum = app.summariseWire(w, m.t0Epoch);
    const evidence = app.wireEvidenceFlags(w);
    const row = buildRow({ item, unit, modeInfo, m, wire: w, wsum, evidence, priorTurns, order: ++order, firstInMode: firstInMode && item === unit[0], rowIndex: rowIndex++, startedAt, piState: curPi, promptAll: app.promptText(w) });
    persist(row, null, wsum, w);
    history.push({ role: item.surface === 'hotkey' ? 'other' : 'user', text: item.question });
    history.push({ role: 'assistant', text: m.final ?? m.raw ?? '' });
    console.log(`${item.id.padEnd(15)} ${item.surface.padEnd(6)} ${row.success ? 'ok ' : 'ERR'} ttft ${String(row.ttft_ms ?? '-').padStart(7)} total ${String(row.total_latency_ms ?? '-').padStart(7)} ${String(row.word_count).padStart(3)}w ${row.prompt_builder ?? '-'}/${row.action ?? '-'} ${row.contamination ? 'CONTAMINATED ' : ''}${row.reference_attached ? (row.reference_evidence_in_prompt ? '[ref in prompt] ' : '[ref NOT in prompt] ') : ''}${JSON.stringify((row.rendered_answer ?? row.raw_answer).slice(0, 70))}`);
    if (order % 25 === 0) fs.writeFileSync(F.systems, JSON.stringify(systems));
  }
}
fs.writeFileSync(F.systems, JSON.stringify(systems));
await app.activateMode(c, gm).catch(() => {});
header.finished_at = new Date().toISOString();
header.sessions.at(-1).finished_at = header.finished_at;
saveHeader();
c.close();
console.log(`\ndone in ${((Date.now() - startedRun) / 60000).toFixed(1)} min → ${runDir}`);
if (!opt('no-export') && fs.existsSync(path.join(HERE, 'export.mjs'))) {
  const r = spawnSync(process.execPath, [path.join(HERE, 'export.mjs'), runDir], { stdio: 'inherit' });
  process.exit(r.status ?? 0);
}
process.exit(0);
