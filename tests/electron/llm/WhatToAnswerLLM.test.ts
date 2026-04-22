import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WhatToAnswerLLM } from '../../../electron/llm/WhatToAnswerLLM'
import { UNIVERSAL_WHAT_TO_ANSWER_PROMPT } from '../../../electron/llm/prompts'
import { createMockLlmHelperForTests } from '../../mocks/llm/mockLlmProviders'
import type { TemporalContext } from '../../../electron/llm/TemporalContextBuilder'
import type { IntentResult } from '../../../electron/llm/IntentClassifier'

describe('WhatToAnswerLLM', () => {
    let mockHelper: ReturnType<typeof createMockLlmHelperForTests>['mockHelper']
    let mockStreamChat: ReturnType<typeof createMockLlmHelperForTests>['mockStreamChat']
    let whatToAnswerLLM: WhatToAnswerLLM

    beforeEach(() => {
        const mock = createMockLlmHelperForTests({
            streamChunks: ['You should', ' talk about', ' your experience', ' with React.']
        })
        mockHelper = mock.mockHelper
        mockStreamChat = mock.mockStreamChat
        whatToAnswerLLM = new WhatToAnswerLLM(mockHelper as any)
    })

    describe('generate (non-streaming wrapper)', () => {
        it('returns concatenated stream chunks', async () => {
            const result = await whatToAnswerLLM.generate('Tell me about yourself')
            expect(result).toBe('You should talk about your experience with React.')
        })

        it('passes UNIVERSAL_WHAT_TO_ANSWER_PROMPT as system prompt', async () => {
            await whatToAnswerLLM.generate('some transcript')
            expect(mockStreamChat).toHaveBeenCalledWith(
                expect.any(String),
                undefined,
                undefined,
                UNIVERSAL_WHAT_TO_ANSWER_PROMPT
            )
        })

        it('handles empty transcript', async () => {
            const result = await whatToAnswerLLM.generate('')
            expect(result).toBe('You should talk about your experience with React.')
        })
    })

    describe('generateStream', () => {
        it('yields chunks from the stream', async () => {
            const chunks: string[] = []
            for await (const chunk of whatToAnswerLLM.generateStream('What is your greatest weakness?')) {
                chunks.push(chunk)
            }
            expect(chunks).toEqual(['You should', ' talk about', ' your experience', ' with React.'])
        })

        it('passes UNIVERSAL_WHAT_TO_ANSWER_PROMPT as system prompt', async () => {
            const chunks: string[] = []
            for await (const chunk of whatToAnswerLLM.generateStream('transcript')) {
                chunks.push(chunk)
            }
            expect(mockStreamChat).toHaveBeenCalledWith(
                'transcript',
                undefined,
                undefined,
                UNIVERSAL_WHAT_TO_ANSWER_PROMPT
            )
        })

        it('passes image paths to streamChat', async () => {
            const chunks: string[] = []
            for await (const chunk of whatToAnswerLLM.generateStream('transcript', undefined, undefined, ['/img.png'])) {
                chunks.push(chunk)
            }
            expect(mockStreamChat).toHaveBeenCalledWith(
                expect.any(String),
                ['/img.png'],
                undefined,
                UNIVERSAL_WHAT_TO_ANSWER_PROMPT
            )
        })

        it('yields fallback message on stream error', async () => {
            mockStreamChat.mockImplementation(async function* () {
                throw new Error('API failure')
            })
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
            const chunks: string[] = []
            for await (const chunk of whatToAnswerLLM.generateStream('some transcript')) {
                chunks.push(chunk)
            }
            expect(chunks).toHaveLength(1)
            expect(chunks[0]).toContain('Could you repeat that?')
            expect(consoleSpy).toHaveBeenCalledWith(
                '[WhatToAnswerLLM] Stream failed:',
                expect.any(Error)
            )
            consoleSpy.mockRestore()
        })
    })

    describe('intent result integration', () => {
        it('prepends intent and answer shape to message', async () => {
            const intentResult: IntentResult = {
                intent: 'clarification',
                confidence: 0.9,
                answerShape: 'Give a direct, focused 1-2 sentence clarification.'
            }
            const chunks: string[] = []
            for await (const chunk of whatToAnswerLLM.generateStream(
                'Can you explain that?',
                undefined,
                intentResult
            )) {
                chunks.push(chunk)
            }
            const callArgs = (mockStreamChat.mock.calls as any)[0]
            const message = callArgs[0] as string
            expect(message).toContain('<intent_and_shape>')
            expect(message).toContain('DETECTED INTENT: clarification')
            expect(message).toContain('ANSWER SHAPE: Give a direct, focused 1-2 sentence clarification.')
            expect(message).toContain('</intent_and_shape>')
            expect(message).toContain('CONVERSATION:')
            expect(message).toContain('Can you explain that?')
        })

        it('includes behavioral intent in message', async () => {
            const intentResult: IntentResult = {
                intent: 'behavioral',
                confidence: 0.85,
                answerShape: 'Lead with a specific example or story.'
            }
            const chunks: string[] = []
            for await (const chunk of whatToAnswerLLM.generateStream(
                'Tell me about a time you handled conflict',
                undefined,
                intentResult
            )) {
                chunks.push(chunk)
            }
            const callArgs = (mockStreamChat.mock.calls as any)[0]
            const message = callArgs[0]
            expect(message).toContain('DETECTED INTENT: behavioral')
            expect(message).toContain('Lead with a specific example or story.')
        })

        it('includes coding intent in message', async () => {
            const intentResult: IntentResult = {
                intent: 'coding',
                confidence: 0.9,
                answerShape: 'Provide a FULL, complete, working code implementation.'
            }
            const chunks: string[] = []
            for await (const chunk of whatToAnswerLLM.generateStream(
                'Write code for binary search',
                undefined,
                intentResult
            )) {
                chunks.push(chunk)
            }
            const callArgs = (mockStreamChat.mock.calls as any)[0]
            const message = callArgs[0]
            expect(message).toContain('DETECTED INTENT: coding')
        })
    })

    describe('temporal context integration', () => {
        const buildTemporalContext = (overrides: Partial<TemporalContext> = {}): TemporalContext => ({
            recentTranscript: '',
            previousResponses: [],
            roleContext: 'general',
            toneSignals: [],
            hasRecentResponses: false,
            ...overrides,
        })

        it('includes previous responses for anti-repetition when hasRecentResponses is true', async () => {
            const temporalContext = buildTemporalContext({
                hasRecentResponses: true,
                previousResponses: ['Use a hash map for O(1) lookup.', 'Apply dynamic programming approach.'],
            })
            const chunks: string[] = []
            for await (const chunk of whatToAnswerLLM.generateStream(
                'How would you optimize this?',
                temporalContext
            )) {
                chunks.push(chunk)
            }
            const callArgs = (mockStreamChat.mock.calls as any)[0]
            const message = callArgs[0]
            expect(message).toContain('PREVIOUS RESPONSES (Avoid Repetition):')
            expect(message).toContain('1. "Use a hash map for O(1) lookup."')
            expect(message).toContain('2. "Apply dynamic programming approach."')
        })

        it('does not include previous responses when hasRecentResponses is false', async () => {
            const temporalContext = buildTemporalContext({
                hasRecentResponses: false,
                previousResponses: ['Some old response'],
            })
            const chunks: string[] = []
            for await (const chunk of whatToAnswerLLM.generateStream(
                'How would you optimize this?',
                temporalContext
            )) {
                chunks.push(chunk)
            }
            const callArgs = (mockStreamChat.mock.calls as any)[0]
            const message = callArgs[0]
            expect(message).not.toContain('PREVIOUS RESPONSES')
        })

        it('combines intent result and temporal context', async () => {
            const intentResult: IntentResult = {
                intent: 'follow_up',
                confidence: 0.85,
                answerShape: 'Continue the narrative naturally.',
            }
            const temporalContext = buildTemporalContext({
                hasRecentResponses: true,
                previousResponses: ['My first answer about architecture.'],
            })
            const chunks: string[] = []
            for await (const chunk of whatToAnswerLLM.generateStream(
                'What happened next?',
                temporalContext,
                intentResult
            )) {
                chunks.push(chunk)
            }
            const callArgs = (mockStreamChat.mock.calls as any)[0]
            const message = callArgs[0]
            expect(message).toContain('<intent_and_shape>')
            expect(message).toContain('DETECTED INTENT: follow_up')
            expect(message).toContain('PREVIOUS RESPONSES (Avoid Repetition):')
            expect(message).toContain('CONVERSATION:')
        })

        it('uses raw transcript when no intent or temporal context', async () => {
            const chunks: string[] = []
            for await (const chunk of whatToAnswerLLM.generateStream('Simple question here')) {
                chunks.push(chunk)
            }
            const callArgs = (mockStreamChat.mock.calls as any)[0]
            const message = callArgs[0]
            expect(message).toBe('Simple question here')
        })
    })
})
