/**
 * Electron accelerator -> Win32 chord translation for the native stealth hook.
 *
 * Split out of KeybindManager (which imports `electron` at module scope and so
 * cannot load under `node --test`) so the parsing rules are unit-testable — the
 * same rationale as keybindRegistrationState.ts.
 *
 * The native WH_KEYBOARD_LL hook can swallow the app's OWN global shortcuts and
 * self-dispatch them, closing the leak where a chord whose `RegisterHotKey`
 * registration was silently dropped falls through to the foreground app (a
 * newline into the answer field, etc. — see native-module/src/app_chord.rs).
 * To do that the hook needs each chord as {vk, mods}. This module produces that
 * table from the Electron accelerator strings KeybindManager already holds.
 *
 * Scope is deliberately narrow — the "printable-leak" subset only:
 *   - modifiers: Ctrl present, Alt and Win/Super ABSENT (Shift allowed)
 *   - completing key: A-Z, 0-9, Enter, Space
 * Any accelerator outside that subset returns null and is left entirely to
 * RegisterHotKey (unchanged behaviour). This keeps the hook away from the
 * delicate Alt/AltGr, Win-combo and navigation-key paths it already handles.
 */

/** Modifier bitmask bits — CONTRACT shared with native-module/src/app_chord.rs (MOD_*). */
export const MOD_CTRL = 1 << 0;
export const MOD_ALT = 1 << 1;
export const MOD_SHIFT = 1 << 2;
export const MOD_WIN = 1 << 3;

export interface Win32Chord {
    /** Win32 virtual-key of the completing key. */
    vk: number;
    /** Modifier bitmask (MOD_*). */
    mods: number;
    /** KeybindManager action id this chord fires. */
    id: string;
}

/**
 * Win32 VK for an Electron key token, or null if it is not a printable-leak key.
 * Only A-Z, 0-9, Enter/Return and Space are mapped — everything else (arrows,
 * F-keys, punctuation, media) is intentionally excluded from hook swallowing.
 */
function keyTokenToVk(token: string): number | null {
    const t = token.trim();
    if (t.length === 1) {
        const c = t.toUpperCase().charCodeAt(0);
        if (c >= 65 && c <= 90) return c; // A-Z -> 0x41..0x5A
        if (c >= 48 && c <= 57) return c; // 0-9 -> 0x30..0x39
        return null;
    }
    switch (t.toLowerCase()) {
        case 'enter':
        case 'return':
            return 0x0d;
        case 'space':
            return 0x20;
        default:
            return null;
    }
}

/**
 * Parse one Electron accelerator (as stored in KeybindManager) into a Win32
 * chord for the printable-leak subset, or null if it falls outside that subset.
 *
 * `CommandOrControl` resolves to Control on Windows (this table is Windows-only;
 * the hook it feeds does not exist on macOS). `Command`/`Cmd`/`Super`/`Meta`
 * map to the Win modifier, which excludes the chord from the safe subset.
 */
export function acceleratorToWin32Chord(accelerator: string, id: string): Win32Chord | null {
    if (!accelerator || accelerator.trim() === '') return null;

    const parts = accelerator.split('+').map(p => p.trim()).filter(p => p.length > 0);
    if (parts.length === 0) return null;

    let mods = 0;
    let keyVk: number | null = null;
    let sawKey = false;

    for (const part of parts) {
        switch (part.toLowerCase()) {
            case 'commandorcontrol':
            case 'cmdorctrl':
            case 'control':
            case 'ctrl':
                mods |= MOD_CTRL;
                break;
            case 'shift':
                mods |= MOD_SHIFT;
                break;
            case 'alt':
            case 'option':
            case 'altgr':
                mods |= MOD_ALT;
                break;
            case 'command':
            case 'cmd':
            case 'super':
            case 'meta':
                mods |= MOD_WIN;
                break;
            default: {
                // A non-modifier token is the completing key. More than one is
                // malformed for our purposes — bail.
                if (sawKey) return null;
                sawKey = true;
                keyVk = keyTokenToVk(part);
            }
        }
    }

    if (!sawKey || keyVk === null) return null;

    // Safe subset: Ctrl present, Alt and Win absent.
    if ((mods & MOD_CTRL) === 0) return null;
    if ((mods & MOD_ALT) !== 0) return null;
    if ((mods & MOD_WIN) !== 0) return null;

    return { vk: keyVk, mods, id };
}

/**
 * Build the chord table the hook swallows, from KeybindManager's global binds.
 * `binds` is any list of {id, accelerator, isGlobal}; non-global, empty, or
 * out-of-subset accelerators are dropped. Duplicate (vk,mods) are kept as-is —
 * KeybindManager already dedupes accelerators at bind time.
 */
export function buildChordTable(
    binds: ReadonlyArray<{ id: string; accelerator: string; isGlobal: boolean }>,
): Win32Chord[] {
    const table: Win32Chord[] = [];
    for (const b of binds) {
        if (!b.isGlobal) continue;
        const chord = acceleratorToWin32Chord(b.accelerator, b.id);
        if (chord) table.push(chord);
    }
    return table;
}
