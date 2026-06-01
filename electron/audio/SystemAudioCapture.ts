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
    // See MicrophoneCapture for the full rationale — same idempotent
    // teardown-tracking pattern. Awaiting stop() guarantees the CoreAudio
    // Tap / SCK / WASAPI handle has been released before the caller
    // constructs a new instance or restarts capture.
    private _teardownPromise: Promise<void> | null = null;

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
                    // POST-STOP GUARD: stop() defers the native monitor.stop() to
                    // setImmediate, so during that brief window the Rust DSP thread
                    // is still running and may invoke this callback. Drop chunks at
                    // the JS boundary so STT.finalize() can see "end of audio" and
                    // emit trailing finals deterministically.
                    if (!this.isRecording) return;
                    this.chunkCount++;
                    if (this.chunkCount <= 3 || this.chunkCount % 500 === 0) {
                        console.log(`[SystemAudioCapture] Chunk #${this.chunkCount}: ${chunk.length} bytes from Rust`);
                    }
                    // PERF: napi-rs already returns an owned Node Buffer from Rust's
                    // Buffer::from(bytes). The previous `Buffer.from(chunk)` was a
                    // redundant ~1.9KB copy per chunk × 50/sec = ~95KB/sec of GC pressure.
                    // Downstream (googleSTT.write) does not mutate the buffer.
                    this.emit('data', chunk);
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
            // ORPHAN-HANDLE FIX: monitor.start() can throw AFTER the Rust
            // constructor has allocated CoreAudio Tap / aggregate-device /
            // SCK resources and possibly spun up its DSP thread. The
            // previous code just nulled this.monitor, leaving those native
            // resources held by an unreachable JS object until GC ran —
            // potentially seconds to minutes later. If the user retries via
            // the recovery handler in main.ts, the FRESH monitor constructed
            // for the next start() races the dying one for the CoreAudio
            // HAL property-listener lock and produces "0 chunks in 8s".
            //
            // Stop the dying instance on the next tick so its native side
            // releases its handles deterministically. Run on setImmediate
            // (not synchronously) for two reasons:
            //   (a) we're already inside an exception handler — the user
            //       will see the 'error' emit at the bottom of this block,
            //       and we don't want a blocking native stop on the
            //       JS error path,
            //   (b) the partial init may still be holding non-reentrant
            //       Rust locks; deferring sidesteps that completely.
            const dying = this.monitor;
            this.monitor = null;
            if (dying) {
                setImmediate(() => {
                    try {
                        dying.stop();
                    } catch (e) {
                        console.error('[SystemAudioCapture] Error stopping orphaned monitor after failed start:', e);
                    }
                });
            }
            this.emit('error', error);
        }
    }

    /**
     * Stop capturing.
     *
     * PERF: The native `monitor.stop()` is a synchronous Rust call that waits for
     * the DSP thread to join AND tears down platform audio handles (CoreAudio
     * Tap / SCK / WASAPI). On Windows this can block 100–300ms. We flip
     * `isRecording = false` synchronously so the rest of the JS world sees the
     * stopped state immediately, then run the native stop on the next tick of
     * the libuv event loop. The Electron main process returns to the IPC caller
     * (renderer's "Stop" button) without waiting on the native teardown.
     *
     * Safety: once `isRecording = false`, no more `'data'` events will be wired
     * (the JS-side guard short-circuits) and the native callback is a no-op
     * after the Rust side flips its own atomic. So deferring the native stop is
     * race-free with respect to this object's external contract.
     */
    public stop(): Promise<void> {
        // Idempotent — see MicrophoneCapture.stop().
        if (!this.isRecording) {
            return this._teardownPromise ?? Promise.resolve();
        }

        // Cancel pending sample-rate polls before nulling the monitor to prevent
        // stale timers from reading a null or re-created monitor on the next start().
        for (const t of this.sampleRatePollTimers) clearTimeout(t);
        this.sampleRatePollTimers = [];

        console.log('[SystemAudioCapture] Stopping capture (deferred native teardown)...');
        this.isRecording = false;
        const monitor = this.monitor;
        // Null the field synchronously so the next start() takes the lazy-init
        // branch and constructs a fresh Rust monitor. The Rust monitor.stop()
        // tears down the CoreAudio Tap / aggregate device — calling start() on
        // the same Rust instance afterwards leaves the Tap in a half-initialised
        // state that produces zero chunks for 5–8s (manifest symptom on second
        // meeting: "produced 0 chunks in 8s" + STT handshake timeout).
        this.monitor = null;

        const teardownPromise = new Promise<void>((resolve) => {
            // Defer the blocking native call. setImmediate runs after the current
            // poll iteration completes, which is enough to release the Electron
            // main thread back to the IPC caller before the native teardown
            // begins. The resolve() at the end of this body is what makes
            // `await capture.stop()` mean "native HAL handle is now released".
            setImmediate(() => {
                try {
                    monitor?.stop();
                } catch (e) {
                    console.error('[SystemAudioCapture] Error stopping (deferred):', e);
                }
                resolve();
            });
        });
        this._teardownPromise = teardownPromise;
        void teardownPromise.then(() => {
            if (this._teardownPromise === teardownPromise) {
                this._teardownPromise = null;
            }
        });

        this.emit('stop');
        return teardownPromise;
    }

    /**
     * Permanently dispose this instance.
     * Stops capture, removes all event listeners, and releases the native monitor.
     * After destroy(), do not reuse this instance.
     */
    public async destroy(): Promise<void> {
        // Await teardown BEFORE removing listeners so in-flight Rust callbacks
        // (data / speech_ended) cannot fire on a wrapper the caller considers
        // dead. See MicrophoneCapture.destroy() for the parallel rationale.
        await this.stop();
        this.removeAllListeners();
        this.monitor = null;
    }
}
