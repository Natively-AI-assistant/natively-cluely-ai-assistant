/**
 * Copy text to the OS clipboard from any Natively renderer.
 *
 * `navigator.clipboard.writeText` requires the calling document to be FOCUSED;
 * Chromium rejects with NotAllowedError otherwise. On Windows the overlay is
 * created WS_EX_NOACTIVATE (electron/utils/windowsFocusPolicy.ts) and is never
 * focused by design: focusing it would pull the meeting app out of the
 * foreground. So copy buttons in the overlay silently failed there.
 *
 * The main process has no focus requirement, so route through it first and keep
 * `navigator.clipboard` as the fallback: for contexts without the bridge (the
 * standalone *Harness.html pages) and for a bridge call that fails or rejects.
 *
 * Rejects when the copy did not happen, like the `navigator.clipboard.writeText`
 * calls it replaced, so callers keep their success/failure handling.
 */
export async function copyText(text: string): Promise<void> {
    const value = typeof text === 'string' ? text : String(text ?? '');
    const bridge = window.electronAPI?.clipboardWriteText;
    if (bridge) {
        try {
            const res = await bridge(value);
            if (res?.success) return;
        } catch {
            // Fall through to the renderer path.
        }
    }
    await navigator.clipboard.writeText(value);
}
