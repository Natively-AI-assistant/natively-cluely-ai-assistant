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
  // v2 taxonomy. `question` and `request` merged into `ask` because 27 of 54
  // dialogue_act overlap failures were that one pair, and `optional` was
  // removed because 9 of 11 needs_response overlaps were optional-vs-yes.
  // See migrate-taxonomy.mjs for the evidence and the fold rule.
  dialogue_act: ['ask', 'statement', 'answer', 'backchannel', 'interruption'],
  needs_response: ['yes', 'no'],
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

/**
 * GROUP-AWARE SPLIT: every row sharing a normalised input lands in one split.
 *
 * `splitFor` alone hashes the id, which is stable across regeneration and is
 * the property that matters most. It has one hole. Dedup is keyed on
 * (mode, input), deliberately, because the same backchannel in Team Meet and in
 * Lecture is genuine signal for a mode-aware router. But those two rows have
 * different ids, so the hash can put one in train and the other in holdout, and
 * the held-out copy is then memorisable.
 *
 * Measured on v1: 33 of 419 held-out rows, 7.9%, had an exact input duplicate in
 * train, and 31 of them carried the same needs_response label. The effect on the
 * result was small and did not change the ranking — the leading candidate scored
 * 66.3 macro F1 overall and 65.4 excluding those rows, and the MobileBERT
 * baseline actually did WORSE on them (10.0% against 33.7%) because they are
 * mostly short backchannels. But 0.9 points of a candidate's score coming from
 * memorisation is 0.9 points that do not generalise.
 *
 * The whole group takes the split of its lexicographically first id, so the
 * assignment is deterministic and still survives regeneration.
 *
 * Not retrofitted to v1, because re-splitting invalidates every measurement
 * already taken and the measured cost of the leak is under one point. Use this
 * when the corpus is regenerated.
 */
/**
 * The identity of a row for deduplication.
 *
 * Mode, normalised input, AND labels. The labels are load-bearing: an
 * adversarial pair from the `trap` category is near-identical wording carrying
 * DIFFERENT labels, disambiguated by the channel and history that the provider
 * text puts in front of the model. A label-blind key silently deletes one
 * member of every such pair, which is why the corpus contained no same-mode
 * input collisions at all before this existed.
 *
 * Two rows agreeing on all three are a genuine repeat: identical words, identical
 * answer, no new information.
 */
export function dedupeKey(row) {
  const input = String(row?.input ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const l = row?.labels ?? {};
  return `${row?.mode}::${input}::${l.needs_response}|${l.dialogue_act}|${l.task}`;
}

export function assignGroupedSplits(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = String(r?.input ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  for (const group of groups.values()) {
    const anchor = group.map((r) => r.id).sort()[0];
    const split = splitFor(anchor);
    for (const r of group) r.split = split;
  }
  return rows;
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
    // A silent turn has no answer form and no grounding source, for the same
    // reason it has no voice and no task: there is no answer for them to
    // describe. The schema enforced the first two from the start and not these,
    // and the founder's hand check found the gap — `answer_form` came back at
    // 10.3% disagreement, over the 10% bar, and 35 of the 38 corrections asking
    // for `none` were needs_response=no rows.
    //
    // The v1->v2 migration made it worse: folding `optional` into `no` set
    // voice and task but left answer_form and grounding carrying values from
    // when the row was still considered answerable.
    if (L && L.needs_response === 'no' && L.answer_form !== 'none') {
      bad('needs_response=no requires answer_form=none');
    }
    if (L && L.needs_response === 'no' && L.grounding !== 'none') {
      bad('needs_response=no requires grounding=none');
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
