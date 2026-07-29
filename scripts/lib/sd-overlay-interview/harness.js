// scripts/lib/sd-overlay-interview/harness.js
//
// Pure helpers for the additive sd-overlay-interview UI e2e family
// (Playwright `_electron` + `__e2e__` + live LLM by default).
// No Electron / Playwright I/O — unit-testable.
//
// Distinct from Profile `interview-simulator` and SD T1/T2 sim families.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Overlay chrome hooks (ticket 01). Asserts land in 03/04. */
const PLANNED_TESTIDS = Object.freeze({
  gateStrip: 'sd-requirements-gate-strip',
  gateAdvance: 'sd-requirements-gate-advance',
  /** Matches ticket 01 / NativelyInterface `data-testid`. */
  answerSurface: 'sd-overlay-answer-panel',
});

const GEMINI_KEY_ENV_NAMES = [
  'GEMINI_API_KEY',
  'GEMINI_API_KEY_2',
  'GEMINI_API_KEY_3',
  'GEMINI_API_KEY_4',
  'GEMINI_API_KEY_5',
  'GEMINI_API_KEY_6',
  'GOOGLE_API_KEY',
];

/**
 * Core matrix is short (strip → soft-refuse → fill/Advance → one post-gate probe).
 * Not a ~32-turn Delivery Framework marathon.
 */
const MATRIX_BUDGET_DEFAULTS = Object.freeze({
  /** Injected turns + Advance/WTA actions counted toward the cap (≪ DF ~32). */
  maxTurns: 12,
  maxMs: 180_000,
  maxEstimatedUsd: null,
});

/** Default post-gate interviewer probe (one clarifier after Requirements). */
const DEFAULT_POST_GATE_PROBE =
  'For this URL shortener, what core entities would you model first?';

/** First non-blank Gemini/Google key from env, or ''. */
function resolveGeminiApiKey(env = process.env) {
  for (const name of GEMINI_KEY_ENV_NAMES) {
    const v = (env[name] || '').trim();
    if (v) return v;
  }
  return '';
}

function resolveLiveApiKey(env = process.env) {
  return resolveGeminiApiKey(env) || (env.NATIVELY_API_KEY || '').trim();
}

/**
 * Stub LLM is local-debug only — never the default path.
 * @param {NodeJS.ProcessEnv} [env]
 */
function isStubLlmDebug(env = process.env) {
  return env.SD_OVERLAY_INTERVIEW_STUB_LLM === '1';
}

/**
 * Live-by-default gate: run when a real key is present, or when stub debug is on.
 * Skip (exit 0) when neither — schedule jobs must not fail-noise on missing secrets.
 *
 * RUN_SD_OVERLAY_INTERVIEW=1 is the operator/CI opt-in documented for schedule jobs
 * (ticket 05). Local runs with a key may omit it; CI should set it explicitly.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ run: boolean, mode: 'live' | 'stub' | 'skip', reason: string }}
 */
function shouldRunOverlayInterview(env = process.env) {
  if (isStubLlmDebug(env)) {
    return {
      run: true,
      mode: 'stub',
      reason: 'SD_OVERLAY_INTERVIEW_STUB_LLM=1 (local debug only — not CI default)',
    };
  }
  const key = resolveLiveApiKey(env);
  if (!key) {
    return {
      run: false,
      mode: 'skip',
      reason:
        'no GEMINI_API_KEY / GOOGLE_API_KEY / NATIVELY_API_KEY — set a live key, or SD_OVERLAY_INTERVIEW_STUB_LLM=1 for local debug',
    };
  }
  return {
    run: true,
    mode: 'live',
    reason: 'live LLM key present',
  };
}

function overlayInterviewSkipMessage(decision) {
  return (
    `[sd-overlay-interview] SKIP — ${decision?.reason || 'not configured'}. ` +
    'Schedule / workflow_dispatch only (never PR). Additive UI family — does not replace ' +
    'gate e2e / sim T1 / Profile interview-simulator / T2.'
  );
}

function resolveFixtureDir(repoRoot) {
  return path.join(repoRoot, 'scripts', 'fixtures', 'sd-requirements-gate');
}

/**
 * Load a gate fixture by id (reuses sd-requirements-gate fixtures).
 * @param {string} repoRoot
 * @param {string} id
 */
