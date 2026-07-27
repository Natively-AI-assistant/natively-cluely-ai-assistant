// scripts/lib/sd-interview-sim/liveSut.js
//
// Live Natively SUT adapter for T2: SessionTracker inject via IntelligenceManager
// + runWhatShouldISay (real What-To-Answer path). Electron-only at call time;
// factory itself is pure and unit-testable with a fake manager.

'use strict';

/**
 * Candidate whiteboard contract (grill: ASCII replaces mermaid for SUT).
 * HLD presentation includes a portable ASCII diagram in the spoken turn.
 */
const CANDIDATE_ASCII_HLD_INSTRUCTION = [
  'When you present the High-Level Design (HLD), include at least one ASCII architecture diagram',
  'in a fenced ```text or ```ascii code block using portable characters (+ - | / > v).',
  'Treat it as you drawing on the whiteboard for a human reading the transcript.',
  'Do not emit mermaid (no ```mermaid). Interviewer diagrams may still use mermaid; yours must be ASCII.',
].join(' ');

/**
 * Casual + candidate-led showcase contract for live SUT (SPEC 08 + SPEC 09).
 * Attitude only — not the GitHub /sondo-pr-voice pipeline. T2 sim only.
 */
const CASUAL_SD_TONE_INSTRUCTION = [
  'You are the candidate. You lead the system-design showcase.',
  'Walk the hellointerview Delivery Framework in order as you go',
  '(Requirements → Core Entities → API → HLD → Deep Dives). Do not wait for the interviewer',
  'to tell you which section is next.',
  'If the interviewer asks a clarifier: answer it briefly, then resume the showcase',
  'at the next unfinished phase.',
  'Spoken tone: casual, collaborative, short. Prefer "we". Hedge lightly when uncertain.',
  'No stiff corporate filler. No long monologue that ignores a live clarifier.',
  CANDIDATE_ASCII_HLD_INSTRUCTION,
].join('\n');

/**
 * Full-raw candidate instruction — no shortening (SD_INTERVIEW_SIM_T2_FULL_RAW=1).
 */
const FULL_RAW_SD_TONE_INSTRUCTION = [
  'You are the candidate. You lead the system-design showcase.',
  'Walk the hellointerview Delivery Framework in order as you go',
  '(Requirements → Core Entities → API → HLD → Deep Dives). Do not wait for the interviewer',
  'to tell you which section is next.',
  'Speak freely and at full length — complete sentences, full paragraphs, real tradeoff discussion.',
  'Do NOT shorten, summarize into bullets-only, or use telegram/caveman style.',
  'Prefer "we". Hedge lightly when uncertain.',
  'If the interviewer asks a clarifier: answer it thoroughly first, then resume the showcase',
  'at the next unfinished phase. Include scale numbers and failure modes when they help.',
  'No stiff corporate filler.',
  CANDIDATE_ASCII_HLD_INSTRUCTION,
].join('\n');

/**
 * @param {AsyncIterable<string>|AsyncGenerator<string>|string|null|undefined} streamOrText
 * @returns {Promise<string>}
 */
async function collectAnswer(streamOrText) {
  if (streamOrText == null) return '';
  if (typeof streamOrText === 'string') return streamOrText;
  let out = '';
  for await (const chunk of streamOrText) out += String(chunk ?? '');
  return out;
}

/**
 * Rough token/USD estimate when Gemini usage metadata is unavailable.
 * @param {string} text
 * @param {{ inputHintChars?: number, usdPer1kTokens?: number }} [opts]
 */
function estimateSpendFromText(text, opts = {}) {
  const outChars = String(text || '').length;
  const inChars = opts.inputHintChars != null ? opts.inputHintChars : 0;
  const output_tokens = Math.max(1, Math.ceil(outChars / 4));
  const input_tokens = Math.max(0, Math.ceil(inChars / 4));
  const usdPer1k = opts.usdPer1kTokens != null ? opts.usdPer1kTokens : 0.0015;
  const estimated_usd = ((input_tokens + output_tokens) / 1000) * usdPer1k;
  return { input_tokens, output_tokens, estimated_usd };
}

/**
 * SessionTracker-shaped adapter so SdInterviewSimRunner injectSpeech can write
 * interviewer/user turns into the live IntelligenceManager session.
 *
 * @param {{
 *   addTranscript?: Function,
 *   getSdRequirementsGateStatus?: Function,
 *   getFormattedContext?: Function,
 * }} intelligenceManager
 */
