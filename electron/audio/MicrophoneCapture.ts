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
            const error = new Error('[MicrophoneCapture] Cannot start: Rust module missing');
            console.error(error.message);
            throw error;
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
                throw e;
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
            throw error;
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
    public stop(): void {
        if (!this.isRecording) return;

        console.log('[MicrophoneCapture] Stopping capture (deferred native teardown)...');
        this.isRecording = false;
        const monitor = this.monitor;
        setImmediate(() => {
            try {
                monitor?.stop();
            } catch (e) {
                console.error('[MicrophoneCapture] Error stopping (deferred):', e);
            }
        });
        this.emit('stop');
    }

    public destroy(): void {
        this.stop();
        // Remove all listeners BEFORE nulling monitor.
        // In-flight Rust callbacks may still arrive (via napi's scheduler)
        // after stop() returns. Clearing listeners prevents them from emitting
        // events on an object the caller considers dead.
        this.removeAllListeners();
        this.monitor = null;
    }
}
