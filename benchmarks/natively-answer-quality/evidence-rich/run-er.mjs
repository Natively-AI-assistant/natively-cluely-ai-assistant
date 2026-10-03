#!/usr/bin/env node
// evidence-rich-v1 runner. MEASUREMENT ONLY: it drives the real app, never edits prompts or answers, never retries a
// generation to hide a failure.
//
// What is different from ../run.mjs (which stays untouched so the frozen series is unchanged):
//   * A case declares its whole evidence state: the files of every mode (the base pack of each mode stays loaded,
//     as a user would have it; the case's own mode gets `evidence_config`) and the Profile Intelligence state.
//   * Files are uploaded as FILES through `__e2e__:upload-reference-file-from-path`, i.e. the production
//     ingestModeReferenceFile → extractSafeDocumentText (PDF / DOCX / text parsers), from a fixture root that holds
//     nothing but uploadable evidence (NATIVELY_E2E_REFERENCE_ROOT = evidence-rich/evidence).
//   * Résumé and JD go through `__e2e__:ingest-profile-doc` as the real PDF / DOCX / text files.
//   * Before every case the active mode, every mode's file list and the profile are read back from the app. A case
//     whose state cannot be confirmed is recorded as `environment_state_unverified` and is not asked.
//   * Each row keeps what is needed to tell retrieval from generation without a judge: the app's own `[V3]` trace
//     line of the turn, the evidence tags of the prompt, and the prompt text (in the wire file).
//
//   NATIVELY_ROOT=<app worktree> NATIVELY_ENV_FILE=<.env> node evidence-rich/run-er.mjs --partition dev --run-id er-dev-base
//   --partition dev|holdout|supp-counterfactual|supp-isolation   --mode a,b   --id X,Y   --limit N (units per mode)
//   --resume <run-id>   --warmup N   --timeout ms   --plan
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { APP_ROOT, connectApp } from '../lib/cdp.mjs';
import * as app from '../lib/app.mjs';

