import { BrowserWindow, app, screen } from 'electron';
import path from 'node:path';
import type { WindowHelper } from './WindowHelper';

const isDev = process.env.NODE_ENV === 'development';

const startUrl = isDev
  ? 'http://localhost:5180'
  : `file://${path.join(app.getAppPath(), 'dist/index.html')}`;

export interface StickyNotePayload {
  id: string;
  text: string;
  intent?: string;
}

const STICKY_DEFAULT_WIDTH = 320;
const STICKY_MIN_WIDTH = 240;
const STICKY_MAX_WIDTH = 520;
const STICKY_DEFAULT_HEIGHT = 220;
const STICKY_MIN_HEIGHT = 120;
const STICKY_MAX_HEIGHT = 480;

export class StickyNoteWindowHelper {
  private windows = new Map<string, BrowserWindow>();
  private payloads = new Map<string, StickyNotePayload>();
  private windowHelper: WindowHelper | null = null;
  private contentProtection = false;

  public setWindowHelper(wh: WindowHelper): void {
    this.windowHelper = wh;
  }

  public setContentProtection(enabled: boolean): void {
    this.contentProtection = enabled;
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) {
        win.setContentProtection(enabled);
      }
    }
  }

  public getPayload(id: string): StickyNotePayload | undefined {
    return this.payloads.get(id);
  }

  public createNote(payload: StickyNotePayload, x: number, y: number): void {
    const existing = this.windows.get(payload.id);
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      existing.moveTop();
      return;
    }

    this.payloads.set(payload.id, payload);

    const display = screen.getDisplayNearestPoint({ x, y });
    const workArea = display.workArea;
    const width = STICKY_DEFAULT_WIDTH;
    const height = STICKY_DEFAULT_HEIGHT;
    const clampedX = Math.min(
      Math.max(Math.round(x), workArea.x),
      workArea.x + workArea.width - width,
    );
    const clampedY = Math.min(
      Math.max(Math.round(y), workArea.y),
      workArea.y + workArea.height - height,
    );

    const overlayWin = this.windowHelper?.getOverlayWindow();
    const isOverlay = overlayWin && !overlayWin.isDestroyed();

    const win = new BrowserWindow({
      width,
      height,
      minWidth: STICKY_MIN_WIDTH,
      maxWidth: STICKY_MAX_WIDTH,
      minHeight: STICKY_MIN_HEIGHT,
      maxHeight: STICKY_MAX_HEIGHT,
      x: clampedX,
      y: clampedY,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      resizable: true,
      movable: true,
      focusable: true,
      show: false,
      skipTaskbar: true,
      hasShadow: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
    });

    win.setContentProtection(this.contentProtection);

    if (isOverlay && overlayWin) {
      win.setParentWindow(overlayWin);
      if (process.platform === 'darwin') {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        win.setAlwaysOnTop(true, 'floating');
        win.setHiddenInMissionControl(true);
      }
    }

    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.showInactive();
    });

    win.on('closed', () => {
      this.windows.delete(payload.id);
      this.payloads.delete(payload.id);
    });

    const url = `${startUrl}?window=sticky-note&id=${encodeURIComponent(payload.id)}`;
    win.loadURL(url).catch((err) => {
      console.error('[StickyNoteWindowHelper] loadURL failed:', err);
    });

    this.windows.set(payload.id, win);
  }

  public closeNote(id: string): void {
    const win = this.windows.get(id);
    if (win && !win.isDestroyed()) {
      win.close();
      return;
    }
    this.windows.delete(id);
    this.payloads.delete(id);
  }

  public closeAll(): void {
    for (const id of [...this.windows.keys()]) {
      this.closeNote(id);
    }
  }
}
