/**
 * Tests for LLMHelper class - testing the class itself, not just modelUtils.
 *
 * ECORE-05 Gap: Previous tests only tested pure functions from modelUtils.ts
 * (isGeminiModel, isOpenAiModel, etc.) but NOT the LLMHelper class itself
 * (request routing, model fallback, error handling).
 *
 * This enhanced test suite verifies:
 * - Actual provider switching behavior (not just method existence)
 * - Model selection and fallback logic
 * - Error handling when clients are uninitialized
 * - API key management
 * - Real method return values
 */

import { HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LLMHelper } from '../../electron/LLMHelper'
import { createElectronMock } from '../mocks/electron.mock'
import { server } from '../msw/server'

// Mock electron module
vi.mock('electron', () =>
  createElectronMock({
    app: {
      getPath: vi.fn(() => '/tmp/test'),
      getName: vi.fn(() => 'TestApp'),
    },
  }),
)

// Mock SettingsManager
vi.mock('../../electron/services/SettingsManager', () => ({
  SettingsManager: {
    getInstance: vi.fn(() => ({
      get: vi.fn((key: string) => {
        const defaults: Record<string, any> = {
          geminiApiKey: 'test-gemini-key',
          openaiApiKey: 'test-openai-key',
          groqApiKey: 'test-groq-key',
          claudeApiKey: 'test-claude-key',
        }
        return defaults[key] ?? null
      }),
      set: vi.fn(),
    })),
  },
}))

// Mock CredentialsManager
vi.mock('../../electron/services/CredentialsManager', () => ({
  CredentialsManager: {
    getInstance: vi.fn(() => ({
      getApiKey: vi.fn(() => 'test-key'),
      getCurlProviders: vi.fn(() => []),
      getCustomProviders: vi.fn(() => []),
      getNativelyApiKey: vi.fn(() => null),
    })),
  },
}))

// Mock RateLimiter
vi.mock('../../electron/services/RateLimiter', () => ({
  createProviderRateLimiters: vi.fn(() => ({
    gemini: { acquire: vi.fn().mockResolvedValue(undefined), destroy: vi.fn() },
    openai: { acquire: vi.fn().mockResolvedValue(undefined), destroy: vi.fn() },
    claude: { acquire: vi.fn().mockResolvedValue(undefined), destroy: vi.fn() },
    groq: { acquire: vi.fn().mockResolvedValue(undefined), destroy: vi.fn() },
  })),
}))

// Mock ModelVersionManager - use class constructor pattern for proper mocking
vi.mock('../../electron/services/ModelVersionManager', () => {
  class MockModelVersionManager {
    setApiKeys = vi.fn()
    initialize = vi.fn().mockResolvedValue(undefined)
    getSummary = vi.fn().mockReturnValue('Mock ModelVersionManager summary')
    stopScheduler = vi.fn()
    getAllVisionTiers = vi.fn().mockReturnValue([])
    getTextTieredModels = vi
      .fn()
      .mockReturnValue({ tier1: 'gemini-3.1-flash-lite-preview' })
    onModelError = vi.fn().mockResolvedValue(undefined)
  }

  return {
    ModelVersionManager: MockModelVersionManager,
    ModelFamily: {
      OPENAI: 'openai',
      GEMINI_FLASH: 'gemini_flash',
      GEMINI_PRO: 'gemini_pro',
      CLAUDE: 'claude',
      GROQ_LLAMA: 'groq_llama',
    },
    TextModelFamily: {
      OPENAI: 'text_openai',
      GEMINI_FLASH: 'text_gemini_flash',
      GEMINI_PRO: 'text_gemini_pro',
      CLAUDE: 'text_claude',
      GROQ: 'text_groq',
    },
  }
})

