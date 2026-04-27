import { describe, expect, it } from 'vitest'
import {
  prettifyModelId,
  STANDARD_CLOUD_MODELS,
} from '../../../src/utils/modelUtils'
import { createMockCredentials } from '../../fixtures'

describe('modelUtils', () => {
  describe('prettifyModelId', () => {
    it('should return empty string for empty input', () => {
      expect(prettifyModelId('')).toBe('')
    })

    it('should replace hyphens with spaces', () => {
      expect(prettifyModelId('gemini-3.1-flash')).toBe('Gemini 3.1 Flash')
    })

    it('should replace underscores with spaces', () => {
      expect(prettifyModelId('gpt_5_4')).toBe('Gpt 5 4')
    })

    it('should capitalize first letter of each word', () => {
      expect(prettifyModelId('llama-3.3-70b-versatile')).toBe(
        'Llama 3.3 70b Versatile',
      )
    })

    it('should handle mixed hyphens and underscores', () => {
      expect(prettifyModelId('claude-sonnet_4-6')).toBe('Claude Sonnet 4 6')
    })
  })

  describe('STANDARD_CLOUD_MODELS', () => {
    it('should contain gemini provider', () => {
      expect(STANDARD_CLOUD_MODELS).toHaveProperty('gemini')
    })

    it('should contain openai provider', () => {
      expect(STANDARD_CLOUD_MODELS).toHaveProperty('openai')
    })

    it('should contain claude provider', () => {
      expect(STANDARD_CLOUD_MODELS).toHaveProperty('claude')
    })

    it('should contain groq provider', () => {
      expect(STANDARD_CLOUD_MODELS).toHaveProperty('groq')
    })

    it('should have correct hasKeyCheck for gemini', () => {
      const gemini = STANDARD_CLOUD_MODELS.gemini
      expect(
        gemini.hasKeyCheck(createMockCredentials({ hasGeminiKey: true })),
      ).toBe(true)
      expect(
        gemini.hasKeyCheck(createMockCredentials({ hasGeminiKey: false })),
      ).toBe(false)
      expect(gemini.hasKeyCheck(null)).toBe(false)
    })

    it('should have correct hasKeyCheck for openai', () => {
      const openai = STANDARD_CLOUD_MODELS.openai
      expect(
        openai.hasKeyCheck(createMockCredentials({ hasOpenaiKey: true })),
      ).toBe(true)
      expect(
        openai.hasKeyCheck(createMockCredentials({ hasOpenaiKey: false })),
      ).toBe(false)
    })

    it('should have correct hasKeyCheck for claude', () => {
      const claude = STANDARD_CLOUD_MODELS.claude
      expect(
        claude.hasKeyCheck(createMockCredentials({ hasClaudeKey: true })),
      ).toBe(true)
      expect(
        claude.hasKeyCheck(createMockCredentials({ hasClaudeKey: false })),
      ).toBe(false)
    })

    it('should have correct hasKeyCheck for groq', () => {
      const groq = STANDARD_CLOUD_MODELS.groq
      expect(
        groq.hasKeyCheck(createMockCredentials({ hasGroqKey: true })),
      ).toBe(true)
      expect(
        groq.hasKeyCheck(createMockCredentials({ hasGroqKey: false })),
      ).toBe(false)
    })

    it('should have correct pmKey for each provider', () => {
      expect(STANDARD_CLOUD_MODELS.gemini.pmKey).toBe('geminiPreferredModel')
      expect(STANDARD_CLOUD_MODELS.openai.pmKey).toBe('openaiPreferredModel')
      expect(STANDARD_CLOUD_MODELS.claude.pmKey).toBe('claudePreferredModel')
      expect(STANDARD_CLOUD_MODELS.groq.pmKey).toBe('groqPreferredModel')
    })

    it('should have arrays for ids, names, and descs', () => {
      Object.values(STANDARD_CLOUD_MODELS).forEach((provider) => {
        expect(Array.isArray(provider.ids)).toBe(true)
        expect(Array.isArray(provider.names)).toBe(true)
        expect(Array.isArray(provider.descs)).toBe(true)
        expect(provider.ids.length).toBe(provider.names.length)
        expect(provider.ids.length).toBe(provider.descs.length)
      })
    })
  })
})
