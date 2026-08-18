// Tests for the local document reader (task 4).
//
// The module has no `process.platform` branch, so there is no platform switch
// to inject. What differs between macOS and Windows is the *input*: line
// endings, Unicode composition, and path shape. These tests therefore exercise
// both platforms' characteristic inputs against the one code path, and assert
// the property that matters — a resume indexed on one machine must produce the
// same text, and the same content digest, as the identical resume indexed on
// the other.
//
// Run with the bundled CommonJS artifact, matching the convention in
// electron/services/__tests__/.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const { readLocalDocument, normalizeDocumentText } = require(
  path.join(repoRoot, 'dist-electron/electron/localKnowledge/DocumentReader.js'),
);
const { DocType } = require(path.join(repoRoot, 'dist-electron/electron/localKnowledge/types.js'));

const NBSP = String.fromCharCode(0x00a0);
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const BOM = String.fromCharCode(0xfeff);
const NULL_BYTE = String.fromCharCode(0x00);
// "Jose" with a combining acute accent: how macOS commonly emits the name.
const NAME_NFD = 'Jos' + 'e' + String.fromCharCode(0x0301);
// The same name precomposed: how Windows commonly emits it.
const NAME_NFC = 'Jos' + String.fromCharCode(0x00e9);

function makeTempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `natively-docreader-${label}-`));
}

describe('normalizeDocumentText', () => {
  test('converts CRLF and lone CR to LF, so a Windows-authored file matches a Unix one', () => {
    assert.equal(normalizeDocumentText('a\r\nb\rc'), 'a\nb\nc');
  });

  test('composes NFD to NFC, so a macOS-authored name matches a Windows one', () => {
    assert.equal(normalizeDocumentText(NAME_NFD), NAME_NFC);
    // Guard the premise: without normalization these really are different.
    assert.notEqual(NAME_NFD, NAME_NFC);
  });

  test('maps no-break space to a plain space so token boundaries survive', () => {
    assert.equal(normalizeDocumentText(`Senior${NBSP}Engineer`), 'Senior Engineer');
  });

  test('removes zero-width characters and the byte order mark', () => {
    assert.equal(normalizeDocumentText(`${BOM}Sen${ZERO_WIDTH_SPACE}ior`), 'Senior');
  });

  test('removes control characters but keeps tab and newline', () => {
    assert.equal(normalizeDocumentText(`a${NULL_BYTE}b\tc\nd`), 'ab\tc\nd');
  });

  test('collapses runs of blank lines to a single blank line', () => {
    assert.equal(normalizeDocumentText('a\n\n\n\n\nb'), 'a\n\nb');
  });

  test('strips trailing whitespace on each line', () => {
    assert.equal(normalizeDocumentText('a   \nb\t\n'), 'a\nb');
  });
});

describe('readLocalDocument: cross-platform input equivalence', () => {
  test('the same resume authored on Windows and on macOS yields one content digest', async () => {
    const dir = makeTempDir('equivalence');
    const body = `${NAME_NFC} - Senior Engineer\nAcme Corp\n`;

    const windowsStyle = path.join(dir, 'resume-windows.txt');
    fs.writeFileSync(windowsStyle, body.replace(/\n/g, '\r\n'), 'utf8');

    const macStyle = path.join(dir, 'resume-mac.txt');
    fs.writeFileSync(macStyle, body.normalize('NFD'), 'utf8');

    const fromWindows = await readLocalDocument(windowsStyle, DocType.RESUME);
    const fromMac = await readLocalDocument(macStyle, DocType.RESUME);

    assert.equal(fromWindows.success, true, fromWindows.error);
    assert.equal(fromMac.success, true, fromMac.error);
    assert.equal(fromWindows.document.content, fromMac.document.content);
    assert.equal(fromWindows.document.contentSha256, fromMac.document.contentSha256);
    // The raw bytes differ, which is exactly why the content digest is the one
    // to deduplicate on.
    assert.notEqual(fromWindows.document.binarySha256, fromMac.document.binarySha256);
  });

  test('reads a path containing spaces and non-ASCII characters', async () => {
    const dir = makeTempDir('paths');
    const nested = path.join(dir, 'My Documents', 'Lebenslauf ' + NAME_NFC);
    fs.mkdirSync(nested, { recursive: true });
    const filePath = path.join(nested, 'my resume (final).txt');
    fs.writeFileSync(filePath, 'Staff Engineer at Acme Corp\n', 'utf8');

    const result = await readLocalDocument(filePath, DocType.RESUME);
    assert.equal(result.success, true, result.error);
    assert.equal(result.document.fileName, 'my resume (final).txt');
    assert.match(result.document.content, /Staff Engineer/);
  });
});

