/**
 * Coalesces OpenAI Realtime GA transcription events into phrase-level turns.
 *
 * The server may emit one `conversation.item.input_audio_transcription.completed`
 * event per VAD commit (sometimes a single word). Downstream UI treats each final
 * as a separate queue row — we hold finals until `input_audio_buffer.speech_stopped`.
 */

export class OpenAITranscriptTurnCoalescer {
    private deltaAccum = '';
    private completedSegments: string[] = [];

    /** Begin a new speech turn; flushes any uncommitted prior turn. */
    onSpeechStarted(): string | null {
        const orphan = this.takeFinal();
        this.deltaAccum = '';
        this.completedSegments = [];
        return orphan;
    }

    /** Append incremental delta text; returns accumulated partial for UI preview. */
    onDelta(delta: string): string | null {
        if (!delta) return this.getPartialText();
        this.deltaAccum += delta;
        return this.getPartialText();
    }

    /** Record a per-item completed segment without emitting a final turn yet. */
    onCompleted(transcript: string): string | null {
        const text = transcript.trim();
        if (text) {
            this.completedSegments.push(text);
            const joined = this.completedSegments.join(' ');
            if (joined.length > this.deltaAccum.length) {
                this.deltaAccum = joined;
            }
        }
        return this.getPartialText();
    }

    /** End of utterance — emit one coalesced final turn. */
    onSpeechStopped(): string | null {
        return this.takeFinal();
    }

    /** Flush any pending text (e.g. on stop()/finalize()). */
    flush(): string | null {
        return this.takeFinal();
    }

    reset(): void {
        this.deltaAccum = '';
        this.completedSegments = [];
    }

    getPartialText(): string | null {
        const joined = this.completedSegments.map(s => s.trim()).filter(Boolean).join(' ');
        const text = (joined.length >= this.deltaAccum.trim().length ? joined : this.deltaAccum).trim();
        return text || null;
    }

    private takeFinal(): string | null {
        const text = this.getPartialText();
        this.reset();
        return text;
    }
}
