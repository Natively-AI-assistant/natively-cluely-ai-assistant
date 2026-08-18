// electron/localKnowledge/DocumentReader.ts
//
// Reads a user-selected resume or job description into normalized text.
//
// This is the front half of the local `ingestDocument()` implementation: bytes
// on disk become clean UTF-8 text plus provenance. Structured extraction
// (task 5) and chunking or embedding (task 6) consume the result; neither
// belongs here.
//
// Parsing itself is delegated, not reimplemented. electron/services/
// SafeDocumentTextExtractor.ts already owns the PDF, DOCX, and plain-text
// parsers, the 50 MB cap, the symlink and binary-mislabel checks, and the
// size-scaled parse timeout. The premium DocumentReader used the same utility
// (see the note at electron/services/ModeReferenceFileIngestion.ts:9-15), so
// delegating keeps the local path on the identical format contract, and a
// parser fix reaches both.
//
// This module adds the two things the shared extractor leaves to its callers:
// text normalization suitable for embedding, and error results instead of
// thrown exceptions.

import * as crypto from 'crypto';
import * as path from 'path';
import { extractSafeDocumentText, SAFE_DOCUMENT_EXTENSIONS } from '../services/SafeDocumentTextExtractor';
import { DocType } from './types';

/** A document that has been read, normalized, and is ready for extraction and indexing. */
export interface LocalIngestedDocument {
  docType: DocType;
  /** Absolute, resolved path the text came from. */
  filePath: string;
  fileName: string;
  /** Lowercase, with the leading dot: `.pdf`, `.docx`, `.txt`. */
  extension: string;
  /** Normalized text. See normalizeDocumentText for what normalized means. */
  content: string;
  /** Digest of the raw bytes. Detects a re-upload of the identical file. */
  binarySha256: string;
  /**
   * Digest of the normalized text. Detects the same content arriving in a
   * different container: the resume exported once as PDF and once as DOCX, or
   * the same file saved with CRLF instead of LF.
   */
  contentSha256: string;
  /** PDF only: pages in the document, and pages that yielded any text. */
  pageCount?: number;
  extractedPageCount?: number;
  /** Unix milliseconds, for retention and staleness decisions. */
  ingestedAt: number;
}

export interface ReadDocumentResult {
  success: boolean;
  error?: string;
  document?: LocalIngestedDocument;
}

/**
 * Build a character-class regex from code point ranges.
 *
 * The characters this module strips are invisible by definition, so writing
 * them as literals would put unreadable bytes in the source and make the
 * intent impossible to review. Naming the code points keeps the file pure
 * ASCII and lets a reader look each one up.
 */
function charClass(ranges: Array<[number, number]>, flags: string): RegExp {
  const body = ranges
    .map(([lo, hi]) =>
      lo === hi
        ? String.fromCharCode(lo)
        : `${String.fromCharCode(lo)}-${String.fromCharCode(hi)}`,
    )
    .join('');
  return new RegExp(`[${body}]`, flags);
}

/**
 * Space characters that survive extraction but corrupt retrieval.
 *
 * PDF and DOCX text is full of typographic spaces that look identical to a
 * plain space on screen but are distinct code points: no-break space (00A0),
 * Ogham space mark (1680), the en/em quad family (2000-200A), narrow no-break
 * space (202F), medium mathematical space (205F), and ideographic space
 * (3000). Left in place they split tokens, so a search for "Senior Engineer"
 * misses a resume that joins the two words with a no-break space. Mapping them
 * to a plain space removes a whole class of silent retrieval misses.
 */
const UNICODE_SPACE_LIKE = charClass(
  [[0x00a0, 0x00a0], [0x1680, 0x1680], [0x2000, 0x200a], [0x202f, 0x202f], [0x205f, 0x205f], [0x3000, 0x3000]],
  'g',
);

/**
 * Zero-width and bidirectional marks (200B-200F, 2060, FEFF). They render as
 * nothing, so a reader cannot see them, but they break substring matching.
 */
const ZERO_WIDTH = charClass([[0x200b, 0x200f], [0x2060, 0x2060], [0xfeff, 0xfeff]], 'g');

/**
 * C0 and C1 control characters, excluding tab (0009) and newline (000A), which
 * carry real document structure.
 */
const CONTROL_CHARS = charClass(
  [[0x0000, 0x0008], [0x000b, 0x000c], [0x000e, 0x001f], [0x007f, 0x009f]],
  'g',
);

