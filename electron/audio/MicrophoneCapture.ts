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

    /**
     * Toggle Apple's voice processing (acoustic echo cancellation, noise
     * suppression, automatic gain control) on the underlying capture.
     * When enabled on macOS, the mic stream is routed through AVAudioEngine
     * with `setVoiceProcessingEnabled:` on the input node, so speaker bleed
     * is removed before the signal ever reaches STT. The flag takes effect
     * on the next `start()` call; if the capture is already running, the
     * native side tears it down so the next start rebuilds on the new
     * backend.
     *
     * Falls back to a soft no-op + log line if the loaded native binary is
     * older and doesn't expose `setVoiceProcessing` yet (e.g. mid-deploy).
     */
    public setVoiceProcessing(enabled: boolean): void {
        const native = this.monitor;
        if (native && typeof native.setVoiceProcessing === 'function') {
            try {
                native.setVoiceProcessing(enabled);
                console.log(`[MicrophoneCapture] Voice processing (AEC) ${enabled ? 'enabled' : 'disabled'} via native AU.`);
                return;
            } catch (e) {
                console.warn('[MicrophoneCapture] Native setVoiceProcessing failed:', e);
            }
        }
        console.log(
            `[MicrophoneCapture] AEC requested=${enabled} but native binary lacks setVoiceProcessing — rebuild native-module to pick up the new API.`,
        );
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
                    // Debug: log occasionally
                    if (Math.random() < 0.05) {
                        console.log(`[MicrophoneCapture] Emitting chunk: ${chunk.length} bytes to JS`);
                    }
                    this.emit('data', Buffer.from(chunk));
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
     * Stop capturing
     */
    public stop(): void {
        if (!this.isRecording) return;

        console.log('[MicrophoneCapture] Stopping capture...');
        try {
            this.monitor?.stop();
        } catch (e) {
            console.error('[MicrophoneCapture] Error stopping:', e);
        }

        // DO NOT destroy monitor here. Keep it alive for seamless restart.
        // this.monitor = null; 

        this.isRecording = false;
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
