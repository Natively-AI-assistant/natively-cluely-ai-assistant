import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElectronMock } from '../../mocks/electron.mock'

// Mock electron module (needed because _doInitialize imports BrowserWindow)
vi.mock('electron', () =>
  createElectronMock({
    app: {
      getAppPath: vi.fn(() => '/tmp/test'),
    },
    BrowserWindow: {
      getAllWindows: vi.fn(() => []),
    },
  }),
)

// Mock DatabaseManager
vi.mock('../../../electron/db/DatabaseManager', () => ({
  DatabaseManager: {
    KNOWN_DIMS: [768, 1536, 3072],
    getInstance: vi.fn(() => ({
      ensureVecTableForDim: vi.fn(),
    })),
  },
}))

// Mock LocalEmbeddingProvider
vi.mock('../../../electron/rag/providers/LocalEmbeddingProvider', () => ({
  LocalEmbeddingProvider: class {
    name = 'local'
    dimensions = 384
    isAvailable = vi.fn().mockResolvedValue(true)
    embed = vi.fn().mockResolvedValue([0.1, 0.2, 0.3])
    embedQuery = vi.fn().mockResolvedValue([0.1, 0.2, 0.3])
    embedBatch = vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]])
  },
}))

// Mock EmbeddingProviderResolver
vi.mock('../../../electron/rag/EmbeddingProviderResolver', () => ({
  EmbeddingProviderResolver: {
    resolve: vi.fn(),
  },
}))

