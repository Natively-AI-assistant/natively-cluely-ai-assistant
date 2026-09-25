#!/usr/bin/env node
// scripts/embedding-corpus-prepare.mjs
//
// R&D ONLY. Phase A of the retrieval bake-off: extract and chunk the corpus
// ONCE, through Natively's real extractor and real chunker, and snapshot the
// result with a sha256.
//
// WHY ONCE (§19). Each candidate runs in its own process, because
// NATIVELY_EMBEDDING_EXPERIMENT is read when the provider is constructed. If
// every process re-chunked, "every model saw the same text" would be an
// assumption. The previous benchmark was bitten by exactly this: differing
// whitespace from document extractors produced a false FORMAT effect worth
// 0.42 Recall@10 — an order of magnitude more than any real model difference.
// So the chunk set is built here, hashed, and every model asserts the hash
// before embedding a single chunk.
//
// Chunking is the real `semanticChunks()` at CHUNKER_VERSION 4 with
// DEFAULT_CHUNK_OPTIONS untouched (merge floor 100 / soft target 350 / hard cap
// 1000), per §12: the head-to-head holds Natively's current configuration fixed.
//
// Scoring basis (§20): the chunker returns NO source character offsets, and
// chunk text is prefixed with `[Section N.N | pX] [context: ...]`, so a chunk is
// not a substring of its source file. Span-overlap scoring therefore has no
// valid basis here. Instead each ground-truth fact's TEXT is sliced out of the
// source file by its span and a chunk counts as relevant when it CONTAINS that
// text under whitespace normalization. That is robust to the chunker's prefixes
// and to extractor whitespace, and it is still deterministic ground truth — no
// LLM judge anywhere.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BENCH = path.join(REPO, 'embedding-benchmark');
const CORPUS = path.join(BENCH, 'corpus');
// CHUNK_OPTIONS='{"targetTokens":200,...}' builds an alternative chunking for
// the chunk-size sweep, written to OUT (default: the main snapshot).
const OUT = process.env.OUT ? path.resolve(process.env.OUT) : path.join(REPO, 'results', 'corpus-snapshot.json');
const CHUNK_OVERRIDES = process.env.CHUNK_OPTIONS ? JSON.parse(process.env.CHUNK_OPTIONS) : {};

const { semanticChunks, DEFAULT_CHUNK_OPTIONS: PRODUCTION_CHUNK_OPTIONS, CHUNKER_VERSION } =
  await import(path.join(REPO, 'dist-electron/electron/services/modes/semanticChunker.js'));
const DEFAULT_CHUNK_OPTIONS = { ...PRODUCTION_CHUNK_OPTIONS, ...CHUNK_OVERRIDES };

const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Distinctive sentences of a ground-truth region, normalized.
 *
 * Whole-region containment is too brittle to be the only rule: the chunker
 * inserts a `[context: ...]` prefix and reflows headings, and a 435-character
 * accepted region routinely straddles a chunk boundary, so an exact
 * whole-region match scores a genuinely correct chunk as a miss. Measured: with
 * whole-region containment only, accepted alternates raised mean relevant
 * chunks per query from 1.00 to just 1.08, while MiniLM's top-5 for the free-
 * tier query was five chunks that each state the answer.
 *
 * A chunk counts as relevant when it contains a COMPLETE SENTENCE of the region
 * that is at least MIN_SENT_CHARS long. That is still hard evidence overlap —
 * the chunk literally contains an answering sentence — but it survives the
 * prefix and the boundary. Short fragments are dropped so a chunk cannot match
 * on "default 250." alone.
 */
const MIN_SENT_CHARS = 40;
function distinctiveSentences(text) {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map(norm)
    .filter((s) => s.length >= MIN_SENT_CHARS);
}

/** Chunks containing the whole region, or one of its distinctive sentences. */
function matchChunks(allChunks, file, regionText) {
  const whole = norm(regionText);
  const sents = distinctiveSentences(regionText);
  const out = [];
  for (const c of allChunks) {
    if (c.file !== file) continue;
    if (whole.length >= 12 && c.normText.includes(whole)) { out.push(c.id); continue; }
    if (sents.some((s) => c.normText.includes(s))) out.push(c.id);
  }
  return out;
}

