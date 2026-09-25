import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PARAKEET_TDT_REQUIRED_FILES, PARAKEET_TDT_REPO } from '../downloadFiles.ts';

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
});
