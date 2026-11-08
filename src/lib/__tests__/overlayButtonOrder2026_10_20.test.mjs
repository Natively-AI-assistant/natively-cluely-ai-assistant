// Settings › Overlay (2026-10-20): the meeting overlay shows one row of five
// buttons, picked and ordered by the user from nine (ten until the tray's
// "Follow-up questions" was folded into Follow Up Question, 2026-10-27). One
// list holds them all; the first five are the row, the rest wait in the tray.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DEFAULT_OVERLAY_BUTTON_ORDER,
  OVERLAY_ROW_SIZE,
  moveOverlayButton,
  normalizeOverlayButtonOrder,
  overlayRowOf,
  sameOverlayButtonOrder,
  swapOverlayButtons,
} from '../overlayButtonOrder.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const ALL = [...DEFAULT_OVERLAY_BUTTON_ORDER];

test('the default row is the five standard buttons; Brainstorm and the live helpers start in the tray', () => {
  assert.equal(OVERLAY_ROW_SIZE, 5);
  assert.deepEqual(overlayRowOf(ALL), ['what_to_answer', 'clarify', 'recap', 'follow_up', 'answer']);
  assert.deepEqual(ALL.slice(OVERLAY_ROW_SIZE), ['brainstorm', 'catch_me_up', 'define', 'sound_smart']);
});

test('normalize keeps known ids once each, appends the missing ones, never throws', () => {
  assert.deepEqual(normalizeOverlayButtonOrder(null), ALL);
  assert.deepEqual(normalizeOverlayButtonOrder('junk'), ALL);
  // A saved order from before the tray existed (the five only) keeps its row.
  const old = ['answer', 'recap', 'clarify', 'what_to_answer', 'follow_up'];
  const n = normalizeOverlayButtonOrder(old);
  assert.deepEqual(overlayRowOf(n), old);
  assert.deepEqual(n.slice(5), ['brainstorm', 'catch_me_up', 'define', 'sound_smart']);
  // Duplicates and unknown ids dropped.
  assert.deepEqual(normalizeOverlayButtonOrder(['define', 'define', 'nope', 'answer']).slice(0, 2), ['define', 'answer']);
  assert.equal(new Set(normalizeOverlayButtonOrder(['define', 'define'])).size, ALL.length);
});

test('a saved order with the old Follow-up questions button shows Follow Up Question in its place', () => {
  // It sat in the row: Follow Up Question (from the tray) takes that place.
  const row = ['what_to_answer', 'follow_up_questions', 'recap', 'clarify', 'answer'];
  const n = normalizeOverlayButtonOrder([...row, 'follow_up', 'brainstorm', 'catch_me_up', 'define', 'sound_smart']);
  assert.deepEqual(overlayRowOf(n), ['what_to_answer', 'follow_up', 'recap', 'clarify', 'answer']);
  assert.equal(n.length, ALL.length);
  // Both in the row: one button, and the next one up fills the fifth place.
  const both = normalizeOverlayButtonOrder(['follow_up', 'follow_up_questions', 'clarify', 'recap', 'answer', 'define']);
  assert.deepEqual(overlayRowOf(both), ['follow_up', 'clarify', 'recap', 'answer', 'define']);
  assert.ok(!normalizeOverlayButtonOrder(['follow_up_questions']).includes('follow_up_questions'));
});

test('swap trades two places, across the row and tray too', () => {
  const s = swapOverlayButtons(ALL, 'brainstorm', 'recap');
  assert.deepEqual(overlayRowOf(s), ['what_to_answer', 'clarify', 'brainstorm', 'follow_up', 'answer']);
  assert.equal(s[5], 'recap');
  assert.deepEqual(swapOverlayButtons(ALL, 'brainstorm', 'nope'), ALL);
});

test('move steps within its group only', () => {
  assert.deepEqual(overlayRowOf(moveOverlayButton(ALL, 'clarify', 1)), ['what_to_answer', 'recap', 'clarify', 'follow_up', 'answer']);
  // Ends of the row and of the tray do not cross into the other group.
  assert.deepEqual(moveOverlayButton(ALL, 'answer', 1), ALL);
  assert.deepEqual(moveOverlayButton(ALL, 'brainstorm', -1), ALL);
  assert.deepEqual(moveOverlayButton(ALL, 'what_to_answer', -1), ALL);
  assert.deepEqual(moveOverlayButton(ALL, 'sound_smart', 1), ALL);
  assert.ok(sameOverlayButtonOrder(moveOverlayButton(ALL, 'define', 1).slice(0, 5), ALL.slice(0, 5)));
});

test('every button has a glyph and label, and the main-process allowlist matches the ids', () => {
  const buttons = read('src/components/overlay/overlayButtons.ts');
  for (const id of ALL) assert.match(buttons, new RegExp(`\\b${id}: \\{ Icon: \\w+, label: '`), id);
  const ipc = read('electron/ipcHandlers.ts');
  const allow = ipc.slice(ipc.indexOf('const OVERLAY_BUTTON_IDS = new Set(['), ipc.indexOf(']);', ipc.indexOf('const OVERLAY_BUTTON_IDS')));
  assert.deepEqual([...allow.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort(), [...ALL].sort());
});

test('the overlay draws only the row, each button wired to its own handler', () => {
  const overlay = read('src/components/NativelyInterface.tsx');
  assert.match(overlay, /const overlayRow = overlayRowOf\(overlayButtonOrder\);/);
  assert.match(overlay, /\{overlayRow\.map\(chip\)\}/);
  assert.match(overlay, /\{overlayRow\.map\(measureChip\)\}/);
  for (const [id, call] of [
    ['what_to_answer', 'handleWhatToSay()'],
    ['clarify', 'handleClarify()'],
    ['recap', 'handleRecap()'],
    ['follow_up', 'handleFollowUpQuestions()'],
    ['brainstorm', 'handleBrainstorm()'],
    ['catch_me_up', "handleLiveHelper('catch_me_up')"],
    ['define', "handleLiveHelper('define')"],
    ['sound_smart', "handleLiveHelper('sound_smart')"],
  ]) {
    assert.ok(overlay.includes(`${id}: () => void ${call},`), `${id} -> ${call}`);
  }
});

test('Settings has an Overlay tab with the style picker and opacity; Advanced no longer has the style', () => {
  const settings = read('src/components/SettingsOverlay.tsx');
  assert.match(settings, /activeTab === 'overlay' && \(\s*<OverlaySettings/);
  assert.match(settings, /opacityControl=\{opacityCard\}/);
  assert.equal((settings.match(/Meeting Interface Style/g) || []).length, 0);
  assert.match(read('src/components/settings/OverlaySettings.tsx'), /'Meeting Interface Style'/);
});
