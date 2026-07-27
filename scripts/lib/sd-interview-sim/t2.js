// scripts/lib/sd-interview-sim/t2.js
//
// T2 dual-agent overnight path (ticket 05).
// - Interviewer-agent: generates probes + optional mermaid (default Flash-Lite when live)
// - Thin candidate-agent: only triggers Natively SUT (never a second WTA brain)
// - Caps: max turns, max interviews/night, optional token/USD → budget_hit + still export
// - Opt-in: RUN_SD_INTERVIEW_SIM_T2=1 + Gemini key (mirrors shouldRunRealApi style)
// - Corpus = workflow debug fuel — no fine-tune / train-job hooks
//
// Prefer headless orchestration. Never on PR CI.

'use strict';

const fs = require('fs');
const path = require('path');
const { writeCorpusBundle } = require('./corpus');
const { checkMermaidSyntax } = require('./mermaid');
const { resolveGeminiApiKey } = require('../sd-grounding-harness.js');

/** Lazy helpers — avoid circular load with index.js ↔ runner.js ↔ t2.js. */
function bundleApi() {
  return require('./index');
}

function defaultInjectSpeech(...args) {
  return require('./runner').injectSpeech(...args);
}
/** Default interviewer-agent model (cheap probes). */
const DEFAULT_INTERVIEWER_MODEL = 'gemini-3.1-flash-lite';

/** Default SUT / product model label (corpus provenance; not a second WTA). */
const DEFAULT_SUT_MODEL = 'gemini-3.5-flash';

/** Live T2 quality default turn budget (SPEC 08). Smoke demos may override lower. */
const DEFAULT_LIVE_MAX_TURNS = 32;

/**
 * True when interviewer text is a non-specific continue / hand-back cue
 * (candidate should resume the Delivery Framework showcase).
 * @param {string} text
 */
function isNonspecificInterviewerText(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (/\bHAND_BACK\b/.test(t)) return true;
  if (t.length > 160) return false;
  return /^(continue|go on|next|keep going|proceed|go ahead)\b/i.test(t)
    || /^(ok|okay|sure|yeah|yep)[,.]?\s*(continue|go on|next|keep going)?$/i.test(t)
    || /\b(please continue|back to you|go ahead and continue|carry on|resume)\b/i.test(t)
    || /^thanks?[^.!?]*[.!]?\s*(please\s+)?continue\b/i.test(t);
}

/**
 * Default interviewer policy for candidate-led T2 sims (SPEC 09).
 * Open once; thereafter clarifier OR hand-back OR END — never assign next DF section.
 */
const DEFAULT_INTERVIEWER_SYSTEM_PROMPT = [
  'You are a system-design interviewer in a **candidate-led** interview.',
  'If there is no candidate answer yet: open with the problem and invite the candidate to lead the hellointerview Delivery Framework showcase (Requirements → Core Entities → API → HLD → Deep Dives). Do NOT assign those sections as a step-by-step homework list.',
  'On later turns pick exactly one:',
  '(A) ONE short clarifier about something the candidate just claimed, then stop;',
  '(B) Hand the floor back with a brief line and the token HAND_BACK on its own line;',
  '(C) When the showcase is complete, a short closing and END_INTERVIEW on its own line.',
  'FORBIDDEN: telling the candidate which framework section to do next',
  '(e.g. "now define core entities", "let\'s move to the API", "please do the HLD", "deep dive on X next").',
  'Do not answer as the candidate. Optional fenced ```mermaid only when clarifying a design point.',
].join(' ');

