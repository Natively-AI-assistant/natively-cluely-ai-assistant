// scripts/benchmark-sd-requirements-gate.js
//
// Optional real-API smoke for the SD Requirements grilling gate:
// one URL-shortener gated → fill → advance → post_requirements flow.
//
// Gate (exit 0 skip when absent) — never enable on PR:
//   RUN_SD_REQUIREMENTS_GATE_E2E=1  (or RUN_SD_GROUNDING_E2E=1 / RUN_NATIVELY_API_E2E=1)
//   GEMINI_API_KEY=<key>            (preferred)
//   NATIVELY_API_KEY=<key>          (fallback)
//
// Run (weekly / workflow_dispatch — see build-smoke.yml sd-requirements-gate-smoke):
//   npm run build:electron
//   RUN_SD_REQUIREMENTS_GATE_E2E=1 GEMINI_API_KEY=<key> \
//     [BENCHMARK_MODEL=gemini-3.1-flash-lite] \
//     ./node_modules/.bin/electron scripts/benchmark-sd-requirements-gate.js
//
// Does NOT extend benchmark-sd-grounding.js. API keys are never logged.

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

try {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
} catch { /* optional */ }

const { app } = require('electron');

const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');
const {
  shouldRunRealApi,
  resolveGeminiApiKey,
  resolveBenchmarkModel,
  DEFAULT_QUESTION_TIMEOUT_MS,
} = require('./lib/sd-grounding-harness.js');
const Smoke = require('./lib/sd-requirements-gate-smoke.js');

process.env.BENCHMARK_MODEL = resolveBenchmarkModel(process.env);

const GEMINI_KEY = resolveGeminiApiKey(process.env);
const NATIVELY_KEY = (process.env.NATIVELY_API_KEY || '').trim();

if (!shouldRunRealApi(process.env)) {
  console.log(Smoke.skipMessage());
  process.exit(0);
}

process.env.NATIVELY_E2E = process.env.NATIVELY_E2E || '1';

const MODEL = process.env.BENCHMARK_MODEL;
const TIMEOUT_MS = Number(process.env.SD_REQ_GATE_TIMEOUT_MS) || DEFAULT_QUESTION_TIMEOUT_MS;
const scenario = Smoke.URL_SHORTENER_GATED_ADVANCE;

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-sd-req-gate-'));
app.setPath('userData', tmpUserData);

async function collect(gen) {
  let out = '';
  for await (const t of gen) out += t;
  return out;
}

function tryLoadProductGate() {
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    return require(path.join(distRoot, 'llm', 'sdRequirementsGate.js'));
  } catch {
    return null;
  }
}

async function askOnce(llm, systemPrompt, userMessage, signal) {
  return collect(
    llm.streamChat(
      userMessage,
      undefined,
      undefined,
      systemPrompt,
      false,
      false,
      [],
      signal,
      undefined,
      { answerType: 'system_design_answer' },
    ),
  );
}

async function askWithTimeout(llm, systemPrompt, userMessage) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const start = Date.now();
  try {
    const answer = await askOnce(llm, systemPrompt, userMessage, ctl.signal);
    return { answer, latencyMs: Date.now() - start, error: null };
  } catch (err) {
    return { answer: '', latencyMs: Date.now() - start, error: err?.message || String(err) };
  } finally {
    clearTimeout(to);
  }
}