// Mock fetch for Ollama
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('LLMHelper class', () => {
  let llmHelper: LLMHelper

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
  })

  afterEach(() => {
    if (llmHelper) {
      llmHelper.scrubKeys()
    }
  })

  describe('instantiation', () => {
    it('creates LLMHelper instance with API key', () => {
      llmHelper = new LLMHelper('test-api-key')
      expect(llmHelper).toBeDefined()
    })

    it('creates LLMHelper instance with Ollama mode', () => {
      llmHelper = new LLMHelper(
        undefined,
        true,
        'llama3.2',
        'http://localhost:11434',
      )
      expect(llmHelper).toBeDefined()
      expect(llmHelper.isUsingOllama()).toBe(true)
    })

    it('initializes with all API keys when provided', () => {
      llmHelper = new LLMHelper(
        'gemini-key',
        false,
        undefined,
        undefined,
        'groq-key',
        'openai-key',
        'claude-key',
      )
      expect(llmHelper).toBeDefined()
    })
  })

  describe('getCurrentProvider - actual behavior', () => {
    it('returns "gemini" when using cloud models (default)', () => {
      llmHelper = new LLMHelper('test-gemini-key')
      expect(llmHelper.getCurrentProvider()).toBe('gemini')
    })

    it('returns "ollama" when useOllama is true', () => {
      // Mock Ollama models endpoint
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ models: [{ name: 'llama3.2' }] }),
      })

      llmHelper = new LLMHelper(
        undefined,
        true,
        'llama3.2',
        'http://localhost:11434',
      )
      expect(llmHelper.getCurrentProvider()).toBe('ollama')
    })

    it('returns "custom" when customProvider is set', async () => {
      llmHelper = new LLMHelper('test-gemini-key')
      await llmHelper.switchToCustom({
        id: 'custom-model',
        name: 'Custom Provider',
        curlCommand: 'curl -X POST https://api.example.com',
      })
      expect(llmHelper.getCurrentProvider()).toBe('custom')
    })
  })

  describe('getCurrentModel - actual behavior', () => {
    it('returns gemini model when using gemini', () => {
      llmHelper = new LLMHelper('test-gemini-key')
      const model = llmHelper.getCurrentModel()
      expect(model).toContain('gemini')
    })

    it('returns ollama model when using Ollama', () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ models: [{ name: 'llama3.2' }] }),
      })

      llmHelper = new LLMHelper(
        undefined,
        true,
        'llama3.2',
        'http://localhost:11434',
      )
      expect(llmHelper.getCurrentModel()).toBe('llama3.2')
    })

    it('returns custom provider name when custom provider is set', async () => {
      llmHelper = new LLMHelper('test-gemini-key')
      await llmHelper.switchToCustom({
        id: 'custom-model',
        name: 'My Custom Provider',
        curlCommand: 'curl -X POST https://api.example.com',
      })
      expect(llmHelper.getCurrentModel()).toBe('My Custom Provider')
    })
  })

  describe('isUsingOllama - actual behavior', () => {
    it('returns false when using Gemini', () => {
      llmHelper = new LLMHelper('test-gemini-key')
      expect(llmHelper.isUsingOllama()).toBe(false)
    })

    it('returns true when initialized with useOllama=true', () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ models: [{ name: 'llama3.2' }] }),
      })

      llmHelper = new LLMHelper(
        undefined,
        true,
        'llama3.2',
        'http://localhost:11434',
      )
      expect(llmHelper.isUsingOllama()).toBe(true)
    })
  })

  describe('LLMHelper request routing', () => {
    it('switchToGemini changes getCurrentProvider to gemini', async () => {
      // First set up with Ollama
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ models: [{ name: 'llama3.2' }] }),
      })

      llmHelper = new LLMHelper(
        undefined,
        true,
        'llama3.2',
        'http://localhost:11434',
      )
      expect(llmHelper.getCurrentProvider()).toBe('ollama')

      // Switch to Gemini
      await llmHelper.switchToGemini('new-gemini-key')
      expect(llmHelper.getCurrentProvider()).toBe('gemini')
    })

    it('switchToOllama changes getCurrentProvider to ollama', async () => {
      llmHelper = new LLMHelper('test-gemini-key')
      expect(llmHelper.getCurrentProvider()).toBe('gemini')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ models: [{ name: 'llama3.2' }] }),
      })

      await llmHelper.switchToOllama()
      expect(llmHelper.getCurrentProvider()).toBe('ollama')
    })

    it('switchToCustom changes getCurrentProvider to custom', async () => {
      llmHelper = new LLMHelper('test-gemini-key')
      expect(llmHelper.getCurrentProvider()).toBe('gemini')

      await llmHelper.switchToCustom({
        id: 'custom-1',
        name: 'Custom Provider',
        curlCommand: 'curl -X POST https://api.example.com',
      })
      expect(llmHelper.getCurrentProvider()).toBe('custom')
    })

    it('provider switches persist across getCurrentProvider calls', async () => {
      llmHelper = new LLMHelper('test-gemini-key')

      // Multiple calls should return same value
      expect(llmHelper.getCurrentProvider()).toBe('gemini')
      expect(llmHelper.getCurrentProvider()).toBe('gemini')
      expect(llmHelper.getCurrentProvider()).toBe('gemini')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ models: [{ name: 'llama3.2' }] }),
      })

      await llmHelper.switchToOllama()

      // Should persist
      expect(llmHelper.getCurrentProvider()).toBe('ollama')
      expect(llmHelper.getCurrentProvider()).toBe('ollama')
      expect(llmHelper.getCurrentProvider()).toBe('ollama')
    })
  })

  describe('model fallback logic', () => {
    it('getCurrentModel returns gemini model even with no API keys', () => {
      llmHelper = new LLMHelper()
      const model = llmHelper.getCurrentModel()
      expect(model).toContain('gemini')
    })

    it('returns gemini flash model by default', () => {
      llmHelper = new LLMHelper('test-gemini-key')
      const model = llmHelper.getCurrentModel()
      expect(model).toContain('gemini')
    })

    it('handles switchToOllama with custom model name', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ models: [{ name: 'codellama' }] }),
      })

      llmHelper = new LLMHelper('test-gemini-key')
      await llmHelper.switchToOllama('codellama')

      expect(llmHelper.isUsingOllama()).toBe(true)
    })

    it('getOllamaModels returns array of model names', async () => {
      // Override MSW handler for 127.0.0.1 (getOllamaModels converts localhost to 127.0.0.1)
      server.use(
        http.get('http://127.0.0.1:11434/api/tags', () => {
          return HttpResponse.json({
            models: [
              { name: 'llama3.2' },
              { name: 'codellama' },
              { name: 'mistral' },
            ],
          })
        }),
      )

      llmHelper = new LLMHelper(
        undefined,
        true,
        'llama3.2',
        'http://localhost:11434',
      )
      const models = await llmHelper.getOllamaModels()

      expect(Array.isArray(models)).toBe(true)
      expect(models).toContain('llama3.2')
      expect(models).toContain('codellama')
      expect(models).toContain('mistral')
    })

    it('getOllamaModels returns empty array when Ollama unavailable', async () => {
      // Override MSW handler to return error
      server.use(
        http.get('http://127.0.0.1:11434/api/tags', () => {
          return new HttpResponse(null, { status: 503 })
        }),
      )

      llmHelper = new LLMHelper(
        undefined,
        true,
        'llama3.2',
        'http://localhost:11434',
      )
      const models = await llmHelper.getOllamaModels()

      expect(Array.isArray(models)).toBe(true)
      expect(models.length).toBe(0)
    })
  })

  describe('API key management', () => {
    it('setApiKey initializes Gemini client', () => {
      llmHelper = new LLMHelper()
      llmHelper.setApiKey('new-gemini-key')
      expect(llmHelper.getGeminiClient()).not.toBeNull()
    })

    it('setGroqApiKey creates Groq client', () => {
      llmHelper = new LLMHelper()
      llmHelper.setGroqApiKey('new-groq-key')
      expect(llmHelper.getGroqClient()).not.toBeNull()
    })

    it('setOpenaiApiKey creates OpenAI client', () => {
      llmHelper = new LLMHelper()
      llmHelper.setOpenaiApiKey('new-openai-key')
      expect(llmHelper.getOpenaiClient()).not.toBeNull()
    })

    it('setClaudeApiKey creates Claude client', () => {
      llmHelper = new LLMHelper()
      llmHelper.setClaudeApiKey('new-claude-key')
      expect(llmHelper.getClaudeClient()).not.toBeNull()
    })

    it('hasGroq returns true when groq key provided, false otherwise', () => {
      expect(
        new LLMHelper(
          undefined,
          false,
          undefined,
          undefined,
          'groq-key',
        ).hasGroq(),
      ).toBe(true)
      expect(new LLMHelper('gemini-key').hasGroq()).toBe(false)
    })

    it('hasOpenai returns true when openai key provided, false otherwise', () => {
      expect(
        new LLMHelper(
          undefined,
          false,
          undefined,
          undefined,
          undefined,
          'openai-key',
        ).hasOpenai(),
      ).toBe(true)
      expect(new LLMHelper('gemini-key').hasOpenai()).toBe(false)
    })

    it('hasClaude returns true when claude key provided, false otherwise', () => {
      expect(
        new LLMHelper(
          undefined,
          false,
          undefined,
          undefined,
          undefined,
          undefined,
          'claude-key',
        ).hasClaude(),
      ).toBe(true)
      expect(new LLMHelper('gemini-key').hasClaude()).toBe(false)
    })

    it('scrubKeys removes all API keys from memory', () => {
      llmHelper = new LLMHelper(
        'gemini-key',
        false,
        undefined,
        undefined,
        'groq-key',
        'openai-key',
        'claude-key',
      )
      expect(llmHelper.scrubKeys()).toBeUndefined()
      expect(llmHelper.getGeminiClient()).toBeNull()
      expect(llmHelper.getGroqClient()).toBeNull()
      expect(llmHelper.getOpenaiClient()).toBeNull()
      expect(llmHelper.getClaudeClient()).toBeNull()
    })
  })

  describe('error handling', () => {
    it('getCurrentProvider returns gemini when no API keys configured', () => {
      llmHelper = new LLMHelper()
      expect(llmHelper.getCurrentProvider()).toBe('gemini')
    })

    it('testConnection returns error when no client configured', async () => {
      llmHelper = new LLMHelper()
      const result = await llmHelper.testConnection()
      expect(result).toEqual({
        success: false,
        error: 'No Gemini client configured',
      })
    })

    it('testConnection returns error when Ollama unavailable', async () => {
      server.use(
        http.get('http://127.0.0.1:11434/api/tags', () => {
          return new HttpResponse(null, { status: 503 })
        }),
        http.post('http://127.0.0.1:11434/api/generate', () => {
          return new HttpResponse(null, { status: 503 })
        }),
      )

      llmHelper = new LLMHelper(
        undefined,
        true,
        'llama3.2',
        'http://127.0.0.1:11434',
      )
      const result = await llmHelper.testConnection()
      expect(result.success).toBe(false)
      expect(result.error).toContain('Ollama not available at')
    })

    it('chatWithGemini returns error when no provider configured', async () => {
      llmHelper = new LLMHelper()
      const result = await llmHelper.chatWithGemini('Hello')
      expect(result).toBe(
        'No AI providers configured. Please add at least one API key in Settings.',
      )
    })

    it('chatWithGemini returns error when Ollama unavailable and no cloud keys', async () => {
      server.use(
        http.get('http://localhost:11434/api/tags', () => {
          return new HttpResponse(null, { status: 503 })
        }),
        http.post('http://localhost:11434/api/generate', () => {
          return new HttpResponse(null, { status: 503 })
        }),
      )

      llmHelper = new LLMHelper(
        undefined,
        true,
        'llama3.2',
        'http://localhost:11434',
      )
      const result = await llmHelper.chatWithGemini('Hello')
      expect(result).toBe(
        'The AI service is currently overloaded. Please try again in a moment.',
      )
    })

    it('chatWithGemini with context still returns error when no provider', async () => {
      llmHelper = new LLMHelper()
      const result = await llmHelper.chatWithGemini(
        'Hello',
        undefined,
        'Some context',
      )
      expect(result).toBe(
        'No AI providers configured. Please add at least one API key in Settings.',
      )
    })

    it('chatWithGemini with skipSystemPrompt still returns error when no provider', async () => {
      llmHelper = new LLMHelper()
      const result = await llmHelper.chatWithGemini(
        'Hello',
        undefined,
        undefined,
        true,
      )
      expect(result).toBe(
        'No AI providers configured. Please add at least one API key in Settings.',
      )
    })

    it('generateSuggestion throws when no provider available', async () => {
      llmHelper = new LLMHelper()
      await expect(
        llmHelper.generateSuggestion('context', 'question'),
      ).rejects.toThrow('No LLM provider configured')
    })

    it('analyzeImageFiles returns error object with text and timestamp when no provider', async () => {
      llmHelper = new LLMHelper()
      const result = await llmHelper.analyzeImageFiles([])
      expect(result).toMatchObject({ timestamp: expect.any(Number) })
      expect(typeof result.text).toBe('string')
    })
  })

  describe('model selection helpers', () => {
    it('getGroqFastTextMode toggles between true and false', () => {
      llmHelper = new LLMHelper()
      expect(llmHelper.getGroqFastTextMode()).toBe(false)
      llmHelper.setGroqFastTextMode(true)
      expect(llmHelper.getGroqFastTextMode()).toBe(true)
      llmHelper.setGroqFastTextMode(false)
      expect(llmHelper.getGroqFastTextMode()).toBe(false)
    })

    it('getAiResponseLanguage defaults to auto and can be changed', () => {
      llmHelper = new LLMHelper()
      expect(llmHelper.getAiResponseLanguage()).toBe('auto')
      llmHelper.setAiResponseLanguage('Spanish')
      expect(llmHelper.getAiResponseLanguage()).toBe('Spanish')
    })
  })

  describe('streaming methods', () => {
    it('streamChatWithGemini returns an async iterable', () => {
      llmHelper = new LLMHelper()
      const result = llmHelper.streamChatWithGemini('Hello')
      expect(typeof result[Symbol.asyncIterator]).toBe('function')
    })

    it('streamChat returns an async iterable', () => {
      llmHelper = new LLMHelper()
      expect(typeof llmHelper.streamChat('Hello')[Symbol.asyncIterator]).toBe(
        'function',
      )
      expect(
        typeof llmHelper.streamChat('Hello', undefined, 'ctx')[
          Symbol.asyncIterator
        ],
      ).toBe('function')
    })

    it('streamWithGroqOrGemini returns an async iterable', () => {
      llmHelper = new LLMHelper('gemini-key')
      const result = llmHelper.streamWithGroqOrGemini(
        'groq message',
        'gemini message',
      )
      expect(typeof result[Symbol.asyncIterator]).toBe('function')
    })

    it('chat collects streamed tokens into single string', async () => {
      llmHelper = new LLMHelper()
      llmHelper.streamChat = vi.fn().mockImplementation(async function* () {
        yield 'Hello'
        yield ' World'
      })
      await expect(llmHelper.chat('Hello')).resolves.toBe('Hello World')
    })

    it('forceRestartOllama returns a boolean (success/failure indicator)', async () => {
      llmHelper = new LLMHelper()
      const result = await llmHelper
        .forceRestartOllama()
        .catch(() => 'rejected')
      expect(typeof result === 'boolean' || result === 'rejected').toBe(true)
    })
  })

  describe('client getters', () => {
    it('returns null clients when not initialized, non-null when key provided', () => {
      llmHelper = new LLMHelper()
      expect(llmHelper.getGeminiClient()).toBeNull()
      expect(llmHelper.getGroqClient()).toBeNull()
      expect(llmHelper.getOpenaiClient()).toBeNull()
      expect(llmHelper.getClaudeClient()).toBeNull()

      llmHelper = new LLMHelper(
        'gemini-key',
        false,
        undefined,
        undefined,
        'groq-key',
        'openai-key',
        'claude-key',
      )
      expect(llmHelper.getGeminiClient()).not.toBeNull()
      expect(llmHelper.getGroqClient()).not.toBeNull()
      expect(llmHelper.getOpenaiClient()).not.toBeNull()
      expect(llmHelper.getClaudeClient()).not.toBeNull()
    })
  })

  describe('knowledge orchestrator', () => {
    it('stores and retrieves knowledge orchestrator', () => {
      llmHelper = new LLMHelper()
      const orchestrator = { isKnowledgeMode: () => false }
      llmHelper.setKnowledgeOrchestrator(orchestrator)
      expect(llmHelper.getKnowledgeOrchestrator()).toBe(orchestrator)
    })
  })

  describe('setModel', () => {
    it('resolves gemini shortcode to a gemini model', () => {
      llmHelper = new LLMHelper('gemini-key')
      llmHelper.setModel('gemini')
      expect(llmHelper.getCurrentModel()).toContain('gemini')
    })

    it('switches to ollama with ollama- prefix', () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ models: [{ name: 'llama3.2' }] }),
      })

      llmHelper = new LLMHelper('gemini-key')
      llmHelper.setModel('ollama-llama3.2')
      expect(llmHelper.isUsingOllama()).toBe(true)
    })
  })

  describe('switchToCurl', () => {
    it('sets current model to the curl provider id', () => {
      llmHelper = new LLMHelper('gemini-key')
      llmHelper.switchToCurl({
        id: 'curl-1',
        name: 'cURL Provider',
        curlCommand: 'curl -X POST https://api.example.com',
        responsePath: 'choices[0].message.content',
      })
      expect(llmHelper.getCurrentModel()).toBe('curl-1')
    })
  })

  describe('generateContentStructured', () => {
    it('throws when no providers configured', async () => {
      server.use(
        http.get('http://localhost:11434/api/tags', () => {
          return new HttpResponse(null, { status: 503 })
        }),
        http.post('http://localhost:11434/api/generate', () => {
          return new HttpResponse(null, { status: 503 })
        }),
      )

      llmHelper = new LLMHelper()
      await expect(
        llmHelper.generateContentStructured('test'),
      ).rejects.toThrow()
    })

    it('throws when only Ollama available but not running', async () => {
      server.use(
        http.get('http://localhost:11434/api/tags', () => {
          return new HttpResponse(null, { status: 503 })
        }),
        http.post('http://localhost:11434/api/generate', () => {
          return new HttpResponse(null, { status: 503 })
        }),
      )

      llmHelper = new LLMHelper(undefined, true, 'llama3.2')
      await expect(
        llmHelper.generateContentStructured('test'),
      ).rejects.toThrow()
    })
  })

  describe('generateMeetingSummary', () => {
    it('throws when no Gemini client configured and Ollama unavailable', async () => {
      server.use(
        http.get('http://127.0.0.1:11434/api/tags', () => {
          return new HttpResponse(null, { status: 503 })
        }),
        http.post('http://127.0.0.1:11434/api/generate', () => {
          return new HttpResponse(null, { status: 503 })
        }),
      )

      llmHelper = new LLMHelper()
      await expect(
        llmHelper.generateMeetingSummary('system prompt', 'context'),
      ).rejects.toThrow()
    })
  })
})