/**
 * Opt-in gate for live T2 dual-agent runs.
 * Requires RUN_SD_INTERVIEW_SIM_T2=1 plus a Gemini/Google API key.
 * Does NOT honor RUN_SD_GROUNDING_E2E / RUN_NATIVELY_API_E2E alone —
 * dual-agent spend must be intentional.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function shouldRunT2DualAgent(env = process.env) {
  if (env.RUN_SD_INTERVIEW_SIM_T2 !== '1') return false;
  return Boolean(resolveGeminiApiKey(env));
}

function t2SkipMessage() {
  return (
    '[sd-interview-sim-t2] SKIP — set RUN_SD_INTERVIEW_SIM_T2=1 and GEMINI_API_KEY ' +
    '(overnight / workflow_dispatch only; never PR). Corpus is workflow debug fuel, not fine-tune.'
  );
}

/**
 * Pull fenced ```mermaid blocks into attachment objects.
 *
 * @param {string} text
 * @returns {Array<{ kind: 'mermaid', source: string, syntaxValid: boolean }>}
 */
function extractMermaidAttachments(text) {
  const src = String(text || '');
  const attachments = [];
  const re = /```mermaid\s*\n([\s\S]*?)```/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    const source = String(m[1] || '').trim();
    if (!source) continue;
    attachments.push({
      kind: 'mermaid',
      source,
      syntaxValid: checkMermaidSyntax(source),
    });
  }
  return attachments;
}

/**
 * Stub interviewer-agent: yields canned probes in order (T0/$0 path).
 *
 * @param {Array<object>} probes
 */
function createStubInterviewerAgent(probes = []) {
  let i = 0;
  return async function stubInterviewerAgent(_ctx) {
    if (i >= probes.length) {
      return { text: 'End of stub probes.', end_interview: true };
    }
    const probe = probes[i];
    i += 1;
    return { ...probe };
  };
}

/**
 * Thin candidate-agent: decides trigger / continue / advance only.
 * Never produces answer text — Natively remains the answer brain.
 *
 * Advance once when Requirements checklist is complete (gate still open).
 * Continue when interviewer turn is non-specific.
 *
 * @param {{
 *   onDecision?: (d: object) => void,
 *   getGateStatus?: () => { checklistComplete?: boolean, visible?: boolean } | null,
 * }} [opts]
 */
function createThinCandidateAgent(opts = {}) {
  let advancedOnce = false;
  return async function thinCandidateAgent(ctx) {
    const decision = { action: 'trigger' };
    const gate =
      (typeof opts.getGateStatus === 'function' ? opts.getGateStatus() : null) ||
      ctx?.gateStatus ||
      null;
    const probeText = String(ctx?.interviewerTurn?.text || '');

    if (
      !advancedOnce &&
      gate &&
      gate.checklistComplete === true &&
      gate.visible === true
    ) {
      advancedOnce = true;
      decision.action = 'advance';
    } else if (
      ctx?.interviewerTurn?.hand_back === true ||
      isNonspecificInterviewerText(probeText)
    ) {
      decision.action = 'continue';
    }

    if (typeof opts.onDecision === 'function') opts.onDecision(decision);
    return decision;
  };
}

/**
 * Persist nightly interview counts so maxInterviewsPerNight survives process restarts.
 */
class NightlyInterviewCap {
  /**
   * @param {{
   *   maxInterviewsPerNight?: number,
   *   stateDir?: string,
   *   stateFile?: string,
   *   now?: () => Date,
   * }} [opts]
   */
  constructor(opts = {}) {
    this.maxInterviewsPerNight =
      opts.maxInterviewsPerNight != null ? opts.maxInterviewsPerNight : 10;
    this.now = typeof opts.now === 'function' ? opts.now : () => new Date();
    this.stateFile =
      opts.stateFile ||
      path.join(opts.stateDir || process.cwd(), 'sd-interview-sim-t2-nightly.json');
  }

  _nightKey(d = this.now()) {
    // UTC calendar day — overnight jobs are schedule-oriented.
    return d.toISOString().slice(0, 10);
  }

  _load() {
    try {
      if (!fs.existsSync(this.stateFile)) return { night: this._nightKey(), count: 0 };
      const raw = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      const night = this._nightKey();
      if (raw?.night !== night) return { night, count: 0 };
      return { night, count: Number(raw.count) || 0 };
    } catch {
      return { night: this._nightKey(), count: 0 };
    }
  }

