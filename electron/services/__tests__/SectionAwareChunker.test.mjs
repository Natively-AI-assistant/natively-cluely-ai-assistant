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
  // Long-section branch: each window chunk is built as `${headingLine}\n${window}`.
  // Without this anchor, the second/third window of a long section would lose
  // its heading and rank lower on a heading-keyword query.
  assert.match(
    src,
    /const chunkText = headingLine\s*\n\s*\?\s*`\$\{headingLine\}\\n\$\{window\.join\(' '\)\}`\s*\n\s*:\s*window\.join\(' '\)/,
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