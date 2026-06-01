import { EventEmitter } from 'events';
import { loadNativeModule } from './nativeModuleLoader';

// RustMicCapture is the native Rust class (napi-rs) that captures microphone input.
// Uses eager init — the monitor is created in the constructor and kept alive across
// stop/restart cycles to avoid re-initialization latency.
const NativeModule: any = loadNativeModule();
const { MicrophoneCapture: RustMicCapture } = NativeModule || {};

export class MicrophoneCapture extends EventEmitter {
    private monitor: any = null;
    private isRecording: boolean = false;
    private deviceId: string | null = null;
    // Promise that resolves when the deferred native teardown setImmediate body
    // finishes (i.e. monitor.stop() has released the cpal stream / HAL handle).
    // Tracked so:
    //   - repeated stop() calls return the same in-flight promise (idempotent),
    //   - callers can `await capture.stop()` to know teardown is genuinely
    //     complete before constructing a new native instance / starting again,
    //   - destroy() awaits this before removing listeners and nulling fields.
    private _teardownPromise: Promise<void> | null = null;
    // When false, the post-teardown pre-warm step (which constructs a fresh
    // RustMicCapture so the next meeting's start() doesn't pay the cpal init
    // cost on the Electron main thread) is skipped. Disabled by:
    //   - destroy() — permanent disposal, the wrapper will never be used again
    //   - disablePreWarm() — called from main.ts during app quit, aborted
    //     meeting init, and device-swap paths where the next start (if any)
    //     will construct a brand-new MicrophoneCapture instance anyway.
    // Default true: the common case (Stop → next meeting on the same device)
    // benefits from pre-warm avoiding the ~50ms cpal cold-start cost.
    private preWarmEnabled: boolean = true;

    constructor(deviceId?: string | null) {
        super();
        this.deviceId = deviceId || null;
        if (!RustMicCapture) {
            console.error('[MicrophoneCapture] Rust class implementation not found.');
        } else {
            console.log(`[MicrophoneCapture] Initialized wrapper. Device ID: ${this.deviceId || 'default'}`);
            try {
                console.log('[MicrophoneCapture] Creating native monitor (Eager Init)...');
                this.monitor = new RustMicCapture(this.deviceId);
            } catch (e) {
                console.error('[MicrophoneCapture] Failed to create native monitor:', e);
                // Re-throw so callers (e.g. reconfigureAudio) can catch and fall back to
                // the default device. Without this, the constructor returns a broken
                // instance (monitor=null) and the fallback try/catch in main.ts is
                // never reached, leaving the user with zero microphone capture.
                throw e;
            }
        }
    }

    public getSampleRate(): number {
        if (this.monitor) {
            // NAPI-RS V3 auto-converts Rust snake_case to camelCase
            if (typeof this.monitor.getSampleRate === 'function') {
                return this.monitor.getSampleRate();
            } else if (typeof this.monitor.get_sample_rate === 'function') {
                // Fallback for V2 or explicit js_name
                return this.monitor.get_sample_rate();
            }
        }
        return 48000; // Safe default for most modern mics before native initialization
    }

    /**
     * Start capturing microphone audio
     */
    public start(): void {
        if (this.isRecording) return;

        if (!RustMicCapture) {
            console.error('[MicrophoneCapture] Cannot start: Rust module missing');
            return;
        }

        // Defensive fallback: under normal flow the constructor always
        // creates this.monitor (and throws on failure). This branch only
        // fires if someone constructs the class with RustMicCapture present,
        // then the native object is externally freed (edge case).
        if (!this.monitor) {
            console.log('[MicrophoneCapture] Monitor not initialized. Re-initializing...');
            try {
                this.monitor = new RustMicCapture(this.deviceId);
            } catch (e) {
                this.emit('error', e);
                return;
            }
        }

        try {
            console.log('[MicrophoneCapture] Starting native capture...');

            this.isRecording = true; // Set BEFORE start() to prevent re-entrant calls

            this.monitor.start((err: Error | null, chunk: Buffer) => {
                // napi v3 ThreadsafeFunction passes (err, arg) format
                if (err) {
                    console.error('[MicrophoneCapture] Callback error:', err);
                    this.isRecording = false; // Allow recovery via restart
                    this.emit('error', err);
                    return;
                }
                if (chunk && chunk.length > 0) {
                    // POST-STOP GUARD: see SystemAudioCapture for rationale. The
                    // deferred native stop() means late chunks may arrive on the JS
                    // side; drop them so STT.finalize() sees a clean audio-end.
                    if (!this.isRecording) return;
                    // Debug: log occasionally
                    if (Math.random() < 0.05) {
                        console.log(`[MicrophoneCapture] Emitting chunk: ${chunk.length} bytes to JS`);
                    }
                    // PERF: napi-rs Buffer is already owned. Removed redundant Buffer.from copy
                    // (matches SystemAudioCapture). Saves ~95KB/sec of allocation churn.
                    this.emit('data', chunk);
                }
            }, (err: Error | null, _ended: boolean) => {
                // Speech-ended callback from Rust SilenceSuppressor.
                // _ended is always `true` when fired (Rust only invokes on speech→silence transition).
                if (err) {
                    console.error('[MicrophoneCapture] Speech ended callback error:', err);
                    return;
                }
                this.emit('speech_ended');
            });

            this.emit('start');
        } catch (error) {
            console.error('[MicrophoneCapture] Failed to start:', error);
            this.isRecording = false;
            this.emit('error', error);
        }
    }

