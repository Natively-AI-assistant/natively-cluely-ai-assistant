#!/usr/bin/env node
// scripts/intent-benchmark/generate.mjs
//
// Build the Phase 2 dataset.
//
// Per (mode, category, has-files) cell it asks a cloud LLM for a batch, gates
// the batch on STT realism and on the row schema, and appends the survivors to
// a JSONL file. Deterministic fields (id, split, mode, source) are filled here,
// never by the model, so the held-out split cannot be influenced by generation.
//
// A batch that fails the realism gate is retried ONCE with an explicit critique
// of what it got wrong. A batch that fails twice is dropped and reported, never
// silently accepted: a corpus quietly padded with clean prose is worse than a
// smaller honest one.
//
// Usage:
//   node scripts/intent-benchmark/generate.mjs --smoke
//   node scripts/intent-benchmark/generate.mjs --modes team-meet,recruiting --per-mode 150
//   node scripts/intent-benchmark/generate.mjs --all --per-mode 150 --out dataset/v1.jsonl

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_SPECS, MODE_SPECS, CUSTOM_MODE_KEYS } from './lib/modeSpecs.mjs';
import { buildGenerationPrompt, CATEGORY_BRIEFS, REQUIRED_TRAPS, isPromptExample } from './lib/prompts.mjs';
import { analyzeBatch, formatBatchReport } from './lib/sttRealism.mjs';
import { validateRow, splitFor, AXES, CAPABILITIES, LEGACY_INTENTS, parseJsonl } from './lib/schema.mjs';
import { generateJson, readApiKey } from './lib/gemini.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => { const i = args.indexOf(f); return i > -1 && args[i + 1] ? args[i + 1] : d; };

const SMOKE = has('--smoke');
const PER_MODE = Number(val('--per-mode', SMOKE ? 24 : 150));
const OUT = path.resolve(__dirname, val('--out', SMOKE ? 'dataset/smoke.jsonl' : 'dataset/v1.jsonl'));
const MODEL = val('--model', 'gemini-3.1-flash-lite');
const BATCH = Number(val('--batch', 12));
const LANGUAGE = val('--language', 'en');
// Top-up support. A second pass MUST NOT reuse ids from the first: the
// held-out split is a hash of the id, so a collision would put two different
// rows in the same split slot and a renumber would move rows across the split
// boundary. Both are silent. So a top-up reads the existing corpus, continues
// each mode's sequence from its current maximum, and appends.
const SEQ_FROM = val('--continue-from', null);
const APPEND = args.includes('--append');

const requested = has('--all')
  ? Object.keys(ALL_SPECS)
  : (val('--modes', SMOKE ? 'team-meet,recruiting' : Object.keys(ALL_SPECS).join(',')).split(',').map((s) => s.trim()).filter(Boolean));

for (const m of requested) if (!ALL_SPECS[m]) { console.error(`unknown mode: ${m}`); process.exit(2); }

// ---------------------------------------------------------------------------
// response schema (Gemini enforces this, rather than us asking in prose)
// ---------------------------------------------------------------------------
const ROW_SCHEMA = {
  type: 'object',
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          input: { type: 'string' },
          channel: { type: 'string', enum: ['system', 'mic', 'typed', 'screen'] },
          history: { type: 'array', items: { type: 'string' } },
          app_state: {
            type: 'object',
            properties: {
              question_pending: { type: 'boolean' },
              coding_task_active: { type: 'boolean' },
              seconds_since_user_spoke: { type: 'integer' },
            },
            required: ['question_pending', 'coding_task_active', 'seconds_since_user_spoke'],
          },
          labels: {
            type: 'object',
            properties: {
              dialogue_act: { type: 'string', enum: AXES.dialogue_act },
              needs_response: { type: 'string', enum: AXES.needs_response },
              voice: { type: 'string', enum: AXES.voice },
              task: { type: 'string', enum: AXES.task },
              secondary_tasks: { type: 'array', items: { type: 'string', enum: AXES.task } },
              mode_intent: { type: 'string' },
              answer_form: { type: 'string', enum: AXES.answer_form },
              grounding: { type: 'string', enum: AXES.grounding },
              capabilities: { type: 'array', items: { type: 'string', enum: CAPABILITIES } },
              current_information: { type: 'boolean' },
            },
            required: ['dialogue_act', 'needs_response', 'voice', 'task', 'secondary_tasks',
              'mode_intent', 'answer_form', 'grounding', 'capabilities', 'current_information'],
          },
          legacy_intent: { type: 'string', enum: LEGACY_INTENTS },
          notes: { type: 'string' },
        },
        required: ['input', 'channel', 'history', 'app_state', 'labels', 'legacy_intent', 'notes'],
      },
    },
  },
  required: ['rows'],
};

