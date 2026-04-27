import { describe, expect, it } from 'vitest'
import {
  type AssistantResponse,
  buildTemporalContext,
  type ContextItem,
  formatTemporalContextForPrompt,
} from '../../../electron/llm/TemporalContextBuilder'

const ctxItem = (
  role: ContextItem['role'],
  text: string,
  ts: number,
): ContextItem => ({ role, text, timestamp: ts })
const response = (
  text: string,
  ts: number,
  question: string = 'q',
): AssistantResponse => ({ text, timestamp: ts, questionContext: question })

describe('TemporalContextBuilder', () => {
  const now = Date.now()

  describe('buildTemporalContext', () => {
    it('filters context items by time window (180s default)', () => {
      const items = [
        ctxItem('interviewer', 'old question', now - 200_000),
        ctxItem('interviewer', 'recent question', now - 10_000),
      ]
      const result = buildTemporalContext(items, [], 180)
      expect(result.recentTranscript).toContain('recent question')
      expect(result.recentTranscript).not.toContain('old question')
    })

    it('detects "responding_to_interviewer" role context', () => {
      const items = [
        ctxItem('interviewer', 'Tell me about yourself', now - 5000),
      ]
      const result = buildTemporalContext(items, [])
      expect(result.roleContext).toBe('responding_to_interviewer')
    })

    it('detects "responding_to_user" role context', () => {
      const items = [ctxItem('user', 'What should I say', now - 5000)]
      const result = buildTemporalContext(items, [])
      expect(result.roleContext).toBe('responding_to_user')
    })

    it('returns "general" when no context items', () => {
      const result = buildTemporalContext([], [])
      expect(result.roleContext).toBe('general')
    })

    it('extracts technical tone signals', () => {
      const history = [
        response(
          'We should implement the algorithm using a binary search tree for optimal performance',
          now - 5000,
        ),
        response(
          'The function uses async await with a promise callback for the database query',
          now - 3000,
        ),
      ]
      const result = buildTemporalContext([], history)
      const technicalSignal = result.toneSignals.find(
        (s) => s.type === 'technical',
      )
      expect(technicalSignal).toBeDefined()
      expect(technicalSignal?.confidence).toBeGreaterThan(0)
    })

    it('extracts formal tone signals', () => {
      const history = [
        response(
          'Therefore, I would recommend using the established pattern. Furthermore, it is important to note that the architecture supports this.',
          now - 5000,
        ),
        response(
          'Consequently, the implementation should follow the guidelines. Moreover, this approach has been validated previously.',
          now - 3000,
        ),
      ]
      const result = buildTemporalContext([], history)
      const formalSignal = result.toneSignals.find((s) => s.type === 'formal')
      expect(formalSignal).toBeDefined()
    })

    it('extracts casual tone signals', () => {
      const history = [
        response(
          'So basically you can just use the hook and it pretty much handles everything',
          now - 5000,
        ),
        response(
          'Honestly, kind of easy actually. You literally just call the function.',
          now - 3000,
        ),
      ]
      const result = buildTemporalContext([], history)
      const casualSignal = result.toneSignals.find((s) => s.type === 'casual')
      expect(casualSignal).toBeDefined()
    })

    it('returns hasRecentResponses=false when no history', () => {
      const result = buildTemporalContext([], [])
      expect(result.hasRecentResponses).toBe(false)
    })

    it('returns hasRecentResponses=true when history exists in window', () => {
      const history = [response('some response', now - 5000)]
      const result = buildTemporalContext([], history)
      expect(result.hasRecentResponses).toBe(true)
    })

    it('formats previous responses and truncates >200 chars', () => {
      const longText = 'a'.repeat(300)
      const history = [response(longText, now - 5000)]
      const result = buildTemporalContext([], history)
      expect(result.previousResponses[0].length).toBeLessThanOrEqual(203) // 200 + '...'
      expect(result.previousResponses[0]).toContain('...')
    })

    it('filters assistant history by window', () => {
      const history = [
        response('old response', now - 200_000),
        response('recent response', now - 5000),
      ]
      const result = buildTemporalContext([], history, 180)
      expect(result.previousResponses).toHaveLength(1)
      expect(result.previousResponses[0]).toContain('recent response')
    })

    it('respects custom windowSeconds', () => {
      const items = [ctxItem('interviewer', 'question', now - 60_000)]
      const result1 = buildTemporalContext(items, [], 30)
      expect(result1.recentTranscript).toBe('')

      const result2 = buildTemporalContext(items, [], 120)
      expect(result2.recentTranscript).toContain('question')
    })
  })

  describe('formatTemporalContextForPrompt', () => {
    it('includes previous_responses section when responses exist', () => {
      const ctx = buildTemporalContext(
        [],
        [response('first response', now - 5000)],
      )
      const result = formatTemporalContextForPrompt(ctx)
      expect(result).toContain('<previous_responses_to_avoid_repeating>')
      expect(result).toContain('Response 1: "first response"')
    })

    it('does not include previous_responses section when empty', () => {
      const ctx = buildTemporalContext([], [])
      const result = formatTemporalContextForPrompt(ctx)
      expect(result).not.toContain('previous_responses_to_avoid_repeating')
    })

    it('includes tone_guidance when signals exist', () => {
      const history = [
        response(
          'We should implement the algorithm using function and async await with component and module and database and architecture',
          now - 5000,
        ),
        response(
          'The API uses async await promise callback for implementing the function and algorithm with database component',
          now - 3000,
        ),
      ]
      const ctx = buildTemporalContext([], history)
      const result = formatTemporalContextForPrompt(ctx)
      if (ctx.toneSignals.length > 0) {
        expect(result).toContain('<tone_guidance>')
      }
    })

    it('includes role_context for interviewer', () => {
      const items = [ctxItem('interviewer', 'question', now - 5000)]
      const ctx = buildTemporalContext(items, [])
      const result = formatTemporalContextForPrompt(ctx)
      expect(result).toContain('<role_context>')
      expect(result).toContain('responding to the interviewer')
    })

    it('includes role_context for user', () => {
      const items = [ctxItem('user', 'what should I say', now - 5000)]
      const ctx = buildTemporalContext(items, [])
      const result = formatTemporalContextForPrompt(ctx)
      expect(result).toContain('helping the user formulate')
    })

    it('does not include role_context when general', () => {
      const ctx = buildTemporalContext([], [])
      const result = formatTemporalContextForPrompt(ctx)
      expect(result).not.toContain('role_context')
    })
  })
})
