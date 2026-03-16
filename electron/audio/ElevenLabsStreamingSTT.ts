import { EventEmitter } from 'events';
import WebSocket from 'ws';

const ELEVENLABS_WS_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';

export class ElevenLabsStreamingSTT extends EventEmitter {
    private apiKey: string;
    private ws: WebSocket | null = null;
    private isActive = false;
    private shouldReconnect = false;
    private reconnectAttempts = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private inputSampleRate = 48000; // what the mic/system audio captures at
    private targetSampleRate = 16000; // what ElevenLabs Scribe v2 requires
    
    private buffer: Buffer[] = [];
    private isConnecting = false;
    private isSessionReady = false;

    constructor(apiKey: string) {
        super();
        this.apiKey = apiKey;
    }

    public setSampleRate(rate: number): void {
        this.inputSampleRate = rate;
        console.log(`[ElevenLabsStreaming] Input sample rate set to ${rate}Hz`);
        // We always downsample to 16000Hz for ElevenLabs
    }

    /** No-op - channel count is expected to be mono by ElevenLabs Scribe */
    public setAudioChannelCount(_count: number): void {}

    /** Recognition language (currently default/auto internally in Scribe v2) */
    public setRecognitionLanguage(_key: string): void {}

    /** No-op - credentials passed via API key */
    public setCredentials(_path: string): void {}

    public start(): void {
        if (this.isActive || this.ws) return;
        this.shouldReconnect = true;
        this.reconnectAttempts = 0;
        this.connect();
    }

    public stop(): void {
        this.shouldReconnect = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.close();
            this.ws = null;
        }
        this.isActive = false;
        this.isConnecting = false;
        this.isSessionReady = false;
        this.buffer = [];
        console.log('[ElevenLabsStreaming] Stopped');
    }

    /**
     * Write raw PCM audio data.
     * ElevenLabs WebSocket expects "input_audio_chunk" in base64 16-bit PCM.
     * Note: Input from Natively DSP is 32-bit Float PCM (F32).
     */
    public write(chunk: Buffer): void {
        if (!this.isActive) return;

        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isSessionReady) {
            this.buffer.push(chunk);
            if (this.buffer.length > 500) this.buffer.shift(); // Cap buffer size

            if (!this.isConnecting && this.shouldReconnect && !this.reconnectTimer) {
                console.log('[ElevenLabsStreaming] WS not ready. Lazy connecting on new audio...');
                this.connect();
            }
            return;
        }

        try {
            // Downsample from inputSampleRate (e.g. 48000) to 16000Hz
            // Input is 32-bit float PCM (F32), output needs to be 16-bit PCM (S16)
            const inputF32 = new Float32Array(chunk.buffer, chunk.byteOffset, chunk.byteLength / 4);
            const downsampleFactor = this.inputSampleRate / this.targetSampleRate;
            const outputLength = Math.floor(inputF32.length / downsampleFactor);
            const outputS16 = new Int16Array(outputLength);

            for (let i = 0; i < outputLength; i++) {
                // Simple decimation (take every Nth sample)
                const sample = inputF32[Math.floor(i * downsampleFactor)];
                // Convert F32 [-1,1] to S16 [-32768, 32767]
                outputS16[i] = Math.max(-32768, Math.min(32767, sample * 32767));
            }

            const base64 = Buffer.from(outputS16.buffer).toString('base64');
            // ElevenLabs Scribe v2 requires fields message_type and audio_base_64
            this.ws.send(JSON.stringify({
                message_type: 'input_audio_chunk',
                audio_base_64: base64,
            }));
        } catch (err) {
            console.warn('[ElevenLabsStreaming] write failed:', err);
        }
    }

    private connect(): void {
        if (this.isConnecting) return;
        this.isConnecting = true;
        this.isSessionReady = false;
        
        console.log(`[ElevenLabsStreaming] Connecting... key=${this.apiKey?.slice(0, 8)}...`);

        // raw WebSocket URL with parameters - always request 16000 for Scribe v2
        const url = `${ELEVENLABS_WS_URL}?model_id=scribe_v2_realtime&include_timestamps=true&sample_rate=${this.targetSampleRate}`;

        this.ws = new WebSocket(url, {
            headers: {
                'xi-api-key': this.apiKey,
            }
        });

        this.ws.on('open', () => {
            this.isActive = true;
            this.isConnecting = false;
            this.reconnectAttempts = 0;
            console.log('[ElevenLabsStreaming] Connected');
            
            // Note: ElevenLabs might require waiting for 'session_started' before sending.
            // We'll flush the buffer in 'session_started'.
        });

        this.ws.on('message', (data: WebSocket.RawData) => {
            try {
                const msg = JSON.parse(data.toString());

                switch (msg.message_type) {
                    case 'session_started':
                        console.log('[ElevenLabsStreaming] Session started:', msg.config);
                        this.isSessionReady = true;
                        
                        // Flush buffered audio now that session is strictly ready
                        while (this.buffer.length > 0) {
                            const chunk = this.buffer.shift();
                            if (chunk) {
                                this.write(chunk);
                            }
                        }
                        break;

                    case 'partial_transcript':
                        if (msg.text) {
                            this.emit('transcript', { 
                                text: msg.text, 
                                isFinal: false, 
                                confidence: 1.0 
                            });
                        }
                        break;

                    case 'committed_transcript':
                        if (msg.text) {
                            this.emit('transcript', { 
                                text: msg.text, 
                                isFinal: true, 
                                confidence: 1.0 
                            });
                        }
                        break;

                    case 'auth_error':
                        console.error('[ElevenLabsStreaming] Auth error — check key scope/permissions in ElevenLabs dashboard:', msg);
                        this.emit('error', msg);
                        // Stop reconnection loops for auth failures to save API credits
                        this.shouldReconnect = false;
                        if (this.ws) {
                            this.ws.close();
                        }
                        break;

                    default:
                        // Log other messages for debugging (e.g. metadata or unknowns)
                        if (msg.error) {
                            console.error('[ElevenLabsStreaming] Server error:', msg.error);
                            this.emit('error', msg.error);
                        } else {
                            console.log('[ElevenLabsStreaming] Received message:', msg.message_type);
                        }
                }
            } catch (err) {
                console.error('[ElevenLabsStreaming] Failed to parse message:', err);
            }
        });

        this.ws.on('close', (code, reason) => {
            // Do not force isActive=false; let write() trigger reconnect if isActive is still true
            this.isConnecting = false;
            this.isSessionReady = false;
            console.log(`[ElevenLabsStreaming] Closed: code=${code} reason=${reason}`);
            if (this.shouldReconnect && code !== 1000) {
                this.scheduleReconnect();
            }
        });

        this.ws.on('error', (err) => {
            console.error('[ElevenLabsStreaming] WS error:', err);
            this.emit('error', err);
        });
    }

    private scheduleReconnect(): void {
        if (!this.shouldReconnect) return;
        
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        this.reconnectAttempts++;
        
        console.log(`[ElevenLabsStreaming] Reconnecting in ${delay}ms...`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.shouldReconnect) {
                this.connect();
            }
        }, delay);
    }
}