function loadGateFixture(repoRoot, id) {
  const p = path.join(resolveFixtureDir(repoRoot), `${id}.json`);
  if (!fs.existsSync(p)) throw new Error(`missing fixture: ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** Premature soft-refuse scenario (ticket 03). */
function loadPrematureSoftRefuseFixture(repoRoot) {
  return loadGateFixture(repoRoot, 'premature-soft-refuse');
}

/** Happy fill → advance scenario (ticket 04) — checklist language source. */
function loadHappyGatedAdvanceFixture(repoRoot) {
  return loadGateFixture(repoRoot, 'happy-gated-advance');
}

/**
 * Labels the soft-refuse spoken text / expanded strip must name.
 * @param {{ expect?: { softRefuseMustName?: string[] } }} fixture
 * @returns {string[]}
 */
function softRefuseMustNameLabels(fixture) {
  const names = fixture?.expect?.softRefuseMustName;
  return Array.isArray(names) ? names.map((s) => String(s)) : [];
}

/**
 * Interviewer turns from a fixture (for `__e2e__:inject-transcript` / arm hook).
 * @param {{ turns?: Array<{ role?: string, speaker?: string, text?: string }> }} fixture
 */
function interviewerTurnsFromFixture(fixture) {
  return (fixture?.turns || []).filter((t) => {
    const role = String(t.role || '');
    const speaker = String(t.speaker || '');
    if (role === 'user' || speaker === 'user') return false;
    if (role === 'assistant' || speaker === 'assistant') return false;
    return Boolean(String(t.text || '').trim());
  });
}

/**
 * Interviewer turns that carry checklist-fill language (reuse happy-gated-advance).
 * Prefers turns mentioning scale/QPS/latency/consistency; falls back to all interviewer turns.
 * @param {{ turns?: Array<{ role?: string, speaker?: string, text?: string }> }} fixture
 */
function checklistFillTurnsFromFixture(fixture) {
  const all = interviewerTurnsFromFixture(fixture);
  const fillish = all.filter((t) =>
    /scale|qps|latency|consistency|availability|functional|p99/i.test(String(t.text || '')),
  );
  return fillish.length > 0 ? fillish : all;
}

/**
 * One post-gate probe question (bounded matrix — not DF marathon).
 * @param {{ postGateProbe?: string } | null | undefined} [fixtureOrOpts]
 */
function postGateProbeFromFixture(fixtureOrOpts) {
  const custom = fixtureOrOpts && typeof fixtureOrOpts.postGateProbe === 'string'
    ? fixtureOrOpts.postGateProbe.trim()
    : '';
  return custom || DEFAULT_POST_GATE_PROBE;
}

/**
 * Spend/time/turn caps for the core UI matrix (ticket 04).
 * @param {NodeJS.ProcessEnv} [env]
 */
function resolveMatrixBudgets(env = process.env) {
  const maxTurnsRaw = (env.SD_OVERLAY_INTERVIEW_MAX_TURNS || '').trim();
  const maxMsRaw = (env.SD_OVERLAY_INTERVIEW_MAX_MS || '').trim();
  const maxUsdRaw = (env.SD_OVERLAY_INTERVIEW_MAX_USD || '').trim();
  const maxTurns = maxTurnsRaw
    ? Math.max(1, parseInt(maxTurnsRaw, 10) || MATRIX_BUDGET_DEFAULTS.maxTurns)
    : MATRIX_BUDGET_DEFAULTS.maxTurns;
  const maxMs = maxMsRaw
    ? Math.max(5_000, parseInt(maxMsRaw, 10) || MATRIX_BUDGET_DEFAULTS.maxMs)
    : MATRIX_BUDGET_DEFAULTS.maxMs;
  let maxEstimatedUsd = MATRIX_BUDGET_DEFAULTS.maxEstimatedUsd;
  if (maxUsdRaw) {
    const n = parseFloat(maxUsdRaw);
    maxEstimatedUsd = Number.isFinite(n) && n > 0 ? n : null;
  }
  return Object.freeze({ maxTurns, maxMs, maxEstimatedUsd });
}

/**
 * Mutable turn/time budget tracker for the overlay matrix run.
 * @param {{ maxTurns: number, maxMs: number, maxEstimatedUsd?: number | null }} budgets
 */
function createTurnBudget(budgets) {
  const caps = {
    maxTurns: budgets.maxTurns,
    maxMs: budgets.maxMs,
    maxEstimatedUsd:
      budgets.maxEstimatedUsd == null ? null : Number(budgets.maxEstimatedUsd),
  };
  let turnCount = 0;
  let estimatedUsd = 0;
  const startedAt = Date.now();

  function assertWithinCaps(label = 'matrix') {
    const elapsedMs = Date.now() - startedAt;
    if (turnCount > caps.maxTurns) {
      throw new Error(
        `${label}: turn cap exceeded (${turnCount} > ${caps.maxTurns}) — core UI matrix only, not DF`,
      );
    }
    if (elapsedMs > caps.maxMs) {
      throw new Error(
        `${label}: time cap exceeded (${elapsedMs}ms > ${caps.maxMs}ms)`,
      );
    }
    if (
      caps.maxEstimatedUsd != null &&
      estimatedUsd >= caps.maxEstimatedUsd
    ) {
      throw new Error(
        `${label}: USD cap exceeded (≈${estimatedUsd} >= ${caps.maxEstimatedUsd})`,
      );
    }
  }

  return {
    get turnCount() {
      return turnCount;
    },
    get estimatedUsd() {
      return estimatedUsd;
    },
    get elapsedMs() {
      return Date.now() - startedAt;
    },
    get caps() {
      return { ...caps };
    },
    /** Count an injected turn or Advance/WTA action toward the matrix bound. */
    bump(n = 1, label = 'matrix') {
      turnCount += n;
      assertWithinCaps(label);
      return turnCount;
    },
    addEstimatedUsd(delta, label = 'matrix') {
      if (typeof delta === 'number' && Number.isFinite(delta) && delta > 0) {
        estimatedUsd += delta;
      }
      assertWithinCaps(label);
      return estimatedUsd;
    },
    assertWithinCaps,
    snapshot() {
      return {
        turnCount,
        estimatedUsd,
        elapsedMs: Date.now() - startedAt,
        caps: { ...caps },
      };
    },
  };
}

/**
 * Whether answer-panel text looks like visible answer chrome (not empty).
 * Live: prefer substantive content. Stub: accept provider-missing feedback too.
 * @param {string} text
 * @param {'live' | 'stub'} [mode]
 */
function answerChromeLooksPresent(text, mode = 'live') {
  const hay = String(text || '').trim();
  if (hay.length < 12) return false;
  if (mode === 'stub') {
    return (
      hay.length >= 12 ||
      /no ai providers|could not generate|api key|entities|shorten|design/i.test(hay)
    );
  }
  // Live: need more than the soft-refuse alone if possible; any substantial panel ok.
  return hay.length >= 24;
}

/**
 * Core UI matrix steps — tickets 03 + 04 asserted.
 * @type {ReadonlyArray<{ id: string, ticket: string, testid?: string, fixtureHint?: string, status: string }>}
 */
const CORE_UI_MATRIX_STEPS = Object.freeze([
  {
    id: 'strip-visible',
    ticket: '03',
    testid: PLANNED_TESTIDS.gateStrip,
    status: 'asserted',
  },
  {
    id: 'premature-advance-soft-refuse',
    ticket: '03',
    testid: PLANNED_TESTIDS.gateAdvance,
    status: 'asserted',
  },
  {
    id: 'fill-advance-strip-hidden',
    ticket: '04',
    fixtureHint: 'happy-gated-advance',
    status: 'asserted',
  },
  {
    id: 'post-gate-answer-chrome',
    ticket: '04',
    testid: PLANNED_TESTIDS.answerSurface,
    status: 'asserted',
  },
]);

/** Matrix steps owned by a ticket id. */
function matrixStepsForTicket(ticket) {
  return CORE_UI_MATRIX_STEPS.filter((s) => s.ticket === String(ticket));
}

/** Whether soft-refuse text appears to name the required missing labels. */
function softRefuseTextMatchesLabels(text, labels) {
  const hay = String(text || '').toLowerCase();
  if (!hay.trim()) return false;
  const list = Array.isArray(labels) ? labels : [];
  if (list.length === 0) return hay.includes('before we move on') || hay.includes('still need');
  return list.every((label) => {
    const needle = String(label || '').toLowerCase();
    if (!needle) return true;
    // Soft-refuse joins with "and"; allow partial token match on key words.
    if (hay.includes(needle)) return true;
    const tokens = needle.split(/\s*\/\s*|\s+vs\s+|\s+/).filter((t) => t.length > 2);
    return tokens.length > 0 && tokens.every((t) => hay.includes(t));
  });
}

module.exports = {
  PLANNED_TESTIDS,
  CORE_UI_MATRIX_STEPS,
  GEMINI_KEY_ENV_NAMES,
  MATRIX_BUDGET_DEFAULTS,
  DEFAULT_POST_GATE_PROBE,
  resolveGeminiApiKey,
  resolveLiveApiKey,
  isStubLlmDebug,
  shouldRunOverlayInterview,
  overlayInterviewSkipMessage,
  resolveFixtureDir,
  loadGateFixture,
  loadPrematureSoftRefuseFixture,
  loadHappyGatedAdvanceFixture,
  softRefuseMustNameLabels,
  interviewerTurnsFromFixture,
  checklistFillTurnsFromFixture,
  postGateProbeFromFixture,
  resolveMatrixBudgets,
  createTurnBudget,
  answerChromeLooksPresent,
  matrixStepsForTicket,
  softRefuseTextMatchesLabels,
};
