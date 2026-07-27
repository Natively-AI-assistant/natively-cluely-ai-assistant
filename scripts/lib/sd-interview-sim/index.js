// scripts/lib/sd-interview-sim/index.js
//
// Pure transcript-bundle helpers for the SD interview simulation family.
// create / append / finalize / budget — no Electron, no live Gemini.

'use strict';

const { randomUUID } = require('crypto');
const { checkMermaidSyntax } = require('./mermaid');
const {
  CORPUS_DIR_RELATIVE,
  redactSecrets,
  resolveCorpusDir,
  writeCorpusBundle,
  retainLastN,
} = require('./corpus');

/**
 * @typedef {{ git_sha?: string, tier?: string, models?: Record<string, string> }} Provenance
 * @typedef {{
 *   maxTurns?: number,
 *   maxInputTokens?: number,
 *   maxOutputTokens?: number,
 *   maxEstimatedUsd?: number,
 * }} BudgetCaps
 * @typedef {{
 *   input_tokens: number,
 *   output_tokens: number,
 *   estimated_usd: number,
 *   turn_count: number,
 * }} SpendSnapshot
 */

/**
 * Start a versioned sim run. Returns a mutable run handle the runner will use.
 *
 * @param {{ provenance?: Provenance, run_id?: string, budgets?: BudgetCaps }} [opts]
 */
function createRun(opts = {}) {
  const provenance = { ...(opts.provenance || {}) };
  const budgets = { ...(opts.budgets || {}) };
  return {
    bundle: {
      schema_version: 1,
      run_id: opts.run_id || randomUUID(),
      provenance,
      turns: [],
      side_channels: [],
    },
    budgets,
    spend: {
      input_tokens: 0,
      output_tokens: 0,
      estimated_usd: 0,
      turn_count: 0,
    },
    finalized: false,
  };
}

/**
 * Append a turn. Mermaid attachments without `syntaxValid` get a soft check.
 *
 * @param {ReturnType<typeof createRun>} run
 * @param {{ role: string, text?: string, attachments?: Array<{ kind: string, source?: string, syntaxValid?: boolean }> }} turn
 */
function appendTurn(run, turn) {
  if (run.finalized) {
    throw new Error('Cannot appendTurn after finalize');
  }
  const attachments = (turn.attachments || []).map((att) => {
    if (att.kind !== 'mermaid') return { ...att };
    const next = { kind: 'mermaid', source: att.source ?? '' };
    if (typeof att.syntaxValid === 'boolean') {
      next.syntaxValid = att.syntaxValid;
    } else {
      next.syntaxValid = checkMermaidSyntax(next.source);
    }
    return next;
  });

  const idx = run.bundle.turns.length;
  run.bundle.turns.push({
    idx,
    role: turn.role,
    text: turn.text ?? '',
    attachments,
  });
  run.spend.turn_count += 1;
  return run;
}

/**
 * Add simulated token/USD spend toward budget caps.
 *
 * @param {ReturnType<typeof createRun>} run
 * @param {{ input_tokens?: number, output_tokens?: number, estimated_usd?: number }} delta
 */
function recordSpend(run, delta = {}) {
  if (run.finalized) {
    throw new Error('Cannot recordSpend after finalize');
  }
  run.spend.input_tokens += delta.input_tokens || 0;
  run.spend.output_tokens += delta.output_tokens || 0;
  run.spend.estimated_usd += delta.estimated_usd || 0;
  return run;
}

/**
 * Whether any configured budget cap is exceeded.
 *
 * @param {ReturnType<typeof createRun>} run
 * @returns {boolean}
 */
function budgetExceeded(run) {
  const { budgets, spend } = run;
  if (budgets.maxTurns != null && spend.turn_count >= budgets.maxTurns) return true;
  if (budgets.maxInputTokens != null && spend.input_tokens >= budgets.maxInputTokens) return true;
  if (budgets.maxOutputTokens != null && spend.output_tokens >= budgets.maxOutputTokens) return true;
  if (budgets.maxEstimatedUsd != null && spend.estimated_usd >= budgets.maxEstimatedUsd) return true;
  return false;
}

/**
 * Finalize a complete transcript bundle (always, including abort / budget_hit).
 *
 * @param {ReturnType<typeof createRun>} run
 * @param {{ end_reason?: string }} [opts]
 * @returns {{ bundle: object, outcome: object }}
 */
function finalize(run, opts = {}) {
  const end_reason =
    opts.end_reason != null
      ? opts.end_reason
      : budgetExceeded(run)
        ? 'budget_hit'
        : 'scenario_stop';

  const spend = {
    input_tokens: run.spend.input_tokens,
    output_tokens: run.spend.output_tokens,
    estimated_usd: run.spend.estimated_usd,
  };

  const outcome = { end_reason, spend };
  run.bundle.outcome = outcome;
  run.finalized = true;

  return {
    bundle: {
      schema_version: run.bundle.schema_version,
      run_id: run.bundle.run_id,
      provenance: { ...run.bundle.provenance },
      turns: run.bundle.turns.map((t) => ({
        ...t,
        attachments: (t.attachments || []).map((a) => ({ ...a })),
      })),
      side_channels: [...run.bundle.side_channels],
      outcome: { ...outcome, spend: { ...spend } },
    },
    outcome: { ...outcome, spend: { ...spend } },
  };
}

module.exports = {
  createRun,
  appendTurn,
  recordSpend,
  budgetExceeded,
  finalize,
  checkMermaidSyntax,
  // Corpus (ticket 06) — file-based traces/sd-interview-sim/, not meeting DB
  CORPUS_DIR_RELATIVE,
  redactSecrets,
  resolveCorpusDir,
  writeCorpusBundle,
  retainLastN,
};

// Runner seam (fixture + stub). Required after exports so circular load sees helpers.
Object.assign(module.exports, require('./runner'));