  _save(state) {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    fs.writeFileSync(this.stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }

  remaining() {
    const { count } = this._load();
    return Math.max(0, this.maxInterviewsPerNight - count);
  }

  canStart() {
    return this.remaining() > 0;
  }

  recordStart() {
    const state = this._load();
    state.count += 1;
    this._save(state);
    return state;
  }
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
 * Live interviewer-agent via Gemini generateContent (Flash-Lite by default).
 * Only constructed when callers opt in; unit tests use stubs.
 *
 * @param {{
 *   apiKey?: string,
 *   model?: string,
 *   systemPrompt?: string,
 *   fetchImpl?: typeof fetch,
 *   estimateUsdPer1kTokens?: number,
 * }} [opts]
 */
function createLiveInterviewerAgent(opts = {}) {
  const model = opts.model || DEFAULT_INTERVIEWER_MODEL;
  const apiKey = opts.apiKey || resolveGeminiApiKey();
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const systemPrompt = opts.systemPrompt || DEFAULT_INTERVIEWER_SYSTEM_PROMPT;
  const usdPer1k = opts.estimateUsdPer1kTokens != null ? opts.estimateUsdPer1kTokens : 0.0001;

  return async function liveInterviewerAgent(ctx) {
    if (!apiKey) {
      throw new Error('createLiveInterviewerAgent requires a Gemini API key');
    }
    if (typeof fetchImpl !== 'function') {
      throw new Error('createLiveInterviewerAgent requires fetch');
    }

    const history = (ctx.bundle?.turns || [])
      .map((t) => `${t.role}: ${t.text}`)
      .join('\n')
      .slice(-6000);
    const hasAssistant = (ctx.bundle?.turns || []).some((t) => t.role === 'assistant');
    const userText = [
      `Scenario: ${ctx.scenario?.prompt || ctx.scenario?.id || 'system design interview'}`,
      history ? `Transcript so far:\n${history}` : 'No turns yet.',
      hasAssistant
        ? 'Next interviewer move: clarifier OR HAND_BACK OR END_INTERVIEW. Do not assign the next Delivery Framework section.'
        : 'Open once: invite the candidate to lead the Delivery Framework showcase. Do not assign sections step-by-step.',
    ].join('\n\n');

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Gemini interviewer HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const text =
      data?.candidates?.[0]?.content?.parts?.map((p) => p?.text || '').join('') || '';
    const usage = data?.usageMetadata || {};
    const input_tokens = Number(usage.promptTokenCount) || 0;
    const output_tokens = Number(usage.candidatesTokenCount) || 0;
    const estimated_usd = ((input_tokens + output_tokens) / 1000) * usdPer1k;

    const end_interview = /\bEND_INTERVIEW\b/.test(text);
    const hand_back = /\bHAND_BACK\b/.test(text);
    const cleaned = text
      .replace(/\bEND_INTERVIEW\b/g, '')
      .replace(/\bHAND_BACK\b/g, '')
      .trim();
    const attachments = extractMermaidAttachments(cleaned);

    return {
      text: cleaned,
      attachments,
      end_interview,
      hand_back,
      spend: { input_tokens, output_tokens, estimated_usd },
    };
  };
}

/**
 * Headless T2 dual-agent interview loop.
 * Always finalizes (and optionally writes corpus) on any end including budget_hit.
 *
 * @param {{
 *   scenario?: { id?: string, prompt?: string },
 *   interviewerAgent: (ctx: object) => Promise<object> | object,
 *   candidateAgent?: (ctx: object) => Promise<object> | object,
 *   sut: (ctx: object) => Promise<object> | object,
 *   budgets?: object,
 *   maxTurns?: number,
 *   provenance?: object,
 *   models?: { interviewer?: string, sut?: string },
 *   sessionTracker?: { addTranscript?: Function },
 *   onInject?: (seg: object) => void,
 *   inject?: typeof injectSpeech,
 *   getSideChannelSnapshot?: Function,
 *   nightlyCap?: NightlyInterviewCap | null,
 *   corpusDir?: string,
 *   writeBundle?: boolean,
 * }} config
 * @returns {Promise<{ bundle: object, outcome: object, corpusPath?: string | null }>}
 */
async function runT2DualAgent(config = {}) {
  const {
    createRun,
    appendTurn,
    appendSideChannel,
    recordSpend,
    budgetExceeded,
    finalize,
  } = bundleApi();

  const {
    scenario = {},
    interviewerAgent,
    candidateAgent = createThinCandidateAgent(),
    sut,
    budgets = {},
    maxTurns,
    provenance = {},
    models = {},
    sessionTracker = null,
    onInject,
    inject = defaultInjectSpeech,
    getSideChannelSnapshot,
    nightlyCap = null,
    corpusDir,
    writeBundle = true,
  } = config;

  if (typeof interviewerAgent !== 'function') {
    throw new Error('runT2DualAgent requires interviewerAgent');
  }
  if (typeof sut !== 'function') {
    throw new Error('runT2DualAgent requires sut (Natively trigger target)');
  }

  const effectiveMaxTurns = maxTurns != null ? maxTurns : budgets.maxTurns;
  const runBudgets = { ...budgets };
  if (effectiveMaxTurns != null && runBudgets.maxTurns == null) {
    runBudgets.maxTurns = effectiveMaxTurns;
  }

  const run = createRun({
    provenance: {
      ...provenance,
      tier: provenance.tier || 'T2',
      models: {
        interviewer: models.interviewer || DEFAULT_INTERVIEWER_MODEL,
        sut: models.sut || DEFAULT_SUT_MODEL,
        ...(provenance.models || {}),
      },
    },
    budgets: runBudgets,
  });

  const maybeExport = (result) => {
    if (!writeBundle || !corpusDir) return { ...result, corpusPath: null };
    const written = writeCorpusBundle(result.bundle, {
      corpusDir,
      filename: `t2-${result.bundle.run_id}.json`,
    });
    return { ...result, corpusPath: written.path };
  };

  if (nightlyCap && !nightlyCap.canStart()) {
    return maybeExport(finalize(run, { end_reason: 'budget_hit' }));
  }
  if (nightlyCap) nightlyCap.recordStart();

  let end_reason = 'scenario_stop';
  const injectLog = [];
  // Safety bound so a buggy agent cannot loop forever even without maxTurns.
  const hardCap = effectiveMaxTurns != null ? effectiveMaxTurns * 2 + 8 : 64;

  for (let step = 0; step < hardCap; step += 1) {
    if (effectiveMaxTurns != null && run.spend.turn_count >= effectiveMaxTurns) {
      end_reason = 'max_turns';
      break;
    }
    if (budgetExceeded(run)) {
      end_reason = resolveEndReasonAfterBudget(run);
      break;
    }

    const probeCtx = {
      scenario,
      bundle: run.bundle,
      turnCount: run.spend.turn_count,
      injectLog: [...injectLog],
      spend: { ...run.spend },
    };
    const probeRaw = await Promise.resolve(interviewerAgent(probeCtx));
    const probe =
      probeRaw && typeof probeRaw === 'object'
        ? probeRaw
        : { text: String(probeRaw ?? '') };

    let attachments = Array.isArray(probe.attachments) ? [...probe.attachments] : [];
    if (attachments.length === 0) {
      attachments = extractMermaidAttachments(probe.text || '');
    }

    const interviewerTurn = {
      role: 'interviewer',
      text: probe.text ?? '',
      attachments,
      stop: probe.stop === true,
      end_interview: probe.end_interview === true,
      continue: probe.continue === true,
      continueText: probe.continueText,
    };

    const injected = inject(sessionTracker, [interviewerTurn], {
      baseTs: Date.now() + run.spend.turn_count * 1000,
      onSegment: (seg) => {
        injectLog.push(seg);
        if (typeof onInject === 'function') onInject(seg);
      },
    });

    appendTurn(run, {
      role: 'interviewer',
      text: interviewerTurn.text,
      attachments: interviewerTurn.attachments,
    });

    if (probe.spend) recordSpend(run, probe.spend);

    if (effectiveMaxTurns != null && run.spend.turn_count >= effectiveMaxTurns) {
      end_reason = 'max_turns';
      break;
    }
    if (budgetExceeded(run)) {
      end_reason = resolveEndReasonAfterBudget(run);
      break;
    }

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

    if (action === 'stop') {
      end_reason = 'scenario_stop';
      break;
    }

    // Thin candidate: trigger (or continue/advance) — SUT produces the answer.
    if (action === 'trigger' || action === 'continue' || action === 'advance') {
      let answer;
      try {
        answer = await Promise.resolve(
          sut({
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
        appendTurn(run, {
          role: 'assistant',
          text: `[sut-error] ${err?.message || String(err)}`.slice(0, 2000),
          attachments: [],
        });
        end_reason = 'error';
        break;
      }
      const answerObj =
        answer && typeof answer === 'object' ? answer : { text: String(answer ?? '') };

      appendTurn(run, {
        role: 'assistant',
        text: answerObj.text ?? '',
        attachments: answerObj.attachments || [],
      });

      if (answerObj.spend) recordSpend(run, answerObj.spend);

      const explicitSnapshot =
        answerObj.sideChannel ||
        answerObj.side_channel ||
        probe.sideChannel ||
        probe.side_channel ||
        null;

      if (explicitSnapshot || typeof getSideChannelSnapshot === 'function') {
        let payload =
          explicitSnapshot && typeof explicitSnapshot === 'object'
            ? { ...explicitSnapshot }
            : null;
        if (!payload && typeof getSideChannelSnapshot === 'function') {
          const hooked = await Promise.resolve(
            getSideChannelSnapshot({
              scenario,
              interviewerTurn,
              answer: answerObj,
              bundle: run.bundle,
              turnCount: run.spend.turn_count,
            }),
          );
          if (hooked && typeof hooked === 'object') payload = { ...hooked };
        }
        if (payload) {
          const lastTurn = run.bundle.turns[run.bundle.turns.length - 1];
          appendSideChannel(run, {
            ...payload,
            turn_idx:
              payload.turn_idx != null ? payload.turn_idx : lastTurn ? lastTurn.idx : null,
            checkpoint: payload.checkpoint != null ? payload.checkpoint : 'after_assistant',
          });
        }
      }

      if (action === 'continue' || action === 'advance' || interviewerTurn.continue) {
        if (effectiveMaxTurns != null && run.spend.turn_count >= effectiveMaxTurns) {
          end_reason = 'max_turns';
          break;
        }
        appendTurn(run, {
          role: 'user_driver',
          text:
            (decision && decision.continueText) ||
            answerObj.continueText ||
            interviewerTurn.continueText ||
            (action === 'advance' ? 'advance' : 'continue'),
        });
      }
    }

    if (interviewerTurn.end_interview || interviewerTurn.stop) {
      end_reason = 'coverage_complete';
      break;
    }

    if (effectiveMaxTurns != null && run.spend.turn_count >= effectiveMaxTurns) {
      end_reason = 'max_turns';
      break;
    }
    if (budgetExceeded(run)) {
      end_reason = resolveEndReasonAfterBudget(run);
      break;
    }
  }

  if (end_reason === 'scenario_stop' && run.spend.turn_count >= hardCap) {
    end_reason = 'max_turns';
  }

  return maybeExport(finalize(run, { end_reason }));
}

module.exports = {
  DEFAULT_INTERVIEWER_MODEL,
  DEFAULT_SUT_MODEL,
  DEFAULT_LIVE_MAX_TURNS,
  DEFAULT_INTERVIEWER_SYSTEM_PROMPT,
  get CASUAL_SD_TONE_INSTRUCTION() {
    return require('./liveSut').CASUAL_SD_TONE_INSTRUCTION;
  },
  isNonspecificInterviewerText,
  shouldRunT2DualAgent,
  t2SkipMessage,
  extractMermaidAttachments,
  createStubInterviewerAgent,
  createThinCandidateAgent,
  createLiveInterviewerAgent,
  NightlyInterviewCap,
  runT2DualAgent,
};
