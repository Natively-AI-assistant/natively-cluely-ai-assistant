// Native prompts vs Undetectable mode.
//
// A native dialog, file picker or system notification is its own OS window,
// outside the content protection Natively's windows carry in Undetectable
// mode, so it shows up in a screen share (recorded 2026-09-27 on macOS: a
// confirm dialog and a <select> popup floated over an otherwise empty desktop
// while the launcher itself stayed hidden).
//
// The two consent prompts gated here guard real security widenings, and they
// live in main on purpose: a compromised renderer must not be able to approve
// an extension install or a LAN bind. So they are NOT moved into the renderer.
// While Undetectable is on the action is refused instead, with a message that
// says how to do it. With Undetectable off the native prompts are unchanged.

import * as fs from 'fs';
import * as path from 'path';

export const UNDETECTABLE_REFUSAL_ERROR = 'undetectable_on';

export const UNDETECTABLE_REFUSAL_MESSAGES = {
  extensionInstall:
    'Turn off Undetectable to install extensions. Its confirmation is a system dialog, which would show in a screen share.',
  lanAccess:
    'Turn off Undetectable to allow LAN access. Its confirmation is a system dialog, which would show in a screen share.',
} as const;

/**
 * True when a native prompt or system notification must not open. A check
 * that throws counts as Undetectable ON: stealth fails closed.
 */
export function nativePromptsBlocked(isUndetectable: () => boolean): boolean {
  try {
    return isUndetectable() === true;
  } catch {
    return true;
  }
}

/**
 * Wrap a native consent prompt so it is declined, without opening, while
 * Undetectable is on. With no state source it always shows the prompt.
 */
export function declineWhileUndetectable<P>(
  isUndetectable: (() => boolean) | undefined,
  showPrompt: (prompt: P) => Promise<boolean>,
  onDecline?: (prompt: P) => void,
): (prompt: P) => Promise<boolean> {
  return async (prompt) => {
    if (isUndetectable && nativePromptsBlocked(isUndetectable)) {
      onDecline?.(prompt);
      return false;
    }
    return showPrompt(prompt);
  };
}

/**
 * The saved Undetectable flag, for code that runs before SettingsManager (the
 * native-arch gate fires at module load). `readSettingsJson` returns the raw
 * settings.json text. Returns null when it cannot be read or parsed, so the
 * caller decides what an unknown state means.
 */
export function readPersistedUndetectable(readSettingsJson: () => string): boolean | null {
  try {
    const parsed = JSON.parse(readSettingsJson());
    return parsed && typeof parsed === 'object' ? parsed.isUndetectable === true : null;
  } catch {
    return null;
  }
}

/**
 * True when the saved settings say Undetectable is on, read straight from
 * `<userData>/settings.json`. Unreadable counts as off: this guards error boxes
 * for a broken install, where telling the user beats guessing.
 */
export function savedUndetectableOn(userDataDir: string): boolean {
  return readPersistedUndetectable(() => fs.readFileSync(path.join(userDataDir, 'settings.json'), 'utf8')) === true;
}
