import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FollowUpLLM } from '../../../electron/llm/FollowUpLLM'
import { UNIVERSAL_FOLLOWUP_PROMPT } from '../../../electron/llm/prompts'
import { createMockLlmHelperForTests } from '../../mocks/llm/mockLlmProviders'

describe('FollowUpLLM', () => {
    let mockHelper: ReturnType<typeof createMockLlmHelperForTests>['mockHelper']
    let mockStreamChat: ReturnType<typeof createMockLlmHelperForTests>['mockStreamChat']
    let followUpLLM: FollowUpLLM

    beforeEach(() => {
        const mock = createMockLlmHelperForTests({
            streamChunks: ['Here is', ' the refined', ' answer.']
        })
        mockHelper = mock.mockHelper
        mockStreamChat = mock.mockStreamChat
        followUpLLM = new FollowUpLLM(mockHelper as any)
    })

    describe('generate', () => {
        it('returns concatenated stream chunks', async () => {
            const result = await followUpLLM.generate(
                'Use a hash map for O(1) lookup.',
                'Can you explain the time complexity?'
            )
            expect(result).toBe('Here is the refined answer.')
        })

        it('passes UNIVERSAL_FOLLOWUP_PROMPT as system prompt', async () => {
            await followUpLLM.generate('Previous answer', 'Refine this')
            expect(mockStreamChat).toHaveBeenCalledWith(
                expect.any(String),
                undefined,
                undefined,
                UNIVERSAL_FOLLOWUP_PROMPT
            )
        })

        it('constructs message with PREVIOUS ANSWER and REQUEST', async () => {
            await followUpLLM.generate(
                'The answer is 42.',
                'Why not 43?'
            )
            expect(mockStreamChat).toHaveBeenCalledWith(
                'PREVIOUS ANSWER:\nThe answer is 42.\n\nREQUEST: Why not 43?',
                undefined,
                undefined,
                UNIVERSAL_FOLLOWUP_PROMPT
            )
        })

        it('passes optional context to streamChat', async () => {
            await followUpLLM.generate('Previous', 'Refine', 'some context')
            expect(mockStreamChat).toHaveBeenCalledWith(
                expect.any(String),
                undefined,
                'some context',
                UNIVERSAL_FOLLOWUP_PROMPT
            )
        })

        it('returns empty string on stream error', async () => {
            mockStreamChat.mockImplementation(async function* () {
                throw new Error('API failure')
            })
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
            const result = await followUpLLM.generate('prev', 'request')
            expect(result).toBe('')
            expect(consoleSpy).toHaveBeenCalledWith(
                '[FollowUpLLM] Failed:',
                expect.any(Error)
            )
            consoleSpy.mockRestore()
        })
    })

    describe('generateStream', () => {
        it('yields chunks from the stream', async () => {
            const chunks: string[] = []
            for await (const chunk of followUpLLM.generateStream('Prev answer', 'Refine request')) {
                chunks.push(chunk)
            }
            expect(chunks).toEqual(['Here is', ' the refined', ' answer.'])
        })

        it('passes UNIVERSAL_FOLLOWUP_PROMPT as system prompt', async () => {
            const chunks: string[] = []
            for await (const chunk of followUpLLM.generateStream('Prev', 'Request')) {
                chunks.push(chunk)
            }
            expect(mockStreamChat).toHaveBeenCalledWith(
                expect.any(String),
                undefined,
                undefined,
                UNIVERSAL_FOLLOWUP_PROMPT
            )
        })

        it('constructs message with PREVIOUS ANSWER and REQUEST', async () => {
            const chunks: string[] = []
            for await (const chunk of followUpLLM.generateStream('My answer', 'More detail')) {
                chunks.push(chunk)
            }
            expect(mockStreamChat).toHaveBeenCalledWith(
                'PREVIOUS ANSWER:\nMy answer\n\nREQUEST: More detail',
                undefined,
                undefined,
                UNIVERSAL_FOLLOWUP_PROMPT
            )
        })

        it('passes optional context to streamChat', async () => {
            const chunks: string[] = []
            for await (const chunk of followUpLLM.generateStream('Prev', 'Req', 'ctx')) {
                chunks.push(chunk)
            }
            expect(mockStreamChat).toHaveBeenCalledWith(
                expect.any(String),
                undefined,
                'ctx',
                UNIVERSAL_FOLLOWUP_PROMPT
            )
        })

        it('yields nothing on stream error', async () => {
            mockStreamChat.mockImplementation(async function* () {
                throw new Error('stream error')
            })
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
            const chunks: string[] = []
            for await (const chunk of followUpLLM.generateStream('prev', 'req')) {
                chunks.push(chunk)
            }
            expect(chunks).toHaveLength(0)
            consoleSpy.mockRestore()
        })
    })
})
