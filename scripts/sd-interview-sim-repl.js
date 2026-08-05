#!/usr/bin/env node
// scripts/sd-interview-sim-repl.js
//
// Interactive dual-role CLI for SD interview conversation (no UI window).
//
// Stub ($0, no Electron):
//   SD_INTERVIEW_SIM_REPL_STUB=1 npm run sd-interview-sim:repl
//
// Live WTA SUT + live interviewer-agent on /open and candidate auto:
//   npm run build:electron
//   GEMINI_API_KEY=<key> npm run sd-interview-sim:repl
//
// Modes:
//   /mode interviewer  (default) — you type probes; Natively answers via WTA
//   /mode candidate              — you type answers; skip WTA; auto interviewer next
//   /mode auto [n] (= /run [n])  — hands-free: interviewer agent vs Natively while
//                                  you watch; Ctrl+C stops and hands control back
//                                  (default n: SD_INTERVIEW_SIM_REPL_AUTO_TURNS, 6)
//
// App / Electron noise goes to traces/sd-interview-sim/repl-*.log (not the TTY).
// Non-interactive batch stays on: npm run sd-interview-sim:t2

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const readline = require('node:readline');
const { Writable } = require('node:stream');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const repoRoot = path.resolve(__dirname, '..');

try {
  require('dotenv').config({ path: path.join(repoRoot, '.env') });
} catch {
  /* optional */
}

const {
  createStubInterviewerAgent,
  createLiveInterviewerAgent,
  createThinCandidateAgent,
  DEFAULT_INTERVIEWER_MODEL,
  DEFAULT_SUT_MODEL,
  resolveCorpusDir,
  writeCorpusBundle,
} = require('./lib/sd-interview-sim');
const {
  FULL_RAW_SD_TONE_INSTRUCTION,
} = require('./lib/sd-interview-sim/liveSut');
const { createReplSession } = require('./lib/sd-interview-sim/replSession');
const { bootLiveSut } = require('./lib/sd-interview-sim/bootLiveSut');
const { installReplQuietConsole } = require('./lib/sd-interview-sim/replQuietConsole');
const { createReplUi, formatDuration, formatSpend } = require('./lib/sd-interview-sim/replUi');
const { resolveGeminiApiKey } = require('./lib/sd-grounding-harness.js');

const COMMANDS = [
  ['/mode interviewer', 'you ask the questions; Natively answers (default)'],
  ['/mode candidate', 'you answer; interviewer agent replies'],
  ['/mode auto [n]', 'hands-free run: interviewer agent vs Natively, you watch'],
  ['/run [n]', 'same as /mode auto — Ctrl+C stops it'],
  ['/auto on|off', 'auto interviewer reply after your candidate turns'],
  ['/open', 'let the interviewer open the interview'],
  ['/save', 'write a transcript snapshot, keep going'],
  ['/quit', 'end session and export transcript'],
  ['/help', 'show this list'],
];

function envInt(name, fallback) {
  const raw = (process.env[name] || '').trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function isElectronRuntime() {
  return Boolean(process.versions && process.versions.electron);
}

function maybeReexecUnderElectron(forceStub, wantLiveSut) {
  if (forceStub || !wantLiveSut) return false;
  if (isElectronRuntime()) return false;

  const electronBin = path.join(repoRoot, 'node_modules', '.bin', 'electron');
  if (!fs.existsSync(electronBin)) {
    console.error(
      '[sd-interview-sim-repl] FATAL — live SUT needs Electron. Run: npm run build:electron',
    );
    process.exit(2);
  }

  console.log('[sd-interview-sim-repl] re-exec under Electron for live SUT…');
  const result = spawnSync(
    electronBin,
    [path.join(__dirname, 'sd-interview-sim-repl.js'), ...process.argv.slice(2)],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        NATIVELY_E2E: process.env.NATIVELY_E2E || '1',
        NATIVELY_HEADLESS: process.env.NATIVELY_HEADLESS || '1',
      },
      cwd: repoRoot,
    },
  );
  process.exit(typeof result.status === 'number' ? result.status : 2);
}

function createEchoStubSut() {
  return async function stubSut(ctx) {
    const q = ctx.interviewerTurn?.text || '';
    return {
      text: `[sut-stub] Acknowledged: ${String(q).slice(0, 200)}`,
      spend: { input_tokens: 0, output_tokens: 20, estimated_usd: 0 },
    };
  };
}

