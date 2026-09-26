export interface StealthEditState { value: string; allSelected: boolean }
export const EDIT_MODIFIER_FLAGS: number;
export function editShortcutLetter(ev: { isKeyDown?: boolean; flags?: number; chars?: string } | null | undefined): 'a' | 'c' | 'v' | 'x' | null;
export function pastedText(raw: unknown): string;
export function editCommand(state: StealthEditState, letter: 'a' | 'c' | 'x'): StealthEditState & { copy?: string };
export function paste(state: StealthEditState, clipboardText: string): StealthEditState;
export function typed(state: StealthEditState, chars: string): StealthEditState;
export function backspace(state: StealthEditState): StealthEditState;