export const RUNNER_VERSION = 'er-1.0.0';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const EVID = path.join(HERE, 'evidence');
// ER_BENCH_DIR: datasets, oracles and results of a rig smoke test on a partial corpus live elsewhere; default is here.
const BENCH = process.env.ER_BENCH_DIR ? path.resolve(process.env.ER_BENCH_DIR) : HERE;
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : d; };
const list = (v) => (v && v !== true ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : []);
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const norm = (s) => String(s ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

// ---- frozen inputs: refuse anything that does not hash to what was frozen ----
const PARTITION = opt('partition', 'dev');
const dataset = readJson(path.join(BENCH, 'datasets', `${PARTITION}.json`));
{
  const { dataset_name, dataset_sha256, ...body } = dataset;
  if (sha256(JSON.stringify(body)) !== dataset_sha256) { console.error('dataset hash mismatch: refusing to run a modified dataset.'); process.exit(2); }
}
const manifest = readJson(path.join(BENCH, 'oracles', 'evidence-manifest.json'));
{
  const { manifest_sha256, ...body } = manifest;
  if (sha256(JSON.stringify(body)) !== manifest_sha256 || manifest_sha256 !== dataset.manifest_sha256) { console.error('evidence manifest hash mismatch: refusing to run.'); process.exit(2); }
}
const FILES = new Map(manifest.files.map((f) => [f.id, f]));
const CONFIGS = new Map(dataset.configs.map((c) => [c.id, c]));
const MODE_KEYS = dataset.modes.map((m) => m.key);
const BASE = Object.fromEntries(MODE_KEYS.map((k) => [k, dataset.configs.find((c) => c.mode === k && c.base)?.id ?? null]));
const PI_STATES = manifest.pi_states;
const identities = fs.existsSync(path.join(BENCH, 'oracles', 'pi-identities.json')) ? readJson(path.join(BENCH, 'oracles', 'pi-identities.json')) : {};
const piProfileOf = (state) => (state && state !== 'none' ? state.split('-')[0] : null);

let items = dataset.items;
if (list(opt('mode')).length) items = items.filter((i) => list(opt('mode')).includes(i.mode));
if (list(opt('id')).length) {
  const want = new Set(list(opt('id')));
  const groups = new Set(items.filter((i) => want.has(i.id)).map((i) => i.conversation_id ?? i.sequence_id).filter(Boolean));
  items = items.filter((i) => want.has(i.id) || groups.has(i.conversation_id) || groups.has(i.sequence_id));
}

// ---- units: a standalone row, a conversation chain, or an ordered sequence (profile / mode switches) ----
function buildUnits(all) {
  const units = []; const seen = new Set();
  for (const it of all) {
    const g = it.sequence_id ?? it.conversation_id;
    if (g) {
      if (seen.has(g)) continue; seen.add(g);
      units.push(all.filter((x) => (x.sequence_id ?? x.conversation_id) === g).sort((a, b) => (a.seq_index ?? a.turn_index) - (b.seq_index ?? b.turn_index)));
    } else units.push([it]);
  }
  // Fewest state changes: by mode, then PI state, then the mode's own file set. Sequences keep their authored order.
  const key = (u) => `${String(MODE_KEYS.indexOf(u[0].mode)).padStart(2, '0')}|${u[0].sequence_id ? 'z' : 'a'}|${u[0].pi_state ?? 'none'}|${u[0].evidence_config ?? ''}`;
  const out = units.map((u, i) => ({ u, i })).sort((a, b) => key(a.u).localeCompare(key(b.u)) || a.i - b.i).map((x) => x.u);
  const limit = Number(opt('limit', 0));
  if (!limit) return out;
  const per = {};
  return out.filter((u) => (per[u[0].mode] = (per[u[0].mode] ?? 0) + 1) <= limit);
}
const units = buildUnits(items);
if (opt('plan')) {
  const per = {};
  for (const u of units) { per[u[0].mode] ??= { units: 0, rows: 0, states: new Set() }; per[u[0].mode].units++; per[u[0].mode].rows += u.length; per[u[0].mode].states.add(`${u[0].evidence_config}|${u[0].pi_state}`); }
  console.log(`dataset ${dataset.dataset_sha256.slice(0, 12)} manifest ${manifest.manifest_sha256.slice(0, 12)}\nunits ${units.length}, rows ${units.reduce((n, u) => n + u.length, 0)}`);
  for (const [m, s] of Object.entries(per)) console.log(`  ${m}: ${s.units} units / ${s.rows} rows / ${s.states.size} evidence states`);
  process.exit(0);
}

// ---- run identity ----
const git = (cwd, ...a) => spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).stdout?.trim() ?? '';
const runId = opt('resume') && opt('resume') !== true ? opt('resume') : (opt('run-id') && opt('run-id') !== true ? opt('run-id') : `er-${PARTITION}-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '-')}`);
const runDir = path.join(BENCH, 'results', runId);
fs.mkdirSync(runDir, { recursive: true });
const F = {
  rows: path.join(runDir, 'rows.jsonl'), wire: path.join(runDir, 'wire.jsonl'), systems: path.join(runDir, 'systems.json'), header: path.join(runDir, 'run.json'),
  aside: path.join(runDir, 'incomplete_rows.jsonl'), ingest: path.join(runDir, 'ingest.jsonl'), pi: path.join(runDir, 'pi.jsonl'),
};
const systems = fs.existsSync(F.systems) ? readJson(F.systems) : {};
export const APP_FALLBACK_RE = /didn.t come through from the AI provider|couldn.t generate an answer just now|No answer came back this time/i;
const failedRow = (r) => r.error_type !== 'environment_state_unverified' ? (r.success === false || APP_FALLBACK_RE.test(String(r.rendered_answer ?? r.raw_answer ?? ''))) : true;
const groupOf = (r) => r.sequence_id ?? r.conversation_id ?? null;

let existing = readJsonl(F.rows);
if (opt('resume')) {
  // Failed and unverified rows are re-run with their whole chain / sequence; they are moved aside, never deleted.
  const want = {};
  for (const it of dataset.items) { const g = it.sequence_id ?? it.conversation_id; if (g) want[g] = (want[g] ?? 0) + 1; }
  const have = {};
  for (const r of existing) { const g = groupOf(r); if (g) have[g] = (have[g] ?? 0) + 1; }
  const badGroups = new Set([...existing.filter(failedRow).map(groupOf).filter(Boolean), ...Object.keys(have).filter((g) => have[g] !== want[g])]);
  const drop = (r) => failedRow(r) || (groupOf(r) && badGroups.has(groupOf(r)));
  const moved = existing.filter(drop);
  if (moved.length) {
    fs.appendFileSync(F.aside, moved.map((r) => JSON.stringify(r)).join('\n') + '\n');
    existing = existing.filter((r) => !drop(r));
    fs.writeFileSync(F.rows, existing.map((r) => JSON.stringify(r)).join('\n') + (existing.length ? '\n' : ''));
    const ids = new Set(moved.map((r) => r.benchmark_id));
    const keep = readJsonl(F.wire).filter((r) => !ids.has(r.benchmark_id));
    fs.writeFileSync(F.wire, keep.map((r) => JSON.stringify(r)).join('\n') + (keep.length ? '\n' : ''));
    console.log(`resume: set ${moved.length} row(s) aside to re-run`);
  }
}
const done = new Set(existing.map((r) => r.benchmark_id));
const todo = units.filter((u) => !u.every((i) => done.has(i.id)));
console.log(`run ${runId}: ${todo.length}/${units.length} units to do (${todo.reduce((n, u) => n + u.length, 0)} rows)`);