function createIntelligenceSessionAdapter(intelligenceManager) {
  if (!intelligenceManager || typeof intelligenceManager.addTranscript !== 'function') {
    throw new Error('createIntelligenceSessionAdapter requires intelligenceManager.addTranscript');
  }
  return {
    addTranscript(segment) {
      // skipRefinementCheck=true — harness injects finalized rows; no live STT refinement.
      intelligenceManager.addTranscript(segment, true);
      return { role: null, segment };
    },
    getSdRequirementsGateStatus() {
      return intelligenceManager.getSdRequirementsGateStatus?.() ?? null;
    },
    getFormattedContext(lastSeconds) {
      return intelligenceManager.getFormattedContext?.(lastSeconds) ?? '';
    },
  };
}

/**
 * Live SUT: thin candidate trigger → IntelligenceManager.runWhatShouldISay.
 *
 * @param {{
 *   intelligenceManager: {
 *     runWhatShouldISay: Function,
 *     getLastAssistantMessage?: Function,
 *   },
 *   timeoutMs?: number,
 *   skipCooldown?: boolean,
 *   forceFresh?: boolean,
 *   estimateUsdPer1kTokens?: number,
 * }} opts
 */
function createLiveWhatToAnswerSut(opts = {}) {
  const im = opts.intelligenceManager;
  if (!im || typeof im.runWhatShouldISay !== 'function') {
    throw new Error('createLiveWhatToAnswerSut requires intelligenceManager.runWhatShouldISay');
  }
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 90_000;
  const skipCooldown = opts.skipCooldown !== false;
  const forceFresh = opts.forceFresh !== false;
  const usdPer1k = opts.estimateUsdPer1kTokens != null ? opts.estimateUsdPer1kTokens : 0.0015;
  const promptInstruction =
    opts.promptInstruction != null
      ? String(opts.promptInstruction)
      : CASUAL_SD_TONE_INSTRUCTION;

  return async function liveWhatToAnswerSut(ctx) {
    const probe = String(ctx?.interviewerTurn?.text || '');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const started = Date.now();
    const candidateAction = ctx?.candidateAction || 'trigger';
    try {
      const raw = await Promise.race([
        im.runWhatShouldISay(undefined, 1, undefined, {
          skipCooldown,
          forceFresh,
          promptInstruction,
          sdRequirementsUiAdvance: candidateAction === 'advance',
        }),
        new Promise((_, reject) => {
          ctl.signal.addEventListener('abort', () => {
            reject(new Error(`live SUT timed out after ${timeoutMs}ms`));
          });
        }),
      ]);
      let text = await collectAnswer(raw);
      if (!text && typeof im.getLastAssistantMessage === 'function') {
        text = im.getLastAssistantMessage() || '';
      }
      text = String(text || '').trim();
      if (!text) {
        throw new Error('live SUT returned empty answer');
      }
      // Soft product fallbacks when Gemini cascade dies — treat as SUT failure
      // so the dual-agent loop does not pretend the candidate answered.
      if (
        /couldn'?t reach the AI provider/i.test(text) ||
        /No AI provider configured/i.test(text) ||
        /did not produce an answer in time/i.test(text) ||
        /API key or rate-limit issue/i.test(text)
      ) {
        throw new Error(`live SUT provider failure: ${text.slice(0, 160)}`);
      }
      const spend = estimateSpendFromText(text, {
        inputHintChars: probe.length + 2000,
        usdPer1kTokens: usdPer1k,
      });
      spend.latency_ms = Date.now() - started;
      return {
        text,
        spend,
        meta: {
          promptInstruction,
          candidateAction,
          sdRequirementsUiAdvance: candidateAction === 'advance',
        },
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Side-channel snapshot from live IntelligenceManager (analysis-only).
 * @param {{ getSdRequirementsGateStatus?: Function, getFormattedContext?: Function }} intelligenceManager
 */
function liveSideChannelSnapshot(intelligenceManager) {
  return {
    gateStatus: intelligenceManager.getSdRequirementsGateStatus?.() ?? null,
    recentContextPreview: String(
      intelligenceManager.getFormattedContext?.(180) || '',
    ).slice(0, 4000),
  };
}

module.exports = {
  CASUAL_SD_TONE_INSTRUCTION,
  FULL_RAW_SD_TONE_INSTRUCTION,
  CANDIDATE_ASCII_HLD_INSTRUCTION,
  collectAnswer,
  estimateSpendFromText,
  createIntelligenceSessionAdapter,
  createLiveWhatToAnswerSut,
  liveSideChannelSnapshot,
};
