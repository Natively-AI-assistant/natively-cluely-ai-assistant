// scripts/intent-benchmark/lib/schema.mjs
//
// The dataset row contract, its validator, and the held-out split rule.
//
// This is the single definition of a row. The generator writes through it, the
// labeller reads through it, and run.ts loads through it, so a drifting field
// name fails loudly at the boundary instead of quietly producing a benchmark
// that scores a typo.

import crypto from 'node:crypto';

export const MODES = [
  'general', 'technical-interview', 'looking-for-work', 'sales', 'recruiting',
  'team-meet', 'lecture', 'seminar', 'call-center', 'custom',
];

export const CHANNELS = ['system', 'mic', 'typed', 'screen'];

export const AXES = {
  dialogue_act: ['question', 'request', 'statement', 'answer', 'backchannel', 'interruption'],
  needs_response: ['yes', 'optional', 'no'],
  voice: ['first_person_script', 'advisor', 'capture', 'silent'],
  task: ['answer', 'explain', 'create', 'debug', 'summarize', 'compare', 'rewrite', 'plan', 'research', 'extract', 'none'],
  answer_form: ['code', 'fact', 'explanation', 'example', 'recommendation', 'summary', 'rebuttal', 'steps', 'table', 'none'],
  grounding: ['profile', 'mode_files', 'knowledge_base', 'conversation_memory', 'none'],
  current_information: [true, false],
};

export const CAPABILITIES = [
  'conversation_context', 'screen', 'files', 'retrieval', 'web', 'tools',
];

/** Legacy 8-label taxonomy, kept so every row can be scored against the control. */
export const LEGACY_INTENTS = [
  'coding', 'clarification', 'follow_up', 'deep_dive', 'behavioral',
  'example_request', 'summary_probe', 'general',
];

export const SOURCES = ['real', 'mock_session', 'synthetic', 'edge_case'];
export const LANGUAGES = ['en', 'hinglish', 'manglish'];

// ---------------------------------------------------------------------------
// Held-out split
// ---------------------------------------------------------------------------

/**
 * 20% held out, decided by a hash of the row ID.
 *
 * The hash input MUST be the id and nothing else. The id is a stable synthetic
 * key (mode abbreviation plus sequence), never the row's text.
 *
 * Why that matters, and it is not obvious: Phase 6 regenerates this corpus at
 * 20k rows. If the split hashed row CONTENT, then re-labelling a row, fixing a
 * typo in `input`, or regenerating with a different temperature would move it
 * across the split boundary. Rows held out in the Phase 5 decision would drift
 * into Phase 6 training, and the "nothing may train on the held-out split" rule
 * would be violated silently, by an edit that looked cosmetic.
 */
