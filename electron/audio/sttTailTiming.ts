/**
 * How long a transcriber may take for its last words once the audio has
 * stopped (2026-10-15). A streaming provider answers as the audio arrives; a
 * batch one (Groq, Azure, IBM Watson, OpenAI on a custom endpoint) only after
 * the whole upload; a local model may still be running inference, or loading.
 *
 * `idleMs`: done after this long with nothing new (while the provider reports
 * no work still on its way, see hasPendingWork); `timeoutMs`: the hard limit.
 * Used by dictation's last-words wait and by a meeting-end drain of a
 * failover stand-in (sttFailover.ts). Platform-neutral.
 */
export interface SttTailTiming {
    idleMs: number;
    timeoutMs: number;
}

export const STREAMING_TAIL: SttTailTiming = { idleMs: 1_500, timeoutMs: 12_000 };

export function sttTailTimingFor(providerId: string, opts: { openAiCustomEndpoint?: boolean } = {}): SttTailTiming {
    if (providerId === 'groq' || providerId === 'azure' || providerId === 'ibmwatson' || (providerId === 'openai' && opts.openAiCustomEndpoint)) {
        return { idleMs: 8_000, timeoutMs: 45_000 };
    }
    if (providerId === 'local-whisper') return { idleMs: 30_000, timeoutMs: 120_000 };
    if (providerId === 'apple-speech') return { idleMs: 3_000, timeoutMs: 20_000 };
    return { ...STREAMING_TAIL };
}

/** Whether a provider reports work still on its way (an upload, a local final); false when it cannot say. */
export function providerHasPendingWork(stt: unknown): boolean {
    const probe = (stt as { hasPendingWork?: () => boolean } | null)?.hasPendingWork;
    if (typeof probe !== 'function') return false;
    try { return probe.call(stt) === true; } catch { return false; }
}