describe('readLocalDocument: real documents', () => {
  test('extracts text from a PDF resume', async () => {
    const fixture = path.join(repoRoot, 'test-fixtures/profiles/p01/resume.pdf');
    const result = await readLocalDocument(fixture, DocType.RESUME);

    assert.equal(result.success, true, result.error);
    assert.equal(result.document.extension, '.pdf');
    assert.ok(result.document.content.length > 100, 'expected substantive text from the PDF');
    assert.ok(result.document.pageCount >= 1, 'expected a page count');
    assert.equal(result.document.docType, DocType.RESUME);
  });

  test('extracts text from a DOCX resume', async () => {
    const fixture = path.join(repoRoot, 'test-fixtures/profiles/p03/resume.docx');
    const result = await readLocalDocument(fixture, DocType.JD);

    assert.equal(result.success, true, result.error);
    assert.equal(result.document.extension, '.docx');
    assert.ok(result.document.content.length > 100, 'expected substantive text from the DOCX');
    // docType is passthrough: the reader classifies nothing itself.
    assert.equal(result.document.docType, DocType.JD);
  });

  test('normalizes real extracted text: no CR, no leading or trailing blank space', async () => {
    const fixture = path.join(repoRoot, 'test-fixtures/profiles/p01/resume.pdf');
    const result = await readLocalDocument(fixture, DocType.RESUME);

    assert.equal(result.success, true, result.error);
    assert.ok(!result.document.content.includes('\r'), 'carriage returns should be gone');
    assert.equal(result.document.content, result.document.content.trim());
    assert.ok(!/\n{3,}/.test(result.document.content), 'blank-line runs should be collapsed');
  });
});

describe('readLocalDocument: failures are results, not exceptions', () => {
  test('rejects a legacy .doc file with the remedy the caller expects', async () => {
    const dir = makeTempDir('legacy');
    const filePath = path.join(dir, 'resume.doc');
    fs.writeFileSync(filePath, 'irrelevant', 'utf8');

    const result = await readLocalDocument(filePath, DocType.RESUME);
    assert.equal(result.success, false);
    assert.match(result.error, /\.docx/);
  });

  test('rejects an unsupported extension and names the supported formats', async () => {
    const dir = makeTempDir('unsupported');
    const filePath = path.join(dir, 'resume.exe');
    fs.writeFileSync(filePath, 'irrelevant', 'utf8');

    const result = await readLocalDocument(filePath, DocType.RESUME);
    assert.equal(result.success, false);
    assert.match(result.error, /not supported/);
    assert.match(result.error, /\.pdf/);
  });

  test('reports a missing file without throwing', async () => {
    const missing = path.join(makeTempDir('missing'), 'gone.txt');
    const result = await readLocalDocument(missing, DocType.RESUME);
    assert.equal(result.success, false);
    assert.match(result.error, /no longer exists/);
  });

  test('rejects a directory that carries a document extension', async () => {
    // Realistic on macOS, where bundles such as Pages documents are
    // directories that the file picker presents as single files.
    const dir = makeTempDir('bundle');
    const bundlePath = path.join(dir, 'resume.txt');
    fs.mkdirSync(bundlePath);

    const result = await readLocalDocument(bundlePath, DocType.RESUME);
    assert.equal(result.success, false);
    assert.match(result.error, /not a file/);
  });

  test('rejects an empty file', async () => {
    const dir = makeTempDir('empty');
    const filePath = path.join(dir, 'resume.txt');
    fs.writeFileSync(filePath, '', 'utf8');

    const result = await readLocalDocument(filePath, DocType.RESUME);
    assert.equal(result.success, false);
    assert.match(result.error, /No text could be read/);
  });

  test('rejects a file whose text is only formatting characters', async () => {
    const dir = makeTempDir('formatting-only');
    const filePath = path.join(dir, 'resume.txt');
    fs.writeFileSync(filePath, `${NBSP}${ZERO_WIDTH_SPACE}\n\n${NBSP}`, 'utf8');

    const result = await readLocalDocument(filePath, DocType.RESUME);
    assert.equal(result.success, false);
    assert.match(result.error, /only formatting/);
  });

  test('rejects an absent path argument', async () => {
    const result = await readLocalDocument('', DocType.RESUME);
    assert.equal(result.success, false);
    assert.match(result.error, /No file was selected/);
  });
});
