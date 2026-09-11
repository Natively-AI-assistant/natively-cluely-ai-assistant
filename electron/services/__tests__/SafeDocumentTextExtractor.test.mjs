// Shared document extraction contract for Modes Manager + Profile Intelligence
// upload paths. Senior-review fix 2026-07-16 (audit ab9dc2f0): this test
// file was lost during the prior broken-commit recovery; restored here to
// pin the safety contract now that ModeReferenceFileIngestion.ts
// (electron/services/) shares this utility.
//
// Run with: npm run build:electron && node --test electron/services/__tests__/SafeDocumentTextExtractor.test.mjs

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const moduleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../../dist-electron/electron/services/SafeDocumentTextExtractor.js',
)).href;
const {
  extractSafeDocumentText,
  SAFE_DOCUMENT_EXTENSIONS,
  SAFE_DOCUMENT_MAX_BYTES,
  computeParseTimeoutMs,
  htmlToText,
} = await import(moduleUrl);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-safe-document-'));
const createdPaths = [];

function createFixture(name, content) {
  const filePath = path.join(tempRoot, name);
  fs.writeFileSync(filePath, content);
  createdPaths.push(filePath);
  return filePath;
}

test('declares the complete shared Modes / Profile document format contract', () => {
  assert.deepEqual(
    [...SAFE_DOCUMENT_EXTENSIONS].slice(0, 12),
    ['.txt', '.md', '.markdown', '.json', '.csv', '.tsv', '.xml', '.html', '.htm', '.log', '.pdf', '.docx'],
  );
  // 2026-09-10: source/config files are plain text and a code-review mode
  // needs the code under review, not only the notes about it.
  for (const ext of ['.ts', '.tsx', '.js', '.py', '.go', '.java', '.rs', '.sql', '.yaml', '.yml', '.toml', '.sh']) {
    assert.ok(SAFE_DOCUMENT_EXTENSIONS.has(ext), `${ext} must be an accepted reference-file type`);
  }
  assert.equal(SAFE_DOCUMENT_MAX_BYTES, 50 * 1024 * 1024);
});

test('extracts every plain-text document format without changing its content', async () => {
  const content = 'Sarah Chen\nsarah@example.com\nSenior Software Engineer\n';
  for (const ext of ['.txt', '.md', '.markdown', '.json', '.csv', '.tsv', '.xml', '.html', '.htm', '.log', '.ts', '.py', '.yaml']) {
    const result = await extractSafeDocumentText(createFixture(`resume${ext}`, content));
    assert.equal(result.extension, ext);
    assert.equal(result.content, content);
    assert.equal(result.binarySha256, crypto.createHash('sha256').update(content).digest('hex'));
  }
});

test('decodes UTF-8 and UTF-16 BOM text safely', async () => {
  const utf8Bom = createFixture('resume.md', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Sarah Chen')]));
  const utf16Le = createFixture('job-description.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Senior Backend Engineer', 'utf16le')]));
  assert.equal((await extractSafeDocumentText(utf8Bom)).content, 'Sarah Chen');
  assert.equal((await extractSafeDocumentText(utf16Le)).content, 'Senior Backend Engineer');
});

test('rejects unsupported, empty, oversized, and renamed-binary files before they reach extraction', async () => {
  const unsupported = createFixture('resume.rtf', 'Sarah Chen');
  const empty = createFixture('resume.txt', '');
  const oversized = createFixture('resume.log', '');
  const binary = createFixture('resume.json', Buffer.from([0x53, 0x00, 0x01, 0x02]));
  fs.truncateSync(oversized, SAFE_DOCUMENT_MAX_BYTES + 1);

  await assert.rejects(() => extractSafeDocumentText(unsupported), /unsupported file type \.rtf/);
  await assert.rejects(() => extractSafeDocumentText(empty), /empty/);
  await assert.rejects(() => extractSafeDocumentText(oversized), /exceeds 50 MB limit/);
  await assert.rejects(() => extractSafeDocumentText(binary), /looks binary despite \.json/);
});

test('rejects a symlink instead of following it', async (t) => {
  const target = createFixture('real-resume.txt', 'Sarah Chen');
  const link = path.join(tempRoot, 'resume-link.txt');
  try {
    fs.symlinkSync(target, link);
  } catch (error) {
    t.skip(`symlink creation unavailable: ${error.message}`);
    return;
  }
  createdPaths.push(link);
  await assert.rejects(() => extractSafeDocumentText(link), /not a regular file/);
});

// Real PDF/DOCX round-trip through the pdf-parse/pdfjs-dist and mammoth
// branches. Bug fix 2026-07-28 (senior review, pdf-parse pin): the test
// suite above only ever exercised the plain-text branch of
// SAFE_DOCUMENT_EXTENSIONS, so a `pdfjs-dist` version drift under
// pdf-parse's caret range (fixed to an exact pin in the same change) could
// have shipped without any test catching it. Reuses the existing profile
// eval fixtures (synthetic data) instead of adding new binary fixtures.
const fixturesRoot = path.resolve(__dirname, '../../../test-fixtures/profiles');

