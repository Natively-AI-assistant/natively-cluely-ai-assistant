# Design and migrate the knowledge document SQLite schema

**Labels:** `wayfinder:task`  
**Map:** [Natively Pro Features — Open Source Reimplementation](../map.md)  
**Blocked by:** 01  
**Blocks:** 06

## Question

The existing SQLite schema (`DatabaseManager.ts`) has `chunks`/`chunk_summaries`/`vec_chunks_*` tables for meeting RAG. The KnowledgeOrchestrator needs its own tables for ingested documents (resume, JD, reference files). What schema is needed and how does it fit into the existing migration versioning?

## Scope

- New tables needed:
  - `knowledge_documents` — `(id, doc_type TEXT, file_path TEXT, file_name TEXT, raw_text TEXT, structured_data TEXT, created_at, updated_at)`
  - `knowledge_chunks` — `(id, document_id, chunk_index, text TEXT, embedding BLOB)`
  - `vec_knowledge_chunks_{dim}` — sqlite-vec virtual table mirroring the pattern of `vec_chunks_{dim}`
- Add as a new migration version in `DatabaseManager.ts` (currently at v25 — add v26)
- `KnowledgeDatabaseManager` class wraps these tables with typed CRUD methods: `upsertDocument`, `deleteByDocType`, `saveChunks`, `queryChunksByEmbedding`, `getDocumentByType`
- `DocType` enum: `RESUME = 'resume'`, `JD = 'jd'`, `REFERENCE = 'reference'`

## Answer

**Migration version:** `v25 → v26` in `electron/db/DatabaseManager.ts`.

### Schema DDL (v26)

```sql
CREATE TABLE IF NOT EXISTS knowledge_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_type TEXT NOT NULL,
    file_path TEXT,
    file_name TEXT,
    raw_text TEXT NOT NULL DEFAULT '',
    structured_data TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_doc_type ON knowledge_documents(doc_type);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    embedding BLOB,
    embedding_provider TEXT,
    embedding_dimensions INTEGER,
    embedding_space TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_document ON knowledge_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding_space ON knowledge_chunks(embedding_space);

-- provisioned per KNOWN_DIMS (768/1536/3072) + lazily at runtime, mirroring vec_chunks_{dim}
CREATE VIRTUAL TABLE IF NOT EXISTS vec_knowledge_chunks_{dim} USING vec0(
    chunk_id INTEGER PRIMARY KEY,
    embedding float[{dim}]
);
```

Design note: unlike meeting `chunks` (which read `embedding_space` off the parent
`meetings` row), a knowledge chunk has no meeting parent — so the composite space
key (`${name}:${model}:${dims}`, see `embeddingSpace.ts`) lives on `knowledge_chunks`
directly and the re-index/search paths filter on it there. The
`vec_knowledge_chunks_{dim}` provisioning was folded into the existing
`ensureVecTableForDim()` helper so novel runtime dimensions get a knowledge vec
table alongside `vec_chunks_{dim}` / `vec_summaries_{dim}`.

### New files

- `electron/knowledge/types.ts` — `DocType` enum: `RESUME='resume'`, `JD='jd'`,
  `REFERENCE='reference'`, `LESSON='lesson'` (LESSON defined now for enum stability).
- `electron/knowledge/KnowledgeDatabaseManager.ts` — constructor takes the shared
  `better-sqlite3` handle (VectorStore pattern), re-asserts `foreign_keys = ON`.

### KnowledgeDatabaseManager method signatures

```ts
constructor(db: Database.Database)
upsertDocument(doc: { docType: DocType; filePath?: string | null; fileName?: string | null; rawText: string; structuredData?: string | null }): number
deleteByDocType(docType: DocType): void
saveChunks(documentId: number, chunks: KnowledgeChunkInput[]): number[]
queryChunksByEmbedding(queryEmbedding: number[], options?: { docType?: DocType; limit?: number; minSimilarity?: number; spaceKey?: string }): Promise<ScoredKnowledgeChunk[]>
getDocumentByType(docType: DocType): KnowledgeDocument | null
```

`queryChunksByEmbedding` enforces the same hard invariant as
`VectorStore.searchSimilar`: no `spaceKey` → returns `[]` (fail-closed, never
searches across embedding spaces). Native sqlite-vec ANN with a JS-cosine
fallback; results are filterable by `doc_type` and carry validation metadata
(`embeddingSpace`, `vectorSearch`) so similarity alone is never treated as proof.
`upsertDocument` treats documents as singletons per `doc_type` (delete-then-insert
in one transaction; chunks + vec0 rows reaped). `saveChunks` dual-writes
BLOB + per-dimension vec0 table like `VectorStore.storeEmbedding`.

### Verification

- `tsc -p electron/tsconfig.json --noEmit` → **0 errors** (strictly stronger than
  `build:electron`, which is esbuild transpile-only per the script header).
- Isolated logic check of `cosineSimilarity` (identical→1, orthogonal→0,
  zero-vector→0 no-NaN) + fail-closed space guard: passes.
- `npm run build:electron` and `node --test` could NOT be run: this checkout's
  `node_modules` was empty and `npm install` fails (user's `~/.npmrc` default
  registry is an auth-expired AWS CodeArtifact mirror, and the public npm
  registry is unreachable from this environment). The `esbuild` wrapper and the
  `better-sqlite3` native binary therefore never extracted, so neither the
  esbuild build nor the native-DB migration tests are runnable here.
