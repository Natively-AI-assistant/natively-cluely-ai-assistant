import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElectronMock } from '../../mocks/electron.mock'

// Mock electron module (needed because DatabaseManager imports it)
vi.mock('electron', () =>
  createElectronMock({
    app: {
      getAppPath: vi.fn(() => '/tmp/test'),
    },
  }),
)

// Mock DatabaseManager (used by VectorStore for KNOWN_DIMS and ensureVecTableForDim)
vi.mock('../../../electron/db/DatabaseManager', () => ({
  DatabaseManager: {
    KNOWN_DIMS: [768, 1536, 3072],
    getInstance: vi.fn(() => ({
      ensureVecTableForDim: vi.fn(),
      getDb: vi.fn(),
      getDbPath: vi.fn(() => '/tmp/test.db'),
      getExtPath: vi.fn(() => ''),
    })),
  },
}))

import type { Chunk } from '../../../electron/rag/SemanticChunker'
import { VectorStore } from '../../../electron/rag/VectorStore'

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.exec(`
        CREATE TABLE meetings (
            id TEXT PRIMARY KEY,
            title TEXT,
            start_time INTEGER,
            duration_ms INTEGER,
            summary_json TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            calendar_event_id TEXT,
            source TEXT,
            is_processed INTEGER DEFAULT 1,
            embedding_provider TEXT,
            embedding_dimensions INTEGER
        );
        CREATE TABLE chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            meeting_id TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            speaker TEXT,
            start_timestamp_ms INTEGER,
            end_timestamp_ms INTEGER,
            cleaned_text TEXT NOT NULL,
            token_count INTEGER NOT NULL,
            embedding BLOB,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
        );
        CREATE TABLE chunk_summaries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            meeting_id TEXT NOT NULL UNIQUE,
            summary_text TEXT NOT NULL,
            embedding BLOB,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
        );
        CREATE TABLE embedding_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            meeting_id TEXT NOT NULL,
            chunk_id INTEGER,
            status TEXT DEFAULT 'pending',
            retry_count INTEGER DEFAULT 0,
            error_message TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            processed_at TEXT,
            UNIQUE(meeting_id, chunk_id)
        );
    `)
  return db
}

function insertTestMeeting(
  db: Database.Database,
  id: string,
  provider?: string,
) {
  db.prepare(
    'INSERT INTO meetings (id, title, start_time, duration_ms, summary_json, embedding_provider, is_processed) VALUES (?, ?, ?, ?, ?, ?, 1)',
  ).run(id, `Meeting ${id}`, Date.now(), 300000, '{}', provider || null)
}

function makeChunks(count: number, meetingId = 'meeting-1'): Chunk[] {
  return Array.from({ length: count }, (_, i) => ({
    meetingId,
    chunkIndex: i,
    speaker: i % 2 === 0 ? 'Alice' : 'Bob',
    startMs: i * 10000,
    endMs: (i + 1) * 10000,
    text: `This is chunk number ${i} with some content for testing.`,
    tokenCount: 15,
  }))
}