// ---- connect, one LLM key, Pro on ----
const envText = fs.readFileSync(path.resolve(process.env.NATIVELY_ENV_FILE || path.join(HERE, '..', '..', '..', '.env')), 'utf8');
const envKey = (name) => (envText.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1] ?? '').trim().replace(/^["']|["']$/g, '').trim();
const dsKey = envKey('DEEPSEEK_API_KEY');
if (!dsKey) { console.error('DEEPSEEK_API_KEY not found in the env file (set NATIVELY_ENV_FILE).'); process.exit(2); }
const c = await connectApp();
if (!(await app.recorderEnabled(c))) { console.error('prompt recorder is off. Launch with NATIVELY_E2E=1 NATIVELY_PROMPT_DEBUG=1.'); process.exit(2); }
const profile = await app.setupProfile(c, { deepseekKey: dsKey });
const modeIds = {};
for (const k of MODE_KEYS) modeIds[k] = await app.builtinModeId(c, k);
console.log('llm config:', JSON.stringify(profile.config));

// The app's own log (stdout of dev:agent): the `[V3] {…}` line of each turn is read back from it.
const LOG_POINTER = path.join(BENCH, 'results', '.app-log-path');
const APP_LOG = process.env.ER_APP_LOG || (fs.existsSync(LOG_POINTER) ? fs.readFileSync(LOG_POINTER, 'utf8').trim() : null);
const logSize = () => { try { return APP_LOG ? fs.statSync(APP_LOG).size : 0; } catch { return 0; } };
function logSince(offset) {
  if (!APP_LOG) return null;
  try {
    const size = fs.statSync(APP_LOG).size; if (size <= offset) return '';
    const fd = fs.openSync(APP_LOG, 'r'); const buf = Buffer.alloc(Math.min(size - offset, 4 * 1024 * 1024)); fs.readSync(fd, buf, 0, buf.length, offset); fs.closeSync(fd);
    return buf.toString('utf8');
  } catch { return null; }
}
function parseTrace(text) {
  if (text == null) return { available: false };
  const v3 = [];
  const lat = [];
  for (const line of text.split('\n')) {
    const i = line.indexOf('[V3] {');
    if (i >= 0) { try { v3.push(JSON.parse(line.slice(i + 5))); } catch { /* partial line */ } }
    else if (/PI LATENCY TRACE|\[LATENCY\]/.test(line) && lat.length < 24) lat.push(line.slice(0, 400));
  }
  return { available: true, v3, latency_lines: lat };
}

const appPkg = readJson(path.join(APP_ROOT, 'package.json'));
const dirty = git(APP_ROOT, 'status', '--porcelain');
const header = fs.existsSync(F.header) ? readJson(F.header) : {
  run_id: runId, runner_version: RUNNER_VERSION, benchmark: 'evidence-rich-v1', partition: PARTITION,
  dataset_sha256: dataset.dataset_sha256, manifest_sha256: manifest.manifest_sha256,
  git_commit: git(APP_ROOT, 'rev-parse', 'HEAD'), git_branch: git(APP_ROOT, 'rev-parse', '--abbrev-ref', 'HEAD'), git_dirty: dirty.length > 0, git_dirty_paths: dirty ? dirty.split('\n').length : 0,
  app_version: appPkg.version, app_root: APP_ROOT, started_at: new Date().toISOString(), finished_at: null,
  provider_model_config: profile.config, default_config_before_keys: profile.before, pro_enabled_via_e2e_hook: profile.pro,
  // §81–§84: the AgentRouter → DeepSeek generator route was requested first. The build under test (e000db4a) has no
  // AgentRouter provider (no setAgentRouterApiKey in its preload), a deterministic failure, so generation is on the
  // direct DeepSeek key — the fallback the spec names — and every row says so.
  generator: { requested_first: 'agentrouter/deepseek', used: 'deepseek-direct', generator_fallback: true, fallback_reason: 'the AgentRouter provider is not in the build under test (e000db4a); adding it would change the build' },
  local_models: { embedder: fs.existsSync(path.join(APP_ROOT, 'resources', 'models', 'Xenova', 'multilingual-e5-small', 'onnx', 'model_quantized.onnx')), reranker: fs.existsSync(path.join(APP_ROOT, 'resources', 'models', 'Xenova', 'ms-marco-MiniLM-L-6-v2', 'onnx', 'model_quantized.onnx')) },
  reference_root: process.env.NATIVELY_E2E_REFERENCE_ROOT ?? null, app_log: APP_LOG,
  os: `${os.type()} ${os.release()} ${os.arch()}`, node: process.version, warmup_requests: Number(opt('warmup', 3)), request_timeout_ms: Number(opt('timeout', 90000)), concurrency: 1, sessions: [],
};
header.sessions.push({ started_at: new Date().toISOString(), resumed: !!opt('resume'), app_log: APP_LOG });
const saveHeader = () => fs.writeFileSync(F.header, JSON.stringify(header, null, 2) + '\n');
saveHeader();

// ---- evidence state ----
/** What this process uploaded: mode key → Map(evidence id → { appId, fileName, contentChars }). Rebuilt from nothing after an app restart. */
const reg = Object.fromEntries(MODE_KEYS.map((k) => [k, new Map()]));
const appFiles = async (modeKey) => ((await c.invoke('__e2e__:index-status', modeIds[modeKey]))?.statuses ?? []);
async function uploadFile(modeKey, id) {
  const f = FILES.get(id);
  if (!f) throw new Error(`unknown evidence file ${id}`);
  const filePath = path.join(EVID, f.path);
  const bin = sha256(fs.readFileSync(filePath));
  if (bin !== f.sha256) throw new Error(`${id}: file on disk does not hash to the frozen manifest`);
  const t0 = Date.now();
  const r = await c.invoke('__e2e__:upload-reference-file-from-path', { modeId: modeIds[modeKey], filePath });
  const rec = { at: new Date().toISOString(), run_id: runId, mode: modeKey, evidence_id: id, filename: f.filename, format: f.format, status: f.status, file_uploaded: !!r?.success, error: r?.success ? null : (r?.error ?? 'unknown'), upload_ms: Date.now() - t0 };
  if (r?.success) {
    const content = String(r.file?.content ?? '');
    const nc = norm(content);
    const needles = (f.facts ?? []).flatMap((x) => (x.doc_needles ?? []).map((n) => ({ fact: x.id, needle: n, survived: nc.includes(norm(n)) })));
    Object.assign(rec, {
      app_file_id: r.file.id, binary_sha_matches: r.file.binarySha256 === f.sha256, content_sha256: r.file.contentSha256 ?? null, extracted_chars: content.length, extracted_chars_trimmed: content.trim().length,
      page_count: r.file.pageCount ?? null, extracted_page_count: r.file.extractedPageCount ?? null, file_parse_success: content.trim().length > 0,
      needles_total: needles.length, needles_survived: needles.filter((n) => n.survived).length, needles_lost: needles.filter((n) => !n.survived).map((n) => `${n.fact}:${n.needle}`),
      facts_total: (f.facts ?? []).length, facts_fully_survived: (f.facts ?? []).filter((x) => (x.doc_needles ?? []).every((n) => nc.includes(norm(n)))).length,
    });
    reg[modeKey].set(id, { appId: r.file.id, fileName: f.filename, contentChars: content.trim().length });
  }
  return rec;
}
async function settleIndex(modeKey, recs) {
  await c.invoke('__e2e__:prewarm-mode', modeIds[modeKey]).catch(() => null);
  let st = [];
  let reindexed = false;
  for (let i = 0; i < 180; i++) {
    st = await appFiles(modeKey);
    const mine = st.filter((s) => recs.some((r) => r.app_file_id === s.fileId));
    if (mine.length === recs.filter((r) => r.app_file_id).length && mine.every((s) => ['ready', 'failed', 'ocr_required'].includes(s.status))) break;
    // A file left lexical-only because the embedder was not ready when it was indexed: the app's own retry.
    if (i === 30 && !reindexed && mine.some((s) => s.status === 'lexical_only')) { reindexed = true; await c.invoke('__e2e__:reindex-embeddings', modeIds[modeKey]).catch(() => null); }
    if (i >= 60 && mine.every((s) => ['ready', 'failed', 'ocr_required', 'lexical_only'].includes(s.status))) break;
    await sleep(500);
  }
  for (const r of recs) { const s = st.find((x) => x.fileId === r.app_file_id); r.index_status = s?.status ?? null; r.chunk_count = s?.chunkCount ?? null; r.file_indexed = ['ready', 'lexical_only'].includes(s?.status); r.reindex_requested = reindexed; }
}
/** After a runner restart the app may still hold files this run uploaded: take them over when name and extracted text match the ingest log. */
const adopted = new Set();
async function adopt(modeKey) {
  if (adopted.has(modeKey)) return; adopted.add(modeKey);
  if (reg[modeKey].size) return;
  const files = (await c.launcher.evaluate(`window.electronAPI.modesGetReferenceFiles(${JSON.stringify(modeIds[modeKey])})`)) ?? [];
  if (!files.length) return;
  const log = readJsonl(F.ingest).filter((r) => r.mode === modeKey && r.file_uploaded);
  for (const f of files) {
    const content = String(f.content ?? '');
    const hit = log.find((r) => r.app_file_id === f.id && r.filename === (f.fileName ?? f.file_name) && r.content_sha256 === sha256(content));
    if (hit && !reg[modeKey].has(hit.evidence_id)) reg[modeKey].set(hit.evidence_id, { appId: f.id, fileName: hit.filename, contentChars: content.trim().length });
  }
}
async function ensureMode(modeKey, configId) {
  const cfg = CONFIGS.get(configId);
  if (!cfg) throw new Error(`unknown evidence_config ${configId}`);
  const want = new Set(cfg.files);
  await adopt(modeKey);
  let current = await appFiles(modeKey);
  // Anything in the app this process did not upload (a restart, an earlier process) is removed: the state must be known.
  const known = new Set([...reg[modeKey].values()].map((r) => r.appId));
  const present = new Set(current.map((s) => s.fileId));
  for (const [id, r] of [...reg[modeKey]]) if (!present.has(r.appId)) reg[modeKey].delete(id);
  for (const s of current) if (!known.has(s.fileId)) await c.launcher.evaluate(`window.electronAPI.modesDeleteReferenceFile(${JSON.stringify(s.fileId)})`);
  for (const [id, r] of [...reg[modeKey]]) if (!want.has(id)) { await c.launcher.evaluate(`window.electronAPI.modesDeleteReferenceFile(${JSON.stringify(r.appId)})`); reg[modeKey].delete(id); }
  const recs = [];
  for (const id of cfg.files) if (!reg[modeKey].has(id)) recs.push(await uploadFile(modeKey, id));
  if (recs.length) {
    await settleIndex(modeKey, recs);
    fs.appendFileSync(F.ingest, recs.map((r) => JSON.stringify({ ...r, config: configId })).join('\n') + '\n');
    const bad = recs.filter((r) => !r.file_uploaded);
    console.log(`  files ${modeKey} → ${configId}: uploaded ${recs.length}${bad.length ? `, FAILED ${bad.map((b) => b.evidence_id).join(',')}` : ''} [${recs.map((r) => r.index_status).join(',')}]`);
  }
}
async function ensureWorld(world) { for (const k of MODE_KEYS) await ensureMode(k, world[k]); }
const worldOf = (item) => ({ ...BASE, [item.mode]: item.evidence_config, ...(item.world_override ?? {}) });

let piCur;
async function ensurePi(state, transition) {
  const docs = (PI_STATES[state] ?? []).map((id) => FILES.get(id));
  const over = transition === 'upload_over';
  // 'user_delete': the profile is removed the way a user removes it (Settings › Profile: delete résumé, delete JD),
  // not through the test hook, so whatever the product leaves behind after a delete is what the next case sees.
  const userDelete = transition === 'user_delete';
  const rec = { at: new Date().toISOString(), run_id: runId, pi_state: state, previous: piCur?.state ?? null, transition: over ? 'upload_over' : userDelete ? 'user_delete' : 'clear_then_upload', ingests: [] };
  const t0 = Date.now();
  if (userDelete) {
    rec.user_delete = await c.launcher.evaluate('(async () => ({ resume: await window.electronAPI.profileDelete(), jd: await window.electronAPI.profileDeleteJD() }))()').catch((e) => ({ error: String(e).slice(0, 200) }));
  } else if (!over) { const clr = await c.invoke('__e2e__:clear-profile'); if (!clr?.success) throw new Error('clear-profile failed: ' + JSON.stringify(clr)); }
  for (const f of docs) {
    const docType = /-JD$/.test(f.id) ? 'jd' : 'resume';
    const filePath = path.join(EVID, f.path);
    if (sha256(fs.readFileSync(filePath)) !== f.sha256) throw new Error(`${f.id}: file on disk does not hash to the frozen manifest`);
    const t1 = Date.now();
    const r = await c.invoke('__e2e__:ingest-profile-doc', { filePath, docType });
    rec.ingests.push({ evidence_id: f.id, docType, format: f.format, success: !!r?.success, error: r?.success ? null : (r?.error ?? 'unknown'), ms: Date.now() - t1 });
  }
  let st = null;
  const wantR = docs.some((f) => /-RESUME$/.test(f.id)), wantJ = docs.some((f) => /-JD$/.test(f.id));
  for (let i = 0; i < 240; i++) {
    st = await c.launcher.evaluate('window.electronAPI.profileGetStatus()').catch(() => null);
    const busy = st?.resume_indexing_in_flight || st?.jd_indexing_in_flight || st?.aot_pipeline_running;
    if (!busy && (!wantR || st?.profileFactsReady) && (!wantJ || st?.jdFactsReady)) break;
    await sleep(1000);
  }
  const state2 = await c.invoke('__e2e__:profile-state').catch(() => null);
  const data = await c.launcher.evaluate('window.electronAPI.profileGetProfile()').catch(() => null);
  const dataText = norm(JSON.stringify(data ?? {}));
  const prof = piProfileOf(state);
  const idn = prof ? identities[prof] ?? {} : {};
  const other = prof ? Object.entries(identities).filter(([k]) => k !== prof) : [];
  Object.assign(rec, {
    ms: Date.now() - t0, profile_loaded: docs.length === 0 ? null : rec.ingests.every((x) => x.success),
    resume_parsed: wantR ? !!state2?.hasStructuredResume : null, jd_parsed: wantJ ? !!state2?.hasStructuredJD : null,
    resume_extraction_mode: state2?.resumeExtractionMode ?? null, state: state2,
    identity_needles_found: wantR ? (idn.resume_needles ?? []).filter((n) => dataText.includes(norm(n))) : [],
    identity_needles_expected: wantR ? idn.resume_needles ?? [] : [],
    jd_needles_found: wantJ ? (idn.jd_needles ?? []).filter((n) => dataText.includes(norm(n))) : [],
    // Left over from the profile that was there before (the product's own state after an overwrite; not a rig fault).
    other_profile_residue: other.flatMap(([k, v]) => [...(v.resume_needles ?? []), ...(v.jd_needles ?? [])].filter((n) => dataText.includes(norm(n))).map((n) => `${k}:${n}`)),
    profile_data: data,
  });
  fs.appendFileSync(F.pi, JSON.stringify(rec) + '\n');
  piCur = { state, wantR, wantJ, rec };
  console.log(`  pi → ${state} (${rec.transition}) r:${rec.resume_parsed} j:${rec.jd_parsed} mode:${rec.resume_extraction_mode} ${rec.ms} ms${rec.other_profile_residue.length ? ` residue:${rec.other_profile_residue.length}` : ''}`);
}

/** Read the state back from the app. Returns the list of things that do not match (empty = verified). */
async function verifyState(item, world) {
  const problems = [];
  const active = (await app.listModes(c)).filter((x) => x.isActive).map((x) => x.id);
  if (active.length !== 1 || active[0] !== modeIds[item.mode]) problems.push(`active_mode:${JSON.stringify(active)}`);
  for (const k of MODE_KEYS) {
    const st = await appFiles(k);
    const got = st.map((s) => s.fileName).sort();
    const want = CONFIGS.get(world[k]).files.map((id) => FILES.get(id).filename).sort();
    const ids = st.map((s) => s.fileId).sort(), mine = [...reg[k].values()].map((r) => r.appId).sort();
    if (JSON.stringify(got) !== JSON.stringify(want) || JSON.stringify(ids) !== JSON.stringify(mine)) problems.push(`files:${k}`);
  }
  const ps = await c.invoke('__e2e__:profile-state').catch(() => null);
  const want = PI_STATES[item.pi_state ?? 'none'] ?? [];
  const wantR = want.some((id) => /-RESUME$/.test(id)), wantJ = want.some((id) => /-JD$/.test(id));
  if (!!ps?.hasStructuredResume !== wantR) problems.push(`pi_resume:${ps?.hasStructuredResume}`);
  if (!!ps?.hasStructuredJD !== wantJ) problems.push(`pi_jd:${ps?.hasStructuredJD}`);
  if (wantR && piCur?.rec && (piCur.rec.identity_needles_expected.length > 0) && piCur.rec.identity_needles_found.length === 0) problems.push('pi_identity');
  if ((item.pi_state ?? 'none') !== (piCur?.state ?? 'none')) problems.push('pi_state_tracking');
  return { problems, profile_state: ps ? { hasStructuredResume: ps.hasStructuredResume, hasStructuredJD: ps.hasStructuredJD, resumeName: ps.resumeName, jdCompany: ps.jdCompany, jdTitle: ps.jdTitle, resumeExtractionMode: ps.resumeExtractionMode } : null };
}

// ---- evidence tags of the prompt ----
function promptEvidence(w) {
  const m = w.main;
  const text = m ? (m.messages || []).map((x) => x.text).join('\n') : '';
  const attr = (tag, k) => new RegExp(`${k}="([^"]*)"`).exec(tag)?.[1] ?? null;
  const tags = [...text.matchAll(/<evidence\s[^>]*>/g)].map((t) => ({ source_type: attr(t[0], 'source_type'), provenance: attr(t[0], 'provenance'), source_name: attr(t[0], 'source_name'), section: attr(t[0], 'section') }));
  const by = {};
  for (const t of tags) { const k = `${t.source_type}|${t.provenance}|${t.source_name}`; (by[k] ??= { ...t, section: undefined, n: 0 }).n++; }
  return Object.values(by);
}

// ---- warm-up (excluded) ----
const WARM = Number(opt('warmup', 3));
if (todo.length && WARM > 0) {
  await app.activateMode(c, modeIds.general);
  for (const [surface, q] of [['hotkey', 'What is a queue?'], ['typed', 'What is a stack?'], ['hotkey', 'What is a hash table?']].slice(0, WARM)) {
    await app.resetSession(c); await app.clearRecorder(c);
    const r = await app.timedAsk(c, { surface, question: q, timeoutMs: 90000 });
    await app.collectWire(c);
    console.log(`warm-up ${surface}: ttft ${r.firstTokenMs?.toFixed?.(0)} ms total ${r.totalMs?.toFixed?.(0)} ms (excluded)`);
  }
}

const uiFormat = (turns) => turns.map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text}`).slice(-20).join('\n');
const spoken = (a) => (a ?? '').replace(/\[\[GIST\]\][\s\S]*$/, '').trim();
let order = existing.length, activeMode = null, unverifiedStreak = 0;
const startedRun = Date.now();

for (const unit of todo) {
  const history = [];
  for (const item of unit) {
    const startedAt = new Date().toISOString();
    const world = worldOf(item);
    const wantPi = item.pi_state ?? 'none';
    let stateErr = null;
    try {
      await ensureWorld(world);
      if (piCur === undefined || piCur.state !== wantPi || item.pi_transition === 'upload_over' || (item.pi_transition === 'user_delete' && piCur.rec?.transition !== 'user_delete')) await ensurePi(wantPi, item.pi_transition ?? null);
      if (activeMode !== item.mode) { await app.activateMode(c, modeIds[item.mode]); activeMode = item.mode; await sleep(300); }
    } catch (e) { stateErr = String(e?.message ?? e).slice(0, 300); }
    const ver = stateErr ? { problems: [`setup:${stateErr}`], profile_state: null } : await verifyState(item, world);
    const corpusChars = [...reg[item.mode].values()].reduce((n, r) => n + r.contentChars, 0);
    const corpusTokens = Math.ceil(corpusChars / 4);
    const base = {
      benchmark_id: item.id, run_id: runId, run_order: ++order, partition: PARTITION, mode: item.mode, surface: item.surface, speaker: item.speaker,
      question: item.question, prior_transcript: item.prior_transcript ?? null, conversation_id: item.conversation_id ?? null, turn_index: item.turn_index ?? 1,
      sequence_id: item.sequence_id ?? null, seq_index: item.seq_index ?? null, no_reset: !!item.no_reset,
      evidence_config: item.evidence_config, world, pi_state: wantPi, pi_condition: item.pi_condition ?? null, pi_transition: item.pi_transition ?? null,
      condition: item.condition, category: item.category ?? null, difficulty: item.difficulty ?? null, cf_family: item.cf_family ?? null, cf_variant: item.cf_variant ?? null, evidence_state: item.evidence_state ?? null, iso_kind: item.iso_kind ?? null,
      state_verified: ver.problems.length === 0, state_problems: ver.problems, profile_state: ver.profile_state, pi_extraction_mode: piCur?.rec?.resume_extraction_mode ?? null,
      pi_other_profile_residue: piCur?.rec?.other_profile_residue ?? [],
      loaded_files: Object.fromEntries(MODE_KEYS.map((k) => [k, [...reg[k].keys()]])), corpus_tokens: corpusTokens, read_whole: corpusTokens > 0 && corpusTokens <= 1400,
      started_at: startedAt,
    };
    if (ver.problems.length) {
      // §101: a case whose state cannot be confirmed is not asked and not scored.
      fs.appendFileSync(F.rows, JSON.stringify({ ...base, success: false, error_type: 'environment_state_unverified', error_message: ver.problems.join('; '), finished_at: new Date().toISOString() }) + '\n');
      console.log(`${item.id.padEnd(18)} UNVERIFIED ${ver.problems.join('; ')}`);
      activeMode = null; piCur = undefined;
      if (++unverifiedStreak >= 3) { console.error(`three cases in a row with unverified state — stopping. resume with: --resume ${runId}`); saveHeader(); process.exit(3); }
      continue;
    }
    unverifiedStreak = 0;
    let priorTurns = null;
    const first = (item.turn_index ?? 1) === 1;
    if (first && !item.no_reset) { await app.resetSession(c); if (item.prior_transcript) await app.injectLines(c, item.prior_transcript); }
    else if (first && item.no_reset) { if (item.prior_transcript) await app.injectLines(c, item.prior_transcript); }
    else if (item.surface === 'hotkey') {
      const last = history.filter((h) => h.role === 'assistant').at(-1);
      priorTurns = history.map((h) => ({ role: h.role === 'assistant' ? 'user_spoken_answer' : 'other_party', text: h.role === 'assistant' ? spoken(h.text) : h.text }));
      if (spoken(last?.text)) await app.injectLines(c, [{ speaker: 'user', text: spoken(last.text) }]);
    } else priorTurns = history.map((h) => ({ role: h.role, text: h.role === 'assistant' ? spoken(h.text) : h.text }));
    await app.clearRecorder(c);
    const off = logSize();
    let m;
    try {
      m = await app.timedAsk(c, { surface: item.surface, question: item.question, uiContext: item.surface === 'typed' && !first ? uiFormat(priorTurns.map((t) => ({ role: t.role, text: t.text }))) : '', timeoutMs: Number(opt('timeout', 90000)) });
    } catch (e) {
      console.error(`infrastructure failure on ${item.id}: ${String(e).slice(0, 300)}\nresume with: --resume ${runId}`);
      saveHeader(); fs.writeFileSync(F.systems, JSON.stringify(systems)); process.exit(3);
    }
    if (m.timedOut || m.err) await sleep(10000);
    const w = await app.collectWire(c);
    const wsum = app.summariseWire(w, m.t0Epoch);
    const trace = parseTrace(logSince(off));
    const raw = m.raw ?? '';
    const finalText = m.final ?? null;
    const shown = finalText ?? raw;
    const usage = wsum?.response?.usage ?? null;
    const chat = w.records.filter((r) => r.messages?.length);
    const timeout = !!m.timedOut, errText = m.err ? String(m.err).slice(0, 500) : null, empty = !shown.trim();
    const success = !timeout && !empty && !errText;
    const host = wsum?.host ?? null;
    const row = {
      ...base,
      // §84 generator provenance, per row, read from the request that actually went out.
      generator_provider: host ? (/deepseek\.com$/.test(host) ? 'deepseek-direct' : /agentrouter/.test(host) ? 'agentrouter' : host) : null,
      generator_model: wsum?.response?.response_model ?? wsum?.model ?? null, configured_model: wsum?.model ?? null, generator_host: host,
      generator_fallback: true, fallback_reason: header.generator.fallback_reason, generation_params: wsum?.params ?? null,
      prompt_builder: wsum?.note?.promptSource ?? null, note_surface: wsum?.note?.surface ?? null, note_mode: wsum?.note?.mode ?? null, action: wsum?.note?.extra?.turnFacts?.personaAction ?? wsum?.note?.action ?? null,
      v3_trace: trace.available ? (trace.v3[0] ?? null) : null, v3_trace_count: trace.available ? trace.v3.length : null, app_trace_available: trace.available, latency_lines: trace.latency_lines ?? [],
      prompt_evidence: promptEvidence(w), system_prompt_sha: wsum?.system_sha ?? null,
      ttft_ms: m.firstTokenMs == null ? null : +m.firstTokenMs.toFixed(1), total_latency_ms: m.totalMs == null ? null : +m.totalMs.toFixed(1),
      last_token_ms: m.lastTokenMs == null ? null : +m.lastTokenMs.toFixed(1), final_event_ms: m.finalEventMs == null ? null : +m.finalEventMs.toFixed(1),
      request_dispatch_ms: wsum?.dispatch_ms_after_t0 ?? null, finish_reason: wsum?.response?.finish_reason ?? null,
      input_tokens: usage?.prompt_tokens ?? null, output_tokens: usage?.completion_tokens ?? null, cached_input_tokens: usage?.prompt_cache_hit_tokens ?? usage?.prompt_tokens_details?.cached_tokens ?? null,
      llm_request_count: chat.length, second_pass_requests: Math.max(0, chat.length - 1), served_by_llm: chat.length > 0,
      raw_answer: raw, rendered_answer: finalText !== null && finalText !== raw ? finalText : null, answer_differs_raw_vs_rendered: finalText !== null && finalText !== raw,
      heard_question: m.heardQuestion ?? null, prior_turns: priorTurns,
      success, error_type: success ? null : timeout ? 'timeout' : errText ? 'app_error' : 'empty_response', error_message: errText, timeout,
      finished_at: new Date().toISOString(),
    };
    fs.appendFileSync(F.rows, JSON.stringify(row) + '\n');
    if (w.main) systems[w.main.systemSha] = w.main.system;
    fs.appendFileSync(F.wire, JSON.stringify({
      benchmark_id: row.benchmark_id, wire: wsum, system_sha: w.main?.systemSha ?? null, messages: w.main?.messages ?? null,
      other_requests: w.records.filter((r) => r !== w.main && r.messages?.length).map((r) => ({ provider: r.provider, model: r.model, status: r.status, systemSha: r.systemSha, note: r.note?.surface ?? null, messages: r.messages })),
    }) + '\n');
    history.push({ role: item.surface === 'hotkey' ? 'other' : 'user', text: item.question });
    history.push({ role: 'assistant', text: shown });
    const refs = row.prompt_evidence.filter((e) => e.provenance === 'MODE_REFERENCE_FILE').map((e) => e.source_name);
    console.log(`${item.id.padEnd(18)} ${item.surface.padEnd(6)} ${row.success ? 'ok ' : 'ERR'} ttft ${String(row.ttft_ms ?? '-').padStart(7)} total ${String(row.total_latency_ms ?? '-').padStart(8)} ${String(row.v3_trace?.path ?? '-').padEnd(8)} ev ${String(row.v3_trace?.evidence ?? '-').padStart(2)} refs ${refs.length} ${JSON.stringify(shown.slice(0, 60))}`);
    if (order % 25 === 0) fs.writeFileSync(F.systems, JSON.stringify(systems));
  }
}
fs.writeFileSync(F.systems, JSON.stringify(systems));
header.finished_at = new Date().toISOString();
header.sessions.at(-1).finished_at = header.finished_at;
saveHeader();
c.close();
console.log(`\ndone in ${((Date.now() - startedRun) / 60000).toFixed(1)} min → ${runDir}`);
process.exit(0);
