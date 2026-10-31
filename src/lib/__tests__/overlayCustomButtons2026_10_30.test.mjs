// Settings › Overlay › Your buttons (2026-10-30): the user's own overlay
// buttons. A name of at most ten characters, a description in plain
// sentences under the parts the built-in buttons are written in, the
// contract a model writes from it on save (electron/llm/customButtons.ts),
// a screenshot switch, at most four buttons. Their `custom:` ids sit in the
// same list as the built-in buttons (overlayButtonOrder.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  OVERLAY_CUSTOM_INSTRUCTION_MAX,
  OVERLAY_CUSTOM_MAX,
  OVERLAY_CUSTOM_NAME_MAX,
  OVERLAY_CUSTOM_PROMPT_MAX,
  OVERLAY_CUSTOM_PROMPT_LINES,
  OVERLAY_CUSTOM_PROMPT_TEMPLATE,
  cleanOverlayCustomName,
  isOverlayCustomButtonId,
  nameLength,
  newOverlayCustomButtonId,
  normalizeOverlayCustomButtons,
  OVERLAY_CUSTOM_READ_DEFAULT_MINUTES,
  OVERLAY_CUSTOM_READ_MAX_MINUTES,
  overlayCustomDraftProblem,
  overlayCustomReadMinutes,
  overlayCustomSummary,
} from '../overlayCustomButtons.ts';
import {
  DEFAULT_OVERLAY_BUTTON_ORDER,
  normalizeOverlayButtonOrder,
  overlayRowOf,
} from '../overlayButtonOrder.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const button = (id, extra = {}) => ({ id, name: 'Rephrase', prompt: 'What it does: rephrase it', instruction: 'Rephrase it.', screenshot: false, ...extra });

test('limits: ten-character names, four buttons', () => {
  assert.equal(OVERLAY_CUSTOM_NAME_MAX, 10);
  assert.equal(OVERLAY_CUSTOM_MAX, 4);
});

test('names are cut to ten characters as people count them', () => {
  assert.equal(cleanOverlayCustomName('  Follow   up  '), 'Follow up');
  assert.equal(cleanOverlayCustomName('Abcdefghijklmnop'), 'Abcdefghij');
  // An emoji is one character, not two UTF-16 units.
  assert.equal(nameLength('🙂🙂🙂'), 3);
  assert.equal(nameLength(cleanOverlayCustomName('🙂'.repeat(14))), 10);
  assert.equal(cleanOverlayCustomName('   '), '');
});

test('normalize keeps valid buttons, drops bad ones and repeats, caps the count, never throws', () => {
  assert.deepEqual(normalizeOverlayCustomButtons(null), []);
  assert.deepEqual(normalizeOverlayCustomButtons('junk'), []);
  const out = normalizeOverlayCustomButtons([
    button('custom:a'),
    button('custom:a'), // repeat
    button('not-custom'), // bad id
    button('custom:b', { name: '' }), // no name
    button('custom:c', { prompt: '   ' }), // no prompt
    button('custom:d', { name: 'A very long name', screenshot: 'yes' }),
    { id: 'custom:e', name: 3, prompt: 'x' },
    button('custom:f', { prompt: 'x'.repeat(OVERLAY_CUSTOM_PROMPT_MAX + 50) }),
    button('custom:g'),
    button('custom:h'),
  ]);
  assert.deepEqual(out.map((b) => b.id), ['custom:a', 'custom:d', 'custom:f', 'custom:g']);
  assert.equal(out[1].name, 'A very lon');
  assert.equal(out[1].screenshot, false, 'only a real true turns the screenshot on');
  assert.equal(out[2].prompt.length, OVERLAY_CUSTOM_PROMPT_MAX);
});

test('the written contract is kept and capped; a button saved before it has none', () => {
  const [kept, capped, old] = normalizeOverlayCustomButtons([
    button('custom:a'),
    button('custom:b', { instruction: 'x'.repeat(OVERLAY_CUSTOM_INSTRUCTION_MAX + 10) }),
    { id: 'custom:c', name: 'Old', prompt: 'Task: rephrase it', screenshot: true },
  ]);
  assert.equal(kept.instruction, 'Rephrase it.');
  assert.equal(capped.instruction.length, OVERLAY_CUSTOM_INSTRUCTION_MAX);
  assert.equal(OVERLAY_CUSTOM_INSTRUCTION_MAX, 1200);
  assert.equal(old.instruction, '');
  assert.equal(old.screenshot, true);
});

