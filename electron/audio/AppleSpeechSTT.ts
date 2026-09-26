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
/** Any letter or digit in any script — punctuation-only finals carry no speech. */
const HAS_SPEECH_CONTENT = /[\p{L}\p{N}]/u;

/** Runtime seams keep lifecycle tests independent of macOS and the real helper. */
export interface AppleSpeechRuntime {
  platform: NodeJS.Platform;
  osRelease: () => string;
  getLocale: () => string;
  spawn: SpawnAppleSpeechProcess;
  scheduleTimeout: (callback: () => void, delayMs: number) => AppleSpeechTimer;
  clearTimer: (timer: AppleSpeechTimer) => void;
}

/** Locale availability for the Settings language picker. */
export interface AppleSpeechLocales {
  /** False when the helper is missing, the OS is too old, or the Mac cannot run it. */
  available: boolean;
  /** BCP-47 locales Apple can transcribe at all. */
  supported: string[];
  /** BCP-47 locales already on disk — the rest download on first use. */
  installed: string[];
  /**
   * Locales this app currently holds allocated. Apple caps this at
   * `maxReserved` (5) and an install permanently takes a slot, so once it is
   * full every further download fails with "Too many allocated locales".
   */
  reserved: string[];
  maxReserved: number;
}

/** Path to the compiled helper (packaged vs development). */
export function appleSpeechExecutablePath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'apple-speech', 'natively-apple-speech')
    : path.join(app.getAppPath(), 'resources', 'apple-speech', 'natively-apple-speech');
}

const UNAVAILABLE: AppleSpeechLocales = { available: false, supported: [], installed: [], reserved: [], maxReserved: 0 };

/**
 * One-shot `--locales` query, so Settings can show which languages Apple can
 * transcribe and which still need a download instead of letting a user pick a
 * dead end and find out mid-meeting.
 *
 * Never throws: every failure (non-macOS, helper not built, old OS, malformed
 * output, hang) degrades to `available: false`, which the renderer reads as
 * "don't restrict and don't badge" — the pre-existing behaviour.
 */
export function readAppleSpeechLocales(
  executable = appleSpeechExecutablePath(),
  deps: { platform?: NodeJS.Platform; spawn?: typeof spawn; timeoutMs?: number } = {},
): Promise<AppleSpeechLocales> {
  const platform = deps.platform ?? process.platform;
  if (platform !== 'darwin') return Promise.resolve(UNAVAILABLE);
  const spawnFn = deps.spawn ?? spawn;
  const timeoutMs = deps.timeoutMs ?? 10_000;
  return new Promise<AppleSpeechLocales>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnFn(executable, ['--locales'], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve(UNAVAILABLE); return;
    }
    let out = '';
    let settled = false;
    const finish = (value: AppleSpeechLocales) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { if (child.exitCode === null) child.kill(); } catch { /* already gone */ }
      resolve(value);
    };
    const timer = setTimeout(() => finish(UNAVAILABLE), timeoutMs);
    timer.unref?.();
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      out += chunk;
      if (out.length > 200_000) finish(UNAVAILABLE);
    });
    child.on('error', () => finish(UNAVAILABLE));
    child.on('close', () => {
      for (const line of out.split('\n')) {
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          if (message?.type === 'locales') {
            finish({
              available: !!message.available,
              supported: Array.isArray(message.supported) ? message.supported.map(String) : [],
              installed: Array.isArray(message.installed) ? message.installed.map(String) : [],
              reserved: Array.isArray(message.reserved) ? message.reserved.map(String) : [],
              maxReserved: Number.isFinite(message.maxReserved) ? Number(message.maxReserved) : 0,
            });
            return;
          }
        } catch { /* not our line */ }
      }
      finish(UNAVAILABLE);
    });
  });
}

/**
 * Download one language asset, reporting progress as a 0..1 fraction.
 *
 * Apple reports a fraction and nothing else: `Progress.totalUnitCount` is 1
 * rather than a byte count and `localizedAdditionalDescription` is empty, so
 * there is no transfer size to surface — only how far along it is. Measured on
 * disk the assets run ~335-390 MB each, but that is an observation of
 * /System/Library/AssetsV2, not an API, so it is not reported as fact here.
 *
 * Resolves `{ ok: true }` when the asset is installed (including when it
 * already was), otherwise `{ ok: false, error }`. Never throws.
 */
