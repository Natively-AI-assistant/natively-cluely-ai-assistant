// Pause transcription (2026-10-20), as Granola's "Stop transcription" /
// "Resume" in the notepad: the meeting keeps running, but nothing said while
// paused is transcribed.
//
// Done at the one place both platforms' captures meet, the shared 'data'
// handlers in main: while paused every chunk is replaced by silence of the
// same length (the same way "Follow the meeting app's mute" gates the mic), so
// the speech sockets keep their timing and never see a gap they would close
// on. Capture itself is untouched, so a resume has nothing to restart.
//
// The notepad's listening bars follow the real level: `level()` is the RMS of
// a chunk, sampled, and `AudioLevelMeter` sends the louder channel at most
// every LEVEL_INTERVAL_MS. Pure: no electron import, the same on macOS and
// Windows (TranscriptionPause2026_10_20.test.mjs).

export class TranscriptionPause {
    private paused = false;
    private readonly listeners = new Set<(paused: boolean) => void>();

    isPaused(): boolean {
        return this.paused;
    }

    /** Returns whether it changed. */
    setPaused(paused: boolean): boolean {
        if (this.paused === paused) return false;
        this.paused = paused;
        for (const l of this.listeners) {
            try { l(paused); } catch { /* a listener never blocks the switch */ }
        }
        return true;
    }

    /** The chunk the speech provider gets: the chunk itself, or zeros of the same length while paused. */
    gate(chunk: Buffer): Buffer {
        return this.paused ? Buffer.alloc(chunk.length) : chunk;
    }

    onChange(listener: (paused: boolean) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
}

/** 0..1 loudness of 16-bit little-endian PCM, from every 10th sample. */
export function level(chunk: Buffer): number {
    const step = 10;
    let sum = 0;
    let count = 0;
    for (let i = 0; i + 1 < chunk.length; i += 2 * step) {
        const v = chunk.readInt16LE(i);
        sum += v * v;
        count++;
    }
    if (count === 0) return 0;
    return Math.min(Math.sqrt(sum / count) / 10_000, 1);
}

export const LEVEL_INTERVAL_MS = 120;

/** The louder of the two channels, sent at most every LEVEL_INTERVAL_MS. */
export class AudioLevelMeter {
    private mic = 0;
    private system = 0;
    private lastSent = 0;

    constructor(private readonly send: (level: number) => void, private readonly now: () => number = Date.now) {}

    note(channel: 'mic' | 'system', value: number): void {
        if (channel === 'mic') this.mic = value;
        else this.system = value;
        const t = this.now();
        if (t - this.lastSent < LEVEL_INTERVAL_MS) return;
        this.lastSent = t;
        this.send(Math.max(this.mic, this.system));
    }

    reset(): void {
        this.mic = 0;
        this.system = 0;
        this.lastSent = 0;
    }
}
