// The hidden window that captures audio with Chromium for the renderer
// fallback (fallbackPolicy.ts says when). One window serves every session
// (mic and system at once); it is created on the first open() and destroyed
// 15 s after the last session closes, so it exists only while capture does.
//
// It runs in its own in-memory session partition: the media permission and
// the display-media handler (screen video + audio: 'loopback') granted here
// apply to this page alone, never to the app's other windows. Sandboxed,
// context-isolated, no Node, never shown, not in the taskbar.

import path from 'node:path';
import type { BrowserWindow as BrowserWindowType } from 'electron';
import { CAPTURE_COMMAND_CHANNEL, CAPTURE_EVENT_CHANNEL } from './captureChannels';

export type CaptureKind = 'mic' | 'system';

export interface CaptureSessionHandlers {
  onData(pcm: Int16Array): void;
  /** The capture stopped on its own (track ended, page crashed). */
  onEnded(reason: string): void;
}

export interface CaptureSession {
  id: string;
  label: string;
  nativeRate: number;
  close(): void;
}

const PARTITION = 'natively-audio-fallback';
const START_TIMEOUT_MS = 15_000;
const IDLE_CLOSE_MS = 15_000;

/** IPC delivers the page's ArrayBuffer as an ArrayBuffer or a typed view; copy only when unaligned. */
export function toInt16(pcm: unknown): Int16Array | null {
  if (pcm instanceof ArrayBuffer) return new Int16Array(pcm, 0, Math.floor(pcm.byteLength / 2));
  if (ArrayBuffer.isView(pcm)) {
    const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength - (pcm.byteLength % 2));
    if (bytes.byteOffset % 2 === 0) return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    return new Int16Array(bytes.slice().buffer);
  }
  return null;
}

/**
 * dist-electron/electron/audio/fallback, in the app (asar) or the checkout.
 * This file is bundled into whichever entry imports it (main.js, or a wrapper
 * loaded on its own), so __dirname alone does not name one folder.
 */
function assetDir(): string {
  const fs = require('node:fs') as typeof import('node:fs');
  const { app } = require('electron') as typeof import('electron');
  const candidates = [
    path.join(app.getAppPath(), 'dist-electron', 'electron', 'audio', 'fallback'),
    path.join(__dirname, 'audio', 'fallback'),
    path.join(__dirname, 'fallback'),
    __dirname,
  ];
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'capture.html'))) ?? candidates[0];
}

interface Pending {
  resolve(session: CaptureSession): void;
  reject(error: Error): void;
  handlers: CaptureSessionHandlers;
  timer: NodeJS.Timeout;
}

class CaptureHost {
  private win: BrowserWindowType | null = null;
  private ready: Promise<BrowserWindowType> | null = null;
  private markReady: (() => void) | null = null;
  private pending = new Map<string, Pending>();
  private live = new Map<string, CaptureSessionHandlers>();
  private idleTimer: NodeJS.Timeout | null = null;
  private nextId = 1;
  private sessionConfigured = false;

