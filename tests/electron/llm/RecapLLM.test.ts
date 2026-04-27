import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UNIVERSAL_RECAP_PROMPT } from '../../../electron/llm/prompts'
import { RecapLLM } from '../../../electron/llm/RecapLLM'
import { createMockLlmHelperForTests } from '../../mocks/llm/mockLlmProviders'

describe('RecapLLM', () => {
  let mockHelper: ReturnType<typeof createMockLlmHelperForTests>['mockHelper']
  let mockStreamChat: ReturnType<
    typeof createMockLlmHelperForTests
  >['mockStreamChat']
  let recapLLM: RecapLLM

  beforeEach(() => {
    const mock = createMockLlmHelperForTests({
      streamChunks: [
        'Discussed',
        ' algorithms',
        ' and',
        ' data structures',
        ' in depth',
        ' with examples.',
      ],
    })
    mockHelper = mock.mockHelper
    mockStreamChat = mock.mockStreamChat
    recapLLM = new RecapLLM(mockHelper as any)
  })

  describe('generate', () => {
    it('returns concatenated and clamped stream chunks', async () => {
      const result = await recapLLM.generate('Long conversation transcript')
      // clampRecapResponse limits to 5 non-empty lines
      expect(result).toBeTruthy()
      expect(result.split('\n').length).toBeLessThanOrEqual(5)
    })

    it('passes UNIVERSAL_RECAP_PROMPT as system prompt', async () => {
      await recapLLM.generate('some transcript')
      expect(mockStreamChat).toHaveBeenCalledWith(
        'some transcript',
        undefined,
        undefined,
        UNIVERSAL_RECAP_PROMPT,
      )
    })

    it('returns empty string for blank input', async () => {
      const result = await recapLLM.generate('')
      expect(result).toBe('')
      expect(mockStreamChat).not.toHaveBeenCalled()
    })

    it('returns empty string for whitespace-only input', async () => {
      const result = await recapLLM.generate('   \t  ')
      expect(result).toBe('')
      expect(mockStreamChat).not.toHaveBeenCalled()
    })

    it('returns empty string on stream error', async () => {
      mockStreamChat.mockImplementation(async function* () {
        throw new Error('API failure')
      })
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const result = await recapLLM.generate('some transcript')
      expect(result).toBe('')
      expect(consoleSpy).toHaveBeenCalledWith(
        '[RecapLLM] Generation failed:',
        expect.any(Error),
      )
      consoleSpy.mockRestore()
    })

    it('filters out empty lines from response', async () => {
      const mock = createMockLlmHelperForTests({
        streamChunks: ['Line 1', '\n\n', 'Line 2', '\n\n', 'Line 3'],
      })
      const llm = new RecapLLM(mock.mockHelper as any)
      const result = await llm.generate('transcript')
      const lines = result.split('\n')
      for (const line of lines) {
        expect(line.trim()).not.toBe('')
      }
    })

    it('limits response to 5 lines max', async () => {
      const mock = createMockLlmHelperForTests({
        streamChunks: [
          'Line 1',
          '\nLine 2',
          '\nLine 3',
          '\nLine 4',
          '\nLine 5',
          '\nLine 6',
          '\nLine 7',
        ],
      })
      const llm = new RecapLLM(mock.mockHelper as any)
      const result = await llm.generate('transcript')
      const lines = result.split('\n').filter((l) => l.trim())
      expect(lines.length).toBeLessThanOrEqual(5)
    })
  })

  describe('generateStream', () => {
    it('yields chunks from the stream', async () => {
      const chunks: string[] = []
      for await (const chunk of recapLLM.generateStream('meeting transcript')) {
        chunks.push(chunk)
      }
      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks.join('')).toContain('Discussed')
    })

    it('passes UNIVERSAL_RECAP_PROMPT as system prompt', async () => {
      const chunks: string[] = []
      for await (const chunk of recapLLM.generateStream('context')) {
        chunks.push(chunk)
      }
      expect(mockStreamChat).toHaveBeenCalledWith(
        'context',
        undefined,
        undefined,
        UNIVERSAL_RECAP_PROMPT,
      )
    })

    it('returns immediately for blank input', async () => {
      const chunks: string[] = []
      for await (const chunk of recapLLM.generateStream('')) {
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
      for await (const chunk of recapLLM.generateStream('some input')) {
        chunks.push(chunk)
      }
      expect(chunks).toHaveLength(0)
      consoleSpy.mockRestore()
    })
  })
})
