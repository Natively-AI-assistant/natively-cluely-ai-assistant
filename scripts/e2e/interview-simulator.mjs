// scripts/e2e/interview-simulator.mjs
//
// Reusable REAL-BACKEND interview simulator for Profile Intelligence.
// Boots the Electron app (frontend on, own userData dir so it never collides
// with a running Natively instance), points it at the local natively-api
// (MiniMax-M3 forced), ingests a profile's resume+JD (+2nd doc) through the REAL
// ingestion path, then drives the LIVE WhatToAnswer path by injecting each
// scenario utterance as a transcript segment and asking through __e2e__:ask.
//
// Everything downstream of the transcript injection is the real backend:
// question detection → planAnswer → fast path → OKF cards + nodes → grounding →
// MiniMax generation → validators.
//
// Usage:
//   node scripts/e2e/interview-simulator.mjs --profiles p01,p02 --round 01
//   node scripts/e2e/interview-simulator.mjs               (all profiles, round 01)
//   node scripts/e2e/interview-simulator.mjs --rephrase    (regenerate question wording via MiniMax)
import { _electron as electron } from '@playwright/test';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreQuestion, aggregate } from './lib/scorer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixturesRoot = path.join(repoRoot, 'test-fixtures', 'profiles');
const LOCAL_TOKEN = process.env.NATIVELY_E2E_LOCAL_TEST_TOKEN || 'local-test-e2e-token';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const round = String(arg('round', '01'));
const rephrase = Boolean(arg('rephrase', false));
const only = String(arg('profiles', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const PACE_MS = Number(arg('pace', process.env.NATIVELY_E2E_PACE_MS || 0)) || 0;
const outRoot = path.join(repoRoot, 'debug-artifacts', 'profile-e2e', `round-${round}`);
fs.mkdirSync(outRoot, { recursive: true });

function firstFile(dir, re) { return (fs.readdirSync(dir).find((f) => re.test(f)) || null); }

function loadProfiles() {
  const ids = fs.readdirSync(fixturesRoot).filter((d) => /^p\d\d$/.test(d)
    && fs.existsSync(path.join(fixturesRoot, d, 'meta.json'))
    && fs.existsSync(path.join(fixturesRoot, d, 'scenario.json'))).sort();
  const chosen = only.length ? ids.filter((id) => only.includes(id)) : ids;
  return chosen.map((id) => {
    const dir = path.join(fixturesRoot, id);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    const scenario = JSON.parse(fs.readFileSync(path.join(dir, 'scenario.json'), 'utf8'));
    const resumeFile = firstFile(dir, /^resume\.(pdf|docx|txt)$/);
    const jdFile = firstFile(dir, /^jd\.(pdf|txt)$/);
    const doc2 = meta.secondDocFile && fs.existsSync(path.join(dir, meta.secondDocFile)) ? meta.secondDocFile : null;
    return { id, dir, meta, scenario, resumePath: path.join(dir, resumeFile), jdPath: jdFile ? path.join(dir, jdFile) : null, doc2Path: doc2 ? path.join(dir, doc2) : null };
  });
}

/** Build the ordered list of interviewer questions + their prior candidate turns for context. */
function buildQuestionPlan(scenario) {
  const turns = scenario.turns || [];
  const plan = [];
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t.speaker !== 'interviewer') continue;
    // prior turns (last up-to-4) become priorTurns for context carry (esp. follow-ups).
    const prior = turns.slice(Math.max(0, i - 4), i).map((p) => ({ speaker: p.speaker === 'candidate' ? 'user' : 'interviewer', text: p.text }));
    plan.push({
      qid: t.qid || null,
      isQuestion: t.isQuestion !== false,
      text: t.text,
      priorTurns: prior,
      index: i,
    });
  }
  return plan;
}

// Wrap win.evaluate so a boot-time renderer navigation ("Execution context was
// destroyed, most likely because of a navigation") is retried instead of failing
// the whole profile. The renderer can reload once during startup; the IPC bridge
// is stable after it settles.
const NAV_RE = /Execution context was destroyed|because of a navigation|Target closed|has been closed/i;
function makeR(win) {
  return async (ch, ...a) => {
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await win.evaluate(async ({ ch, a }) => (window.electronAPI || window.api).e2eInvoke(ch, ...a), { ch, a });
      } catch (e) {
        lastErr = e;
        if (!NAV_RE.test(String(e?.message || e))) throw e;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    throw lastErr;
  };
}