describe('VectorStore', () => {
  let db: Database.Database
  let store: VectorStore

  beforeEach(() => {
    db = createTestDb()
    // useNativeVec will be false (no vec_chunks_768 table exists)
    store = new VectorStore(db, '/tmp/test.db', '')
  })

  afterEach(() => {
    db.close()
  })

  describe('saveChunks', () => {
    it('saves chunks and returns IDs', () => {
      insertTestMeeting(db, 'meeting-1')
      const chunks = makeChunks(3)
      const ids = store.saveChunks(chunks)
      expect(ids).toHaveLength(3)
      ids.forEach((id) => expect(typeof id).toBe('number'))
    })

    it('persists chunk data correctly', () => {
      insertTestMeeting(db, 'meeting-1')
      store.saveChunks(makeChunks(2))
      const rows = db
        .prepare('SELECT * FROM chunks ORDER BY chunk_index')
        .all() as any[]
      expect(rows).toHaveLength(2)
      expect(rows[0].speaker).toBe('Alice')
      expect(rows[1].speaker).toBe('Bob')
      expect(rows[0].cleaned_text).toBe(
        'This is chunk number 0 with some content for testing.',
      )
    })

    it('saves empty array without error', () => {
      insertTestMeeting(db, 'meeting-1')
      const ids = store.saveChunks([])
      expect(ids).toHaveLength(0)
    })
  })

  describe('getChunksForMeeting', () => {
    it('returns all chunks for a meeting ordered by chunk_index', () => {
      insertTestMeeting(db, 'meeting-1')
      store.saveChunks(makeChunks(3))
      const result = store.getChunksForMeeting('meeting-1')
      expect(result).toHaveLength(3)
      expect(result[0].chunkIndex).toBe(0)
      expect(result[2].chunkIndex).toBe(2)
      expect(result[0].text).toBe(
        'This is chunk number 0 with some content for testing.',
      )
    })

    it('returns empty array for nonexistent meeting', () => {
      const result = store.getChunksForMeeting('nonexistent')
      expect(result).toHaveLength(0)
    })

    it('maps row to StoredChunk correctly', () => {
      insertTestMeeting(db, 'meeting-1')
      store.saveChunks([
        {
          meetingId: 'meeting-1',
          chunkIndex: 0,
          speaker: 'Alice',
          startMs: 1000,
          endMs: 5000,
          text: 'Hello world',
          tokenCount: 2,
        },
      ])
      const result = store.getChunksForMeeting('meeting-1')
      expect(result[0].id).toBeDefined()
      expect(result[0].meetingId).toBe('meeting-1')
      expect(result[0].speaker).toBe('Alice')
      expect(result[0].startMs).toBe(1000)
      expect(result[0].endMs).toBe(5000)
      expect(result[0].tokenCount).toBe(2)
      expect(result[0].embedding).toBeUndefined()
    })
  })

  describe('getChunksWithoutEmbeddings', () => {
    it('returns only chunks without embeddings', () => {
      insertTestMeeting(db, 'meeting-1')
      store.saveChunks(makeChunks(3))
      // Embed chunk 1
      const embedding = [0.1, 0.2, 0.3]
      store.storeEmbedding(2, embedding) // id=2 is chunk_index=1
      const result = store.getChunksWithoutEmbeddings('meeting-1')
      expect(result).toHaveLength(2)
      expect(result.every((c) => c.id !== 2)).toBe(true)
    })

    it('returns all chunks when none have embeddings', () => {
      insertTestMeeting(db, 'meeting-1')
      store.saveChunks(makeChunks(3))
      const result = store.getChunksWithoutEmbeddings('meeting-1')
      expect(result).toHaveLength(3)
    })

    it('returns empty when all chunks have embeddings', () => {
      insertTestMeeting(db, 'meeting-1')
      store.saveChunks(makeChunks(2))
      store.storeEmbedding(1, [0.1, 0.2])
      store.storeEmbedding(2, [0.3, 0.4])
      const result = store.getChunksWithoutEmbeddings('meeting-1')
      expect(result).toHaveLength(0)
    })
  })

  describe('storeEmbedding', () => {
    it('stores embedding as BLOB in chunks table', () => {
      insertTestMeeting(db, 'meeting-1')
      store.saveChunks(makeChunks(1))
      const embedding = [0.1, 0.2, 0.3, 0.4, 0.5]
      store.storeEmbedding(1, embedding)
      const row = db
        .prepare('SELECT embedding FROM chunks WHERE id = 1')
        .get() as any
      expect(row.embedding).toBeInstanceOf(Buffer)
      // Verify Float32 encoding (5 floats * 4 bytes = 20 bytes)
      expect(row.embedding.byteLength).toBe(20)
    })

    it('overwrites existing embedding', () => {
      insertTestMeeting(db, 'meeting-1')
      store.saveChunks(makeChunks(1))
      store.storeEmbedding(1, [1.0, 2.0])
      store.storeEmbedding(1, [3.0, 4.0, 5.0])
      const row = db
        .prepare('SELECT embedding FROM chunks WHERE id = 1')
        .get() as any
      expect(row.embedding.byteLength).toBe(12) // 3 floats * 4 bytes
    })
  })

  describe('hasEmbeddings', () => {
    it('returns true when meeting has embeddings', () => {
      insertTestMeeting(db, 'meeting-1')
      store.saveChunks(makeChunks(1))
      store.storeEmbedding(1, [0.1, 0.2])
      expect(store.hasEmbeddings('meeting-1')).toBe(true)
    })

    it('returns false when meeting has no embeddings', () => {
      insertTestMeeting(db, 'meeting-1')
      store.saveChunks(makeChunks(1))
      expect(store.hasEmbeddings('meeting-1')).toBe(false)
    })

    it('returns false for nonexistent meeting', () => {
      expect(store.hasEmbeddings('nonexistent')).toBe(false)
    })
  })

  describe('saveSummary / storeSummaryEmbedding', () => {
    it('saves a summary for a meeting', () => {
      insertTestMeeting(db, 'meeting-1')
      store.saveSummary('meeting-1', 'This is a summary.')
      const row = db
        .prepare('SELECT * FROM chunk_summaries WHERE meeting_id = ?')
        .get('meeting-1') as any
      expect(row.summary_text).toBe('This is a summary.')
    })

    it('overwrites existing summary (INSERT OR REPLACE)', () => {
      insertTestMeeting(db, 'meeting-1')
      store.saveSummary('meeting-1', 'Old summary')
      store.saveSummary('meeting-1', 'New summary')
      const rows = db
        .prepare('SELECT * FROM chunk_summaries WHERE meeting_id = ?')
        .all('meeting-1') as any[]
      expect(rows).toHaveLength(1)
      expect(rows[0].summary_text).toBe('New summary')
    })

    it('stores summary embedding as BLOB', () => {
      insertTestMeeting(db, 'meeting-1')
      store.saveSummary('meeting-1', 'Summary text')
      store.storeSummaryEmbedding('meeting-1', [0.5, 0.6, 0.7])
      const row = db
        .prepare('SELECT embedding FROM chunk_summaries WHERE meeting_id = ?')
        .get('meeting-1') as any
      expect(row.embedding).toBeInstanceOf(Buffer)
      expect(row.embedding.byteLength).toBe(12) // 3 floats * 4 bytes
    })
  })

  describe('deleteChunksForMeeting', () => {
    it('deletes all chunks for a meeting', () => {
      insertTestMeeting(db, 'meeting-1')
      store.saveChunks(makeChunks(3))
      store.deleteChunksForMeeting('meeting-1')
      const rows = db
        .prepare('SELECT * FROM chunks WHERE meeting_id = ?')
        .all('meeting-1')
      expect(rows).toHaveLength(0)
    })

    it('does not affect other meetings', () => {
      insertTestMeeting(db, 'meeting-1')
      insertTestMeeting(db, 'meeting-2')
      store.saveChunks(makeChunks(2, 'meeting-1'))
      store.saveChunks(makeChunks(2, 'meeting-2'))
      store.deleteChunksForMeeting('meeting-1')
      expect(store.getChunksForMeeting('meeting-2')).toHaveLength(2)
    })
  })

  describe('clearEmbeddingsForMeeting', () => {
    it('nullifies embeddings but keeps chunks', () => {
      insertTestMeeting(db, 'meeting-1')
      store.saveChunks(makeChunks(2))
      store.storeEmbedding(1, [0.1, 0.2])
      store.storeEmbedding(2, [0.3, 0.4])
      store.clearEmbeddingsForMeeting('meeting-1')
      // Chunks still exist
      expect(store.getChunksForMeeting('meeting-1')).toHaveLength(2)
      // But embeddings are null
      const rows = db
        .prepare('SELECT embedding FROM chunks WHERE meeting_id = ?')
        .all('meeting-1') as any[]
      expect(rows[0].embedding).toBeNull()
      expect(rows[1].embedding).toBeNull()
    })

    it('nullifies summary embedding', () => {
      insertTestMeeting(db, 'meeting-1')
      store.saveSummary('meeting-1', 'Summary')
      store.storeSummaryEmbedding('meeting-1', [0.1, 0.2])
      store.clearEmbeddingsForMeeting('meeting-1')
      const row = db
        .prepare('SELECT embedding FROM chunk_summaries WHERE meeting_id = ?')
        .get('meeting-1') as any
      expect(row.embedding).toBeNull()
    })

    it('clears meeting provider metadata', () => {
      insertTestMeeting(db, 'meeting-1', 'openai')
      store.saveChunks(makeChunks(1))
      store.storeEmbedding(1, [0.1])
      store.clearEmbeddingsForMeeting('meeting-1')
      const meeting = db
        .prepare(
          'SELECT embedding_provider, embedding_dimensions FROM meetings WHERE id = ?',
        )
        .get('meeting-1') as any
      expect(meeting.embedding_provider).toBeNull()
      expect(meeting.embedding_dimensions).toBeNull()
    })
  })

  describe('getIncompatibleMeetingsCount', () => {
    it('counts meetings with different provider', () => {
      insertTestMeeting(db, 'm1', 'openai')
      insertTestMeeting(db, 'm2', 'gemini')
      insertTestMeeting(db, 'm3', 'openai')
      expect(store.getIncompatibleMeetingsCount('openai')).toBe(1)
    })

    it('returns 0 when all meetings match provider', () => {
      insertTestMeeting(db, 'm1', 'openai')
      insertTestMeeting(db, 'm2', 'openai')
      expect(store.getIncompatibleMeetingsCount('openai')).toBe(0)
    })

    it('excludes meetings with null provider', () => {
      insertTestMeeting(db, 'm1', undefined)
      insertTestMeeting(db, 'm2', 'openai')
      expect(store.getIncompatibleMeetingsCount('gemini')).toBe(1) // m2 is incompatible
    })

    it('excludes unprocessed meetings', () => {
      db.prepare(
        'INSERT INTO meetings (id, title, is_processed, embedding_provider) VALUES (?, ?, 0, ?)',
      ).run('m1', 'M1', 'openai')
      insertTestMeeting(db, 'm2', 'openai')
      expect(store.getIncompatibleMeetingsCount('gemini')).toBe(1) // only m2
    })
  })

  describe('deleteEmbeddingsForMeetings', () => {
    it('returns IDs of meetings with incompatible provider', () => {
      insertTestMeeting(db, 'm1', 'openai')
      insertTestMeeting(db, 'm2', 'gemini')
      insertTestMeeting(db, 'm3', 'openai')
      // Finds meetings where provider != 'gemini' (i.e., openai meetings)
      const ids = store.deleteEmbeddingsForMeetings('gemini')
      expect(ids).toEqual(['m1', 'm3'])
    })

    it('nullifies embeddings for incompatible meetings', () => {
      insertTestMeeting(db, 'm1', 'openai')
      store.saveChunks(makeChunks(2, 'm1'))
      store.storeEmbedding(1, [0.1, 0.2])
      store.storeEmbedding(2, [0.3, 0.4])
      store.deleteEmbeddingsForMeetings('gemini')
      const rows = db
        .prepare('SELECT embedding FROM chunks WHERE meeting_id = ?')
        .all('m1') as any[]
      expect(rows[0].embedding).toBeNull()
      expect(rows[1].embedding).toBeNull()
    })

    it('clears provider metadata from meetings', () => {
      insertTestMeeting(db, 'm1', 'openai')
      store.deleteEmbeddingsForMeetings('gemini')
      const meeting = db
        .prepare('SELECT embedding_provider FROM meetings WHERE id = ?')
        .get('m1') as any
      expect(meeting.embedding_provider).toBeNull()
    })

    it('returns empty array when no incompatible meetings', () => {
      insertTestMeeting(db, 'm1', 'openai')
      const ids = store.deleteEmbeddingsForMeetings('openai')
      expect(ids).toEqual([])
    })

    it('nullifies summary embeddings for incompatible meetings', () => {
      insertTestMeeting(db, 'm1', 'openai')
      store.saveSummary('m1', 'Summary')
      store.storeSummaryEmbedding('m1', [0.1, 0.2])
      store.deleteEmbeddingsForMeetings('gemini')
      const row = db
        .prepare('SELECT embedding FROM chunk_summaries WHERE meeting_id = ?')
        .get('m1') as any
      expect(row.embedding).toBeNull()
    })
  })

  describe('embeddingToBlob (via storeEmbedding)', () => {
    it('correctly encodes Float32 values', () => {
      insertTestMeeting(db, 'meeting-1')
      store.saveChunks(makeChunks(1))
      const embedding = [1.0, -0.5, 0.0, Math.PI]
      store.storeEmbedding(1, embedding)
      const row = db
        .prepare('SELECT embedding FROM chunks WHERE id = 1')
        .get() as any
      const buf = row.embedding as Buffer
      expect(buf.readFloatLE(0)).toBeCloseTo(1.0, 5)
      expect(buf.readFloatLE(4)).toBeCloseTo(-0.5, 5)
      expect(buf.readFloatLE(8)).toBeCloseTo(0.0, 5)
      expect(buf.readFloatLE(12)).toBeCloseTo(Math.PI, 3)
    })

    it('handles single-element embedding', () => {
      insertTestMeeting(db, 'meeting-1')
      store.saveChunks(makeChunks(1))
      store.storeEmbedding(1, [42.0])
      const row = db
        .prepare('SELECT embedding FROM chunks WHERE id = 1')
        .get() as any
      expect(row.embedding.byteLength).toBe(4)
      expect(row.embedding.readFloatLE(0)).toBeCloseTo(42.0, 5)
    })
  })
})