async function main() {
  await app.whenReady();

  const productGate = tryLoadProductGate();
  const enforce =
    productGate?.enforceStructuralGate ||
    ((text, sdPhase) => (sdPhase === 'requirements' ? Smoke.softTruncateToRequirements(text) : text));
  const phaseContract =
    productGate?.requirementsPhaseContractFor ||
    ((sdPhase) => (sdPhase === 'requirements' ? Smoke.REQUIREMENTS_PHASE_CONTRACT : ''));

  // eslint-disable-next-line import/no-dynamic-require, global-require
  const mainMod = require(path.join(distRoot, 'main.js'));
  const { AppState } = mainMod;
  if (!AppState) {
    throw new Error('AppState not exported from main.js — run npm run build:electron');
  }

  console.log('[sd-req-gate-smoke] waiting for AppState…');
  await new Promise((r) => setTimeout(r, 3000));
  const appState = AppState.getInstance();
  const llm = appState.processingHelper.getLLMHelper();

  if (GEMINI_KEY) {
    llm.setApiKey(GEMINI_KEY);
    llm.setModel(MODEL);
    console.log(`[sd-req-gate-smoke] model=${MODEL} client=gemini (direct) productGate=${Boolean(productGate)}`);
  } else {
    llm.setNativelyKey(NATIVELY_KEY);
    llm.setModel('natively');
    console.log(`[sd-req-gate-smoke] model=${MODEL} client=natively productGate=${Boolean(productGate)}`);
  }

  // eslint-disable-next-line import/no-dynamic-require, global-require
  const { ModesManager } = require(path.join(distRoot, 'services/ModesManager.js'));
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const { MODE_TECHNICAL_INTERVIEW_PROMPT } = require(path.join(distRoot, 'llm/prompts.js'));
  const mm = ModesManager.getInstance();
  for (const m of mm.getModes()) {
    if (/sd.?req.?gate|technical.?interview/i.test(m.name) && m.templateType === 'technical-interview') {
      try { mm.deleteMode(m.id); } catch { /* ignore */ }
    }
  }
  const mode = mm.createMode({ name: 'SD Req Gate Smoke', templateType: 'technical-interview' });
  mm.setActiveMode(mode.id);

  let artifact = Smoke.createEmptyArtifact(scenario.problemKey);
  let hardFail = false;

  // ── Turn 1: gated Requirements ────────────────────────────────────────────
  const gatedPhase = Smoke.deriveSdPhase(artifact);
  const gatedSystem = [MODE_TECHNICAL_INTERVIEW_PROMPT, phaseContract(gatedPhase)].filter(Boolean).join('\n\n');
  console.log(`[sd-req-gate-smoke] turn=gated sdPhase=${gatedPhase}`);
  const gatedRaw = await askWithTimeout(llm, gatedSystem, scenario.problemPrompt);
  if (gatedRaw.error) {
    hardFail = true;
    console.log(`FAIL  gated  :: ERROR:${gatedRaw.error}`);
  } else {
    const enforced = enforce(gatedRaw.answer, gatedPhase);
    const scored = Smoke.assertGatedSpoken(enforced);
    if (scored.ok) {
      console.log(`PASS  gated  ${gatedRaw.latencyMs}ms  chars=${scored.spoken.length}`);
    } else {
      hardFail = true;
      console.log(`FAIL  gated  ${gatedRaw.latencyMs}ms  :: ${scored.misses.join(';')}`);
      console.log(`      → ${(enforced || '').slice(0, 220).replace(/\n/g, ' ')}`);
    }
  }

  // ── Fill checklist + advance (fixture path; no live STT) ──────────────────
  artifact = Smoke.applyInterviewerFills(artifact, scenario.interviewerFills);
  if (!Smoke.isChecklistComplete(artifact)) {
    hardFail = true;
    console.log('FAIL  checklist  :: interviewer fills did not complete mandatory slots');
  } else {
    artifact = Smoke.acceptAdvance(artifact);
    const phase = Smoke.deriveSdPhase(artifact);
    if (phase !== 'post_requirements') {
      hardFail = true;
      console.log(`FAIL  advance  :: expected post_requirements, got ${phase}`);
    } else {
      console.log('PASS  advance  checklist complete + advance accepted → post_requirements');
    }
  }

  // ── Turn 2: post-gate HLD / Deep Dive ──────────────────────────────────────
  const postPhase = Smoke.deriveSdPhase(artifact);
  const postSystem = [MODE_TECHNICAL_INTERVIEW_PROMPT, phaseContract(postPhase)].filter(Boolean).join('\n\n');
  console.log(`[sd-req-gate-smoke] turn=post_advance sdPhase=${postPhase}`);
  const postRaw = await askWithTimeout(llm, postSystem, scenario.postAdvancePrompt);
  if (postRaw.error) {
    hardFail = true;
    console.log(`FAIL  post_advance  :: ERROR:${postRaw.error}`);
  } else {
    const scored = Smoke.assertPostAdvanceSpoken(postRaw.answer);
    if (scored.ok) {
      console.log(
        `PASS  post_advance  ${postRaw.latencyMs}ms  hasLater=${scored.hasLater} ` +
        `tech=${(scored.matchedTech || []).join(',') || '-'}`,
      );
    } else {
      hardFail = true;
      console.log(`FAIL  post_advance  ${postRaw.latencyMs}ms  :: ${scored.misses.join(';')}`);
      console.log(`      → ${(postRaw.answer || '').slice(0, 220).replace(/\n/g, ' ')}`);
    }
  }

  console.log(`\n[sd-req-gate-smoke] done scenario=${scenario.id} hardFail=${hardFail}`);
  process.exitCode = hardFail ? 1 : 0;
}

function cleanup() {
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* best effort */ }
}

main()
  .catch((e) => {
    console.error('[sd-req-gate-smoke] FATAL', e?.message || e);
    process.exitCode = 2;
  })
  .finally(() => {
    cleanup();
    try {
      const code = typeof process.exitCode === 'number' ? process.exitCode : 0;
      app.exit(code);
    } catch {
      process.exit(typeof process.exitCode === 'number' ? process.exitCode : 0);
    }
  });
