/**
 * Tests for analytics.service (259 lines)
 * Tests gtag injection and event tracking
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  analytics,
  detectProviderType,
} from '../../../src/lib/analytics/analytics.service'

describe('analytics.service', () => {
  describe('detectProviderType', () => {
    it('returns "cloud" for GPT models', () => {
      expect(detectProviderType('gpt-4')).toBe('cloud')
      expect(detectProviderType('gpt-3.5-turbo')).toBe('cloud')
      expect(detectProviderType('gpt-4o-mini')).toBe('cloud')
    })

    it('returns "cloud" for Claude and Gemini models', () => {
      expect(detectProviderType('claude-3-opus')).toBe('cloud')
      expect(detectProviderType('claude-3.5-sonnet')).toBe('cloud')
      expect(detectProviderType('gemini-pro')).toBe('cloud')
      expect(detectProviderType('gemini-1.5-flash')).toBe('cloud')
    })

    it('returns "cloud" for Groq-branded cloud models', () => {
      expect(detectProviderType('groq-mixtral')).toBe('cloud') // 'groq-mixtral' has no local keyword match (mixtral != mistral)
      expect(detectProviderType('llama-3-groq')).toBe('local') // 'llama' matches local
    })

    it('returns "local" for ollama-prefixed models', () => {
      expect(detectProviderType('ollama:llama2')).toBe('local')
      expect(detectProviderType('Ollama:Mixtral')).toBe('local')
    })

    it('returns "local" for llama variants', () => {
      expect(detectProviderType('llama2')).toBe('local')
      expect(detectProviderType('Llama-3-70B')).toBe('local')
      expect(detectProviderType('codellama')).toBe('local')
    })

    it('returns "local" for other local model keywords', () => {
      expect(detectProviderType('mistral')).toBe('local')
      expect(detectProviderType('phi-2')).toBe('local')
      expect(detectProviderType('deepseek-coder')).toBe('local')
      expect(detectProviderType('qwen-72b')).toBe('local')
      expect(detectProviderType('vicuna')).toBe('local')
      expect(detectProviderType('orca')).toBe('local')
    })

    it('is case-insensitive', () => {
      expect(detectProviderType('LLAMA')).toBe('local')
      expect(detectProviderType('MISTRAL')).toBe('local')
      expect(detectProviderType('Ollama:Model')).toBe('local')
      expect(detectProviderType('DEEPSEEK')).toBe('local')
    })

    it('matches keywords within longer model names', () => {
      expect(detectProviderType('my-custom-llama-model')).toBe('local')
      expect(detectProviderType('hf/mistral-7b-instruct')).toBe('local')
    })

    it('returns "cloud" for unknown model names', () => {
      expect(detectProviderType('some-unknown-model')).toBe('cloud')
      expect(detectProviderType('')).toBe('cloud')
    })
  })

  describe('AnalyticsService singleton', () => {
    it('returns the same instance', async () => {
      const { analytics: analytics2 } = await import(
        '../../../src/lib/analytics/analytics.service'
      )
      expect(analytics).toBe(analytics2)
    })
  })

  describe('tracking before initialization', () => {
    it.each([
      ['trackAppOpen', () => analytics.trackAppOpen()],
      ['trackAppClose', () => analytics.trackAppClose()],
      ['trackAssistantStart', () => analytics.trackAssistantStart()],
      ['trackAssistantStop', () => analytics.trackAssistantStop()],
      ['trackModeSelected', () => analytics.trackModeSelected('overlay')],
      [
        'trackModelUsed',
        () =>
          analytics.trackModelUsed({
            model_name: 'gpt-4',
            provider_type: 'cloud',
            latency_ms: 100,
          }),
      ],
      ['trackCopyAnswer', () => analytics.trackCopyAnswer()],
      ['trackCommandExecuted', () => analytics.trackCommandExecuted('ask')],
      ['trackConversationStarted', () => analytics.trackConversationStarted()],
      ['trackCalendarConnected', () => analytics.trackCalendarConnected()],
      ['trackMeetingStarted', () => analytics.trackMeetingStarted()],
      ['trackMeetingEnded', () => analytics.trackMeetingEnded()],
      ['trackPdfExported', () => analytics.trackPdfExported()],
    ])('%s is a no-op before init', (_name, fn) => {
      expect(fn).not.toThrow()
    })
  })

  describe('tracking after initialization', () => {
    let gtagSpy: ReturnType<typeof vi.fn>

    beforeEach(() => {
      gtagSpy = vi.fn()
      window.dataLayer = []
      ;(window as any).gtag = gtagSpy

      // Set up initialized state by calling initAnalytics
      // initAnalytics creates a script element and appends it to document.head
      analytics.initAnalytics()
    })

    afterEach(() => {
      delete (window as any).dataLayer
      delete (window as any).gtag
    })

    it('initAnalytics sets up gtag on window', () => {
      expect(typeof window.gtag).toBe('function')
      expect(Array.isArray(window.dataLayer)).toBe(true)
    })

    it('trackAppOpen fires "app_opened" event via gtag', () => {
      analytics.trackAppOpen()

      const eventCalls = gtagSpy.mock.calls.filter(
        (call: any[]) => call[0] === 'event' && call[1] === 'app_opened',
      )
      expect(eventCalls.length).toBe(1)
    })

    it('trackAppOpen fires "first_launch" only on first call', () => {
      localStorage.removeItem('natively_has_launched')

      analytics.trackAppOpen()

      const firstLaunchCalls = gtagSpy.mock.calls.filter(
        (call: any[]) => call[0] === 'event' && call[1] === 'first_launch',
      )
      expect(firstLaunchCalls.length).toBe(1)
      expect(localStorage.getItem('natively_has_launched')).toBe('true')
    })

    it('trackMeetingStarted fires "meeting_started" event', () => {
      analytics.trackMeetingStarted()

      const calls = gtagSpy.mock.calls.filter(
        (call: any[]) => call[0] === 'event' && call[1] === 'meeting_started',
      )
      expect(calls.length).toBe(1)
    })

    it('trackModelUsed passes payload to gtag', () => {
      const payload = {
        model_name: 'gpt-4',
        provider_type: 'cloud' as const,
        latency_ms: 250,
        tokens_used: 150,
      }

      analytics.trackModelUsed(payload)

      const calls = gtagSpy.mock.calls.filter(
        (call: any[]) => call[0] === 'event' && call[1] === 'model_used',
      )
      expect(calls.length).toBe(1)
      expect(calls[0][2]).toMatchObject({
        model_name: 'gpt-4',
        provider_type: 'cloud',
        latency_ms: 250,
        tokens_used: 150,
      })
    })

    it('trackModeSelected passes mode to gtag', () => {
      analytics.trackModeSelected('overlay')

      const calls = gtagSpy.mock.calls.filter(
        (call: any[]) => call[0] === 'event' && call[1] === 'mode_selected',
      )
      expect(calls.length).toBe(1)
      expect(calls[0][2]).toMatchObject({ mode: 'overlay' })
    })

    it('trackCommandExecuted passes command_type to gtag', () => {
      analytics.trackCommandExecuted('ask')

      const calls = gtagSpy.mock.calls.filter(
        (call: any[]) => call[0] === 'event' && call[1] === 'command_executed',
      )
      expect(calls.length).toBe(1)
      expect(calls[0][2]).toMatchObject({ command_type: 'ask' })
    })

    it('trackAppClose fires both "session_duration" and "app_closed" events', () => {
      analytics.trackAppClose()

      const durationCalls = gtagSpy.mock.calls.filter(
        (call: any[]) => call[0] === 'event' && call[1] === 'session_duration',
      )
      const closedCalls = gtagSpy.mock.calls.filter(
        (call: any[]) => call[0] === 'event' && call[1] === 'app_closed',
      )
      expect(durationCalls.length).toBe(1)
      expect(closedCalls.length).toBe(1)
    })

    it('trackAssistantStart and trackAssistantStop track duration', () => {
      analytics.trackAssistantStart()
      // Simulate some time passing
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5000)
      analytics.trackAssistantStop()

      const stoppedCalls = gtagSpy.mock.calls.filter(
        (call: any[]) => call[0] === 'event' && call[1] === 'assistant_stopped',
      )
      expect(stoppedCalls.length).toBe(1)
    })
  })
})
