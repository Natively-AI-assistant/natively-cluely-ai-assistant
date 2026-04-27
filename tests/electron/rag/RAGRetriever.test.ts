import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RAGRetriever } from '../../../electron/rag/RAGRetriever'

// Mock dependencies
const mockVectorStore = {
  searchSimilar: vi.fn(),
  searchSummaries: vi.fn(),
}

const mockEmbeddingPipeline = {
  getEmbeddingForQuery: vi.fn(),
  getActiveProviderName: vi.fn(() => 'openai'),
}

describe('RAGRetriever', () => {
  let retriever: RAGRetriever

  beforeEach(() => {
    vi.clearAllMocks()
    retriever = new RAGRetriever(
      mockVectorStore as any,
      mockEmbeddingPipeline as any,
    )
  })

  describe('detectIntent', () => {
    it('detects "What did we decide?" as decision_recall', () => {
      expect(retriever.detectIntent('What did we decide?')).toBe(
        'decision_recall',
      )
    })

    it('detects "What did we agree on?" as decision_recall', () => {
      expect(retriever.detectIntent('What did we agree on?')).toBe(
        'decision_recall',
      )
    })

    it('detects "Did we agree on a timeline?" as decision_recall', () => {
      expect(retriever.detectIntent('Did we agree on a timeline?')).toBe(
        'decision_recall',
      )
    })

    it('detects "What did he say about React?" as speaker_lookup', () => {
      expect(retriever.detectIntent('What did he say about React?')).toBe(
        'speaker_lookup',
      )
    })

    it('detects "Who said we should use TypeScript?" as speaker_lookup', () => {
      expect(retriever.detectIntent('Who said we should use TypeScript?')).toBe(
        'speaker_lookup',
      )
    })

    it('detects "What are my action items?" as action_items', () => {
      expect(retriever.detectIntent('What are my action items?')).toBe(
        'action_items',
      )
    })

    it('detects "What should I do next?" as action_items', () => {
      expect(retriever.detectIntent('What should I do next?')).toBe(
        'action_items',
      )
    })

    it('detects "What is my todo?" as action_items', () => {
      expect(retriever.detectIntent('What is my todo?')).toBe('action_items')
    })

    it('detects "Summarize the meeting" as summary', () => {
      expect(retriever.detectIntent('Summarize the meeting')).toBe('summary')
    })

    it('detects "Give me a recap" as summary', () => {
      expect(retriever.detectIntent('Give me a recap')).toBe('summary')
    })

    it('detects "What are the key points?" as summary', () => {
      expect(retriever.detectIntent('What are the key points?')).toBe('summary')
    })

    it('returns open_question for generic questions', () => {
      expect(retriever.detectIntent('How does React work?')).toBe(
        'open_question',
      )
    })

    it('is case insensitive', () => {
      expect(retriever.detectIntent('WHAT DID WE DECIDE')).toBe(
        'decision_recall',
      )
      expect(retriever.detectIntent('summarize')).toBe('summary')
    })

    it('handles empty string', () => {
      expect(retriever.detectIntent('')).toBe('open_question')
    })
  })

  describe('detectScope', () => {
    it('detects "this meeting" as meeting scope', () => {
      expect(retriever.detectScope('what happened in this meeting')).toBe(
        'meeting',
      )
    })

    it('detects "earlier" as meeting scope', () => {
      expect(retriever.detectScope('what did they say earlier')).toBe('meeting')
    })

    it('detects "all meetings" as global scope', () => {
      expect(retriever.detectScope('search all meetings for React')).toBe(
        'global',
      )
    })

    it('detects "when did we" as global scope', () => {
      expect(retriever.detectScope('when did we discuss TypeScript')).toBe(
        'global',
      )
    })

    it('detects "find" as global scope', () => {
      expect(retriever.detectScope('find all discussions about API')).toBe(
        'global',
      )
    })

    it('defaults to meeting when currentMeetingId provided', () => {
      expect(
        retriever.detectScope('tell me about components', 'meeting-123'),
      ).toBe('meeting')
    })

    it('defaults to global when no currentMeetingId', () => {
      expect(retriever.detectScope('tell me about components')).toBe('global')
    })

    it('handles empty query with meetingId', () => {
      expect(retriever.detectScope('', 'meeting-1')).toBe('meeting')
    })

    it('handles empty query without meetingId', () => {
      expect(retriever.detectScope('')).toBe('global')
    })

    it('meeting patterns take precedence over global', () => {
      // "they said" is a meeting pattern
      expect(
        retriever.detectScope('what did they say in the last meeting'),
      ).toBe('meeting')
    })
  })
})
