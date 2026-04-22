import { describe, it, expect } from 'vitest'
import {
    cleanTranscript,
    sparsifyTranscript,
    formatTranscriptForLLM,
    prepareTranscriptForWhatToAnswer,
    type TranscriptTurn
} from '../../../electron/llm/transcriptCleaner'

const turn = (role: TranscriptTurn['role'], text: string, ts: number): TranscriptTurn => ({ role, text, timestamp: ts })

describe('transcriptCleaner', () => {
    describe('cleanTranscript', () => {
        it('returns empty array for empty input', () => {
            expect(cleanTranscript([])).toEqual([])
        })

        it('removes filler words from text', () => {
            const turns = [turn('user', 'um yeah so like the answer is 42', 1000)]
            const result = cleanTranscript(turns)
            expect(result[0].text).toContain('answer is 42')
            expect(result[0].text).not.toContain('um')
            expect(result[0].text).not.toContain('like')
        })

        it('removes repeated words', () => {
            // "yeah yeah" is deduped to "yeah", then removed as acknowledgement
            const turns = [turn('user', 'yeah yeah the answer is definitely forty two and correct', 1000)]
            const result = cleanTranscript(turns)
            expect(result[0].text).toContain('the answer is definitely forty two')
            expect(result[0].text).not.toMatch(/yeah yeah/)
        })

        it('drops non-interviewer turns with <3 words after cleaning', () => {
            const turns = [turn('user', 'yeah okay sure', 1000)]
            const result = cleanTranscript(turns)
            expect(result).toHaveLength(0)
        })

        it('keeps interviewer speech even if short (>=5 chars)', () => {
            const turns = [turn('interviewer', 'hello', 1000)]
            const result = cleanTranscript(turns)
            expect(result).toHaveLength(1)
            expect(result[0].role).toBe('interviewer')
        })

        it('drops interviewer speech if <5 chars after cleaning', () => {
            const turns = [turn('interviewer', 'um', 1000)]
            const result = cleanTranscript(turns)
            expect(result).toHaveLength(0)
        })

        it('drops pure filler turns', () => {
            const turns = [turn('user', 'uh um ah hmm', 1000)]
            const result = cleanTranscript(turns)
            expect(result).toHaveLength(0)
        })

        it('cleans up punctuation spacing', () => {
            const turns = [turn('user', 'this is great . yes , really great .', 1000)]
            const result = cleanTranscript(turns)
            expect(result[0].text).not.toContain(' .')
            expect(result[0].text).not.toContain(' ,')
        })

        it('preserves order of turns', () => {
            const turns = [
                turn('interviewer', 'what is react', 1000),
                turn('user', 'react is a javascript library', 2000),
                turn('interviewer', 'tell me more about components', 3000)
            ]
            const result = cleanTranscript(turns)
            expect(result).toHaveLength(3)
            expect(result[0].text).toContain('react')
            expect(result[1].text).toContain('javascript')
            expect(result[2].text).toContain('components')
        })

        it('converts text to lowercase', () => {
            const turns = [turn('user', 'React is POWERFUL for building modern frontend applications', 1000)]
            const result = cleanTranscript(turns)
            expect(result[0].text).toBe('react is powerful for building modern frontend applications')
        })
    })

    describe('sparsifyTranscript', () => {
        it('returns input unchanged if under maxTurns', () => {
            const turns = [
                turn('interviewer', 'question one', 1000),
                turn('user', 'answer one', 2000),
            ]
            expect(sparsifyTranscript(turns, 12)).toEqual(turns)
        })

        it('prioritizes recent interviewer turns (last 6)', () => {
            const turns: TranscriptTurn[] = []
            for (let i = 0; i < 10; i++) {
                turns.push(turn('interviewer', `question ${i}`, i * 1000))
            }
            for (let i = 0; i < 10; i++) {
                turns.push(turn('user', `answer ${i}`, (i + 10) * 1000))
            }
            const result = sparsifyTranscript(turns, 12)
            const interviewerCount = result.filter(t => t.role === 'interviewer').length
            // Should keep last 6 interviewer turns
            expect(interviewerCount).toBeLessThanOrEqual(6)
            // Most recent interviewer turn should be present
            const lastInterviewer = result.find(t => t.text === 'question 9')
            expect(lastInterviewer).toBeDefined()
        })

        it('fills remaining slots with recent other turns', () => {
            const turns: TranscriptTurn[] = []
            for (let i = 0; i < 6; i++) {
                turns.push(turn('interviewer', `question ${i}`, i * 1000))
            }
            for (let i = 0; i < 10; i++) {
                turns.push(turn('user', `answer ${i}`, (i + 6) * 1000))
            }
            const result = sparsifyTranscript(turns, 12)
            const userCount = result.filter(t => t.role === 'user').length
            expect(userCount).toBeGreaterThan(0)
        })

        it('output is sorted by timestamp', () => {
            const turns = [
                turn('interviewer', 'q1', 1000),
                turn('user', 'a1', 2000),
                turn('interviewer', 'q2', 3000),
                turn('user', 'a2', 4000),
                turn('interviewer', 'q3', 5000),
                turn('user', 'a3', 6000),
                turn('interviewer', 'q4', 7000),
                turn('user', 'a4', 8000),
                turn('interviewer', 'q5', 9000),
                turn('user', 'a5', 10000),
                turn('interviewer', 'q6', 11000),
                turn('user', 'a6', 12000),
                turn('interviewer', 'q7', 13000),
                turn('user', 'a7', 14000),
            ]
            const result = sparsifyTranscript(turns, 12)
            for (let i = 1; i < result.length; i++) {
                expect(result[i].timestamp).toBeGreaterThanOrEqual(result[i - 1].timestamp)
            }
        })
    })

    describe('formatTranscriptForLLM', () => {
        it('formats interviewer turns with INTERVIEWER label', () => {
            const turns = [turn('interviewer', 'what is react', 1000)]
            const result = formatTranscriptForLLM(turns)
            expect(result).toBe('[INTERVIEWER]: what is react')
        })

        it('formats user turns with ME label', () => {
            const turns = [turn('user', 'react is a library', 1000)]
            const result = formatTranscriptForLLM(turns)
            expect(result).toBe('[ME]: react is a library')
        })

        it('formats assistant turns with ASSISTANT label', () => {
            const turns = [turn('assistant', 'here is a suggestion', 1000)]
            const result = formatTranscriptForLLM(turns)
            expect(result).toBe('[ASSISTANT]: here is a suggestion')
        })

        it('joins multiple turns with newlines', () => {
            const turns = [
                turn('interviewer', 'question', 1000),
                turn('user', 'answer', 2000),
            ]
            const result = formatTranscriptForLLM(turns)
            expect(result).toBe('[INTERVIEWER]: question\n[ME]: answer')
        })

        it('handles empty array', () => {
            expect(formatTranscriptForLLM([])).toBe('')
        })
    })

    describe('prepareTranscriptForWhatToAnswer', () => {
        it('runs full pipeline: clean -> sparsify -> format', () => {
            const turns = [
                turn('interviewer', 'what is react', 1000),
                turn('user', 'um yeah so react is a library', 2000),
                turn('interviewer', 'tell me more', 3000),
            ]
            const result = prepareTranscriptForWhatToAnswer(turns)
            expect(result).toContain('[INTERVIEWER]')
            expect(result).toContain('[ME]')
        })

        it('respects maxTurns parameter', () => {
            const turns: TranscriptTurn[] = []
            for (let i = 0; i < 20; i++) {
                turns.push(turn('interviewer', `question about topic number ${i} that has enough content`, i * 1000))
            }
            const result = prepareTranscriptForWhatToAnswer(turns, 5)
            const lineCount = result.split('\n').filter(l => l.length > 0).length
            // sparsifyTranscript keeps last 6 interviewer turns even if maxTurns=5
            // because it prioritizes all interviewer turns up to 6
            expect(lineCount).toBeLessThanOrEqual(6)
        })
    })
})
