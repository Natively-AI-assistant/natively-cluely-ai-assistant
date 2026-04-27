import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClarifyLLM } from '../../../electron/llm/ClarifyLLM'
import { CLARIFY_MODE_PROMPT } from '../../../electron/llm/prompts'
import { createMockLlmHelperForTests } from '../../mocks/llm/mockLlmProviders'

describe('ClarifyLLM', () => {
  let mockHelper: ReturnType<typeof createMockLlmHelperForTests>['mockHelper']
  let mockStreamChat: ReturnType<
    typeof createMockLlmHelperForTests
  >['mockStreamChat']
  let clarifyLLM: ClarifyLLM

  beforeEach(() => {
    const mock = createMockLlmHelperForTests({
      streamChunks: ['Can you', ' tell me', ' more?'],
    })
    mockHelper = mock.mockHelper
    mockStreamChat = mock.mockStreamChat
    clarifyLLM = new ClarifyLLM(mockHelper as any)
  })

  describe('generate', () => {
    it('returns concatenated stream chunks', async () => {
      const result = await clarifyLLM.generate('What is polymorphism?')
      expect(result).toBe('Can you tell me more?')
    })

    it('passes CLARIFY_MODE_PROMPT as system prompt', async () => {
      await clarifyLLM.generate('Explain inheritance')
      expect(mockStreamChat).toHaveBeenCalledWith(
        'Explain inheritance',
        undefined,
        undefined,
        CLARIFY_MODE_PROMPT,
      )
    })

    it('returns empty string for blank input', async () => {
      const result = await clarifyLLM.generate('')
      expect(result).toBe('')
      expect(mockStreamChat).not.toHaveBeenCalled()
    })

    it('returns empty string for whitespace-only input', async () => {
      const result = await clarifyLLM.generate('   \t\n  ')
      expect(result).toBe('')
      expect(mockStreamChat).not.toHaveBeenCalled()
    })

    it('returns empty string on stream error', async () => {
      mockStreamChat.mockImplementation(async function* () {
        throw new Error('API failure')
      })
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const result = await clarifyLLM.generate('some context')
      expect(result).toBe('')
      expect(consoleSpy).toHaveBeenCalledWith(
        '[ClarifyLLM] Generation failed:',
        expect.any(Error),
      )
      consoleSpy.mockRestore()
    })
  })

  describe('generateStream', () => {
    it('yields chunks from the stream', async () => {
      const chunks: string[] = []
      for await (const chunk of clarifyLLM.generateStream(
        'Tell me about OOP',
      )) {
        chunks.push(chunk)
      }
      expect(chunks).toEqual(['Can you', ' tell me', ' more?'])
    })

    it('passes CLARIFY_MODE_PROMPT as system prompt', async () => {
      const chunks: string[] = []
      for await (const chunk of clarifyLLM.generateStream('context')) {
        chunks.push(chunk)
      }
      expect(mockStreamChat).toHaveBeenCalledWith(
        'context',
        undefined,
        undefined,
        CLARIFY_MODE_PROMPT,
      )
    })

    it('returns immediately for blank input', async () => {
      const chunks: string[] = []
      for await (const chunk of clarifyLLM.generateStream('')) {
        chunks.push(chunk)
      }
      expect(chunks).toHaveLength(0)
      expect(mockStreamChat).not.toHaveBeenCalled()
    })

    it('yields nothing on stream error', async () => {
      mockStreamChat.mockImplementation(async function* () {
        throw new Error('stream error')
      })
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const chunks: string[] = []
      for await (const chunk of clarifyLLM.generateStream('some input')) {
        chunks.push(chunk)
      }
      expect(chunks).toHaveLength(0)
      consoleSpy.mockRestore()
    })
  })
})
