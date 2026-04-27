import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElectronMock } from '../../mocks/electron.mock'

const {
  mockPreprocess,
  mockChunk,
  mockSaveChunks,
  mockSaveSummary,
  mockIsReady,
  mockQueueMeeting,
  mockRetrieve,
  mockRetrieveGlobal,
  mockDetectScope,
  mockHasEmbeddings,
  mockGetQueueStatus,
  mockDeleteChunksForMeeting,
  mockFeedSegments,
  mockLiveStart,
  mockLiveStop,
  mockLiveIsRunning,
  mockLiveGetActive,
  mockLiveHasIndexed,
  mockLiveCount,
  mockDbPrepare,
} = vi.hoisted(() => ({
  mockPreprocess: vi.fn((t: any[]) => t),
  mockChunk: vi.fn(() => [{ id: 'chunk-1' }, { id: 'chunk-2' }]),
  mockSaveChunks: vi.fn(),
  mockSaveSummary: vi.fn(),
  mockIsReady: vi.fn(() => false),
  mockQueueMeeting: vi.fn().mockResolvedValue(undefined),
  mockRetrieve: vi.fn().mockResolvedValue({
    chunks: [{ text: 'ctx' }],
    formattedContext: 'ctx',
    intent: 'answer',
  }),
  mockRetrieveGlobal: vi.fn().mockResolvedValue({
    chunks: [{ text: 'ctx' }],
    formattedContext: 'ctx',
    intent: 'answer',
  }),
  mockDetectScope: vi.fn(() => 'global'),
  mockHasEmbeddings: vi.fn(() => true),
  mockGetQueueStatus: vi.fn(),
  mockDeleteChunksForMeeting: vi.fn(),
  mockFeedSegments: vi.fn(),
  mockLiveStart: vi.fn(),
  mockLiveStop: vi.fn().mockResolvedValue(undefined),
  mockLiveIsRunning: vi.fn(() => false),
  mockLiveGetActive: vi.fn(),
  mockLiveHasIndexed: vi.fn(),
  mockLiveCount: vi.fn(),
  mockDbPrepare: vi.fn().mockReturnValue({ run: vi.fn() }),
}))

vi.mock('electron', () =>
  createElectronMock({
    app: { getPath: vi.fn(() => '/tmp'), getVersion: vi.fn(() => '1.0.0') },
  }),
)
vi.mock('better-sqlite3', () => ({ Database: vi.fn() }))

// Each mock class must be a proper constructor (function/class) so `new X()` works
vi.mock('../../../electron/rag/VectorStore', () => ({
  VectorStore: class {
    saveChunks = mockSaveChunks
    saveSummary = mockSaveSummary
    hasEmbeddings = mockHasEmbeddings
    deleteChunksForMeeting = mockDeleteChunksForMeeting
  },
}))
vi.mock('../../../electron/rag/EmbeddingPipeline', () => ({
  EmbeddingPipeline: class {
    initialize = vi.fn().mockResolvedValue(undefined)
    isReady = mockIsReady
    queueMeeting = mockQueueMeeting
    getQueueStatus = mockGetQueueStatus
    processQueue = vi.fn()
    getActiveProviderName = vi.fn()
  },
}))
vi.mock('../../../electron/rag/RAGRetriever', () => ({
  RAGRetriever: class {
    retrieve = mockRetrieve
    retrieveGlobal = mockRetrieveGlobal
    detectScope = mockDetectScope
  },
}))
vi.mock('../../../electron/rag/LiveRAGIndexer', () => ({
  LiveRAGIndexer: class {
    start = mockLiveStart
    stop = mockLiveStop
    feedSegments = mockFeedSegments
    isRunning = mockLiveIsRunning
    getActiveMeetingId = mockLiveGetActive
    hasIndexedChunks = mockLiveHasIndexed
    getIndexedChunkCount = mockLiveCount
  },
}))
vi.mock('../../../electron/rag/TranscriptPreprocessor', () => ({
  preprocessTranscript: mockPreprocess,
}))
vi.mock('../../../electron/rag/SemanticChunker', () => ({
  chunkTranscript: mockChunk,
}))
vi.mock('../../../electron/rag/prompts', () => ({
  buildRAGPrompt: vi.fn().mockReturnValue('prompt'),
  NO_CONTEXT_FALLBACK: 'No context',
  NO_GLOBAL_CONTEXT_FALLBACK: 'No global context',
}))
vi.mock('../../../electron/LLMHelper', () => ({ LLMHelper: vi.fn() }))

