// electron/services/SafeDocumentTextExtractor.ts
//
// Shared safety checks and text extraction for trusted, user-selected documents.
// Callers own authorization and persistence. This module enforces file
// safety (extension, size, BOM, symlink) and uses the same parser path
// for every trusted filesystem ingress so the Modes Manager upload and the
// Profile Intelligence upload cannot drift.
//
// Extracted from electron/services/ModeReferenceFileIngestion.ts so a single
// file owns the parser + safety contract.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

/** The complete shared document-format contract for Modes + Profile uploads. */
export const SAFE_DOCUMENT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.csv', '.tsv',
  '.xml', '.html', '.htm', '.log', '.pdf', '.docx',
]);

/** 50 MB hard cap — should be enforced by the upload UI's progress bar first. */
export const SAFE_DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;

// A flat 30s timeout applied to every file regardless of size meant a
// legitimate large (but well under 50MB) PDF/DOCX could spuriously fail
// parsing simply for being long, indistinguishable from a genuinely hung
// parse. pdf-parse/mammoth parse the whole document in one pass (no
// incremental/streaming option) — bigger files really do take longer.
// Parsing already runs non-blocking in the background (see
// ModeReferenceFileIngestion.ts's onIndexStatus callback), so there's no
// UX cost to waiting longer for a large legitimate file.
const MIN_PARSE_TIMEOUT_MS = 30_000;
const MAX_PARSE_TIMEOUT_MS = 5 * 60_000;
const PARSE_TIMEOUT_MS_PER_MB = 2_000;

// Test-overridable so the timeout/cancellation path can be exercised
// deterministically (a real parse finishing in ms, not 30s+) instead of
// requiring an artificially slow/poison fixture. When set, this literal
// value wins regardless of file size.
const PARSE_TIMEOUT_MS_OVERRIDE = process.env.NATIVELY_PARSE_TIMEOUT_MS
  ? Number(process.env.NATIVELY_PARSE_TIMEOUT_MS)
  : undefined;

export const computeParseTimeoutMs = (fileSizeBytes: number): number => {
  if (PARSE_TIMEOUT_MS_OVERRIDE !== undefined) return PARSE_TIMEOUT_MS_OVERRIDE;
  const sizeMb = fileSizeBytes / (1024 * 1024);
  return Math.min(MAX_PARSE_TIMEOUT_MS, Math.max(MIN_PARSE_TIMEOUT_MS, sizeMb * PARSE_TIMEOUT_MS_PER_MB));
};

let pdfjsWorkerSrcPinned = false;

/**
 * Race `promise` against a timeout. Unlike a bare `Promise.race`, this always
 * clears its own timer once `promise` settles (so a successful parse doesn't
 * leave a dangling timer/closure behind), and on timeout it invokes
 * `onTimeout` (used by the PDF branch to call `parser.destroy()`, the only
 * cancellation primitive pdf-parse exposes) and swallows `promise`'s eventual
 * settlement so it can't surface as an unhandled rejection after we've
 * already rejected on its behalf.
 */
const withTimeout = <T>(promise: Promise<T>, label: string, timeoutMs: number, onTimeout?: () => void): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      onTimeout?.();
      promise.catch(() => {});
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });

/**
 * Pinned once per process. pdf-parse@2.x wraps pdfjs-dist@5.4.296 (legacy
 * build) whose `new URL("./pdf.worker.mjs", import.meta.url)` default
 * resolves to a missing dist-electron/electron/pdf.worker.mjs under
 * esbuild's bundle. Pin to the real path on first call.
 */
const pinPdfjsWorkerSrcOnce = async (): Promise<void> => {
  if (pdfjsWorkerSrcPinned) return;
  const pdfjsLib: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const current = pdfjsLib?.GlobalWorkerOptions?.workerSrc;
  let currentIsBroken = !current || current === './pdf.worker.mjs';
  if (current && !currentIsBroken) {
    try {
      const candidatePath = current.startsWith('file://') ? fileURLToPath(current) : current;
      currentIsBroken = !fs.existsSync(candidatePath);
    } catch {
      currentIsBroken = true;
    }
  }
  if (currentIsBroken) {
    const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
  }
  pdfjsWorkerSrcPinned = true;
};

/**
 * Decode a plain-text extension's bytes to a Unicode string. BOM is
 * stripped. UTF-16 BE is detected and byte-swapped; UTF-16 LE is detected
 * via BOM; UTF-8 with BOM is stripped; everything else is decoded as
 * UTF-8. A run of NUL bytes in the first 2 KiB throws — the file is
 * almost certainly binary and was mislabeled.
 */
