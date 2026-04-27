import { describe, expect, it } from 'vitest'
import {
  createMockCredentials,
  createMockMeeting,
  createMockSettings,
  createMockTranscript,
  mockCredentials,
  mockMeetings,
  mockSettings,
  mockTranscripts,
} from '../fixtures'

describe('fixtures', () => {
  describe('meetings', () => {
    it('createMockMeeting returns well-formed meeting object', () => {
      const meeting = createMockMeeting()

      expect(meeting).toHaveProperty('id')
      expect(meeting).toHaveProperty('title')
      expect(meeting).toHaveProperty('date')
      expect(meeting).toHaveProperty('duration')
      expect(meeting).toHaveProperty('summary')
      expect(typeof meeting.id).toBe('string')
      expect(typeof meeting.title).toBe('string')
      expect(typeof meeting.date).toBe('string')
      expect(typeof meeting.duration).toBe('string')
      expect(typeof meeting.summary).toBe('string')
    })

    it('createMockMeeting applies overrides correctly', () => {
      const meeting = createMockMeeting({
        id: 'custom-id',
        title: 'Custom Title',
      })

      expect(meeting.id).toBe('custom-id')
      expect(meeting.title).toBe('Custom Title')
      expect(meeting.date).toBe('2026-01-15T10:00:00Z') // default preserved
    })

    it('mockMeetings array has 3 sample meetings', () => {
      expect(Array.isArray(mockMeetings)).toBe(true)
      expect(mockMeetings).toHaveLength(3)
    })

    it('mockMeetings entries have required properties', () => {
      for (const meeting of mockMeetings) {
        expect(meeting).toHaveProperty('id')
        expect(meeting).toHaveProperty('title')
        expect(meeting).toHaveProperty('date')
        expect(meeting).toHaveProperty('duration')
        expect(meeting).toHaveProperty('summary')
      }
    })

    it('mockMeetings have unique ids and titles', () => {
      const ids = new Set(mockMeetings.map((m) => m.id))
      const titles = new Set(mockMeetings.map((m) => m.title))
      expect(ids.size).toBe(mockMeetings.length)
      expect(titles.size).toBe(mockMeetings.length)
    })
  })

  describe('transcripts', () => {
    it('createMockTranscript returns well-formed transcript object', () => {
      const transcript = createMockTranscript()

      expect(transcript).toHaveProperty('speaker')
      expect(transcript).toHaveProperty('text')
      expect(transcript).toHaveProperty('timestamp')
      expect(transcript).toHaveProperty('final')
      expect(typeof transcript.speaker).toBe('string')
      expect(typeof transcript.text).toBe('string')
      expect(typeof transcript.timestamp).toBe('number')
      expect(typeof transcript.final).toBe('boolean')
    })

    it('createMockTranscript applies overrides correctly', () => {
      const transcript = createMockTranscript({
        speaker: 'Speaker 99',
        text: 'Custom text',
        final: false,
      })

      expect(transcript.speaker).toBe('Speaker 99')
      expect(transcript.text).toBe('Custom text')
      expect(transcript.final).toBe(false)
      expect(transcript.timestamp).toBe(1234567890) // default preserved
    })

    it('mockTranscripts array has 10 sample entries', () => {
      expect(Array.isArray(mockTranscripts)).toBe(true)
      expect(mockTranscripts).toHaveLength(10)
    })

    it('mockTranscripts have valid timestamps', () => {
      for (const transcript of mockTranscripts) {
        expect(typeof transcript.timestamp).toBe('number')
        expect(transcript.timestamp).toBeGreaterThan(0)
      }
    })

    it('mockTranscripts contain multi-speaker dialogue', () => {
      const speakers = new Set(mockTranscripts.map((t) => t.speaker))
      expect(speakers.size).toBeGreaterThan(1)
    })
  })

  describe('settings', () => {
    it('mockSettings has all required properties', () => {
      const required = [
        'sttProvider',
        'llmProvider',
        'ollamaModel',
        'theme',
        'language',
        'groqFastTextMode',
      ]

      for (const prop of required) {
        expect(mockSettings).toHaveProperty(prop)
      }
    })

    it('mockSettings has type-correct values', () => {
      expect(typeof mockSettings.sttProvider).toBe('string')
      expect(typeof mockSettings.llmProvider).toBe('string')
      expect(typeof mockSettings.ollamaModel).toBe('string')
      expect(typeof mockSettings.theme).toBe('string')
      expect(typeof mockSettings.language).toBe('string')
      expect(typeof mockSettings.groqFastTextMode).toBe('boolean')
    })

    it('createMockSettings returns settings with defaults', () => {
      const settings = createMockSettings()

      expect(settings.sttProvider).toBe('google')
      expect(settings.llmProvider).toBe('ollama')
      expect(settings.ollamaModel).toBe('llama3')
      expect(settings.theme).toBe('system')
    })

    it('createMockSettings applies overrides', () => {
      const settings = createMockSettings({
        sttProvider: 'deepgram',
        llmProvider: 'gemini',
      })

      expect(settings.sttProvider).toBe('deepgram')
      expect(settings.llmProvider).toBe('gemini')
      expect(settings.ollamaModel).toBe('llama3') // default preserved
    })
  })

  describe('credentials', () => {
    it('mockCredentials has all required properties', () => {
      const required = [
        'hasGeminiKey',
        'hasGroqKey',
        'hasOpenaiKey',
        'hasClaudeKey',
        'hasNativelyKey',
        'sttProvider',
        'hasSttGroqKey',
        'hasSttOpenaiKey',
        'hasDeepgramKey',
        'hasElevenLabsKey',
        'hasAzureKey',
        'azureRegion',
        'hasIbmWatsonKey',
        'ibmWatsonRegion',
        'hasSonioxKey',
        'googleServiceAccountPath',
      ]

      for (const prop of required) {
        expect(mockCredentials).toHaveProperty(prop)
      }
    })

    it('mockCredentials has type-correct values', () => {
      expect(typeof mockCredentials.hasGeminiKey).toBe('boolean')
      expect(typeof mockCredentials.hasGroqKey).toBe('boolean')
      expect(typeof mockCredentials.sttProvider).toBe('string')
      expect(typeof mockCredentials.azureRegion).toBe('string')
      expect(mockCredentials.googleServiceAccountPath).toBeNull()
    })

    it('createMockCredentials returns credentials with defaults', () => {
      const credentials = createMockCredentials()

      expect(credentials.hasGeminiKey).toBe(false)
      expect(credentials.hasGroqKey).toBe(false)
      expect(credentials.sttProvider).toBe('google')
    })

    it('createMockCredentials applies overrides', () => {
      const credentials = createMockCredentials({
        hasGeminiKey: true,
        hasGroqKey: true,
        sttProvider: 'groq',
      })

      expect(credentials.hasGeminiKey).toBe(true)
      expect(credentials.hasGroqKey).toBe(true)
      expect(credentials.sttProvider).toBe('groq')
      expect(credentials.hasDeepgramKey).toBe(false) // default preserved
    })
  })
})
