import type { Exec, LinuxWm, WmWindow } from './types';

interface SwayNode {
    id?: number;
    pid?: number;
    name?: string | null;
    app_id?: string | null;
    window_properties?: { class?: string };
    nodes?: SwayNode[];
    floating_nodes?: SwayNode[];
}

/** Leaf windows of `swaymsg -t get_tree` (nodes with a pid), pure. */
export function parseSwayTree(json: string): Array<WmWindow & { id: number }> | null {
    let root: SwayNode;
    try { root = JSON.parse(json); } catch { return null; }
    const out: Array<WmWindow & { id: number }> = [];
    const walk = (n: SwayNode) => {
        if (typeof n.pid === 'number' && n.pid > 0 && typeof n.id === 'number') {
            out.push({ id: n.id, pid: n.pid, owner: n.app_id || n.window_properties?.class || '', title: n.name ?? '' });
        }
        for (const c of [...(n.nodes ?? []), ...(n.floating_nodes ?? [])]) walk(c);
    };
    walk(root);
    return out;
}

export function createSwayWm(exec: Exec): LinuxWm {
    const tree = async () => {
        const text = await exec(['swaymsg', '-t', 'get_tree', '-r']);
        return text ? parseSwayTree(text) : null;
    };
    return {
        name: 'sway',
        async listWindows() {
            return (await tree())?.map(({ id: _id, ...w }) => w) ?? null;
        },
        async setAlwaysOnTop(pid, title) {
            const hit = (await tree())?.filter((w) => w.pid === pid && w.title === title) ?? [];
            // Criteria by con_id: no quoting of the title. Sway has no "above"; floating + sticky is its closest.
            const results = await Promise.all(hit.map((w) =>
                exec(['swaymsg', `[con_id=${w.id}] floating enable, sticky enable`])));
            return hit.length > 0 && results.every((r) => r !== null);
        },
    };
}
