#!/usr/bin/env node
// LIVE tier of the retrieval-scale campaign: the REAL app, REAL providers,
// REAL answers — graded against the fixtures' gold facts.
//
//   node experiments/retrieval-scale/live.mjs --sizes 15k,70k [--kind reference] [--plain] [--per 20] [--label natively]
//
// BILLED: every turn is a real LLM call (plus query embed / rerank) on whatever
// providers the copied profile has configured. Owner-approved 2026-09-19,
// bounded to ~150 turns across the campaign.
//
// Safety, in order of what it protects:
//   • the user's PROFILE is never opened: an isolated --user-data-dir is built
//     from copies (credentials, licence, settings) and a READ-ONLY sqlite
//     `.backup` of natively.db — a plain file copy of a db the running app is
//     writing can be inconsistent;
//   • the user's DEBUG LOG: an isolated instance still writes
//     ~/Documents/natively_debug.log. It is copied first, the run uses
//     NATIVELY_KEEP_PREVIOUS_LOG=1 (the live log is renamed to .prev, the
//     user's running app keeps its inode), and it is renamed back afterwards;
//   • the user's RUNNING APP: different userData (no single-instance clash),
//     different debug ports, and only the PID spawned here is ever killed.
// Plain spawn + raw CDP on purpose: a Playwright-launched Electron breaks
// safeStorage, and a Playwright attach once wedged the renderers.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes(`--${k}`);
const SIZES = arg('sizes', '15k').split(',');
const KIND = arg('kind', 'reference');
const PER = Number(arg('per', 20));
const LABEL = arg('label', 'configured');
const PLAIN = has('plain');
// --stack local: patch the COPIED settings to the bundled embedder + reranker (never the real profile).
const STACK = arg('stack', 'configured');
// --env K=V[,K=V]: extra environment for the spawned app (e.g. NATIVELY_KEYLESS_LEXICAL_MANUAL_RETRIEVAL=0).
const EXTRA_ENV = Object.fromEntries((arg('env', '') || '').split(',').filter(Boolean).map((kv) => kv.split('=')));
// --mix para: paraphrase-heavy selection — the questions a vector arm exists for.
const MIX = arg('mix', 'default');
// --local-api PORT: point the app at a LOCALLY RUN natively-api under NATIVELY_LOCAL_TEST_AUTH
// (no production database, no billing). The token is read from <work>/local-test-token, never printed.
const LOCAL_API_PORT = arg('local-api', '');
// --profile: PROFILE INTELLIGENCE path — real résumé + JD ingest (structuring LLM, chunk, embed), a
// looking-for-work mode with NO files attached, then graded questions about both documents.
const PROFILE = has('profile');
// --structuring: ingest the REALISTIC résumés (gen-resume.mjs) and compare what the structuring LLM
// kept with the exact ground truth. No questions are asked; cost = the ingest's own LLM calls.
const STRUCTURING = has('structuring');
// --natively-key-from-env NAME: read NAME from natively-api/.env and set it as the natively API key
// INSIDE THE ISOLATED INSTANCE ONLY. The value is never printed and never written to the results.
const KEY_ENV_NAME = arg('natively-key-from-env', '');
function readDotEnvKey(name) {
  const line = fs.readFileSync(path.join(ROOT, 'natively-api/.env'), 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, '') : '';
}
const PORT = Number(arg('port', 9366));
const WORK = arg('work', path.join(os.tmpdir(), 'natively-retrieval-scale-live'));
const UD = path.join(WORK, 'userData');
const REAL_UD = path.join(os.homedir(), 'Library/Application Support/natively');
const LOG = path.join(os.homedir(), 'Documents/natively_debug.log');
const OUT = arg('out', path.join(HERE, 'out', `live_${LABEL}_${STRUCTURING ? 'structuring' : PROFILE ? 'profile' : KIND}${PLAIN ? '_plain' : ''}.json`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

if (process.platform !== 'darwin') { console.error('live.mjs: profile paths here are macOS-only; pass nothing and port this block before running on Windows.'); process.exit(2); }
if (!fs.existsSync(path.join(ROOT, 'dist-electron/electron/main.js')) || !fs.existsSync(path.join(ROOT, 'dist/index.html'))) { console.error('build missing: need dist-electron/electron/main.js and dist/index.html'); process.exit(2); }

// ── API readiness gate (natively leg only) ───────────────────────────────────
if (KEY_ENV_NAME && !has('skip-ready-check')) {
  const ready = await fetch('https://api.natively.software/ready', { signal: AbortSignal.timeout(15000) }).then((r) => r.json()).catch((e) => ({ ready: false, error: e.message }));
  if (!ready.ready) { console.error(`natively API is not ready (${JSON.stringify(ready).slice(0, 160)}) — not spending live turns on it. Re-run later, or pass --skip-ready-check.`); process.exit(3); }
}

// ── isolated profile ─────────────────────────────────────────────────────────
fs.mkdirSync(WORK, { recursive: true });
fs.rmSync(UD, { recursive: true, force: true });
fs.mkdirSync(UD, { recursive: true });
for (const f of ['credentials.enc', 'credentials.provenance.json', 'license.enc', 'settings.json', 'Preferences', 'Local State']) {
  const src = path.join(REAL_UD, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(UD, f));
}
if (STACK === 'local') {
  const sp = path.join(UD, 'settings.json');
  const st = JSON.parse(fs.readFileSync(sp, 'utf8'));
  st.embedding = { mode: 'manual', provider: 'local' };
  st.reranker = { ...(st.reranker ?? {}), provider: 'local', fallbackToLocal: false };
  fs.writeFileSync(sp, JSON.stringify(st, null, 2));
}
execFileSync('sqlite3', [`file:${path.join(REAL_UD, 'natively.db')}?mode=ro`, `.backup '${path.join(UD, 'natively.db')}'`]);
say(`isolated profile at ${UD} (db ${Math.round(fs.statSync(path.join(UD, 'natively.db')).size / 1e6)} MB, read-only backup)`);

// ── debug-log protection ─────────────────────────────────────────────────────
const logBackup = path.join(WORK, `natively_debug.user-copy.${Date.now()}.log`);
if (fs.existsSync(LOG)) fs.copyFileSync(LOG, logBackup);
// The rotation overwrites an existing .prev (a prior crash's evidence) — keep a copy of that too.
const hadPrev = fs.existsSync(`${LOG}.prev`);
const prevBackup = path.join(WORK, `natively_debug.prev.user-copy.${Date.now()}.log`);
// copyFileSync does not carry the timestamps; remember them so the restored .prev keeps its date.
const prevTimes = hadPrev ? fs.statSync(`${LOG}.prev`) : null;
if (hadPrev) fs.copyFileSync(`${LOG}.prev`, prevBackup);
const restoreLog = () => {
  try {
    const prev = `${LOG}.prev`;
    if (fs.existsSync(prev)) {
      if (fs.existsSync(LOG)) fs.renameSync(LOG, path.join(WORK, `natively_debug.live-run.${Date.now()}.log`));
      fs.renameSync(prev, LOG);
      say('debug log restored (the running app kept its inode)');
      // …and the .prev the rotation replaced goes back where it was.
      if (hadPrev) { fs.copyFileSync(prevBackup, prev); fs.utimesSync(prev, prevTimes.atime, prevTimes.mtime); }
    }
  } catch (e) { say(`!! could not restore the debug log: ${e.message} — your copy is at ${logBackup}`); }
};

// ── spawn ────────────────────────────────────────────────────────────────────
const child = spawn(path.join(ROOT, 'node_modules/.bin/electron'), [ROOT, `--user-data-dir=${UD}`, `--remote-debugging-port=${PORT}`], {
  cwd: ROOT, stdio: ['ignore', fs.openSync(path.join(WORK, 'app.stdout.log'), 'w'), fs.openSync(path.join(WORK, 'app.stderr.log'), 'w')],
  env: { ...process.env, NODE_ENV: 'production', NATIVELY_E2E: '1', NATIVELY_E2E_REFERENCE_ROOT: '/', NATIVELY_KEEP_PREVIOUS_LOG: '1', NATIVELY_H4_STAGE_TRACE: '1', ...(LOCAL_API_PORT ? { NATIVELY_API_URL: `http://127.0.0.1:${LOCAL_API_PORT}`, NATIVELY_E2E_LOCAL_TEST_TOKEN: fs.readFileSync(path.join(WORK, 'local-test-token'), 'utf8').trim() } : {}), ...EXTRA_ENV },
});
let cleaned = false;
const cleanup = () => { if (cleaned) return; cleaned = true; try { child.kill('SIGTERM'); } catch {} setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 4000).unref(); };
process.on('SIGINT', () => { cleanup(); setTimeout(() => { restoreLog(); process.exit(130); }, 4500); });
say(`spawned app pid ${child.pid}, CDP :${PORT}`);

// ── raw CDP ──────────────────────────────────────────────────────────────────
async function pageTarget() {
  for (let i = 0; i < 90; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const pages = list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      for (const t of pages) {
        const ok = await evalOn(t.webSocketDebuggerUrl, 'typeof window.electronAPI?.e2eInvoke === "function"').catch(() => false);
        if (ok === true) return t.webSocketDebuggerUrl;
      }
    } catch { /* not up yet */ }
    await sleep(1000);
  }
  throw new Error('no page exposing electronAPI.e2eInvoke within 90s (see app.stderr.log)');
}
function evalOn(wsUrl, expression, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('cdp timeout')); }, timeoutMs);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id !== 1) return;
      clearTimeout(timer); ws.close();
      if (msg.result?.exceptionDetails) reject(new Error(msg.result.exceptionDetails.exception?.description ?? 'evaluate threw'));
      else resolve(msg.result?.result?.value);
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('cdp socket error')); };
  });
}

