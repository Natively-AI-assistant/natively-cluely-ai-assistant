// electron/localKnowledge/ProfileIndex.ts
//
// Storage and retrieval for the local resume and job description.
//
// This does not build a second RAG stack. electron/services/modes/
// ModeHybridRetriever.ts already chunks a document, embeds it, persists the
// vectors, and serves hybrid BM25-plus-vector queries with a lexical fallback
// when no embedding provider is up. Its `indexFile()` and `retrieve()` both
// take the file records as plain objects rather than reading them back from
// the modes tables, so the profile can be presented to that engine directly.
//
// The profile therefore rides the same retrieval engine as mode reference
// files, under a reserved mode id and two stable file ids. Improvements to
// that engine reach the profile at no cost, and there is one chunking and
// ranking implementation to keep correct rather than two.
//
// What this module owns is the part the engine does not: the document record
// itself, the structured profile extracted from it, and deletion that removes
// both the record and its vectors atomically.

import type Database from 'better-sqlite3';
import { EmbeddingPipeline } from '../rag/EmbeddingPipeline';
import { VectorStore } from '../rag/VectorStore';
import {
  ModeHybridRetriever,
  type ModeRetrievedContext,
} from '../services/modes/ModeHybridRetriever';
import type { ModeReferenceFile } from '../services/ModesManager';
import type { LocalIngestedDocument } from './DocumentReader';
import { DocType } from './types';

/**
 * Reserved mode id for profile documents.
 *
 * It is deliberately not a real mode: no row exists in the modes table, and it
 * cannot collide with a user-created mode, whose ids are generated. It exists
 * because the retrieval engine's records carry a mode id, and a profile
 * belongs to no mode.
 */
export const PROFILE_MODE_ID = '__local_profile__';

/** Stable per-type file ids, so re-uploading replaces rather than accumulates. */
export function profileFileId(docType: DocType): string {
  return `local-profile-${docType}`;
}

export interface StoredProfileDocument {
  docType: DocType;
  filePath: string;
  fileName: string;
  extension: string;
  content: string;
  binarySha256: string;
  contentSha256: string;
  pageCount?: number;
  extractedPageCount?: number;
  ingestedAt: number;
  /**
   * Parsed structured facts, or null when the document was never extracted.
   * The shape depends on the document type -- a resume yields
   * StructuredProfileFacts, a job description StructuredJobFacts -- so this
   * stays untyped here and each reader narrows it.
   */
  structuredData: Record<string, unknown> | null;
  extractionMode: string | null;
}

export interface PutDocumentResult {
  stored: true;
  /** False when no embedding provider was available, so retrieval is lexical-only. */
  embedded: boolean;
  reason?: string;
}

export interface ProfileIndexStatus {
  hasResume: boolean;
  hasJD: boolean;
  /** Index state per stored document, straight from the retrieval engine. */
  documents: Array<{ docType: DocType; fileName: string; indexStatus: string; chunkCount: number }>;
  embeddingReady: boolean;
}

export interface ProfileIndexDependencies {
  db: Database.Database;
  dbPath: string;
  /**
   * Must be an INITIALIZED pipeline. See setEmbeddingPipeline for why this is
   * never constructed here when one is missing.
   */
  embeddingPipeline?: EmbeddingPipeline | null;
}

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS local_profile_documents (
    doc_type TEXT PRIMARY KEY,
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    extension TEXT NOT NULL,
    content TEXT NOT NULL,
    binary_sha256 TEXT NOT NULL,
    content_sha256 TEXT NOT NULL,
    page_count INTEGER,
    extracted_page_count INTEGER,
    ingested_at INTEGER NOT NULL,
    structured_json TEXT,
    extraction_mode TEXT
  )
