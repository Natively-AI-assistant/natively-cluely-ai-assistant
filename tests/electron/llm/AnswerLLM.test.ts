import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AnswerLLM } from '../../../electron/llm/AnswerLLM'
import { createMockLlmHelperForTests } from '../../mocks/llm/mockLlmProviders'

describe('AnswerLLM', () => {
    let answerLLM: AnswerLLM
    let mockChat: ReturnType<typeof vi.fn>
    let mockStreamChat: ReturnType<typeof vi.fn>
    let mockHelper: any

    beforeEach(() => {
        const mocks = createMockLlmHelperForTests({
            streamChunks: ['The ', 'answer ', 'is ', '42.'],
        })
        mockHelper = mocks.mockHelper
        mockChat = mocks.mockChat
        mockStreamChat = mocks.mockStreamChat
        answerLLM = new AnswerLLM(mockHelper as any)
    })

    describe('generate', () => {
        it('returns concatenated stream response as a single string', async () => {
            const result = await answerLLM.generate('What is the meaning of life?')
            expect(result).toBe('The answer is 42.')
        })

        it('passes the question to streamChat', async () => {
            await answerLLM.generate('Explain recursion')
            expect(mockStreamChat).toHaveBeenCalledTimes(1)
            expect(mockStreamChat).toHaveBeenCalledWith(
                'Explain recursion',
                undefined,
                undefined,
                expect.any(String) // system prompt override
            )
        })

        it('passes context when provided', async () => {
            await answerLLM.generate('What is polymorphism?', 'OOP discussion context')
            expect(mockStreamChat).toHaveBeenCalledWith(
                'What is polymorphism?',
                undefined,
                'OOP discussion context',
                expect.any(String)
            )
        })

        it('trims whitespace from the response', async () => {
            const mocks = createMockLlmHelperForTests({
                streamChunks: ['  padded  ', ' response  '],
            })
            const llm = new AnswerLLM(mocks.mockHelper as any)
            const result = await llm.generate('Test')
            expect(result).toBe('padded   response')
        })

        it('returns empty string when stream yields no chunks', async () => {
            const mocks = createMockLlmHelperForTests({
                streamChunks: [],
            })
            const llm = new AnswerLLM(mocks.mockHelper as any)
            const result = await llm.generate('Empty test')
            expect(result).toBe('')
        })

        it('returns empty string on stream error', async () => {
            const mocks = createMockLlmHelperForTests({
                streamError: new Error('API rate limit exceeded'),
            })
            const llm = new AnswerLLM(mocks.mockHelper as any)
            const result = await llm.generate('Failing test')
            expect(result).toBe('')
        })

        it('handles single chunk response', async () => {
            const mocks = createMockLlmHelperForTests({
                streamChunks: ['Complete answer in one chunk.'],
            })
            const llm = new AnswerLLM(mocks.mockHelper as any)
            const result = await llm.generate('Quick question')
            expect(result).toBe('Complete answer in one chunk.')
        })

        it('accumulates multiple streaming chunks correctly', async () => {
            const mocks = createMockLlmHelperForTests({
                streamChunks: ['Line1\n', 'Line2\n', 'Line3'],
            })
            const llm = new AnswerLLM(mocks.mockHelper as any)
            const result = await llm.generate('Multi-line question')
            expect(result).toBe('Line1\nLine2\nLine3')
        })

        it('uses UNIVERSAL_ANSWER_PROMPT as system prompt override', async () => {
            await answerLLM.generate('Test question')
            const systemPromptArg = mockStreamChat.mock.calls[0][3]
            expect(systemPromptArg).toContain('Natively')
            expect(systemPromptArg).toContain('copilot')
        })
    })
})
