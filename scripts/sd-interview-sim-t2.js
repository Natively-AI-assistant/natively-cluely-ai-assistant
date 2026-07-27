#!/usr/bin/env node
// scripts/sd-interview-sim-t2.js
//
// T2 dual-agent overnight corpus runner (ticket 05).
// Prefer headless orchestration. NEVER intended for pull_request CI.
//
// Stub / protocol (default CI / node --test):
//   node --test scripts/__tests__/sd-interview-sim-t2.test.mjs
//
// Live overnight (opt-in; costs Gemini tokens):
//   RUN_SD_INTERVIEW_SIM_T2=1 GEMINI_API_KEY=<key> \
//     node scripts/sd-interview-sim-t2.js
//
// Optional knobs:
//   SD_INTERVIEW_SIM_T2_MAX_TURNS=20
//   SD_INTERVIEW_SIM_T2_MAX_INTERVIEWS=5
//   SD_INTERVIEW_SIM_T2_MAX_USD=1.5
//   SD_INTERVIEW_SIM_T2_INTERVIEWER_MODEL=gemini-3.1-flash-lite
//   SD_INTERVIEW_SIM_T2_SUT_MODEL=gemini-3.5-flash
//   SD_INTERVIEW_SIM_CORPUS_DIR=traces/sd-interview-sim
//   SD_INTERVIEW_SIM_T2_PROMPT='Design a URL shortener'
//
// Corpus = offline workflow debug fuel — not Gemini fine-tune.
// CI: workflow_dispatch / schedule only (see build-smoke.yml sd-interview-sim-t2).

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execSync } = require('node:child_process');

const {
  shouldRunT2DualAgent,
  t2SkipMessage,
  DEFAULT_INTERVIEWER_MODEL,
  DEFAULT_SUT_MODEL,
  createLiveInterviewerAgent,
  createThinCandidateAgent,
  createStubInterviewerAgent,
  NightlyInterviewCap,
  runT2DualAgent,
  resolveCorpusDir,
  retainLastN,
} = require('./lib/sd-interview-sim');

const repoRoot = path.resolve(__dirname, '..');