  async open(kind: CaptureKind, deviceLabel: string | null, handlers: CaptureSessionHandlers): Promise<CaptureSession> {
    this.cancelIdleClose();
    const win = await this.ensureWindow();
    const id = `${kind}-${this.nextId++}`;
    return new Promise<CaptureSession>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        this.send({ type: 'stop', id });
        reject(new Error(`${kind} capture did not start within ${START_TIMEOUT_MS / 1000} s`));
        this.scheduleIdleClose();
      }, START_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, handlers, timer });
      console.log(`[AudioFallback] Starting ${kind} capture (${id}${deviceLabel ? `, device "${deviceLabel}"` : ''})`);
      win.webContents.send(CAPTURE_COMMAND_CHANNEL, { type: 'start', id, kind, deviceLabel });
    });
  }

  private close(id: string): void {
    const wasLive = this.live.delete(id);
    const pending = this.pending.get(id);
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
    }
    if (wasLive || pending) this.send({ type: 'stop', id });
    this.scheduleIdleClose();
  }

  private send(command: { type: 'stop'; id: string }): void {
    const win = this.win;
    if (win && !win.isDestroyed()) win.webContents.send(CAPTURE_COMMAND_CHANNEL, command);
  }

  private onEvent(event: any): void {
    if (!event || typeof event !== 'object') return;
    if (event.type === 'ready') {
      this.markReady?.();
      return;
    }
    const id = String(event.id ?? '');
    if (event.type === 'data') {
      const pcm = toInt16(event.pcm);
      if (pcm) this.live.get(id)?.onData(pcm);
      return;
    }
    const pending = this.pending.get(id);
    if (event.type === 'started' && pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      this.live.set(id, pending.handlers);
      console.log(`[AudioFallback] ${id} capturing from "${event.label || 'default'}" (${event.nativeRate || '?'} Hz)`);
      pending.resolve({ id, label: String(event.label ?? ''), nativeRate: Number(event.nativeRate) || 0, close: () => this.close(id) });
      return;
    }
    if (event.type === 'error') {
      const message = String(event.message ?? 'capture failed');
      console.warn(`[AudioFallback] ${id}: ${message}`);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(new Error(message));
      } else {
        this.endLive(id, message);
      }
      this.scheduleIdleClose();
      return;
    }
    if (event.type === 'ended') {
      this.endLive(id, 'the capture track ended');
      this.scheduleIdleClose();
    }
  }

  private endLive(id: string, reason: string): void {
    const handlers = this.live.get(id);
    if (!handlers) return;
    this.live.delete(id);
    handlers.onEnded(reason);
  }

  private configureSession(): void {
    if (this.sessionConfigured) return;
    this.sessionConfigured = true;
    const { session, desktopCapturer } = require('electron') as typeof import('electron');
    const ses = session.fromPartition(PARTITION);
    const ours = (wc: Electron.WebContents | null) => !!wc && !!this.win && !this.win.isDestroyed() && wc.id === this.win.webContents.id;
    ses.setPermissionRequestHandler((wc, permission, callback) => {
      const allow = ours(wc) && (permission === 'media' || permission === 'display-capture');
      if (!allow) console.warn(`[AudioFallback] Refused permission "${permission}" for a page that is not the capture page`);
      callback(allow);
    });
    ses.setPermissionCheckHandler((wc, permission) => ours(wc) && permission === 'media');
    // Denying takes callback(null); an empty object throws "Video was requested".
    const deny = (callback: (streams: Electron.Streams) => void) => {
      try { (callback as (streams: Electron.Streams | null) => void)(null); } catch { /* request already settled */ }
    };
    // The video source only carries the request: loopback audio is the whole
    // default output whichever source is named, and the page drops the video.
    // A screen is preferred; a window when none is listed (macOS 27 lists no
    // screens to Electron 43 here, and a locked-down Windows session might not).
    ses.setDisplayMediaRequestHandler((_request, callback) => {
      desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } }).then(
        (sources) => {
          const source = sources.find((s) => s.id.startsWith('screen:')) ?? sources[0];
          if (!source) {
            console.warn('[AudioFallback] No screen or window source to carry loopback audio');
            deny(callback);
            return;
          }
          callback({ video: source, audio: 'loopback' });
        },
        (err) => {
          console.warn('[AudioFallback] Screen source lookup failed:', err?.message ?? err);
          deny(callback);
        },
      );
    });
  }

  private ensureWindow(): Promise<BrowserWindowType> {
    if (this.win && !this.win.isDestroyed() && this.ready) return this.ready;
    const { BrowserWindow } = require('electron') as typeof import('electron');
    this.configureSession();
    const dir = assetDir();
    const win = new BrowserWindow({
      show: false,
      width: 200,
      height: 120,
      skipTaskbar: true,
      focusable: false,
      paintWhenInitiallyHidden: false,
      title: 'Natively audio',
      webPreferences: {
        preload: path.join(dir, 'captureWindowPreload.js'),
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
      },
    });
    this.win = win;
    win.webContents.ipc.on(CAPTURE_EVENT_CHANNEL, (_event, payload) => this.onEvent(payload));
    win.webContents.on('render-process-gone', (_event, details) => {
      console.error(`[AudioFallback] Capture page gone (${details.reason})`);
      this.dropWindow(`the capture page stopped (${details.reason})`);
    });
    win.on('closed', () => {
      if (this.win === win) this.dropWindow('the capture window closed');
    });
    this.ready = new Promise<BrowserWindowType>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the capture page did not load')), START_TIMEOUT_MS);
      this.markReady = () => {
        clearTimeout(timer);
        this.markReady = null;
        resolve(win);
      };
      win.loadFile(path.join(dir, 'capture.html')).catch((err) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
    this.ready.catch(() => this.dropWindow('the capture page did not load'));
    return this.ready;
  }

  /**
   * Forget the window and end everything that was using it. `notify` false is
   * for quitting: no session reports an end, so no mic or system recovery
   * starts reopening capture while the app shuts down.
   */
  private dropWindow(reason: string, notify = true): void {
    const win = this.win;
    this.win = null;
    this.ready = null;
    this.markReady = null;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
      this.pending.delete(id);
    }
    if (notify) for (const id of [...this.live.keys()]) this.endLive(id, reason);
    else this.live.clear();
    if (win && !win.isDestroyed()) win.destroy();
  }

  private scheduleIdleClose(): void {
    if (this.live.size || this.pending.size || this.idleTimer || !this.win) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.live.size || this.pending.size) return;
      console.log('[AudioFallback] No capture for 15 s: closing the capture window');
      this.dropWindow('idle');
    }, IDLE_CLOSE_MS);
  }

  private cancelIdleClose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  /** App quit. */
  dispose(): void {
    this.cancelIdleClose();
    this.dropWindow('the app is quitting', false);
  }
}

// One host per process. Kept on globalThis because the build bundles each
// entry on its own: main.js, MicrophoneCapture.js and SystemAudioCapture.js
// each carry a copy of this module, and a module-level variable would give
// the mic and system audio a capture window each.
const HOST_KEY = Symbol.for('natively.audioFallback.captureHost');
type HostGlobal = { [HOST_KEY]?: CaptureHost };

export function captureHost(): CaptureHost {
  const g = globalThis as HostGlobal;
  g[HOST_KEY] ??= new CaptureHost();
  return g[HOST_KEY];
}

/** For before-quit: closes the window only if one was ever made. */
export function disposeCaptureHost(): void {
  (globalThis as HostGlobal)[HOST_KEY]?.dispose();
}
