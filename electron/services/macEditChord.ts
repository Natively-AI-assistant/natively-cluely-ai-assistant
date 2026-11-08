/**
 * The app's own global shortcuts the macOS stealth tap must leave alone
 * (2026-10-26, PR #633).
 *
 * While stealth typing, the tap keeps Cmd+A/C/V/X from the meeting app and
 * runs them in Natively's text box (native-module/src/edit_shortcut.rs). The
 * tap sees keys before the app's Carbon hot keys do (checked with real key
 * events: Cmd+V bound to an action fired it with no session, and only pasted
 * while one ran), so a user who bound one of those four lost the shortcut
 * while typing. The tap is given these chords and lets them through instead.
 *
 * Same shape as the Windows table (winChord.ts, app_chord.rs AppChordInput):
 * `vk` is the letter's VK code ('A' = 0x41), `mods` is MOD_CTRL, standing for
 * Cmd alone. Only Cmd alone matters: with any other modifier the tap does not
 * take the key in the first place.
 */
import { MOD_CTRL } from './winChord';

export interface MacEditChord {
    vk: number;
    mods: number;
    id: string;
}

const EDIT_LETTERS = new Set(['a', 'c', 'v', 'x']);

/** One accelerator as a chord the tap must leave alone, else null. */
export function acceleratorToMacEditChord(accelerator: string, id: string): MacEditChord | null {
    const parts = (accelerator || '').split('+').map(p => p.trim().toLowerCase()).filter(p => p.length > 0);
    let cmd = false;
    let key: string | null = null;
    for (const part of parts) {
        switch (part) {
            case 'commandorcontrol':
            case 'cmdorctrl':
            case 'command':
            case 'cmd':
            case 'meta':
            case 'super':
                cmd = true;
                break;
            default:
                // Shift, Option, Control or a second key: not Cmd plus one letter.
                if (key !== null || part.length !== 1) return null;
                key = part;
        }
    }
    if (!cmd || key === null || !EDIT_LETTERS.has(key)) return null;
    return { vk: key.toUpperCase().charCodeAt(0), mods: MOD_CTRL, id };
}

/** The table for the macOS tap, from KeybindManager's global binds. */
export function buildMacEditChordTable(
    binds: ReadonlyArray<{ id: string; accelerator: string; isGlobal: boolean }>,
): MacEditChord[] {
    const table: MacEditChord[] = [];
    for (const b of binds) {
        if (!b.isGlobal) continue;
        const chord = acceleratorToMacEditChord(b.accelerator, b.id);
        if (chord) table.push(chord);
    }
    return table;
}