export function installAppleSpeechLocale(
  locale: string,
  onProgress: (fraction: number) => void,
  executable = appleSpeechExecutablePath(),
  deps: { platform?: NodeJS.Platform; spawn?: typeof spawn } = {},
): Promise<{ ok: boolean; error?: string }> {
  const platform = deps.platform ?? process.platform;
  if (platform !== 'darwin') return Promise.resolve({ ok: false, error: 'Apple Speech is macOS-only.' });
  const spawnFn = deps.spawn ?? spawn;
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnFn(executable, ['--install', locale], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e: any) {
      resolve({ ok: false, error: e?.message ?? 'Could not start Apple Speech.' }); return;
    }
    let out = '';
    let done = false;
    let failure: string | undefined;
    let settled = false;
    const finish = (value: { ok: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      out += chunk;
      let end: number;
      while ((end = out.indexOf('\n')) >= 0) {
        const line = out.slice(0, end); out = out.slice(end + 1);
        if (!line.trim()) continue;
        try {
          const m = JSON.parse(line);
          if (m?.type === 'install-progress' && typeof m.fraction === 'number') {
            onProgress(Math.max(0, Math.min(1, m.fraction)));
          } else if (m?.type === 'install-done') {
            done = true;
          } else if (m?.type === 'error') {
            failure = String(m.message ?? 'Apple Speech could not install the language.');
          }
        } catch { /* not our line */ }
      }
    });
    child.on('error', (e) => finish({ ok: false, error: e.message }));
    child.on('close', () => {
      if (done) finish({ ok: true });
      else finish({ ok: false, error: failure ?? 'The language download did not finish.' });
    });
  });
}

/**
 * Give up one allocated locale, at the user's explicit request.
 *
 * DESTRUCTIVE: releasing removes the asset from `installedLocales`, so the
 * language must be downloaded again to be used. It is never called to make
 * room automatically — Apple's 5-slot cap is surfaced to the user instead, so
 * they choose which language to give up rather than losing one silently.
 */
