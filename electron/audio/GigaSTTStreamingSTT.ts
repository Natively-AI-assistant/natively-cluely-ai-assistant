/**
 * GigaSTTStreamingSTT - local Russian-first streaming STT via GigaSTT.
 *
 * GigaSTT runs as a separate local server:
 *   gigastt serve
 *
 * WebSocket protocol:
 *   server -> client: JSON { type: "ready" }
 *   client -> server: JSON { type: "configure", sample_rate: number }
 *   client -> server: PCM16 mono binary frames
 *   server -> client: JSON { type: "partial" | "final" | "error", text?: string }
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'child_process';

const WebSocket = require('ws');

const DEFAULT_GIGASTT_WS_URL = 'ws://127.0.0.1:9876/v1/ws';
const DEFAULT_GIGASTT_SAMPLE_RATE = 16_000;
const GIGASTT_SUPPORTED_SAMPLE_RATES = [8_000, 16_000, 24_000, 44_100, 48_000] as const;
const RECONNECT_BASE_DELAY_MS = 750;
const RECONNECT_MAX_DELAY_MS = 8_000;
const RECONNECT_MAX_ATTEMPTS = 8;
const MAX_BUFFERED_CHUNKS = 500;
const MANAGED_GIGASTT_POOL_SIZE = '2';
const DEFAULT_GIGASTT_PORT = 9876;
export const MIN_RELIABLE_GIGASTT_VERSION = '2.0.14';

let managedServerProcess: ChildProcessWithoutNullStreams | null = null;
let managedServerStartPromise: Promise<void> | null = null;
let unhealthyServerRecoveryPromise: Promise<boolean> | null = null;

function findOnPath(command: string): string | null {
    const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    const extensions = process.platform === 'win32'
        ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
        : [''];
    for (const dir of pathEntries) {
        for (const ext of extensions) {
            const candidate = path.join(dir, command.endsWith(ext) ? command : `${command}${ext}`);
            if (fs.existsSync(candidate)) return candidate;
        }
    }
    return null;
}

export type GigaSTTBinaryStatus = {
    found: boolean;
    path: string | null;
    candidates: string[];
    version?: string;
    minVersion: string;
    meetsMinimum: boolean;
    error?: string;
};

export function compareGigaSTTVersions(a: string, b: string): number {
    const left = a.split('.').map(part => Number.parseInt(part, 10) || 0);
    const right = b.split('.').map(part => Number.parseInt(part, 10) || 0);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const diff = (left[i] ?? 0) - (right[i] ?? 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

export function resolveGigaSTTBinary(): { path: string | null; candidates: string[]; error?: string } {
    const candidates = [
        process.env.NATIVELY_GIGASTT_BIN,
        '/opt/homebrew/bin/gigastt',
        '/usr/local/bin/gigastt',
        'gigastt',
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
        if (path.isAbsolute(candidate) || candidate.includes('/') || candidate.includes('\\')) {
            if (fs.existsSync(candidate)) return { path: candidate, candidates };
        } else {
            const resolved = findOnPath(candidate);
            if (resolved) return { path: resolved, candidates };
        }
    }
    return { path: null, candidates };
}

export function getGigaSTTBinaryStatus(): GigaSTTBinaryStatus {
    const resolved = resolveGigaSTTBinary();
    if (!resolved.path) {
        return {
            found: false,
            path: null,
            candidates: resolved.candidates,
            minVersion: MIN_RELIABLE_GIGASTT_VERSION,
            meetsMinimum: false,
            error: resolved.error,
        };
    }

    try {
        const output = execFileSync(resolved.path, ['--version'], { encoding: 'utf8', timeout: 3_000 }).trim();
        const version = output.match(/\b(\d+\.\d+\.\d+)\b/)?.[1];
        return {
            found: true,
            path: resolved.path,
            candidates: resolved.candidates,
            version,
            minVersion: MIN_RELIABLE_GIGASTT_VERSION,
            meetsMinimum: !!version && compareGigaSTTVersions(version, MIN_RELIABLE_GIGASTT_VERSION) >= 0,
            error: version ? undefined : `Could not parse GigaSTT version from: ${output}`,
        };
    } catch (error: any) {
        return {
            found: true,
            path: resolved.path,
            candidates: resolved.candidates,
            minVersion: MIN_RELIABLE_GIGASTT_VERSION,
            meetsMinimum: false,
            error: error?.message || 'Failed to execute gigastt --version',
        };
    }
}

export function ensureManagedGigaSTTServer(): Promise<void> {
    if (managedServerProcess && !managedServerProcess.killed) return Promise.resolve();
    if (managedServerStartPromise) return managedServerStartPromise;

    managedServerStartPromise = new Promise((resolve, reject) => {
        const binary = getGigaSTTBinaryStatus();
        if (!binary.path) {
            managedServerStartPromise = null;
            reject(new Error('GigaSTT binary not found. Install with: brew install ekhodzitsky/gigastt/gigastt'));
            return;
        }
        if (!binary.meetsMinimum) {
            managedServerStartPromise = null;
            reject(new Error(
                `GigaSTT ${binary.version || 'unknown'} is too old for stable Russian STT. ` +
                `Install GigaSTT ${MIN_RELIABLE_GIGASTT_VERSION} or newer.`,
            ));
            return;
        }

        const logDir = path.join(os.homedir(), '.gigastt');
        fs.mkdirSync(logDir, { recursive: true });
        const log = fs.createWriteStream(path.join(logDir, 'natively-gigastt.log'), { flags: 'a' });

        const child = spawn(binary.path, ['serve', '--pool-size', MANAGED_GIGASTT_POOL_SIZE], {
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: false,
            env: {
                ...process.env,
                RUST_LOG: process.env.RUST_LOG || 'info',
            },
        });
        managedServerProcess = child;

        child.stdout.pipe(log, { end: false });
        child.stderr.pipe(log, { end: false });
        child.on('error', err => {
            managedServerProcess = null;
            managedServerStartPromise = null;
            reject(err);
        });
        child.on('exit', code => {
            managedServerProcess = null;
            managedServerStartPromise = null;
            log.write(`[Natively] gigastt exited with code ${code}\n`);
        });

        waitForGigaSTTReady(DEFAULT_GIGASTT_WS_URL, 30_000)
            .then(() => resolve())
            .catch(reject)
            .finally(() => {
                managedServerStartPromise = null;
            });
    });

    return managedServerStartPromise;
}

function waitForGigaSTTReady(wsUrl: string, timeoutMs: number): Promise<void> {
    const startedAt = Date.now();
    const readyUrl = wsUrl.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:').replace(/\/v1\/ws$/, '/ready');

    return new Promise((resolve, reject) => {
        const poll = () => {
            const req = http.get(readyUrl, res => {
                const ok = res.statusCode === 200;
                res.resume();
                if (ok) {
                    resolve();
                    return;
                }
                retry();
            });
            req.on('error', retry);
            req.setTimeout(1_000, () => {
                req.destroy();
                retry();
            });
        };
        const retry = () => {
            if (Date.now() - startedAt > timeoutMs) {
                reject(new Error(`GigaSTT server did not become ready within ${timeoutMs}ms`));
                return;
            }
            setTimeout(poll, 500);
        };
        poll();
    });
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getGigaSTTListenerPids(port: number): number[] {
    if (process.platform === 'win32') return [];
    try {
        const output = execFileSync('/usr/sbin/lsof', [
            '-tiTCP:' + String(port),
            '-sTCP:LISTEN',
            '-n',
            '-P',
        ], { encoding: 'utf8', timeout: 2_000 });
        return output
            .split(/\s+/)
            .map(pid => Number.parseInt(pid, 10))
            .filter(pid => Number.isFinite(pid) && pid > 0);
    } catch {
        return [];
    }
}

function isGigaSTTServeProcess(pid: number): boolean {
    if (process.platform === 'win32') return false;
    try {
        const output = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'comm=', '-o', 'args='], {
            encoding: 'utf8',
            timeout: 2_000,
        });
        return /(^|[/\s])gigastt(\s|$)/.test(output) && /\bserve\b/.test(output);
    } catch {
        return false;
    }
}

async function waitForGigaSTTPortToClose(port: number, timeoutMs: number): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (getGigaSTTListenerPids(port).length === 0) return;
        await sleep(150);
    }
}

async function recoverUnhealthyGigaSTTServer(port: number = DEFAULT_GIGASTT_PORT): Promise<boolean> {
    if (unhealthyServerRecoveryPromise) return unhealthyServerRecoveryPromise;

    unhealthyServerRecoveryPromise = (async () => {
        let killed = false;

        if (managedServerProcess && !managedServerProcess.killed) {
            try {
                managedServerProcess.kill('SIGTERM');
                killed = true;
            } catch {
                // Fall through to listener PID cleanup below.
            }
        }

        for (const pid of getGigaSTTListenerPids(port)) {
            if (!isGigaSTTServeProcess(pid)) continue;
            try {
                process.kill(pid, 'SIGTERM');
                killed = true;
            } catch {
                // The process may have exited between lsof and kill.
            }
        }

        if (!killed) return false;

        await waitForGigaSTTPortToClose(port, 5_000);
        await ensureManagedGigaSTTServer();
        return true;
    })().finally(() => {
        unhealthyServerRecoveryPromise = null;
    });

    return unhealthyServerRecoveryPromise;
}

export class GigaSTTStreamingSTT extends EventEmitter {
    private ws: any = null;
    private isActive = false;
    private isOpen = false;
    private isConnecting = false;
    private shouldReconnect = false;
    private reconnectAttempts = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private buffer: Buffer[] = [];
    private sampleRate = DEFAULT_GIGASTT_SAMPLE_RATE;
    private configuredSampleRate: number | null = null;
    private numChannels = 1;
    private readonly url: string;
    private readonly label: string;
    private autoStartAttempted = false;
    private unhealthyServerRecoveryAttempted = false;

    constructor(label?: string, url?: string) {
        super();
        this.label = label || 'default';
        this.url = url || process.env.NATIVELY_GIGASTT_WS_URL || DEFAULT_GIGASTT_WS_URL;
    }

    public setSampleRate(rate: number): void {
        if (this.sampleRate === rate) return;
        this.sampleRate = rate;
        console.log(`[GigaSTT/${this.label}] Sample rate set to ${rate}Hz`);
        if (this.isActive && this.isOpen && this.ws?.readyState === WebSocket.OPEN) {
            this.sendConfigure();
        }
    }

    public setAudioChannelCount(count: number): void {
        if (this.numChannels === count) return;
        this.numChannels = count;
        console.log(`[GigaSTT/${this.label}] Channel count set to ${count}`);
    }

    public setRecognitionLanguage(key: string): void {
        if (key !== 'auto' && key !== 'russian' && key !== 'ru-RU') {
            console.warn(`[GigaSTT/${this.label}] GigaSTT is Russian-only; ignoring recognition language "${key}"`);
        }
    }

    public setCredentials(_path: string): void {
        // Local server provider; no credentials.
    }

    public start(): void {
        if (this.isActive) return;
        this.isActive = true;
        this.shouldReconnect = true;
        this.reconnectAttempts = 0;
        this.buffer = [];
        this.connect();
    }

    public stop(): void {
        this.shouldReconnect = false;
        this.isActive = false;
        this.isConnecting = false;
        this.isOpen = false;
        this.configuredSampleRate = null;
        this.clearReconnectTimer();
        this.buffer = [];
        if (this.ws) {
            try { this.ws.close(); } catch { /* ignore shutdown errors */ }
            try { this.ws.terminate?.(); } catch { /* ignore shutdown errors */ }
            this.ws = null;
        }
        console.log(`[GigaSTT/${this.label}] Stopped`);
    }

    public finalize(): void {
        // GigaSTT emits finals from its own streaming VAD; no explicit finalize command.
    }

    public notifySpeechEnded(): void {
        // GigaSTT performs server-side endpointing.
    }

    public write(chunk: Buffer): void {
        if (!this.isActive) return;

        const pcm = this.preparePcm(chunk);
        if (!this.isOpen || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.buffer.push(pcm);
            if (this.buffer.length > MAX_BUFFERED_CHUNKS) this.buffer.shift();
            if (!this.isConnecting && this.shouldReconnect && !this.reconnectTimer) {
                this.connect();
            }
            return;
        }

        try {
            this.ws.send(pcm);
        } catch (err: any) {
            console.error(`[GigaSTT/${this.label}] Send error:`, err?.message || err);
        }
    }

    private connect(): void {
        if (!this.isActive || this.isConnecting || this.isOpen) return;
        this.isConnecting = true;
        this.configuredSampleRate = null;

        console.log(`[GigaSTT/${this.label}] Connecting to ${this.url}...`);
        const ws = new WebSocket(this.url);
        this.ws = ws;

        ws.on('open', () => {
            if (this.ws !== ws) return;
            console.log(`[GigaSTT/${this.label}] WebSocket opened; waiting for server ready`);
        });

        ws.on('message', (data: Buffer | string) => {
            this.handleMessage(data);
        });

        ws.on('error', (err: Error) => {
            if (this.ws !== ws) return;
            const code = (err as any)?.code;
            if (code === 'ECONNREFUSED') {
                this.isConnecting = false;
                this.isOpen = false;
                if (this.ws === ws) this.ws = null;
                if (this.autoStartAttempted) {
                    console.warn(`[GigaSTT/${this.label}] Server is still starting; retrying connection`);
                    this.scheduleReconnect();
                    return;
                }
                this.autoStartAttempted = true;
                console.warn(`[GigaSTT/${this.label}] Server is not running; starting managed GigaSTT server with --pool-size ${MANAGED_GIGASTT_POOL_SIZE}`);
                ensureManagedGigaSTTServer()
                    .then(() => {
                        if (!this.isActive) return;
                        this.connect();
                    })
                    .catch(startErr => {
                        console.error(`[GigaSTT/${this.label}] Failed to start managed server:`, startErr?.message || startErr);
                        this.emit('error', startErr instanceof Error ? startErr : new Error(String(startErr)));
                    });
                return;
            }
            console.error(`[GigaSTT/${this.label}] WebSocket error:`, err.message);
            this.emit('error', err);
        });

        ws.on('close', (code: number, reason: Buffer) => {
            if (this.ws !== ws) return;
            const closedBeforeReady = !this.isOpen;
            this.ws = null;
            this.isConnecting = false;
            this.isOpen = false;
            this.configuredSampleRate = null;
            const reasonText = reason?.length ? reason.toString('utf8') : 'no reason';
            console.log(`[GigaSTT/${this.label}] WebSocket closed code=${code} reason=${reasonText}`);
            if (
                closedBeforeReady &&
                code === 1006 &&
                this.shouldReconnect &&
                this.isActive &&
                !this.unhealthyServerRecoveryAttempted
            ) {
                this.unhealthyServerRecoveryAttempted = true;
                console.warn(`[GigaSTT/${this.label}] WebSocket closed before ready; restarting unhealthy GigaSTT server if it owns port ${DEFAULT_GIGASTT_PORT}`);
                recoverUnhealthyGigaSTTServer()
                    .then(recovered => {
                        if (!this.isActive || !this.shouldReconnect) return;
                        if (recovered) {
                            this.reconnectAttempts = 0;
                            this.autoStartAttempted = true;
                            this.connect();
                            return;
                        }
                        this.scheduleReconnect();
                    })
                    .catch(err => {
                        console.error(`[GigaSTT/${this.label}] Failed to recover unhealthy server:`, err?.message || err);
                        this.scheduleReconnect();
                    });
                return;
            }
            if (this.shouldReconnect && this.isActive) {
                this.scheduleReconnect();
            }
        });
    }

    private handleMessage(data: Buffer | string): void {
        let msg: any;
        try {
            const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
            msg = JSON.parse(text);
        } catch {
            return;
        }

        if (msg.type === 'ready') {
            console.log(`[GigaSTT/${this.label}] Server ready`, { model: msg.model, sampleRate: msg.sample_rate });
            this.isConnecting = false;
            this.isOpen = true;
            this.unhealthyServerRecoveryAttempted = false;
            this.reconnectAttempts = 0;
            this.sendConfigure();
            this.flushBuffer();
            return;
        }

        if (msg.type === 'error') {
            const message = msg.message || 'GigaSTT server error';
            console.error(`[GigaSTT/${this.label}] Server error:`, message, msg);
            this.emit('error', new Error(message));
            return;
        }

        if ((msg.type === 'partial' || msg.type === 'final') && typeof msg.text === 'string') {
            const text = msg.text.trim();
            if (!text) return;
            this.emit('transcript', {
                text,
                isFinal: msg.type === 'final',
                confidence: 0.95,
            });
        }
    }

    private sendConfigure(): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const effectiveSampleRate = this.getEffectiveSampleRate();
        if (this.configuredSampleRate === effectiveSampleRate) return;

        const payload = { type: 'configure', sample_rate: effectiveSampleRate };
        try {
            this.ws.send(JSON.stringify(payload));
            this.configuredSampleRate = effectiveSampleRate;
            console.log(`[GigaSTT/${this.label}] Configured stream`, payload);
        } catch (err: any) {
            console.error(`[GigaSTT/${this.label}] Configure error:`, err?.message || err);
        }
    }

    private flushBuffer(): void {
        if (!this.ws || !this.isOpen) return;
        const pending = this.buffer;
        this.buffer = [];
        for (const chunk of pending) {
            try { this.ws.send(chunk); } catch { break; }
        }
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer) return;
        if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
            const err = new Error(`GigaSTT server unavailable at ${this.url}. Start it with: gigastt serve`);
            this.emit('error', err);
            return;
        }
        const delay = Math.min(RECONNECT_BASE_DELAY_MS * (2 ** this.reconnectAttempts), RECONNECT_MAX_DELAY_MS);
        this.reconnectAttempts++;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, delay);
    }

    private clearReconnectTimer(): void {
        if (!this.reconnectTimer) return;
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
    }

    private preparePcm(chunk: Buffer): Buffer {
        const cleanChunk = chunk.length % 2 === 0 ? chunk : chunk.subarray(0, chunk.length - 1);
        const mono = this.numChannels <= 1 ? cleanChunk : this.downmixToMono(cleanChunk, this.numChannels);
        const effectiveSampleRate = this.getEffectiveSampleRate();
        if (this.sampleRate === effectiveSampleRate) return mono;
        return this.resamplePcm16(mono, this.sampleRate, effectiveSampleRate);
    }

    private getEffectiveSampleRate(): number {
        if (GIGASTT_SUPPORTED_SAMPLE_RATES.includes(this.sampleRate as any)) {
            return this.sampleRate;
        }

        let closest = DEFAULT_GIGASTT_SAMPLE_RATE;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const candidate of GIGASTT_SUPPORTED_SAMPLE_RATES) {
            const distance = Math.abs(candidate - this.sampleRate);
            if (distance < bestDistance) {
                closest = candidate;
                bestDistance = distance;
            }
        }

        console.warn(`[GigaSTT/${this.label}] Unsupported sample rate ${this.sampleRate}Hz; resampling to ${closest}Hz`);
        return closest;
    }

    private downmixToMono(chunk: Buffer, channels: number): Buffer {
        if (channels <= 1) return chunk;
        const frames = Math.floor(chunk.length / 2 / channels);
        const out = Buffer.alloc(frames * 2);
        for (let frame = 0; frame < frames; frame++) {
            let sum = 0;
            for (let ch = 0; ch < channels; ch++) {
                sum += chunk.readInt16LE((frame * channels + ch) * 2);
            }
            out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sum / channels))), frame * 2);
        }
        return out;
    }

    private resamplePcm16(chunk: Buffer, fromRate: number, toRate: number): Buffer {
        if (fromRate <= 0 || fromRate === toRate) return chunk;
        const inputSamples = Math.floor(chunk.length / 2);
        const outputSamples = Math.max(1, Math.round(inputSamples * toRate / fromRate));
        const out = Buffer.alloc(outputSamples * 2);
        const ratio = fromRate / toRate;
        for (let i = 0; i < outputSamples; i++) {
            const srcPos = i * ratio;
            const srcIdx = Math.floor(srcPos);
            const frac = srcPos - srcIdx;
            const s0 = chunk.readInt16LE(Math.min(srcIdx, inputSamples - 1) * 2);
            const s1 = chunk.readInt16LE(Math.min(srcIdx + 1, inputSamples - 1) * 2);
            const sample = Math.round(s0 + frac * (s1 - s0));
            out.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), i * 2);
        }
        return out;
    }
}
