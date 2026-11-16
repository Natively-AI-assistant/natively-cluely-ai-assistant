import type { Exec, LinuxWm, WmWindow } from './types';

interface HyprClient {
    address?: string;
    pid?: number;
    title?: string;
    class?: string;
    mapped?: boolean;
    hidden?: boolean;
    floating?: boolean;
    pinned?: boolean;
}

/** `hyprctl clients -j`, pure. Unmapped/hidden clients are not on screen. */
export function parseHyprClients(json: string): Array<WmWindow & { address: string; floating: boolean; pinned: boolean }> | null {
    let arr: HyprClient[];
    try { arr = JSON.parse(json); } catch { return null; }
    if (!Array.isArray(arr)) return null;
    return arr
        .filter((c) => c.mapped !== false && !c.hidden && typeof c.pid === 'number' && c.pid > 0 && typeof c.address === 'string')
        .map((c) => ({
            address: c.address as string,
            pid: c.pid as number,
            owner: c.class ?? '',
            title: c.title ?? '',
            floating: !!c.floating,
            pinned: !!c.pinned,
        }));
}

export function createHyprlandWm(exec: Exec): LinuxWm {
    const clients = async () => {
        const text = await exec(['hyprctl', 'clients', '-j']);
        return text ? parseHyprClients(text) : null;
    };
    return {
        name: 'hyprland',
        async listWindows() {
            return (await clients())?.map(({ address: _a, floating: _f, pinned: _p, ...w }) => w) ?? null;
        },
        async setAlwaysOnTop(pid, title) {
            const hit = (await clients())?.filter((w) => w.pid === pid && w.title === title) ?? [];
            let ok = hit.length > 0;
            for (const w of hit) {
                // `pin` toggles and only works on floating windows: act only when needed.
                if (!w.floating && (await exec(['hyprctl', 'dispatch', 'setfloating', `address:${w.address}`])) === null) ok = false;
                if (!w.pinned && (await exec(['hyprctl', 'dispatch', 'pin', `address:${w.address}`])) === null) ok = false;
            }
            return ok;
        },
    };
}
