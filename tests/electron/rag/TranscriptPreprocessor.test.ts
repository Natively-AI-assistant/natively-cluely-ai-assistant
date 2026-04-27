import { describe, expect, it } from 'vitest'
import {
  estimateTokens,
  preprocessTranscript,
  type RawSegment,
} from '../../../electron/rag/TranscriptPreprocessor'

const raw = (speaker: string, text: string, timestamp: number): RawSegment => ({
  speaker,
  text,
  timestamp,
})

describe('TranscriptPreprocessor', () => {
  describe('estimateTokens', () => {
    it('returns 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0)
    })

    it('estimates 1 token per 4 characters', () => {
      expect(estimateTokens('abcd')).toBe(1)
      expect(estimateTokens('abcdefgh')).toBe(2)
    })

    it('rounds up', () => {
      expect(estimateTokens('abcde')).toBe(2) // 5/4 = 1.25 -> 2
    })
  })

  describe('preprocessTranscript', () => {
    it('returns empty array for empty input', () => {
      expect(preprocessTranscript([])).toEqual([])
    })

    it('merges consecutive same-speaker segments (<5s gap)', () => {
      const segments = [
        raw('Alice', 'Hello there', 1000),
        raw('Alice', 'How are you', 2000), // 1s gap
      ]
      const result = preprocessTranscript(segments)
      expect(result).toHaveLength(1)
      // TranscriptPreprocessor's cleanText preserves original casing
      expect(result[0].text).toContain('Hello there')
      expect(result[0].text).toContain('How are you')
    })

    it('does NOT merge segments with >5s gap', () => {
      const segments = [
        raw(
          'Alice',
          'First statement about the project architecture and design patterns.',
          1000,
        ),
        raw(
          'Alice',
          'Second statement about different topic that came much later in conversation.',
          8000,
        ), // 7s gap
      ]
      const result = preprocessTranscript(segments)
      expect(result.length).toBeGreaterThanOrEqual(2)
    })

    it('does NOT merge segments from different speakers', () => {
      const segments = [
        raw('Alice', 'Alice speaks about the important topic first.', 1000),
        raw(
          'Bob',
          'Bob responds with his own perspective on the same topic.',
          2000,
        ),
      ]
      const result = preprocessTranscript(segments)
      expect(result).toHaveLength(2)
      expect(result[0].speaker).toBe('Alice')
      expect(result[1].speaker).toBe('Bob')
    })

    it('removes filler words', () => {
      const segments = [
        raw(
          'user',
          'um yeah so like the answer is forty two and that is correct',
          1000,
        ),
      ]
      const result = preprocessTranscript(segments)
      expect(result[0].text).not.toContain('um')
      expect(result[0].text).not.toContain('like')
      expect(result[0].text).toContain('answer is forty two')
    })

    it('drops segments with <3 words after cleaning', () => {
      const segments = [raw('user', 'yeah okay sure', 1000)]
      const result = preprocessTranscript(segments)
      expect(result).toHaveLength(0)
    })

    it('detects questions (ends with ?)', () => {
      const segments = [
        raw(
          'interviewer',
          'Can you explain how react hooks work in detail?',
          1000,
        ),
      ]
      const result = preprocessTranscript(segments)
      expect(result[0].isQuestion).toBe(true)
    })

    it('detects questions (starts with question word)', () => {
      const segments = [
        raw(
          'interviewer',
          'What is your experience with typescript and its advanced features',
          1000,
        ),
      ]
      const result = preprocessTranscript(segments)
      expect(result[0].isQuestion).toBe(true)
    })

    it('does not flag non-questions', () => {
      const segments = [
        raw(
          'interviewer',
          'Tell me about your experience with react and frontend development',
          1000,
        ),
      ]
      const result = preprocessTranscript(segments)
      expect(result[0].isQuestion).toBe(false)
    })

    it('detects decisions', () => {
      const segments = [
        raw(
          'interviewer',
          'We decided to go with react for this project',
          1000,
        ),
      ]
      const result = preprocessTranscript(segments)
      expect(result[0].isDecision).toBe(true)
    })

    it('detects "agreed" as decision', () => {
      const segments = [
        raw(
          'interviewer',
          'Agreed that typescript is the best choice here',
          1000,
        ),
      ]
      const result = preprocessTranscript(segments)
      expect(result[0].isDecision).toBe(true)
    })

    it('detects action items', () => {
      const segments = [
        raw(
          'interviewer',
          'You will need to implement the auth module by next week',
          1000,
        ),
      ]
      const result = preprocessTranscript(segments)
      expect(result[0].isActionItem).toBe(true)
    })

    it('detects deadline patterns as action items', () => {
      const segments = [
        raw(
          'interviewer',
          'Please finish the api integration by end of day',
          1000,
        ),
      ]
      const result = preprocessTranscript(segments)
      expect(result[0].isActionItem).toBe(true)
    })

    it('normalizes speaker labels', () => {
      const segments = [
        raw(
          'user',
          'This is my response about the topic and I think we should proceed',
          1000,
        ),
        raw(
          'interviewer',
          'This is the interviewer speaking about something important here',
          2000,
        ),
        raw(
          'assistant',
          'This is the assistant response with helpful information included',
          3000,
        ),
      ]
      const result = preprocessTranscript(segments)
      expect(result.find((s) => s.speaker === 'You')).toBeDefined()
      expect(result.find((s) => s.speaker === 'Speaker')).toBeDefined()
      expect(result.find((s) => s.speaker === 'Natively')).toBeDefined()
    })

    it('preserves custom speaker names', () => {
      const segments = [
        raw(
          'Alice',
          'Alice has a very detailed opinion about the architecture and design choices',
          1000,
        ),
      ]
      const result = preprocessTranscript(segments)
      expect(result[0].speaker).toBe('Alice')
    })

    it('preserves correct startMs/endMs after merge', () => {
      const segments = [
        raw('Alice', 'First statement about the topic', 1000),
        raw('Alice', 'Second statement continuing the thought', 2000),
      ]
      const result = preprocessTranscript(segments)
      expect(result[0].startMs).toBe(1000)
      expect(result[0].endMs).toBe(2000)
    })

    it('handles all-filler segments gracefully', () => {
      const segments = [
        raw('user', 'uh um ah hmm', 1000),
        raw('user', 'yeah okay sure', 2000),
      ]
      const result = preprocessTranscript(segments)
      expect(result).toHaveLength(0)
    })
  })
})