// ── grading ──────────────────────────────────────────────────────────────────
// Widened 2026-09-19 after reading real answers: "could not be retrieved from the selected material",
// "do not state", "does not contain", "was not …" were graded WRONG when they are refusals.
const REFUSAL_RE = /could(?: not|n't) (?:be )?(?:find|found|retrieved|located)|(?:was|were|is|are) not (?:retrieved|found|stated|specified|listed|included|available|mentioned)|not (?:directly )?mentioned|do(?:es)?(?: not|n't) (?:mention|specify|include|contain|state|provide|list|cover)|no (?:information|mention|details?|specific) (?:about|on|of|regarding|\w+ (?:quota|limit|value|figure))|not (?:in|covered (?:in|by)|provided in|available in|found in) the (?:uploaded|attached|provided|retrieved|reference|selected)|don't have (?:that|the|enough|any)|isn't (?:in|mentioned|specified)|could you (?:repeat|rephrase|clarify)|not enough context|not found in (?:the )?reference/i;
function grade(q, answer) {
  if (!answer) return 'EMPTY';
  if (q.variant === 'absent') return REFUSAL_RE.test(answer) ? 'ABSENT_OK' : 'ABSENT_ANSWERED';
  const hit = q.gold.every((g) => new RegExp(g, 'i').test(answer));
  if (hit) return 'OK';
  return REFUSAL_RE.test(answer) ? 'FALSE_REFUSAL' : 'WRONG';
}