export function splitFor(id) {
  const h = crypto.createHash('sha256').update(String(id)).digest();
  // First 4 bytes as an unsigned int, mod 100. Deterministic across platforms
  // and Node versions; no float arithmetic, so no rounding drift.
  const bucket = h.readUInt32BE(0) % 100;
  return bucket < 20 ? 'holdout' : 'train';
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const isStr = (v) => typeof v === 'string' && v.length > 0;

/**
 * Validate one row. Returns an array of human-readable problems; empty means
 * valid. Never throws: a bad row must be reportable alongside its siblings, not
 * abort a 1,500-row load.
 */
export function validateRow(row, { requireLabels = true } = {}) {
  const errs = [];
  const bad = (m) => errs.push(m);

  if (!row || typeof row !== 'object') return ['row is not an object'];
  if (!isStr(row.id)) bad('id must be a non-empty string');
  if (!MODES.includes(row.mode)) bad(`mode "${row.mode}" not in MODES`);
  if (!CHANNELS.includes(row.channel)) bad(`channel "${row.channel}" not in CHANNELS`);
  if (!CHANNELS.includes(row.user_channel)) bad(`user_channel "${row.user_channel}" not in CHANNELS`);

  if (!Array.isArray(row.history)) bad('history must be an array');
  else if (row.history.some((h) => typeof h !== 'string')) bad('history must be strings');

  const st = row.app_state;
  if (!st || typeof st !== 'object') bad('app_state missing');
  else {
    if (typeof st.question_pending !== 'boolean') bad('app_state.question_pending must be boolean');
    if (typeof st.coding_task_active !== 'boolean') bad('app_state.coding_task_active must be boolean');
    if (typeof st.seconds_since_user_spoke !== 'number') bad('app_state.seconds_since_user_spoke must be number');
  }

  if (!isStr(row.input)) bad('input must be a non-empty string');
  if (row.input_punctuated !== undefined && typeof row.input_punctuated !== 'string') {
    bad('input_punctuated must be a string when present');
  }
  if (typeof row.mode_has_reference_files !== 'boolean') bad('mode_has_reference_files must be boolean');

  if (!SOURCES.includes(row.source)) bad(`source "${row.source}" not in SOURCES`);
  if (!LANGUAGES.includes(row.language)) bad(`language "${row.language}" not in LANGUAGES`);

  if (requireLabels) {
    const L = row.labels;
    if (!L || typeof L !== 'object') {
      bad('labels missing');
    } else {
      for (const [axis, allowed] of Object.entries(AXES)) {
        if (!allowed.includes(L[axis])) bad(`labels.${axis} = ${JSON.stringify(L[axis])} not in [${allowed.join('|')}]`);
      }
      if (!isStr(L.mode_intent)) bad('labels.mode_intent must be a non-empty string');
      if (!Array.isArray(L.secondary_tasks)) bad('labels.secondary_tasks must be an array');
      else if (L.secondary_tasks.some((t) => !AXES.task.includes(t))) bad('labels.secondary_tasks must all be valid tasks');
      if (!Array.isArray(L.capabilities)) bad('labels.capabilities must be an array');
      else if (L.capabilities.some((c) => !CAPABILITIES.includes(c))) bad('labels.capabilities has an unknown capability');
    }

    // Cross-field invariants. These are the ones a labeller gets wrong, and a
    // per-field type check would pass them all.
    if (L && L.needs_response === 'no' && L.voice !== 'silent') {
      bad('needs_response=no requires voice=silent');
    }
    if (L && L.needs_response === 'no' && L.task !== 'none') {
      bad('needs_response=no requires task=none');
    }
    if (L && L.grounding === 'mode_files' && row.mode_has_reference_files !== true) {
      // The brief's rule: mode_files is only emittable when files actually exist.
      bad('grounding=mode_files requires mode_has_reference_files=true');
    }
    if (L && row.legacy_intent !== undefined && !LEGACY_INTENTS.includes(row.legacy_intent)) {
      bad(`legacy_intent "${row.legacy_intent}" not in LEGACY_INTENTS`);
    }
  }

  return errs;
}

/** Validate a whole corpus. Returns { ok, errors: [{id, index, problems}] , dupes }. */
export function validateCorpus(rows, opts) {
  const errors = [];
  const seen = new Map();
  const dupes = [];
  rows.forEach((row, index) => {
    const problems = validateRow(row, opts);
    if (problems.length) errors.push({ id: row?.id ?? `<index ${index}>`, index, problems });
    if (row?.id) {
      if (seen.has(row.id)) dupes.push({ id: row.id, first: seen.get(row.id), second: index });
      else seen.set(row.id, index);
    }
  });
  return { ok: errors.length === 0 && dupes.length === 0, errors, dupes };
}

/** Parse a JSONL file body into rows, reporting torn lines rather than throwing. */
export function parseJsonl(text) {
  const rows = [];
  const bad = [];
  text.split('\n').forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    try { rows.push(JSON.parse(t)); } catch (e) { bad.push({ line: i + 1, error: e.message }); }
  });
  return { rows, bad };
}
