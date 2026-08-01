// electron/context-intelligence/debug/ingest-debug.ts
//
// [CONTEXT_DEBUG_INGEST] emission. Observes what the ingest/index pipeline
// already computed (chunk counts, embedded counts, page counts, index state) —
// it recomputes nothing. Level 'off' costs one function call. Never throws.

import type { ContextDebugIngest } from './debug-types';
import { CONTEXT_DEBUG_SCHEMA_VERSION } from './debug-types';
import { getContextDebugLevel } from './debug-config';
import { getContextDebugWriter } from './jsonl-writer';
import { deepRedactStrings } from './redaction';
import { renderIngestSummary } from './terminal';

export interface ModeFileIngestSnapshot {
  fileId: string;
  fileName: string;
  modeId?: string;
  role?: string;
  status?: string;
  characters?: number;
  expectedPages?: number;
  parsedPages?: number;
  chunkCount: number;
  embeddedChunkCount: number;
  embeddingSpace?: string | null;
  indexState: 'ready' | 'failed' | string;
  totalMs?: number;
  errorMessage?: string;
}

export function emitModeFileIngestDebug(snapshot: ModeFileIngestSnapshot): void {
  try {
    if (getContextDebugLevel() === 'off') return;

    // OCR_REQUIRED beats every other verdict: a placeholder-only document has
    // no searchable content, and "PARTIAL" would still read as searchable
    // (measured misreport on the first live run). Zero parsed pages with pages
    // expected is the same condition arriving via the extractor's counters.
    const ocrRequired = snapshot.indexState === 'ocr_required'
      || (snapshot.expectedPages !== undefined && snapshot.expectedPages > 0 && snapshot.parsedPages === 0);
    const fullyEmbedded = snapshot.embeddedChunkCount >= snapshot.chunkCount && snapshot.chunkCount > 0;
    const pagesComplete = snapshot.expectedPages === undefined || snapshot.parsedPages === undefined
      || snapshot.parsedPages >= snapshot.expectedPages;
    const status: ContextDebugIngest['status'] =
      ocrRequired ? 'OCR_REQUIRED'
        : snapshot.indexState === 'failed' ? 'FAILED'
          : fullyEmbedded && pagesComplete ? 'READY'
            : 'PARTIAL';

    const record: ContextDebugIngest = {
      schemaVersion: CONTEXT_DEBUG_SCHEMA_VERSION,
      event: 'context_ingest_complete',
      timestamp: new Date().toISOString(),
      document: {
        id: snapshot.fileId,
        name: snapshot.fileName,
        ...(snapshot.role ? { role: snapshot.role } : {}),
        ...(snapshot.status ? { status: snapshot.status } : {}),
        ...(snapshot.modeId ? { modeId: snapshot.modeId } : {}),
      },
      parsing: {
        ...(snapshot.expectedPages !== undefined ? { expectedPages: snapshot.expectedPages } : {}),
        ...(snapshot.parsedPages !== undefined ? { parsedPages: snapshot.parsedPages } : {}),
        ...(snapshot.characters !== undefined ? { characters: snapshot.characters } : {}),
        chunkCount: snapshot.chunkCount,
      },
      indexes: {
        lexicalReady: snapshot.chunkCount > 0 && !ocrRequired,
        vectorReady: fullyEmbedded && !ocrRequired,
        embeddedChunkCount: snapshot.embeddedChunkCount,
        ...(snapshot.embeddingSpace !== undefined ? { embeddingSpace: snapshot.embeddingSpace } : {}),
        indexState: snapshot.indexState,
      },
      timing: { ...(snapshot.totalMs !== undefined ? { totalMs: snapshot.totalMs } : {}) },
      status,
      errors: snapshot.errorMessage
        ? [{ stage: 'source_manifest', message: snapshot.errorMessage, recoverable: true }]
        : [],
    };

    const redacted = deepRedactStrings(record);
    console.log(renderIngestSummary(redacted));
    getContextDebugWriter()?.append(redacted);
  } catch { /* debug logging must never affect ingestion */ }
}
