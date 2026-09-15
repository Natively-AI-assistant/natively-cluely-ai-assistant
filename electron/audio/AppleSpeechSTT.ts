import { EventEmitter } from 'node:events';
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { app } from 'electron';
import { RECOGNITION_LANGUAGES } from '../config/languages';

type SpawnAppleSpeechProcess = (
  executable: string,
  args: string[],
  options: { stdio: ['pipe', 'pipe', 'pipe'] },
) => ChildProcessWithoutNullStreams;

type AppleSpeechTimer = ReturnType<typeof setTimeout>;
const MODEL_START_TIMEOUT_MS = 120_000;
const ASSET_INSTALL_TIMEOUT_MS = 15 * 60_000;

/** Runtime seams keep lifecycle tests independent of macOS and the real helper. */
export interface AppleSpeechRuntime {
  platform: NodeJS.Platform;
  osRelease: () => string;
  getLocale: () => string;
  spawn: SpawnAppleSpeechProcess;
  scheduleTimeout: (callback: () => void, delayMs: number) => AppleSpeechTimer;
  clearTimer: (timer: AppleSpeechTimer) => void;
}

/** Apple on-device STT, isolated from Electron/ONNX in a Swift child process. */
export class AppleSpeechSTT extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private language = 'auto';
  private sampleRate = 16000;
  private active = false;
  private ready = false;
  private generation = 0;
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private blocked = false;
  private installingAsset = false;
  private readonly executable: string;
  private readonly runtime: AppleSpeechRuntime;

  constructor(executable?: string, runtime: Partial<AppleSpeechRuntime> = {}) {
    super();
    this.executable = executable ?? (app.isPackaged
      ? path.join(process.resourcesPath, 'apple-speech', 'natively-apple-speech')
      : path.join(app.getAppPath(), 'resources', 'apple-speech', 'natively-apple-speech'));
    this.runtime = {
      platform: process.platform,
      osRelease: os.release,
      getLocale: () => app.getLocale(),
      spawn,
      scheduleTimeout: setTimeout,
      clearTimer: clearTimeout,
      ...runtime,
    };
  }
  setRecognitionLanguage(language: string) {
    const changed = language !== this.language;
    this.language = language;
    // The Swift transcriber fixes its locale during init. Restart an active
    // helper so a settings change takes effect immediately on both channels.
    if (changed && this.active) {
      this.stop();
      this.start();
    }
  }
  setCredentials(_path: string): void { /* Apple Speech uses no external credentials. */ }
  setSampleRate(rate: number) {
    if (!Number.isFinite(rate) || rate < 8000 || rate > 192000) return;
    if (rate !== this.sampleRate && this.pendingBytes) this.fail('Audio sample rate changed while buffered. Restart the session.');
    this.sampleRate = rate;
  }
  setAudioChannelCount(count: number) { if (count !== 1) this.fail('Apple Speech expects mono audio.'); }
  start() {
    if (this.active) return;
    this.active = true; this.ready = false; this.blocked = false; this.installingAsset = false;
    if (this.runtime.platform !== 'darwin' || Number(this.runtime.osRelease().split('.')[0]) < 25) {
      this.fail('Apple Speech requires macOS 26 or later.'); return;
    }
    const generation = ++this.generation;
    const child = this.child = this.runtime.spawn(this.executable, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    const current = () => this.child === child && generation === this.generation;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (!current()) return;
      output += chunk;
      if (output.length > 2_000_000) { this.fail('Apple Speech returned an oversized message.'); return; }
      let end: number;
      while ((end = output.indexOf('\n')) >= 0) {
        const line = output.slice(0, end); output = output.slice(end + 1);
        if (!line) continue;
        let message: any;
        try { message = JSON.parse(line); } catch { this.fail('Invalid Apple Speech response.'); return; }
        if (message.type === 'ready') {
          this.ready = true; this.installingAsset = false;
          if (this.startupTimer) this.runtime.clearTimer(this.startupTimer);
          this.startupTimer = null;
          this.emit('ready'); this.drain();
        } else if (message.type === 'transcript' && typeof message.text === 'string' && message.text.trim()) {
          this.emit('transcript', { text: message.text, isFinal: !!message.isFinal, confidence: 0.9 });
        } else if (message.type === 'error') { this.fail(String(message.message)); return; }
        else if (message.type === 'status') {
          if (message.phase === 'asset-download') {
            this.installingAsset = true;
            this.armStartupTimer(
              ASSET_INSTALL_TIMEOUT_MS,
              'Apple speech model download did not finish within 15 minutes. Check your network and try again.',
            );
          }
          this.emit('status', message.message);
        }
      }
    });
    // Never log audio or credentials. stderr is drained to prevent child blocking.
    child.stderr.on('data', () => {});
    child.stdin.on('error', (err) => { if (current() && this.active) this.fail(err.message); });
    child.on('error', (err) => { if (current()) this.fail(`Cannot start Apple Speech: ${err.message}`); });
    child.on('exit', (code, signal) => {
      if (current() && this.active) this.fail(`Apple Speech stopped unexpectedly (${signal ?? code}). Restart the session.`);
    });
    child.stdin.on('drain', () => { if (current()) { this.blocked = false; this.drain(); } });
    const locale = this.language === 'auto' ? this.runtime.getLocale()
      : RECOGNITION_LANGUAGES[this.language]?.bcp47 ?? this.language;
    child.stdin.write(JSON.stringify({ type: 'init', locale }) + '\n');
    this.armStartupTimer(
      MODEL_START_TIMEOUT_MS,
      'Apple speech model did not become ready within 120 seconds. Check model availability and try again.',
    );
  }
  write(chunk: Buffer) {
    if (!this.active || !chunk.length) return;
    if (chunk.length % 2) { this.fail('Invalid Int16 audio buffer.'); return; }
    this.pending.push(Buffer.from(chunk)); this.pendingBytes += chunk.length;
    // Bound buffering to ten seconds. Avoid dropping speech silently.
    const maxPendingBytes = this.sampleRate * 2 * 10;
    if (this.pendingBytes > maxPendingBytes) {
      if (this.installingAsset) {
        // Preserve the most recent audio without aborting the system download.
        // Once ready, transcription resumes from this bounded tail.
        while (this.pendingBytes > maxPendingBytes && this.pending.length) {
          this.pendingBytes -= this.pending.shift()!.length;
        }
        return;
      }
      this.fail('Apple Speech could not keep up with the audio. Restart after the language model is ready.'); return;
    }
    this.drain();
  }
  private drain() {
    while (this.ready && !this.blocked && this.child && this.pending.length) {
      const pcm = this.pending.shift()!; this.pendingBytes -= pcm.length;
      this.blocked = !this.child.stdin.write(JSON.stringify({ type: 'audio', sampleRate: this.sampleRate, pcm: pcm.toString('base64') }) + '\n');
    }
  }
  finalize(): boolean {
    if (!this.active || !this.ready || !this.child || this.pendingBytes || this.blocked) return false;
    this.child.stdin.write('{"type":"flush"}\n'); return true;
  }
  stop() {
    this.active = false; this.ready = false; this.installingAsset = false;
    if (this.startupTimer) this.runtime.clearTimer(this.startupTimer);
    this.startupTimer = null;
    this.pending = []; this.pendingBytes = 0;
    const child = this.child;
    // Retain listeners briefly to deliver the trailing final, unless a new
    // generation supersedes this process. Never reuse its input stream.
    if (child && !child.killed) {
      child.stdin.end('{"type":"stop"}\n');
      const timer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 5000);
      timer.unref(); child.once('exit', () => clearTimeout(timer));
    }
  }
  private armStartupTimer(delayMs: number, message: string) {
    if (this.startupTimer) this.runtime.clearTimer(this.startupTimer);
    this.startupTimer = this.runtime.scheduleTimeout(() => this.fail(message), delayMs);
    this.startupTimer.unref?.();
  }
  private fail(message: string) {
    if (!this.active) return;
    const child = this.child;
    this.stop(); this.child = null;
    child?.kill();
    this.emit('error', Object.assign(new Error(message), { code: 'local_stt_unavailable' }));
  }
}