const parseTextFile = (buffer: Buffer, fileName: string, ext: string): string => {
  if (buffer.length === 0) throw new Error(`${fileName} is empty`);
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le');
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.allocUnsafe(buffer.length - 2);
    for (let index = 2; index + 1 < buffer.length; index += 2) {
      swapped[index - 2] = buffer[index + 1];
      swapped[index - 1] = buffer[index];
    }
    return swapped.toString('utf16le');
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf8');
  }
  if (buffer.subarray(0, Math.min(2048, buffer.length)).includes(0)) {
    throw new Error(`${fileName} looks binary despite ${ext}`);
  }
  return buffer.toString('utf8');
};

export interface SafeDocumentTextExtractResult {
  filePath: string;
  fileName: string;
  extension: string;
  content: string;
  binarySha256: string;
  pageCount?: number;
  extractedPageCount?: number;
}

/**
 * Extract text from a user-selected regular file. Callers MUST authorize the
 * path (and the file's provenance as a "user selected it" event) before
 * calling this function. This module enforces file safety only — extension,
 * size, BOM, binary-mislabel, symlink. PDF/DOCX/text parsing goes through
 * the same code path the Modes upload already trusted (extracted from
 * ModeReferenceFileIngestion).
 */
export const extractSafeDocumentText = async (
  inputFilePath: string,
): Promise<SafeDocumentTextExtractResult> => {
  const filePath = path.resolve(inputFilePath);
  const fileName = path.basename(filePath);
  const extension = path.extname(fileName).toLowerCase();
  if (!SAFE_DOCUMENT_EXTENSIONS.has(extension)) {
    throw new Error(`unsupported file type ${extension || 'none'}`);
  }

  const stats = await fs.promises.lstat(filePath);
  if (!stats.isFile()) throw new Error('selected path is not a regular file');
  if (stats.size > SAFE_DOCUMENT_MAX_BYTES) throw new Error('file exceeds 50 MB limit');

  const binary = await fs.promises.readFile(filePath);
  const binarySha256 = crypto.createHash('sha256').update(binary).digest('hex');
  const parseTimeoutMs = computeParseTimeoutMs(stats.size);
  let content = '';
  let pageCount: number | undefined;
  let extractedPageCount: number | undefined;

  if (extension === '.pdf') {
    await pinPdfjsWorkerSrcOnce();
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: binary });
    try {
      // `parser.destroy()` is idempotent (no-ops once `this.doc` is
      // undefined) and, called mid-parse, makes pdf-parse's internal
      // `doc.getPage(i)` loop reject on its next iteration — the only
      // cancellation primitive this library exposes, so a timeout actually
      // stops the underlying pdfjs work instead of merely giving up on it.
      const data: any = await withTimeout<any>(
        parser.getText(),
        'PDF parse',
        parseTimeoutMs,
        () => { parser.destroy().catch(() => {}); },
      );
      pageCount =
        typeof data?.total === 'number' && data.total > 0
          ? data.total
          : Array.isArray(data?.pages)
            ? data.pages.length
            : undefined;
      if (Array.isArray(data?.pages) && data.pages.length > 0) {
        extractedPageCount = data.pages.filter(
          (page: any) => typeof page?.text === 'string' && page.text.trim(),
        ).length;
        content = data.pages
          .map(
            (page: any) =>
              `[Page ${page.num}]\n${typeof page.text === 'string' ? page.text : ''}`,
          )
          .join('\n\n');
      } else {
        content = String(data?.text || '');
      }
    } finally {
      await parser.destroy().catch(() => {});
    }
  } else if (extension === '.docx') {
    // mammoth has no cancellation/destroy surface at all, so a timeout here
    // (unlike the PDF branch) can't stop the underlying parse — it can only
    // give up waiting on it. Accepted asymmetry, not a gap in this fix.
    const mammoth = require('mammoth');
    const data: any = await withTimeout<any>(
      mammoth.extractRawText({ path: filePath }),
      'DOCX parse',
      parseTimeoutMs,
    );
    content = String(data?.value || '');
  } else {
    content = parseTextFile(binary, fileName, extension);
  }

  if (!content.trim()) throw new Error('file parsed to empty text');

  return {
    filePath,
    fileName,
    extension,
    content,
    binarySha256,
    pageCount,
    extractedPageCount,
  };
};
