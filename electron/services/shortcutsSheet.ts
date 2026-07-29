/**
 * Keyboard Shortcuts cheat-sheet — curated catalog, live resolver, passthrough policy.
 * Pure (no Electron) so Tier-0 tests can lock display-live behavior.
 */

export type ShortcutsSheetIconId =
  | 'sparkles'
  | 'screenshot'
  | 'mic'
  | 'reset'
  | 'eyeOff'
  | 'mouse'
  | 'scrollVert'
  | 'scrollHoriz'
  | 'move';

export interface ShortcutsSheetCatalogEntry {
  id: string;
  title: string;
  description: string;
  icon: ShortcutsSheetIconId;
  /** One or more KeybindManager action ids; multi-id rows (scroll/move) share one display row. */
  keybindIds: string[];
}

export interface ShortcutsSheetRow extends ShortcutsSheetCatalogEntry {
  /** Live accelerators parallel to keybindIds; empty string means unbound. */
  accelerators: string[];
}

/** Cluely-parity curated mid-session rows (display titles ≠ Settings Hotkeys labels). */
export const SHORTCUTS_SHEET_CATALOG: ShortcutsSheetCatalogEntry[] = [
  {
    id: 'generate',
    title: 'Generate Solution',
    description: 'Generate an initial solution with explanations',
    icon: 'sparkles',
    keybindIds: ['general:process-screenshots'],
  },
  {
    id: 'screenshot',
    title: 'Take Screenshot',
    description: 'Capture screenshots of the interview question',
    icon: 'screenshot',
    keybindIds: ['general:take-screenshot'],
  },
  {
    id: 'recording',
    title: 'Start/Stop Recording',
    description: 'Start or stop audio recording for transcription',
    icon: 'mic',
    keybindIds: ['chat:answer'],
  },
  {
    id: 'reset',
    title: 'Reset Context',
    description: 'Reset everything to start fresh with a new problem',
    icon: 'reset',
    keybindIds: ['general:reset-cancel'],
  },
  {
    id: 'visibility',
    title: 'Hide/Show Window',
    description: 'Hide or show the window',
    icon: 'eyeOff',
    keybindIds: ['general:toggle-visibility'],
  },
  {
    id: 'passthrough',
    title: 'Mouse Pass-Through',
    description: 'Toggle mouse cursor transparency',
    icon: 'mouse',
    keybindIds: ['general:toggle-mouse-passthrough'],
  },
  {
    id: 'scroll-chat',
    title: 'Scroll Chat',
    description: 'Scroll through long responses without touching the mouse',
    icon: 'scrollVert',
    keybindIds: ['chat:scrollUp', 'chat:scrollDown'],
  },
  {
    id: 'scroll-content',
    title: 'Scroll Content',
    description: 'Scroll content horizontally when it extends beyond the window',
    icon: 'scrollHoriz',
    keybindIds: ['chat:scrollLeft', 'chat:scrollRight'],
  },
  {
    id: 'move-window',
    title: 'Move Window',
    description: 'Move the window around your screen without touching the mouse',
    icon: 'move',
    keybindIds: [
      'window:move-up',
      'window:move-down',
      'window:move-left',
      'window:move-right',
    ],
  },
];

export type KeybindAcceleratorSource =
  | ReadonlyMap<string, string>
  | Record<string, string>
  | ReadonlyArray<{ id: string; accelerator?: string | null }>;

function lookupAccelerator(source: KeybindAcceleratorSource, id: string): string {
  if (source instanceof Map) {
    return source.get(id) ?? '';
  }
  if (Array.isArray(source)) {
    const hit = source.find((kb) => kb.id === id);
    return (hit?.accelerator ?? '').trim();
  }
  const value = (source as Record<string, string>)[id];
  return (value ?? '').trim();
}

/**
 * Join curated catalog to live KeybindManager accelerators (display-live).
 */
export function resolveShortcutsSheetRows(
  keybinds: KeybindAcceleratorSource,
  catalog: ShortcutsSheetCatalogEntry[] = SHORTCUTS_SHEET_CATALOG,
): ShortcutsSheetRow[] {
  return catalog.map((entry) => ({
    ...entry,
    accelerators: entry.keybindIds.map((id) => lookupAccelerator(keybinds, id)),
  }));
}

/** While the sheet is open, overlay must be interactive regardless of user passthrough. */
export function decideSheetOpenPassthrough(userPassthrough: boolean): {
  rememberedUserPassthrough: boolean;
  passthroughWhileOpen: false;
} {
  return {
    rememberedUserPassthrough: userPassthrough,
    passthroughWhileOpen: false,
  };
}

/** On dismiss, restore the passthrough preference remembered at open. */
export function decideSheetClosePassthrough(rememberedUserPassthrough: boolean): {
  passthroughToRestore: boolean;
} {
  return { passthroughToRestore: rememberedUserPassthrough };
}

export function decideSheetVisibilityToggle(currentlyOpen: boolean): { nextOpen: boolean } {
  return { nextOpen: !currentlyOpen };
}
