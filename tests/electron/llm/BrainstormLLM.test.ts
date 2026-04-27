import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrainstormLLM } from '../../../electron/llm/BrainstormLLM'
import { BRAINSTORM_MODE_PROMPT } from '../../../electron/llm/prompts'
import { createMockLlmHelperForTests } from '../../mocks/llm/mockLlmProviders'

describe('BrainstormLLM', () => {
  let mockHelper: ReturnType<typeof createMockLlmHelperForTests>['mockHelper']
  let mockStreamChat: ReturnType<
    typeof createMockLlmHelperForTests
  >['mockStreamChat']
  let brainstormLLM: BrainstormLLM

  beforeEach(() => {
    const mock = createMockLlmHelperForTests({
      streamChunks: [
        'First approach',
        ': use brute force',
        '. Second approach',
        ': use DP.',
      ],
    })
    mockHelper = mock.mockHelper
    mockStreamChat = mock.mockStreamChat
    brainstormLLM = new BrainstormLLM(mockHelper as any)
  })

  describe('generateStream', () => {
    it('yields chunks from the stream', async () => {
      const chunks: string[] = []
      for await (const chunk of brainstormLLM.generateStream(
        'Solve two sum problem',
      )) {
        chunks.push(chunk)
      }
      expect(chunks).toEqual([
        'First approach',
        ': use brute force',
        '. Second approach',
        ': use DP.',
      ])
      expect(chunks.join('')).toBe(
        'First approach: use brute force. Second approach: use DP.',
      )
    })

    it('passes BRAINSTORM_MODE_PROMPT as system prompt', async () => {
      const chunks: string[] = []
      for await (const chunk of brainstormLLM.generateStream('context')) {
        chunks.push(chunk)
      }
      expect(mockStreamChat).toHaveBeenCalledWith(
        'context',
        undefined,
        undefined,
        BRAINSTORM_MODE_PROMPT,
      )
    })

    it('passes image paths to streamChat', async () => {
      const chunks: string[] = []
      for await (const chunk of brainstormLLM.generateStream('context', [
        '/img1.png',
        '/img2.png',
      ])) {
        chunks.push(chunk)
      }
      expect(mockStreamChat).toHaveBeenCalledWith(
        'context',
        ['/img1.png', '/img2.png'],
        undefined,
        BRAINSTORM_MODE_PROMPT,
      )
    })

    it('returns immediately for empty input with no images', async () => {
      const chunks: string[] = []
      for await (const chunk of brainstormLLM.generateStream('')) {
        chunks.push(chunk)
      }
      expect(chunks).toHaveLength(0)
      expect(mockStreamChat).not.toHaveBeenCalled()
    })

    it('returns immediately for whitespace-only input with no images', async () => {
      const chunks: string[] = []
      for await (const chunk of brainstormLLM.generateStream('   ')) {
        chunks.push(chunk)
      }
      expect(chunks).toHaveLength(0)
    })

    it('proceeds when context is empty but images are provided', async () => {
      const chunks: string[] = []
      for await (const chunk of brainstormLLM.generateStream('', [
        '/screenshot.png',
      ])) {
        chunks.push(chunk)
      }
      expect(chunks.length).toBeGreaterThan(0)
      expect(mockStreamChat).toHaveBeenCalled()
    })

    it('yields fallback message on stream error', async () => {
      mockStreamChat.mockImplementation(async function* () {
        throw new Error('API failure')
      })
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const chunks: string[] = []
      for await (const chunk of brainstormLLM.generateStream('some context')) {
        chunks.push(chunk)
      }
      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toContain("I couldn't generate brainstorm approaches")
      expect(consoleSpy).toHaveBeenCalledWith(
        '[BrainstormLLM] Stream failed:',
        expect.any(Error),
      )
      consoleSpy.mockRestore()
    })
  })
})
