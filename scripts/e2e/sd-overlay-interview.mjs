#!/usr/bin/env node
// scripts/e2e/sd-overlay-interview.mjs
//
// Additive SD Overlay Interview UI e2e (family: sd-overlay-interview).
// Playwright `_electron` boots a real app window, selects Technical Interview,
// arms the Requirements gate without mic TCC, and asserts core UI matrix steps.
//
// Ticket 03: strip visible + premature Advance soft-refuse (DOM).
// Ticket 04: fill → Advance hide + post-gate answer chrome.
//
// Live LLM by default (real API key / product path). Skip exit 0 if no key.
// Stub LLM ONLY behind SD_OVERLAY_INTERVIEW_STUB_LLM=1 (local debug).
// Soft-refuse is an early-return WITHOUT LLM; successful Advance closes the
// gate before the LLM stream (strip hide works in stub). Post-gate answer
// chrome needs live LLM for fidelity; stub accepts provider-missing feedback
// or skips that sub-assert with a clear log.
//
// Does NOT replace:
//   - e2e:sd-requirements-gate
//   - e2e:sd-interview-sim (T1)
//   - Profile interview-simulator
//   - sd-interview-sim:t2
//
// Usage:
//   npm run e2e:sd-overlay-interview
//   RUN_SD_OVERLAY_INTERVIEW=1 GEMINI_API_KEY=<key> npm run e2e:sd-overlay-interview
//   SD_OVERLAY_INTERVIEW_STUB_LLM=1 npm run e2e:sd-overlay-interview   # local debug only
//
// Env:
//   GEMINI_API_KEY | GOOGLE_API_KEY | NATIVELY_API_KEY  — live key (required unless stub)
//   RUN_SD_OVERLAY_INTERVIEW=1                          — operator/CI opt-in (ticket 05)
//   SD_OVERLAY_INTERVIEW_STUB_LLM=1                     — stub path (local debug only)
//   SD_OVERLAY_INTERVIEW_BOOT_ASK=1                     — optional single __e2e__:ask (burns 1 LLM call)
//   SD_OVERLAY_INTERVIEW_START_MEETING=1                — try real startMeeting (8s timeout; mic TCC risk)
//   SD_OVERLAY_INTERVIEW_MAX_TURNS                      — matrix turn cap (default 12)
//   SD_OVERLAY_INTERVIEW_MAX_MS                         — wall-clock cap (default 180000)
//   SD_OVERLAY_INTERVIEW_MAX_USD                        — optional estimated USD cap
//   NATIVELY_E2E_LOCAL_TEST_TOKEN                       — e2e local token (default set)

import { _electron as electron } from '@playwright/test';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

try {
  require('dotenv').config({ path: path.join(repoRoot, '.env') });
} catch {
  /* optional */
}

const {
  shouldRunOverlayInterview,
  overlayInterviewSkipMessage,
  PLANNED_TESTIDS,
  CORE_UI_MATRIX_STEPS,
  resolveFixtureDir,
  loadPrematureSoftRefuseFixture,
  loadHappyGatedAdvanceFixture,
  softRefuseMustNameLabels,
  interviewerTurnsFromFixture,
  checklistFillTurnsFromFixture,
  postGateProbeFromFixture,
  softRefuseTextMatchesLabels,
  resolveMatrixBudgets,
  createTurnBudget,
  answerChromeLooksPresent,
} = require('../lib/sd-overlay-interview/harness.js');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const TAG = '[sd-overlay-interview]';
const LOCAL_TOKEN = process.env.NATIVELY_E2E_LOCAL_TEST_TOKEN || 'local-test-e2e-token';
const distMain = path.join(repoRoot, 'dist-electron', 'electron', 'main.js');
const distIndex = path.join(repoRoot, 'dist', 'index.html');
const ARTIFACT_DIR = path.join(repoRoot, 'debug-artifacts', 'sd-overlay-interview');

const NAV_RE = /Execution context was destroyed|because of a navigation|Target closed|has been closed/i;

