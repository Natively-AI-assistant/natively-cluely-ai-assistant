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
 * MeetingDetector reads windows synchronously; the adapters are async, so this
 * keeps the latest snapshot. It reads ON DEMAND: get() returns the last snapshot
 * and, when it is older than `staleMs`, starts one refresh in the background. No
 * timer runs while nothing asks (the KWin adapter's channel is the user journal,
 * see kwin.ts: fewer reads, fewer window lists written there). get() is null
 * until the first read lands.
 */
export function startWindowPoller(
    wm: LinuxWm,
    staleMs = 10_000,
    now: () => number = Date.now,
): { get(): WmWindow[] | null; stop(): void } {
    let latest: WmWindow[] | null = null;
    let busy = false;
    let lastStart = -Infinity;
    let stopped = false;
    const refresh = async () => {
        busy = true;
        lastStart = now();
        try { latest = (await wm.listWindows())?.map((w) => withExecutable(w)) ?? null; } catch { latest = null; } finally { busy = false; }
    };
    return {
        get() {
            if (!stopped && !busy && now() - lastStart >= staleMs) void refresh();
            return latest;
        },
        stop() { stopped = true; },
    };
}
