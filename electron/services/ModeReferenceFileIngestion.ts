// Shared production reference-file ingestion for Modes Manager uploads.
//
// The dialog IPC and the gated E2E benchmark ingress both call this use case so
// benchmark parsing/persistence cannot silently drift from the user-facing path.

import * as crypto from 'crypto';
import { ModesManager } from './ModesManager';
import {
  extractSafeDocumentText,
  SAFE_DOCUMENT_EXTENSIONS,
  SAFE_DOCUMENT_MAX_BYTES,
} from './SafeDocumentTextExtractor';

// Retain the Modes-facing exports while sharing one document-format contract.
export const MODE_REFERENCE_FILE_EXTENSIONS = SAFE_DOCUMENT_EXTENSIONS;
export const MODE_REFERENCE_FILE_MAX_BYTES = SAFE_DOCUMENT_MAX_BYTES;

export interface ModeReferenceFileIngestResult {
  id: string;
  fileName: string;
  pageCount?: number;
  extractedPageCount?: number;
  binarySha256: string;
  contentSha256: string;
}

export interface ModeReferenceFileIngestOptions {
  modeId: string;
  filePath: string;
  onIndexStatus?: (status: 'indexing' | 'done', fileId: string) => void;
}

/**
 * Parse, persist, and begin indexing a user-selected regular file. Callers must
 * perform UI/authorization policy; this use case delegates file safety and
 * parsing to the shared document extractor before Modes-specific persistence.
 */
export const ingestModeReferenceFile = async (
  options: ModeReferenceFileIngestOptions,
): Promise<ModeReferenceFileIngestResult> => {
  const extracted = await extractSafeDocumentText(options.filePath);
  const contentSha256 = crypto.createHash('sha256').update(extracted.content).digest('hex');
  const manager = ModesManager.getInstance();
  const file = manager.addReferenceFile({
    modeId: options.modeId,
    fileName: extracted.fileName,
    content: extracted.content,
    pageCount: extracted.pageCount,
    extractedPageCount: extracted.extractedPageCount,
  });

  options.onIndexStatus?.('indexing', file.id);
  void (async () => {
    try {
      await manager.indexReferenceFile(file);
      const finalStatus = manager.getReferenceFileIndexStatus(file.id);
      if (finalStatus?.status === 'failed' || finalStatus?.status === 'lexical_only') {
        // The caller's application lifecycle owns retries; this preserves the
        // normal upload's non-blocking response behavior.
      }
    } catch (error: any) {
      console.warn('[ModeReferenceFileIngestion] index failed (lexical fallback remains):', error?.message);
    } finally {
      options.onIndexStatus?.('done', file.id);
    }
  })();

  return {
    id: file.id,
    fileName: extracted.fileName,
    pageCount: extracted.pageCount,
    extractedPageCount: extracted.extractedPageCount,
    binarySha256: extracted.binarySha256,
    contentSha256,
  };
};