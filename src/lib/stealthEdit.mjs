/**
 * Editing shortcuts for the overlay's stealth-typed box: paste, select all,
 * copy and cut (Ctrl+V/A/C/X on Windows, Cmd on macOS).
 *
 * The keyboard hooks pass every Ctrl/Cmd combination through to the
 * foreground app, so these never reached the box: Ctrl+V pasted into the
 * meeting app instead. The hooks now deliver just these four, tagged with the
 * modifier flag (native-module/src/edit_shortcut.rs), and this decides what
 * they do to the box's text.
 *
 * The box has no caret: typing appends and Backspace removes the last
 * character. So the only selection is "everything" (select all), which the
 * next keystroke replaces.
 */

/** CGEventFlags bits both hooks use: Cmd (macOS), Ctrl (Windows). */
export const EDIT_MODIFIER_FLAGS = (1 << 20) | (1 << 18);

/** The command letter ('a' | 'c' | 'v' | 'x') of an editing shortcut, else null. */
export function editShortcutLetter(ev) {
  if (!ev || !ev.isKeyDown || !(Number(ev.flags) & EDIT_MODIFIER_FLAGS)) return null;
  const c = typeof ev.chars === 'string' ? ev.chars.toLowerCase() : '';
  return c === 'a' || c === 'c' || c === 'v' || c === 'x' ? c : null;
}

/** Clipboard text as the one-line box holds it: line breaks become spaces. */
export function pastedText(raw) {
  return String(raw ?? '').replace(/\r\n|\r|\n|\t/g, ' ');
}

/**
 * Applies a non-paste command. Paste needs the clipboard, so it is paste().
 * @param {{ value: string, allSelected: boolean }} state
 * @param {'a' | 'c' | 'x'} letter
 * @returns {{ value: string, allSelected: boolean, copy?: string }}
 */
export function editCommand(state, letter) {
  const { value, allSelected } = state;
  if (letter === 'a') return { value, allSelected: value.length > 0 };
  if (letter === 'c') return allSelected ? { value, allSelected, copy: value } : state;
  if (letter === 'x') return allSelected ? { value: '', allSelected: false, copy: value } : state;
  return state;
}

/** Paste: replaces the selection, else appends. */
export function paste(state, clipboardText) {
  const text = pastedText(clipboardText);
  if (!text) return state;
  return { value: (state.allSelected ? '' : state.value) + text, allSelected: false };
}

/** A typed character: replaces the selection, else appends. */
export function typed(state, chars) {
  return { value: (state.allSelected ? '' : state.value) + chars, allSelected: false };
}

/** Backspace: clears the selection, else removes the last character. */
export function backspace(state) {
  return state.allSelected ? { value: '', allSelected: false } : { value: state.value.slice(0, -1), allSelected: false };
}

/**
 * CGEventFlags bits a word-delete arrives with: Ctrl (Windows, Ctrl+Backspace /
 * Ctrl+Delete) or Option (macOS, Option+Backspace). Distinct from
 * EDIT_MODIFIER_FLAGS on purpose — word-delete is keyed off the Backspace
 * keyCode (51), never a character, so it can never collide with Cmd/Ctrl+V/A/C/X.
 */
export const WORD_DELETE_FLAGS = (1 << 18) | (1 << 19);

/** True when a delivered Backspace (keyCode 51) key-down carries the word-delete modifier. */
export function isWordDelete(ev) {
  return !!ev && ev.isKeyDown === true && ev.keyCode === 51 && (Number(ev.flags) & WORD_DELETE_FLAGS) !== 0;
}

/**
 * Word-delete: removes the last word and the whitespace before it, so repeated
 * presses chew back through the box word by word. With a selection it clears
 * everything (same as Backspace on a selection). The box has no caret, so there
 * is nothing after the end — "delete word" only ever means backward.
 */
export function deleteWord(state) {
  if (state.allSelected) return { value: '', allSelected: false };
  return { value: state.value.replace(/\s*\S+\s*$/, ''), allSelected: false };
}
