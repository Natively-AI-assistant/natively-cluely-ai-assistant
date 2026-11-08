/**
 * One debug-log line describing the microphone format STT is told about.
 *
 * Why it exists (user log 2026-11-01, Windows 2.9.2, ElevenLabs, Auto): English
 * through the Speak button came back as Cyrillic nonsense ("И-и-и, ё-ё-ё,
 * алло!"). Live ElevenLabs tests on 2026-11-03 cleared language locking, accent,
 * noise, low level and dropped audio — every one still came back English — and
 * reproduced the nonsense only with PCM sent at a rate other than the one
 * declared (48 kHz audio declared as 16 kHz → "Ага.", tagged Macedonian). The
 * native module printed its rates only to stdout, which never reaches
 * natively_debug.log, so the log could not say whether that happened.
 *
 * Pure: no electron or native imports, so it runs under plain `node --test`.
 */

export interface MicRateFacts {
    /** Rate declared to STT (capture.getSampleRate()). */
    emittedRate: number;
    /** Device rate before resampling; 0 when unknown. */
    nativeRate: number;
    /** Channels the device delivers before one is kept; 0 when unknown. */
    channels: number;
    /** Capture backend, e.g. 'native' or 'chromium'; '' when unknown. */
    backend?: string;
}

export interface MicRateReport {
    line: string;
    /** True when the declared rate is not the canonical 16 kHz STT rate. */
    unusual: boolean;
}

/** The rate every capture path resamples to before STT. */
export const CANONICAL_MIC_STT_RATE = 16000;

export function describeMicRate(facts: MicRateFacts): MicRateReport {
    const emitted = Number.isFinite(facts.emittedRate) ? facts.emittedRate : 0;
    const native = Number.isFinite(facts.nativeRate) && facts.nativeRate > 0 ? facts.nativeRate : 0;
    const channels = Number.isFinite(facts.channels) && facts.channels > 0 ? facts.channels : 0;
    const parts = [
        `declared ${emitted}Hz`,
        `device ${native ? `${native}Hz` : 'unknown'}`,
        `${channels ? channels : 'unknown'} ch`,
    ];
    if (facts.backend) parts.push(`backend ${facts.backend}`);
    const resampling = native > 0 && native !== emitted;
    parts.push(resampling ? 'resampled' : 'not resampled');
    const unusual = emitted !== CANONICAL_MIC_STT_RATE;
    return {
        line: `Mic format: ${parts.join(', ')}${unusual
            ? ' — not the usual 16000Hz; STT is told this rate, so it must match the audio'
            : ''}`,
        unusual,
    };
}
