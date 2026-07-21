// Regression for FIX-009: Modes and Profile Intelligence must use one hardened
// document parser rather than accepting renamed binaries or unbounded files.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTRACTOR_SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../SafeDocumentTextExtractor.ts'),
  'utf8',
);
const MODE_INGESTION_SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../ModeReferenceFileIngestion.ts'),
  'utf8',
);
const IPC_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../ipcHandlers.ts'), 'utf8');
const BUILD_SCRIPT = fs.readFileSync(path.resolve(__dirname, '../../../scripts/build-electron.js'), 'utf8');

const REQUIRED_EXTENSIONS = [
  '.txt', '.md', '.markdown', '.json', '.csv', '.tsv', '.xml', '.html', '.htm', '.log', '.pdf', '.docx',
];

describe('FIX-009: shared document upload hardening', () => {
  test('keeps one explicit allow-list for every supported document format', () => {
    assert.ok(EXTRACTOR_SOURCE.includes('SAFE_DOCUMENT_EXTENSIONS'));
    for (const ext of REQUIRED_EXTENSIONS) {
      assert.ok(EXTRACTOR_SOURCE.includes(`'${ext}'`), `Allow-list must contain ${ext}`);
    }
    assert.doesNotMatch(EXTRACTOR_SOURCE, /'\.doc'/, 'Legacy .doc must stay excluded');
  });

  test('Modes delegates parsing to the shared hardened extractor', () => {
    assert.match(MODE_INGESTION_SOURCE, /extractSafeDocumentText\(options\.filePath\)/);
    assert.match(MODE_INGESTION_SOURCE, /MODE_REFERENCE_FILE_EXTENSIONS\s*=\s*SAFE_DOCUMENT_EXTENSIONS/);
    assert.match(MODE_INGESTION_SOURCE, /MODE_REFERENCE_FILE_MAX_BYTES\s*=\s*SAFE_DOCUMENT_MAX_BYTES/);
  });

  test('enforces regular-file, size, timeout, and empty-result guards before persistence', () => {
    assert.match(EXTRACTOR_SOURCE, /fs\.promises\.lstat\(filePath\)/);
    assert.match(EXTRACTOR_SOURCE, /stats\.isFile\(\)/);
    assert.match(EXTRACTOR_SOURCE, /stats\.size > SAFE_DOCUMENT_MAX_BYTES/);
    assert.match(EXTRACTOR_SOURCE, /PARSE_TIMEOUT_MS = 30_000/);
    assert.match(EXTRACTOR_SOURCE, /withTimeout<any>\(parser\.getText\(\), 'PDF parse'\)/);
    assert.match(EXTRACTOR_SOURCE, /withTimeout<any>\(mammoth\.extractRawText\(\{ path: filePath \}\), 'DOCX parse'\)/);
    assert.match(EXTRACTOR_SOURCE, /file parsed to empty text/);
  });

  test('decodes BOM text and rejects renamed binaries', () => {
    assert.match(EXTRACTOR_SOURCE, /0xff.*0xfe/);
    assert.match(EXTRACTOR_SOURCE, /0xfe.*0xff/);
    assert.match(EXTRACTOR_SOURCE, /0xef.*0xbb.*0xbf/s);
    assert.match(EXTRACTOR_SOURCE, /utf16le/);
    assert.match(EXTRACTOR_SOURCE, /includes\(0\)/);
  });

  test('pins the real pdfjs worker before pdf-parse runs', () => {
    assert.match(EXTRACTOR_SOURCE, /pdfjs-dist\/legacy\/build\/pdf\.mjs/);
    assert.match(EXTRACTOR_SOURCE, /require\.resolve\('pdfjs-dist\/legacy\/build\/pdf\.worker\.mjs'\)/);
    assert.match(EXTRACTOR_SOURCE, /pathToFileURL\(workerPath\)\.href/);
    assert.match(EXTRACTOR_SOURCE, /GlobalWorkerOptions\.workerSrc =/);
  });

  test('Profile picker consumes the shared format set and preserves All Files fallback', () => {
    assert.match(IPC_SOURCE, /import \{ SAFE_DOCUMENT_EXTENSIONS \} from '\.\/services\/SafeDocumentTextExtractor'/);
    assert.match(IPC_SOURCE, /const extensions = \[\.\.\.SAFE_DOCUMENT_EXTENSIONS\]\.map\(extension => extension\.slice\(1\)\)/);
    assert.match(IPC_SOURCE, /name: 'Resume & JD Documents'/);
    assert.match(IPC_SOURCE, /name: 'All Files', extensions: \['\*'\]/);
  });

  test('Profile handlers translate legacy .doc failures returned by the orchestrator', () => {
    const resumeHandler = IPC_SOURCE.slice(
      IPC_SOURCE.indexOf("safeHandle('profile:upload-resume'"),
      IPC_SOURCE.indexOf("safeHandle('profile:get-status'"),
    );
    const jdHandler = IPC_SOURCE.slice(
      IPC_SOURCE.indexOf("safeHandle('profile:upload-jd'"),
      IPC_SOURCE.indexOf("safeHandle('profile:delete-jd'"),
    );
    const docError = /Legacy Word \.doc files are not supported\. Save the file as \.docx and upload it again\./;
    const resultMapping = /if \(!result\?\.success && path\.extname\(resolvedPath\)\.toLowerCase\(\) === '\.doc'\)/;

    for (const handler of [resumeHandler, jdHandler]) {
      assert.match(handler, docError);
      assert.match(handler, resultMapping);
    }
  });

  test('build externalizes document parsers so the pdfjs worker pin works packaged', () => {
    const externalMatch = BUILD_SCRIPT.match(/external:\s*\[([\s\S]*?)\]/);
    assert.ok(externalMatch, 'build-electron.js must declare an external list');
    for (const pkg of ['pdfjs-dist', 'pdf-parse', 'mammoth']) {
      assert.match(externalMatch[1], new RegExp(`['"]${pkg}['"]`));
    }
  });
});