import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../msw/server'
import {
  createTestEnv,
  destroyTestEnv,
  type TestEnv,
} from './__helpers__/test-env'
import './__helpers__/shared-mocks'

describe('Intelligence Engine Integration', () => {
  let env: TestEnv

  beforeEach(() => {
    env = createTestEnv()
    ;(global as any).__NATIVELY_TEST_USER_DATA__ = env.userDataPath
    server.listen()
    vi.clearAllMocks()
  })

  afterEach(() => {
    server.resetHandlers()
    delete (global as any).__NATIVELY_TEST_USER_DATA__
    destroyTestEnv(env)
  })

  describe('LLMHelper with real components', () => {
    it('processes chat requests through the full pipeline', async () => {
      const { LLMHelper } = await import('../../electron/LLMHelper')
      const llm = new LLMHelper(undefined, true)
      llm.setModel('ollama-llama3')

      const response = await llm.chatWithGemini('Hello, world!')
      expect(response).toBe('Mock response')
    })

    it('routes to OpenAI when model is gpt-*', async () => {
      const { LLMHelper } = await import('../../electron/LLMHelper')
      const llm = new LLMHelper(
        undefined,
        false,
        undefined,
        undefined,
        'fake-groq-key',
        'fake-openai-key',
      )
      llm.setModel('gpt-4o-mini')

      const response = await llm.chatWithGemini('Test')
      expect(response).toBe('Mock OpenAI response')
    })

    it('routes to Claude when model is claude-*', async () => {
      const { LLMHelper } = await import('../../electron/LLMHelper')
      const llm = new LLMHelper(
        undefined,
        false,
        undefined,
        undefined,
        'fake-groq-key',
        'fake-openai-key',
        'fake-claude-key',
      )
      llm.setModel('claude-sonnet-4-6')

      const response = await llm.chatWithGemini('Test')
      expect(response).toBe('Mock Claude response')
    })
  })

  describe('Provider fallback behavior', () => {
    it('handles missing API key gracefully', async () => {
      const { LLMHelper } = await import('../../electron/LLMHelper')
      const llm = new LLMHelper(undefined, false)

      const response = await llm.chatWithGemini('Test')
      expect(typeof response).toBe('string')
    })

    it('handles empty message gracefully', async () => {
      const { LLMHelper } = await import('../../electron/LLMHelper')
      const llm = new LLMHelper(undefined, true)
      llm.setModel('ollama-llama3')

      const response = await llm.chatWithGemini('')
      expect(typeof response).toBe('string')
    })
  })

  describe('Model version management integration', () => {
    it('initializes model version manager without errors', async () => {
      const { LLMHelper } = await import('../../electron/LLMHelper')
      const llm = new LLMHelper('fake-key', false)

      await expect(llm.initModelVersionManager()).resolves.not.toThrow()
    })

    it('changes model and routes to correct provider', async () => {
      const { LLMHelper } = await import('../../electron/LLMHelper')
      const llm = new LLMHelper(
        'fake-gemini-key',
        false,
        undefined,
        undefined,
        undefined,
        'fake-openai-key',
      )

      llm.setModel('gpt-4o-mini')
      const openaiResponse = await llm.chatWithGemini('Test')
      expect(openaiResponse).toBe('Mock OpenAI response')
    })
  })
})