`;

export class ProfileIndex {
  private readonly db: Database.Database;
  private readonly dbPath: string;
  private embeddingPipeline: EmbeddingPipeline | null;
  private retriever: ModeHybridRetriever | null = null;

  constructor(deps: ProfileIndexDependencies) {
    this.db = deps.db;
    this.dbPath = deps.dbPath;
    this.embeddingPipeline = deps.embeddingPipeline ?? null;
    this.db.exec(CREATE_TABLE);
  }

  /**
   * Supply the shared, initialized embedding pipeline.
   *
   * The cached retriever is dropped so a retriever built before the pipeline
   * arrived cannot outlive it. ModeContextRetriever does the same, and its
   * comment (electron/services/ModeContextRetriever.ts:1668-1680) records why
   * this module never constructs a pipeline of its own as a stopgap: an
   * EmbeddingPipeline nobody calls `initialize()` on keeps a null provider
   * forever, so the retriever built over it degrades to lexical for the rest
   * of the process's life, silently and permanently.
   */
  setEmbeddingPipeline(pipeline: EmbeddingPipeline): void {
    this.embeddingPipeline = pipeline;
    this.retriever = null;
  }

  /** The retrieval engine, or null while no embedding pipeline has been supplied. */
  private ensureRetriever(): ModeHybridRetriever | null {
    if (this.retriever) return this.retriever;
    if (!this.embeddingPipeline) return null;
    if (!this.db.open) return null;

    // VectorStore uses the caller's connection; dbPath and extPath are legacy
    // parameters it no longer reads (electron/rag/VectorStore.ts:50-61).
    const vectorStore = new VectorStore(this.db, this.dbPath, '');
    this.retriever = new ModeHybridRetriever(this.db, vectorStore, this.embeddingPipeline);
    return this.retriever;
  }

  /** Present a stored document to the retrieval engine in the shape it expects. */
  private toReferenceFile(document: StoredProfileDocument): ModeReferenceFile {
    return {
      id: profileFileId(document.docType),
      modeId: PROFILE_MODE_ID,
      fileName: document.fileName,
      content: document.content,
      createdAt: new Date(document.ingestedAt).toISOString(),
      pageCount: document.pageCount,
      extractedPageCount: document.extractedPageCount,
    };
  }

  /**
   * Store a document and index it, replacing any previous document of the same
   * type.
   *
   * Storage and indexing are deliberately separate outcomes. Indexing needs an
   * embedding provider, which may not be running; the document is still stored
   * and still retrievable lexically, and `embedded` reports which happened so a
   * caller can retry later rather than guess.
   */
  async put(
    document: LocalIngestedDocument,
    extraction?: { structured_data: Record<string, unknown>; extractionMode: string } | null,
  ): Promise<PutDocumentResult> {
    this.db
      .prepare(
        `INSERT INTO local_profile_documents (
           doc_type, file_path, file_name, extension, content, binary_sha256, content_sha256,
           page_count, extracted_page_count, ingested_at, structured_json, extraction_mode
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(doc_type) DO UPDATE SET
           file_path = excluded.file_path,
           file_name = excluded.file_name,
           extension = excluded.extension,
           content = excluded.content,
           binary_sha256 = excluded.binary_sha256,
           content_sha256 = excluded.content_sha256,
           page_count = excluded.page_count,
           extracted_page_count = excluded.extracted_page_count,
           ingested_at = excluded.ingested_at,
           structured_json = excluded.structured_json,
           extraction_mode = excluded.extraction_mode`,
      )
      .run(
        document.docType,
        document.filePath,
        document.fileName,
        document.extension,
        document.content,
        document.binarySha256,
        document.contentSha256,
        document.pageCount ?? null,
        document.extractedPageCount ?? null,
        document.ingestedAt,
        extraction ? JSON.stringify(extraction.structured_data) : null,
        extraction?.extractionMode ?? null,
      );

    const stored = this.get(document.docType);
    const retriever = this.ensureRetriever();
    if (!retriever || !stored) {
      return {
        stored: true,
        embedded: false,
        reason: 'No embedding pipeline is available yet, so retrieval stays lexical until one is.',
      };
    }

    try {
      await retriever.indexFile(this.toReferenceFile(stored));
      const { status } = retriever.getFileIndexStatus(profileFileId(document.docType));
      return { stored: true, embedded: status === 'ready', reason: status === 'ready' ? undefined : `index status: ${status}` };
    } catch (error) {
      // A failed index is not a failed upload. The document is saved and the
      // lexical path still answers from it.
      const message = error instanceof Error ? error.message : String(error);
      return { stored: true, embedded: false, reason: `Indexing failed: ${message}` };
    }
  }

  /** The stored document of a type, or null. */
  get(docType: DocType): StoredProfileDocument | null {
    const row = this.db
      .prepare('SELECT * FROM local_profile_documents WHERE doc_type = ?')
      .get(docType) as Record<string, unknown> | undefined;
    return row ? rowToDocument(row) : null;
  }

  getAll(): StoredProfileDocument[] {
    const rows = this.db
      .prepare('SELECT * FROM local_profile_documents ORDER BY doc_type')
      .all() as Array<Record<string, unknown>>;
    return rows.map(rowToDocument);
  }

  /**
   * Retrieve passages relevant to a question.
   *
   * Returns null when nothing is stored, which the caller must treat as "no
   * grounding available" rather than as an error.
   */
  async retrieve(
    query: string,
    options: { topK?: number; tokenBudget?: number; hasTranscript?: boolean; allowRerank?: boolean; docTypes?: DocType[] } = {},
  ): Promise<ModeRetrievedContext | null> {
    const wanted = options.docTypes ?? [DocType.RESUME, DocType.JD];
    const documents = this.getAll().filter((doc) => wanted.includes(doc.docType));
    if (documents.length === 0) return null;

    const retriever = this.ensureRetriever();
    if (!retriever) return null;

    return retriever.retrieve({
      query,
      modeId: PROFILE_MODE_ID,
      files: documents.map((doc) => this.toReferenceFile(doc)),
      topK: options.topK,
      tokenBudget: options.tokenBudget,
      hasTranscript: options.hasTranscript,
      allowRerank: options.allowRerank,
      // A profile question such as "what did I do at Acme" has little lexical
      // overlap with the resume's wording, which is exactly the case the
      // engine's identity block exists for.
      forceDocumentGrounding: true,
    });
  }

  /**
   * Remove a document and everything derived from it, atomically.
   *
   * The deletes are written here rather than delegated to the engine's
   * `removeFileIndex()`, which catches and logs its own failures
   * (electron/services/modes/ModeHybridRetriever.ts:580-588). A call that never
   * throws cannot roll a transaction back, so delegating would leave the
   * document row deleted and its vectors orphaned on failure. The rows carry
   * resume content, so a partial delete is a privacy problem, not just an
   * inconsistency.
   */
  deleteByType(docType: DocType): boolean {
    const fileId = profileFileId(docType);

    const removed = this.db.transaction(() => {
      const result = this.db.prepare('DELETE FROM local_profile_documents WHERE doc_type = ?').run(docType);
      // The engine creates its own tables in its constructor, which only runs
      // once an embedding pipeline exists. A profile stored before that has no
      // vectors to remove, and issuing the delete anyway would throw "no such
      // table" and abort the whole transaction, leaving the document in place.
      for (const table of ['mode_reference_chunks', 'mode_reference_index_state']) {
        if (this.tableExists(table)) {
          this.db.prepare(`DELETE FROM ${table} WHERE file_id = ?`).run(fileId);
        }
      }
      return result.changes > 0;
    })();

    // In-memory caches are dropped only after the transaction commits, so a
    // rollback cannot leave the engine's cache disagreeing with the database.
    this.retriever?.removeFileIndex(fileId);
    return removed;
  }

  private tableExists(name: string): boolean {
    const row = this.db
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name);
    return Boolean(row);
  }

  getStatus(): ProfileIndexStatus {
    const documents = this.getAll();
    const retriever = this.ensureRetriever();

    return {
      hasResume: documents.some((doc) => doc.docType === DocType.RESUME),
      hasJD: documents.some((doc) => doc.docType === DocType.JD),
      embeddingReady: Boolean(retriever),
      documents: documents.map((doc) => {
        const state = retriever?.getFileIndexStatus(profileFileId(doc.docType));
        return {
          docType: doc.docType,
          fileName: doc.fileName,
          indexStatus: state?.status ?? 'pending',
          chunkCount: state?.chunkCount ?? 0,
        };
      }),
    };
  }
}

function rowToDocument(row: Record<string, unknown>): StoredProfileDocument {
  let structuredData: Record<string, unknown> | null = null;
  if (typeof row.structured_json === 'string' && row.structured_json) {
    try {
      structuredData = JSON.parse(row.structured_json) as Record<string, unknown>;
    } catch {
      // A row written by an older or interrupted build should not make the
      // whole profile unreadable; the document text is still usable.
      structuredData = null;
    }
  }

  return {
    docType: row.doc_type as DocType,
    filePath: String(row.file_path ?? ''),
    fileName: String(row.file_name ?? ''),
    extension: String(row.extension ?? ''),
    content: String(row.content ?? ''),
    binarySha256: String(row.binary_sha256 ?? ''),
    contentSha256: String(row.content_sha256 ?? ''),
    pageCount: row.page_count == null ? undefined : Number(row.page_count),
    extractedPageCount: row.extracted_page_count == null ? undefined : Number(row.extracted_page_count),
    ingestedAt: Number(row.ingested_at ?? 0),
    structuredData,
    extractionMode: row.extraction_mode == null ? null : String(row.extraction_mode),
  };
}