export function releaseAppleSpeechLocale(
  locale: string,
  executable = appleSpeechExecutablePath(),
  deps: { platform?: NodeJS.Platform; spawn?: typeof spawn; timeoutMs?: number } = {},
): Promise<{ ok: boolean; error?: string }> {
  const platform = deps.platform ?? process.platform;
  if (platform !== 'darwin') return Promise.resolve({ ok: false, error: 'Apple Speech is macOS-only.' });
  const spawnFn = deps.spawn ?? spawn;
  const timeoutMs = deps.timeoutMs ?? 30_000;
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnFn(executable, ['--release', locale], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e: any) {
      resolve({ ok: false, error: e?.message ?? 'Could not start Apple Speech.' }); return;
    }
    let out = '';
    let released = false;
    let failure: string | undefined;
    let settled = false;
    const finish = (v: { ok: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { if (child.exitCode === null) child.kill(); } catch { /* gone */ }
      resolve(v);
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'Removing the language timed out.' }), timeoutMs);
    timer.unref?.();
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      out += chunk;
      let end: number;
      while ((end = out.indexOf('\n')) >= 0) {
        const line = out.slice(0, end); out = out.slice(end + 1);
        if (!line.trim()) continue;
        try {
          const m = JSON.parse(line);
          if (m?.type === 'release-done') released = true;
          else if (m?.type === 'error') failure = String(m.message ?? 'Could not remove the language.');
        } catch { /* not our line */ }
      }
    });
    child.on('error', (e) => finish({ ok: false, error: e.message }));
    child.on('close', () => finish(released ? { ok: true } : { ok: false, error: failure ?? 'Could not remove the language.' }));
  });
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
  private finalizePending = false;
  private installingAsset = false;
  private readonly executable: string;
  private readonly runtime: AppleSpeechRuntime;

  constructor(executable?: string, runtime: Partial<AppleSpeechRuntime> = {}) {
    super();
    this.executable = executable ?? appleSpeechExecutablePath();
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
    this.active = true; this.ready = false; this.blocked = false; this.finalizePending = false; this.installingAsset = false;
    if (this.runtime.platform !== 'darwin') {
      // Reachable on Windows only via a carried-over credential store (the
      // settings tile is isMac-gated). Never hand a Windows user macOS
      // troubleshooting — tell them to pick a provider that exists there.
      this.fail('Apple Speech is macOS-only. Choose a different speech provider in Audio settings.'); return;
    }
    if (Number(this.runtime.osRelease().split('.')[0]) < 25) {
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
          // A `flush` force-finalizes a still-volatile result, and Apple
          // occasionally answers that with punctuation-only debris instead of
          // the words it had already streamed as partials — observed live as a
          // final of "......." (1 of 8 runs; another truncated "hiring plans"
          // to "hiring"). finalize() is wired to the Answer button, so that
          // debris would land on the question the user just asked. Drop a
          // final carrying no letter or digit; partials are left alone because
          // they are replaced by the next one anyway.
          if (message.isFinal && !HAS_SPEECH_CONTENT.test(message.text)) continue;
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
    const locale = this.resolveLocale();
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
      if (this.installingAsset || !this.ready) {
        // Preserve the most recent audio without aborting a system download or
        // a slow analyzer start. Once ready, transcription resumes from this
        // bounded tail. Trimming while !ready is what makes the startup timers
        // reachable at all: before this, ten seconds of audio tripped the
        // "could not keep up" failure long before MODEL_START_TIMEOUT_MS (120s)
        // could fire, so the startup message was dead code whenever audio was
        // flowing. Backpressure AFTER ready is still a hard failure below —
        // that one really is the helper not keeping up.
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
    if (this.ready && !this.blocked && this.child && !this.pending.length && this.finalizePending) {
      this.finalizePending = false;
      this.blocked = !this.child.stdin.write('{"type":"flush"}\n');
    }
  }
  finalize(): boolean {
    if (!this.active || !this.ready || !this.child) return false;
    // Preserve finalization behind queued audio or stdin backpressure. Returning
    // true tells the renderer to keep its full transcript-tail wait open while
    // drain() sends this flush in order after every preceding audio chunk.
    this.finalizePending = true;
    this.drain();
    return true;
  }
  stop() {
    this.active = false; this.ready = false; this.blocked = false; this.finalizePending = false; this.installingAsset = false;
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
  /**
   * Settings key -> BCP-47 locale for the Swift helper.
   *
   * Apple takes a real locale and nothing else: probed against the framework,
   * `supportedLocale(equivalentTo:)` returns nil for "english" AND for
   * "spanish", so forwarding an unresolved settings key (the old
   * `?? this.language`) could only ever fail — it produced
   * "Apple Speech does not support language english" for anyone whose stored
   * language predates the English-variants split.
   *
   * RECOGNITION_LANGUAGES has a plain key for every language except English,
   * which exists only as english-us/uk/in/au/ca, so a legacy plain 'english'
   * misses the map. It is resolved through the group instead, preferring the
   * variant the machine already runs (en-GB stays en-GB) and falling back to
   * en-US rather than to a non-English app locale.
   *
   * Never fall back to `iso639`: bare 'en' resolves to en-IE (Irish English),
   * which would silently mis-transcribe rather than fail loudly.
   */
  private resolveLocale(): string {
    const appLocale = this.runtime.getLocale();
    const key = this.language;
    if (key === 'auto') return appLocale;

    const direct = RECOGNITION_LANGUAGES[key]?.bcp47;
    if (direct && direct !== 'auto') return direct;

    // Group match ('english' -> the English family). Case-insensitive because
    // the settings key is lower-case while `group` is display-cased.
    const family = Object.values(RECOGNITION_LANGUAGES).filter(
      (o) => o.group?.toLowerCase() === key.toLowerCase() && o.bcp47 !== 'auto',
    );
    if (family.length) {
      const onThisMachine = family.find((o) => o.bcp47.toLowerCase() === appLocale.toLowerCase());
      if (onThisMachine) return onThisMachine.bcp47;
      const language = key.toLowerCase() === 'english' ? 'en-US' : family[0].bcp47;
      return family.some((o) => o.bcp47 === language) ? language : family[0].bcp47;
    }

    console.warn(`[AppleSpeech] Unknown recognition language "${key}" — falling back to ${appLocale}.`);
    return appLocale;
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