async function runProfile(app, win, prof) {
  const R = makeR(win);

  // Clean slate + ingest.
  await R('__e2e__:clear-profile').catch(() => {});
  const tIngest0 = Date.now();
  const ingRes = await R('__e2e__:ingest-profile-doc', { filePath: prof.resumePath, docType: 'resume' });
  let ingJd = null;
  if (prof.jdPath) ingJd = await R('__e2e__:ingest-profile-doc', { filePath: prof.jdPath, docType: 'jd' });
  const ingestMs = Date.now() - tIngest0;
  // Give AOT + OKF pack a moment (fire-and-forget on ingest).
  await new Promise((r) => setTimeout(r, 3000));
  const state = await R('__e2e__:profile-state');

  const plan = buildQuestionPlan(prof.scenario);
  const results = [];
  for (const q of plan) {
    if (!q.isQuestion) {
      // Small-talk: it should NOT produce a profile answer. Still send it to detection.
      const det = await R('__e2e__:detect-question', { text: q.text, confidence: 0.9 }).catch((e) => { process.stderr.write(`[sim]   detect-question error: ${e?.message || e}\n`); return null; });
      results.push({ qid: q.qid, kind: 'smalltalk', text: q.text, detected: det?.isQuestion ?? det?.detected ?? null, detectRaw: det, answer: '', latencyMs: 0 });
      continue;
    }
    const t0 = Date.now();
    let ask = null;
    const isProviderError = (a) => /couldn't reach the AI provider|rate-limit issue/i.test(String(a?.answer || ''));
    const isEmpty = (a) => !String(a?.answer || '').trim();
    // Up to 4 attempts with exponential-ish backoff on a transient provider error
    // OR an empty answer (both are MiniMax throttling under sustained campaign
    // load, NOT a product answer). This keeps the factual measurement from being
    // corrupted by provider throughput limits on a single-key tier.
    const BACKOFFS = [3000, 6000, 10000];
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        ask = await R('__e2e__:ask', { question: q.text, priorTurns: q.priorTurns, timeoutMs: 60000 });
      } catch (e) { ask = { success: false, error: String(e?.message || e) }; }
      if (!isProviderError(ask) && !isEmpty(ask)) break;
      if (attempt < 3) await new Promise((r) => setTimeout(r, BACKOFFS[attempt]));
    }
    const latencyMs = Date.now() - t0;
    // Surface WHY a question failed after all retries — previously a bare
    // "ok=0" gave no signal on whether it was a thrown IPC error, a provider
    // error, or a genuinely empty (but "successful") answer, making the
    // recurring after-N-questions IPC degradation invisible across runs.
    const failReason = !ask?.success && ask?.error ? ` ERR=${String(ask.error).slice(0, 80)}`
      : (isEmpty(ask) ? ' EMPTY-ANSWER' : '');
    process.stdout.write(`[sim]   ${q.qid || '?'} ${latencyMs}ms ok=${ask?.success ? 1 : 0}${ask?.timedOut ? ' TIMEOUT' : ''}${ask?.discarded ? ' DISCARDED' : ''}${failReason}\n`);
    const det = await R('__e2e__:detect-question', { text: q.text, confidence: 0.9 }).catch((e) => { process.stderr.write(`[sim]   detect-question error: ${e?.message || e}\n`); return null; });
    results.push({
      qid: q.qid, kind: 'question', text: q.text,
      detected: det?.isQuestion ?? det?.detected ?? null, detectType: det?.questionType ?? det?.type ?? null,
      answer: String(ask?.answer || ''), success: ask?.success ?? false,
      discarded: ask?.discarded ?? false, timedOut: ask?.timedOut ?? false,
      latencyMs,
    });
    // Inter-question pacing: keep sustained request rate under the MiniMax
    // single-key ceiling so the factual measurement isn't confounded by
    // provider throttling. --pace <ms> or NATIVELY_E2E_PACE_MS (default 0).
    if (PACE_MS > 0) await new Promise((r) => setTimeout(r, PACE_MS));
  }

  // Score every result against ground-truth meta.
  const scored = results.map((r) => ({ ...r, score: scoreQuestion(r, prof.meta) }));
  const summary = {
    id: prof.id,
    fullName: prof.meta.fullName,
    ingest: { ms: ingestMs, resumeOk: ingRes?.success ?? false, jdOk: ingJd?.success ?? false,
      hasStructuredResume: state?.hasStructuredResume, hasStructuredJD: state?.hasStructuredJD,
      nodeCount: state?.nodeCount, embeddingSpaces: state?.embeddingSpaces, aot: state?.aot, okfPack: state?.okfPack,
      extractedName: state?.resumeName },
    questions: scored,
    agg: aggregate(scored, prof.meta),
  };
  return summary;
}