import { EmbeddingPipeline } from '../../../electron/rag/EmbeddingPipeline'
import { EmbeddingProviderResolver } from '../../../electron/rag/EmbeddingProviderResolver'

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
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE chunk_summaries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            meeting_id TEXT NOT NULL UNIQUE,
            summary_text TEXT NOT NULL,
            embedding BLOB,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
        CREATE TABLE app_state (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    `)
  return db
}

function createMockProvider(name: string, dims: number) {
  return {
    name,
    dimensions: dims,
    isAvailable: vi.fn().mockResolvedValue(true),
    embed: vi.fn().mockResolvedValue(new Array(dims).fill(0.1)),
    embedQuery: vi.fn().mockResolvedValue(new Array(dims).fill(0.1)),
    embedBatch: vi.fn().mockResolvedValue([new Array(dims).fill(0.1)]),
  }
}

function insertTestMeeting(db: Database.Database, id: string) {
  db.prepare(
    'INSERT INTO meetings (id, title, start_time, duration_ms, summary_json, is_processed) VALUES (?, ?, ?, ?, ?, 1)',
  ).run(id, `Meeting ${id}`, Date.now(), 300000, '{}')
}

const mockVectorStore = {
  getChunksWithoutEmbeddings: vi.fn().mockReturnValue([]),
  storeEmbedding: vi.fn(),
  storeSummaryEmbedding: vi.fn(),
  clearEmbeddingsForMeeting: vi.fn(),
  getIncompatibleMeetingsCount: vi.fn().mockReturnValue(0),
}

describe('EmbeddingPipeline', () => {
  let db: Database.Database
  let pipeline: EmbeddingPipeline

  beforeEach(() => {
    vi.clearAllMocks()
    db = createTestDb()
    pipeline = new EmbeddingPipeline(db, mockVectorStore as any)
  })

  afterEach(() => {
    db.close()
  })

  describe('isReady', () => {
    it('returns false before initialization', () => {
      expect(pipeline.isReady()).toBe(false)
    })

    it('returns true after successful initialization', async () => {
      const mockProvider = createMockProvider('openai', 1536)
      vi.mocked(EmbeddingProviderResolver.resolve).mockResolvedValue(
        mockProvider as any,
      )
      await pipeline.initialize({ openaiKey: 'test-key' })
      expect(pipeline.isReady()).toBe(true)
    })
  })

  describe('getActiveProviderName', () => {
    it('returns undefined before initialization', () => {
      expect(pipeline.getActiveProviderName()).toBeUndefined()
    })

    it('returns provider name after initialization', async () => {
      const mockProvider = createMockProvider('gemini', 768)
      vi.mocked(EmbeddingProviderResolver.resolve).mockResolvedValue(
        mockProvider as any,
      )
      await pipeline.initialize({ geminiKey: 'test-key' })
      expect(pipeline.getActiveProviderName()).toBe('gemini')
    })
  })

  describe('initialize', () => {
    it('initializes with a resolved provider', async () => {
      const mockProvider = createMockProvider('openai', 1536)
      vi.mocked(EmbeddingProviderResolver.resolve).mockResolvedValue(
        mockProvider as any,
      )
      await pipeline.initialize({ openaiKey: 'test-key' })
      expect(pipeline.getActiveProviderName()).toBe('openai')
      // Should persist provider name in app_state
      const row = db
        .prepare(
          "SELECT value FROM app_state WHERE key = 'last_embedding_provider'",
        )
        .get() as any
      expect(row?.value).toBe('openai')
    })

    it('skips re-initialization if config has no new keys', async () => {
      const mockProvider = createMockProvider('openai', 1536)
      vi.mocked(EmbeddingProviderResolver.resolve).mockResolvedValue(
        mockProvider as any,
      )
      await pipeline.initialize({ openaiKey: 'test-key' })
      vi.mocked(EmbeddingProviderResolver.resolve).mockClear()
      // Same config — should skip
      await pipeline.initialize({ openaiKey: 'test-key' })
      expect(EmbeddingProviderResolver.resolve).not.toHaveBeenCalled()
    })

    it('re-initializes if config adds a new key', async () => {
      const mockProvider = createMockProvider('openai', 1536)
      vi.mocked(EmbeddingProviderResolver.resolve).mockResolvedValue(
        mockProvider as any,
      )
      await pipeline.initialize({ openaiKey: 'key1' })
      vi.mocked(EmbeddingProviderResolver.resolve).mockClear()
      // Add gemini key — should re-initialize
      await pipeline.initialize({ openaiKey: 'key1', geminiKey: 'key2' })
      expect(EmbeddingProviderResolver.resolve).toHaveBeenCalledTimes(1)
    })

    it('re-initializes if ollamaUrl is newly provided', async () => {
      const mockProvider = createMockProvider('openai', 1536)
      vi.mocked(EmbeddingProviderResolver.resolve).mockResolvedValue(
        mockProvider as any,
      )
      await pipeline.initialize({ openaiKey: 'key1' })
      vi.mocked(EmbeddingProviderResolver.resolve).mockClear()
      await pipeline.initialize({
        openaiKey: 'key1',
        ollamaUrl: 'http://localhost:11434',
      })
      expect(EmbeddingProviderResolver.resolve).toHaveBeenCalledTimes(1)
    })
  })

  describe('waitForReady', () => {
    it('resolves immediately if already ready', async () => {
      const mockProvider = createMockProvider('openai', 1536)
      vi.mocked(EmbeddingProviderResolver.resolve).mockResolvedValue(
        mockProvider as any,
      )
      await pipeline.initialize({ openaiKey: 'test-key' })
      // Should resolve immediately
      await expect(pipeline.waitForReady(1000)).resolves.toBeUndefined()
    })

    it('throws if not initialized and no initPromise', async () => {
      await expect(pipeline.waitForReady(100)).rejects.toThrow(
        'Embedding pipeline has not been initialized',
      )
    })

    it('waits for in-progress initialization', async () => {
      let resolveProvider: (p: any) => void
      const providerPromise = new Promise((resolve) => {
        resolveProvider = resolve
      })
      vi.mocked(EmbeddingProviderResolver.resolve).mockReturnValue(
        providerPromise as any,
      )
      const initPromise = pipeline.initialize({ openaiKey: 'test-key' })
      // waitForReady should wait
      const waitPromise = pipeline.waitForReady(5000)
      // Resolve the provider
      resolveProvider?.(createMockProvider('openai', 1536))
      await initPromise
      await expect(waitPromise).resolves.toBeUndefined()
    })

    it('times out if initialization takes too long', async () => {
      vi.mocked(EmbeddingProviderResolver.resolve).mockReturnValue(
        new Promise(() => {}) as any,
      ) // never resolves
      pipeline.initialize({ openaiKey: 'test-key' }).catch(() => {}) // catch the eventual error
      await expect(pipeline.waitForReady(100)).rejects.toThrow('timed out')
    })
  })

  describe('queueMeeting', () => {
    it('does nothing when there are no chunks to embed', async () => {
      mockVectorStore.getChunksWithoutEmbeddings.mockReturnValue([])
      const mockProvider = createMockProvider('openai', 1536)
      vi.mocked(EmbeddingProviderResolver.resolve).mockResolvedValue(
        mockProvider as any,
      )
      await pipeline.initialize({ openaiKey: 'test-key' })
      insertTestMeeting(db, 'meeting-1')
      await pipeline.queueMeeting('meeting-1')
      const queueItems = db.prepare('SELECT * FROM embedding_queue').all()
      expect(queueItems).toHaveLength(0)
    })

    it('queues chunks and summary when chunks exist', async () => {
      mockVectorStore.getChunksWithoutEmbeddings.mockReturnValue([
        { id: 1, meetingId: 'meeting-1', chunkIndex: 0 },
        { id: 2, meetingId: 'meeting-1', chunkIndex: 1 },
      ])
      const mockProvider = createMockProvider('openai', 1536)
      vi.mocked(EmbeddingProviderResolver.resolve).mockResolvedValue(
        mockProvider as any,
      )
      await pipeline.initialize({ openaiKey: 'test-key' })
      insertTestMeeting(db, 'meeting-1')
      await pipeline.queueMeeting('meeting-1')
      // processQueue() runs in background, so just check items were inserted
      const queueItems = db
        .prepare('SELECT * FROM embedding_queue ORDER BY id')
        .all() as any[]
      // 2 chunks + 1 summary (chunk_id=null)
      expect(queueItems).toHaveLength(3)
      expect(queueItems[0].chunk_id).toBe(1)
      expect(queueItems[1].chunk_id).toBe(2)
      expect(queueItems[2].chunk_id).toBeNull() // summary
    })

    it('uses INSERT OR IGNORE for duplicate chunk entries', async () => {
      mockVectorStore.getChunksWithoutEmbeddings.mockReturnValue([
        { id: 1, meetingId: 'meeting-1', chunkIndex: 0 },
      ])
      const mockProvider = createMockProvider('openai', 1536)
      vi.mocked(EmbeddingProviderResolver.resolve).mockResolvedValue(
        mockProvider as any,
      )
      await pipeline.initialize({ openaiKey: 'test-key' })
      insertTestMeeting(db, 'meeting-1')
      await pipeline.queueMeeting('meeting-1')
      await pipeline.queueMeeting('meeting-1') // second call
      // Chunk (id=1) is deduped by UNIQUE(meeting_id, chunk_id)
      // but summary (chunk_id=NULL) is NOT deduped because NULL != NULL in SQL
      const chunkItems = db
        .prepare('SELECT * FROM embedding_queue WHERE chunk_id IS NOT NULL')
        .all()
      expect(chunkItems).toHaveLength(1) // chunk deduped
    })
  })

  describe('getQueueStatus', () => {
    it('returns zero counts for empty queue', async () => {
      const mockProvider = createMockProvider('openai', 1536)
      vi.mocked(EmbeddingProviderResolver.resolve).mockResolvedValue(
        mockProvider as any,
      )
      await pipeline.initialize({ openaiKey: 'test-key' })
      const status = pipeline.getQueueStatus()
      expect(status).toEqual({
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
      })
    })

    it('counts items by status', async () => {
      const mockProvider = createMockProvider('openai', 1536)
      vi.mocked(EmbeddingProviderResolver.resolve).mockResolvedValue(
        mockProvider as any,
      )
      await pipeline.initialize({ openaiKey: 'test-key' })
      insertTestMeeting(db, 'meeting-1')
      db.prepare(
        "INSERT INTO embedding_queue (meeting_id, chunk_id, status) VALUES ('meeting-1', 1, 'pending')",
      ).run()
      db.prepare(
        "INSERT INTO embedding_queue (meeting_id, chunk_id, status) VALUES ('meeting-1', 2, 'completed')",
      ).run()
      db.prepare(
        "INSERT INTO embedding_queue (meeting_id, chunk_id, status) VALUES ('meeting-1', 3, 'failed')",
      ).run()
      const status = pipeline.getQueueStatus()
      expect(status.pending).toBe(1)
      expect(status.completed).toBe(1)
      expect(status.failed).toBe(1)
    })

    it('counts stalled items (retry_count >= MAX_RETRIES) as failed', async () => {
      const mockProvider = createMockProvider('openai', 1536)
      vi.mocked(EmbeddingProviderResolver.resolve).mockResolvedValue(
        mockProvider as any,
      )
      await pipeline.initialize({ openaiKey: 'test-key' })
      insertTestMeeting(db, 'meeting-1')
      // Item with retry_count=3 (MAX_RETRIES) — effectively stalled
      db.prepare(
        "INSERT INTO embedding_queue (meeting_id, chunk_id, status, retry_count) VALUES ('meeting-1', 1, 'pending', 3)",
      ).run()
      const status = pipeline.getQueueStatus()
      expect(status.failed).toBeGreaterThanOrEqual(1)
    })

    it('does not count fallback sentinel items (retry_count=-1) as stalled', async () => {
      const mockProvider = createMockProvider('openai', 1536)
      vi.mocked(EmbeddingProviderResolver.resolve).mockResolvedValue(
        mockProvider as any,
      )
      await pipeline.initialize({ openaiKey: 'test-key' })
      insertTestMeeting(db, 'meeting-1')
      // Fallback sentinel item
      db.prepare(
        "INSERT INTO embedding_queue (meeting_id, chunk_id, status, retry_count) VALUES ('meeting-1', 1, 'pending', -1)",
      ).run()
      const status = pipeline.getQueueStatus()
      expect(status.pending).toBe(1)
      expect(status.failed).toBe(0)
    })
  })

  describe('cleanupQueue', () => {
    it('removes completed items older than specified days', async () => {
      const mockProvider = createMockProvider('openai', 1536)
      vi.mocked(EmbeddingProviderResolver.resolve).mockResolvedValue(
        mockProvider as any,
      )
      await pipeline.initialize({ openaiKey: 'test-key' })
      insertTestMeeting(db, 'meeting-1')
      // Old completed item (10 days ago)
      const oldDate = new Date(
        Date.now() - 10 * 24 * 60 * 60 * 1000,
      ).toISOString()
      db.prepare(
        "INSERT INTO embedding_queue (meeting_id, chunk_id, status, processed_at) VALUES ('meeting-1', 1, 'completed', ?)",
      ).run(oldDate)
      // Recent completed item
      db.prepare(
        "INSERT INTO embedding_queue (meeting_id, chunk_id, status, processed_at) VALUES ('meeting-1', 2, 'completed', ?)",
      ).run(new Date().toISOString())
      // Pending item (should not be deleted regardless of age)
      db.prepare(
        "INSERT INTO embedding_queue (meeting_id, chunk_id, status, processed_at) VALUES ('meeting-1', 3, 'pending', ?)",
      ).run(oldDate)

      pipeline.cleanupQueue(7) // Remove items older than 7 days

      const remaining = db
        .prepare('SELECT * FROM embedding_queue ORDER BY id')
        .all() as any[]
      expect(remaining).toHaveLength(2) // recent completed + pending
      expect(remaining.some((r: any) => r.chunk_id === 1)).toBe(false) // old completed removed
      expect(remaining.some((r: any) => r.chunk_id === 2)).toBe(true)
      expect(remaining.some((r: any) => r.chunk_id === 3)).toBe(true)
    })

    it('uses 7-day default', async () => {
      const mockProvider = createMockProvider('openai', 1536)
      vi.mocked(EmbeddingProviderResolver.resolve).mockResolvedValue(
        mockProvider as any,
      )
      await pipeline.initialize({ openaiKey: 'test-key' })
      insertTestMeeting(db, 'meeting-1')
      const oldDate = new Date(
        Date.now() - 8 * 24 * 60 * 60 * 1000,
      ).toISOString()
      db.prepare(
        "INSERT INTO embedding_queue (meeting_id, chunk_id, status, processed_at) VALUES ('meeting-1', 1, 'completed', ?)",
      ).run(oldDate)
      pipeline.cleanupQueue() // default 7 days
      const remaining = db.prepare('SELECT * FROM embedding_queue').all()
      expect(remaining).toHaveLength(0)
    })
  })

  describe('getEmbedding', () => {
    it('delegates to provider embed method', async () => {
      const mockProvider = createMockProvider('openai', 1536)
      vi.mocked(EmbeddingProviderResolver.resolve).mockResolvedValue(
        mockProvider as any,
      )
      await pipeline.initialize({ openaiKey: 'test-key' })
      const result = await pipeline.getEmbedding('test text')
      expect(mockProvider.embed).toHaveBeenCalledWith('test text')
      expect(result).toEqual(new Array(1536).fill(0.1))
    })

    it('throws when not initialized', async () => {
      await expect(pipeline.getEmbedding('test')).rejects.toThrow(
        'Embedding provider not initialized',
      )
    })
  })

  describe('getEmbeddingForQuery', () => {
    it('delegates to provider embedQuery method', async () => {
      const mockProvider = createMockProvider('openai', 1536)
      vi.mocked(EmbeddingProviderResolver.resolve).mockResolvedValue(
        mockProvider as any,
      )
      await pipeline.initialize({ openaiKey: 'test-key' })
      const result = await pipeline.getEmbeddingForQuery('search query')
      expect(mockProvider.embedQuery).toHaveBeenCalledWith('search query')
      expect(result).toEqual(new Array(1536).fill(0.1))
    })

    it('throws when not initialized', async () => {
      await expect(pipeline.getEmbeddingForQuery('test')).rejects.toThrow(
        'Embedding provider not initialized',
      )
    })
  })
})
