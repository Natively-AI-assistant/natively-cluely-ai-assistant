import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import { createTestEnv, destroyTestEnv, type TestEnv } from './__helpers__/test-env'
import { createSegment, createRealisticTranscript } from './__fixtures__/transcripts'
import { createInMemoryDb } from './__helpers__/db-helpers'
import './__helpers__/shared-mocks'

import { chunkTranscript, type Chunk } from '../../electron/rag/SemanticChunker'
import type { CleanedSegment } from '../../electron/rag/TranscriptPreprocessor'
import { VectorStore } from '../../electron/rag/VectorStore'
import { DatabaseManager } from '../../electron/db/DatabaseManager'
import { resetDatabaseManager } from './__helpers__/cleanup'

function mockEmbedding(text: string, dim: number = 384): number[] {
  const vec = new Array(dim).fill(0)
  for (let i = 0; i < Math.min(text.length, dim); i++) {
    vec[i] = (text.charCodeAt(i) % 100) / 100
  }
  return vec
}

function insertTestMeeting(db: any, id: string) {
  db.prepare(
    'INSERT INTO meetings (id, title, start_time, duration_ms, summary_json, is_processed) VALUES (?, ?, ?, ?, ?, 1)'
  ).run(id, `Meeting ${id}`, Date.now(), 300000, '{}')
}