    /**
     * Stop capturing.
     *
     * PERF: The native `monitor.stop()` blocks waiting for the DSP thread join
     * AND CPAL stream drop (which itself waits for the platform audio thread —
     * CoreAudio / WASAPI / ALSA — to release the device). On macOS that's
     * 30–80ms; on Windows 100–300ms; on flaky USB devices, longer. We flip
     * `isRecording = false` synchronously so external observers (and our own
     * data-callback guard) see the stopped state immediately, then defer the
     * native teardown so the Electron IPC handler returns without waiting.
     */
    public stop(): Promise<void> {
        // Idempotent: a concurrent stop() (e.g. endMeeting racing an audio
        // recovery teardown) joins the in-flight teardown instead of
        // starting a second one. If we are not recording AND no teardown is
        // in flight, this is a no-op resolved promise.
        if (!this.isRecording) {
            return this._teardownPromise ?? Promise.resolve();
        }

        console.log('[MicrophoneCapture] Stopping capture (deferred native teardown)...');
        this.isRecording = false;
        const monitor = this.monitor;
        // Null the field so any caller that wins the race against the setImmediate
        // below sees a clean slate. The setImmediate callback will eagerly
        // reconstruct a fresh Rust monitor before the next meeting starts.
        this.monitor = null;

        // Native teardown only — the setImmediate body releases the HAL
        // handle and resolves the promise. Pre-warm has been pulled OUT of
        // this body (it used to run inside the same setImmediate). Now it
        // runs in a separate .then() chained off the teardown promise so
        // that:
        //   1. `await capture.stop()` resolves the instant the OS-side
        //      handle is gone — callers waiting on teardown don't pay the
        //      pre-warm cost.
        //   2. Pre-warm is gated on `this.preWarmEnabled`, which destroy()
        //      and disablePreWarm() flip to false. Without this gate, the
        //      old in-body pre-warm would happily construct a fresh native
        //      handle during app quit, device swap, or aborted meeting init
        //      — wasted work in every case, and on `before-quit` an actual
        //      bug (we'd grab the OS mic for a process about to die).
        const teardownPromise = new Promise<void>((resolve) => {
            setImmediate(() => {
                try {
                    monitor?.stop();
                } catch (e) {
                    console.error('[MicrophoneCapture] Error stopping (deferred):', e);
                }
                resolve();
            });
        });
        this._teardownPromise = teardownPromise;

        // After teardown settles: clear the in-flight slot, then conditionally
        // pre-warm. Order matters — the slot clear must happen before
        // pre-warm so that a fast `await stop(); start()` sequence sees a
        // clean state on entry to start(), and the pre-warm's `!this.monitor`
        // check below correctly skips if start() already constructed one.
        void teardownPromise.then(() => {
            if (this._teardownPromise === teardownPromise) {
                this._teardownPromise = null;
            }
            if (!this.preWarmEnabled) return;
            if (!RustMicCapture) return;
            if (this.monitor) return;  // start() raced ahead and already grabbed a fresh handle
            try {
                console.log('[MicrophoneCapture] Pre-warming native monitor for next meeting...');
                this.monitor = new RustMicCapture(this.deviceId);
            } catch (e) {
                // Emit a structured event so observers (main.ts handles
                // 'error', AudioRecovery, telemetry) see the failure
                // instead of it being buried in console output. The
                // defensive branch in start() (line ~64) will still retry
                // construction synchronously — at that point the failure
                // surfaces as a normal start error to the user. The event
                // here is purely for diagnostics on why the next start
                // suffered the main-thread HAL stall.
                console.error('[MicrophoneCapture] Pre-warm failed (next start() will retry):', e);
                // Snake_case to match sibling events on this class
                // (speech_ended, sample_rate_changed).
                this.emit('pre_warm_failed', e);
            }
        });

        this.emit('stop');
        return teardownPromise;
    }

    /**
     * Permanently disable the post-teardown pre-warm step.
     *
     * Callers from main.ts use this in three situations:
     *   - app `before-quit`: process is exiting; grabbing the OS mic now
     *     leaks a native handle past V8 teardown.
     *   - device swap (reconfigureAudio): the next start will construct a
     *     brand-new MicrophoneCapture for the new device — pre-warming the
     *     OLD device would build a handle that nothing ever uses.
     *   - aborted meeting init: the user cancelled before any audio reached
     *     the STT; there is no "next start" imminent enough to justify the
     *     cpal cold-start work.
     *
     * destroy() flips this flag automatically before awaiting stop(), so
     * callers using destroy() do not need a separate disablePreWarm() call.
     */
    public disablePreWarm(): void {
        this.preWarmEnabled = false;
    }

    public async destroy(): Promise<void> {
        // Disable pre-warm BEFORE awaiting stop(). Without this, the
        // teardown promise's .then() would happily reconstruct a fresh
        // RustMicCapture immediately after monitor.stop() — only to be
        // nulled again at the bottom of this method. Wasted FFI work on
        // every destroy, and a small window where this.monitor briefly
        // points at a handle the caller considers dead.
        this.preWarmEnabled = false;
        await this.stop();
        this.removeAllListeners();
        this.monitor = null;
    }
}
