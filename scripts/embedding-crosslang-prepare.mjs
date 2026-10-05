#!/usr/bin/env node
// scripts/embedding-crosslang-prepare.mjs
//
// R&D ONLY. Builds the ENGLISH-QUERY → HINDI-DOCUMENT cross-language track.
//
// Six English prose documents that the text track asks about are REPLACED by
// Hindi translations (embedding-benchmark/corpus-crosslang/hi/, identifiers and
// code left in Latin script, as a Hindi engineering doc would be written). The
// other 53 corpus files stay English and act as distractors. The unchanged
// English questions are then asked against:
//
//   snapshot-en2hi.json          — the six files in Hindi
//   snapshot-en2hi-control.json  — the six files in English (same everything else)
//
// Relevance is FILE-level in both (any chunk of a required file), because chunk
// boundaries of a translation cannot be aligned to the English ground truth.
// The two snapshots share the same questions and scoring, so the per-question
// difference is the cost of crossing languages and nothing else.
//
// The reverse direction (Hindi question → English document) needs no new
// documents: embedding-benchmark/queries/crosslang_hi_to_en.json reuses the
// main snapshot's chunk-level ground truth unchanged.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HI_ROOT = path.join(REPO, 'embedding-benchmark', 'corpus-crosslang', 'hi');
const OUT_DIR = path.join(REPO, 'results', 'crosslang');
const { semanticChunks, DEFAULT_CHUNK_OPTIONS } =
  await import(path.join(REPO, 'dist-electron/electron/services/modes/semanticChunker.js'));

const TRANSLATED = [
  'projects/project-a/README.md',
  'projects/project-a/docs/architecture.md',
  'projects/project-a/docs/billing-v2.md',
  'projects/project-a/docs/deployment.md',
  'projects/project-a/docs/authentication.md',
  'projects/project-b/docs/metrics.md',
];
const translated = new Set(TRANSLATED);
const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();

const base = JSON.parse(fs.readFileSync(path.join(REPO, 'results', 'corpus-snapshot.json'), 'utf8'));

// Single-file questions about a translated document, from every track that has them.
const queries = base.queries.filter((q) => q.required_files?.length === 1 && translated.has(q.required_files[0]));

function build(useHindi) {
  const chunks = base.chunks.filter((c) => !(useHindi && translated.has(c.file)));
  if (useHindi) {
    for (const rel of TRANSLATED) {
      const content = fs.readFileSync(path.join(HI_ROOT, rel), 'utf8');
      semanticChunks(content, { ...DEFAULT_CHUNK_OPTIONS }).forEach((c, i) => {
        const text = typeof c === 'string' ? c : (c.text ?? String(c));
        chunks.push({ id: `hi:${rel}#${i}`, file: rel, idx: i, text, normText: norm(text), lang: 'hi' });
      });
    }
  }
  const idsByFile = new Map();
  for (const c of chunks) { if (!idsByFile.has(c.file)) idsByFile.set(c.file, []); idsByFile.get(c.file).push(c.id); }
  const qs = queries.map((q) => ({ ...q, relevantChunkIds: idsByFile.get(q.required_files[0]) || [], relevance: 'file' }));
  for (const q of qs) if (!q.relevantChunkIds.length) throw new Error(`${q.query_id}: no chunks for ${q.required_files[0]}`);
  return {
    ...base,
    generatedAt: new Date().toISOString(),
    crosslang: { direction: 'en-query → hi-document', documentsInHindi: useHindi, translated: TRANSLATED, relevance: 'file' },
    chunks, queries: qs,
    // Same formula as embedding-corpus-prepare.mjs and the bench's check, whose
    // separators are the control bytes NUL and SOH (invisible in most viewers;
    // copying them as a space and '' is how the first build of this file broke).
    chunkSetSha256: crypto.createHash('sha256').update(chunks.map((c) => c.id + '\u0000' + c.text).join('\u0001')).digest('hex'),
  };
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const [name, useHindi] of [['snapshot-en2hi.json', true], ['snapshot-en2hi-control.json', false]]) {
  const snap = build(useHindi);
  fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(snap));
  const hiChunks = snap.chunks.filter((c) => c.lang === 'hi').length;
  console.log(`${name}: ${snap.chunks.length} chunks (${hiChunks} Hindi), ${snap.queries.length} questions`);
}
const byTrack = queries.reduce((a, q) => { a[q.track] = (a[q.track] || 0) + 1; return a; }, {});
console.log('questions by track:', JSON.stringify(byTrack));