describe('RAG Pipeline Integration', () => {
  let env: TestEnv
  let store: VectorStore

  beforeEach(() => {
    env = createTestEnv()
    ;(global as any).__NATIVELY_TEST_USER_DATA__ = env.userDataPath
    resetDatabaseManager(DatabaseManager)

    const db = createInMemoryDb()
    ;(DatabaseManager as any).instance = {
      getDb: () => db,
      getDbPath: () => ':memory:',
      getExtPath: () => '',
    }

    store = new VectorStore(db, path.join(env.userDataPath, 'test.db'), '')
  })

  afterEach(async () => {
    await store.destroy().catch(() => {})
    resetDatabaseManager(DatabaseManager)
    delete (global as any).__NATIVELY_TEST_USER_DATA__
    destroyTestEnv(env)
  })

  describe('SemanticChunker', () => {
    it('chunks transcript text into meaningful segments', () => {
      const segments = [
        createSegment('Alice', 'We need to discuss the new architecture for the React components and how they will interact with the backend API services.', 0, 5000),
        createSegment('Alice', 'I think we should use a micro-frontend approach where each team owns their own bounded context and deploys independently.', 5000, 10000),
        createSegment('Bob', 'That makes sense. What about shared state management? We need a consistent approach across all the micro-frontends.', 10000, 15000),
        createSegment('Bob', 'I suggest we use a shared event bus pattern for cross-context communication while keeping local state within each context.', 15000, 20000),
        createSegment('Alice', 'Agreed. Lets draft a proposal and review it in the next sprint planning meeting.', 20000, 25000),
      ]

      const chunks = chunkTranscript('meeting-1', segments)

      expect(chunks.length).toBeGreaterThan(0)

      for (const chunk of chunks) {
        expect(chunk.meetingId).toBe('meeting-1')
        expect(typeof chunk.chunkIndex).toBe('number')
        expect(chunk.chunkIndex).toBeGreaterThanOrEqual(0)
        expect(chunk.speaker).toBeTruthy()
        expect(chunk.text).toBeTruthy()
        expect(chunk.text.length).toBeGreaterThan(0)
        expect(chunk.tokenCount).toBeGreaterThan(0)
        expect(chunk.startMs).toBeGreaterThanOrEqual(0)
        expect(chunk.endMs).toBeGreaterThanOrEqual(chunk.startMs)
      }

      const allChunkText = chunks.map(c => c.text).join(' ')
      expect(allChunkText).toContain('architecture')
      expect(allChunkText).toContain('micro-frontend')
      expect(allChunkText).toContain('event bus')
    })

    it('respects max chunk size', () => {
      const segments: CleanedSegment[] = []
      let time = 0
      for (let i = 0; i < 20; i++) {
        segments.push(
          createSegment('Alice', `This is segment number ${i} with enough content to be meaningful. We discuss various topics including architecture, design patterns, and implementation details for our project.`, time, time + 3000)
        )
        time += 3000
      }

      const chunks = chunkTranscript('meeting-2', segments)
      expect(chunks.length).toBeGreaterThan(0)

      const maxTokens = 400
      for (const chunk of chunks) {
        expect(chunk.tokenCount).toBeLessThanOrEqual(maxTokens + 50)
      }
    })

    it('handles empty transcript', () => {
      const chunks = chunkTranscript('empty-meeting', [])
      expect(chunks).toHaveLength(0)
    })
  })

  describe('VectorStore', () => {
    it('stores and retrieves vectors', () => {
      const db = (DatabaseManager as any).instance.getDb()
      insertTestMeeting(db, 'meeting-1')

      const segments = [
        createSegment('Alice', 'We decided to use PostgreSQL for the new analytics pipeline because it handles time-series data well.', 0, 5000),
        createSegment('Bob', 'I agree. We should also set up automated backups and monitoring for the database cluster.', 5000, 10000),
        createSegment('Alice', 'Lets assign the database setup task to the infrastructure team by end of week.', 10000, 15000),
      ]
      const chunks = chunkTranscript('meeting-1', segments)

      const ids = store.saveChunks(chunks)
      expect(ids).toHaveLength(3)

      const dim = 384
      for (let i = 0; i < chunks.length; i++) {
        const embedding = mockEmbedding(chunks[i].text, dim)
        store.storeEmbedding(ids[i], embedding)
      }

      expect(store.hasEmbeddings('meeting-1')).toBe(true)

      const retrieved = store.getChunksForMeeting('meeting-1')
      expect(retrieved).toHaveLength(3)
      expect(retrieved[0].text).toContain('PostgreSQL')
      expect(retrieved[0].speaker).toBe('Alice')
      expect(retrieved[0].meetingId).toBe('meeting-1')

      const withoutEmbeddings = store.getChunksWithoutEmbeddings('meeting-1')
      expect(withoutEmbeddings).toHaveLength(0)
    })

    it('returns empty array for non-existent meeting', () => {
      const retrieved = store.getChunksForMeeting('non-existent')
      expect(retrieved).toHaveLength(0)
    })

    it('handles storing embeddings for non-existent chunk gracefully', () => {
      expect(() => store.storeEmbedding(99999, [0.1, 0.2, 0.3])).not.toThrow()
    })
  })

  describe('Full pipeline: chunk → embed → store → retrieve', () => {
    it('processes text through the full pipeline', () => {
      const meetingId = 'pipeline-meeting'
      const db = (DatabaseManager as any).instance.getDb()
      insertTestMeeting(db, meetingId)

      const transcript = createRealisticTranscript(meetingId)
      const chunks = chunkTranscript(meetingId, transcript)
      expect(chunks.length).toBeGreaterThan(0)

      const ids = store.saveChunks(chunks)
      expect(ids).toHaveLength(chunks.length)

      const dim = 384
      for (let i = 0; i < chunks.length; i++) {
        const embedding = mockEmbedding(chunks[i].text, dim)
        store.storeEmbedding(ids[i], embedding)
      }

      const retrieved = store.getChunksForMeeting(meetingId)
      expect(retrieved).toHaveLength(chunks.length)
      expect(retrieved.every(c => c.meetingId === meetingId)).toBe(true)
      expect(store.hasEmbeddings(meetingId)).toBe(true)

      const churnRelated = retrieved.filter(c =>
        c.text.toLowerCase().includes('churn') ||
        c.text.toLowerCase().includes('retention')
      )
      expect(churnRelated.length).toBeGreaterThan(0)

      const revenueRelated = retrieved.filter(c =>
        c.text.toLowerCase().includes('revenue') ||
        c.text.toLowerCase().includes('growth')
      )
      expect(revenueRelated.length).toBeGreaterThan(0)

      for (let i = 1; i < retrieved.length; i++) {
        expect(retrieved[i].chunkIndex).toBeGreaterThan(retrieved[i - 1].chunkIndex)
      }

      for (let i = 1; i < retrieved.length; i++) {
        expect(retrieved[i].startMs).toBeGreaterThanOrEqual(retrieved[i - 1].startMs)
      }
    })

    it('handles pipeline with single-segment transcript', () => {
      const meetingId = 'single-segment'
      const db = (DatabaseManager as any).instance.getDb()
      insertTestMeeting(db, meetingId)

      const transcript = [createSegment('Alice', 'Single statement meeting.', 0, 5000)]
      const chunks = chunkTranscript(meetingId, transcript)

      const ids = store.saveChunks(chunks)
      expect(ids).toHaveLength(1)

      store.storeEmbedding(ids[0], mockEmbedding(chunks[0].text))
      expect(store.hasEmbeddings(meetingId)).toBe(true)

      const retrieved = store.getChunksForMeeting(meetingId)
      expect(retrieved).toHaveLength(1)
    })
  })
})
