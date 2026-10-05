// scripts/inspect-nemotron-onnx.mjs
// One-off diagnostic: dumps ONNX Runtime's reported input/output metadata for
// the Nemotron encoder/decoder/joint graphs, and the tokenizer_config.json
// content. Run against a downloaded model directory. Kept in the repo because
// any future ONNX ASR model addition needs the same inspection step.
import { InferenceSession } from 'onnxruntime-node';
import { readFileSync } from 'fs';
import { join } from 'path';

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: node scripts/inspect-nemotron-onnx.mjs <model-dir>');
  process.exit(1);
}

function describe(meta) {
  return meta.map(m => ({
    name: m.name,
    isTensor: m.isTensor,
    type: m.isTensor ? m.type : undefined,
    shape: m.isTensor ? m.shape : undefined,
  }));
}

for (const graph of ['encoder.onnx', 'decoder.onnx', 'joint.onnx']) {
  const session = await InferenceSession.create(join(dir, graph), {
    executionProviders: ['cpu'],
  });
  console.log(`\n=== ${graph} ===`);
  console.log('inputNames:', session.inputNames);
  console.log('inputMetadata:', JSON.stringify(describe(session.inputMetadata), null, 2));
  console.log('outputNames:', session.outputNames);
  console.log('outputMetadata:', JSON.stringify(describe(session.outputMetadata), null, 2));
  await session.release();
}

console.log('\n=== tokenizer_config.json ===');
console.log(readFileSync(join(dir, 'tokenizer_config.json'), 'utf8'));
