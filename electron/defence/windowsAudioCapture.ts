import crypto from 'crypto';
import { execFile } from 'child_process';
import { EventEmitter } from 'events';
import { promisify } from 'util';
import type { DefenceConfig } from './config';
import { loadNativeModule } from '../audio/nativeModuleLoader';

const execFileAsync = promisify(execFile);
const SAMPLE_RATE = 16_000;
const CHANNELS = 1;
const BYTES_PER_SAMPLE = 2;
const FRAME_MS = 20;
const FRAME_BYTES = SAMPLE_RATE * BYTES_PER_SAMPLE * FRAME_MS / 1000;
const PROCESS_PRIORITY = ['ms-teams.exe', 'teams.exe', 'zoom.exe', 'chrome.exe', 'msedge.exe'];

export interface WindowsAudioSegment {
  wav: Buffer;
  pcmBytes: number;
  durationMs: number;
  speechMs: number;
  captureLatencyMs: number;
  finalizationLatencyMs: number;
  source: DefenceConfig['input']['source'];
  processId?: number;
  processName?: string;
}

interface NativeCapture {
  start(data: (error: Error | null, chunk: Buffer) => void, speechEnded?: (error: Error | null, ended: boolean) => void): void;
  stop(): void;
  getSampleRate?(): number;
}

interface ProcessEntry { name: string; pid: number }

function parseTasklist(stdout: string): ProcessEntry[] {
  const rows: ProcessEntry[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^"([^"]+)","(\d+)"/);
    if (match) rows.push({ name: match[1].toLowerCase(), pid: Number(match[2]) });
  }
  return rows;
}

export async function resolveWindowsAudioProcess(processName: string, processId?: number): Promise<ProcessEntry> {
  if (processId) return { name: processName === 'auto' ? 'pid-selected' : processName.toLowerCase(), pid: processId };
  const { stdout } = await execFileAsync('tasklist.exe', ['/fo', 'csv', '/nh'], { windowsHide: true, timeout: 5_000 });
  const processes = parseTasklist(stdout);
  const requested = processName.trim().toLowerCase();
  const candidates = requested && requested !== 'auto'
    ? [requested.endsWith('.exe') ? requested : `${requested}.exe`]
    : PROCESS_PRIORITY;
  for (const name of candidates) {
    const matches = processes.filter(item => item.name === name).sort((a, b) => b.pid - a.pid);
    if (matches[0]) return matches[0];
  }
  throw new Error(`No supported target process is running (${candidates.join(', ')}).`);
}

