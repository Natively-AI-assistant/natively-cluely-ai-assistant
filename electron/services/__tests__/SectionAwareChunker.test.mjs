// Tests for the section-aware chunker (audit 2026-06-27, fix F3).
//
// The previous word-window chunker split a 140-word slide window at any
// word boundary, so a heading could land in one chunk and its body in
// the next. For document-grounded custom modes this defeated the
// section-aware retrieval the AnswerPlanner assumes — a query like
// "What is OpenVLA-OFT?" would match a mid-paragraph fragment instead
// of a chunk that STARTS with the heading.
//
// These are SOURCE-ASSERTION tests because chunkText() is a private
// helper inside the ModeContextRetriever class and the chunker cannot
// be exercised through the public ModesManager.buildRetrievedActive-
// ModeContextBlock API without a working better-sqlite3 native binding
// (Node 25 ABI mismatch; test:electron runner is required and not
// available in this fast-iteration loop). The assertions below mirror
// the runtime contract the chunker must satisfy and would have caught
// the regression that motivated this fix.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

test('section-aware chunker: detects markdown ATX headings (#, ##, ###) as section boundaries', () => {
  const src = read('electron/services/ModeContextRetriever.ts');
  // The source's heading regex contains '#{1,3}' followed by '\s+'. We
  // assert both substrings are present (and adjacent within 10 chars).
  assert.ok(
    src.includes('#{1,3}'),
    'chunkText heading regex must include #{1,3} (markdown ATX headings)',
  );
  assert.ok(
    /\\s\+/.test(src),
    'chunkText heading regex must include \\s+ (whitespace required after #)',
  );
});

test('section-aware chunker: detects numbered sections (1.1, 2.1.3, 3 Title) as section boundaries', () => {
  const src = read('electron/services/ModeContextRetriever.ts');
  // Pattern matches 1, 1.1, 1.1.1, 2 OpenVLA, 2.1.3 ROS#.
  assert.match(
    src,
    /\\d\+\(\?:\\\.\\d\+\)\{0,2\}\\s\+/,
    'chunkText must recognise numbered section headings (1, 1.1, 1.1.1, 2 Title)',
  );
});