// ── ground truth ────────────────────────────────────────────────────────────
const gt = JSON.parse(fs.readFileSync(path.join(BENCH, 'queries/ground_truth.json'), 'utf8'));
const queries = fs.readFileSync(path.join(BENCH, 'queries/queries.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));

// Facts live in text files under corpus/. Anything whose file we cannot read as
// UTF-8 text is dropped with a reason rather than silently scored as a miss.
const facts = {};
const droppedFacts = [];
for (const [fid, f] of Object.entries(gt.facts)) {
  const abs = path.join(CORPUS, f.file);
  if (!fs.existsSync(abs)) { droppedFacts.push({ fid, reason: 'file missing', file: f.file }); continue; }
  if (f.modality && f.modality !== 'text') { droppedFacts.push({ fid, reason: `modality ${f.modality} — Natively indexes no images`, file: f.file }); continue; }
  let raw;
  try { raw = fs.readFileSync(abs, 'utf8'); } catch (e) { droppedFacts.push({ fid, reason: 'unreadable', file: f.file }); continue; }
  const text = raw.slice(f.char_start, f.char_end);
  if (norm(text).length < 12) { droppedFacts.push({ fid, reason: 'fact text too short to match reliably', file: f.file }); continue; }
  facts[fid] = { ...f, text, normText: norm(text) };
}

// ── chunk every corpus file a real upload could contain ─────────────────────
// Restricted to Natively's actual SAFE_DOCUMENT_EXTENSIONS text formats. The
// corpus also carries images and PDFs; PDFs are handled by the format track,
// images are not indexable by Natively at all (see docs §2).
const TEXT_EXT = new Set([
  '.txt', '.md', '.markdown', '.json', '.csv', '.tsv', '.xml', '.html', '.htm', '.log',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.java', '.kt',
  '.rs', '.c', '.h', '.cpp', '.hpp', '.cs', '.rb', '.php', '.swift', '.scala',
  '.sql', '.sh', '.ps1', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.graphql', '.proto', '.dart', '.lua', '.r', '.tf',
]);

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

const wanted = new Set(Object.values(facts).map((f) => f.file));
for (const q of queries) for (const rf of q.required_files || []) wanted.add(rf);

const chunks = [];
const perFile = [];
let skipped = 0;
for (const abs of walk(path.join(CORPUS, 'projects'))) {
  const rel = path.relative(CORPUS, abs);
  const ext = path.extname(abs).toLowerCase();
  if (!TEXT_EXT.has(ext)) { skipped++; continue; }
  const content = fs.readFileSync(abs, 'utf8');
  const cs = semanticChunks(content, { ...DEFAULT_CHUNK_OPTIONS });
  perFile.push({ file: rel, chars: content.length, chunks: cs.length });
  cs.forEach((c, i) => {
    const text = typeof c === 'string' ? c : (c.text ?? String(c));
    chunks.push({ id: `${rel}#${i}`, file: rel, idx: i, text, normText: norm(text) });
  });
}

// ── accept sets (§12) ───────────────────────────────────────────────────────
// The corpus legitimately states some facts in more than one place — most
// visibly in the long reference documents, which carry a per-setting
// `## Setting: FREE_TIER_DOCUMENT_LIMIT` section restating what the README
// says in prose. The existing harness records those alternates in
// accept_sets.json and counts them correct; ignoring them would score a model
// wrong for retrieving a chunk that genuinely answers the question.
//
// Measured before this was wired in: MiniLM's top-5 for "What are the project
// and document caps on the free tier?" was five FREE_TIER_DOCUMENT_LIMIT
// sections — all correct answers, all scored as misses.
//
// Accepted regions are resolved the same way facts are: slice the span's text
// out of its source file, then match by containment. PDF-modality regions are
// skipped here and belong to the format track, which runs the real pdf-parse
// extractor rather than reading the file as UTF-8.
const accept = JSON.parse(fs.readFileSync(path.join(BENCH, 'queries/accept_sets.json'), 'utf8'));
const acceptSkipped = { pdf: 0, image: 0, missing: 0, tooShort: 0 };

function regionsToChunkIds(regions) {
  const ids = new Set();
  for (const r of regions || []) {
    if (r.modality && r.modality !== 'text') { acceptSkipped[r.modality === 'pdf' ? 'pdf' : 'image']++; continue; }
    const abs = path.join(CORPUS, r.file);
    if (!fs.existsSync(abs)) { acceptSkipped.missing++; continue; }
    let raw;
    try { raw = fs.readFileSync(abs, 'utf8'); } catch { acceptSkipped.missing++; continue; }
    const regionText = raw.slice(r.char_start, r.char_end);
    if (norm(regionText).length < 12) { acceptSkipped.tooShort++; continue; }
    for (const id of matchChunks(chunks, r.file, regionText)) ids.add(id);
  }
  return ids;
}

const acceptByFact = {};
for (const [fid, regions] of Object.entries(accept.by_fact || {})) {
  const ids = regionsToChunkIds(regions);
  if (ids.size) acceptByFact[fid] = ids;
}
const acceptByQuery = {};
for (const [qid, regions] of Object.entries(accept.by_query || {})) {
  const ids = regionsToChunkIds(regions);
  if (ids.size) acceptByQuery[qid] = ids;
}

// ── which facts are actually reachable in the chunk set? ────────────────────
// A fact whose text survives into NO chunk can never be retrieved by ANY model.
// Scoring it would measure the chunker, identically for every candidate, and
// drag every score toward zero. Report and exclude, never silently.
const reachable = {};
const unreachable = [];
for (const [fid, f] of Object.entries(facts)) {
  const hits = new Set(matchChunks(chunks, f.file, f.text));
  for (const id of acceptByFact[fid] || []) hits.add(id);
  if (hits.size) reachable[fid] = [...hits];
  else unreachable.push({ fid, file: f.file, preview: f.text.slice(0, 70) });
}

// ── queries scorable against the reachable set ──────────────────────────────
const scorable = queries
  .filter((q) => (q.target_facts || []).some((fid) => reachable[fid]))
  .map((q) => ({
    query_id: q.query_id,
    text: q.text,
    track: q.track,
    categories: q.categories || [],
    hops: q.hops,
    relevantChunkIds: [...new Set([
      ...(q.target_facts || []).flatMap((fid) => reachable[fid] || []),
      ...(acceptByQuery[q.query_id] || []),
    ])],
    required_files: q.required_files || [],
  }));

const payload = {
  generatedAt: new Date().toISOString(),
  chunkerVersion: CHUNKER_VERSION,
  chunkOptions: DEFAULT_CHUNK_OPTIONS,
  counts: {
    filesChunked: perFile.length,
    filesSkippedUnsupportedExt: skipped,
    chunks: chunks.length,
    factsTotal: Object.keys(gt.facts).length,
    factsUsable: Object.keys(facts).length,
    factsReachable: Object.keys(reachable).length,
    factsUnreachable: unreachable.length,
    queriesTotal: queries.length,
    queriesScorable: scorable.length,
    acceptFactsResolved: Object.keys(acceptByFact).length,
    acceptQueriesResolved: Object.keys(acceptByQuery).length,
  },
  acceptSkipped,
  droppedFacts,
  unreachable,
  perFile,
  chunks,
  queries: scorable,
};

// Hash covers exactly what every model must agree on: the chunk texts, in order.
const chunkHash = crypto.createHash('sha256')
  .update(chunks.map((c) => c.id + '\u0000' + c.text).join('\u0001')).digest('hex');
payload.chunkSetSha256 = chunkHash;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload));

console.log('chunker version      ', CHUNKER_VERSION);
console.log('chunk options        ', JSON.stringify(DEFAULT_CHUNK_OPTIONS));
console.log('files chunked        ', perFile.length, `(skipped ${skipped} unsupported-extension files)`);
console.log('chunks               ', chunks.length);
console.log('facts total/usable   ', Object.keys(gt.facts).length, '/', Object.keys(facts).length);
console.log('facts reachable      ', Object.keys(reachable).length, `(unreachable ${unreachable.length})`);
console.log('queries scorable     ', scorable.length, 'of', queries.length);
console.log('chunk set sha256     ', chunkHash);
console.log('written              ', OUT);
if (droppedFacts.length) {
  console.log('\ndropped facts (first 8):');
  for (const d of droppedFacts.slice(0, 8)) console.log('  ', d.fid, d.reason, d.file);
}
if (unreachable.length) {
  console.log('\nunreachable facts (first 8) — excluded from scoring, identical for every model:');
  for (const u of unreachable.slice(0, 8)) console.log('  ', u.fid, u.file, '|', u.preview.replace(/\n/g, ' '));
}
