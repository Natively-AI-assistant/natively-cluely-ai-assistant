/**
 * Copy text to the OS clipboard from any Natively renderer.
 *
 * `navigator.clipboard.writeText` requires the calling document to be FOCUSED —
 * Chromium rejects with NotAllowedError otherwise. On Windows the overlay is
 * created WS_EX_NOACTIVATE (see electron/utils/windowsFocusPolicy.ts) and is
 * never focused by design: focusing it would pull the meeting app out of the
 * foreground, which is the exact signal Natively exists to avoid. So every copy
 * button in the overlay silently failed there while working fine on macOS, where
 * the panel can hold key focus.
 *
 * The main process has no focus requirement, so route through it first and keep
 * `navigator.clipboard` as the fallback for contexts without the bridge (the
 * standalone *Harness.html pages, natively-browser).
 *
 * Rejects when the copy did not happen — a drop-in for the
 * `navigator.clipboard.writeText` calls it replaced, so callers keep whatever
 * success/failure handling they already had.
 */
export async function copyText(text: string): Promise<void> {
    const value = typeof text === 'string' ? text : String(text ?? '');
    const bridge = window.electronAPI?.clipboardWriteText;
    if (bridge) {
        const res = await bridge(value);
        if (res?.success) return;
    }
    await navigator.clipboard.writeText(value);
}
