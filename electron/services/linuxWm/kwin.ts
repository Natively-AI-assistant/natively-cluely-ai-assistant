import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Exec, LinuxWm, WmWindow } from './types';

const MARK = 'NATIVELY_WM';

/**
 * KWin has no "list windows" D-Bus method, so a throwaway KWin script prints
 * the list and we read it back from the user journal (the only channel a
 * script has without our own D-Bus service). Needs: busctl, journalctl, and
 * read access to the user journal (default for a desktop user).
 */
export function dumpScript(nonce: string): string {
    return `var l = workspace.windowList().filter(function (w) { return w.normalWindow; })
    .map(function (w) { return { pid: w.pid, title: w.caption, cls: w.resourceClass }; });
print(${JSON.stringify(`${MARK} ${nonce} `)} + JSON.stringify(l));`;
}

/** Sets keepAbove + all-desktops on this process's windows titled `title`. */
export function aotScript(pid: number, title: string): string {
    return `workspace.windowList().forEach(function (w) {
  if (w.pid === ${Math.trunc(pid)} && w.caption === ${JSON.stringify(title)}) { w.keepAbove = true; w.onAllDesktops = true; }
});`;
}

/** The window list a dump script printed under `nonce`, pure. */
export function parseKwinJournal(text: string, nonce: string): WmWindow[] | null {
    const prefix = `${MARK} ${nonce} `;
    const line = text.split('\n').reverse().find((l) => l.includes(prefix));
    if (!line) return null;
    try {
        const arr = JSON.parse(line.slice(line.indexOf(prefix) + prefix.length)) as Array<{ pid?: number; title?: string; cls?: string }>;
        return arr
            .filter((w) => typeof w.pid === 'number' && w.pid > 0)
            .map((w) => ({ pid: w.pid as number, owner: w.cls ?? '', title: w.title ?? '' }));
    } catch {
        return null;
    }
}

const BUS = ['busctl', '--user', '--no-pager', 'call', 'org.kde.KWin'];

/** Loads `source` as a one-shot KWin script, runs it, unloads it. Returns true if KWin ran it. */
async function runScript(exec: Exec, source: string, name: string): Promise<boolean> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-kwin-'));
    const file = path.join(dir, 'script.js');
    try {
        fs.writeFileSync(file, source, { mode: 0o600 });
        const loaded = await exec([...BUS, '/Scripting', 'org.kde.kwin.Scripting', 'loadScript', 'ss', file, name]);
        const id = loaded?.match(/^i\s+(-?\d+)/)?.[1];
        if (!id || id === '-1') return false;
        const ran = await exec([...BUS, `/Scripting/Script${id}`, 'org.kde.kwin.Script', 'run']);
        await exec([...BUS, '/Scripting', 'org.kde.kwin.Scripting', 'unloadScript', 's', name]);
        return ran !== null;
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createKwinWm(exec: Exec): LinuxWm {
    return {
        name: 'kwin',
        async listWindows() {
            const nonce = randomBytes(6).toString('hex');
            if (!(await runScript(exec, dumpScript(nonce), `natively-dump-${nonce}`))) return null;
            // ponytail: polls the journal up to ~600 ms; replace with a D-Bus callback if latency matters.
            for (let i = 0; i < 4; i++) {
                await sleep(150);
                const text = await exec(['journalctl', '--user', '-o', 'cat', '--since', '-15s', '-t', 'kwin_wayland', '-t', 'kwin_x11']);
                const list = text ? parseKwinJournal(text, nonce) : null;
                if (list) return list;
            }
            return null;
        },
        async setAlwaysOnTop(pid, title) {
            return runScript(exec, aotScript(pid, title), `natively-aot-${pid}`);
        },
    };
}
