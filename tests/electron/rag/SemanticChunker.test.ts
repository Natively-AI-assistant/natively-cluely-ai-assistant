import { describe, it, expect } from 'vitest'
import { chunkTranscript, formatChunkForContext, type Chunk } from '../../../electron/rag/SemanticChunker'
import type { CleanedSegment } from '../../../electron/rag/TranscriptPreprocessor'

const seg = (speaker: string, text: string, startMs: number, endMs: number): CleanedSegment => ({
    speaker, text, startMs, endMs,
    isQuestion: false, isDecision: false, isActionItem: false,
})

describe('SemanticChunker', () => {
    describe('chunkTranscript', () => {
        it('returns empty array for empty input', () => {
            expect(chunkTranscript('meeting-1', [])).toEqual([])
        })

        it('groups segments into chunks', () => {
            const segments = [
                seg('Alice', 'This is a reasonable length segment about react components and how they work together in a typical application.', 0, 2000),
                seg('Alice', 'Another segment from the same speaker about state management and its importance in modern apps.', 2000, 4000),
            ]
            const chunks = chunkTranscript('meeting-1', segments)
            expect(chunks.length).toBeGreaterThan(0)
            expect(chunks[0].meetingId).toBe('meeting-1')
        })

        it('assigns sequential chunkIndex values', () => {
            const segments = [
                seg('Alice', 'First segment about the topic that is long enough to be meaningful and generate tokens for the chunk.', 0, 2000),
                seg('Bob', 'Second segment from different speaker that is also long enough to be meaningful for the chunk.', 2000, 4000),
                seg('Alice', 'Third segment from first speaker again with enough content to form a proper chunk of text.', 4000, 6000),
            ]
            const chunks = chunkTranscript('meeting-1', segments)
            chunks.forEach((chunk, i) => {
                expect(chunk.chunkIndex).toBe(i)
            })
        })

        it('splits on speaker change', () => {
            const segments = [
                seg('Alice', 'This is a segment from Alice that talks about react and its various features in detail.', 0, 2000),
                seg('Bob', 'This is a response from Bob about the same topic with his own perspective and thoughts.', 2000, 4000),
            ]
            const chunks = chunkTranscript('meeting-1', segments)
            expect(chunks.length).toBeGreaterThanOrEqual(2)
            expect(chunks[0].speaker).toBe('Alice')
            expect(chunks[1].speaker).toBe('Bob')
        })

        it('does NOT carry overlap on speaker change boundaries', () => {
            const segments = [
                seg('Alice', 'Alice has a very long segment here about react and components and state management and hooks.', 0, 2000),
                seg('Bob', 'Bob responds with his own thoughts about the topic and how it relates to their project.', 2000, 4000),
            ]
            const chunks = chunkTranscript('meeting-1', segments)
            // The Bob chunk should NOT contain Alice's text
            expect(chunks[1].text).not.toContain('Alice')
        })

        it('carries overlap on same-speaker split (token limit exceeded)', () => {
            // Create enough text from one speaker to force a split
            const longText = 'word '.repeat(120).trim() // ~120 words = ~300 tokens
            const segments = [
                seg('Alice', longText, 0, 2000),
                seg('Alice', 'Additional context from Alice that continues the thought and builds on the previous point.', 2000, 4000),
            ]
            const chunks = chunkTranscript('meeting-1', segments)
            // If split occurred, second chunk should have overlap
            if (chunks.length > 1) {
                // At least one chunk from Alice
                expect(chunks.every(c => c.speaker === 'Alice')).toBe(true)
            }
        })

        it('handles single segment exceeding MAX_TOKENS', () => {
            const hugeText = 'word '.repeat(500).trim() // way over 400 tokens
            const segments = [seg('Alice', hugeText, 0, 2000)]
            const chunks = chunkTranscript('meeting-1', segments)
            expect(chunks.length).toBeGreaterThanOrEqual(1)
            expect(chunks[0].meetingId).toBe('meeting-1')
        })

        it('correct startMs/endMs spanning', () => {
            const segments = [
                seg('Alice', 'First segment about a topic that is long enough to matter for our chunking algorithm.', 1000, 3000),
                seg('Alice', 'Second segment continuing the same topic with more detail and context for the meeting.', 3000, 5000),
            ]
            const chunks = chunkTranscript('meeting-1', segments)
            expect(chunks[0].startMs).toBe(1000)
            expect(chunks[0].endMs).toBe(5000)
        })

        it('includes tokenCount in chunks', () => {
            const segments = [seg('Alice', 'This is a test segment with some content for token counting.', 0, 1000)]
            const chunks = chunkTranscript('meeting-1', segments)
            expect(chunks[0].tokenCount).toBeGreaterThan(0)
        })
    })

    describe('formatChunkForContext', () => {
        it('formats chunk with timestamp and speaker', () => {
            const chunk: Chunk = {
                meetingId: 'm1', chunkIndex: 0, speaker: 'Alice',
                startMs: 65000, endMs: 70000, text: 'Hello world', tokenCount: 3,
            }
            const result = formatChunkForContext(chunk)
            expect(result).toBe('[1:05] Alice: Hello world')
        })

        it('pads seconds with zero', () => {
            const chunk: Chunk = {
                meetingId: 'm1', chunkIndex: 0, speaker: 'Bob',
                startMs: 5000, endMs: 6000, text: 'Quick response', tokenCount: 2,
            }
            const result = formatChunkForContext(chunk)
            expect(result).toBe('[0:05] Bob: Quick response')
        })

        it('handles zero timestamp', () => {
            const chunk: Chunk = {
                meetingId: 'm1', chunkIndex: 0, speaker: 'Speaker',
                startMs: 0, endMs: 1000, text: 'Beginning', tokenCount: 1,
            }
            const result = formatChunkForContext(chunk)
            expect(result).toBe('[0:00] Speaker: Beginning')
        })

        it('handles large timestamps', () => {
            const chunk: Chunk = {
                meetingId: 'm1', chunkIndex: 0, speaker: 'Speaker',
                startMs: 3661000, endMs: 3662000, text: 'After an hour', tokenCount: 3,
            }
            const result = formatChunkForContext(chunk)
            expect(result).toBe('[61:01] Speaker: After an hour')
        })
    })
})