function log(...a) {
  const line = `${TAG} ${a.map(String).join(' ')}\n`;
  process.stdout.write(line);
}

function skip(msg) {
  console.log(typeof msg === 'string' ? msg : overlayInterviewSkipMessage(msg));
  process.exit(0);
}

function fail(msg) {
  console.error(TAG, 'FAIL —', msg);
  process.exit(1);
}

/** Resilient e2eInvoke — same pattern as Profile interview-simulator. */
function makeR(getWin) {
  return async (ch, ...a) => {
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const win = getWin();
        if (!win) throw new Error('no window');
        return await win.evaluate(
          async ({ ch, a }) => (window.electronAPI || window.api).e2eInvoke(ch, ...a),
          { ch, a },
        );
      } catch (e) {
        lastErr = e;
        if (!NAV_RE.test(String(e?.message || e))) throw e;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    throw lastErr;
  };
}

function makeApi(getWin) {
  return async (fn, arg) => {
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const win = getWin();
        if (!win) throw new Error('no window');
        await win.waitForLoadState('domcontentloaded').catch(() => {});
        return await win.evaluate(fn, arg);
      } catch (e) {
        lastErr = e;
        if (!NAV_RE.test(String(e?.message || e))) throw e;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    throw lastErr;
  };
}

function buildLaunchEnv(udd, mode) {
  const e = { ...process.env };
  // Live path keeps product keys. Stub debug blanks cloud keys so nothing
  // accidentally hits a live provider during local chrome-only boot.
  if (mode === 'stub') {
    for (const k of [
      'GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'CLAUDE_API_KEY',
      'DEEPSEEK_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 'NATIVELY_API_KEY',
      'GEMINI_API_KEY_1', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3',
      'GEMINI_API_KEY_4', 'GEMINI_API_KEY_5', 'GEMINI_API_KEY_6',
    ]) {
      e[k] = '';
    }
  }
  return {
    ...e,
    NATIVELY_E2E: '1',
    NATIVELY_E2E_LOCAL_TEST_TOKEN: LOCAL_TOKEN,
    NATIVELY_TEST_USERDATA: udd,
    NODE_ENV: process.env.NODE_ENV === 'development' ? 'development' : 'test',
    NATIVELY_DEV_BYPASS_SCREEN_TCC: '1',
    // Keep LESSON ingest off by default for this short matrix (spec).
    NATIVELY_OKF_KNOWLEDGE_PACKS: e.NATIVELY_OKF_KNOWLEDGE_PACKS || '0',
  };
}

async function findOverlayWindow(app) {
  const wins = app.windows();
  for (const w of wins) {
    try {
      const url = w.url();
      if (/window=overlay/.test(url)) return w;
    } catch {
      /* ignore */
    }
  }
  // Fallback: any visible non-launcher window, else first window.
  for (const w of wins) {
    try {
      if (await w.evaluate(() => /window=overlay/.test(location.search))) return w;
    } catch {
      /* ignore */
    }
  }
  return wins[0] || null;
}

