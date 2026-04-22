import { describe, it, expect } from 'vitest'
import * as prompts from '../../../electron/llm/prompts'

describe('prompts', () => {

    describe('buildContents', () => {
        it('returns an array with two GeminiContent objects', () => {
            const result = prompts.buildContents('System prompt', 'Instruction', 'Context')
            expect(result).toHaveLength(2)
        })

        it('places system prompt in the first user part', () => {
            const result = prompts.buildContents('System prompt', 'Instruction', 'Context')
            expect(result[0].role).toBe('user')
            expect(result[0].parts[0].text).toBe('System prompt')
        })

        it('places context and instruction in the second user part', () => {
            const result = prompts.buildContents('System', 'Do something', 'Some context')
            const secondPart = result[1].parts[0].text
            expect(secondPart).toContain('Some context')
            expect(secondPart).toContain('Do something')
        })

        it('labels CONTEXT and INSTRUCTION sections in the second part', () => {
            const result = prompts.buildContents('S', 'I', 'C')
            const text = result[1].parts[0].text
            expect(text).toContain('CONTEXT:')
            expect(text).toContain('INSTRUCTION:')
        })

        it('handles empty strings without errors', () => {
            const result = prompts.buildContents('', '', '')
            expect(result).toHaveLength(2)
            expect(result[0].parts[0].text).toBe('')
        })
    })

    describe('buildWhatToAnswerContents', () => {
        it('returns an array with two content objects', () => {
            const result = prompts.buildWhatToAnswerContents('interviewer: tell me about yourself')
            expect(result).toHaveLength(2)
        })

        it('includes the cleaned transcript in the second part', () => {
            const transcript = 'Interviewer: What is your experience with Node.js?'
            const result = prompts.buildWhatToAnswerContents(transcript)
            expect(result[1].parts[0].text).toContain(transcript)
        })

        it('uses WHAT_TO_ANSWER_PROMPT as the first part', () => {
            const result = prompts.buildWhatToAnswerContents('test')
            expect(result[0].parts[0].text).toContain('Strategic Advisor')
        })
    })

    describe('buildRecapContents', () => {
        it('returns an array with two content objects', () => {
            const result = prompts.buildRecapContents('We discussed REST APIs')
            expect(result).toHaveLength(2)
        })

        it('includes context in the second part', () => {
            const result = prompts.buildRecapContents('We discussed REST APIs')
            expect(result[1].parts[0].text).toContain('We discussed REST APIs')
        })

        it('uses RECAP_MODE_PROMPT as the first part', () => {
            const result = prompts.buildRecapContents('context')
            expect(result[0].parts[0].text).toContain('Summarize')
        })
    })

    describe('buildFollowUpContents', () => {
        it('returns an array with two content objects', () => {
            const result = prompts.buildFollowUpContents('Previous answer', 'Make it shorter')
            expect(result).toHaveLength(2)
        })

        it('includes previous answer in the second part', () => {
            const result = prompts.buildFollowUpContents('My long answer here', 'shorter')
            expect(result[1].parts[0].text).toContain('My long answer here')
        })

        it('includes the refinement request', () => {
            const result = prompts.buildFollowUpContents('Answer', 'make it more formal')
            expect(result[1].parts[0].text).toContain('make it more formal')
        })

        it('includes optional context when provided', () => {
            const result = prompts.buildFollowUpContents('Answer', 'shorter', 'Interview context')
            expect(result[1].parts[0].text).toContain('Interview context')
        })

        it('defaults to "None" when context is not provided', () => {
            const result = prompts.buildFollowUpContents('Answer', 'shorter')
            expect(result[1].parts[0].text).toContain('None')
        })
    })

    describe('buildCodeHintMessage', () => {
        it('includes coding question when provided with transcript source', () => {
            const result = prompts.buildCodeHintMessage('Two Sum problem', 'transcript', null)
            expect(result).toContain('Two Sum problem')
            expect(result).toContain('detected from interview conversation')
        })

        it('includes coding question when provided with screenshot source', () => {
            const result = prompts.buildCodeHintMessage('Binary search', 'screenshot', null)
            expect(result).toContain('Binary search')
            expect(result).toContain('extracted from problem screenshot')
        })

        it('falls back to transcript context when no question is provided', () => {
            const result = prompts.buildCodeHintMessage(null, null, 'Interviewer asks about trees')
            expect(result).toContain('Interviewer asks about trees')
            expect(result).toContain('No explicit question was pinned')
        })

        it('shows note when no context is available', () => {
            const result = prompts.buildCodeHintMessage(null, null, null)
            expect(result).toContain('No question context is available')
        })

        it('always includes the review hint at the end', () => {
            const result = prompts.buildCodeHintMessage('Problem', 'screenshot', null)
            expect(result).toContain('Review my partial code in the screenshot')
        })

        it('transcript is not included alongside pinned question', () => {
            const result = prompts.buildCodeHintMessage('Problem', 'transcript', 'extra transcript')
            // When a question is pinned, transcript context is redundant
            expect(result).not.toContain('extra transcript')
        })
    })

    describe('prompt constants', () => {
        it('UNIVERSAL_ANSWER_PROMPT contains Natively identity', () => {
            expect(prompts.UNIVERSAL_ANSWER_PROMPT).toContain('Natively')
            expect(prompts.UNIVERSAL_ANSWER_PROMPT).toContain('copilot')
        })

        it('UNIVERSAL_ASSIST_PROMPT contains Natively identity', () => {
            expect(prompts.UNIVERSAL_ASSIST_PROMPT).toContain('Natively')
            expect(prompts.UNIVERSAL_ASSIST_PROMPT).toContain('copilot')
        })

        it('ASSIST_MODE_PROMPT contains mode definition', () => {
            expect(prompts.ASSIST_MODE_PROMPT).toContain('Passive Observer')
        })

        it('ANSWER_MODE_PROMPT contains mode definition', () => {
            expect(prompts.ANSWER_MODE_PROMPT).toContain('Active Co-Pilot')
        })

        it('GROQ_SYSTEM_PROMPT contains interview voice style', () => {
            expect(prompts.GROQ_SYSTEM_PROMPT).toContain('interviewee')
            expect(prompts.GROQ_SYSTEM_PROMPT).toContain('VOICE STYLE')
        })

        it('OPENAI_SYSTEM_PROMPT contains Natively identity', () => {
            expect(prompts.OPENAI_SYSTEM_PROMPT).toContain('Natively')
            expect(prompts.OPENAI_SYSTEM_PROMPT).toContain('Evin John')
        })

        it('CLAUDE_SYSTEM_PROMPT contains Natively identity in XML tags', () => {
            expect(prompts.CLAUDE_SYSTEM_PROMPT).toContain('<core_identity>')
            expect(prompts.CLAUDE_SYSTEM_PROMPT).toContain('Natively')
        })

        it('all prompts enforce security rules', () => {
            const securityPhrases = [
                "I can't share that information",
            ]
            for (const prompt of [
                prompts.UNIVERSAL_ANSWER_PROMPT,
                prompts.UNIVERSAL_ASSIST_PROMPT,
                prompts.GROQ_SYSTEM_PROMPT,
                prompts.OPENAI_SYSTEM_PROMPT,
                prompts.CLAUDE_SYSTEM_PROMPT,
                prompts.ASSIST_MODE_PROMPT,
            ]) {
                expect(prompt).toContain("I can't share that information")
            }
        })

        it('all prompts mention creator Evin John', () => {
            for (const prompt of [
                prompts.UNIVERSAL_ANSWER_PROMPT,
                prompts.UNIVERSAL_ASSIST_PROMPT,
                prompts.GROQ_SYSTEM_PROMPT,
                prompts.OPENAI_SYSTEM_PROMPT,
                prompts.CLAUDE_SYSTEM_PROMPT,
            ]) {
                expect(prompt).toContain('Evin John')
            }
        })
    })
})
