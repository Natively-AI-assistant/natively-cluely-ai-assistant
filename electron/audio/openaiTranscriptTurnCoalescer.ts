/**
 * Coalesces OpenAI Realtime GA transcription events into phrase-level turns.
 *
 * The server may emit one `conversation.item.input_audio_transcription.completed`
 * event per VAD commit (sometimes a single word). Downstream UI treats each final
 * as a separate queue row — we hold finals until `input_audio_buffer.speech_stopped`.
 *
 * ORDER (measured live 2026-09-23, gpt-4o-transcribe, server_vad): for a turn
 * the server emits speech_stopped FIRST — that stop is what commits the audio —
 * and the transcription deltas + completed arrive AFTER it. Holding the final
 * until speech_stopped alone therefore emitted nothing at the stop, and the
 * turn's final only surfaced as the "orphan" of the NEXT speech_started (or on
 * stop()): a whole turn late. So a stop that finds no text yet marks the turn
 * as ended, and the completed event that follows finalizes it
 * (takeAwaitedFinal). Word-level completeds that arrive BEFORE the stop keep
 * the original behaviour.
 */

export class OpenAITranscriptTurnCoalescer {
    private deltaAccum = '';
    private completedSegments: string[] = [];
    /** speech_stopped already passed with no text: the next completed is this turn's final. */
    private awaitingCompletion = false;
    /** ...and that completed has arrived. */
    private awaitedCompleted = false;

    /** Begin a new speech turn; flushes any uncommitted prior turn. */
    onSpeechStarted(): string | null {
        this.awaitingCompletion = false;
        this.awaitedCompleted = false;
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
        if (this.awaitingCompletion) this.awaitedCompleted = true;
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

    /** End of utterance — emit one coalesced final turn (or await its transcription). */
    onSpeechStopped(): string | null {
        const text = this.takeFinal();
        this.awaitingCompletion = text === null;
        this.awaitedCompleted = false;
        return text;
    }

    /**
     * Call after onCompleted(): the final for a turn whose speech_stopped came
     * before its transcription, or null when no stopped turn is waiting.
     */
    takeAwaitedFinal(): string | null {
        if (!this.awaitingCompletion || !this.awaitedCompleted) return null;
        this.awaitingCompletion = false;
        this.awaitedCompleted = false;
        return this.takeFinal();
    }

    /** Flush any pending text (e.g. on stop()/finalize()). */
    flush(): string | null {
        return this.takeFinal();
    }

    reset(): void {
        this.deltaAccum = '';
        this.completedSegments = [];
        this.awaitingCompletion = false;
        this.awaitedCompleted = false;
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
