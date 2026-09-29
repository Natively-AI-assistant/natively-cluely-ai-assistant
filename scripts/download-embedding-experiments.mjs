#!/usr/bin/env node
// scripts/download-embedding-experiments.mjs
//
// R&D ONLY. Downloads the local-embedding bake-off candidates into an isolated
// cache. Nothing here touches `resources/models/`, so the bundled MiniLM the
// production build ships with is never read, written or shadowed.
//
// Layout — one directory per candidate, so no two models can ever share a
// transformers.js `localModelPath` and pick up each other's config:
//
//   <cache>/<key>/<org>/<name>/config.json
//                              tokenizer.json
//                              tokenizer_config.json
//                              onnx/model_quantized.onnx
//
// which makes `<cache>/<key>` a valid NATIVELY_LOCAL_MODELS_PATH.
//
// Every file is fetched at the PINNED REVISION from embeddingExperiments.ts —
// never `main` — and its sha256 is recorded in `manifest.json` beside it, so a
// later run can prove it measured the same bytes.
//
// Usage:
//   node scripts/download-embedding-experiments.mjs            # all candidates
//   node scripts/download-embedding-experiments.mjs arctic-s   # just one

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const CACHE_ROOT = process.env.NATIVELY_EMBEDDING_EXPERIMENT_CACHE
  || path.join(os.homedir(), 'Library', 'Application Support', 'natively', 'embedding-experiments');

