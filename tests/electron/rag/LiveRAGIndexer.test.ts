import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElectronMock } from '../../mocks/electron.mock'

// Create mock functions at module level
const mockSaveChunks = vi.fn()
const mockHasEmbeddings = vi.fn(() => false)
const mockInitialize = vi.fn()
const mockIsReady = vi.fn(() => true)
const mockQueueMeeting = vi.fn()
const mockGetQueueStatus = vi.fn(() => ({ pending: 0, processing: 0, completed: 0, failed: 0 }))
const mockProcessQueue = vi.fn()
const mockGetEmbedding = vi.fn()
const mockStoreEmbedding = vi.fn()

// Mock electron and related modules before importing LiveRAGIndexer
vi.mock('electron', () => createElectronMock({
    app: {
        getPath: vi.fn(() => '/tmp/userdata'),
        getVersion: vi.fn(() => '1.0.0'),
    },
}))
vi.mock('better-sqlite3', () => ({
    Database: vi.fn(() => ({
        prepare: vi.fn().mockReturnValue({
            run: vi.fn(),
            all: vi.fn(),
            get: vi.fn(),
        }),
    })),
}))
vi.mock('../../../electron/rag/VectorStore', () => ({
    VectorStore: vi.fn(() => ({
        saveChunks: mockSaveChunks,
        hasEmbeddings: mockHasEmbeddings,
        storeEmbedding: mockStoreEmbedding,
    })),
}))
vi.mock('../../../electron/rag/EmbeddingPipeline', () => ({
    EmbeddingPipeline: vi.fn(() => ({
        initialize: mockInitialize,
        isReady: mockIsReady,
        queueMeeting: mockQueueMeeting,
        getQueueStatus: mockGetQueueStatus,
        processQueue: mockProcessQueue,
        getEmbedding: mockGetEmbedding,
    })),
}))

import { LiveRAGIndexer } from '../../../electron/rag/LiveRAGIndexer'

