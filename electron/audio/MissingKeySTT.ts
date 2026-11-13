/**
 * The channel's provider when the speech provider chosen in Settings has no
 * key saved (F-PRV-01, 2026-11-13).
 *
 * main.ts used to build Google STT in that case, without a word: meeting
 * audio went to Google whenever a Google service-account file (or
 * GOOGLE_APPLICATION_CREDENTIALS) happened to be around, although the user had
 * picked another provider; without one, the overlay said "Google Key Missing"
 * for a provider they never chose. This sends nothing anywhere: every start()
 * reports one terminal error naming the missing key, which main shows as
 * "failed" (sttErrorClassifier: `terminal`), never "reconnecting", and which
 * never hands over to a stand-in. Saving the key rebuilds the providers
 * (reconfigureSttProvider). Google is used only when the user chose Google.
 *
 * Platform-neutral: no I/O at all.
 */

import { EventEmitter } from 'events';
import { sttProviderName } from './sttFailover';

export const MISSING_STT_KEY_CODE = 'stt_key_missing';

/** What the overlay shows (src/lib/sttErrorMapper.ts shows it as written). */
export function missingSttKeyMessage(provider: string): string {
    const key = provider === 'natively' ? 'Natively key' : `${sttProviderName(provider)} API key`;
    return `No ${key} is saved, so nothing is being transcribed. Add it in Settings → Audio, or choose another speech provider there.`;
}

export class MissingKeySTT extends EventEmitter {
    private active = false;
    private reportScheduled = false;

    constructor(readonly provider: string) {
        super();
    }

    /**
     * main.ts keeps one instance across meetings and the overlay resets each
     * channel to "Listening…" at every meeting start, so each start() says it
     * again: deferred past the caller's own start-of-meeting status, and
     * coalesced so a stop()+start() in one tick reports once.
     */
    public start(): void {
        if (this.active) return;
        this.active = true;
        if (this.reportScheduled) return;
        this.reportScheduled = true;
        setImmediate(() => {
            this.reportScheduled = false;
            if (!this.active || this.listenerCount('error') === 0) return;
            this.emit('error', Object.assign(new Error(missingSttKeyMessage(this.provider)), {
                code: MISSING_STT_KEY_CODE,
                terminal: true,
            }));
        });
    }

    public stop(): void {
        this.active = false;
    }

    /** Audio is dropped: no provider was chosen that may hear it. */
    public write(_chunk: Buffer): void { /* nothing is sent anywhere */ }
    public setSampleRate(_rate: number): void { /* no stream */ }
    public setAudioChannelCount(_count: number): void { /* no stream */ }
    public setRecognitionLanguage(_language: string): void { /* no stream */ }
    public setCredentials(_keyFilePath: string): void { /* not Google */ }
    public notifySpeechEnded(): void { /* no stream */ }
    public finalize(): void { /* nothing pending */ }
}