// ---------------------------------------------------------------------------
// generation
// ---------------------------------------------------------------------------
const CRITIQUE_PREFIX = (problems) => `
YOUR PREVIOUS ATTEMPT WAS REJECTED. It failed these objective checks:
${problems.map((p) => `  - ${p}`).join('\n')}

The most common cause is writing clean sentences and then removing the capital
letters. That is not what a speech-to-text model produces. Re-read the input
rules and produce genuinely disfluent speech this time.

`;

async function generateCell({ modeKey, spec, category, count, withFiles, seq }) {
  let prompt = buildGenerationPrompt({ modeKey, spec, category, count, withFiles, language: LANGUAGE });
  if (category === 'trap' && REQUIRED_TRAPS[modeKey]) {
    prompt += `\n\nTHESE SPECIFIC PAIRS ARE REQUIRED. Cover each at least once:\n${REQUIRED_TRAPS[modeKey].map((t) => `  - ${t}`).join('\n')}`;
  }

  let lastReport = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const p = attempt === 0 ? prompt : CRITIQUE_PREFIX(lastReport.problems) + prompt;
    const { data } = await generateJson({ prompt: p, responseSchema: ROW_SCHEMA, model: MODEL, temperature: 1.0 });
    const raw = Array.isArray(data?.rows) ? data.rows : [];
    if (raw.length === 0) { lastReport = { problems: ['model returned no rows'] }; continue; }

    const report = analyzeBatch(raw.map((r) => r.input), { category });
    lastReport = report;
    if (report.problems.length > 0) continue;

    return { rows: raw, report, attempts: attempt + 1 };
  }
  return { rows: [], report: lastReport, attempts: 2, rejected: true };
}

