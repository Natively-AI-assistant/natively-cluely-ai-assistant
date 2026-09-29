// tests/meeting-memory/live-audio/chunk-ab.mjs
//
// Replays a live run's REAL STT transcript through the chunker before and after
// the exchange-chunking change, so both are judged on the same speech:
//   node tests/meeting-memory/live-audio/chunk-ab.mjs <results.json> [--before <git-rev>]
//
// Q/A cohesion = of every question turn answered by the other party, how many
// end up in a chunk that ALSO holds the answer. Labels = chunks whose text says
// who spoke each line.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const file = args[0];
const before = args.includes('--before') ? args[args.indexOf('--before') + 1] : 'c628a6e3~1';

function buildChunker(rev) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chunk-ab-'));
  for (const f of ['SemanticChunker.ts', 'TranscriptPreprocessor.ts']) {
    const src = rev ? execFileSync('git', ['show', `${rev}:electron/rag/${f}`], { cwd: ROOT, encoding: 'utf8' })
      : fs.readFileSync(path.join(ROOT, 'electron', 'rag', f), 'utf8');
    fs.writeFileSync(path.join(dir, f), src);
  }
  const outFile = path.join(dir, 'chunker.cjs');
  execFileSync(path.join(ROOT, 'node_modules', '.bin', 'esbuild'), [path.join(dir, 'SemanticChunker.ts'), '--bundle', '--platform=node', '--format=cjs', `--outfile=${outFile}`, '--log-level=error']);
  const pre = path.join(dir, 'pre.cjs');
  execFileSync(path.join(ROOT, 'node_modules', '.bin', 'esbuild'), [path.join(dir, 'TranscriptPreprocessor.ts'), '--bundle', '--platform=node', '--format=cjs', `--outfile=${pre}`, '--log-level=error']);
  return { chunkTranscript: require(outFile).chunkTranscript, preprocessTranscript: require(pre).preprocessTranscript };
}

const run = JSON.parse(fs.readFileSync(file, 'utf8'));
const segs = (run.transcript ?? []).filter((s) => s.speaker === 'interviewer' || s.speaker === 'user');
if (!segs.length) throw new Error('no transcript in the results file');

function measure({ chunkTranscript, preprocessTranscript }) {
  const cleaned = preprocessTranscript(segs.map((s) => ({ speaker: s.speaker, text: s.text, timestamp: s.timestamp })));
  const chunks = chunkTranscript('ab', cleaned);
  let pairs = 0;
  let together = 0;
  for (let i = 0; i < cleaned.length - 1; i++) {
    const q = cleaned[i];
    const a = cleaned[i + 1];
    if (!(q.isQuestion || /\?\s*$/.test(q.text)) || a.speaker === q.speaker) continue;
    pairs++;
    if (chunks.some((c) => c.text.includes(q.text) && c.text.includes(a.text))) together++;
  }
  const tokens = chunks.map((c) => c.tokenCount);
  return {
    turns: cleaned.length,
    chunks: chunks.length,
    medianTokens: tokens.sort((x, y) => x - y)[Math.floor(tokens.length / 2)],
    qaPairs: pairs,
    qaTogether: together,
    labelled: chunks.filter((c) => /^(ME|THEM): /m.test(c.text)).length,
  };
}

const a = measure(buildChunker(before));
const b = measure(buildChunker(null));
console.log(JSON.stringify({ transcriptSegments: segs.length, before: a, after: b }, null, 2));