/**
 * Normalize extracted text so the same document produces the same chunks and
 * embeddings regardless of which platform or tool produced the file.
 *
 * Two of these steps exist specifically because Natively runs on macOS and
 * Windows:
 *
 * - Line endings. A file authored on Windows arrives with CRLF. Without
 *   normalization the same resume chunks differently on each platform, so a
 *   profile indexed on one machine retrieves differently on the other.
 * - Unicode composition. macOS stores and often emits decomposed forms (NFD),
 *   so an accented name arrives as the bare letter plus a combining accent,
 *   while the same name typed on Windows arrives precomposed (NFC). The two
 *   are different byte sequences and therefore different tokens. NFC is the
 *   interchange form, so normalize to it.
 */
export function normalizeDocumentText(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(UNICODE_SPACE_LIKE, ' ')
    .replace(ZERO_WIDTH, '')
    .replace(CONTROL_CHARS, '')
    // Trailing spaces are invisible to the reader but change a chunk's hash.
    .replace(/[ \t]+$/gm, '')
    // Resumes exported from design tools carry long runs of blank lines. Two
    // blank lines still read as a section break; ten add nothing but tokens.
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Human-readable extension list, for the unsupported-type message. */
const SUPPORTED_LIST = Array.from(SAFE_DOCUMENT_EXTENSIONS).sort().join(', ');

/**
 * Turn a parse failure into something a person can act on.
 *
 * The shared extractor throws terse, developer-facing messages. These reach the
 * upload UI directly, so rewrite them into an instruction wherever the user has
 * a way to fix the problem.
 */
function describeFailure(error: unknown, extension: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as NodeJS.ErrnoException | undefined)?.code;

  if (message.includes('unsupported file type')) {
    // .doc is the common case and has a specific remedy. The caller at
    // electron/ipcHandlers.ts:10536 substitutes its own .doc message when the
    // result is unsuccessful, so this text is the fallback for other formats.
    if (extension === '.doc') {
      return 'Legacy Word .doc files are not supported. Save the file as .docx and upload it again.';
    }
    return `That file type is not supported. Supported formats: ${SUPPORTED_LIST}.`;
  }
  if (message.includes('exceeds 50 MB')) {
    return 'That file is larger than the 50 MB limit.';
  }
  if (message.includes('not a regular file')) {
    return 'That path is not a file. Select the document itself, not a folder or a shortcut.';
  }
  if (message.includes('timed out')) {
    return 'Reading that file took too long and stopped. Try a smaller file, or export it again.';
  }
  if (message.includes('looks binary')) {
    return 'That file is not readable as text, even though its extension says it is. Export it again.';
  }
  if (message.includes('parsed to empty text') || message.includes('is empty')) {
    return 'No text could be read from that file. A scanned PDF holds images rather than text, so export a text version.';
  }
  if (code === 'ENOENT') {
    return 'That file no longer exists at the path given.';
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return 'Natively does not have permission to read that file.';
  }
  if (code === 'EBUSY') {
    // Windows locks a file while another process holds a handle to it; macOS
    // does not. Word holding the resume open is the realistic cause.
    return 'That file is open in another program. Close it and try again.';
  }
  return `That file could not be read: ${message}`;
}

/**
 * Read one document from disk.
 *
 * The caller must authorize `filePath` first. This function performs no
 * authorization of its own, matching the contract the shared extractor states.
 * Failures come back as `{ success: false, error }` rather than as exceptions,
 * because every caller of `ingestDocument()` branches on `result.success` and
 * shows `result.error` to the user verbatim.
 */
export async function readLocalDocument(
  filePath: string,
  docType: DocType,
): Promise<ReadDocumentResult> {
  if (!filePath || typeof filePath !== 'string') {
    return { success: false, error: 'No file was selected.' };
  }

  // Read before the try block so the failure message can name the format even
  // when the extractor rejects the path before it reports one.
  const extension = path.extname(filePath).toLowerCase();

  try {
    const extracted = await extractSafeDocumentText(filePath);
    const content = normalizeDocumentText(extracted.content);

    if (!content) {
      return { success: false, error: 'That file held only formatting, with no readable text.' };
    }

    return {
      success: true,
      document: {
        docType,
        filePath: extracted.filePath,
        fileName: extracted.fileName,
        extension: extracted.extension,
        content,
        binarySha256: extracted.binarySha256,
        contentSha256: crypto.createHash('sha256').update(content).digest('hex'),
        pageCount: extracted.pageCount,
        extractedPageCount: extracted.extractedPageCount,
        ingestedAt: Date.now(),
      },
    };
  } catch (error) {
    return { success: false, error: describeFailure(error, extension) };
  }
}
