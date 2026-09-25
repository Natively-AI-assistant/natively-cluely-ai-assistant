import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { Tensor } from 'onnxruntime-node';
import { PARAKEET_TDT_REQUIRED_FILES, PARAKEET_TDT_REPO } from '../downloadFiles.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distEnginePath = path.resolve(
  __dirname,
  '../../../../../dist-electron/electron/audio/whisper/parakeet/parakeetTdtEngine.js',
);
const distTokenizerPath = path.resolve(
  __dirname,
  '../../../../../dist-electron/electron/audio/whisper/parakeet/tokenizer.js',
);

const { ParakeetTdtEngine } = await import(pathToFileURL(distEnginePath).href);
const { ParakeetTokenizer } = await import(pathToFileURL(distTokenizerPath).href);

describe('Parakeet TDT Download & Engine Config', () => {
  test('declares all 5 required files and correct repo', () => {
    assert.equal(PARAKEET_TDT_REPO, 'istupakov/parakeet-tdt-0.6b-v3-onnx');
    assert.ok(PARAKEET_TDT_REQUIRED_FILES.includes('encoder-model.int8.onnx'));
    assert.ok(PARAKEET_TDT_REQUIRED_FILES.includes('decoder_joint-model.int8.onnx'));
    assert.ok(PARAKEET_TDT_REQUIRED_FILES.includes('nemo128.onnx'));
    assert.ok(PARAKEET_TDT_REQUIRED_FILES.includes('vocab.txt'));
    assert.ok(PARAKEET_TDT_REQUIRED_FILES.includes('config.json'));
    assert.equal(PARAKEET_TDT_REQUIRED_FILES.length, 5);
  });

  test('exercises transcribe() inference path with preprocessor, encoder, and joint sessions', async () => {
    let preprocCalled = false;
    let encoderCalled = false;
    let jointCalls = 0;

    const mockPreprocessor = {
      outputNames: ['features', 'features_lens'],
      run: async (feeds) => {
        preprocCalled = true;
        assert.ok(feeds.audio_signal, 'preprocessor must receive audio_signal');
        assert.ok(feeds.length, 'preprocessor must receive length');
        return {
          features: new Tensor('float32', new Float32Array(1 * 128 * 2), [1, 128, 2]),
          features_lens: new Tensor('int64', new BigInt64Array([2n]), [1]),
        };
      },
    };

    const mockEncoder = {
      outputNames: ['outputs', 'encoded_lengths'],
      run: async (feeds) => {
        encoderCalled = true;
        assert.ok(feeds.audio_signal, 'encoder must receive features');
        assert.ok(feeds.length, 'encoder must receive length');
        return {
          outputs: new Tensor('float32', new Float32Array(1 * 640 * 2), [1, 640, 2]),
          encoded_lengths: new Tensor('int64', new BigInt64Array([2n]), [1]),
        };
      },
    };

    const mockDecoderJoint = {
      outputNames: ['outputs', 'output_states_1', 'output_states_2'],
      inputNames: ['encoder_outputs', 'targets', 'target_length', 'input_states_1', 'input_states_2'],
      run: async (feeds) => {
        jointCalls++;
        assert.ok(feeds.encoder_outputs, 'joint must receive encoder_outputs');
        assert.ok(feeds.targets, 'joint must receive targets');
        assert.ok(feeds.input_states_1, 'joint must receive input_states_1');
        assert.ok(feeds.input_states_2, 'joint must receive input_states_2');

        // vocab: 4 tokens (0: pad, 1: hello, 2: world, 3: blank), 5 durations (0..4) -> 9 logits
        // Return token 1 ("hello"), duration step 2 (leaps to end)
        const logits = new Float32Array([
          0, 10, 0, 0, // token 1
          0, 0, 10, 0, 0 // duration 2
        ]);
        return {
          outputs: new Tensor('float32', logits, [1, 1, 9]),
          output_states_1: new Tensor('float32', new Float32Array(2 * 1 * 640), [2, 1, 640]),
          output_states_2: new Tensor('float32', new Float32Array(2 * 1 * 640), [2, 1, 640]),
        };
      },
    };

    const vocabContent = '<pad> 0\n hello 1\n world 2\n<blk> 3';
    const tokenizer = new ParakeetTokenizer(vocabContent);
    const mockShared = {
      preprocessorSession: mockPreprocessor,
      encoderSession: mockEncoder,
      decoderJointSession: mockDecoderJoint,
      tokenizer,
      state1Shape: [2, 1, 640],
      state2Shape: [2, 1, 640],
      vocabSize: 4,
      blankId: 3,
    };

    const engine = await ParakeetTdtEngine.create('dummy-path', ['cpu'], mockShared);
    const audio = new Float32Array(3200); // 200ms at 16kHz
    const result = await engine.transcribe(audio);

    assert.ok(preprocCalled, 'Preprocessor must be called');
    assert.ok(encoderCalled, 'Encoder must be called');
    assert.ok(jointCalls > 0, 'Joint session must be called');
    assert.equal(result.text, 'hello');
    assert.deepEqual(result.tokenIds, [1]);
  });

  test('exercises pushAudio() and flush() chunk streaming flow', async () => {
    const mockPreprocessor = {
      outputNames: ['features', 'features_lens'],
      run: async () => ({
        features: new Tensor('float32', new Float32Array(1 * 128 * 2), [1, 128, 2]),
        features_lens: new Tensor('int64', new BigInt64Array([2n]), [1]),
      }),
    };
    const mockEncoder = {
      outputNames: ['outputs', 'encoded_lengths'],
      run: async () => ({
        outputs: new Tensor('float32', new Float32Array(1 * 640 * 2), [1, 640, 2]),
        encoded_lengths: new Tensor('int64', new BigInt64Array([2n]), [1]),
      }),
    };
    const mockDecoderJoint = {
      outputNames: ['outputs', 'output_states_1', 'output_states_2'],
      inputNames: ['encoder_outputs', 'targets', 'target_length', 'input_states_1', 'input_states_2'],
      run: async () => ({
        outputs: new Tensor('float32', new Float32Array([0, 10, 0, 0, 0, 0, 10, 0, 0]), [1, 1, 9]),
        output_states_1: new Tensor('float32', new Float32Array(2 * 1 * 640), [2, 1, 640]),
        output_states_2: new Tensor('float32', new Float32Array(2 * 1 * 640), [2, 1, 640]),
      }),
    };

    const vocabContent = '<pad> 0\n hello 1\n world 2\n<blk> 3';
    const tokenizer = new ParakeetTokenizer(vocabContent);
    const mockShared = {
      preprocessorSession: mockPreprocessor,
      encoderSession: mockEncoder,
      decoderJointSession: mockDecoderJoint,
      tokenizer,
      state1Shape: [2, 1, 640],
      state2Shape: [2, 1, 640],
      vocabSize: 4,
      blankId: 3,
    };

    const engine = await ParakeetTdtEngine.create('dummy-path', ['cpu'], mockShared);

    // Short chunk buffers without running (< 3200 samples)
    const shortChunk = new Float32Array(1000);
    const partial1 = await engine.pushAudio(shortChunk);
    assert.equal(partial1.text, '');

    // Second chunk reaches threshold and processes
    const fullChunk = new Float32Array(2500);
    const partial2 = await engine.pushAudio(fullChunk);
    assert.equal(partial2.text, 'hello');

    // flush() cleans out any remaining audio
    const flushRes = await engine.flush();
    assert.equal(flushRes.isFinal, true);
  });
});
