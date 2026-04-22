import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CodeHintLLM } from '../../../electron/llm/CodeHintLLM'
import { CODE_HINT_PROMPT, buildCodeHintMessage } from '../../../electron/llm/prompts'
import { createMockLlmHelperForTests } from '../../mocks/llm/mockLlmProviders'

describe('CodeHintLLM', () => {
    let mockHelper: ReturnType<typeof createMockLlmHelperForTests>['mockHelper']
    let mockStreamChat: ReturnType<typeof createMockLlmHelperForTests>['mockStreamChat']
    let codeHintLLM: CodeHintLLM

    beforeEach(() => {
        const mock = createMockLlmHelperForTests({
            streamChunks: ['Use a', ' hash map', ' for O(1)', ' lookup.']
        })
        mockHelper = mock.mockHelper
        mockStreamChat = mock.mockStreamChat
        codeHintLLM = new CodeHintLLM(mockHelper as any)
    })

    describe('generateStream', () => {
        it('yields chunks from the stream', async () => {
            const chunks: string[] = []
            for await (const chunk of codeHintLLM.generateStream()) {
                chunks.push(chunk)
            }
            expect(chunks).toEqual(['Use a', ' hash map', ' for O(1)', ' lookup.'])
            expect(chunks.join('')).toBe('Use a hash map for O(1) lookup.')
        })

        it('passes CODE_HINT_PROMPT as system prompt', async () => {
            const chunks: string[] = []
            for await (const chunk of codeHintLLM.generateStream()) {
                chunks.push(chunk)
            }
            expect(mockStreamChat).toHaveBeenCalledWith(
                expect.any(String),
                undefined,
                undefined,
                CODE_HINT_PROMPT
            )
        })

        it('passes image paths to streamChat', async () => {
            const chunks: string[] = []
            for await (const chunk of codeHintLLM.generateStream(['/code.png'])) {
                chunks.push(chunk)
            }
            expect(mockStreamChat).toHaveBeenCalledWith(
                expect.any(String),
                ['/code.png'],
                undefined,
                CODE_HINT_PROMPT
            )
        })

        it('uses buildCodeHintMessage with question context', async () => {
            const chunks: string[] = []
            for await (const chunk of codeHintLLM.generateStream(
                ['/code.png'],
                'Implement two sum',
                'screenshot',
                undefined
            )) {
                chunks.push(chunk)
            }
            const expectedMessage = buildCodeHintMessage('Implement two sum', 'screenshot', null)
            expect(mockStreamChat).toHaveBeenCalledWith(
                expectedMessage,
                ['/code.png'],
                undefined,
                CODE_HINT_PROMPT
            )
        })

        it('uses buildCodeHintMessage with transcript context', async () => {
            const chunks: string[] = []
            for await (const chunk of codeHintLLM.generateStream(
                undefined,
                undefined,
                undefined,
                'The interviewer asked about algorithms'
            )) {
                chunks.push(chunk)
            }
            const expectedMessage = buildCodeHintMessage(null, null, 'The interviewer asked about algorithms')
            expect(mockStreamChat).toHaveBeenCalledWith(
                expectedMessage,
                undefined,
                undefined,
                CODE_HINT_PROMPT
            )
        })

        it('uses buildCodeHintMessage with transcript source', async () => {
            const chunks: string[] = []
            for await (const chunk of codeHintLLM.generateStream(
                ['/img.png'],
                'Sort an array',
                'transcript',
                'some transcript'
            )) {
                chunks.push(chunk)
            }
            const expectedMessage = buildCodeHintMessage('Sort an array', 'transcript', null)
            expect(mockStreamChat).toHaveBeenCalledWith(
                expectedMessage,
                ['/img.png'],
                undefined,
                CODE_HINT_PROMPT
            )
        })

        it('yields fallback message on stream error', async () => {
            mockStreamChat.mockImplementation(async function* () {
                throw new Error('API failure')
            })
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
            const chunks: string[] = []
            for await (const chunk of codeHintLLM.generateStream()) {
                chunks.push(chunk)
            }
            expect(chunks).toHaveLength(1)
            expect(chunks[0]).toContain("I couldn't analyze the screenshot")
            expect(consoleSpy).toHaveBeenCalledWith(
                '[CodeHintLLM] Stream failed:',
                expect.any(Error)
            )
            consoleSpy.mockRestore()
        })
    })
})
