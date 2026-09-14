import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '../../..', rel), 'utf8');

// ── Reported parity gap ─────────────────────────────────────────────────────
//
// "meeting overlay in windows we cant paste stuff also there is no caret
//  unlike macos version"
//
// Both symptoms are the same root cause pointing two ways. On macOS the overlay
// chat input holds real DOM focus (the window is an NSPanel that becomes key
// without activating Natively), so Chromium draws the caret AND services Cmd+V
// itself. On Windows the overlay is WS_EX_NOACTIVATE (windowsFocusPolicy.ts) and
// is NEVER focused, so:
//   • no element is focused ⟹ no caret is drawn, and
//   • no element is focused ⟹ there is no DOM paste target; the keyboard hook's
//     pass-through filter handed Ctrl+V to the FOREGROUND app, which pasted the
//     user's clipboard into Zoom. Not just a dead shortcut — a stealth leak.
//
// StealthKeyboardManager imports electron at module scope so it cannot load
// under node --test; these pin the invariants in source, matching the house
// style of StealthShortcutGuard.test.mjs. The pure halves have real behavioural
// tests: electron/utils/__tests__/stealthPasteText.test.mjs and
// src/lib/__tests__/stealthCaretPosition.test.mjs.

const HOOK = 'native-module/src/keyboard_hook_windows.rs';
const SKM = 'electron/services/StealthKeyboardManager.ts';
const UI = 'src/components/NativelyInterface.tsx';
const CARET = 'src/components/StealthCaret.tsx';

// ── Rust hook: the Ctrl+V swallow and exactly where it may live ─────────────

test('the Ctrl+V swallow sits AFTER the shortcut_only return', () => {
  // The shortcut guard is default-ON and runs whenever Natively is open, with
  // no overlay input to paste into. Swallowing Ctrl+V above that return would
  // eat paste system-wide for every app on the machine.
  const src = read(HOOK);
  const guardReturn = src.indexOf('if state.shortcut_only.load(Ordering::Acquire) {');
  const swallow = src.indexOf('EDIT-CHORD SWALLOW');
  assert.ok(guardReturn > 0, 'shortcut_only early return not found');
  assert.ok(swallow > 0, 'the Ctrl+V edit-chord swallow is missing');
  assert.ok(
    swallow > guardReturn,
    'the Ctrl+V swallow must come AFTER the shortcut_only return, or shortcut-guard mode would eat paste system-wide',
  );
});

test('the Ctrl+V swallow sits BEFORE the ctrl/alt pass-through', () => {
  // That pass-through is what handed Ctrl+V to the meeting app. Landing after
  // it would make the whole branch dead code.
  const src = read(HOOK);
  const swallow = src.indexOf('EDIT-CHORD SWALLOW');
  const passThrough = src.indexOf('if (ctrl || alt) && !altgr {');
  assert.ok(passThrough > 0, 'ctrl/alt pass-through not found');
  assert.ok(
    swallow < passThrough,
    'the Ctrl+V swallow must precede the ctrl/alt pass-through, or Ctrl+V still leaks to the foreground app',
  );
});

