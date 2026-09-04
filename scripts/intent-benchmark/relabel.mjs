#!/usr/bin/env node
// scripts/intent-benchmark/relabel.mjs
//
// Re-label ONE axis over an existing corpus, in place, preserving ids.
//
// The campaign brief's own remedy for a broken axis is to rewrite that axis's
// DEFINITION and relabel, rather than regenerate. This implements that.
//
// Why it exists concretely. The first full corpus labelled `voice` as "advisor"
// on 103 of 104 responding Sales turns, and on 102 of 102 Seminar turns, in
// modes whose entire contract is that the output is what the user SAYS ALOUD.
// The cause was the definition, not the model: `voice` was handed over as a
// bare enum with no statement of which mode implies which value, so the
// labeller collapsed to the most neutral-sounding option. An axis in that state
// measures the labeller's default and nothing else.
//
// Regenerating would have thrown away 1,742 inputs that passed every realism
// gate, to fix a field that is independent of them. Relabelling keeps the
// inputs and costs one pass.
//
// IDS AND SPLITS ARE UNTOUCHED. Only the named axis changes.
//
// Usage:
//   node scripts/intent-benchmark/relabel.mjs --axis voice --in dataset/v1.jsonl

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonl, validateRow, AXES } from './lib/schema.mjs';
import { ALL_SPECS } from './lib/modeSpecs.mjs';
import { generateJson, readApiKey } from './lib/gemini.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf(f); return i > -1 && args[i + 1] ? args[i + 1] : d; };
const AXIS = val('--axis', 'voice');
const IN = path.resolve(__dirname, val('--in', 'dataset/v1.jsonl'));
const OUT = path.resolve(__dirname, val('--out', val('--in', 'dataset/v1.jsonl')));
const BATCH = Number(val('--batch', 25));
const MODEL = val('--model', 'gemini-3.1-flash-lite');

if (!AXES[AXIS]) { console.error(`--axis must be one of: ${Object.keys(AXES).join(', ')}`); process.exit(2); }

const VOICE_GUIDE = `
The voice axis is decided by WHO SPEAKS THE OUTPUT, and it follows the mode.

first_person_script — the user SAYS the output out loud, as themselves. It is
  their script. Default in technical-interview, looking-for-work, sales,
  seminar, call-center.
advisor — guidance ABOUT the situation, written to the user, never spoken.
  Default in recruiting (the user is evaluating someone else), lecture, general.
capture — a RECORD of what was said: action item, decision, risk. Default in
  team-meet, which switches to first_person_script only when the user is called
  on by name and must reply.
silent — the turn needs no response at all.

The most common error is labelling everything "advisor" because it sounds safe.
In a sales or interview turn, ask: is the user being given ADVICE, or being
given WORDS TO SAY? If words to say, it is first_person_script.`;

const GUIDES = { voice: VOICE_GUIDE };

async function relabelBatch(modeKey, rows) {
  const spec = ALL_SPECS[modeKey] ?? ALL_SPECS.general;
  const prompt = `You are correcting ONE label on rows of a live-conversation benchmark.

MODE: ${modeKey}
SITUATION: ${spec.scenario}
THE USER IS: the ${spec.userRole}. THE OTHER CHANNEL CARRIES: the ${spec.systemCarries}.
THIS MODE'S DEFAULT ${AXIS.toUpperCase()}: ${spec.defaultVoice ?? '(none)'}

${GUIDES[AXIS] ?? ''}

Allowed values: ${AXES[AXIS].join(' | ')}

For each row below, output the CORRECT ${AXIS}. Keep the row's id exactly.
Deviating from the mode default is allowed when the turn warrants it.

ROWS:
${rows.map((r) => JSON.stringify({
    id: r.id,
    channel: r.channel,
    needs_response: r.labels.needs_response,
    history: (r.history ?? []).slice(-2),
    input: r.input,
  })).join('\n')}`;

  const schema = {
    type: 'object',
    properties: {
      labels: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'string' }, value: { type: 'string', enum: AXES[AXIS] } },
          required: ['id', 'value'],
        },
      },
    },
    required: ['labels'],
  };

  const { data } = await generateJson({ prompt, responseSchema: schema, model: MODEL, temperature: 0.2 });
  return new Map((data?.labels ?? []).map((l) => [l.id, l.value]));
}

(async () => {
  try { readApiKey(); } catch (e) { console.error(e.message); process.exit(2); }

  const { rows } = parseJsonl(fs.readFileSync(IN, 'utf8'));
  const byMode = new Map();
  for (const r of rows) {
    const k = r.custom_mode_key ?? r.mode;
    if (!byMode.has(k)) byMode.set(k, []);
    byMode.get(k).push(r);
  }

  const stats = { changed: 0, unchanged: 0, missing: 0, reverted: 0 };
  const before = {}; const after = {};
  const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };

  for (const [modeKey, modeRows] of byMode) {
    // needs_response=no is pinned to silent by the schema invariant; sending
    // those to the model would only invite it to break the invariant.
    const target = modeRows.filter((r) => r.labels.needs_response !== 'no');
    process.stdout.write(`  ${modeKey.padEnd(28)} ${String(target.length).padStart(4)} rows ... `);
    let changed = 0;
    for (let i = 0; i < target.length; i += BATCH) {
      const chunk = target.slice(i, i + BATCH);
      let map;
      try { map = await relabelBatch(modeKey, chunk); }
      catch (e) { console.log(`FAILED (${e.message.slice(0, 60)})`); break; }
      for (const r of chunk) {
        bump(before, r.labels[AXIS]);
        const v = map.get(r.id);
        if (v == null) { stats.missing++; bump(after, r.labels[AXIS]); continue; }
        if (v !== r.labels[AXIS]) {
          const prev = r.labels[AXIS];
          r.labels[AXIS] = v;
          // The relabel must not break a cross-field invariant. If it does,
          // revert that row rather than write a corpus the validator rejects.
          if (validateRow(r).length) { r.labels[AXIS] = prev; stats.reverted++; bump(after, prev); continue; }
          changed++; stats.changed++;
        } else stats.unchanged++;
        bump(after, r.labels[AXIS]);
      }
    }
    console.log(`${changed} changed`);
  }

  fs.writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`\n${AXIS}: ${stats.changed} changed, ${stats.unchanged} unchanged, ${stats.missing} not returned, ${stats.reverted} reverted for breaking an invariant`);
  console.log(`before  ${JSON.stringify(before)}`);
  console.log(`after   ${JSON.stringify(after)}\n`);
})();
