import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
    classifyIntent,
    getAnswerShapeGuidance,
    warmupIntentClassifier,
    type ConversationIntent,
    type IntentResult,
} from '../../../electron/llm/IntentClassifier'

describe('IntentClassifier', () => {

    describe('classifyIntent - regex fast-path (Tier 1)', () => {
        it('detects clarification intent from "can you explain"', async () => {
            const result = await classifyIntent('Can you explain that?', '', 0)
            expect(result.intent).toBe('clarification')
            expect(result.confidence).toBe(0.9)
        })

        it('detects clarification intent from "what do you mean"', async () => {
            const result = await classifyIntent('What do you mean by polymorphism?', '', 0)
            expect(result.intent).toBe('clarification')
        })

        it('detects clarification intent from "clarify"', async () => {
            const result = await classifyIntent('Can you clarify what you just said?', '', 0)
            expect(result.intent).toBe('clarification')
        })

        it('detects clarification intent from "could you elaborate"', async () => {
            const result = await classifyIntent('Could you elaborate on that specific point?', '', 0)
            expect(result.intent).toBe('clarification')
        })

        it('detects follow_up intent from "what happened"', async () => {
            const result = await classifyIntent('What happened after that?', '', 0)
            expect(result.intent).toBe('follow_up')
            expect(result.confidence).toBe(0.85)
        })

        it('detects follow_up intent from "then what"', async () => {
            const result = await classifyIntent('Then what did you do?', '', 0)
            expect(result.intent).toBe('follow_up')
        })

        it('detects follow_up intent from "what\'s next"', async () => {
            const result = await classifyIntent("What's next in the process?", '', 0)
            expect(result.intent).toBe('follow_up')
        })

        it('detects follow_up intent from "how did that go"', async () => {
            const result = await classifyIntent('How did that go for the team?', '', 0)
            expect(result.intent).toBe('follow_up')
        })

        it('detects deep_dive intent from "tell me more"', async () => {
            const result = await classifyIntent('Tell me more about the architecture', '', 0)
            expect(result.intent).toBe('deep_dive')
            expect(result.confidence).toBe(0.85)
        })

        it('detects deep_dive intent from "dive deeper"', async () => {
            const result = await classifyIntent('Can you dive deeper into the implementation?', '', 0)
            expect(result.intent).toBe('deep_dive')
        })

        it('detects deep_dive intent from "how does that work"', async () => {
            const result = await classifyIntent('How does that work under the hood?', '', 0)
            expect(result.intent).toBe('deep_dive')
        })

        it('detects behavioral intent from "give me an example"', async () => {
            const result = await classifyIntent('Give me an example of when you led a team', '', 0)
            expect(result.intent).toBe('behavioral')
            expect(result.confidence).toBe(0.9)
        })

        it('detects behavioral intent from "tell me about a time"', async () => {
            const result = await classifyIntent('Tell me about a time you handled conflict', '', 0)
            expect(result.intent).toBe('behavioral')
        })

        it('detects behavioral intent from "share an experience"', async () => {
            const result = await classifyIntent('Share an experience where you failed', '', 0)
            expect(result.intent).toBe('behavioral')
        })

        it('detects example_request intent from "for example"', async () => {
            const result = await classifyIntent('Can you give a scenario, for example?', '', 0)
            expect(result.intent).toBe('example_request')
            expect(result.confidence).toBe(0.85)
        })

        it('detects example_request intent from "concrete example"', async () => {
            const result = await classifyIntent('Give me a concrete example of that pattern', '', 0)
            expect(result.intent).toBe('example_request')
        })

        it('detects summary_probe intent from "so to summarize"', async () => {
            const result = await classifyIntent('So to summarize, you used microservices?', '', 0)
            expect(result.intent).toBe('summary_probe')
            expect(result.confidence).toBe(0.85)
        })

        it('detects summary_probe intent from "so basically"', async () => {
            const result = await classifyIntent('So basically you cache everything?', '', 0)
            expect(result.intent).toBe('summary_probe')
        })

        it('detects summary_probe intent from "so you\'re saying"', async () => {
            const result = await classifyIntent("So you're saying we should use Redis?", '', 0)
            expect(result.intent).toBe('summary_probe')
        })

        it('detects coding intent from "write code"', async () => {
            const result = await classifyIntent('Write code for a binary search tree', '', 0)
            expect(result.intent).toBe('coding')
            expect(result.confidence).toBe(0.9)
        })

        it('detects coding intent from "implement"', async () => {
            const result = await classifyIntent('Implement a rate limiter using sliding window', '', 0)
            expect(result.intent).toBe('coding')
        })

        it('detects coding intent from "algorithm"', async () => {
            const result = await classifyIntent('What algorithm would you use for sorting?', '', 0)
            expect(result.intent).toBe('coding')
        })

        it('detects coding intent from "snippet"', async () => {
            const result = await classifyIntent('Show me a snippet for error handling', '', 0)
            expect(result.intent).toBe('coding')
        })

        it('is case-insensitive', async () => {
            const result = await classifyIntent('CAN YOU EXPLAIN THAT?', '', 0)
            expect(result.intent).toBe('clarification')
        })

        it('trims whitespace before matching', async () => {
            const result = await classifyIntent('  tell me more about databases  ', '', 0)
            expect(result.intent).toBe('deep_dive')
        })
    })

    describe('classifyIntent - context-based fallback (Tier 3)', () => {
        it('falls back to follow_up when multiple assistant messages and short interviewer prompt', async () => {
            // Use a non-matching prompt to skip regex and SLM
            const transcript = '[INTERVIEWER – IMPORTANT]: Hmm interesting\n[ASSISTANT (MY PREVIOUS RESPONSE)]: First answer\n[ASSISTANT (MY PREVIOUS RESPONSE)]: Second answer\n[INTERVIEWER – IMPORTANT]: ok'
            const result = await classifyIntent('ok', transcript, 2)
            // Short interviewer line (< 50 chars) with 2+ assistant messages → follow_up
            expect(result.intent).toBe('follow_up')
            expect(result.confidence).toBe(0.7)
        })

        it('falls back to general when no patterns match and low assistant count', async () => {
            const result = await classifyIntent('Some random question that does not match any pattern', '', 0)
            // Will try SLM first, then fall back to context-based general
            expect(result.intent).toBe('general')
        })

        it('falls back to general for null lastInterviewerTurn', async () => {
            const result = await classifyIntent(null, '', 0)
            expect(result.intent).toBe('general')
            expect(result.confidence).toBe(0.5)
        })

        it('falls back to general for empty lastInterviewerTurn', async () => {
            const result = await classifyIntent('', '', 0)
            expect(result.intent).toBe('general')
        })

        it('follow_up fallback requires >= 2 assistant messages', async () => {
            // Short prompt with only 1 assistant message → general
            const transcript = '[INTERVIEWER – IMPORTANT]: interesting\n[ASSISTANT (MY PREVIOUS RESPONSE)]: One answer\n[INTERVIEWER – IMPORTANT]: ok'
            const result = await classifyIntent('ok', transcript, 1)
            // With 1 assistant message, should fall to general
            expect(result.intent).toBe('general')
        })

        it('general fallback for long interviewer prompt with multiple assistant messages', async () => {
            // Long interviewer line (>= 50 chars) with assistant messages → general not follow_up
            const transcript = '[INTERVIEWER – IMPORTANT]: That is a very long and detailed question about the system design approach you described\n[ASSISTANT (MY PREVIOUS RESPONSE)]: Answer one\n[ASSISTANT (MY PREVIOUS RESPONSE)]: Answer two\n[INTERVIEWER – IMPORTANT]: That is a very long and detailed question about the system design approach you described'
            const result = await classifyIntent(
                'That is a very long and detailed question about the system design approach you described',
                transcript,
                2
            )
            expect(result.intent).toBe('general')
        })
    })

    describe('getAnswerShapeGuidance', () => {
        it('returns clarification shape', () => {
            const shape = getAnswerShapeGuidance('clarification')
            expect(shape).toContain('1-2 sentence')
            expect(shape).toContain('clarification')
        })

        it('returns follow_up shape', () => {
            const shape = getAnswerShapeGuidance('follow_up')
            expect(shape).toContain('Continue the narrative')
            expect(shape).toContain('No recap')
        })

        it('returns deep_dive shape', () => {
            const shape = getAnswerShapeGuidance('deep_dive')
            expect(shape).toContain('structured')
            expect(shape).toContain('concrete specifics')
        })

        it('returns behavioral shape', () => {
            const shape = getAnswerShapeGuidance('behavioral')
            expect(shape).toContain('STAR')
            expect(shape).toContain('example')
        })

        it('returns example_request shape', () => {
            const shape = getAnswerShapeGuidance('example_request')
            expect(shape).toContain('ONE concrete')
            expect(shape).toContain('specific')
        })

        it('returns summary_probe shape', () => {
            const shape = getAnswerShapeGuidance('summary_probe')
            expect(shape).toContain('Confirm')
            expect(shape).toContain('clarifying point')
        })

        it('returns coding shape', () => {
            const shape = getAnswerShapeGuidance('coding')
            expect(shape).toContain('FULL')
            expect(shape).toContain('production-ready')
            expect(shape).toContain('code block')
        })

        it('returns general shape', () => {
            const shape = getAnswerShapeGuidance('general')
            expect(shape).toContain('conversational')
            expect(shape).toContain('direct')
        })

        it('returns shape for every ConversationIntent type', () => {
            const intents: ConversationIntent[] = [
                'clarification', 'follow_up', 'deep_dive', 'behavioral',
                'example_request', 'summary_probe', 'coding', 'general'
            ]
            for (const intent of intents) {
                const shape = getAnswerShapeGuidance(intent)
                expect(shape).toBeTruthy()
                expect(typeof shape).toBe('string')
                expect(shape.length).toBeGreaterThan(10)
            }
        })
    })

    describe('warmupIntentClassifier', () => {
        it('is a callable function', () => {
            expect(typeof warmupIntentClassifier).toBe('function')
            // Should not throw
            warmupIntentClassifier()
        })
    })
})