test('extracts real PDF resume text via the pdf-parse/pdfjs-dist branch', async () => {
  const result = await extractSafeDocumentText(path.join(fixturesRoot, 'p01', 'resume.pdf'));
  assert.equal(result.extension, '.pdf');
  assert.ok(result.content.includes('MARCUS J. HOLLOWAY'), 'expected known fixture text in extracted content');
  assert.ok(result.pageCount >= 1, 'expected a populated page count');
  assert.ok(result.extractedPageCount >= 1, 'expected at least one page with extracted text');
});

test('extracts real DOCX resume text via the mammoth branch', async () => {
  const result = await extractSafeDocumentText(path.join(fixturesRoot, 'p03', 'resume.docx'));
  assert.equal(result.extension, '.docx');
  assert.ok(result.content.includes('MARGARET'), 'expected known fixture text in extracted content');
});

// Resource-leak fix 2026-07-28: parser.destroy() must run on every PDF parse
// exit path, not just on failure, so pdfjs documents don't pile up relying
// on GC. `require('pdf-parse')` is cached by Node, so mocking the prototype
// here also affects the instance the compiled extractor module constructs.
// Parse-timeout scaling fix 2026-07-28: a flat 30s timeout for every file
// regardless of size meant a legitimate large (but well under 50MB)
// PDF/DOCX could spuriously fail parsing just for being long.
test('scales the parse timeout by file size, bounded between 30s and 5 minutes', () => {
  assert.equal(computeParseTimeoutMs(1 * 1024 * 1024), 30_000, '1MB should still hit the 30s floor');
  assert.equal(computeParseTimeoutMs(20 * 1024 * 1024), 40_000, '20MB should scale to 40s (2s/MB)');
  assert.equal(computeParseTimeoutMs(50 * 1024 * 1024), 100_000, '50MB (the max file size) should scale to 100s');
  assert.equal(computeParseTimeoutMs(500 * 1024 * 1024), 5 * 60_000, 'an unrealistically large size should cap at 5 minutes');
});

test('calls parser.destroy() exactly once on a successful PDF parse', async () => {
  const { PDFParse } = require('pdf-parse');
  const destroySpy = mock.method(PDFParse.prototype, 'destroy');
  try {
    await extractSafeDocumentText(path.join(fixturesRoot, 'p01', 'resume.pdf'));
    assert.equal(destroySpy.mock.callCount(), 1, 'expected destroy() to be called exactly once');
  } finally {
    destroySpy.mock.restore();
  }
});


// 2026-09-10: `.html` reference files were stored verbatim, so chunks,
// embeddings and the prompt all saw `<tr><td>` markup; a board-update table
// was answered from the wrong column because the headers sat three rows of
// tags away from the cell. HTML is flattened to prose at extraction.
test('flattens HTML tables, lists and headings to prose; plain text is untouched', async () => {
  const html = `<!doctype html><html><head><title>Q3 Update</title><style>td{color:red}</style></head>
<body><h1>Lumen &amp; Co</h1><script>alert(1)</script>
<table><tr><th>Metric</th><th>Q1</th><th>Q3</th></tr>
<tr><td>Net revenue retention</td><td>108%</td><td>117%</td></tr></table>
<ul><li>New logos: 94 (target&nbsp;80)</li><li>Sales cycle &ndash; 41 days</li></ul>
<p>Cash <b>$34.9M</b><br>Runway 36 months</p></body></html>`;
  const result = await extractSafeDocumentText(createFixture('q3_update.html', html));
  const lines = result.content.split('\n');
  assert.ok(lines.includes('Q3 Update'), 'the title survives as a line');
  assert.ok(lines.includes('Lumen & Co'), 'entities are decoded');
  assert.ok(lines.includes('Metric | Q1 | Q3'), 'a header row is one line of cells');
  assert.ok(lines.includes('Net revenue retention | 108% | 117%'), 'a data row keeps its cells together');
  assert.ok(lines.includes('- New logos: 94 (target 80)'), 'list items become bullets, nbsp decoded');
  assert.ok(lines.includes('- Sales cycle – 41 days'), 'named entities decode');
  assert.ok(lines.includes('Cash $34.9M'), 'inline tags are dropped');
  assert.ok(lines.includes('Runway 36 months'), '<br> breaks a line');
  assert.ok(!/<[a-z]/i.test(result.content), 'no tags remain');
  assert.ok(!/alert\(1\)|color:red/.test(result.content), 'script and style bodies are dropped');
  assert.equal(htmlToText('Sarah Chen\nsarah@example.com\n'), 'Sarah Chen\nsarah@example.com\n', 'tag-free text is returned byte-identical');
  assert.equal(result.binarySha256, crypto.createHash('sha256').update(html).digest('hex'), 'the binary hash is of the original bytes');
});
