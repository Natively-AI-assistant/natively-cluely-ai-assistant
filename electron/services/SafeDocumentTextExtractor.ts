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
const PARSE_TIMEOUT_MS = 30_000;

let pdfjsWorkerSrcPinned = false;

const withTimeout = <T>(promise: Promise<T>, label: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${PARSE_TIMEOUT_MS}ms`)),
        PARSE_TIMEOUT_MS,
      ),
    ),
  ]);

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
  let content = '';
  let pageCount: number | undefined;
  let extractedPageCount: number | undefined;

  if (extension === '.pdf') {
    await pinPdfjsWorkerSrcOnce();
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: binary });
    const data: any = await withTimeout<any>(parser.getText(), 'PDF parse');
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
  } else if (extension === '.docx') {
    const mammoth = require('mammoth');
    const data: any = await withTimeout<any>(
      mammoth.extractRawText({ path: filePath }),
      'DOCX parse',
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
