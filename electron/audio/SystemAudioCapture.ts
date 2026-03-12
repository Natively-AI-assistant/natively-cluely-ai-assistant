import { EventEmitter } from 'events';
import { app } from 'electron';
import path from 'path';

let NativeModule: any = null;

try {
    NativeModule = require('natively-audio');
} catch (e) {
    console.error('[SystemAudioCapture] Failed to load native module:', e);
}

const { SystemAudioCapture: RustAudioCapture } = NativeModule || {};

export class SystemAudioCapture extends EventEmitter {
    private monitor: any = null;
    private isRecording: boolean = false;
    private deviceId: string | null = null;
    private detectedSampleRate: number = 16000;

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
        // Return 16000 default as we effectively downsample to this now
        // Force return 16000 to avoid stale binary issues reporting device rate
        return 16000;
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

            this.monitor.start((chunk: Uint8Array) => {
                // The native module sends raw PCM bytes (Uint8Array)
                if (chunk && chunk.length > 0) {
                    const buffer = Buffer.from(chunk);
                    if (Math.random() < 0.05) {
                        const prefix = buffer.slice(0, 10).toString('hex');
                        console.log(`[SystemAudioCapture] Chunk: ${buffer.length}b, Rate: ${this.detectedSampleRate}, Data(hex): ${prefix}...`);
                    }
                    this.emit('data', buffer);
                }
            });

            this.isRecording = true;
            this.emit('start');
        } catch (error) {
            console.error('[SystemAudioCapture] Failed to start:', error);
            this.emit('error', error);
        }
    }

    /**
     * Stop capturing
     */
    public stop(): void {
        if (!this.isRecording) return;

        console.log('[SystemAudioCapture] Stopping capture...');
        try {
            this.monitor?.stop();
        } catch (e) {
            console.error('[SystemAudioCapture] Error stopping:', e);
        }

        // Destroy monitor
        this.monitor = null;
        this.isRecording = false;
        this.emit('stop');
    }
}