function toDatasetRow({ raw, modeKey, spec, withFiles, seq }) {
  const isCustom = CUSTOM_MODE_KEYS.has(modeKey);
  // Language is part of the id so the en / hinglish / manglish corpora can be
  // generated independently without colliding, and so the split stays stable
  // when a language slice is regenerated on its own.
  const langTag = LANGUAGE === 'en' ? '' : `${LANGUAGE.slice(0, 2)}-`;
  const id = `${langTag}${spec.abbrev}-${String(seq).padStart(4, '0')}`;
  return {
    id,
    mode: isCustom ? 'custom' : modeKey,
    // Kept alongside `mode` so custom rows stay attributable to which custom
    // mode they came from; `mode` itself must stay in the schema's enum.
    ...(isCustom ? { custom_mode_key: modeKey } : {}),
    channel: raw.channel,
    user_channel: spec.userChannel,
    user_role: spec.userRole,
    history: raw.history ?? [],
    app_state: raw.app_state,
    input: raw.input,
    // input_punctuated is filled by the restoration step (candidate P), not here.
    mode_has_reference_files: withFiles,
    labels: raw.labels,
    legacy_intent: raw.legacy_intent,
    source: 'synthetic',
    language: LANGUAGE,
    notes: raw.notes ?? '',
    split: splitFor(id),
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
(async () => {
  try { readApiKey(); } catch (e) { console.error(e.message); process.exit(2); }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const out = fs.createWriteStream(OUT, { flags: APPEND ? 'a' : 'w' });

  // Seed per-mode sequence counters and the dedup set from an existing corpus.
  const preSeq = {};
  const preInputs = new Set();
  if (SEQ_FROM) {
    const src = path.resolve(__dirname, SEQ_FROM);
    const { rows: existing } = parseJsonl(fs.readFileSync(src, 'utf8'));
    for (const r of existing) {
      const key = r.custom_mode_key ?? r.mode;
      const n = Number(String(r.id).split('-').pop());
      if (Number.isFinite(n)) preSeq[key] = Math.max(preSeq[key] ?? 0, n);
      preInputs.add(`${r.mode}::${String(r.input).toLowerCase().replace(/\s+/g, ' ').trim()}`);
    }
    console.log(`continuing from ${existing.length} existing rows; per-mode next seq: ` +
      Object.entries(preSeq).map(([k, v]) => `${k}=${v + 1}`).join(' '));
  }

  const categories = Object.entries(CATEGORY_BRIEFS);
  const summary = { written: 0, rejectedCells: [], invalid: [], perMode: {}, perCategory: {}, cells: 0, realismByMode: {} };
  const inputsByMode = {};
  const seqByMode = {};
  // Cross-batch dedup. Each batch is generated independently and cannot see its
  // siblings, so common short turns ("yeah exactly", "mhm") recur across
  // batches. Measured at 5% of one smoke run. Duplicates are worthless in a
  // benchmark: identical inputs add no information, and if two copies get
  // different labels they actively corrupt the score. Keyed on (mode, input) so
  // the same backchannel may legitimately appear in a different mode, where its
  // correct labels genuinely differ.
  const seenInputs = new Set(preInputs);
  let deduped = 0;
  let parroted = 0;

  console.log(`\ngenerating  modes=${requested.length}  perMode=${PER_MODE}  model=${MODEL}  out=${path.relative(process.cwd(), OUT)}\n`);

  for (const modeKey of requested) {
    const spec = ALL_SPECS[modeKey];
    seqByMode[modeKey] = seqByMode[modeKey] ?? ((preSeq[modeKey] ?? 0) + 1);
    summary.perMode[modeKey] = 0;

    for (const [category, meta] of categories) {
      const target = Math.max(1, Math.round(PER_MODE * meta.share));
      // Half the cells with files attached, half without, so the benchmark can
      // measure whether a candidate emits grounding=mode_files ONLY when files
      // exist. Built-in modes seeded profile_only still get both, because a user
      // can attach files to any mode.
      // Alternate files=Y/N across BATCHES rather than splitting the category
      // into two half-size cells. The first smoke run showed why: halving a
      // 12-row category into two 6-row cells put every cell under the sample
      // size the rate checks need, so the gate rejected correct output.
      let batchIndex = 0;
      {
        const count = target;
        for (let done = 0; done < count;) {
          const n = Math.min(BATCH, count - done);
          const withFiles = batchIndex++ % 2 === 0;
          summary.cells++;
          process.stdout.write(`  ${modeKey.padEnd(28)} ${category.padEnd(15)} files=${withFiles ? 'Y' : 'N'} n=${String(n).padStart(2)} ... `);
          const res = await generateCell({ modeKey, spec, category, count: n, withFiles });
          if (res.rejected) {
            console.log(`REJECTED (${res.report?.problems?.[0] ?? 'unknown'})`);
            summary.rejectedCells.push({ modeKey, category, withFiles, problems: res.report?.problems ?? [] });
            break;
          }
          let kept = 0;
          for (const raw of res.rows) {
            const row = toDatasetRow({ raw, modeKey, spec, withFiles, seq: seqByMode[modeKey]++ });
            const problems = validateRow(row);
            if (problems.length) { summary.invalid.push({ id: row.id, problems }); continue; }
            // Leakage filter: a row that copied an example out of the
            // instructions measures the prompt, not the language.
            if (isPromptExample(row.input)) { parroted++; continue; }
            const dedupKey = `${row.mode}::${String(row.input).toLowerCase().replace(/\s+/g, ' ').trim()}`;
            if (seenInputs.has(dedupKey)) { deduped++; continue; }
            seenInputs.add(dedupKey);
            out.write(JSON.stringify(row) + '\n');
            (inputsByMode[modeKey] ??= []).push(row.input);
            kept++; summary.written++;
            summary.perMode[modeKey]++;
            summary.perCategory[category] = (summary.perCategory[category] ?? 0) + 1;
          }
          console.log(`kept ${kept}/${res.rows.length}${res.attempts > 1 ? ` (retried)` : ''}`);
          done += n;
        }
      }
    }
  }

  await new Promise((r) => out.end(r));

  // MODE-LEVEL REALISM. This is where the rate checks actually bite: per-cell
  // n is often under the sample threshold, but a mode's full output is in the
  // hundreds. A mode that passed every cell on hard checks alone and still
  // reads as written prose is caught here, and nowhere else.
  console.log(`\n─── STT realism, per mode (rates enforced at this n) ───`);
  for (const [modeKey, inputs] of Object.entries(inputsByMode)) {
    const r = analyzeBatch(inputs);
    summary.realismByMode[modeKey] = r;
    console.log(`\n${modeKey}`);
    console.log(formatBatchReport(r));
  }

  console.log(`\n─── summary ───`);
  summary.deduped = deduped;
  summary.parroted = parroted;
  if (parroted) console.log(`parroted       ${parroted} rows dropped (verbatim copies of prompt examples)`);
  console.log(`written        ${summary.written} rows across ${summary.cells} cells${deduped ? ` (${deduped} cross-batch duplicates dropped)` : ''}`);
  console.log(`per mode       ${Object.entries(summary.perMode).map(([k, v]) => `${k}=${v}`).join('  ')}`);
  console.log(`per category   ${Object.entries(summary.perCategory).map(([k, v]) => `${k}=${v}`).join('  ')}`);
  if (summary.invalid.length) {
    console.log(`\nschema-invalid rows dropped: ${summary.invalid.length}`);
    for (const i of summary.invalid.slice(0, 10)) console.log(`  ${i.id}: ${i.problems.join('; ')}`);
  }
  if (summary.rejectedCells.length) {
    console.log(`\nREJECTED CELLS (realism gate, twice): ${summary.rejectedCells.length}`);
    for (const c of summary.rejectedCells) console.log(`  ${c.modeKey}/${c.category}/files=${c.withFiles}: ${c.problems.join('; ')}`);
  }
  fs.writeFileSync(OUT.replace(/\.jsonl$/, '.summary.json'), JSON.stringify(summary, null, 2));
  console.log(`\nsummary written to ${path.relative(process.cwd(), OUT.replace(/\.jsonl$/, '.summary.json'))}\n`);
})();
