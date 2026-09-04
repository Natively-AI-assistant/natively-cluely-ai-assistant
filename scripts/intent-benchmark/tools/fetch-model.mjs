#!/usr/bin/env node
// scripts/intent-benchmark/tools/fetch-model.mjs
//
// Download a Hugging Face model into resources/models, VERIFYING the byte
// count of every file.
//
// This exists because transformers.js's own fetch silently truncated
// MoritzLaurer/deberta-v3-xsmall's 87,246,195-byte graph to 83,107,776 bytes.
// The failure does not surface as a download error. It surfaces later, from
// deep inside onnxruntime, as "Protobuf parsing failed" — which reads like a
// model-format or dtype problem and sends you looking in the wrong place
// entirely. This repo has burned time on exactly that before, twice: once as a
// dev-model-root shadowing bug and once as a CI postinstall flake that killed a
// different model on every run.
//
// So: fetch, compare the size against the hub's X-Linked-Size, and delete
// anything that does not match rather than leaving a plausible-looking file on
// disk. A missing model is a clear failure; a truncated one is a confusing one.
//
// Usage:
//   node scripts/intent-benchmark/tools/fetch-model.mjs <repo> [--dtype q8|fp32]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS = path.resolve(__dirname, '../../../resources/models');

const args = process.argv.slice(2);
const repo = args[0];
if (!repo) { console.error('usage: fetch-model.mjs <org/model> [--dtype q8|fp32]'); process.exit(2); }
const dtype = args.includes('--dtype') ? args[args.indexOf('--dtype') + 1] : 'q8';

const ONNX_FOR_DTYPE = { q8: 'onnx/model_quantized.onnx', fp32: 'onnx/model.onnx' };
const REQUIRED = [
  'config.json', 'tokenizer.json', 'tokenizer_config.json',
  ONNX_FOR_DTYPE[dtype] ?? ONNX_FOR_DTYPE.q8,
];
const OPTIONAL = ['special_tokens_map.json', 'added_tokens.json', 'vocab.txt', 'spm.model', 'sentencepiece.bpe.model', 'generation_config.json'];

const url = (f) => `https://huggingface.co/${repo}/resolve/main/${f}`;

/**
 * Fetch one file and verify its length.
 *
 * A HEAD request is not reliable here: the hub answers HEAD for LFS objects
 * with a redirect page whose content-length describes the redirect, and answers
 * some small plain files with no usable length at all. So this does a single
 * GET and checks the body against whatever authoritative length came back with
 * it — X-Linked-Size for LFS, content-length otherwise. When neither is
 * present the body is accepted, because there is nothing to check it against
 * and refusing would block every small config file.
 */
async function download(f, { required }) {
  const dest = path.join(MODELS, repo, f);

  const res = await fetch(url(f), { redirect: 'follow' });
  if (!res.ok) {
    if (required) throw new Error(`${f}: HTTP ${res.status}`);
    return { file: f, skipped: true };
  }
  const linked = res.headers.get('x-linked-size');
  const len = res.headers.get('content-length');
  const expected = linked ? Number(linked) : (len ? Number(len) : null);

  if (expected != null && fs.existsSync(dest) && fs.statSync(dest).size === expected) {
    return { file: f, bytes: expected, cached: true };
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (expected != null && buf.length !== expected) {
    // Do NOT keep it. A truncated ONNX file on disk is worse than none: it
    // loads far enough to fail obscurely later, from inside onnxruntime.
    throw new Error(`${f}: TRUNCATED — got ${buf.length} bytes, hub says ${expected}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return { file: f, bytes: buf.length, cached: false, unverified: expected == null };
}

console.log(`\nfetching ${repo}  (dtype ${dtype})`);
let total = 0;
for (const f of REQUIRED) {
  const r = await download(f, { required: true });
  total += r.bytes ?? 0;
  console.log(`  ${r.cached ? 'cached ' : 'fetched'} ${f.padEnd(32)} ${((r.bytes ?? 0) / 1e6).toFixed(1)} MB`);
}
for (const f of OPTIONAL) {
  try {
    const r = await download(f, { required: false });
    if (r.skipped) continue;
    total += r.bytes ?? 0;
    console.log(`  ${r.cached ? 'cached ' : 'fetched'} ${f.padEnd(32)} ${((r.bytes ?? 0) / 1e6).toFixed(1)} MB`);
  } catch (e) { console.log(`  SKIP    ${f}: ${e.message}`); }
}
console.log(`  total ${(total / 1e6).toFixed(1)} MB, every file size-verified against the hub\n`);