test('the swallow matches Ctrl+V only — not Alt, not AltGr, not a bare V', () => {
  const src = read(HOOK);
  const branch = src.slice(src.indexOf('EDIT-CHORD SWALLOW'), src.indexOf('if (ctrl || alt) && !altgr {'));
  assert.match(branch, /const VK_V: u32 = 0x56;/, 'VK_V must be the literal 0x56');
  assert.match(
    branch,
    /if is_key_down && ctrl && !alt && vk == VK_V \{/,
    'the guard must require keyDown + Ctrl + NOT Alt + V (AltGr is Ctrl+Alt and produces real text on EU layouts)',
  );
});

test('a held Ctrl+V pastes once, not once per auto-repeat', () => {
  const src = read(HOOK);
  const branch = src.slice(src.indexOf('EDIT-CHORD SWALLOW'), src.indexOf('if (ctrl || alt) && !altgr {'));
  // swallowed_ups doubles as the repeat detector: "down swallowed, up pending".
  assert.match(
    branch,
    /swallowed_ups[\s\S]*?\.contains\(&vk\)[\s\S]*?return LRESULT\(1\)/,
    'a repeat of an already-swallowed Ctrl+V must be swallowed WITHOUT re-dispatching',
  );
});

test('the key-UP is swallowed too, so the meeting app never sees half a chord', () => {
  const src = read(HOOK);
  const branch = src.slice(src.indexOf('EDIT-CHORD SWALLOW'), src.indexOf('if (ctrl || alt) && !altgr {'));
  assert.match(
    branch,
    /\.insert\(vk\)/,
    'the swallowed VK must be recorded so the existing key-UP handler swallows its up',
  );
});

test('with no live callback the swallow falls through instead of eating the key', () => {
  // Swallowing a key with nowhere to deliver it would kill Ctrl+V machine-wide
  // for as long as Natively runs. Same rule the app-chord branch follows.
  const src = read(HOOK);
  const branch = src.slice(src.indexOf('EDIT-CHORD SWALLOW'), src.indexOf('if (ctrl || alt) && !altgr {'));
  assert.match(branch, /if delivered \{/, 'the swallow must be conditional on successful delivery');
  const afterDelivered = branch.slice(branch.indexOf('if delivered {'));
  assert.ok(
    !/}\s*return LRESULT\(1\);\s*$/.test(afterDelivered.trimEnd()),
    'an undelivered Ctrl+V must fall through to the OS, never return LRESULT(1)',
  );
});

test('Ctrl+A / Ctrl+C / Ctrl+X are deliberately NOT swallowed', () => {
  // This input path has no selection model — the renderer appends to a value it
  // sets programmatically and the element is never focused — so there is nothing
  // for select-all/copy/cut to act on. Swallowing them would break them without
  // providing a replacement.
  const src = read(HOOK);
  const branch = src.slice(src.indexOf('EDIT-CHORD SWALLOW'), src.indexOf('if (ctrl || alt) && !altgr {'));
  for (const [name, vk] of [['Ctrl+A', '0x41'], ['Ctrl+C', '0x43'], ['Ctrl+X', '0x58']]) {
    assert.ok(
      !branch.includes(vk),
      `${name} (${vk}) must not be swallowed while there is no selection model to act on`,
    );
  }
});

// ── Main process: edit actions must not reach KeybindManager ────────────────

test("`edit:paste` is intercepted before dispatchAppChord", () => {
  // triggerActionById would log an unknown-action error and do nothing, so the
  // ordering is what makes paste work at all.
  const src = read(SKM);
  const branch = src.slice(src.indexOf('if (ev.appChordId) {'));
  const intercept = branch.indexOf("=== 'edit:paste'");
  const dispatch = branch.indexOf('this.dispatchAppChord(ev.appChordId)');
  assert.ok(intercept > 0, 'no edit:paste branch in handleCapturedKey');
  assert.ok(dispatch > 0, 'dispatchAppChord call not found');
  assert.ok(intercept < dispatch, 'edit:paste must be handled BEFORE the KeybindManager dispatch');
});

test('the paste is normalised and empty results are not sent', () => {
  const src = read(SKM);
  const fn = src.slice(src.indexOf('private handleStealthPaste()'), src.indexOf('private handleCapturedKey('));
  assert.ok(fn.length > 0, 'handleStealthPaste() not found');
  assert.match(fn, /normalizePastedText\(/, 'clipboard text must go through normalizePastedText');
  assert.match(fn, /if \(!chars\) return;/, 'an empty/image-only clipboard must send nothing');
  assert.match(fn, /try \{[\s\S]*clipboard\.readText\(\)/, 'the clipboard read must be guarded');
});

test('the paste reuses the scoped overlay send, never the broadcast', () => {
  // broadcast() fans out to every window; clipboard contents are exactly as
  // sensitive as the keystrokes sendKeyToOverlay was scoped for.
  const src = read(SKM);
  const fn = src.slice(src.indexOf('private handleStealthPaste()'), src.indexOf('private handleCapturedKey('));
  assert.match(fn, /this\.sendKeyToOverlay\(/, 'paste must go through the overlay-scoped send');
  assert.ok(!/this\.broadcast\(/.test(fn), 'paste must never fan out to all windows');
});

// ── Renderer: the caret is Windows-only and must not disturb macOS ──────────

test('the synthetic caret renders only on win32 with a session engaged', () => {
  const src = read(UI);
  assert.match(
    src,
    /<StealthCaret[\s\S]{0,200}active=\{isWindows && stealthTapActive\}/,
    'the caret must be gated on BOTH win32 and an engaged stealth session — macOS keeps its real caret',
  );
});

test('the caret is a sibling of the input inside the positioned wrapper', () => {
  // It is absolutely positioned; outside `relative group` it would anchor to
  // the wrong ancestor and land somewhere else entirely.
  const src = read(UI);
  const wrapper = src.indexOf('<div className="relative group" data-stealth-engage="true">');
  const caret = src.indexOf('<StealthCaret', wrapper);
  assert.ok(wrapper > 0, 'the stealth-engage wrapper was not found');
  assert.ok(caret > wrapper, 'the caret must live inside the relative wrapper');
});

test('the caret drives scrollLeft itself, because an unfocused input will not', () => {
  const src = read(CARET);
  assert.match(
    src,
    /el\.scrollLeft = el\.scrollWidth/,
    'a long value must scroll to its tail — an unfocused input never auto-reveals the insertion point',
  );
});

test('the caret does no work at all when inactive', () => {
  // It is mounted for the whole meeting on both platforms; on macOS and while
  // idle it must cost nothing — no interval, no measuring, no render.
  const src = read(CARET);
  assert.match(src, /if \(!active\) return;/, 'effects must bail before measuring when inactive');
  assert.match(src, /if \(!active \|\| left === null\) return null;/, 'render must be null when inactive');
});
