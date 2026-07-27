// scripts/lib/sd-interview-sim/runner.js
//
// SdInterviewSimRunner — fixture interviewer + stub SUT turn protocol (T0/eval).
// No live interviewer-agent, no live Gemini.

'use strict';

const {
  createRun,
  appendTurn,
  recordSpend,
  budgetExceeded,
  finalize,
} = require('./index');

/**
 * Map fixture/role dialect → SessionTracker inject speaker
 * (same rules as sd-requirements-gate-harness injectTranscriptTurns).
 *
 * @param {{ role?: string, speaker?: string, text?: string }} turn
 * @param {number} timestamp
 */
function toInjectSegment(turn, timestamp = Date.now()) {
  const speaker =
    turn.speaker ||
    (turn.role === 'user' ? 'user' : turn.role === 'assistant' ? 'assistant' : 'system');
  return {
    speaker,
    text: String(turn.text || ''),
    timestamp,
    final: true,
  };
}

/**
 * Harness-equivalent inject: SessionTracker addTranscript when present,
 * otherwise record segments via onSegment / return value (Tier0 path).
 *
 * @param {{ addTranscript?: Function } | null | undefined} sessionTracker
 * @param {Array<{ role?: string, speaker?: string, text?: string }>} turns
 * @param {{ baseTs?: number, onSegment?: (seg: object) => void }} [opts]
 */
function injectSpeech(sessionTracker, turns, opts = {}) {
  const baseTs = opts.baseTs != null ? opts.baseTs : Date.now();
  const injected = [];
  let i = 0;
  for (const turn of turns || []) {
    const segment = toInjectSegment(turn, baseTs + i * 1000);
    let result = null;
    if (sessionTracker && typeof sessionTracker.addTranscript === 'function') {
      result = sessionTracker.addTranscript(segment);
    }
    if (typeof opts.onSegment === 'function') {
      opts.onSegment(segment);
    }
    injected.push({ segment, result, role: result?.role || null });
    i += 1;
  }
  return injected;
}

function isInterviewerTurn(turn) {
  if (!turn) return false;
  if (turn.role === 'interviewer') return true;
  if (turn.role == null && (turn.speaker === 'system' || turn.speaker === 'interviewer')) {
    return true;
  }
  return false;
}

function resolveEndReasonAfterBudget(run) {
  const { budgets, spend } = run;
  const turnCap =
    budgets.maxTurns != null && spend.turn_count >= budgets.maxTurns;
  const spendCap =
    (budgets.maxInputTokens != null && spend.input_tokens >= budgets.maxInputTokens) ||
    (budgets.maxOutputTokens != null && spend.output_tokens >= budgets.maxOutputTokens) ||
    (budgets.maxEstimatedUsd != null && spend.estimated_usd >= budgets.maxEstimatedUsd);
  if (turnCap && !spendCap) return 'max_turns';
  if (spendCap) return 'budget_hit';
  if (turnCap) return 'max_turns';
  return 'budget_hit';
}

/**
 * Primary seam: fixture interviewer scenario + injectable SUT stub.
 *
 * Turn protocol: interviewer → inject → SUT stub → capture → optional continue.
 *
 * @param {{
 *   scenario: { id?: string, turns?: Array<object> },
 *   sut: (ctx: object) => ({ text?: string, attachments?: Array, spend?: object, continue?: boolean, continueText?: string } | Promise<...>),
 *   budgets?: object,
 *   provenance?: object,
 *   maxTurns?: number,
 *   continueAfterAnswer?: boolean,
 *   sessionTracker?: { addTranscript?: Function },
 *   onInject?: (segment: object) => void,
 *   inject?: typeof injectSpeech,
 * }} config
 */
class SdInterviewSimRunner {
  constructor(config = {}) {
    this.config = config;
  }

  /**
   * @returns {Promise<{ bundle: object, outcome: object }>}
   */
  async run() {
    const {
      scenario = {},
      sut,
      budgets = {},
      provenance = {},
      maxTurns,
      continueAfterAnswer = false,
      sessionTracker = null,
      onInject,
      inject = injectSpeech,
    } = this.config;

    if (typeof sut !== 'function') {
      throw new Error('SdInterviewSimRunner requires an injectable sut function');
    }

    const run = createRun({
      provenance: {
        ...provenance,
        tier: provenance.tier || 'T0',
        models: {
          interviewer: 'fixture',
          sut: 'stub',
          ...(provenance.models || {}),
        },
      },
      budgets,
    });

    const fixtureTurns = (scenario.turns || []).filter(isInterviewerTurn);
    let end_reason = 'scenario_stop';
    const injectLog = [];

    for (const interviewerTurn of fixtureTurns) {
      if (maxTurns != null && run.spend.turn_count >= maxTurns) {
        end_reason = 'max_turns';
        break;
      }

      const injected = inject(sessionTracker, [interviewerTurn], {
        baseTs: Date.now() + run.spend.turn_count * 1000,
        onSegment: (seg) => {
          injectLog.push(seg);
          if (typeof onInject === 'function') onInject(seg);
        },
      });

      appendTurn(run, {
        role: 'interviewer',
        text: interviewerTurn.text ?? '',
        attachments: interviewerTurn.attachments || [],
      });

      if (maxTurns != null && run.spend.turn_count >= maxTurns) {
        end_reason = 'max_turns';
        break;
      }
      if (budgetExceeded(run)) {
        end_reason = resolveEndReasonAfterBudget(run);
        break;
      }

      const answer = await Promise.resolve(
        sut({
          scenario,
          interviewerTurn,
          injectLog: [...injectLog],
          injected,
          bundle: run.bundle,
          turnCount: run.spend.turn_count,
        }),
      );

      const answerObj = answer && typeof answer === 'object' ? answer : { text: String(answer ?? '') };

      appendTurn(run, {
        role: 'assistant',
        text: answerObj.text ?? '',
        attachments: answerObj.attachments || [],
      });

      if (answerObj.spend) {
        recordSpend(run, answerObj.spend);
      }

      const shouldContinue =
        continueAfterAnswer ||
        interviewerTurn.continue === true ||
        answerObj.continue === true;

      if (shouldContinue) {
        if (maxTurns != null && run.spend.turn_count >= maxTurns) {
          end_reason = 'max_turns';
          break;
        }
        appendTurn(run, {
          role: 'user_driver',
          text: answerObj.continueText || interviewerTurn.continueText || 'continue',
        });
      }

      if (interviewerTurn.stop === true || interviewerTurn.end_interview === true) {
        end_reason = 'scenario_stop';
        break;
      }

      if (maxTurns != null && run.spend.turn_count >= maxTurns) {
        end_reason = 'max_turns';
        break;
      }
      if (budgetExceeded(run)) {
        end_reason = resolveEndReasonAfterBudget(run);
        break;
      }
    }

    return finalize(run, { end_reason });
  }
}

module.exports = {
  SdInterviewSimRunner,
  injectSpeech,
  toInjectSegment,
};
