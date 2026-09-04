#!/usr/bin/env node
// scripts/intent-benchmark/run.mjs
//
// Run one provider over the dataset and write a scored report.
//
// Two things it is careful about:
//
//   THE HELD-OUT SPLIT IS THE DEFAULT. Every reported number comes from rows no
//   prototype or fine-tune was built on. `--split train` exists for building
//   prototypes and is never the thing quoted.
//
//   THE PROVIDER NEVER SEES A LABEL. rowToInput strips them, and a test asserts
//   it. A provider that can read the answer is not a measurement.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonl } from './lib/schema.mjs';
import { ALL_SPECS, MODE_SPECS } from './lib/modeSpecs.mjs';
import { rowToInput, SCORED_AXES } from './providers/contract.mjs';
import { scoreRun, formatReport } from './report.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => { const i = args.indexOf(f); return i > -1 && args[i + 1] ? args[i + 1] : d; };

const PROVIDER = val('--provider', 'rules');
const IN = path.resolve(__dirname, val('--in', 'dataset/v1.jsonl'));
const SPLIT = val('--split', 'holdout');
const LIMIT = Number(val('--limit', '0'));
const PUNCTUATED = has('--punctuated');
const OUT = val('--out', `reports/${PROVIDER}${PUNCTUATED ? '-punctuated' : ''}.json`);
const LANG = val('--language', 'en');

/** mode -> that mode's own mode_intent label set, for candidates that need it. */
const MODE_INTENTS = Object.fromEntries(
  Object.entries(MODE_SPECS).map(([k, s]) => [k, s.modeIntents]),
);
MODE_INTENTS.custom = ALL_SPECS['custom-investor-update'].modeIntents;

// Loaded before buildProvider, because prototype candidates need the train split.
const { rows } = parseJsonl(fs.readFileSync(IN, 'utf8'));

async function buildProvider(id) {
  if (id === 'rules') {
    const { RulesProvider } = await import('./providers/rules.mjs');
    return new RulesProvider();
  }
  if (id.startsWith('nli-')) {
    const { NliProvider } = await import('./providers/nli.mjs');
    const REGISTRY = {
      // The control: production's model, production's labels, production's
      // threshold, one softmax over eight hypotheses.
      'nli-mobilebert-legacy': { modelId: 'Xenova/mobilebert-uncased-mnli', mode: 'legacy', localOnly: true },
      // The same model asked for the whole frame: 44 forward passes per row
      // instead of 8. Measures the architectural cost, not just the model.
      'nli-mobilebert-frame': { modelId: 'Xenova/mobilebert-uncased-mnli', mode: 'frame', localOnly: true },
      // Escalation candidates. All downloaded on first use; sizes are reported
      // by tools/model-sizes.mjs after a sweep.
      'nli-deberta-xsmall':      { modelId: 'MoritzLaurer/deberta-v3-xsmall-zeroshot-v1.1-all-33', mode: 'legacy', localOnly: false },
      'nli-deberta-small':       { modelId: 'Xenova/nli-deberta-v3-small', mode: 'legacy', localOnly: false },
      'nli-deberta-base':        { modelId: 'Xenova/nli-deberta-v3-base', mode: 'legacy', localOnly: false },
      'nli-modernbert-base':     { modelId: 'MoritzLaurer/ModernBERT-base-zeroshot-v2.0', mode: 'legacy', localOnly: false },
      // Frame configs for the best NLI, to measure the per-label cost on a
      // model that can actually classify.
      'nli-deberta-xsmall-frame': { modelId: 'MoritzLaurer/deberta-v3-xsmall-zeroshot-v1.1-all-33', mode: 'frame', localOnly: false },
    };
    const cfg = REGISTRY[id];
    if (!cfg) throw new Error(`unknown NLI provider ${id}. Known: ${Object.keys(REGISTRY).join(', ')}`);
    return new NliProvider({ id, modeIntents: MODE_INTENTS, ...cfg });
  }
  if (id.startsWith('proto-')) {
    const { EmbeddingPrototypeProvider } = await import('./providers/embeddingPrototype.mjs');
    const REGISTRY = {
      // Already resident in the app for retrieval, so on this variant the
      // marginal cost of routing is a vector comparison, not a second model.
      'proto-minilm-centroid': { modelId: 'Xenova/all-MiniLM-L6-v2', rule: 'centroid', localOnly: true },
      'proto-minilm-topk':     { modelId: 'Xenova/all-MiniLM-L6-v2', rule: 'topk', k: 15, localOnly: true },
      'proto-bge-small-centroid': { modelId: 'Xenova/bge-small-en-v1.5', rule: 'centroid', localOnly: false },
      'proto-bge-small-topk':     { modelId: 'Xenova/bge-small-en-v1.5', rule: 'topk', k: 15, localOnly: false },
      // Static embeddings: a table lookup per token, no transformer at all.
      // The only candidate with a plausible route to sub-millisecond routing.
      'proto-potion-centroid':   { modelId: 'minishlab/potion-base-8M', rule: 'centroid', localOnly: true, staticEmbed: true, dtype: 'fp32' },
    };
    const cfg = REGISTRY[id];
    if (!cfg) throw new Error(`unknown prototype provider ${id}. Known: ${Object.keys(REGISTRY).join(', ')}`);
    // Prototypes are built from TRAIN ONLY. The provider re-asserts this and
    // refuses if a held-out row reaches it.
    const trainRows = rows.filter((r) => r.split === 'train' && (r.language ?? 'en') === 'en');
    return new EmbeddingPrototypeProvider({ id, trainRows, ...cfg });
  }
  if (id.startsWith('head-')) {
    const { MultiHeadProvider } = await import('./providers/multihead.mjs');
    const REGISTRY = {
      'head-minilm': { dir: 'resources/models/natively/router-minilm-multihead' },
    };
    const cfg = REGISTRY[id];
    if (!cfg) throw new Error(`unknown head provider ${id}. Known: ${Object.keys(REGISTRY).join(', ')}`);
    return new MultiHeadProvider({ id, ...cfg });
  }
  if (id.startsWith('hybrid-')) {
    const { HybridProvider } = await import('./providers/hybrid.mjs');
    const { RulesProvider } = await import('./providers/rules.mjs');
    const { EmbeddingPrototypeProvider } = await import('./providers/embeddingPrototype.mjs');
    const { MultiHeadProvider } = await import('./providers/multihead.mjs');
    const { NliProvider } = await import('./providers/nli.mjs');

    const trainRows = rows.filter((r) => r.split === 'train' && (r.language ?? 'en') === 'en');
    const potion = () => new EmbeddingPrototypeProvider({
      id: 'potion', modelId: 'minishlab/potion-base-8M', rule: 'centroid',
      localOnly: true, staticEmbed: true, dtype: 'fp32', trainRows,
    });
    const head = () => new MultiHeadProvider({ id: 'head', dir: 'resources/models/natively/router-minilm-multihead' });
    const nli = () => new NliProvider({ id: 'nli', modelId: 'Xenova/mobilebert-uncased-mnli', mode: 'frame', localOnly: true, modeIntents: MODE_INTENTS });

    const REGISTRY = {
      // The brief's four hybrid rows, built from whatever actually won its tier.
      'hybrid-rules-nli':        () => ({ rules: new RulesProvider(), primary: nli() }),
      'hybrid-rules-proto-nli':  () => ({ rules: new RulesProvider(), primary: potion(), escalation: nli() }),
      'hybrid-rules-proto-head': () => ({ rules: new RulesProvider(), primary: potion(), escalation: head() }),
      // Same as above with a tighter margin, to trace the accuracy/latency
      // curve rather than reporting a single arbitrary operating point.
      'hybrid-tight':            () => ({ rules: new RulesProvider(), primary: potion(), escalation: head(), marginThreshold: 0.10 }),
      'hybrid-wide':             () => ({ rules: new RulesProvider(), primary: potion(), escalation: head(), marginThreshold: 0.50 }),
    };
    const build = REGISTRY[id];
    if (!build) throw new Error(`unknown hybrid ${id}. Known: ${Object.keys(REGISTRY).join(', ')}`);
    return new HybridProvider({ id, deadlineMs: 150, ...build() });
  }
  throw new Error(`unknown provider ${id}`);
}