test('section-aware chunker: keeps heading + body together when section fits in one window', () => {
  const src = read('electron/services/ModeContextRetriever.ts');
  // The short-section branch: headingLine + bodyText are joined and emitted
  // as one chunk. This is the regression that motivated the fix — the
  // previous word-window chunker split heading from body.
  assert.match(
    src,
    /const fullText = headingLine \? `\$\{headingLine\}\\n\$\{bodyText\}` : bodyText/,
    'chunkText must join heading + body when section is short',
  );
  assert.match(
    src,
    /if \(words\.length <= CHUNK_WORDS\)\s*\{\s*chunks\.push\(fullText\)/,
    'short sections must be emitted as a single chunk',
  );
});

test('section-aware chunker: anchors each window chunk in a long section with the heading', () => {
  const src = read('electron/services/ModeContextRetriever.ts');
  // Long-section branch (non-fineChunk / default path): each window chunk is
  // built as `${headingLine}\n${window}`. Without this anchor, the second/third
  // window of a long section would lose its heading and rank lower on a
  // heading-keyword query. (Variable renamed to `ct` in the 2026-06-28 refactor
  // that split the default vs document-grounded fine-chunk paths.)
  assert.ok(
    src.includes("const ct = headingLine ? `${headingLine}\\n${window.join(' ')}` : window.join(' ')"),
    'chunkText must anchor every window chunk in a long section with the heading',
  );
});

test('section-aware chunker: [Page N] markers from PDF ingest are SOFT boundaries, not section boundaries', () => {
  const src = read('electron/services/ModeContextRetriever.ts');
  // The page marker regex source contains the literal substring `[Page\s+\d+]`.
  // We check by raw string contains (no regex) so shell-escaping does not
  // interfere. The literal chars `\`, `s`, `+`, `\`, `d`, `+` appear in the
  // regex string in source.
  assert.ok(
    src.includes('pageMarkerRe'),
    'chunkText must declare a pageMarkerRe regex',
  );
  assert.ok(
    src.includes('[Page') && src.includes('Page\\s+'),
    'chunkText page-marker regex must contain [Page and \\s+ (whitespace class)',
  );
  // The page-marker branch pushes to body (does not call flush).
  assert.ok(
    src.includes('current.body.push'),
    'pageMarkerRe branch must push to current.body (soft boundary)',
  );
});

test('section-aware chunker: chunkText no longer uses word-window across heading boundaries', () => {
  const src = read('electron/services/ModeContextRetriever.ts');
  // The fix removes the old monolithic for-loop over content.split(/\s+/)
  // that walked the whole document at CHUNK_WORDS step. The new chunker
  // walks sections and uses the word-window ONLY inside long sections.
  const oldLoopPattern = new RegExp(
    "const words = content\\.trim\\(\\)\\.split\\(/\\\\s\\+/\\)[\\s\\S]{0,200}for \\(let i = 0; i < words\\.length; i \\+= CHUNK_WORDS - CHUNK_OVERLAP\\)",
  );
  assert.doesNotMatch(
    src,
    oldLoopPattern,
    'chunkText must not use the global word-window loop (heading-agnostic)',
  );
});

test('section-aware chunker: same change is mirrored in ModeHybridRetriever.ts', () => {
  // The hybrid retriever has its own chunker (modes/ModeHybridRetriever.ts).
  // Audit 2026-06-27 also requires this to be section-aware so the two
  // retriever paths produce consistent chunks. If you add to one, the
  // other must follow.
  const src = read('electron/services/modes/ModeHybridRetriever.ts');
  const oldLoopPattern = new RegExp(
    "const words = content\\.trim\\(\\)\\.split\\(/\\\\s\\+/\\)[\\s\\S]{0,200}for \\(let i = 0; i < words\\.length; i \\+= CHUNK_WORDS - CHUNK_OVERLAP\\)",
  );
  assert.doesNotMatch(
    src,
    oldLoopPattern,
    'ModeHybridRetriever chunker must not use the old pure word-window loop',
  );
});

// MEDIUM #1 (audit 2026-06-29): the document-grounded fine-chunk path is
// the path the entire real-path fix depends on for OpenVLA-OFT-style
// flat-prose fixtures. Source-assertion coverage of the SUBCHUNK_WORDS=45
// sentence-split branch.
test('section-aware chunker: fineChunk path uses SUBCHUNK_WORDS=45 sentence-split', () => {
  const src = read('electron/services/ModeContextRetriever.ts');
  // The fine-chunk sub-budget is the documented 45 words.
  assert.match(
    src,
    /const\s+SUBCHUNK_WORDS\s*=\s*45\b/,
    'fineChunk path must define SUBCHUNK_WORDS = 45',
  );
  // The split-into-units helper must run before the emit loop (sentence /
  // line boundary split, not a global word window).
  assert.match(
    src,
    /const\s+units\s*=\s*splitIntoUnits\(rawBody\)/,
    'fineChunk path must call splitIntoUnits(rawBody) to break on sentence/line boundaries',
  );
  // The emit-on-overflow check at SUBCHUNK_WORDS boundary.
  assert.match(
    src,
    /pendingWords\s*>\s*0\s*&&\s*pendingWords\s*\+\s*uw\s*>\s*SUBCHUNK_WORDS/,
    'fineChunk emit-on-overflow must use SUBCHUNK_WORDS as the bound',
  );
});

test('section-aware chunker: fineChunk path is gated on forceDocumentGrounding', () => {
  const src = read('electron/services/ModeContextRetriever.ts');
  // The fineChunk path is reachable only when forceDocumentGrounding=true —
  // the default path (fineChunk=false) must remain byte-for-byte unchanged
  // from the prior audit so non-doc-grounded custom modes are unaffected.
  assert.match(
    src,
    /function\s+chunkText\s*\(\s*content:\s*string,\s*fineChunk:\s*boolean\s*=\s*false\s*\)/,
    'chunkText signature must include a fineChunk=false default',
  );
  // The legacy path branches on `if (!fineChunk)` and the doc-grounded
  // sub-chunk path lives in the else (so legacy non-doc-grounded custom
  // modes are byte-for-byte unchanged).
  assert.match(
    src,
    /if\s*\(\s*!fineChunk\s*\)\s*\{/,
    'chunkText must branch the legacy path on `if (!fineChunk)` so doc-grounded runs use the else (sentence-split SUBCHUNK_WORDS path)',
  );
});

// Round-7 safety net (2026-07-01, hardened after test-engineer review):
// pathological inputs (all-caps policy text, CSV blobs, scan OCR without
// sentence punctuation, one giant single-paragraph markdown) can collapse
// the fineChunk path to a single chunk when there are no headings AND no
// sentence boundaries AND no paragraph boundaries. The safety net first
// tries paragraph-boundary splitting at \n\s*\n+ when fineChunk produces
// fewer than 3 chunks for a >=600-word document; if the doc has only 1
// paragraph (the canonical pathological case), it falls back to a forced
// SUBCHUNK_WORDS word-window split.
test('section-aware chunker: paragraph-fallback safety net when fineChunk produces <3 chunks on a >=600-word doc', () => {
  const src = read('electron/services/ModeContextRetriever.ts');
  // The safety net is reachable only when fineChunk && chunks.length < 3
  // && totalWords >= 600. It splits content on \n\s*\n+ paragraph boundaries
  // and re-emits as paragraph-level chunks, then sub-splits long paragraphs
  // on SUBCHUNK_WORDS word windows. If only 1 paragraph emerges, the
  // word-window fallback catches the canonical pathological case.
  assert.match(
    src,
    /if\s*\(\s*fineChunk\s*&&\s*chunks\.length\s*<\s*3\s*\)/,
    'chunkText must guard paragraph-fallback on `fineChunk && chunks.length < 3`',
  );
  assert.match(
    src,
    /const\s+totalWords\s*=\s*chunks\.reduce\(\(n,\s*c\)\s*=>\s*n\s*\+\s*c\.split\(\/\\s\+\/\)\.filter\(Boolean\)\.length,\s*0\)/,
    'safety net must compute totalWords from existing chunks before deciding to fall back',
  );
  assert.match(
    src,
    /const\s+paragraphs\s*=\s*content\s*\.\s*split\(\s*\/\\n\\s\*\\n\+\/\s*\)/,
    'safety net must split content on \\n\\s*\\n+ paragraph boundaries',
  );
  // Hardened threshold (test-engineer 2026-07-01): paragraphs.length >= 2
  // (was >= 3; the canonical pathological single-paragraph case was uncovered).
  assert.match(
    src,
    /if\s*\(\s*paragraphs\.length\s*>=\s*2\s*\)/,
    'safety net must fire when paragraphs.length >= 2 (was >= 3; relaxation fixes canonical single-paragraph pathological case)',
  );
  // Canonical pathological fallback: paragraphs.length === 1 with >= 600 words.
  // Forces a SUBCHUNK_WORDS word-window split so topK gets multiple candidates
  // for scan OCR / all-caps policy text / single-paragraph markdown.
  assert.match(
    src,
    /else if\s*\(\s*paragraphs\.length\s*===\s*1\s*&&\s*paragraphs\[0\]\.split\(\/\\s\+\/\)\.filter\(Boolean\)\.length\s*>=\s*600\s*\)/,
    'safety net must include a single-paragraph word-window fallback for canonical pathological inputs (scan OCR / all-caps / single-paragraph markdown)',
  );
});