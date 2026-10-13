// Linux "shared desktop": a nested Xephyr display (scripts/linux/shared-desktop.sh)
// with its own Plasma session and a Brave that has the Natively extension loaded.
// Share that display in a meeting; Natively stays on the real desktop, and its
// screenshots follow the nested display (see linuxScreenshot.ts).
//
// State lives in files the script owns, so a session started from a terminal is
// seen (and can be stopped) just like one started from the app:
//   ~/.local/share/shared-desktop/display  — nested display (":N") while up
//   ~/.local/share/shared-desktop/pid      — the script's pid

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { app } from 'electron';
import { SHARED_DESKTOP_DISPLAY_MARKER } from './linuxScreenshot';

const STATE_DIR = path.dirname(SHARED_DESKTOP_DISPLAY_MARKER);
const PID_FILE = path.join(STATE_DIR, 'pid');
const LAUNCH_LOG = path.join(STATE_DIR, 'launch.log');
const START_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 8_000;

export interface SharedDesktopStatus {
  /** Linux with Xephyr installed. */
  supported: boolean;
  /** Why it is unsupported / cannot start, when it isn't / can't. */
  unavailableReason?: string;
  running: boolean;
  /** Nested display (":N") while running. */
  display: string | null;
  /** The built browser extension is present (it is loaded into the nested Brave). */
  extensionReady: boolean;
}

function resourcePath(devRelative: string, packagedRelative: string): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, packagedRelative)
    : path.join(app.getAppPath(), devRelative);
}

const scriptPath = () => resourcePath('scripts/linux/shared-desktop.sh', 'shared-desktop/shared-desktop.sh');
const extensionDir = () => resourcePath('natively-browser/dist', 'natively-browser');

function readTrimmed(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8').trim() || null;
  } catch (e: any) {
    if (e?.code === 'ENOENT') return null;
    throw e;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code === 'EPERM';
  }
}

function hasProgram(name: string): boolean {
  try {
    execFileSync('which', [name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function runningSession(): { display: string; pid: number } | null {
  const display = readTrimmed(SHARED_DESKTOP_DISPLAY_MARKER);
  const pid = Number(readTrimmed(PID_FILE));
  if (!display || !/^:\d+$/.test(display) || !Number.isInteger(pid) || pid <= 0) return null;
  if (!fs.existsSync(`/tmp/.X11-unix/X${display.slice(1)}`) || !pidAlive(pid)) return null;
  return { display, pid };
}

export function getSharedDesktopStatus(): SharedDesktopStatus {
  const extensionReady = fs.existsSync(path.join(extensionDir(), 'manifest.json'));
  if (process.platform !== 'linux') {
    return { supported: false, unavailableReason: 'Linux only', running: false, display: null, extensionReady };
  }
  if (!hasProgram('Xephyr')) {
    return {
      supported: false,
      unavailableReason: 'Install Xephyr: sudo apt install xserver-xephyr',
      running: false,
      display: null,
      extensionReady,
    };
  }
  const session = runningSession();
  return {
    supported: true,
    unavailableReason: extensionReady ? undefined : 'Browser extension not built (cd natively-browser && npm run build)',
    running: session !== null,
    display: session?.display ?? null,
    extensionReady,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function launchLogTail(): string {
  const log = readTrimmed(LAUNCH_LOG) ?? '';
  return log.split('\n').slice(-6).join('\n');
}

export async function startSharedDesktop(): Promise<SharedDesktopStatus> {
  const status = getSharedDesktopStatus();
  if (status.running) return status;
  if (!status.supported) throw new Error(`Shared desktop unavailable: ${status.unavailableReason}`);
  if (!status.extensionReady) throw new Error(`Shared desktop: ${status.unavailableReason}`);

  fs.mkdirSync(STATE_DIR, { recursive: true });
  const logFd = fs.openSync(LAUNCH_LOG, 'w');
  // Strip Electron/Node-specific variables so the nested session's apps start clean.
  const env: NodeJS.ProcessEnv = { ...process.env, NATIVELY_EXTENSION_DIR: extensionDir() };
  for (const key of Object.keys(env)) {
    if (key.startsWith('ELECTRON_') || ['NODE_OPTIONS', 'CHROME_DESKTOP', 'FC_FONTATIONS', 'VIPSHOME'].includes(key)) delete env[key];
  }
  // Detached + unref: the session outlives a Natively restart; stop it via the pid file.
  const child = spawn('bash', [scriptPath()], { detached: true, stdio: ['ignore', logFd, logFd], env });
  fs.closeSync(logFd);
  let exitCode: number | null = null;
  child.on('exit', (code) => { exitCode = code ?? -1; });
  child.unref();

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(250);
    const now = getSharedDesktopStatus();
    if (now.running) {
      console.log(`[SharedDesktop] Started on ${now.display}`);
      return now;
    }
    if (exitCode !== null) {
      throw new Error(`Shared desktop exited during startup (code ${exitCode}):\n${launchLogTail()}`);
    }
  }
  throw new Error(`Shared desktop did not come up within ${START_TIMEOUT_MS / 1000}s:\n${launchLogTail()}`);
}

export async function stopSharedDesktop(): Promise<SharedDesktopStatus> {
  const session = runningSession();
  if (!session) return getSharedDesktopStatus();
  // The script's EXIT trap tears down Xephyr, the nested session and the marker.
  process.kill(session.pid, 'SIGTERM');
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(250);
    // Wait for the script itself: its cleanup removes the marker/pid files last.
    if (!pidAlive(session.pid)) {
      console.log('[SharedDesktop] Stopped');
      return getSharedDesktopStatus();
    }
  }
  throw new Error(`Shared desktop (pid ${session.pid}) did not stop within ${STOP_TIMEOUT_MS / 1000}s`);
}