function resolveGitSha() {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

function envInt(name, fallback) {
  const raw = (process.env[name] || '').trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envFloat(name, fallback) {
  const raw = (process.env[name] || '').trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Thin SUT for headless overnight: echo stub unless SD_INTERVIEW_SIM_T2_LIVE_SUT=1.
 * Real WTA wiring stays product-side; this CLI proves protocol + caps + export.
 * When live SUT is requested without a custom hook, we still keep a minimal
 * stub so the overnight job never invents a second WTA brain inline.
 */
function createHeadlessSut(models) {
  const liveSut = process.env.SD_INTERVIEW_SIM_T2_LIVE_SUT === '1';
  return async function headlessSut(ctx) {
    const q = ctx.interviewerTurn?.text || '';
    // Placeholder product-path trigger: record that SUT was invoked.
    // Full SessionTracker+WTA headless wiring can replace this hook later.
    return {
      text: liveSut
        ? `[sut:${models.sut}] (live hook not wired — use injectable sut in harness)`
        : `[sut-stub] Acknowledged: ${String(q).slice(0, 120)}`,
      spend: liveSut
        ? { input_tokens: 0, output_tokens: 0, estimated_usd: 0 }
        : { input_tokens: 0, output_tokens: 40, estimated_usd: 0.0001 },
    };
  };
}

async function main() {
  const forceStub = process.env.SD_INTERVIEW_SIM_T2_STUB === '1';
  const live = !forceStub && shouldRunT2DualAgent(process.env);

  if (!live && !forceStub) {
    console.log(t2SkipMessage());
    process.exit(0);
  }

  const interviewerModel =
    (process.env.SD_INTERVIEW_SIM_T2_INTERVIEWER_MODEL || '').trim() ||
    DEFAULT_INTERVIEWER_MODEL;
  const sutModel =
    (process.env.SD_INTERVIEW_SIM_T2_SUT_MODEL || '').trim() || DEFAULT_SUT_MODEL;

  const maxTurns = envInt('SD_INTERVIEW_SIM_T2_MAX_TURNS', 20);
  const maxInterviews = envInt('SD_INTERVIEW_SIM_T2_MAX_INTERVIEWS', 5);
  const maxUsd = envFloat('SD_INTERVIEW_SIM_T2_MAX_USD', 1.5);
  const retainN = envInt('SD_INTERVIEW_SIM_T2_RETAIN', 20);

  const corpusDir = resolveCorpusDir({
    corpusDir: process.env.SD_INTERVIEW_SIM_CORPUS_DIR || undefined,
    repoRoot,
  });
  const stateDir =
    process.env.SD_INTERVIEW_SIM_T2_STATE_DIR ||
    path.join(os.tmpdir(), 'natively-sd-interview-sim-t2');
  fs.mkdirSync(stateDir, { recursive: true });

  const nightlyCap = new NightlyInterviewCap({
    maxInterviewsPerNight: maxInterviews,
    stateDir,
  });

  const prompt =
    (process.env.SD_INTERVIEW_SIM_T2_PROMPT || '').trim() ||
    'Design a URL shortener like Bitly. Start with Requirements, then HLD.';

  const models = { interviewer: interviewerModel, sut: sutModel };
  const interviewerAgent = live
    ? createLiveInterviewerAgent({ model: interviewerModel })
    : createStubInterviewerAgent([
        {
          text: `${prompt}\n\n\`\`\`mermaid\nflowchart LR\n  Client --> API\n\`\`\``,
        },
        { text: 'What is peak QPS and p99 latency?', end_interview: true },
      ]);

  console.log(
    `[sd-interview-sim-t2] mode=${live ? 'live-interviewer' : 'stub'} ` +
      `models=${JSON.stringify(models)} maxTurns=${maxTurns} ` +
      `maxInterviews/night=${maxInterviews} maxUsd=${maxUsd} corpus=${corpusDir}`,
  );
  console.log(
    '[sd-interview-sim-t2] corpus is workflow debug fuel — no fine-tune / train-job',
  );

  const results = [];
  while (nightlyCap.canStart()) {
    const { bundle, outcome, corpusPath } = await runT2DualAgent({
      scenario: { id: 'overnight-t2', prompt },
      interviewerAgent: live
        ? createLiveInterviewerAgent({ model: interviewerModel })
        : interviewerAgent,
      candidateAgent: createThinCandidateAgent(),
      sut: createHeadlessSut(models),
      maxTurns,
      budgets: {
        maxTurns,
        maxEstimatedUsd: maxUsd,
      },
      models,
      provenance: {
        git_sha: resolveGitSha(),
        tier: 'T2',
      },
      nightlyCap,
      corpusDir,
      writeBundle: true,
    });

    results.push({
      run_id: bundle.run_id,
      end_reason: outcome.end_reason,
      spend: outcome.spend,
      corpusPath,
      turns: bundle.turns.length,
    });

    console.log(
      `[sd-interview-sim-t2] done run_id=${bundle.run_id} ` +
        `end_reason=${outcome.end_reason} turns=${bundle.turns.length} ` +
        `usd≈${outcome.spend.estimated_usd} path=${corpusPath || '(none)'}`,
    );

    if (outcome.end_reason === 'budget_hit' && bundle.turns.length === 0) {
      // Nightly cap exhausted before starting.
      break;
    }
    if (!nightlyCap.canStart()) break;
    // One interview per CLI invocation by default unless SD_INTERVIEW_SIM_T2_BATCH=1
    if (process.env.SD_INTERVIEW_SIM_T2_BATCH !== '1') break;
  }

  try {
    const retained = retainLastN(corpusDir, retainN);
    console.log(
      `[sd-interview-sim-t2] retainLastN=${retainN} kept=${retained.kept.length} ` +
        `deleted=${retained.deleted.length}`,
    );
  } catch (err) {
    console.warn(`[sd-interview-sim-t2] retain skipped: ${err?.message || err}`);
  }

  console.log(`[sd-interview-sim-t2] interviews=${results.length}`);
  process.exitCode = 0;
}

main().catch((err) => {
  console.error('[sd-interview-sim-t2] FATAL', err?.message || err);
  process.exitCode = 2;
});
