import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AssistLLM } from '../../../electron/llm/AssistLLM'
import { createMockLlmHelperForTests } from '../../mocks/llm/mockLlmProviders'

describe('AssistLLM', () => {
    let assistLLM: AssistLLM
    let mockChat: ReturnType<typeof vi.fn>
    let mockHelper: any

    beforeEach(() => {
        const mocks = createMockLlmHelperForTests({
            chatResponse: 'The interviewer is explaining the system architecture.',
        })
        mockHelper = mocks.mockHelper
        mockChat = mocks.mockChat
        assistLLM = new AssistLLM(mockHelper as any)
    })

    describe('generate', () => {
        it('returns an observational insight from the LLM', async () => {
            const result = await assistLLM.generate('Speaker is talking about microservices')
            expect(result).toBe('The interviewer is explaining the system architecture.')
        })

        it('returns empty string when context is empty', async () => {
            const result = await assistLLM.generate('')
            expect(result).toBe('')
            expect(mockChat).not.toHaveBeenCalled()
        })

        it('returns empty string when context is only whitespace', async () => {
            const result = await assistLLM.generate('   \n\t  ')
            expect(result).toBe('')
            expect(mockChat).not.toHaveBeenCalled()
        })

        it('passes context to llmHelper.chat', async () => {
            await assistLLM.generate('Interviewer asked about scaling')
            expect(mockChat).toHaveBeenCalledTimes(1)
            const callArgs = mockChat.mock.calls[0]
            expect(callArgs[2]).toBe('Interviewer asked about scaling')
        })

        it('passes a system prompt override to llmHelper.chat', async () => {
            await assistLLM.generate('Interviewer asked about scaling')
            const callArgs = mockChat.mock.calls[0]
            expect(callArgs[3]).toContain('Natively')
            expect(callArgs[3]).toContain('copilot')
        })

        it('passes instruction as the message parameter', async () => {
            await assistLLM.generate('Context about a meeting')
            const callArgs = mockChat.mock.calls[0]
            const instruction = callArgs[0]
            expect(instruction).toContain('Briefly summarize')
            expect(instruction).toContain('observation')
        })

        it('returns empty string on LLM error', async () => {
            const mocks = createMockLlmHelperForTests({
                chatError: new Error('API error'),
            })
            const llm = new AssistLLM(mocks.mockHelper as any)
            const result = await llm.generate('Some context')
            expect(result).toBe('')
        })

        it('passes undefined for image parameter', async () => {
            await assistLLM.generate('Context')
            const callArgs = mockChat.mock.calls[0]
            expect(callArgs[1]).toBeUndefined()
        })

        it('uses UNIVERSAL_ASSIST_PROMPT as system prompt', async () => {
            await assistLLM.generate('Meeting context')
            const systemPromptArg = mockChat.mock.calls[0][3]
            expect(systemPromptArg).toContain('Natively')
            expect(systemPromptArg).toContain('solve problems when they are clear')
        })
    })
})
