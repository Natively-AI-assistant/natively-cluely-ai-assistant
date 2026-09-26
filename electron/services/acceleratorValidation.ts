/**
 * Accelerator safety for globalShortcut.
 *
 * Split out of KeybindManager so it is testable without an Electron runtime —
 * KeybindManager imports `electron` at module scope. Same rationale as
 * keybindRegistrationState.ts.
 *
 * Why this exists: Electron's gin converter turns an accelerator string into a
 * ui::Accelerator, and when it cannot it does NOT return false — it THROWS
 *
 *     TypeError: Error processing argument at index 0, conversion failure from ₹
 *
 * from register(), unregister() AND isRegistered() alike. A user bound a global
 * shortcut to a bare "₹" (an Option+key press on a non-US layout yields the
 * composed character, and the recorder passed event.key straight through). The
 * throw from the health check's isRegistered() probe — the one call site that
 * sat outside a try — escaped the setInterval and became an uncaughtException,
 * killing the main process ~10 s after every launch. See
 * AcceleratorCrashGuard2026_08_28.test.mjs.
 *
 * Rejecting these before they reach Electron is the fix; the try/catch in
 * KeybindManager is the belt to this pair of braces.
 */

/** Modifier tokens Electron accepts, lowercased. */
const MODIFIERS = new Set([
    'command', 'cmd', 'control', 'ctrl', 'commandorcontrol', 'cmdorctrl',
    'alt', 'option', 'altgr', 'shift', 'super', 'meta',
]);

/** Named (multi-character) key tokens Electron accepts, lowercased. */
const NAMED_KEYS = new Set([
    'plus', 'space', 'tab', 'capslock', 'numlock', 'scrolllock',
    'backspace', 'delete', 'insert', 'return', 'enter',
    'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown',
    'escape', 'esc', 'printscreen',
    'volumeup', 'volumedown', 'volumemute',
    'medianexttrack', 'mediaprevioustrack', 'mediastop', 'mediaplaypause',
    // No browserback/browserforward: they read like valid key codes but Electron
    // does not list them and its parser throws on both (verified against Electron
    // 43). Listing them here would let one through to the try/catch instead of
    // being refused cleanly and badged in Settings.
    'numdec', 'numadd', 'numsub', 'nummult', 'numdiv',
    ...Array.from({ length: 10 }, (_, i) => `num${i}`),
    ...Array.from({ length: 24 }, (_, i) => `f${i + 1}`),
]);

/**
 * True when `token` is a key Electron can convert.
 *
 * Single characters must be printable ASCII: that is the whole vocabulary
 * KeyboardCodeFromCharCode covers, and it is exactly what "₹" (U+20B9) fails.
 * Space is excluded deliberately — the token for it is `Space`.
 */
function isKeyToken(token: string): boolean {
    if (token.length === 1) {
        const code = token.charCodeAt(0);
        return code > 0x20 && code < 0x7f;
    }
    return NAMED_KEYS.has(token);
}

/**
 * True when `accelerator` can be handed to globalShortcut without risking a
 * thrown conversion error.
 *
 * Split on '+' exactly as Electron does, so `Ctrl++` is correctly rejected —
 * the token for a literal plus is `Plus`. An empty string is rejected too;
 * callers already skip unbound keybinds, and "unbound" is not registerable.
 */
export function isRegisterableAccelerator(accelerator: string): boolean {
    if (typeof accelerator !== 'string') return false;
    const trimmed = accelerator.trim();
    if (trimmed === '') return false;

    let sawKey = false;
    for (const raw of trimmed.split('+')) {
        const token = raw.trim().toLowerCase();
        if (token === '') return false;
        if (MODIFIERS.has(token)) continue;
        if (!isKeyToken(token)) return false;
        sawKey = true;
    }
    // A bare modifier ("Shift") has no key code and throws just the same.
    return sawKey;
}

/**
 * What the OS currently thinks of one accelerator.
 *
 * `invalid` means Electron cannot represent it at all — no amount of retrying
 * will help, so the caller should stop attempting it rather than throw once
 * every health-check tick.
 */
export type AcceleratorState = 'alive' | 'lost' | 'invalid';

/**
 * Probes `accelerator` without ever letting Electron's conversion TypeError
 * escape. `isRegistered` is injected so this stays free of the electron import.
 *
 * The validator runs first so a known-bad accelerator never reaches Electron;
 * the try/catch then covers whatever the validator has not learned about yet.
 */
export function probeAccelerator(
    accelerator: string,
    isRegistered: (accelerator: string) => boolean,
): AcceleratorState {
    if (!isRegisterableAccelerator(accelerator)) return 'invalid';
    try {
        return isRegistered(accelerator) ? 'alive' : 'lost';
    } catch {
        return 'invalid';
    }
}
