import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../msw/server'
import {
  createTestEnv,
  destroyTestEnv,
  type TestEnv,
} from './__helpers__/test-env'
import './__helpers__/shared-mocks'

import { LLMHelper } from '../../electron/LLMHelper'

describe('LLM Pipeline Integration', () => {
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

  describe('Provider routing', () => {
    it('routes to OpenAI when model is gpt-*', async () => {
      const helper = new LLMHelper(
        undefined,
        false,
        undefined,
        undefined,
        undefined,
        'fake-openai-key',
      )
      helper.setModel('gpt-5.4')

      const result = await helper.chatWithGemini('Hello')
      expect(result).toBe('Mock OpenAI response')
    })

    it('routes to Claude when model is claude-*', async () => {
      const helper = new LLMHelper(
        undefined,
        false,
        undefined,
        undefined,
        undefined,
        undefined,
        'fake-claude-key',
      )
      helper.setModel('claude-sonnet-4-6')

      const result = await helper.chatWithGemini('Hello')
      expect(result).toBe('Mock Claude response')
    })

    it('routes to Gemini when no specific provider model is set', async () => {
      const helper = new LLMHelper('fake-gemini-key', false)

      const result = await helper.chatWithGemini('Hello')
      expect(result).toBe('Mock Gemini response')
    })
  })
})
