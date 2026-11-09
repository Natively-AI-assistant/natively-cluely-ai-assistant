/**
 * The decider's model input, TypeScript vs Laya's own Python (campaign Phase 3, step 4).
 *
 * Fixtures: decider-fixtures/laya-sequence.json, written by
 * ml/auto-answer-decider/export/make_sequence_fixtures.py from laya 0.4.30's build_sequence,
 * the zero-shot fp32 ONNX export and the checkpoint's temperatures. The tokenizer is the
 * checkpoint's own (decider-fixtures/laya-tokenizer, gzipped, Apache-2.0).
 *
 * One token of difference is a model the user never got, so ids must be IDENTICAL, not close.
 *
 * Optional: DECIDER_ONNX_DIR=<dir with laya.onnx / laya.int8.onnx> also runs the sessions through
 * onnxruntime-node: fp32 logits within 1e-3 of Python, and int8 keeping fp32's argmax on >= 99%.
 * Not in CI: the graphs are 0.4-1.7 GB.
 *
 * Mutation probes (progress log, Phase 3):
 *   mask not replaced in state  → 'every case: identical ids…'
 *   option cap 48 → 47          → 'the head…'
 *   K floor 2 → 1 in collate    → 'collate pads…'
 *   temperature not applied     → 'decodeChoice reproduces…'
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (f) => require(path.resolve(__dirname, '../../../../dist-electron/electron/intelligence/autoAnswer/decider', f));
const Seq = dist('layaSequence.js');
const { adaptTokenizer, specialTokensFromConfig } = dist('layaTokenizer.js');
const State = dist('deciderState.js');

const FIX = path.join(__dirname, 'decider-fixtures');
const fixture = JSON.parse(fs.readFileSync(path.join(FIX, 'laya-sequence.json'), 'utf8'));

async function loadTokenizer() {
  const T = await import('@huggingface/transformers');
  const json = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(FIX, 'laya-tokenizer', 'tokenizer.json.gz'))).toString('utf8'));
  const config = JSON.parse(fs.readFileSync(path.join(FIX, 'laya-tokenizer', 'tokenizer_config.json'), 'utf8'));
  return adaptTokenizer(new T.PreTrainedTokenizer(json, config), specialTokensFromConfig(config));
}
const tokP = loadTokenizer();

test('the question is the §4 question, byte for byte, and maps to Laya\'s internal form', () => {
  assert.deepEqual(fixture.question, JSON.parse(JSON.stringify(State.DECIDER_QUESTION)));
  assert.deepEqual(Seq.toInternalChoice(State.DECIDER_QUESTION), fixture.internal_question);
});

test('special token ids match the Python tokenizer', async () => {
  const tok = await tokP;
  assert.equal(tok.maskToken, fixture.special.mask_token);
  assert.equal(tok.maskTokenId, fixture.special.mask_id);
  assert.equal(tok.clsTokenId, fixture.special.cls_id);
  assert.equal(tok.sepTokenId, fixture.special.sep_id);
  assert.equal(tok.padTokenId, fixture.special.pad_id);
});

test('the head (question + options) is identical, and so is the room left for the state', async () => {
  const tok = await tokP;
  const head = Seq.buildHead(tok, Seq.toInternalChoice(State.DECIDER_QUESTION), fixture.head_max_len);
  assert.deepEqual(head.ids, fixture.head.ids);
  assert.deepEqual(head.markers, fixture.head.markers);
  assert.equal(Seq.stateRoom(head, fixture.max_len), fixture.state_room);
});

test(`every case: the TS fit serializes the same state, and the sequence has identical ids (${fixture.cases.length} cases)`, async () => {
  const tok = await tokP;
  const head = Seq.buildHead(tok, Seq.toInternalChoice(State.DECIDER_QUESTION), fixture.head_max_len);
  const room = Seq.stateRoom(head, fixture.max_len);
  const count = (s) => Seq.countStateTokens(tok, s);
  let fitted = 0;
  for (const c of fixture.cases) {
    const fit = State.fitDeciderState(c.fields, count, room);
    assert.equal(fit.serialized, c.serialized, `${c.id}: serialized state`);
    assert.deepEqual({ droppedTurns: fit.droppedTurns, answeredShrunk: fit.answeredShrunk, droppedCandidateWords: fit.droppedCandidateWords }, c.fit, `${c.id}: fit`);
    if (c.fit.droppedTurns || c.fit.answeredShrunk || c.fit.droppedCandidateWords) fitted++;
    const s = Seq.buildSequence(tok, c.serialized, head, fixture.max_len);
    assert.deepEqual(s.ids, c.ids, `${c.id}: ids`);
    assert.deepEqual(s.markers, c.markers, `${c.id}: markers`);
    assert.deepEqual(
      { state_tokens: s.truncation.stateTokens, state_tokens_used: s.truncation.stateTokensUsed, state_tokens_dropped: s.truncation.stateTokensDropped, truncated: s.truncation.truncated },
      c.truncation, `${c.id}: truncation`);
  }
  assert.ok(fitted >= 1, 'the fixtures must include at least one state the fit had to shrink');
  assert.ok(fixture.cases.some((c) => c.serialized.includes('[MASK]')) || fixture.cases.some((c) => c.fields.candidate.includes('[MASK]')), 'a mask-token case is covered');
});

test('decodeChoice reproduces Laya\'s probabilities and both confidences from the same logits', () => {
  const q = Seq.toInternalChoice(State.DECIDER_QUESTION);
  const cal = { temperature: fixture.calibration.temperature, temperatureByOptions: fixture.calibration.temperature_by_options };
  for (const c of fixture.cases) {
    const a = Seq.decodeChoice(c.logits, q, c.markers.length, cal);
    assert.equal(a.choice, c.answer.choice, `${c.id}: choice`);
    for (const [k, v] of Object.entries(c.answer.probabilities)) assert.ok(Math.abs(a.probabilities[k] - v) <= 1e-4, `${c.id}: p(${k}) ${a.probabilities[k]} vs ${v}`);
    assert.ok(Math.abs(a.confidence - c.answer.confidence) <= 1e-4, `${c.id}: confidence`);
    assert.ok(Math.abs(a.answerConfidence - c.answer.answer_confidence) <= 1e-4, `${c.id}: answer_confidence`);
  }
});

test('build_head\'s caps match Python on long and many options (the §4 question never reaches them)', async () => {
  const tok = await tokP;
  assert.ok(fixture.head_cases.length >= 3);
  for (const h of fixture.head_cases) {
    const iq = Seq.toInternalChoice(h.question);
    assert.deepEqual(iq, h.internal);
    const head = Seq.buildHead(tok, iq, fixture.head_max_len);
    assert.deepEqual(head.ids, h.ids, `${JSON.stringify(Object.keys(iq.crit))}: ids`);
    assert.deepEqual(head.markers, h.markers);
    assert.deepEqual({ options: head.stats.options, options_distinct: head.stats.optionsDistinct, tokens_per_option: head.stats.tokensPerOption }, h.stats);
  }
  assert.ok(fixture.head_cases.some((h) => h.stats.tokens_per_option !== null), 'a per-option cut is covered');
});

test('collate pads to the batch length and always allocates at least 2 marker columns', async () => {
  const one = { ids: [1, 2, 3], markers: [1], truncation: {} };
  const alone = Seq.collate([one], 9);
  assert.equal(alone.markerCols, 2, 'a batch of only one-option rows still gets 2 columns');
  assert.deepEqual(Array.from(alone.markerMask), [1, 0]);
  const two = { ids: [1, 2, 3, 4, 5], markers: [1, 3], truncation: {} };
  const b = Seq.collate([one, two], 9);
  assert.equal(b.length, 5);
  assert.equal(b.markerCols, 2, 'a one-option row still gets 2 columns');
  assert.deepEqual(Array.from(b.inputIds, Number), [1, 2, 3, 9, 9, 1, 2, 3, 4, 5]);
  assert.deepEqual(Array.from(b.attentionMask, Number), [1, 1, 1, 0, 0, 1, 1, 1, 1, 1]);
  assert.deepEqual(Array.from(b.markerMask), [1, 0, 1, 1]);
  assert.deepEqual(Array.from(b.qtype, Number), [0, 0]);
});

test('clampTemperature follows Python: non-numbers → 1, out of range → the bound', () => {
  assert.equal(Seq.clampTemperature(Number.NaN), 1);
  assert.equal(Seq.clampTemperature(Infinity), 1);
  assert.equal(Seq.clampTemperature(0.1006), 0.5);
  assert.equal(Seq.clampTemperature(-3), 0.5);
  assert.equal(Seq.clampTemperature(9), 5);
  assert.equal(Seq.clampTemperature(1.76), 1.76);
});

const ONNX_DIR = process.env.DECIDER_ONNX_DIR;
async function onnxRunner() {
  const ort = await import('onnxruntime-node');
  const tok = await tokP;
  const head = Seq.buildHead(tok, Seq.toInternalChoice(State.DECIDER_QUESTION), fixture.head_max_len);
  const run = async (sess, seq) => {
    const b = Seq.collate([seq], tok.padTokenId);
    const out = await sess.run({
      input_ids: new ort.Tensor('int64', b.inputIds, [1, b.length]),
      attention_mask: new ort.Tensor('int64', b.attentionMask, [1, b.length]),
      marker_pos: new ort.Tensor('int64', b.markerPos, [1, b.markerCols]),
      marker_mask: new ort.Tensor('bool', b.markerMask, [1, b.markerCols]),
      qtype: new ort.Tensor('int64', b.qtype, [1]),
    });
    return Array.from(out.logits.data).slice(0, seq.markers.length);
  };
  const seqOf = (c) => Seq.buildSequence(tok, c.serialized, head, fixture.max_len);
  return { ort, run, seqOf };
}
const argmax = (xs) => xs.indexOf(Math.max(...xs));

// Measured 2026-11-10 on the ZERO-SHOT export: fp32 passes on all 303 cases.
test('ONNX fp32 through onnxruntime-node: logits within 1e-3 of Python on every case', { skip: !ONNX_DIR && 'set DECIDER_ONNX_DIR to run the model' }, async () => {
  const { ort, run, seqOf } = await onnxRunner();
  const fp32 = await ort.InferenceSession.create(path.join(ONNX_DIR, 'laya.onnx'));
  for (const c of fixture.cases) {
    const l = await run(fp32, seqOf(c));
    l.forEach((v, i) => assert.ok(Math.abs(v - c.logits[i]) <= 1e-3, `${c.id}: fp32 logit ${i} ${v} vs ${c.logits[i]}`));
  }
});

// The bar for the FINE-TUNED int8 export (Phase 3.4). The zero-shot int8 graph fails it:
// 196/303 argmax agreement with fp32, measured 2026-11-10 (Phase 0 saw 164/187 vs torch).
test('ONNX int8: same argmax as fp32 on >= 99% of cases', { skip: !(ONNX_DIR && fs.existsSync(path.join(ONNX_DIR ?? '', 'laya.int8.onnx'))) && 'set DECIDER_ONNX_DIR with laya.int8.onnx' }, async () => {
  const { ort, run, seqOf } = await onnxRunner();
  const int8 = await ort.InferenceSession.create(path.join(ONNX_DIR, 'laya.int8.onnx'));
  let same = 0;
  for (const c of fixture.cases) if (argmax(await run(int8, seqOf(c))) === argmax(c.logits)) same++;
  assert.ok(same / fixture.cases.length >= 0.99, `int8 argmax agreement ${same}/${fixture.cases.length}`);
});
