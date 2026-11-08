// Auto Detect (one language check per final) and the encoder reuse in
// whisperWorker.ts lean on three transformers.js internals that are not part
// of its public API:
//  1. model._prepare_encoder_decoder_kwargs_for_generation() runs the encoder
//     and returns it as model_inputs.encoder_outputs;
//  2. model({ encoder_outputs, decoder_input_ids }) skips the encoder
//     (seq2seqForward) and returns the first-step logits;
//  3. generate() skips the encoder when 'encoder_outputs' is in model_inputs,
//     once the worker adds it to WhisperPreTrainedModel.forward_params.
// The version is pinned exactly in package.json, and this file checks those
// internals on the installed copy, so an upgrade fails here first instead of
// quietly falling back to English or to a second encoder pass in a meeting.
// After upgrading run `npm run verify:transformers`: it runs this file, then
// the real compiled worker on a French/English/French recording, and only then
// records the version in transformersVerified.json (never edit that by hand).
//
// Run: ELECTRON_RUN_AS_NODE=1 npx electron --test electron/audio/whisper/__tests__/WhisperInternalsContract2026_10_21.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const VERIFIED_VERSIONS = JSON.parse(
  fs.readFileSync(path.join(repo, 'electron/audio/whisper/transformersVerified.json'), 'utf8'),
).verified.map((v) => v.version);
const PKG = '@huggingface/transformers';

const readJson = (p) => JSON.parse(fs.readFileSync(path.join(repo, p), 'utf8'));

test('transformers.js is pinned to a version whose internals were verified', () => {
  const declared = readJson('package.json').dependencies[PKG];
  assert.match(declared, /^\d+\.\d+\.\d+$/, `${PKG} must be an exact version, not a range ("${declared}")`);
  // verify-transformers-upgrade.mjs runs this file before it records the version.
  if (process.env.NATIVELY_TRANSFORMERS_VERIFYING !== declared) {
    assert.ok(VERIFIED_VERSIONS.includes(declared), `${PKG} ${declared} has not been verified: run npm run verify:transformers`);
  }
  const lock = readJson('package-lock.json');
  assert.equal(lock.packages[''].dependencies[PKG], declared, 'package-lock root entry');
  assert.equal(lock.packages[`node_modules/${PKG}`].version, declared, 'package-lock resolved version');
  assert.equal(readJson(`node_modules/${PKG}/package.json`).version, declared, 'installed version');
});

// The worker imports the package by name from Node (ESM), so does this test.
const lib = await import(PKG);

function fakeWhisper() {
  // No ONNX sessions are created: the constructor only stores what it is given.
  // whisper-tiny's sizes: the decoder path builds an empty key/value cache from them.
  const config = new lib.PretrainedConfig({
    model_type: 'whisper', is_encoder_decoder: true, d_model: 384,
    encoder_layers: 4, encoder_attention_heads: 6, decoder_layers: 4, decoder_attention_heads: 6,
  });
  return new lib.WhisperForConditionalGeneration(config, {}, {});
}

test('internal 1: the encoder helper runs the encoder once and returns encoder_outputs', async () => {
  const model = fakeWhisper();
  assert.equal(typeof model._prepare_encoder_decoder_kwargs_for_generation, 'function');
  const hidden = new lib.Tensor('float32', new Float32Array(4), [1, 2, 2]);
  const fed = [];
  model.sessions = {
    model: {
      inputNames: ['input_features'],
      outputNames: ['last_hidden_state'],
      run: async (feeds) => { fed.push(Object.keys(feeds)); return { last_hidden_state: hidden.ort_tensor }; },
    },
  };
  const input_features = new lib.Tensor('float32', new Float32Array(6), [1, 2, 3]);
  const out = await model._prepare_encoder_decoder_kwargs_for_generation({
    inputs_tensor: input_features,
    model_inputs: { input_features },
    model_input_name: 'input_features',
    generation_config: {},
  });
  assert.deepEqual(fed, [['input_features']], 'the encoder session ran once, on the features');
  assert.ok(out.encoder_outputs, 'encoder_outputs returned in model_inputs');
  assert.deepEqual(out.encoder_outputs.dims, [1, 2, 2]);
});

test('internal 2: a forward call given encoder_outputs runs only the decoder', async () => {
  const model = fakeWhisper();
  const ran = [];
  const logits = new lib.Tensor('float32', new Float32Array(3), [1, 1, 3]);
  model.sessions = {
    model: { inputNames: ['input_features'], outputNames: ['last_hidden_state'], run: async () => { ran.push('encoder'); return {}; } },
    decoder_model_merged: {
      inputNames: ['input_ids', 'encoder_hidden_states'],
      outputNames: ['logits'],
      run: async (feeds) => { ran.push(`decoder:${Object.keys(feeds).sort().join(',')}`); return { logits: logits.ort_tensor }; },
    },
  };
  const encoder_outputs = new lib.Tensor('float32', new Float32Array(4), [1, 2, 2]);
  const out = await model({
    encoder_outputs,
    decoder_input_ids: new lib.Tensor('int64', BigInt64Array.from([50258n]), [1, 1]),
  });
  assert.deepEqual(ran, ['decoder:encoder_hidden_states,input_ids']);
  assert.deepEqual(out.logits.dims, [1, 1, 3]);
});

test('internal 3: forward_params is the list generate() filters by, and generate() skips the encoder for encoder_outputs', () => {
  const model = fakeWhisper();
  assert.ok(Array.isArray(model.forward_params), 'forward_params is an own array the worker can extend');
  assert.ok(model.forward_params.includes('input_features'));
  const generate = Object.getPrototypeOf(Object.getPrototypeOf(model)).generate ?? model.generate;
  let src = '';
  for (let proto = Object.getPrototypeOf(model); proto; proto = Object.getPrototypeOf(proto)) {
    if (Object.prototype.hasOwnProperty.call(proto, 'generate')) src += proto.generate.toString();
  }
  assert.equal(typeof generate, 'function');
  assert.match(src, /!\('encoder_outputs' in model_inputs\)/, "generate() still checks 'encoder_outputs' in model_inputs");
});

test('the worker guards each internal and switches it off after repeated failures', () => {
  const src = fs.readFileSync(path.join(repo, 'electron/audio/whisper/whisperWorker.ts'), 'utf8');
  assert.match(src, /typeof model\._prepare_encoder_decoder_kwargs_for_generation !== 'function'/);
  assert.match(src, /if \(!Array\.isArray\(model\?\.forward_params\)\) return false;/);
  assert.match(src, /const INTERNALS_FAILURE_LIMIT = 3;/);
  assert.match(src, /\} else if \(internalsUsable\('detect'\)\) \{/);
  assert.match(src, /encoderOutputs && internalsUsable\('reuse'\) && letGenerateReuseEncoderOutputs\(pipe\.model\)/);
  assert.equal((src.match(/internalsResult\('detect', (true|false)/g) ?? []).length, 2);
  assert.equal((src.match(/internalsResult\('reuse', (true|false)/g) ?? []).length, 2);
});