let target = rows.filter((r) => (SPLIT === 'all' ? true : r.split === SPLIT));
if (LANG !== 'all') target = target.filter((r) => (r.language ?? 'en') === LANG);
if (LIMIT > 0) target = target.slice(0, LIMIT);

if (PUNCTUATED) {
  const missing = target.filter((r) => !r.input_punctuated).length;
  if (missing) console.warn(`[run] ${missing} rows have no input_punctuated; they fall back to raw text`);
}

console.log(`\nprovider ${PROVIDER}   split ${SPLIT}   lang ${LANG}   rows ${target.length}   input ${PUNCTUATED ? 'restored' : 'raw'}`);

const provider = await buildProvider(PROVIDER);
const t0 = Date.now();
await provider.load();
const loadMs = Date.now() - t0;
console.log(`loaded in ${loadMs}ms`);

const results = [];
const roundTripMs = [];
const workerMs = [];
let failed = 0;

for (let i = 0; i < target.length; i++) {
  const row = target[i];
  const input = rowToInput(row, { punctuated: PUNCTUATED });
  const started = performance.now();
  let frame = null;
  try {
    frame = await provider.classify(input);
  } catch (e) {
    failed++;
  }
  roundTripMs.push(performance.now() - started);
  if (frame?.workerMs != null) workerMs.push(frame.workerMs);

  results.push({
    id: row.id,
    expected: { ...row.labels },
    predicted: frame,
    expectedLegacyIntent: row.legacy_intent,
    predictedLegacyIntent: frame?.legacy_intent ?? null,
  });
  if ((i + 1) % 50 === 0) process.stdout.write(`  ${i + 1}/${target.length}\r`);
}

await provider.unload();

// The in-worker number is the model's own cost; the round trip is what
// production would pay. Report both, and prefer the worker number for the
// acceptance bar only because the brief specifies "measured inside the worker".
const scored = scoreRun({
  providerId: PROVIDER,
  rowsById: new Map(target.map((r) => [r.id, r])),
  results,
  latencies: workerMs.length ? workerMs : roundTripMs,
  meta: { ...provider.meta(), loadMs, split: SPLIT, language: LANG, punctuated: PUNCTUATED, failed },
});
scored.roundTrip = { p50: percentile(roundTripMs, 50), p95: percentile(roundTripMs, 95) };
scored.latencySource = workerMs.length ? 'worker' : 'round-trip';

function percentile(v, p) {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? Number(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)].toFixed(2)) : null;
}

const outPath = path.resolve(__dirname, OUT);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(scored, null, 2));

console.log(formatReport(scored));
console.log(`\nlatency source  ${scored.latencySource}   round-trip p50 ${scored.roundTrip.p50}ms p95 ${scored.roundTrip.p95}ms`);
if (failed) console.log(`FAILED ROWS     ${failed}`);
console.log(`\nwritten to ${path.relative(process.cwd(), outPath)}\n`);