test('new ids are valid custom ids and differ', () => {
  const a = newOverlayCustomButtonId();
  const b = newOverlayCustomButtonId();
  assert.ok(isOverlayCustomButtonId(a), a);
  assert.notEqual(a, b);
  assert.ok(!isOverlayCustomButtonId('custom:'));
  assert.ok(!isOverlayCustomButtonId('custom:UPPER'));
  assert.ok(!isOverlayCustomButtonId('recap'));
});

test('the template has the built-in buttons\' five parts, and no starter presets', () => {
  const labels = OVERLAY_CUSTOM_PROMPT_TEMPLATE.split('\n').map((l) => l.slice(0, l.indexOf(':')));
  assert.deepEqual(labels, [...OVERLAY_CUSTOM_PROMPT_LINES]);
  assert.deepEqual(labels, ['What it does', 'What to read', 'How the answer looks', 'Never', "If there's nothing to work with"]);
  // What it does is the one blank the user fills in; the rest come with a plain sentence.
  assert.match(OVERLAY_CUSTOM_PROMPT_TEMPLATE, /^What it does: \n/);
  const ui = read('src/components/settings/OverlayCustomButtons.tsx');
  assert.doesNotMatch(ui, /STARTERS|Start from/);
});

test('save waits for a name, a description, and something after "What it does:"', () => {
  assert.equal(overlayCustomDraftProblem({ name: '', prompt: 'What it does: x' }), 'name');
  assert.equal(overlayCustomDraftProblem({ name: 'X', prompt: '  ' }), 'prompt');
  assert.equal(overlayCustomDraftProblem({ name: 'X', prompt: OVERLAY_CUSTOM_PROMPT_TEMPLATE }), 'task');
  assert.equal(overlayCustomDraftProblem({ name: 'X', prompt: OVERLAY_CUSTOM_PROMPT_TEMPLATE.replace('What it does: ', 'What it does: rephrase my last answer') }), null);
  // Free text without the template's lines is the user's call.
  assert.equal(overlayCustomDraftProblem({ name: 'X', prompt: 'Summarise the call' }), null);
});

test('a button\'s row shows what it does', () => {
  assert.equal(overlayCustomSummary(OVERLAY_CUSTOM_PROMPT_TEMPLATE.replace('What it does: ', 'What it does: rephrase my answer')), 'rephrase my answer');
  assert.equal(overlayCustomSummary('\nSummarise the call\nshort'), 'Summarise the call');
});

test('in the button order, custom buttons join the tray and leave when deleted', () => {
  const builtins = [...DEFAULT_OVERLAY_BUTTON_ORDER];
  // Made, not yet placed: after every built-in button, in the order made.
  const placed = normalizeOverlayButtonOrder(builtins, ['custom:a', 'custom:b']);
  assert.deepEqual(placed.slice(builtins.length), ['custom:a', 'custom:b']);
  assert.deepEqual(overlayRowOf(placed), overlayRowOf(builtins));

  // Dragged into the row, it stays there.
  const row = ['custom:a', 'what_to_answer', 'clarify', 'recap', 'follow_up', 'answer', 'brainstorm'];
  const kept = normalizeOverlayButtonOrder(row, ['custom:a', 'custom:b']);
  assert.deepEqual(overlayRowOf(kept), ['custom:a', 'what_to_answer', 'clarify', 'recap', 'follow_up']);
  assert.equal(kept.length, builtins.length + 2);

  // Deleted: it drops out and the next button up fills the row.
  const gone = normalizeOverlayButtonOrder(row, ['custom:b']);
  assert.ok(!gone.includes('custom:a'));
  assert.deepEqual(overlayRowOf(gone), ['what_to_answer', 'clarify', 'recap', 'follow_up', 'answer']);
  assert.equal(gone.at(-1), 'custom:b');

  // With no custom buttons, the order is the built-in one alone.
  assert.deepEqual(normalizeOverlayButtonOrder(['custom:zzz', ...builtins], []), builtins);
});