function printBanner(ui, session, meta) {
  ui.banner({
    title: 'SD Interview Sim',
    prompt: meta.prompt,
    rows: [
      ['mode', `${session.getMode()}  ${ui.paint(`(auto ${session.getAutoInterviewer() ? 'on' : 'off'})`, 'gray')}`],
      ['candidate', meta.sutLabel],
      ['interviewer', meta.interviewerLabel],
      ['transcript', meta.corpusDir],
      ['app log', meta.logPath],
    ],
  });
  ui.notice('/help for commands · everything you type is spoken in-character');
}

/**
 * Render only the turns the user did NOT type — their own line is already on
 * screen. Piped (non-TTY) runs echo both sides so the log reads as a transcript.
 */
function renderTurn(ui, out, opts = {}) {
  const echoHuman = Boolean(opts.echoHuman);
  // In an auto run both sides are agents, so nothing on screen came from a human.
  const agentDriven = Boolean(out.opened || opts.auto);
  const humanRole = agentDriven
    ? null
    : out.sequence === 'candidate-then-interviewer'
      ? 'candidate'
      : 'interviewer';

  const meta = [];
  if (opts.durationMs != null) meta.push(formatDuration(opts.durationMs));
  const spendLabel = formatSpend(opts.spend);
  if (spendLabel) meta.push(spendLabel);
  const metaText = meta.join(' · ');

  if (out.sequence === 'candidate-then-interviewer') {
    if (echoHuman && out.assistant?.text) {
      ui.message('you', out.assistant.text, { subject: 'You (candidate)' });
    }
    if (out.interviewer?.text) {
      ui.message('interviewer', out.interviewer.text, { meta: metaText });
    }
    return;
  }

  if (echoHuman && humanRole === 'interviewer' && out.interviewer?.text) {
    ui.message('you', out.interviewer.text, { subject: 'You (interviewer)' });
  }
  if (agentDriven && out.interviewer?.text) {
    ui.message('interviewer', out.interviewer.text, { meta: metaText });
  }
  if (out.assistant?.text) {
    ui.message('candidate', out.assistant.text, {
      subject: 'Natively',
      meta: metaText,
    });
  }
}

function thinkingLabel(session) {
  return session.getMode() === 'candidate'
    ? 'interviewer is thinking…'
    : 'Natively is answering…';
}

