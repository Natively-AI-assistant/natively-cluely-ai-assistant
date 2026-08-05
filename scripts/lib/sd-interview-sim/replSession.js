// scripts/lib/sd-interview-sim/replSession.js
//
// Dual-role interactive REPL session (no Electron).
// - interviewer (default): you type probe → inject → SUT/WTA answers
// - candidate: you type answer → inject as assistant (skip WTA) → optional
//   auto interviewer-agent reply (reuse createLiveInterviewerAgent / stub)
//
// Ghost WTA drafts are intentionally out of v1.

'use strict';

const {
  createRun,
  appendTurn,
  recordSpend,
  finalize,
} = require('./index');
const { injectSpeech } = require('./runner');
const {
  createThinCandidateAgent,
  extractMermaidAttachments,
  DEFAULT_INTERVIEWER_MODEL,
  DEFAULT_SUT_MODEL,
} = require('./t2');

/**
 * @param {string} line
 * @returns {null | { type: string, mode?: string, on?: boolean, message?: string }}
 */
function parseReplCommand(line) {
  const raw = String(line || '').trim();
  if (!raw) return null;

  // Bare quit/exit/help without slash — common CLI habit.
  const lower = raw.toLowerCase();
  if (lower === 'quit' || lower === 'exit') return { type: 'quit' };
  if (lower === 'help') return { type: 'help' };

  if (!raw.startsWith('/')) return null;
  const parts = raw.slice(1).split(/\s+/).filter(Boolean);
  const cmd = (parts[0] || '').toLowerCase();
  const arg = (parts[1] || '').toLowerCase();

  const turnsArg = (raw) => {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  if (cmd === 'quit' || cmd === 'exit' || cmd === 'q') return { type: 'quit' };
  if (cmd === 'help' || cmd === 'h' || cmd === '?') return { type: 'help' };
  if (cmd === 'save') return { type: 'save' };
  if (cmd === 'run') return { type: 'autoRun', turns: turnsArg(parts[1]) };
  if (cmd === 'mode') {
    if (arg === 'candidate' || arg === 'c' || arg === 'cand') {
      return { type: 'mode', mode: 'candidate' };
    }
    if (arg === 'interviewer' || arg === 'i' || arg === 'int') {
      return { type: 'mode', mode: 'interviewer' };
    }
    if (arg === 'auto' || arg === 'a') {
      return { type: 'autoRun', turns: turnsArg(parts[2]) };
    }
    return { type: 'error', message: 'usage: /mode interviewer|candidate|auto' };
  }
  if (cmd === 'auto') {
    if (arg === 'on' || arg === '1' || arg === 'true') return { type: 'auto', on: true };
    if (arg === 'off' || arg === '0' || arg === 'false') return { type: 'auto', on: false };
    return { type: 'error', message: 'usage: /auto on|off' };
  }
  if (cmd === 'open') return { type: 'open' };
  return { type: 'error', message: `unknown command: /${cmd} (try /help)` };
}

const HELP_TEXT = [
  'Commands:',
  '  /mode interviewer   you type probes; Natively (SUT) answers  [default]',
  '  /mode candidate     you type answers; skips WTA; auto interviewer next',
  '  /mode auto [n]      hands-free: interviewer-agent ↔ Natively, you just watch',
  '  /run [n]              same as /mode auto (ctrl-c stops the run)',
  '  /auto on|off          after candidate turns, run interviewer-agent (default on)',
  '  /open                 ask interviewer-agent to open (no WTA)',
  '  /save                 finalize + return bundle snapshot',
  '  /quit                 end session',
  '  /help',
].join('\n');

/**
 * @param {{
 *   scenario?: { id?: string, prompt?: string },
 *   sut: (ctx: object) => Promise<object> | object,
 *   interviewerAgent: (ctx: object) => Promise<object> | object,
 *   candidateAgent?: (ctx: object) => Promise<object> | object,
 *   sessionTracker?: { addTranscript?: Function } | null,
 *   inject?: typeof injectSpeech,
 *   mode?: 'interviewer' | 'candidate',
 *   autoInterviewer?: boolean,
 *   provenance?: object,
 *   models?: { interviewer?: string, sut?: string },
 * }} opts
 */
function createReplSession(opts = {}) {
  if (typeof opts.sut !== 'function') {
    throw new Error('createReplSession requires sut');
  }
  if (typeof opts.interviewerAgent !== 'function') {
    throw new Error('createReplSession requires interviewerAgent');
  }

  const scenario = opts.scenario || {};
  const inject = opts.inject || injectSpeech;
  const sessionTracker = opts.sessionTracker || null;
  const candidateAgent = opts.candidateAgent || createThinCandidateAgent();
  const models = opts.models || {};

  let mode = opts.mode === 'candidate' ? 'candidate' : 'interviewer';
  let autoInterviewer = opts.autoInterviewer !== false;
  let ended = false;

  const run = createRun({
    provenance: {
      ...(opts.provenance || {}),
      tier: (opts.provenance && opts.provenance.tier) || 'REPL',
      models: {
        interviewer: models.interviewer || DEFAULT_INTERVIEWER_MODEL,
        sut: models.sut || DEFAULT_SUT_MODEL,
        ...((opts.provenance && opts.provenance.models) || {}),
      },
    },
  });

  const injectLog = [];

  function doInject(turn) {
    return inject(sessionTracker, [turn], {
      baseTs: Date.now() + run.spend.turn_count * 1000,
      onSegment: (seg) => injectLog.push(seg),
    });
  }

  function normalizeProbe(probeRaw) {
    const probe =
      probeRaw && typeof probeRaw === 'object'
        ? probeRaw
        : { text: String(probeRaw ?? '') };
    let attachments = Array.isArray(probe.attachments) ? [...probe.attachments] : [];
    if (attachments.length === 0) {
      attachments = extractMermaidAttachments(probe.text || '');
    }
    return {
      role: 'interviewer',
      text: probe.text ?? '',
      attachments,
      end_interview: probe.end_interview === true,
      hand_back: probe.hand_back === true,
      spend: probe.spend,
    };
  }

  async function runInterviewerAgent() {
    const probeCtx = {
      scenario,
      bundle: run.bundle,
      turnCount: run.spend.turn_count,
      injectLog: [...injectLog],
      spend: { ...run.spend },
    };
    return normalizeProbe(await Promise.resolve(opts.interviewerAgent(probeCtx)));
  }

  async function interviewerTurnThenSut(interviewerTurn, onPhase) {
    if (onPhase) onPhase('sut');
    const injected = doInject(interviewerTurn);
    appendTurn(run, {
      role: 'interviewer',
      text: interviewerTurn.text,
      attachments: interviewerTurn.attachments,
    });
    if (interviewerTurn.spend) recordSpend(run, interviewerTurn.spend);

    const decision = await Promise.resolve(
      candidateAgent({
        scenario,
        interviewerTurn,
        injectLog: [...injectLog],
        injected,
        bundle: run.bundle,
        turnCount: run.spend.turn_count,
      }),
    );
    const action =
      decision && typeof decision === 'object' ? decision.action || 'trigger' : 'trigger';

    let answer;
    try {
      answer = await Promise.resolve(
        opts.sut({
          scenario,
          interviewerTurn,
          injectLog: [...injectLog],
          injected,
          bundle: run.bundle,
          turnCount: run.spend.turn_count,
          candidateAction: action,
        }),
      );
    } catch (err) {
      const text = `[sut-error] ${err?.message || String(err)}`.slice(0, 2000);
      appendTurn(run, { role: 'assistant', text, attachments: [] });
      return {
        type: 'turn',
        sequence: 'interviewer-then-candidate',
        interviewer: interviewerTurn,
        assistant: { text, error: true },
        end_interview: interviewerTurn.end_interview,
      };
    }

    const answerObj =
      answer && typeof answer === 'object' ? answer : { text: String(answer ?? '') };
    // Live SUT already wrote assistant speech via WTA; still inject for stub/session parity.
    doInject({
      role: 'assistant',
      text: answerObj.text ?? '',
      speaker: 'assistant',
    });
    appendTurn(run, {
      role: 'assistant',
      text: answerObj.text ?? '',
      attachments: answerObj.attachments || [],
    });
    if (answerObj.spend) recordSpend(run, answerObj.spend);

    return {
      type: 'turn',
      sequence: 'interviewer-then-candidate',
      interviewer: interviewerTurn,
      assistant: answerObj,
      end_interview: interviewerTurn.end_interview === true,
    };
  }

  async function candidateTurnThenMaybeAuto(text) {
    const assistantTurn = {
      role: 'assistant',
      text: String(text || ''),
      attachments: [],
    };
    doInject({ ...assistantTurn, speaker: 'assistant' });
    appendTurn(run, assistantTurn);

    if (!autoInterviewer) {
      return {
        type: 'turn',
        sequence: 'candidate-then-interviewer',
        assistant: assistantTurn,
        interviewer: null,
      };
    }

    const interviewerTurn = await runInterviewerAgent();
    doInject(interviewerTurn);
    appendTurn(run, {
      role: 'interviewer',
      text: interviewerTurn.text,
      attachments: interviewerTurn.attachments,
    });
    if (interviewerTurn.spend) recordSpend(run, interviewerTurn.spend);

    return {
      type: 'turn',
      sequence: 'candidate-then-interviewer',
      assistant: assistantTurn,
      interviewer: interviewerTurn,
      end_interview: interviewerTurn.end_interview === true,
    };
  }

  return {
    getMode() {
      return mode;
    },
    getAutoInterviewer() {
      return autoInterviewer;
    },
    getBundle() {
      return run.bundle;
    },
    getSpend() {
      return { ...run.spend };
    },
    isEnded() {
      return ended;
    },
    /**
     * One hands-free exchange: interviewer-agent probes, Natively (SUT) answers.
     * Caller owns the loop so it can stream output and honour ctrl-c.
     */
    async autoTurn(onPhase) {
      if (ended) {
        return { type: 'error', message: 'session already ended' };
      }
      if (onPhase) onPhase('interviewer');
      const interviewerTurn = await runInterviewerAgent();
      return interviewerTurnThenSut(interviewerTurn, onPhase);
    },
    helpText() {
      return HELP_TEXT;
    },
    /**
     * @param {string} line
     */
    async handleLine(line) {
      if (ended) {
        return { type: 'error', message: 'session already ended — call createReplSession again' };
      }

      const cmd = parseReplCommand(line);
      if (cmd) {
        if (cmd.type === 'error') return cmd;
        if (cmd.type === 'help') return { type: 'help', text: HELP_TEXT };
        if (cmd.type === 'quit') {
          ended = true;
          return { type: 'quit', ...finalize(run, { end_reason: 'user_quit' }) };
        }
        if (cmd.type === 'save') {
          // Snapshot only — keep session open for more turns.
          const spend = { ...run.spend };
          const bundle = {
            schema_version: run.bundle.schema_version,
            run_id: run.bundle.run_id,
            provenance: { ...run.bundle.provenance },
            turns: run.bundle.turns.map((t) => ({
              ...t,
              attachments: (t.attachments || []).map((a) => ({ ...a })),
            })),
            side_channels: run.bundle.side_channels.map((sc) => ({ ...sc })),
            outcome: { end_reason: 'user_save', spend: { ...spend } },
          };
          return { type: 'save', bundle, outcome: bundle.outcome };
        }
        if (cmd.type === 'mode') {
          mode = cmd.mode;
          return { type: 'mode', mode };
        }
        if (cmd.type === 'autoRun') {
          return { type: 'autoRun', turns: cmd.turns ?? null };
        }
        if (cmd.type === 'auto') {
          autoInterviewer = cmd.on;
          return { type: 'auto', on: autoInterviewer };
        }
        if (cmd.type === 'open') {
          const interviewerTurn = await runInterviewerAgent();
          // Opening probe only — do not auto-WTA (user may answer as candidate).
          doInject(interviewerTurn);
          appendTurn(run, {
            role: 'interviewer',
            text: interviewerTurn.text,
            attachments: interviewerTurn.attachments,
          });
          if (interviewerTurn.spend) recordSpend(run, interviewerTurn.spend);
          return {
            type: 'turn',
            interviewer: interviewerTurn,
            assistant: null,
            end_interview: interviewerTurn.end_interview === true,
            opened: true,
          };
        }
      }

      const text = String(line || '').trim();
      if (!text) return { type: 'empty' };

      if (mode === 'candidate') {
        return candidateTurnThenMaybeAuto(text);
      }

      const interviewerTurn = normalizeProbe({ text });
      return interviewerTurnThenSut(interviewerTurn);
    },
  };
}

module.exports = {
  parseReplCommand,
  createReplSession,
  HELP_TEXT,
};