test('main passes on the same limits the renderer keeps (no drift)', () => {
  const ipc = read('electron/ipcHandlers.ts');
  assert.match(ipc, /safeOn\('overlay-custom-buttons:set'/);
  assert.match(ipc, /const OVERLAY_CUSTOM_MAX = 4;/);
  assert.match(ipc, /const OVERLAY_CUSTOM_ID = \/\^custom:\[a-z0-9-\]\{1,40\}\$\/;/);
  assert.match(ipc, /Array\.from\(name\)\.length > 10/);
  assert.match(ipc, /prompt\.length > 2000/);
  assert.match(ipc, /instruction\.length > 1200/);
  // Order relay: every built-in once, plus up to the custom maximum.
  assert.match(ipc, /order\.length > OVERLAY_BUTTON_IDS\.size \+ OVERLAY_CUSTOM_MAX/);
  const lib = read('src/lib/overlayCustomButtons.ts');
  assert.match(lib, /const ID_PATTERN = \/\^custom:\[a-z0-9-\]\{1,40\}\$\/;/);
  assert.equal(OVERLAY_CUSTOM_PROMPT_MAX, 2000);
  const preload = read('electron/preload.ts');
  assert.match(preload, /ipcRenderer\.send\('overlay-custom-buttons:set', buttons\)/);
  assert.match(preload, /ipcRenderer\.on\('overlay-custom-buttons:changed', handler\)/);
});

test('the overlay runs a custom button like Define: its contract to main, screenshot first when on', () => {
  const ni = read('src/components/NativelyInterface.tsx');
  const fn = ni.slice(ni.indexOf('const handleCustomButton = async'), ni.indexOf('handleManualSubmitRef.current = handleManualSubmit;'));
  assert.match(fn, /if \(!tryBeginOverlayAction\(actionKey\)\) return;/);
  assert.match(fn, /text: button\.name, isQuickActionLabel: true/);
  assert.match(fn, /if \(button\.screenshot\)/);
  assert.match(fn, /window\.electronAPI\.takeScreenshot\(\)/);
  assert.match(fn, /prepareIntelligenceStreamPlaceholder\('recap'\)/);
  assert.match(fn, /const instruction = button\.instruction \|\| button\.prompt;/);
  assert.match(fn, /generateCustomButton\?\.\(\{ name: button\.name, instruction, imagePaths, readMinutes: overlayCustomReadMinutes\(button\.prompt\) \}\)/);
  assert.match(fn, /endOverlayAction\(actionKey\)/);
  // Not the ask bar any more, and the user's words never go to analytics.
  assert.doesNotMatch(fn, /sendChatTurn|handleManualSubmit\(/);
  assert.doesNotMatch(fn, /trackCommandExecuted\([^)]*(prompt|instruction)/);
  assert.match(ni, /isBuiltinOverlayButtonId\(id\) \? onBuiltinChip\[id\] : \(\) => void handleCustomButton\(id\)/);
});

test('saving has Natively write the button, and keeps the contract when the lines did not change', () => {
  const ui = read('src/components/settings/OverlayCustomButtons.tsx');
  const save = ui.slice(ui.indexOf('const save = async'), ui.indexOf('const startNew'));
  assert.match(save, /let instruction = draft\.instruction && prompt === draft\.savedPrompt \? draft\.instruction : '';/);
  assert.match(save, /compileCustomButton\?\.\(\{ name, description: prompt \}\)/);
  // A Cancel or a newer save while the rewrite ran drops the late answer.
  assert.match(save, /if \(run !== saveRun\.current\) return;/);
  assert.match(save, /const latest = getOverlayCustomButtons\(\);/);
  assert.match(ui, /<SwapLabel id=\{saving \? 'writing' : 'save'\} sizers=\{\[saveLabel, t\('Writing…'\)\]\}>/);
  assert.match(ui, /t\('How Natively runs it'\)/);
  const preload = read('electron/preload.ts');
  assert.match(preload, /ipcRenderer\.invoke\('custom-button:compile', input\)/);
  assert.match(preload, /ipcRenderer\.invoke\('generate-custom-button', input\)/);
});

// "the animation related to this section is so bad" (2026-10-30). The section
// moves in Settings' own vocabulary (SettingsRow.tsx): states fold by height so
// the card below glides, labels swap in boxes sized to their longest state.
test('the section folds between states instead of fading in place', () => {
  const ui = read('src/components/settings/OverlayCustomButtons.tsx');
  const section = ui.slice(ui.indexOf('export const CustomButtonsSection'));
  // mode="wait" emptied the section between the two states, so the Overlay
  // card under it jumped up and back down on every open and close.
  assert.doesNotMatch(section, /mode="wait"/);
  assert.match(section, /<SettingsMotionReady\.Provider value=\{true\}>/);
  assert.ok(section.includes("<CollapseItem key={`edit-${draft.id ?? 'new'}`}>"));
  assert.ok(section.includes('<CollapseItem key="empty">'));
  assert.ok(section.includes('<CollapseItem key="list">'));
  // Gaps are padding inside the folds: a margin outside would jump in whole.
  assert.doesNotMatch(section, /<CollapseItem[^>]*className="mt-/);
  // Deleted rows fold away.
  assert.match(section, /<CollapseItem key=\{button\.id\}>/);
  // "New" comes and goes as a control.
  assert.match(section, /<Presence kind="control" id=\{!draft && buttons\.length > 0 \? 'new' : null\}/);
  // The contract folds rather than popping, and the hint keeps its height.
  assert.match(ui, /<Collapse open=\{!!contract\}>/);
  assert.match(ui, /<Presence kind="text" id=\{hintId\} block>/);
  assert.match(ui, /className="t-shimmer" data-text=\{t\('Writing…'\)\}/);
  // Focus while folding open must not scroll Settings.
  assert.match(ui, /nameRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
});

test('"What to read" sets how far back a press reads', () => {
  const span = (line) => overlayCustomReadMinutes(`What it does: x\nWhat to read: ${line}\nNever: y`);
  assert.equal(OVERLAY_CUSTOM_READ_DEFAULT_MINUTES, 3);
  assert.equal(OVERLAY_CUSTOM_READ_MAX_MINUTES, 60);
  // The template's own line is the default, written as a number the user can change.
  assert.match(OVERLAY_CUSTOM_PROMPT_TEMPLATE, /^What to read: the last 3 minutes of the conversation$/m);
  assert.equal(overlayCustomReadMinutes(OVERLAY_CUSTOM_PROMPT_TEMPLATE), 3);
  assert.equal(span('the last 10 minutes'), 10);
  assert.equal(span('last 5 mins'), 5);
  assert.equal(span('the last ten minutes'), 10);
  assert.equal(span('the past 15m'), 15);
  assert.equal(span('half an hour'), 30);
  assert.equal(span('the last hour'), 60);
  assert.equal(span('the last 2 hours'), 60);
  assert.equal(span('the whole meeting'), 60);
  assert.equal(span('the entire conversation'), 60);
  assert.equal(span('everything from the start'), 60);
  assert.equal(span('the last minute'), 1);
  assert.equal(span('the last 30 seconds'), 1);
  assert.equal(span('a couple of minutes'), 2);
  assert.equal(span('the last few minutes'), 3);
  assert.equal(span('the last question they asked'), 3);
  assert.equal(span('the last 0 minutes'), 1);
  // Only the "What to read" line counts when there is one.
  assert.equal(overlayCustomReadMinutes('What it does: summarise the last 20 minutes\nWhat to read: the last 5 minutes'), 5);
  // Free text with no parts is read whole.
  assert.equal(overlayCustomReadMinutes('Summarise the last 20 minutes'), 20);
});

test('main caps the span where the renderer does, and the editor says what a press reads', () => {
  assert.match(read('electron/llm/customButtons.ts'), /export const CUSTOM_BUTTON_MAX_WINDOW_SECONDS = 60 \* 60;/);
  const ui = read('src/components/settings/OverlayCustomButtons.tsx');
  assert.match(ui, /const readMinutes = overlayCustomReadMinutes\(draft\.prompt\);/);
  assert.match(ui, /t\('Reads the last \{\{n\}\} minutes'\)/);
  // In the footer beside the screenshot switch, so it shows while the line is typed,
  // not only in "How Natively runs it" after a save.
  const footer = ui.slice(ui.indexOf("{t('Screenshot every press')}</span>"), ui.indexOf('onClick={onCancel}'));
  assert.match(footer, /<Presence kind="text" id=\{String\(readMinutes\)\}>\{readSpan\}<\/Presence>/);
  assert.doesNotMatch(ui, /\{readSpan\} \{t\('Written from your lines/);
});