export function encodeMonoPcmWav(pcm: Buffer, sampleRate = SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22); header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * CHANNELS * BYTES_PER_SAMPLE, 28);
  header.writeUInt16LE(CHANNELS * BYTES_PER_SAMPLE, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function rms(frame: Buffer): number {
  let sum = 0; const samples = Math.floor(frame.length / 2);
  for (let offset = 0; offset + 1 < frame.length; offset += 2) {
    const value = frame.readInt16LE(offset) / 32768; sum += value * value;
  }
  return samples ? Math.sqrt(sum / samples) : 0;
}

/** Local 16 kHz PCM VAD/utterance segmenter. Audio chunks never become finals. */
export class WindowsVadSegmenter extends EventEmitter {
  private remainder = Buffer.alloc(0);
  private preRoll: Buffer[] = [];
  private utterance: Buffer[] = [];
  private speaking = false;
  private speechMs = 0;
  private silenceMs = 0;
  private utteranceStartedAt = 0;
  private lastPartialAt = 0;
  private captureBufferLatencyMs = FRAME_MS;
  private recent = new Map<string, number>();

  constructor(private config: DefenceConfig['input']['vad'], private source: DefenceConfig['input']['source'], private target?: ProcessEntry) { super(); }

  push(chunk: Buffer, capturedAt = performance.now()): void {
    this.captureBufferLatencyMs = Math.max(FRAME_MS, Math.round(chunk.length / (SAMPLE_RATE * BYTES_PER_SAMPLE) * 1000));
    let bytes = this.remainder.length ? Buffer.concat([this.remainder, chunk]) : chunk;
    let offset = 0;
    while (offset + FRAME_BYTES <= bytes.length) {
      const frame = bytes.subarray(offset, offset + FRAME_BYTES); offset += FRAME_BYTES;
      this.frame(frame, capturedAt);
    }
    this.remainder = offset < bytes.length ? Buffer.from(bytes.subarray(offset)) : Buffer.alloc(0);
  }

  flush(): void { if (this.speaking) this.finalize(performance.now()); }

  private frame(frame: Buffer, capturedAt: number): void {
    const active = rms(frame) >= this.config.rmsThreshold;
    if (!this.speaking) {
      this.preRoll.push(Buffer.from(frame));
      while (this.preRoll.length > 10) this.preRoll.shift();
      if (!active) return;
      this.speaking = true; this.speechMs = FRAME_MS; this.silenceMs = 0;
      this.utteranceStartedAt = capturedAt; this.lastPartialAt = capturedAt;
      this.utterance = this.preRoll.splice(0);
    } else {
      this.utterance.push(Buffer.from(frame));
      if (active) { this.speechMs += FRAME_MS; this.silenceMs = 0; } else this.silenceMs += FRAME_MS;
    }
    const durationMs = this.utterance.length * FRAME_MS;
    if (capturedAt - this.lastPartialAt >= this.config.partialIntervalMs && this.speechMs >= this.config.minSpeechMs) {
      this.lastPartialAt = capturedAt;
      this.emit('partial', this.segment(capturedAt));
    }
    if (this.silenceMs >= this.config.silenceMs || durationMs >= this.config.maxUtteranceMs) this.finalize(capturedAt);
  }

  private segment(capturedAt: number): WindowsAudioSegment {
    const pcm = Buffer.concat(this.utterance);
    return {
      wav: encodeMonoPcmWav(pcm), pcmBytes: pcm.length, durationMs: this.utterance.length * FRAME_MS,
      speechMs: this.speechMs, captureLatencyMs: this.captureBufferLatencyMs,
      finalizationLatencyMs: this.silenceMs,
      source: this.source, processId: this.target?.pid, processName: this.target?.name,
    };
  }

  private finalize(capturedAt: number): void {
    const segment = this.segment(capturedAt);
    this.speaking = false; this.utterance = []; this.preRoll = []; this.silenceMs = 0; this.speechMs = 0;
    if (segment.speechMs < this.config.minSpeechMs) return;
    const digest = crypto.createHash('sha256').update(segment.wav.subarray(44)).digest('hex');
    const now = Date.now();
    for (const [key, timestamp] of this.recent) if (now - timestamp > this.config.duplicateWindowMs) this.recent.delete(key);
    if (this.recent.has(digest)) { this.emit('duplicate', segment); return; }
    this.recent.set(digest, now); this.emit('utterance', segment);
  }
}

/**
 * Windows capture facade. Process mode is fail-closed: it never falls back to
 * global loopback, so unrelated notifications cannot leak into a process-only session.
 */
export class WindowsAudioCaptureProvider extends EventEmitter {
  private capture?: NativeCapture;
  private segmenter?: WindowsVadSegmenter;
  private running = false;
  private counters = { audioChunkCount: 0, activeAudioChunkCount: 0, maxRms: 0, partialCount: 0, utteranceCount: 0, duplicateSuppressed: 0 };

  constructor(private config: DefenceConfig) { super(); }

  async start(): Promise<void> {
    if (this.running || this.config.input.mode !== 'windows-audio') return;
    if (process.platform !== 'win32') throw new Error('Windows audio input requires Windows.');
    const native: any = loadNativeModule();
    if (!native) throw new Error('The native audio module is unavailable.');
    let target: ProcessEntry | undefined;
    if (this.config.input.source === 'specific-process-loopback') {
      target = await resolveWindowsAudioProcess(this.config.input.processName, this.config.input.processId);
      if (!native.WindowsProcessAudioCapture) throw new Error('This native build does not include WASAPI application loopback capture. Rebuild native-module.');
      this.capture = new native.WindowsProcessAudioCapture(target.pid, true);
    } else if (this.config.input.source === 'system-loopback') {
      this.capture = new native.SystemAudioCapture(this.config.input.deviceId || null);
    } else if (this.config.input.source === 'windows-microphone') {
      this.capture = new native.MicrophoneCapture(this.config.input.deviceId || null);
    } else throw new Error('iphone-microphone is handled by the authenticated Companion fallback.');
    this.segmenter = new WindowsVadSegmenter(this.config.input.vad, this.config.input.source, target);
    this.segmenter.on('partial', value => { this.counters.partialCount++; this.emit('partial', value); });
    this.segmenter.on('utterance', value => { this.counters.utteranceCount++; this.emit('utterance', value); });
    this.segmenter.on('duplicate', value => { this.counters.duplicateSuppressed++; this.emit('duplicate', value); });
    const segmenter = this.segmenter;
    this.running = true;
    this.capture!.start((error, chunk) => {
      if (error) return this.emit('error', error);
      if (chunk?.length && this.running && this.segmenter === segmenter) {
        const chunkRms = rms(chunk);
        this.counters.audioChunkCount++;
        if (chunkRms >= this.config.input.vad.rmsThreshold) this.counters.activeAudioChunkCount++;
        this.counters.maxRms = Math.max(this.counters.maxRms, chunkRms);
        segmenter.push(chunk, performance.now());
      }
    }, error => { if (error) this.emit('error', error); });
    this.emit('status', { running: true, source: this.config.input.source, processId: target?.pid, processName: target?.name, includeProcessTree: Boolean(target), sampleRate: SAMPLE_RATE, channels: CHANNELS });
  }

  getDiagnostics(): Readonly<typeof this.counters> { return { ...this.counters }; }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    const capture = this.capture; const segmenter = this.segmenter;
    capture?.stop();
    segmenter?.flush();
    this.capture = undefined; this.segmenter = undefined;
    this.emit('status', { running: false, source: this.config.input.source });
  }
}