// ── run ──────────────────────────────────────────────────────────────────────
const all = JSON.parse(fs.readFileSync(path.join(HERE, 'out/questions.json'), 'utf8'));
const pick = (size) => {
  const qs = all.filter((q) => q.kind === KIND && q.size === size);
  const planted = (v) => qs.filter((q) => q.variant === v && q.type !== 'sibling');
  if (MIX === 'para') return [...planted('para'), ...planted('lex').slice(0, 5), ...qs.filter((q) => q.type === 'sibling' && q.variant === 'para').slice(0, 5)].slice(0, PER);
  const chosen = [...planted('lex'), ...qs.filter((q) => q.type === 'sibling' && q.variant === 'lex').slice(0, 5), ...planted('para').slice(0, 3), ...qs.filter((q) => q.variant === 'absent')];
  return chosen.slice(0, PER);
};
const rows = [];
try {
  const ws = await pageTarget();
  const invoke = (channel, ...args) => evalOn(ws, `window.electronAPI.e2eInvoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)})`, 180000);
  say('app is up; e2e bridge reachable');
  const pro = await invoke('__e2e__:enable-pro').catch((e) => ({ error: e.message }));
  say('enable-pro →', JSON.stringify(pro).slice(0, 120));
  if (KEY_ENV_NAME) {
    const key = readDotEnvKey(KEY_ENV_NAME);
    if (!key) throw new Error(`${KEY_ENV_NAME} not found in natively-api/.env`);
    const set = await evalOn(ws, `window.electronAPI.setNativelyApiKey(${JSON.stringify(key)})`, 60000);
    say(`natively key set from ${KEY_ENV_NAME} (${key.length} chars, value not shown) →`, JSON.stringify(set).slice(0, 80));
    await sleep(8000); // let the embedding pipeline re-resolve its provider
  }

  if (STRUCTURING) {
    const truth = JSON.parse(fs.readFileSync(path.join(HERE, 'out/realistic_truth.json'), 'utf8'));
    // Surname match: the extractor may normalise or trim the name it returns.
    const sameName = (got, want) => typeof got === 'string' && got.toLowerCase().includes(String(want).split(' ').pop().toLowerCase());
    for (const size of SIZES) {
      const t = truth[size]; if (!t) { say(`no realistic résumé for ${size}`); continue; }
      await invoke('__e2e__:clear-profile').catch(() => null);
      const fp = path.join(HERE, 'out', `realistic_resume_${size}.txt`);
      const t0 = Date.now();
      // Fire and do NOT wait for the whole ingest: structured data is saved before the (slow,
      // per-role) STAR generation. Poll the state until THIS résumé's name appears.
      evalOn(ws, `window.electronAPI.e2eInvoke('__e2e__:ingest-profile-doc', ${JSON.stringify({ filePath: fp, docType: 'resume' })})`, 1800000).catch(() => null);
      let st = null;
      for (let i = 0; i < 180; i++) { await sleep(5000); st = await invoke('__e2e__:profile-state').catch(() => null); if (sameName(st?.resumeName, t.name)) break; }
      const got = sameName(st?.resumeName, t.name);
      const row = { size, truth: t, structuredAfterS: Math.round((Date.now() - t0) / 1000), reached: got, mode: st?.resumeExtractionMode ?? null,
        experience: st?.resumeExperienceCount ?? null, bullets: st?.resumeBulletCount ?? null, projects: st?.resumeProjectCount ?? null, skills: st?.resumeSkillCount ?? null, education: st?.resumeEducationCount ?? null, certifications: st?.resumeCertificationCount ?? null };
      rows.push(row);
      const pct = (a, b) => (a == null ? ' n/a' : `${String(a).padStart(3)}/${String(b).padEnd(3)} ${String(Math.round((100 * a) / b)).padStart(3)}%`);
      say(`[${size}] ${got ? 'structured' : 'NOT STRUCTURED'} after ${row.structuredAfterS}s mode=${row.mode}  roles ${pct(row.experience, t.experience)}  bullets ${pct(row.bullets, t.bullets)}  projects ${pct(row.projects, t.projects)}  skills ${pct(row.skills, t.skills)}  edu ${pct(row.education, t.education)}  certs ${pct(row.certifications, t.certifications)}`);
      fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
      // let the ingest chain (STAR generation) finish before the next résumé is queued behind it
      for (let i = 0; i < 240; i++) { const s2 = await invoke('__e2e__:profile-state').catch(() => null); if ((s2?.nodeCount ?? 0) > 0) break; await sleep(5000); }
    }
  } else if (PROFILE) {
    const size = SIZES[0];
    const cleared = await invoke('__e2e__:clear-profile').catch((e) => ({ error: e.message }));
    say('isolated copy: profile cleared →', JSON.stringify(cleared).slice(0, 100));
    const ingest = {};
    for (const kind of ['resume', 'jd']) {
      const md = fs.readFileSync(path.join(HERE, 'out', `${kind}_${size}.md`), 'utf8');
      const text = PLAIN ? md.replace(/^#+\s*/gm, '').replace(/\*\*/g, '').replace(/^```$/gm, '') : md;
      const fp = path.join(WORK, `${kind}_${size}.${PLAIN ? 'txt' : 'md'}`);
      fs.writeFileSync(fp, text);
      const t0 = Date.now();
      const r = await evalOn(ws, `window.electronAPI.e2eInvoke('__e2e__:ingest-profile-doc', ${JSON.stringify({ filePath: fp, docType: kind })})`, 600000).catch((e) => ({ success: false, error: e.message }));
      ingest[kind] = { ms: Date.now() - t0, success: r?.success === true, error: r?.error ?? null, chars: text.length, structured: kind === 'resume' ? r?.hasStructuredResume : r?.hasStructuredJD };
      say(`[${size}] ingest ${kind}: ${JSON.stringify(ingest[kind])}`);
    }
    const state = await invoke('__e2e__:profile-state').catch((e) => ({ error: e.message }));
    say('profile state →', JSON.stringify(state).slice(0, 420));
    const created = await invoke('modes:create', { name: `RS profile ${size} ${Date.now() % 100000}`, templateType: 'looking-for-work' });
    if (!created?.success) throw new Error(`modes:create failed: ${JSON.stringify(created)}`);
    await invoke('modes:set-active', created.mode.id);
    const qs = all.filter((q) => (q.kind === 'resume' || q.kind === 'jd') && q.size === size);
    const chosen = ['resume', 'jd'].flatMap((k) => {
      const of = (f) => qs.filter((q) => q.kind === k && f(q));
      return [...of((q) => q.type !== 'sibling' && q.variant === 'lex').slice(0, 4), ...of((q) => q.type !== 'sibling' && q.variant === 'para').slice(0, 4), ...of((q) => q.type === 'sibling' && q.variant === 'lex').slice(0, 4)];
    }).slice(0, PER);
    for (const q of chosen) {
      await invoke('__e2e__:reset-session').catch(() => null);
      const t0 = Date.now();
      const r = await invoke('__e2e__:manual-ask', { question: q.question, timeoutMs: 60000 }).catch((e) => ({ success: false, error: e.message }));
      const answer = (r?.answer ?? r?.streamedTokens ?? '').trim();
      const verdict = r?.success === false && !answer ? (r?.timedOut ? 'TIMEOUT' : 'ERROR') : grade(q, answer);
      rows.push({ id: q.id, kind: q.kind, size, variant: q.variant, type: q.type, question: q.question, gold: q.gold, verdict, ms: Date.now() - t0, error: r?.error ?? null, answer: answer.slice(0, 600), ingest, state: rows.length === 0 ? state : undefined });
      say(`[${size} ${q.kind.padEnd(6)}] ${verdict.padEnd(15)} ${String(Date.now() - t0).padStart(6)}ms  ${q.question.slice(0, 66)}`);
      fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
    }
  } else for (const size of SIZES) {
    const md = fs.readFileSync(path.join(HERE, 'out', `${KIND}_${size}.md`), 'utf8');
    const content = PLAIN ? md.replace(/^#+\s*/gm, '').replace(/\*\*/g, '').replace(/^```$/gm, '') : md;
    const created = await invoke('modes:create', { name: `RS ${KIND} ${size}${PLAIN ? ' plain' : ''} ${Date.now() % 100000}`, templateType: 'general' });
    if (!created?.success) throw new Error(`modes:create failed: ${JSON.stringify(created)}`);
    const modeId = created.mode.id;
    const added = await invoke('__e2e__:add-reference-file', { modeId, fileName: `${KIND}_${size}.${PLAIN ? 'txt' : 'md'}`, content });
    if (!added?.success) throw new Error(`add-reference-file failed: ${JSON.stringify(added)}`);
    await invoke('modes:set-active', modeId);
    await invoke('__e2e__:prewarm-mode', modeId).catch(() => null);
    let status = null;
    for (let i = 0; i < 90; i++) {
      status = (await invoke('__e2e__:index-status', modeId))?.statuses?.[0] ?? null;
      const s = status?.status ?? status;
      if (status && (status.embeddedChunkCount ?? 0) >= (status.chunkCount ?? 1) && (status.chunkCount ?? 0) > 0) break;
      if (s?.status === 'failed' || s === 'failed') break;
      await sleep(2000);
    }
    say(`[${size}] mode ${modeId} indexed:`, JSON.stringify(status));

    for (const q of pick(size)) {
      await invoke('__e2e__:reset-session').catch(() => null);
      const t0 = Date.now();
      const r = await invoke('__e2e__:manual-ask', { question: q.question, timeoutMs: 60000 }).catch((e) => ({ success: false, error: e.message }));
      const answer = (r?.answer ?? r?.streamedTokens ?? '').trim();
      const model = await invoke('__e2e__:last-provider-model').catch(() => null);
      // `child` is the node launcher shim; the app's main process is its child. (The first
      // version sampled the shim and reported a meaningless 34 MB.) Sum main + helpers.
      let rssMb = null;
      try {
        const tree = execFileSync('pgrep', ['-P', String(child.pid)]).toString().trim().split('\n').filter(Boolean);
        const all = [...tree, ...tree.flatMap((pid) => { try { return execFileSync('pgrep', ['-P', pid]).toString().trim().split('\n').filter(Boolean); } catch { return []; } })];
        rssMb = Math.round(all.reduce((sum, pid) => sum + Number(execFileSync('ps', ['-o', 'rss=', '-p', pid]).toString().trim() || 0), 0) / 1024);
      } catch { /* app gone */ }
      const verdict = r?.success === false && !answer ? (r?.timedOut ? 'TIMEOUT' : 'ERROR') : grade(q, answer);
      rows.push({ id: q.id, size, variant: q.variant, type: q.type, question: q.question, gold: q.gold, verdict, ms: Date.now() - t0, model: model?.model ?? null, error: r?.error ?? null, answer: answer.slice(0, 600), index: status, rssMb, alive: child.exitCode === null });
      say(`[${size}] ${verdict.padEnd(15)} ${String(Date.now() - t0).padStart(6)}ms  ${q.question.slice(0, 70)}`);
      fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
    }
  }
} catch (e) {
  say('!! live run aborted:', e.message);
} finally {
  cleanup();
  await sleep(5000);
  restoreLog();
}

const tally = {};
for (const r of STRUCTURING ? [] : rows) { const k = PROFILE ? `${r.size} ${r.kind}` : `${r.size}`; (tally[k] ??= {}); tally[k][r.verdict] = (tally[k][r.verdict] ?? 0) + 1; }
say(`\nlive tier  label=${LABEL} kind=${KIND}${PLAIN ? ' (plain text)' : ''}  turns=${rows.length}`);
for (const [k, v] of Object.entries(tally)) say(`  ${k.padEnd(5)} ${JSON.stringify(v)}`);
say(`-> ${path.relative(ROOT, OUT)}   (app logs: ${WORK})`);
process.exit(0);