async function main() {
  const forceStub = process.env.SD_INTERVIEW_SIM_REPL_STUB === '1';
  const hasKey = Boolean(resolveGeminiApiKey(process.env));
  const live = !forceStub && hasKey;
  const wantLiveSut = live && process.env.SD_INTERVIEW_SIM_REPL_LIVE_SUT !== '0';

  if (!live && !forceStub) {
    console.log(
      '[sd-interview-sim-repl] set GEMINI_API_KEY (or GOOGLE_API_KEY) for live, ' +
        'or SD_INTERVIEW_SIM_REPL_STUB=1 for $0 stub.',
    );
    process.exit(0);
  }

  maybeReexecUnderElectron(forceStub, wantLiveSut);

  const corpusDir = resolveCorpusDir({
    corpusDir: process.env.SD_INTERVIEW_SIM_CORPUS_DIR || undefined,
    repoRoot,
  });
  const runId = randomUUID();
  const logPath =
    (process.env.SD_INTERVIEW_SIM_REPL_LOG || '').trim() ||
    path.join(corpusDir, `repl-${runId}.log`);

  // Divert Electron / SUT console noise before boot; REPL UI uses say/write.
  const quiet = installReplQuietConsole({
    logPath,
    label: `[sd-interview-sim-repl] session start run_id=${runId}`,
  });
  const { say, write, restore } = quiet;
  const ui = createReplUi({
    say,
    write,
    isTTY: Boolean(process.stdout.isTTY || process.stdin.isTTY),
  });

  const interviewerModel =
    (process.env.SD_INTERVIEW_SIM_REPL_INTERVIEWER_MODEL || '').trim() ||
    (process.env.SD_INTERVIEW_SIM_T2_INTERVIEWER_MODEL || '').trim() ||
    DEFAULT_INTERVIEWER_MODEL;
  const sutModel =
    (process.env.SD_INTERVIEW_SIM_REPL_SUT_MODEL || '').trim() ||
    (process.env.SD_INTERVIEW_SIM_T2_SUT_MODEL || '').trim() ||
    DEFAULT_SUT_MODEL;
  const fullRaw =
    process.env.SD_INTERVIEW_SIM_REPL_FULL_RAW === '1' ||
    process.env.SD_INTERVIEW_SIM_T2_FULL_RAW === '1';
  const prompt =
    (process.env.SD_INTERVIEW_SIM_REPL_PROMPT || '').trim() ||
    (process.env.SD_INTERVIEW_SIM_T2_PROMPT || '').trim() ||
    'Design a URL shortener like Bitly.';
  const startMode =
    (process.env.SD_INTERVIEW_SIM_REPL_MODE || '').trim() === 'candidate'
      ? 'candidate'
      : 'interviewer';

  const models = { interviewer: interviewerModel, sut: sutModel };
  let liveBoot = null;
  let sut = createEchoStubSut();
  let sessionTracker = null;
  let candidateAgent = createThinCandidateAgent();

  try {
    if (wantLiveSut) {
      const bootSpin = ui.spinner('booting Natively (headless)…');
      liveBoot = await bootLiveSut({
        repoRoot,
        models,
        sutOpts: {
          ...(fullRaw ? { promptInstruction: FULL_RAW_SD_TONE_INSTRUCTION } : {}),
          sdProblemKey: prompt,
        },
        timeoutMs: envInt('SD_INTERVIEW_SIM_REPL_SUT_TIMEOUT_MS', 90_000),
        userDataPrefix: 'natively-sd-interview-sim-repl-',
        modeName: 'SD Interview Sim REPL',
        logPrefix: '[sd-interview-sim-repl]',
      });
      const bootMs = bootSpin.stop();
      sut = liveBoot.sut;
      sessionTracker = liveBoot.sessionTracker;
      candidateAgent = createThinCandidateAgent({
        getGateStatus: () =>
          liveBoot.intelligenceManager.getSdRequirementsGateStatus?.() ?? null,
      });
      ui.success(`Natively ready in ${formatDuration(bootMs)}`);
    }

    const interviewerAgent = live
      ? createLiveInterviewerAgent({
          model: interviewerModel,
          ...(fullRaw ? { fullRaw: true } : {}),
        })
      : createStubInterviewerAgent([
          { text: `${prompt}\n\nPlease lead with Requirements when you are ready.` },
          { text: 'What is peak QPS?', end_interview: false },
          { text: 'Thanks — wrapping up.\nEND_INTERVIEW', end_interview: true },
        ]);

    const session = createReplSession({
      scenario: { id: 'repl', prompt },
      sut,
      interviewerAgent,
      candidateAgent,
      sessionTracker,
      mode: startMode,
      models,
      provenance: { tier: 'REPL', git_sha: 'repl', run_id: runId },
    });

    printBanner(ui, session, {
      prompt,
      logPath,
      corpusDir,
      sutLabel: wantLiveSut ? `live WTA · ${sutModel}` : 'echo stub',
      interviewerLabel: live ? `live · ${interviewerModel}` : 'scripted stub',
    });

    // readline must use the real TTY, not the diverted process.stdout.
    const ttyOut = new Writable({
      write(chunk, _enc, cb) {
        write(String(chunk));
        cb();
      },
    });
    Object.defineProperty(ttyOut, 'isTTY', {
      get: () => Boolean(process.stdin.isTTY),
    });

    const interactive = Boolean(process.stdin.isTTY);
    const rl = readline.createInterface({
      input: process.stdin,
      output: ttyOut,
      terminal: interactive,
      historySize: 200,
    });

    const refreshPrompt = () => {
      if (!interactive) return;
      rl.setPrompt(ui.promptText(session.getMode()));
      rl.prompt();
    };

    const spendDelta = (before, after) => ({
      input_tokens: after.input_tokens - before.input_tokens,
      output_tokens: after.output_tokens - before.output_tokens,
      estimated_usd: after.estimated_usd - before.estimated_usd,
    });

    let autoRunning = false;
    let autoAbort = false;

    /**
     * Hands-free run: interviewer agent probes, Natively answers, repeat.
     * The user only watches; Ctrl+C stops after the in-flight turn.
     */
    async function runAuto(requestedTurns) {
      const maxTurns =
        requestedTurns || envInt('SD_INTERVIEW_SIM_REPL_AUTO_TURNS', 6);
      ui.blank();
      ui.notice(
        `auto run · up to ${maxTurns} exchanges · Ctrl+C to stop and take over`,
      );

      autoRunning = true;
      autoAbort = false;
      let done = 0;
      let stopReason = 'turn limit reached';
      try {
        for (let i = 1; i <= maxTurns; i += 1) {
          const spin = ui.spinner(
            `auto ${i}/${maxTurns} · interviewer is thinking…`,
          );
          const before = session.getSpend();
          let out;
          try {
            out = await session.autoTurn((phase) =>
              spin.setLabel?.(
                phase === 'sut'
                  ? `auto ${i}/${maxTurns} · Natively is answering…`
                  : `auto ${i}/${maxTurns} · interviewer is thinking…`,
              ),
            );
          } catch (err) {
            spin.stop();
            ui.error(err?.message || String(err));
            stopReason = 'error';
            break;
          }
          const durationMs = spin.stop();

          if (out.type !== 'turn') {
            ui.error(out.message || 'auto run could not continue');
            stopReason = 'error';
            break;
          }

          renderTurn(ui, out, {
            auto: true,
            durationMs,
            spend: spendDelta(before, session.getSpend()),
          });
          done += 1;

          if (out.assistant?.error) {
            stopReason = 'Natively errored';
            break;
          }
          if (out.end_interview) {
            stopReason = 'interviewer ended the interview';
            break;
          }
          if (autoAbort) {
            stopReason = 'you stopped it';
            break;
          }
        }
      } finally {
        autoRunning = false;
      }

      ui.blank();
      ui.notice(
        `auto run finished · ${done} exchange${done === 1 ? '' : 's'} · ${stopReason} · you are the ${session.getMode()} again`,
      );
    }

    // First Ctrl+C warns, second exits — matches the muscle memory from other CLIs.
    let sigintArmed = false;
    rl.on('SIGINT', () => {
      if (autoRunning) {
        autoAbort = true;
        ui.blank();
        ui.notice('stopping after this exchange…');
        return;
      }
      if (sigintArmed) {
        ui.blank();
        ui.notice('interrupted — transcript not exported (use /quit to export)');
        rl.close();
        return;
      }
      sigintArmed = true;
      ui.blank();
      ui.notice('press Ctrl+C again to exit, or type /quit to export the transcript');
      refreshPrompt();
      setTimeout(() => {
        sigintArmed = false;
      }, 3000).unref?.();
    });

    let exitCode = 0;
    try {
      refreshPrompt();
      for await (const line of rl) {
        const isCommand = String(line).trim().startsWith('/');
        const spin = isCommand ? null : ui.spinner(thinkingLabel(session));
        let out;
        let durationMs = 0;
        const before = session.getSpend();
        try {
          out = await session.handleLine(line);
        } catch (err) {
          if (spin) spin.stop();
          ui.error(err?.message || String(err));
          refreshPrompt();
          continue;
        }
        if (spin) durationMs = spin.stop();

        if (out.type === 'empty') {
          refreshPrompt();
          continue;
        }
        if (out.type === 'help') {
          ui.help(COMMANDS);
          refreshPrompt();
          continue;
        }
        if (out.type === 'error') {
          ui.error(out.message);
          refreshPrompt();
          continue;
        }
        if (out.type === 'mode') {
          ui.notice(
            out.mode === 'candidate'
              ? 'you are the candidate now — the interviewer agent replies to you'
              : 'you are the interviewer now — Natively answers as the candidate',
          );
          refreshPrompt();
          continue;
        }
        if (out.type === 'autoRun') {
          await runAuto(out.turns);
          refreshPrompt();
          continue;
        }
        if (out.type === 'auto') {
          ui.notice(
            out.on
              ? 'auto interviewer on — it replies after each candidate turn'
              : 'auto interviewer off — your candidate turns stand alone',
          );
          refreshPrompt();
          continue;
        }
        if (out.type === 'save' || out.type === 'quit') {
          const written = writeCorpusBundle(out.bundle, {
            corpusDir,
            filename: `repl-${out.bundle.run_id}.json`,
          });
          ui.blank();
          ui.success(
            `${out.bundle.turns.length} turns saved · ${written.path}`,
          );
          const totalSpend = formatSpend(out.outcome?.spend);
          if (totalSpend) ui.notice(`session spend: ${totalSpend}`);
          if (out.type === 'quit') {
            ui.notice(`app log: ${logPath}`);
            break;
          }
          refreshPrompt();
          continue;
        }
        if (out.type === 'turn') {
          renderTurn(ui, out, {
            echoHuman: !interactive,
            durationMs,
            spend: spendDelta(before, session.getSpend()),
          });
          if (out.end_interview) {
            ui.blank();
            ui.warn('interviewer signaled the end — /quit to export, or keep talking');
          }
        }
        refreshPrompt();
      }
    } catch (err) {
      ui.error(`fatal: ${err?.message || err}`);
      exitCode = 1;
    } finally {
      rl.close();
      if (liveBoot?.app && typeof liveBoot.app.quit === 'function') {
        try {
          liveBoot.app.quit();
        } catch {
          /* ignore */
        }
      }
      restore();
    }

    process.exit(exitCode);
  } catch (err) {
    ui.error(`fatal: ${err?.message || err}`);
    ui.notice(`details in ${logPath}`);
    restore();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