async function selectTechnicalInterview(api) {
  const mode = await api(async () => {
    const bridge = window.electronAPI || window.api;
    // modes:get-all returns a bare Mode[] (not { modes }).
    const listed = await bridge.modesGetAll?.().catch(() => null);
    const modes = Array.isArray(listed) ? listed : listed?.modes || [];
    const existing = modes.find(
      (m) =>
        m?.templateType === 'technical-interview' &&
        /sd.?overlay|technical.?interview/i.test(String(m?.name || '')),
    );
    if (existing?.id) {
      await bridge.modesSetActive(existing.id);
      return existing;
    }
    const created = await bridge.modesCreate({
      name: 'SD Overlay Interview TI',
      templateType: 'technical-interview',
    });
    if (!created?.success && !created?.mode) {
      throw new Error(`modesCreate failed: ${created?.error || JSON.stringify(created)}`);
    }
    const m = created.mode;
    await bridge.modesSetActive(m.id);
    return m;
  });
  return mode;
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Show the meeting overlay window.
 *
 * Default: setWindowMode('overlay') — v1 injects via `__e2e__` (no STT/mic).
 * Prefer `__e2e__:arm-sd-overlay-gate` for gate-armed meeting (no mic).
 * startMeeting() can block forever on macOS mic TCC dialogs, so it is opt-in
 * behind SD_OVERLAY_INTERVIEW_START_MEETING=1 with a hard timeout + fallback.
 */
async function showMeetingOverlay(api) {
  const tryStart = process.env.SD_OVERLAY_INTERVIEW_START_MEETING === '1';
  if (tryStart) {
    try {
      const result = await withTimeout(
        api(async () => {
          const bridge = window.electronAPI || window.api;
          return bridge.startMeeting({
            audio: {},
            doNotPersist: true,
            title: 'sd-overlay-interview-e2e',
          });
        }),
        8000,
        'startMeeting',
      );
      if (result?.success) return { ok: true, via: 'start-meeting' };
      log(
        `startMeeting failed (${result?.code || result?.error || 'unknown'}) — falling back to setWindowMode(overlay)`,
      );
    } catch (e) {
      log(`${e?.message || e} — falling back to setWindowMode(overlay)`);
    }
  }

  await api(async () => {
    const bridge = window.electronAPI || window.api;
    await bridge.setWindowMode('overlay');
    return true;
  });
  return { ok: true, via: 'set-window-mode' };
}

async function captureFailure(win, label, context = {}) {
  try {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const stamp = Date.now();
    const shot = path.join(ARTIFACT_DIR, `${label}-${stamp}.png`);
    if (win) await win.screenshot({ path: shot, fullPage: true }).catch(() => {});
    log('artifact:', shot);
    if (context.tracePath) log('trace:', context.tracePath);
    if (context.note) log('fail-note:', context.note);
  } catch {
    /* best effort */
  }
}

/**
 * Ticket 03: strip visible while gated + premature Advance soft-refuse in overlay.
 * Uses real strip button (not __e2e__:ask — ask resets IM mid-scenario).
 */
async function assertPrematureAdvanceUi(win, labels) {
  const stripSel = `[data-testid="${PLANNED_TESTIDS.gateStrip}"]`;
  const advanceSel = `[data-testid="${PLANNED_TESTIDS.gateAdvance}"]`;
  const panelSel = `[data-testid="${PLANNED_TESTIDS.answerSurface}"]`;

  const strip = win.locator(stripSel);
  await strip.waitFor({ state: 'visible', timeout: 20000 });
  log(`PASS[03] strip visible (${PLANNED_TESTIDS.gateStrip})`);

  const advance = win.locator(advanceSel);
  await advance.waitFor({ state: 'visible', timeout: 10000 });
  await advance.click({ timeout: 10000 });
  log(`clicked Advance (${PLANNED_TESTIDS.gateAdvance})`);

  // Soft-refuse: answer panel text AND/OR expanded strip naming missing slots.
  const deadline = Date.now() + 25000;
  let lastPanel = '';
  let expanded = false;
  let matched = false;
  while (Date.now() < deadline) {
    lastPanel = '';
    try {
      const panel = win.locator(panelSel);
      if (await panel.count()) {
        lastPanel = (await panel.innerText({ timeout: 2000 }).catch(() => '')) || '';
      }
    } catch {
      /* ignore */
    }

    try {
      expanded =
        (await strip.locator('[aria-expanded="true"]').count()) > 0 ||
        (await strip.getAttribute('aria-expanded').catch(() => null)) === 'true';
      // Expand toggle lives on the progress button inside the strip.
      if (!expanded) {
        const toggle = strip.locator('[aria-expanded="true"]');
        expanded = (await toggle.count()) > 0;
      }
    } catch {
      expanded = false;
    }

    const stripText = (await strip.innerText().catch(() => '')) || '';
    const panelOk = softRefuseTextMatchesLabels(lastPanel, labels);
    const stripOk =
      expanded &&
      (softRefuseTextMatchesLabels(stripText, labels) ||
        labels.every((l) => stripText.toLowerCase().includes(String(l).toLowerCase().split(/\s*\/\s*/)[0])));

    if (panelOk || stripOk) {
      matched = true;
      log(
        `PASS[03] soft-refuse observable panelOk=${panelOk ? 1 : 0} ` +
          `stripExpandedOk=${stripOk ? 1 : 0} expanded=${expanded ? 1 : 0}`,
      );
      break;
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  if (!matched) {
    throw new Error(
      `soft-refuse not observed in overlay. labels=${JSON.stringify(labels)} ` +
        `expanded=${expanded} panelSnippet=${JSON.stringify(lastPanel.slice(0, 240))}`,
    );
  }
}

/**
 * Ticket 04: inject checklist-fill language → UI Advance → strip hidden.
 * Fills land via SessionTracker; prepare runs on Advance (do NOT use __e2e__:ask).
 */
async function assertFillAdvanceStripHidden(win, R, fillTurns, budget) {
  const stripSel = `[data-testid="${PLANNED_TESTIDS.gateStrip}"]`;
  const advanceSel = `[data-testid="${PLANNED_TESTIDS.gateAdvance}"]`;

  const strip = win.locator(stripSel);
  await strip.waitFor({ state: 'visible', timeout: 15000 });

  for (const turn of fillTurns) {
    const text = String(turn?.text || '').trim();
    if (!text) continue;
    budget.bump(1, 'fill-inject');
    const inj = await R('__e2e__:inject-transcript', {
      speaker: 'interviewer',
      text,
      final: true,
      confidence: 0.95,
    });
    if (inj?.success === false) {
      throw new Error(`fill inject failed: ${JSON.stringify(inj)}`);
    }
    log(`fill inject (${text.slice(0, 72)}${text.length > 72 ? '…' : ''})`);
    await sleep(350);
  }
  budget.assertWithinCaps('post-fill');

  // Settle after soft-refuse WTA so Advance is not blocked by tryBeginOverlayAction.
  await sleep(1200);

  const advance = win.locator(advanceSel);
  await advance.waitFor({ state: 'visible', timeout: 10000 });
  budget.bump(1, 'fill-advance');
  await advance.click({ timeout: 10000 });
  log(`clicked Advance after fill (${PLANNED_TESTIDS.gateAdvance})`);

  // Gate closes in prepare before LLM stream — strip should unmount (visible=false).
  const hideDeadline = Date.now() + 45000;
  let hidden = false;
  while (Date.now() < hideDeadline) {
    budget.assertWithinCaps('strip-hide-wait');
    const count = await strip.count().catch(() => 0);
    if (count === 0) {
      hidden = true;
      break;
    }
    const vis = await strip.isVisible().catch(() => false);
    if (!vis) {
      hidden = true;
      break;
    }
    await sleep(300);
  }
  if (!hidden) {
    throw new Error(
      `strip still visible after filled Advance — expected ${PLANNED_TESTIDS.gateStrip} hidden/detached`,
    );
  }
  log(`PASS[04] fill → Advance → strip hidden (${PLANNED_TESTIDS.gateStrip})`);
}

/**
 * Wait until a What-to-answer press is not blocked by a prior in-flight action.
 */
async function waitForOverlayWtaIdle(win, timeoutMs = 90000) {
  const panelSel = `[data-testid="${PLANNED_TESTIDS.answerSurface}"]`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = (await win.locator(panelSel).innerText().catch(() => '')) || '';
    if (!/Still finishing the previous answer/i.test(text)) {
      await sleep(400);
      const text2 = (await win.locator(panelSel).innerText().catch(() => '')) || '';
      if (!/Still finishing the previous answer/i.test(text2)) return;
    }
    await sleep(400);
  }
  log('warn: overlay WTA idle wait timed out — continuing');
}

/**
 * Ticket 04: one post-gate interviewer probe → answer chrome present.
 * Product path: inject transcript + click "What to answer?" (no __e2e__:ask reset).
 */
async function assertPostGateAnswerChrome(win, R, probeText, mode, budget) {
  const panelSel = `[data-testid="${PLANNED_TESTIDS.answerSurface}"]`;

  await waitForOverlayWtaIdle(win, mode === 'live' ? 120000 : 60000);
  budget.assertWithinCaps('pre-post-gate');

  const before =
    (await win.locator(panelSel).innerText().catch(() => '')) || '';

  budget.bump(1, 'post-gate-inject');
  const inj = await R('__e2e__:inject-transcript', {
    speaker: 'interviewer',
    text: probeText,
    final: true,
    confidence: 0.95,
  });
  if (inj?.success === false) {
    throw new Error(`post-gate inject failed: ${JSON.stringify(inj)}`);
  }
  log(`post-gate probe inject: ${probeText.slice(0, 80)}`);
  await sleep(600);

  const wta = win.getByRole('button', { name: /What to answer/i });
  await wta.waitFor({ state: 'visible', timeout: 10000 });
  budget.bump(1, 'post-gate-wta');
  await wta.click({ timeout: 10000 });
  log('clicked What to answer? (product path, no im.reset)');

  // If blocked, retry once after idle.
  await sleep(800);
  let panelText = (await win.locator(panelSel).innerText().catch(() => '')) || '';
  if (/Still finishing the previous answer/i.test(panelText)) {
    log('WTA blocked — waiting then retry');
    await waitForOverlayWtaIdle(win, mode === 'live' ? 120000 : 45000);
    budget.bump(1, 'post-gate-wta-retry');
    await wta.click({ timeout: 10000 });
  }

  const waitMs = mode === 'live' ? 120000 : 45000;
  const deadline = Date.now() + waitMs;
  let matched = false;
  let last = '';
  while (Date.now() < deadline) {
    budget.assertWithinCaps('post-gate-wait');
    const panel = win.locator(panelSel);
    const visible = (await panel.count()) > 0 && (await panel.isVisible().catch(() => false));
    last = visible ? (await panel.innerText().catch(() => '')) || '' : '';
    const grew = last.length > before.length + 8;
    const changed = last.trim() !== before.trim() && last.trim().length >= 12;
    if (visible && (answerChromeLooksPresent(last, mode) || grew || changed)) {
      // Prefer not treating soft-refuse-only as post-gate success when before was soft-refuse
      // and nothing new arrived — require growth/change OR non-refuse substance.
      if (grew || changed || !/before we move on|still need to pin/i.test(last)) {
        matched = true;
        break;
      }
      if (mode === 'stub' && /no ai providers|could not generate|api key/i.test(last)) {
        matched = true;
        break;
      }
    }
    await sleep(500);
  }

  if (!matched) {
    if (mode === 'stub') {
      log(
        'STUB[04]: post-gate answer chrome not observed without live LLM — ' +
          'skipping sub-assert (fill→Advance→strip-hide already asserted). ' +
          `panelSnippet=${JSON.stringify(last.slice(0, 160))}`,
      );
      return { skipped: true };
    }
    throw new Error(
      `post-gate answer chrome not present (${PLANNED_TESTIDS.answerSurface}). ` +
        `panelSnippet=${JSON.stringify(last.slice(0, 240))}`,
    );
  }
  log(
    `PASS[04] post-gate answer chrome present (${PLANNED_TESTIDS.answerSurface}) ` +
      `chars=${last.trim().length}`,
  );
  return { skipped: false };
}

async function runOverlayInterview(mode) {
  if (!fs.existsSync(distMain)) {
    skip(
      `${TAG} SKIP — dist-electron missing (${path.relative(repoRoot, distMain)}). Run: npm run build:electron`,
    );
  }
  if (!fs.existsSync(distIndex)) {
    skip(
      `${TAG} SKIP — renderer dist missing (${path.relative(repoRoot, distIndex)}). Run: npm run build`,
    );
  }

  // Rebuild may be required after e2e IPC changes — warn if arm hook missing later.
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-sd-overlay-udd-'));
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  const fixture = loadPrematureSoftRefuseFixture(repoRoot);
  const softRefuseLabels = softRefuseMustNameLabels(fixture);
  const interviewerTurns = interviewerTurnsFromFixture(fixture);
  const happyFixture = loadHappyGatedAdvanceFixture(repoRoot);
  const fillTurns = checklistFillTurnsFromFixture(happyFixture);
  const postGateProbe = postGateProbeFromFixture(happyFixture);
  const budgets = resolveMatrixBudgets(process.env);
  const budget = createTurnBudget(budgets);

  let app = null;
  let primary = null;
  let active = null;
  let tracing = false;
  const tracePath = path.join(ARTIFACT_DIR, `trace-${Date.now()}.zip`);

  try {
    log(`mode=${mode} userData=${udd}`);
    log(`planned testids: ${JSON.stringify(PLANNED_TESTIDS)}`);
    log(
      `matrix: ${CORE_UI_MATRIX_STEPS.map((s) => `${s.id}:${s.status}`).join(', ')}`,
    );
    log(
      `budgets: maxTurns=${budgets.maxTurns} maxMs=${budgets.maxMs} ` +
        `maxUsd=${budgets.maxEstimatedUsd == null ? 'off' : budgets.maxEstimatedUsd}`,
    );
    log(`fixtures dir: ${resolveFixtureDir(repoRoot)}`);
    log(`fixture=${fixture.id} softRefuseLabels=${JSON.stringify(softRefuseLabels)}`);
    log(
      `happyFill=${happyFixture.id} fillTurns=${fillTurns.length} ` +
        `postGateProbe=${JSON.stringify(postGateProbe.slice(0, 64))}`,
    );

    app = await electron.launch({
      args: [distMain, `--user-data-dir=${udd}`],
      env: buildLaunchEnv(udd, mode),
      timeout: 60000,
    });

    primary = await app.firstWindow({ timeout: 30000 });
    try {
      await primary.waitForLoadState('domcontentloaded', { timeout: 15000 });
    } catch {
      /* best effort */
    }
    await new Promise((r) => setTimeout(r, 2500));

    active = primary;
    const getWin = () => active || app.windows()[0] || primary;
    const R = makeR(getWin);
    const api = makeApi(getWin);

    // Playwright tracing for failure artifacts (ticket 03 AC).
    try {
      await app.context().tracing.start({ screenshots: true, snapshots: true });
      tracing = true;
    } catch (e) {
      log(`tracing start skipped: ${e?.message || e}`);
    }

    await R('__e2e__:enable-pro');
    log('enable-pro ok');

    const ti = await selectTechnicalInterview(api);
    log(`Technical Interview mode active id=${ti.id} name=${ti.name} template=${ti.templateType}`);
    if (ti.templateType !== 'technical-interview') {
      throw new Error(`expected technical-interview, got ${ti.templateType}`);
    }

    // Ensure overlay chrome exists before arm (arm also sets overlay).
    const meeting = await showMeetingOverlay(api);
    await new Promise((r) => setTimeout(r, 800));
    const overlay = await findOverlayWindow(app);
    if (overlay) active = overlay;
    log(`pre-arm overlay via=${meeting.via} windows=${app.windows().length}`);

    // Arm gate without mic: e2e overlay session + sticky artifact + publish strip.
    const arm = await R('__e2e__:arm-sd-overlay-gate', {
      problemKey: fixture.problemKey || fixture.id,
      problemClass: fixture.problemClass,
      turns: fixture.turns || interviewerTurns,
      title: 'sd-overlay-interview-e2e',
    });
    if (!arm?.success) {
      throw new Error(
        `__e2e__:arm-sd-overlay-gate failed: ${JSON.stringify(arm)}. ` +
          'Rebuild electron if this channel is missing (npm run build:electron).',
      );
    }
    log(
      `arm-sd-overlay-gate ok via=${arm.via} meetingId=${arm.meetingId} ` +
        `fills=${(arm.fills || []).join(',') || '-'} visible=${arm.viewModel?.visible ? 1 : 0}`,
    );
    if (!arm.viewModel?.visible) {
      throw new Error(
        `gate strip viewModel not visible after arm: ${JSON.stringify(arm.viewModel)}`,
      );
    }

    // Count arm injects toward the matrix turn bound (not DF-length).
    const armTurnCount = Array.isArray(fixture.turns) ? fixture.turns.length : interviewerTurns.length;
    if (armTurnCount > 0) budget.bump(armTurnCount, 'arm-injects');

    await new Promise((r) => setTimeout(r, 1000));
    const overlay2 = await findOverlayWindow(app);
    if (overlay2) active = overlay2;

    // Optional inject smoke (already injected by arm; keep detect probe cheap).
    const probeText =
      interviewerTurns[0]?.text ||
      'Design a URL shortener — functional create/redirect only for now.';
    const detected = await R('__e2e__:detect-question', {
      text: probeText,
      confidence: 0.9,
    }).catch((e) => ({ success: false, error: String(e?.message || e) }));
    log(
      `detect-question ok=${detected?.success !== false ? 1 : 0} ` +
        `wouldFire=${detected?.wouldFire ?? 'n/a'}`,
    );

    // Optional single ask — only when explicitly requested (live mode).
    // Never use ask mid matrix (resets IM).
    if (mode === 'live' && process.env.SD_OVERLAY_INTERVIEW_BOOT_ASK === '1') {
      log('BOOT_ASK=1 — skipped during matrix (would im.reset); use after matrix only');
    }

    await assertPrematureAdvanceUi(active, softRefuseLabels);
    budget.bump(1, 'premature-advance');

    // Ticket 04: fill checklist → Advance hide strip → post-gate answer chrome.
    await assertFillAdvanceStripHidden(active, R, fillTurns, budget);
    const postGate = await assertPostGateAnswerChrome(
      active,
      R,
      postGateProbe,
      mode,
      budget,
    );

    const snap = budget.snapshot();
    log(
      `budget snapshot turns=${snap.turnCount}/${snap.caps.maxTurns} ` +
        `elapsedMs=${snap.elapsedMs} usd≈${snap.estimatedUsd}`,
    );

    if (tracing) {
      try {
        await app.context().tracing.stop({ path: path.join(ARTIFACT_DIR, 'trace-pass.zip') });
        tracing = false;
      } catch {
        /* ignore */
      }
    }

    log(
      'PASS — core UI matrix (strip + soft-refuse + fill/Advance hide' +
        (postGate.skipped ? '; post-gate skipped in stub' : '; post-gate answer chrome') +
        ')',
    );
    return 0;
  } catch (e) {
    console.error(TAG, 'FATAL', e?.message || e);
    if (tracing && app) {
      try {
        await app.context().tracing.stop({ path: tracePath });
        tracing = false;
        log('trace saved:', tracePath);
      } catch (te) {
        log(`trace stop failed: ${te?.message || te}`);
      }
    }
    await captureFailure(active || primary || app?.windows?.()?.[0], 'overlay-matrix-fail', {
      tracePath: fs.existsSync(tracePath) ? tracePath : undefined,
      note: String(e?.message || e),
    });
    return 2;
  } finally {
    if (tracing && app) {
      try {
        await app.context().tracing.stop({ path: tracePath });
      } catch {
        /* ignore */
      }
    }
    if (app) {
      try {
        await withTimeout(app.close(), 5000, 'app.close');
      } catch (e) {
        log(`app.close: ${e?.message || e} — force-killing electron`);
        try {
          app.process()?.kill?.('SIGKILL');
        } catch {
          /* ignore */
        }
      }
    }
    try {
      fs.rmSync(udd, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  const decision = shouldRunOverlayInterview(process.env);
  if (!decision.run) {
    skip(decision);
  }
  log(`run decision: mode=${decision.mode} (${decision.reason})`);
  if (process.env.RUN_SD_OVERLAY_INTERVIEW === '1') {
    log('RUN_SD_OVERLAY_INTERVIEW=1');
  }

  const code = await runOverlayInterview(decision.mode);
  process.exit(code);
}

main().catch((e) => {
  console.error(TAG, 'FATAL', e);
  process.exit(2);
});
