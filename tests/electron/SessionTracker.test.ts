import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SessionTracker,
  type TranscriptSegment,
} from '../../electron/SessionTracker'

// Mock dependencies
vi.mock('../../electron/llm', () => ({
  RecapLLM: vi.fn(),
}))
vi.mock('../../electron/verboseLog', () => ({
  isVerboseLogging: () => false,
}))

describe('SessionTracker', () => {
  let tracker: SessionTracker

  beforeEach(() => {
    tracker = new SessionTracker()
  })

  describe('mapSpeakerToRole', () => {
    it('maps "user" to "user"', () => {
      expect((tracker as any).mapSpeakerToRole('user')).toBe('user')
    })

    it('maps "assistant" to "assistant"', () => {
      expect((tracker as any).mapSpeakerToRole('assistant')).toBe('assistant')
    })

    it('maps anything else to "interviewer"', () => {
      expect((tracker as any).mapSpeakerToRole('interviewer')).toBe(
        'interviewer',
      )
      expect((tracker as any).mapSpeakerToRole('system')).toBe('interviewer')
      expect((tracker as any).mapSpeakerToRole('unknown')).toBe('interviewer')
    })
  })

  describe('setCodingQuestion / getDetectedCodingQuestion', () => {
    it('stores first question from any source', () => {
      tracker.setCodingQuestion('Implement binary search', 'transcript')
      const result = tracker.getDetectedCodingQuestion()
      expect(result.question).toBe('Implement binary search')
      expect(result.source).toBe('transcript')
    })

    it('screenshot always overrides existing question', () => {
      tracker.setCodingQuestion('First question from transcript', 'transcript')
      tracker.setCodingQuestion('New question from screenshot', 'screenshot')
      const result = tracker.getDetectedCodingQuestion()
      expect(result.question).toBe('New question from screenshot')
      expect(result.source).toBe('screenshot')
    })

    it('transcript can override older transcript question', () => {
      tracker.setCodingQuestion('First transcript question', 'transcript')
      tracker.setCodingQuestion('Second transcript question', 'transcript')
      const result = tracker.getDetectedCodingQuestion()
      expect(result.question).toBe('Second transcript question')
    })

    it('transcript cannot override recent screenshot (<3min)', () => {
      tracker.setCodingQuestion('Screenshot question', 'screenshot')
      tracker.setCodingQuestion('Transcript question', 'transcript')
      const result = tracker.getDetectedCodingQuestion()
      expect(result.question).toBe('Screenshot question')
      expect(result.source).toBe('screenshot')
    })

    it('transcript CAN override stale screenshot (>3min)', () => {
      vi.useFakeTimers()
      tracker.setCodingQuestion('Screenshot question', 'screenshot')
      // Advance 3 minutes + 1ms
      vi.advanceTimersByTime(3 * 60 * 1000 + 1)
      tracker.setCodingQuestion('Transcript question', 'transcript')
      const result = tracker.getDetectedCodingQuestion()
      expect(result.question).toBe('Transcript question')
      vi.useRealTimers()
    })

    it('ignores empty questions', () => {
      tracker.setCodingQuestion('', 'transcript')
      const result = tracker.getDetectedCodingQuestion()
      expect(result.question).toBeNull()
    })

    it('ignores whitespace-only questions', () => {
      tracker.setCodingQuestion('   ', 'transcript')
      const result = tracker.getDetectedCodingQuestion()
      expect(result.question).toBeNull()
    })
  })

  describe('clearCodingQuestion', () => {
    it('clears detected coding question', () => {
      tracker.setCodingQuestion('Some question', 'screenshot')
      tracker.clearCodingQuestion()
      const result = tracker.getDetectedCodingQuestion()
      expect(result.question).toBeNull()
      expect(result.source).toBeNull()
    })
  })

  describe('looksLikeCodingQuestion (via handleTranscript)', () => {
    const makeSegment = (text: string): TranscriptSegment => ({
      speaker: 'interviewer',
      text,
      timestamp: Date.now(),
      final: true,
    })

    it('detects coding questions with algorithm patterns', () => {
      const seg = makeSegment(
        'Implement an algorithm to find the maximum element in an array using binary search approach',
      )
      tracker.handleTranscript(seg)
      const result = tracker.getDetectedCodingQuestion()
      expect(result.question).toBeTruthy()
      expect(result.source).toBe('transcript')
    })

    it('rejects short casual speech (<50 chars)', () => {
      const seg = makeSegment('sounds good!')
      tracker.handleTranscript(seg)
      const result = tracker.getDetectedCodingQuestion()
      expect(result.question).toBeNull()
    })

    it('rejects casual conversation', () => {
      const seg = makeSegment(
        'That is a great point and I agree with your assessment of the situation completely today',
      )
      tracker.handleTranscript(seg)
      const result = tracker.getDetectedCodingQuestion()
      expect(result.question).toBeNull()
    })

    it('detects function + complexity patterns', () => {
      const seg = makeSegment(
        'Write a function that processes the array with O(n) time complexity and returns the sorted result',
      )
      tracker.handleTranscript(seg)
      const result = tracker.getDetectedCodingQuestion()
      expect(result.question).toBeTruthy()
    })

    it('only processes final segments', () => {
      const seg = makeSegment(
        'Implement an algorithm to find the maximum in the given array of integers',
      )
      seg.final = false
      tracker.handleTranscript(seg)
      const result = tracker.getDetectedCodingQuestion()
      expect(result.question).toBeNull()
    })
  })

  describe('addAssistantMessage', () => {
    it('stores last assistant message', () => {
      tracker.addAssistantMessage(
        'Here is a detailed and helpful response about the topic you asked about',
      )
      expect(tracker.getLastAssistantMessage()).toContain(
        'detailed and helpful response',
      )
    })

    it('ignores short messages (<10 chars)', () => {
      tracker.addAssistantMessage('ok')
      expect(tracker.getLastAssistantMessage()).toBeNull()
    })

    it('ignores "I\'m not sure" fallback messages', () => {
      tracker.addAssistantMessage(
        "I'm not sure about that answer but I can try to help",
      )
      expect(tracker.getLastAssistantMessage()).toBeNull()
    })

    it('ignores "I can\'t answer" fallback messages', () => {
      tracker.addAssistantMessage("I can't answer that question right now")
      expect(tracker.getLastAssistantMessage()).toBeNull()
    })

    it('tracks response history', () => {
      tracker.addAssistantMessage(
        'First detailed and meaningful response about the topic',
      )
      tracker.addAssistantMessage(
        'Second detailed and meaningful response about the topic',
      )
      const history = tracker.getAssistantResponseHistory()
      expect(history).toHaveLength(2)
    })

    it('caps response history at 10', () => {
      for (let i = 0; i < 15; i++) {
        tracker.addAssistantMessage(
          `Response number ${i} with enough content to pass filters`,
        )
      }
      const history = tracker.getAssistantResponseHistory()
      expect(history.length).toBeLessThanOrEqual(10)
    })
  })

  describe('context management', () => {
    it('addTranscript stores final segments', () => {
      const result = tracker.addTranscript({
        speaker: 'interviewer',
        text: 'Tell me about your experience with React and frontend development',
        timestamp: Date.now(),
        final: true,
      })
      expect(result).not.toBeNull()
      expect(result?.role).toBe('interviewer')
    })

    it('addTranscript ignores non-final segments', () => {
      const result = tracker.addTranscript({
        speaker: 'interviewer',
        text: 'Tell me about your experience',
        timestamp: Date.now(),
        final: false,
      })
      expect(result).toBeNull()
    })

    it('addTranscript deduplicates identical segments', () => {
      const now = Date.now()
      tracker.addTranscript({
        speaker: 'interviewer',
        text: 'Hello there this is a test message',
        timestamp: now,
        final: true,
      })
      const result = tracker.addTranscript({
        speaker: 'interviewer',
        text: 'Hello there this is a test message',
        timestamp: now,
        final: true,
      })
      expect(result).toBeNull()
    })

    it('getContext returns items within time window', () => {
      vi.useFakeTimers()
      const now = Date.now()
      tracker.addTranscript({
        speaker: 'interviewer',
        text: 'Recent question about the topic',
        timestamp: now,
        final: true,
      })
      vi.advanceTimersByTime(5000)
      tracker.addTranscript({
        speaker: 'user',
        text: 'Recent answer to the question',
        timestamp: now + 5000,
        final: true,
      })

      const context = tracker.getContext(120)
      expect(context.length).toBeGreaterThan(0)
      vi.useRealTimers()
    })

    it('getFormattedContext formats with labels', () => {
      tracker.addTranscript({
        speaker: 'interviewer',
        text: 'Question about React',
        timestamp: Date.now(),
        final: true,
      })
      tracker.addTranscript({
        speaker: 'user',
        text: 'Answer about React',
        timestamp: Date.now(),
        final: true,
      })

      const formatted = tracker.getFormattedContext()
      expect(formatted).toContain('[INTERVIEWER]')
      expect(formatted).toContain('[ME]')
    })

    it('getLastInterviewerTurn returns last interviewer text', () => {
      const now = Date.now()
      tracker.addTranscript({
        speaker: 'user',
        text: 'some user text here that is long enough',
        timestamp: now,
        final: true,
      })
      tracker.addTranscript({
        speaker: 'interviewer',
        text: 'the last interviewer question about the topic',
        timestamp: now + 1000,
        final: true,
      })
      expect(tracker.getLastInterviewerTurn()).toBe(
        'the last interviewer question about the topic',
      )
    })

    it('getLastInterviewerTurn returns null when no interviewer turns', () => {
      tracker.addTranscript({
        speaker: 'user',
        text: 'only user text here that is long enough',
        timestamp: Date.now(),
        final: true,
      })
      expect(tracker.getLastInterviewerTurn()).toBeNull()
    })
  })

  describe('reset', () => {
    it('clears all state', () => {
      tracker.addTranscript({
        speaker: 'interviewer',
        text: 'question here',
        timestamp: 1000,
        final: true,
      })
      tracker.addAssistantMessage('response here with enough content')
      tracker.setCodingQuestion('coding question', 'screenshot')

      tracker.reset()

      expect(tracker.getLastAssistantMessage()).toBeNull()
      expect(tracker.getAssistantResponseHistory()).toHaveLength(0)
      expect(tracker.getDetectedCodingQuestion().question).toBeNull()
      expect(tracker.getContext()).toHaveLength(0)
    })
  })

  describe('meeting metadata', () => {
    it('setMeetingMetadata / getMeetingMetadata round-trip', () => {
      const meta = { title: 'Standup', source: 'calendar' as const }
      tracker.setMeetingMetadata(meta)
      expect(tracker.getMeetingMetadata()).toEqual(meta)
    })

    it('clearMeetingMetadata sets to null', () => {
      tracker.setMeetingMetadata({ title: 'Test' })
      tracker.clearMeetingMetadata()
      expect(tracker.getMeetingMetadata()).toBeNull()
    })
  })
})
