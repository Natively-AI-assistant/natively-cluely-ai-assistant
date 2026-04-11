import { EventEmitter } from 'events';
import { loadNativeModule } from './nativeModuleLoader';

// RustAudioCapture is the native Rust class (napi-rs) that captures system audio.
// May be null if the .node binary isn't available — constructor logs an error in that case.
const NativeModule: any = loadNativeModule();
const { SystemAudioCapture: RustAudioCapture } = NativeModule || {};

export class SystemAudioCapture extends EventEmitter {
    private isRecording: boolean = false;
    private deviceId: string | null = null;
    private detectedSampleRate: number = 48000;
    private monitor: any = null;
    private chunkCount: number = 0;
    private sampleRatePollTimers: NodeJS.Timeout[] = [];

    constructor(deviceId?: string | null) {
        super();
        this.deviceId = deviceId || null;
        if (!RustAudioCapture) {
            console.error('[SystemAudioCapture] Rust class implementation not found.');
        } else {
            // LAZY INIT: Don't create native monitor here - it causes 1-second audio mute + quality drop
            // The monitor will be created in start() when the meeting actually begins
            console.log(`[SystemAudioCapture] Initialized (lazy). Device ID: ${this.deviceId || 'default'}`);
        }
    }

    public getSampleRate(): number {
        if (this.monitor) {
            // NAPI-RS V3 auto-converts Rust snake_case to camelCase
            if (typeof this.monitor.getSampleRate === 'function') {
                const nativeRate = this.monitor.getSampleRate();
                if (nativeRate !== this.detectedSampleRate) {
                    console.log(`[SystemAudioCapture] Real native rate: ${nativeRate}`);
                    this.detectedSampleRate = nativeRate;
                }
                return nativeRate;
            } else if (typeof this.monitor.get_sample_rate === 'function') {
                const nativeRate = this.monitor.get_sample_rate();
                if (nativeRate !== this.detectedSampleRate) {
                    console.log(`[SystemAudioCapture] Real native rate: ${nativeRate}`);
                    this.detectedSampleRate = nativeRate;
                }
                return nativeRate;
            }
        }
        return this.detectedSampleRate;
    }

    /**
     * Start capturing audio
     */
    public start(): void {
        if (this.isRecording) return;

        if (!RustAudioCapture) {
            console.error('[SystemAudioCapture] Cannot start: Rust module missing');
            return;
        }

        // LAZY INIT: Create monitor here when meeting starts (not in constructor)
        // This prevents the 1-second audio mute + quality drop at app launch
        if (!this.monitor) {
            console.log('[SystemAudioCapture] Creating native monitor (lazy init)...');
            try {
                this.monitor = new RustAudioCapture(this.deviceId);
            } catch (e) {
                console.error('[SystemAudioCapture] Failed to create native monitor:', e);
                this.emit('error', e);
                return;
            }
        }

        try {
            console.log('[SystemAudioCapture] Starting native capture...');
            this.chunkCount = 0;

            this.isRecording = true; // Set BEFORE start() to prevent re-entrant calls

            this.monitor.start((err: Error | null, chunk: Buffer) => {
                // napi v3 ThreadsafeFunction passes (err, arg) format
                if (err) {
                    console.error('[SystemAudioCapture] Callback error:', err);
                    this.isRecording = false; // Allow recovery via restart
                    this.emit('error', err);
                    return;
                }
                if (chunk && chunk.length > 0) {
                    this.chunkCount++;
                    if (this.chunkCount <= 3 || this.chunkCount % 200 === 0) {
                        console.log(`[SystemAudioCapture] Chunk #${this.chunkCount}: ${chunk.length} bytes from Rust`);
                    }
                    const buffer = Buffer.from(chunk);
                    this.emit('data', buffer);
                }
            }, (err: Error | null, _ended: boolean) => {
                // Speech-ended callback from Rust SilenceSuppressor.
                // _ended is always `true` when fired (Rust only invokes on speech→silence transition).
                if (err) {
                    console.error('[SystemAudioCapture] Speech ended callback error:', err);
                    return;
                }
                this.emit('speech_ended');
            });

            // getSampleRate MUST be called AFTER start() — background init updates
            // the atomic once SCK/CoreAudio initialises (~5-7s). Reading before start()
            // always returns the constructor default (48000), not the real hardware rate.
            // Fetch real sample rate as soon as monitor starts
            if (typeof this.monitor.getSampleRate === 'function' || typeof this.monitor.get_sample_rate === 'function') {
                const pollRate = () => {
                    const rate = typeof this.monitor?.getSampleRate === 'function' 
                        ? this.monitor.getSampleRate() 
                        : this.monitor?.get_sample_rate?.();
                    if (rate && rate !== this.detectedSampleRate) {
                        this.detectedSampleRate = rate;
                        console.log(`[SystemAudioCapture] Detected sample rate: ${rate}Hz`);
                        this.emit('sample_rate_changed', rate);
                    }
                };
                
                // Poll quickly initially, then once after SCK is likely fully initialized.
                // Store timer IDs so stop() can cancel them if called before they fire —
                // prevents a stale poll from reading a null or re-created monitor instance.
                this.sampleRatePollTimers.push(setTimeout(pollRate, 1000));
                this.sampleRatePollTimers.push(setTimeout(pollRate, 8000));
            }

            this.emit('start');
        } catch (error) {
            console.error('[SystemAudioCapture] Failed to start:', error);
            this.isRecording = false;
            this.monitor = null; // Force recreation on next start() — device may have changed
            this.emit('error', error);
        }
    }

    /**
     * Stop capturing
     */
    public stop(): void {
        if (!this.isRecording) return;

        // Cancel pending sample-rate polls before nulling the monitor to prevent
        // stale timers from reading a null or re-created monitor on the next start().
        for (const t of this.sampleRatePollTimers) clearTimeout(t);
        this.sampleRatePollTimers = [];

        console.log('[SystemAudioCapture] Stopping capture...');
        try {
            this.monitor?.stop();
        } catch (e) {
            console.error('[SystemAudioCapture] Error stopping:', e);
        }

        // DO NOT destroy monitor here. Keep it alive for seamless restart.
        // this.monitor = null;  // ← REMOVED — was causing Windows WASAPI device contention

        this.isRecording = false;
        this.emit('stop');
    }

    /**
     * Permanently dispose this instance.
     * Stops capture, removes all event listeners, and releases the native monitor.
     * After destroy(), do not reuse this instance.
     */
    public destroy(): void {
        this.stop();
        // Clear listeners BEFORE nulling monitor. In-flight Rust callbacks (e.g., data
        // or speech_ended delivered via napi scheduler) must not fire after disposal.
        this.removeAllListeners();
        this.monitor = null;
    }
}
