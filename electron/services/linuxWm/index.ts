import fs from 'node:fs';
import path from 'node:path';
import { defaultExec } from './exec';
import { createHyprlandWm } from './hyprland';
import { createKwinWm } from './kwin';
import { createSwayWm } from './sway';
import type { Exec, LinuxWm, WmWindow } from './types';

export type { Exec, LinuxWm, WmWindow } from './types';

/** Which compositor adapter applies, from the environment. null = none (GNOME, X11-only WMs, other OSes). */
export function detectWm(platform: string, env: NodeJS.ProcessEnv): LinuxWm['name'] | null {
    if (platform !== 'linux') return null;
    if (env.HYPRLAND_INSTANCE_SIGNATURE) return 'hyprland';
    if (env.SWAYSOCK) return 'sway';
    if ((env.XDG_CURRENT_DESKTOP ?? '').split(':').includes('KDE')) return 'kwin';
    return null;
}

export function createLinuxWm(
    platform: string = process.platform,
    env: NodeJS.ProcessEnv = process.env,
    exec: Exec = defaultExec,
): LinuxWm | null {
    switch (detectWm(platform, env)) {
        case 'kwin': return createKwinWm(exec);
        case 'sway': return createSwayWm(exec);
        case 'hyprland': return createHyprlandWm(exec);
        default: return null;
    }
}

/** Adds the executable path/name the compositors do not report (via /proc). */
export function withExecutable(w: WmWindow, readlink: (p: string) => string = fs.readlinkSync): WmWindow {
    try {
        const exe = readlink(`/proc/${w.pid}/exe`);
        return { ...w, path: exe, owner: path.basename(exe) };
    } catch {
        return w;
    }
}

/**
 * MeetingDetector reads windows synchronously; the adapters are async, so a
 * poller keeps the latest snapshot. get() is null until the first read.
 */
export function startWindowPoller(wm: LinuxWm, intervalMs = 5000): { get(): WmWindow[] | null; stop(): void } {
    let latest: WmWindow[] | null = null;
    let busy = false;
    const tick = async () => {
        if (busy) return;
        busy = true;
        try { latest = (await wm.listWindows())?.map((w) => withExecutable(w)) ?? null; } catch { latest = null; } finally { busy = false; }
    };
    void tick();
    const timer = setInterval(tick, intervalMs);
    timer.unref?.();
    return { get: () => latest, stop: () => clearInterval(timer) };
}