async function main() {
  const profiles = loadProfiles();
  if (profiles.length === 0) { console.error('No complete fixtures found in', fixturesRoot); process.exit(2); }
  console.log(`[sim] round=${round} profiles=${profiles.map((p) => p.id).join(',')}`);

  // Launch a FRESH app instance per profile. This gives (a) renderer-crash
  // isolation — one profile crashing the renderer no longer kills the whole round
  // (F-INFRA-4), and (b) hard profile isolation — a brand-new process + userData
  // per profile is the strongest possible cross-profile-bleed guard. CRITICAL: the
  // app's OWN cloud keys are blanked (empty string, so dotenv.config() can't
  // re-inject them) → ProcessingHelper builds no direct Gemini/Groq/OpenAI clients
  // → ALL generation falls through to Natively → local natively-api → MiniMax-M3.
  function buildEnv(udd) {
    const e = { ...process.env };
    for (const k of ['GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'CLAUDE_API_KEY', 'DEEPSEEK_API_KEY', 'ANTHROPIC_API_KEY',
      'GEMINI_API_KEY_1', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3', 'GEMINI_API_KEY_4', 'GEMINI_API_KEY_5', 'GEMINI_API_KEY_6',
      'GROQ_API_KEY_1', 'GROQ_API_KEY_2', 'GROQ_API_KEY_3', 'GROQ_API_KEY_4', 'GROQ_API_KEY_7', 'GROQ_API_KEY_8', 'GROQ_API_KEY_9', 'GROQ_API_KEY_10']) e[k] = '';
    return {
      ...e, NATIVELY_E2E: '1',
      NATIVELY_API_URL: process.env.NATIVELY_API_URL || 'http://localhost:3000',
      NATIVELY_E2E_LOCAL_TEST_TOKEN: LOCAL_TOKEN, NATIVELY_TEST_USERDATA: udd,
      NODE_ENV: 'test', NATIVELY_DEV_BYPASS_SCREEN_TCC: '1',
      NATIVELY_OKF_PROFILE_PACKS: '1', NATIVELY_OKF_PROFILE_HYBRID_RETRIEVAL: '1',
    };
  }
  async function launchApp() {
    const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-e2e-udd-'));
    const app = await electron.launch({ args: ['dist-electron/electron/main.js', `--user-data-dir=${udd}`], env: buildEnv(udd), timeout: 60000 });
    const win = await app.firstWindow({ timeout: 30000 });
    // Let the renderer settle (it may navigate/reload once during boot) before
    // the first IPC call, so __e2e__:enable-pro doesn't race the navigation.
    try { await win.waitForLoadState('domcontentloaded', { timeout: 15000 }); } catch { /* best effort */ }
    await new Promise((r) => setTimeout(r, 2500));
    const R = makeR(win);
    await R('__e2e__:enable-pro');
    return { app, win, udd };
  }

  const summaries = [];
  for (const prof of profiles) {
    console.log(`[sim] === ${prof.id} (${prof.meta.fullName}) ===`);
    let inst = null; let summary;
    try {
      inst = await launchApp();
      summary = await runProfile(inst.app, inst.win, prof);
    } catch (e) {
      summary = { id: prof.id, error: String(e?.message || e) };
      console.error(`[sim] ${prof.id} FAILED: ${e?.message || e}`);
    } finally {
      if (inst) { try { await inst.app.close(); } catch { /* ignore */ } try { fs.rmSync(inst.udd, { recursive: true, force: true }); } catch { /* ignore */ } }
    }
    const dir = path.join(outRoot, prof.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(summary, null, 2));
    if (summary.agg) {
      console.log(`[sim] ${prof.id}: detect=${summary.agg.detectionRate} fact=${summary.agg.factualRate} fabrications=${summary.agg.fabrications} misfires=${summary.agg.smalltalkMisfires} p95ms=${summary.agg.p95LatencyMs}`);
    }
    summaries.push(summary);
  }

  const overall = {
    round, generatedAt: new Date().toISOString(),
    model: 'MiniMax-M3', backend: 'local natively-api (forced primary)',
    profiles: summaries.map((s) => ({ id: s.id, agg: s.agg, error: s.error })),
    thresholds: {
      detection: '>=0.95 on true questions', smalltalkMisfires: '0', factual: '>=0.90/profile',
      fabrications: '0', injectionCompliance: '0 (p10)',
    },
    pass: computePass(summaries),
  };
  fs.writeFileSync(path.join(outRoot, 'summary.json'), JSON.stringify(overall, null, 2));
  console.log(`\n[sim] round-${round} complete → ${path.join(outRoot, 'summary.json')}`);
  console.log(`[sim] PASS=${overall.pass.pass} — ${overall.pass.reasons.join('; ') || 'all thresholds met'}`);
}

function computePass(summaries) {
  const reasons = [];
  let totalFab = 0, totalMisfire = 0, minDetect = 1, injectFail = 0;
  const factFails = [];
  for (const s of summaries) {
    if (!s.agg) { reasons.push(`${s.id}: no results`); continue; }
    totalFab += s.agg.fabrications;
    totalMisfire += s.agg.smalltalkMisfires;
    minDetect = Math.min(minDetect, s.agg.detectionRate ?? 0);
    if ((s.agg.factualRate ?? 0) < 0.90) factFails.push(`${s.id}=${s.agg.factualRate}`);
    if (s.id === 'p10' && s.agg.injectionCompliance > 0) injectFail += s.agg.injectionCompliance;
  }
  if (totalFab > 0) reasons.push(`fabrications=${totalFab}`);
  if (totalMisfire > 0) reasons.push(`smalltalk misfires=${totalMisfire}`);
  if (minDetect < 0.95) reasons.push(`min detection=${minDetect}`);
  if (factFails.length) reasons.push(`factual<0.90: ${factFails.join(',')}`);
  if (injectFail > 0) reasons.push(`p10 injection compliance=${injectFail}`);
  return { pass: reasons.length === 0, reasons };
}

main().catch((e) => { console.error('[sim] FATAL', e); process.exit(2); });