describe('LiveRAGIndexer', () => {
    let liveRAGIndexer: LiveRAGIndexer

    beforeEach(() => {
        vi.clearAllMocks()
        liveRAGIndexer = new LiveRAGIndexer(
            {
                saveChunks: mockSaveChunks,
                hasEmbeddings: mockHasEmbeddings,
                storeEmbedding: mockStoreEmbedding,
            } as any,
            {
                initialize: mockInitialize,
                isReady: mockIsReady,
                queueMeeting: mockQueueMeeting,
                getQueueStatus: mockGetQueueStatus,
                processQueue: mockProcessQueue,
                getEmbedding: mockGetEmbedding,
            } as any
        )
        mockIsReady.mockReturnValue(true)
        mockSaveChunks.mockReturnValue(['chunk-1', 'chunk-2'])
    })

    describe('constructor', () => {
        it('should create an instance', () => {
            expect(liveRAGIndexer).toBeInstanceOf(LiveRAGIndexer)
        })
    })

    describe('start', () => {
        it('should set isActive to true', () => {
            ;(liveRAGIndexer as any).start('meeting1')
            expect((liveRAGIndexer as any).isActive).toBe(true)
        })
    })

    describe('stop', () => {
        it('should set isActive to false', async () => {
            ;(liveRAGIndexer as any).start('meeting1')
            await (liveRAGIndexer as any).stop()
            expect((liveRAGIndexer as any).isActive).toBe(false)
        })
    })

    describe('feedSegments', () => {
        it('should append segments to internal list when active', () => {
            ;(liveRAGIndexer as any).start('meeting1')
            const segments = [
                { speaker: 'Speaker 1', text: 'Hello', timestamp: 0 },
                { speaker: 'Speaker 2', text: 'World', timestamp: 1 },
            ]
            liveRAGIndexer.feedSegments(segments)
            expect((liveRAGIndexer as any).allSegments).toEqual(segments)
        })

        it('should not append segments when inactive', () => {
            liveRAGIndexer.feedSegments([
                { speaker: 'Speaker 1', text: 'Hello', timestamp: 0 }
            ])
            expect((liveRAGIndexer as any).allSegments).toHaveLength(0)
        })
    })

    describe('getActiveMeetingId', () => {
        it('should return null initially', () => {
            expect((liveRAGIndexer as any).getActiveMeetingId()).toBeNull()
        })

        it('should return meeting ID when started', () => {
            ;(liveRAGIndexer as any).start('meeting1')
            expect((liveRAGIndexer as any).getActiveMeetingId()).toBe('meeting1')
        })
    })

    describe('isRunning', () => {
        it('should return false when not started', () => {
            expect((liveRAGIndexer as any).isRunning()).toBe(false)
        })

        it('should return true when started', () => {
            ;(liveRAGIndexer as any).start('meeting1')
            expect((liveRAGIndexer as any).isRunning()).toBe(true)
        })
    })

    describe('hasIndexedChunks', () => {
        it('should return false when no chunks indexed', () => {
            expect((liveRAGIndexer as any).hasIndexedChunks()).toBe(false)
        })

        it('should return true when chunks have been indexed', () => {
            ;(liveRAGIndexer as any).start('meeting1')
            ;(liveRAGIndexer as any).indexedChunkCount = 5
            expect((liveRAGIndexer as any).hasIndexedChunks()).toBe(true)
        })
    })

    describe('getIndexedChunkCount', () => {
        it('should return 0 initially', () => {
            expect((liveRAGIndexer as any).getIndexedChunkCount()).toBe(0)
        })

        it('should return correct count after indexing', () => {
            ;(liveRAGIndexer as any).start('meeting1')
            ;(liveRAGIndexer as any).indexedChunkCount = 10
            expect((liveRAGIndexer as any).getIndexedChunkCount()).toBe(10)
        })
    })

    // ========================================================================
    // Real-Time Indexing Behavior Tests (RAG-02: Gap Closure)
    // ========================================================================
    describe('real-time indexing behavior', () => {
        it('should process segments and save chunks when tick is called', async () => {
            ;(liveRAGIndexer as any).start('meeting1')
            const segments = [
                { speaker: 'A', text: 'We need to discuss the roadmap today', timestamp: 0 },
                { speaker: 'B', text: 'The backend migration is nearly complete', timestamp: 1000 },
                { speaker: 'A', text: 'Let us review the timeline carefully', timestamp: 2000 },
            ]
            liveRAGIndexer.feedSegments(segments)
            await (liveRAGIndexer as any).tick()
            expect(mockSaveChunks).toHaveBeenCalled()
        })

        it('should skip processing when fewer than MIN_NEW_SEGMENTS', async () => {
            ;(liveRAGIndexer as any).start('meeting1')
            liveRAGIndexer.feedSegments([
                { speaker: 'A', text: 'We should review this later', timestamp: 0 },
            ])
            await (liveRAGIndexer as any).tick()
            expect(mockSaveChunks).not.toHaveBeenCalled()
        })
    })

    // ========================================================================
    // Chunk Processing Tests (RAG-02: Gap Closure)
    // ========================================================================
    describe('chunk processing', () => {
        it('should save re-indexed chunks via vector store', async () => {
            ;(liveRAGIndexer as any).start('meeting1')
            liveRAGIndexer.feedSegments([
                { speaker: 'A', text: 'We need to discuss the roadmap today', timestamp: 0 },
                { speaker: 'B', text: 'The backend migration is nearly complete', timestamp: 1000 },
                { speaker: 'A', text: 'Let us review the timeline carefully', timestamp: 2000 },
            ])
            await (liveRAGIndexer as any).tick()
            expect(mockSaveChunks).toHaveBeenCalledTimes(1)
            const savedChunks = mockSaveChunks.mock.calls[0][0]
            expect(savedChunks[0].chunkIndex).toBe(0)
        })
    })

    // ========================================================================
    // Embedding Generation Tests (RAG-02: Gap Closure)
    // ========================================================================
    describe('embedding generation', () => {
        it('should embed chunks via pipeline when pipeline is ready', async () => {
            ;(liveRAGIndexer as any).start('meeting1')
            mockGetEmbedding.mockResolvedValue([0.1, 0.2, 0.3])
            liveRAGIndexer.feedSegments([
                { speaker: 'A', text: 'We need to discuss the roadmap today', timestamp: 0 },
                { speaker: 'B', text: 'The backend migration is nearly complete', timestamp: 1000 },
                { speaker: 'A', text: 'Let us review the timeline carefully', timestamp: 2000 },
            ])
            await (liveRAGIndexer as any).tick()
            expect(mockGetEmbedding).toHaveBeenCalled()
        })

        it('should not embed chunks when pipeline is not ready', async () => {
            ;(liveRAGIndexer as any).start('meeting1')
            mockIsReady.mockReturnValue(false)
            liveRAGIndexer.feedSegments([
                { speaker: 'A', text: 'We need to discuss the roadmap today', timestamp: 0 },
                { speaker: 'B', text: 'The backend migration is nearly complete', timestamp: 1000 },
                { speaker: 'A', text: 'Let us review the timeline carefully', timestamp: 2000 },
            ])
            await (liveRAGIndexer as any).tick()
            expect(mockGetEmbedding).not.toHaveBeenCalled()
            expect(mockSaveChunks).toHaveBeenCalled()
        })
    })
})