// Mirrors embeddingExperiments.ts. Kept as plain data here because this script
// runs under bare node, outside the electron TS build.
const CANDIDATES = {
  // The embedder bundled until 2026-09-21. Revision verified byte-identical
  // (sha256 of all four files) to the copy that shipped in resources/models.
  'minilm-baseline':       { repo: 'Xenova/all-MiniLM-L6-v2',             revision: '751bff37182d3f1213fa05d7196b954e230abad9', modelId: 'Xenova/all-MiniLM-L6-v2' },
  'arctic-xs':             { repo: 'Snowflake/snowflake-arctic-embed-xs', revision: 'd8c86521100d3556476a063fc2342036d45c106f', modelId: 'Snowflake/snowflake-arctic-embed-xs' },
  'arctic-s':              { repo: 'Snowflake/snowflake-arctic-embed-s',  revision: 'e596f507467533e48a2e17c007f0e1dacc837b33', modelId: 'Snowflake/snowflake-arctic-embed-s' },
  'arctic-m':              { repo: 'Snowflake/snowflake-arctic-embed-m',  revision: 'fc74610d18462d218e312aa986ec5c8a75a98152', modelId: 'Snowflake/snowflake-arctic-embed-m' },
  'bge-small-en':          { repo: 'Xenova/bge-small-en-v1.5',            revision: 'ea104dacec62c0de699686887e3f920caeb4f3e3', modelId: 'Xenova/bge-small-en-v1.5' },
  'e5-small-v2':           { repo: 'Xenova/e5-small-v2',                  revision: '02af79985278377e65c724a76275707cb0333c70', modelId: 'Xenova/e5-small-v2' },
  'gte-small':             { repo: 'Xenova/gte-small',                    revision: '5927d1727bb12db490052a1b33265ad78058de08', modelId: 'Xenova/gte-small' },
  'nomic-v1.5':            { repo: 'nomic-ai/nomic-embed-text-v1.5',      revision: 'e9b6763023c676ca8431644204f50c2b100d9aab', modelId: 'nomic-ai/nomic-embed-text-v1.5' },
  'multilingual-e5-small': { repo: 'Xenova/multilingual-e5-small',        revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78', modelId: 'Xenova/multilingual-e5-small' },
  // Round 2 — widest variant of each family that fits the 500 MiB cap.
  // Xenova/multilingual-e5-large is deliberately absent: 552.0 MiB installed.
  'arctic-l':             { repo: 'Snowflake/snowflake-arctic-embed-l',   revision: 'd8fb21ca8d905d2832ee8b96c894d3298964346b', modelId: 'Snowflake/snowflake-arctic-embed-l' },
  'bge-large-en':         { repo: 'Xenova/bge-large-en-v1.5',             revision: 'dfeef6070b90658e1b391a6940efdb0925c1de6f', modelId: 'Xenova/bge-large-en-v1.5' },
  'e5-large-v2':          { repo: 'Xenova/e5-large-v2',                   revision: '840fd2207f68e253697ed85392a482ff7657ad11', modelId: 'Xenova/e5-large-v2' },
  'gte-large':            { repo: 'Xenova/gte-large',                     revision: '06a8d51d496ebe830042b7323a904b4da81ac500', modelId: 'Xenova/gte-large' },
  'multilingual-e5-base': { repo: 'Xenova/multilingual-e5-base',          revision: '1ec9243030a27d1a115d5c340572074c125b58b2', modelId: 'Xenova/multilingual-e5-base' },
  // Round 3 — larger models proposed for high-end machines (not under the 500 MiB cap).
  'qwen3-embedding-0.6b': { repo: 'onnx-community/Qwen3-Embedding-0.6B-ONNX', revision: 'c25a394dd583836952667c12f008335071b3f43d', modelId: 'onnx-community/Qwen3-Embedding-0.6B-ONNX' },
  'arctic-l-v2':          { repo: 'Snowflake/snowflake-arctic-embed-l-v2.0',  revision: 'ac6544c8a46e00af67e330e85a9028c66b8cfd9a', modelId: 'Snowflake/snowflake-arctic-embed-l-v2.0' },
  'mxbai-large-v1':       { repo: 'mixedbread-ai/mxbai-embed-large-v1',       revision: 'b33106f585b9ce46904ad7443a3b52b7a63e231c', modelId: 'mixedbread-ai/mxbai-embed-large-v1' },
};

// What transformers.js actually opens for a feature-extraction pipeline at
// dtype 'q8'. `tokenizer_config.json` is optional in a few repos; the rest are
// load-blocking, so a miss on those is a BLOCKED candidate, not a warning.
const REQUIRED = ['config.json', 'tokenizer.json', 'onnx/model_quantized.onnx'];
const OPTIONAL = ['tokenizer_config.json', 'special_tokens_map.json'];

async function fetchTo(repo, revision, rel, dest) {
  const url = `https://huggingface.co/${repo}/resolve/${revision}/${rel}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'natively-embedding-experiments' } });
  if (!res.ok) return { ok: false, status: res.status };
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return {
    ok: true,
    bytes: buf.length,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
  };
}

async function download(key) {
  const c = CANDIDATES[key];
  if (!c) throw new Error(`unknown candidate ${key}`);
  const base = path.join(CACHE_ROOT, key, ...c.modelId.split('/'));
  const manifestPath = path.join(CACHE_ROOT, key, 'manifest.json');

  if (fs.existsSync(manifestPath)) {
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (m.revision === c.revision && m.complete) {
      console.log(`[emb-exp] ${key}: already present at ${c.revision.slice(0, 10)} (${(m.installedBytes / 1e6).toFixed(1)} MB)`);
      return m;
    }
  }

  console.log(`[emb-exp] ${key}: downloading ${c.repo}@${c.revision.slice(0, 10)}`);
  const files = {};
  for (const rel of REQUIRED) {
    const r = await fetchTo(c.repo, c.revision, rel, path.join(base, rel));
    if (!r.ok) {
      const m = { key, ...c, complete: false, blocked: `HTTP ${r.status} for required ${rel}` };
      fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
      fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2));
      console.log(`[emb-exp] ${key}: BLOCKED — ${m.blocked}`);
      return m;
    }
    files[rel] = { bytes: r.bytes, sha256: r.sha256 };
    console.log(`           ${rel.padEnd(30)} ${(r.bytes / 1e6).toFixed(2).padStart(8)} MB  ${r.sha256.slice(0, 16)}`);
  }
  for (const rel of OPTIONAL) {
    const r = await fetchTo(c.repo, c.revision, rel, path.join(base, rel));
    if (r.ok) files[rel] = { bytes: r.bytes, sha256: r.sha256 };
  }

  // INSTALLED SIZE = exactly the bytes that landed on disk for this candidate.
  // Not the HF repo size: the repo also carries fp32/fp16/bnb4/q4/uint8 siblings
  // and training artifacts that Natively would never copy.
  const installedBytes = Object.values(files).reduce((a, f) => a + f.bytes, 0);
  const m = { key, ...c, complete: true, files, installedBytes, downloadedAt: new Date().toISOString() };
  fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2));
  console.log(`[emb-exp] ${key}: INSTALLED ${(installedBytes / 1e6).toFixed(1)} MB (cap 500 MiB → ${installedBytes <= 500 * 1024 * 1024 ? 'PASS' : 'FAIL'})`);
  return m;
}

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CANDIDATES);
const results = [];
for (const k of wanted) results.push(await download(k));

console.log('\n=== installed size summary ===');
for (const m of results) {
  if (!m.complete) { console.log(`${m.key.padEnd(24)} BLOCKED  ${m.blocked}`); continue; }
  const mib = m.installedBytes / 1024 / 1024;
  console.log(`${m.key.padEnd(24)} ${mib.toFixed(1).padStart(7)} MiB  ${mib <= 500 ? 'PASS' : 'FAIL — over 500 MiB cap'}`);
}
console.log(`\ncache root: ${CACHE_ROOT}`);