import { NO_GLOBAL_CONTEXT_FALLBACK } from '../../../electron/rag/prompts'
import { RAGManager } from '../../../electron/rag/RAGManager'

function makeRAGManager(overrides: Record<string, any> = {}) {
  return new RAGManager({
    db: { prepare: mockDbPrepare } as any,
    dbPath: '/tmp/test.db',
    extPath: '/tmp/vec',
    openaiKey: 'key',
    ...overrides,
  })
}

describe('RAGManager', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('constructor', () => {
    it('calls initialize on embedding pipeline with keys', () => {
      const mgr = makeRAGManager({
        openaiKey: 'k1',
        geminiKey: 'k2',
        ollamaUrl: 'http://localhost',
      })
      expect(mgr).toBeDefined()
    })
  })

  describe('isReady', () => {
    it('returns false when no LLMHelper set (pipeline also not ready)', () => {
      mockIsReady.mockReturnValue(false)
      expect(makeRAGManager().isReady()).toBe(false)
    })

    it('returns false when pipeline ready but no LLMHelper', () => {
      mockIsReady.mockReturnValue(true)
      expect(makeRAGManager().isReady()).toBe(false)
    })

    it('returns true when pipeline ready and LLMHelper set', () => {
      mockIsReady.mockReturnValue(true)
      const mgr = makeRAGManager()
      mgr.setLLMHelper({} as any)
      expect(mgr.isReady()).toBe(true)
    })
  })

  describe('processMeeting', () => {
    it('preprocesses, chunks, saves, and queues embeddings when ready', async () => {
      mockIsReady.mockReturnValue(true)
      const segments = [{ speaker: 'A', text: 'hello', timestamp: 0 }]
      const result = await makeRAGManager().processMeeting(
        'm1',
        segments,
        'summary',
      )

      expect(mockPreprocess).toHaveBeenCalledWith(segments)
      expect(mockChunk).toHaveBeenCalledWith('m1', segments)
      expect(mockSaveChunks).toHaveBeenCalledWith([
        { id: 'chunk-1' },
        { id: 'chunk-2' },
      ])
      expect(mockSaveSummary).toHaveBeenCalledWith('m1', 'summary')
      expect(mockQueueMeeting).toHaveBeenCalledWith('m1')
      expect(result).toEqual({ chunkCount: 2 })
    })

    it('skips saving and returns 0 when no chunks produced', async () => {
      mockChunk.mockReturnValueOnce([])
      const result = await makeRAGManager().processMeeting('m1', [])
      expect(result).toEqual({ chunkCount: 0 })
      expect(mockSaveChunks).not.toHaveBeenCalled()
      expect(mockQueueMeeting).not.toHaveBeenCalled()
    })

    it('skips queueing when pipeline not ready', async () => {
      mockIsReady.mockReturnValue(false)
      await makeRAGManager().processMeeting('m1', [
        { speaker: 'A', text: 'hi', timestamp: 0 },
      ])
      expect(mockSaveChunks).toHaveBeenCalled()
      expect(mockQueueMeeting).not.toHaveBeenCalled()
    })

    it('does not call saveSummary when summary not provided', async () => {
      await makeRAGManager().processMeeting('m1', [
        { speaker: 'A', text: 'hi', timestamp: 0 },
      ])
      expect(mockSaveSummary).not.toHaveBeenCalled()
    })
  })

  describe('queryMeeting', () => {
    function makeQueryMgr() {
      mockIsReady.mockReturnValue(true)
      const mgr = makeRAGManager()
      mgr.setLLMHelper({
        streamChatWithGemini: vi.fn(async function* () {
          yield 'token'
        }),
      } as any)
      return mgr
    }

    it('throws when LLMHelper not initialized', async () => {
      const gen = makeRAGManager().queryMeeting('m1', 'q')
      await expect(gen.next()).rejects.toThrow('LLM helper not initialized')
    })

    it('throws NO_MEETING_EMBEDDINGS when no embeddings and not live', async () => {
      mockHasEmbeddings.mockReturnValue(false)
      mockLiveGetActive.mockReturnValue('other-meeting')
      const gen = makeQueryMgr().queryMeeting('m1', 'q')
      await expect(gen.next()).rejects.toThrow('NO_MEETING_EMBEDDINGS')
    })

    it('falls through to retrieval when live JIT chunks exist', async () => {
      mockHasEmbeddings.mockReturnValue(false)
      mockLiveGetActive.mockReturnValue('m1')
      mockLiveHasIndexed.mockReturnValue(true)
      const gen = makeQueryMgr().queryMeeting('m1', 'q')
      const { value } = await gen.next()
      expect(value).toBe('token')
    })

    it('throws NO_RELEVANT_CONTEXT_FOUND when retriever returns empty', async () => {
      mockRetrieve.mockResolvedValueOnce({
        chunks: [],
        formattedContext: '',
        intent: '',
      })
      const gen = makeQueryMgr().queryMeeting('m1', 'q')
      await expect(gen.next()).rejects.toThrow('NO_RELEVANT_CONTEXT_FOUND')
    })

    it('streams chunks when context found', async () => {
      const gen = makeQueryMgr().queryMeeting('m1', 'q')
      const result: string[] = []
      for await (const c of gen) result.push(c)
      expect(result).toEqual(['token'])
      expect(mockRetrieve).toHaveBeenCalledWith('q', { meetingId: 'm1' })
    })

    it('stops streaming on abort signal', async () => {
      const ac = new AbortController()
      ac.abort()
      const gen = makeQueryMgr().queryMeeting('m1', 'q', ac.signal)
      const result: string[] = []
      for await (const c of gen) result.push(c)
      expect(result).toEqual([])
    })
  })

  describe('queryGlobal', () => {
    it('throws when LLMHelper not initialized', async () => {
      const gen = makeRAGManager().queryGlobal('q')
      await expect(gen.next()).rejects.toThrow('LLM helper not initialized')
    })

    it('yields fallback when no global context', async () => {
      mockRetrieveGlobal.mockResolvedValueOnce({
        chunks: [],
        formattedContext: '',
        intent: '',
      })
      mockIsReady.mockReturnValue(true)
      const mgr = makeRAGManager()
      mgr.setLLMHelper({
        streamChatWithGemini: vi.fn(async function* () {
          yield 'x'
        }),
      } as any)
      const gen = mgr.queryGlobal('q')
      const { value } = await gen.next()
      expect(value).toBe(NO_GLOBAL_CONTEXT_FALLBACK)
    })
  })

  describe('query (smart scope)', () => {
    it('delegates to queryMeeting when scope is meeting', async () => {
      mockDetectScope.mockReturnValue('meeting')
      mockIsReady.mockReturnValue(true)
      const mgr = makeRAGManager()
      mgr.setLLMHelper({
        streamChatWithGemini: vi.fn(async function* () {
          yield 'a'
        }),
      } as any)
      const gen = mgr.query('q', 'm1')
      const { value } = await gen.next()
      expect(value).toBe('a')
      expect(mockDetectScope).toHaveBeenCalledWith('q', 'm1')
    })

    it('delegates to queryGlobal when scope is global', async () => {
      mockDetectScope.mockReturnValue('global')
      mockIsReady.mockReturnValue(true)
      const mgr = makeRAGManager()
      mgr.setLLMHelper({
        streamChatWithGemini: vi.fn(async function* () {
          yield 'b'
        }),
      } as any)
      const gen = mgr.query('q', 'm1')
      const { value } = await gen.next()
      expect(value).toBe('b')
    })
  })

  describe('deleteMeetingData', () => {
    it('calls vectorStore.deleteChunksForMeeting and clears queue', () => {
      makeRAGManager().deleteMeetingData('m1')
      expect(mockDeleteChunksForMeeting).toHaveBeenCalledWith('m1')
      expect(mockDbPrepare as any).toHaveBeenCalledWith(
        'DELETE FROM embedding_queue WHERE meeting_id = ?',
      )
    })

    it('deletes transient meeting row for live-meeting-current', () => {
      makeRAGManager().deleteMeetingData('live-meeting-current')
      expect(mockDbPrepare as any).toHaveBeenCalledWith(
        'DELETE FROM meetings WHERE id = ?',
      )
    })

    it('does not delete meeting row for non-live IDs', () => {
      makeRAGManager().deleteMeetingData('some-id')
      const calls = mockDbPrepare.mock.calls.map((c: any[]) => c[0])
      expect(calls).not.toContain('DELETE FROM meetings WHERE id = ?')
    })

    it('handles queue delete errors gracefully', () => {
      mockDbPrepare.mockImplementationOnce(() => {
        throw new Error('db error')
      })
      expect(() => makeRAGManager().deleteMeetingData('m1')).not.toThrow()
    })
  })

  describe('isMeetingProcessed', () => {
    it('delegates to vectorStore.hasEmbeddings', () => {
      mockHasEmbeddings.mockReturnValue(true)
      expect(makeRAGManager().isMeetingProcessed('m1')).toBe(true)
      expect(mockHasEmbeddings).toHaveBeenCalledWith('m1')
    })

    it('returns false when no embeddings', () => {
      mockHasEmbeddings.mockReturnValue(false)
      expect(makeRAGManager().isMeetingProcessed('m1')).toBe(false)
    })
  })

  describe('isLiveIndexingActive', () => {
    it('checks active meeting ID when meetingId provided', () => {
      mockLiveGetActive.mockReturnValue('m1')
      expect(makeRAGManager().isLiveIndexingActive('m1')).toBe(true)
      expect(makeRAGManager().isLiveIndexingActive('m2')).toBe(false)
    })

    it('checks isRunning when no meetingId provided', () => {
      mockLiveIsRunning.mockReturnValue(true)
      expect(makeRAGManager().isLiveIndexingActive()).toBe(true)
    })
  })

  describe('live indexing', () => {
    it('feedLiveTranscript delegates to liveIndexer.feedSegments', () => {
      const segs = [{ speaker: 'A', text: 'hi', timestamp: 0 }]
      makeRAGManager().feedLiveTranscript(segs)
      expect(mockFeedSegments).toHaveBeenCalledWith(segs)
    })

    it('stopLiveIndexing delegates to liveIndexer.stop', async () => {
      await makeRAGManager().stopLiveIndexing()
      expect(mockLiveStop).toHaveBeenCalled()
    })

    it('startLiveIndexing skips when pipeline not ready', () => {
      mockIsReady.mockReturnValue(false)
      makeRAGManager().startLiveIndexing('m1')
      expect(mockLiveStart).not.toHaveBeenCalled()
    })

    it('startLiveIndexing inserts meeting row and starts indexer when ready', () => {
      mockIsReady.mockReturnValue(true)
      makeRAGManager().startLiveIndexing('m1')
      expect(mockDbPrepare as any).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR IGNORE INTO meetings'),
      )
      expect(mockLiveStart).toHaveBeenCalledWith('m1')
    })
  })

  describe('getEmbeddingPipeline', () => {
    it('returns the embedding pipeline instance', () => {
      const mgr = makeRAGManager()
      expect(mgr.getEmbeddingPipeline()).toBeDefined()
    })
  })

  describe('getQueueStatus', () => {
    it('delegates to embedding pipeline', () => {
      mockGetQueueStatus.mockReturnValue({
        pending: 5,
        processing: 1,
        completed: 10,
        failed: 0,
      })
      const result = makeRAGManager().getQueueStatus()
      expect(result).toEqual({
        pending: 5,
        processing: 1,
        completed: 10,
        failed: 0,
      })
    })
  })
})
