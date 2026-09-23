/**
 * Per-item transcript assembly for OpenAI's `gpt-live-transcribe`.
 *
 * The gpt-4o-transcribe path finalizes on the server VAD's
 * `input_audio_buffer.speech_stopped` (OpenAITranscriptTurnCoalescer). The live
 * model runs with `turn_detection: null` — it "doesn't support server_vad or
 * semantic_vad" (developers.openai.com, Realtime transcription) — so there is
 * no speech_started/stopped at all: deltas stream while the person speaks, and
 * a `...transcription.completed` arrives for the item after the CLIENT commits.
 * The completed event is therefore the final, and it is keyed by `item_id`.
 *
 * Keyed per item rather than one running string, because after a commit the
 * speaker can resume before the committed item's `completed` lands: the next
 * item's deltas would otherwise be glued onto the previous final and then
 * repeated in its own.
 *
 * Platform: pure string state — identical on darwin and win32.
 */
export class OpenAILiveTranscriptItems {
    private readonly order: string[] = [];
    private readonly text = new Map<string, string>();

    /** Append a delta; returns the preview of everything not yet final. */
    onDelta(itemId: string | undefined, delta: string): string | null {
        const id = itemId ?? '';
        if (!this.text.has(id)) {
            this.text.set(id, '');
            this.order.push(id);
        }
        if (delta) this.text.set(id, this.text.get(id)! + delta);
        return this.preview();
    }

    /**
     * The item is final. Returns its text — the server's full transcript when
     * present, else what the deltas assembled — and forgets the item.
     */
    onCompleted(itemId: string | undefined, transcript: string): string | null {
        const id = itemId ?? '';
        const assembled = this.text.get(id) ?? '';
        this.forget(id);
        const text = (transcript && transcript.trim()) || assembled.trim();
        return text || null;
    }

    /** Everything still pending, oldest first (stop(): nothing more will complete). */
    flush(): string | null {
        const text = this.preview();
        this.reset();
        return text;
    }

    preview(): string | null {
        const text = this.order.map((id) => (this.text.get(id) ?? '').trim()).filter(Boolean).join(' ');
        return text || null;
    }

    reset(): void {
        this.order.length = 0;
        this.text.clear();
    }

    private forget(id: string): void {
        this.text.delete(id);
        const i = this.order.indexOf(id);
        if (i >= 0) this.order.splice(i, 1);
    }
}
