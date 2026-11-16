/**
 * Linux window-manager adapter: a window list (meeting detection) and
 * always-on-top (overlay) on desktops where Electron can do neither itself,
 * i.e. Wayland. One adapter per compositor; GNOME/unknown desktops have none
 * and say so (detectWm returns null) rather than pretend.
 */
export interface WmWindow {
    pid: number;
    /** Executable file name, else the window class. */
    owner: string;
    title: string;
    path?: string;
}

/** Runs argv without a shell; resolves stdout, or null on failure/timeout/missing binary. */
export type Exec = (argv: readonly string[], timeoutMs?: number) => Promise<string | null>;

export interface LinuxWm {
    readonly name: 'kwin' | 'sway' | 'hyprland';
    /** Normal (non-panel) windows, or null when the compositor could not be read. */
    listWindows(): Promise<WmWindow[] | null>;
    /** Keep this process's window whose title is EXACTLY `title` above others and on every workspace.
     * The caller passes a unique title (pinTitle) so no other window of the process matches. */
    setAlwaysOnTop(pid: number, title: string): Promise<boolean>;
}

/** A title no other window carries, for the moment the compositor is asked to pin one. */
export function pinTitle(base: string, nonce: string): string {
    return `${base} \u2063${nonce}`; // invisible separator keeps the visible title unchanged
}
