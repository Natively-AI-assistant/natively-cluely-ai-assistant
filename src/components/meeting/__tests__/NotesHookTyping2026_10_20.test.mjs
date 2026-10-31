// The notes window is typed into without focus, as the overlay's input is
// (2026-10-20): the keyboard hook's keys are added at the end of the notes, the
// window is never activated by a click on Windows, and the Notes button opens
// it without focus on both platforms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { applyTypedKeyAtEnd } from '../notesView.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const key = (keyCode, chars = '', isKeyDown = true) => ({ keyCode, chars, isKeyDown });

test('characters go at the end; key-ups and empty keys change nothing', () => {
  assert.equal(applyTypedKeyAtEnd('Hel', key(37, 'l')), 'Hell');
  assert.equal(applyTypedKeyAtEnd('', key(0, 'é')), 'é');
  assert.equal(applyTypedKeyAtEnd('abc', key(37, 'l', false)), null);
  assert.equal(applyTypedKeyAtEnd('abc', key(48, '\t')), null);
  assert.equal(applyTypedKeyAtEnd('abc', key(999, '')), null);
});

test('Return is a new line and continues a point, as typed Enter does', () => {
  assert.equal(applyTypedKeyAtEnd('Plan', key(36, '\r')), 'Plan\n');
  assert.equal(applyTypedKeyAtEnd('- first', key(36, '\r')), '- first\n- ');
  assert.equal(applyTypedKeyAtEnd('- first\n- ', key(76, '\r')), '- first\n');
});

test('Backspace takes the last character; Esc never edits (main ends the session)', () => {
  assert.equal(applyTypedKeyAtEnd('abc', key(51)), 'ab');
  assert.equal(applyTypedKeyAtEnd('', key(51)), null);
  assert.equal(applyTypedKeyAtEnd('abc', key(53, '\u001b')), null);
});

test('the page starts its own session on click, blocks the focus, and acts only on its own session', () => {
  const page = read('src/components/NotesWindow.tsx');
  assert.match(page, /onEngage=\{engage\('notes'\)\}/);
  assert.match(page, /onMouseDown=\{engage\('ask'\)\}/);
  assert.match(page, /e\.preventDefault\(\);/);
  assert.match(page, /api\.stealthTapStart\(\)/);
  assert.match(page, /const mine = active && target === 'notes';/);
  // The page's keys go to the editor at its selection; the small fields (Ask, title, find…) at their end.
  assert.match(page, /if \(f === 'notes'\) \{\s*editorRef\.current\?\.typeKey\(ev\);/);
  assert.match(page, /applyTypedKeyAtEnd\(tf\.get\(\), ev, allSelected\)/);
  // The editor's mousedown runs the window's engage first; with focus blocked it sets the selection itself.
  const editor = read('src/components/notes/NotesEditor.tsx');
  assert.match(editor, /onEngage\?\.\(e\);/);
  assert.match(editor, /e\.defaultPrevented/);
  // Windows knows at mount whether the hook can type, as the overlay does.
  assert.match(page, /api\.platform === 'win32'[\s\S]{0,120}stealthTapAvailable/);
});

test('the overlay ignores a notes session (no expanding, no typing into its input)', () => {
  const overlay = read('src/components/NativelyInterface.tsx');
  assert.match(overlay, /const active = anyActive && \(target \?\? 'overlay'\) === 'overlay';/);
});

test('main: keys go only to the session\'s window; the notes window is never activated on Windows; opened without focus', () => {
  const mgr = read('electron/services/StealthKeyboardManager.ts');
  assert.match(mgr, /if \(this\.target === 'notes'\) \{\s*const notes = this\.targetWindow\('notes'\);\s*if \(notes\) notes\.webContents\.send\('stealth-key-captured', ev\);\s*return;/);
  assert.match(mgr, /this\.broadcast\('stealth-tap-state', \{ \.\.\.state, target: this\.target \}\)/);
  // Windows: a session only while its window is visible.
  assert.match(mgr, /const win = this\.targetWindow\(target\);\s*if \(!win \|\| !win\.isVisible\(\)\) return false;/);
  const helper = read('electron/NotesWindowHelper.ts');
  assert.match(helper, /if \(attachNoActivate\(win\)\) applied\.push\('noActivate'\)/);
  assert.match(helper, /this\.stealthTyping\(\)\?\.setNotesWindow\(win\)/);
  assert.match(helper, /public toggle\(\): boolean \{[\s\S]*?this\.open\(\{ activate: false \}\)/);
  assert.match(helper, /this\.stealthTyping\(\)\?\.stopIfTarget\('notes'\)\s*win\.hide\(\)/, 'hiding ends its session');
  assert.match(helper, /win\.on\('focus', \(\) => \{\s*this\.stealthTyping\(\)\?\.stopIfTarget\('overlay'\)/);
});

test("laid out like Granola's: neutral with pastel accents, serif title, Today + people chip, no folder button, Write notes, a listening pill with stop beside Ask anything", () => {
  const page = read('src/components/NotesWindow.tsx');
  const heading = read('src/components/notes/NotesHeading.tsx');
  assert.match(heading, /font-plex-serif/);
  assert.match(heading, /text-\[24px\] leading-\[28px\]/);
  assert.match(heading, /Today\s*\{info\.people > 0 &&/);
  // Folders have no view since the launcher dropped it (22d35e0d), so the notepad offers none.
  assert.doesNotMatch(heading + page, /Add to folder|liveNotesFolders/);
  // Granola's live page: no toolbar on a selection, three "/" items.
  assert.doesNotMatch(read('src/components/notes/NotesEditor.tsx'), /BubbleMenu/);
  assert.match(page, /liveNotesMeetingInfo/);
  assert.match(read('src/components/notes/NotesEditor.tsx'), /Placeholder\.configure\(\{ placeholder: 'Write notes' \}\)/);
  assert.match(page, /notes-listening-bars/);
  assert.match(page, /aria-label="Stop transcript"[\s\S]{0,200}endMeeting/);
  // Pause moved into the ⋯ menu; a paused pill reads Resume.
  assert.match(page, /role="menu"[\s\S]*togglePause\(\)[\s\S]*Pause transcription/);
  assert.match(page, /\{paused && \([\s\S]{0,200}onClick=\{togglePause\}[\s\S]{0,200}Resume/);
  // The look comes from the notepad tokens: neutral surfaces, pastel accents.
  assert.match(page, /className=\{`notepad /);
  assert.match(read('src/index.css'), /\.notepad \{[\s\S]{0,200}--np-surface: #f9f9fb;/);
  assert.match(read('src/index.css'), /\.notepad\[data-np-theme="dark"\] \{[\s\S]{0,200}--np-surface: #1c1c1f;/);
  // Transcript open: the panel holds the listening controls and the mic / language row.
  assert.match(page, /<AnimatePresence initial=\{false\}>\s*\{showTranscript && \(/);
  // The floating panel: plate springs in, the space above the pills grows, the edge drags the height.
  // Slow, unbouncy springs (2026-10-30): the transcript .55 s open / .45 s close, Ask's row .4 / .3.
  assert.match(page, /const PANEL_OPEN = \{ type: 'spring', duration: 0\.55, bounce: 0 \}/);
  assert.match(page, /const PANEL_CLOSE = \{ type: 'spring', duration: 0\.45, bounce: 0 \}/);
  assert.match(page, /const ROW_CLOSE = \{ type: 'spring', duration: 0\.3, bounce: 0 \}/);
  assert.match(page, /transition=\{panelMotion\}/);
  // Ask and the transcript's mic / language share one slot and crossfade; Ask is never unmounted.
  assert.match(page, /<motion\.form[\s\S]{0,400}inert=\{showTranscript\}/);
  assert.match(page, /key="transcript-controls"[\s\S]{0,1200}<TranscriptControls \/>/);
  // Ask opening folds the listening pill away (no unmount, so Ask widens instead of jumping), inert while folded.
  assert.match(page, /inert=\{askOpen\}/);
  assert.match(page, /\{ width: 0, opacity: 0, marginRight: -8, overflow: 'hidden' \}/);
  // Ask keeps its fill while open, so the page never shows through before the plate arrives.
  assert.match(read('src/index.css'), /\.np-ask \{ background: var\(--np-elevated\);/);
  assert.match(page, /animate=\{\{ opacity: panelKind \? 1 : 0, scale: panelKind \? 1 : 0\.98 \}\}/);
  assert.match(page, /animate=\{\{ height: panelKind \? contentHeight : 0 \}\}/);
  assert.match(page, /onPointerDown=\{startResize\}/);
  // Ask open: one card, two recipes and All recipes over the field; a press outside closes it.
  assert.match(page, /\{chipRecipes\.map\(recipeButton\)\}[\s\S]{0,1500}All recipes[\s\S]{0,800}<NpPop open=\{askOpen && allRecipes && turns\.length === 0 && slashQuery === null\} origin="bottom right" role="menu" aria-label="All recipes"/);
  assert.match(page, /askCardRef\.current\?\.contains\(e\.target as Node\)\) return;\s*setAskEngaged\(false\);/);
  const controls = read('src/components/notes/TranscriptControls.tsx');
  assert.match(controls, /localStorage\.setItem\(SAVED_INPUT_KEY, id\)/);
  assert.match(controls, /setMeetingInputDevice\?\.\(id\)/);
  assert.match(controls, /isInternalCaptureDevice\(d\.id\)/);
  assert.match(controls, /choices \? setOpen[\s\S]{0,80}: openAudioSettings\(\)/);
  // Main: the switch is queued (each one rebuilds the native mic capture) and only runs in a meeting.
  const main = read('electron/main.ts');
  assert.match(main, /public switchMeetingInputDevice\(deviceId: string \| null\): Promise<boolean> \{[\s\S]{0,300}isInternalCaptureDevice\(deviceId\)[\s\S]{0,200}if \(!this\.isMeetingActive\) return false;[\s\S]{0,900}await this\.reconfigureAudio\(deviceId, this\._lastRequestedOutputDeviceId\);[\s\S]{0,100}this\._inputSwitchChain\.then\(run, run\)/);
  assert.match(read('electron/ipcHandlers.ts'), /safeHandle\('meeting:set-input-device'/);
  assert.match(read('electron/preload.ts'), /setMeetingInputDevice: \(deviceId: string \| null\) => ipcRenderer\.invoke\('meeting:set-input-device', deviceId\)/);
  assert.match(page, /placeholder=\{turns\.length > 0 \? 'Continue chat' : 'Ask anything'\}/);
  assert.match(page, /api\.streamGeminiChat\(question, undefined, context\)/);
  // Shorten and Attach image live in the ⋯ menu now.
  assert.match(page, /role="menu"[\s\S]*shortenLine[\s\S]*attachImage/);
  // Ask is answered in the notepad (a notepad meeting has no overlay); Return in Ask submits while hook-typing.
  assert.match(page, /aria-label="New chat"/);
  assert.match(page, /plainAnswerText\(turn\.text\)/);
  assert.doesNotMatch(read('src/components/NativelyInterface.tsx'), /onOverlayAskFromNotes/);
  // Return in a small field (Ask among them) submits it while hook-typing.
  assert.match(page, /ev\.isKeyDown && \(ev\.keyCode === 36 \|\| ev\.keyCode === 76\)\) \{\s*setFieldSel\(null\);\s*tf\.submit\(\);/);
  const ipc = read('electron/ipcHandlers.ts');
  assert.match(ipc, /safeHandle\('live-notes:meeting-info'/);
});

test('the notepad as a preview: talks to nothing, no drag handle, takes no clicks', () => {
  const page = read('src/components/NotesWindow.tsx');
  // Every effect that talks to main (state, info, transcript, status, stream, hook, keys, ping, title, template) returns early.
  assert.equal((page.match(/if \(preview\b|if \(phase !== 'live' \|\| preview\)|if \(preview \|\|/g) ?? []).length, 10);
  assert.match(page, /preview \? '' : 'drag-region '/);
  assert.match(page, /inert=\{preview \? true : undefined\}/);
});

test('Settings › Overlay: the switcher at the top picks what meetings open, and the notepad side shows the real page', () => {
  const settings = read('src/components/settings/OverlaySettings.tsx');
  assert.match(settings, /label: 'Natively overlay'/);
  assert.match(settings, /label: 'Natively notepad'/);
  assert.match(settings, /role="radiogroup"/);
  assert.match(settings, /window\.electronAPI\?\.setMeetingSurface\?\.\(next\)/);
  assert.match(settings, /<NotesWindow preview=\{NOTEPAD_SAMPLE\} \/>/);
  // Each side keeps its own settings.
  assert.match(settings, /surface === 'notepad'[\s\S]*<NotepadPreview \/>[\s\S]*\{opacityControl\}/);
});

test('plainAnswerText: a model answer reads as plain text in the notepad', async () => {
  const { plainAnswerText } = await import('../notesView.ts');
  assert.equal(plainAnswerText('**Maya** drafts the `release note`.'), 'Maya drafts the release note.');
  assert.equal(plainAnswerText('## Next\n* one\n* two'), 'Next\n- one\n- two');
  assert.equal(plainAnswerText('a *really* good point, 2 * 3 = 6'), 'a really good point, 2 * 3 = 6');
  assert.equal(plainAnswerText('```js\nx()\n```'), 'x()');
});

test('note templates in the notepad: "/" before Stop sets the meeting\'s, the gallery types through the hook, after Stop rewrites', () => {
  const win = read('src/components/NotesWindow.tsx');
  assert.match(win, /onTemplate=\{phase !== 'ended' && !preview \? onSlashTemplate : undefined\}/);
  assert.match(win, /api\.liveNotesSetTemplate\(id\)/);
  assert.match(win, /template: \{ get: \(\) => galleryQueryRef\.current, set: setGalleryQuery/);
  assert.match(win, /onEngageSearch=\{engage\('template'\)\}/);
  assert.match(win, /if \(phase === 'ended'\) enhancedRef\.current\?\.applyTemplate\(id,/);
  assert.match(win, /f === 'template' && ev\.isKeyDown && ev\.keyCode === 53/);
  const editor = read('src/components/notes/NotesEditor.tsx');
  assert.match(editor, /return onTemplateRef\.current \? all : all\.filter\(\(e\) => e\.kind === 'command'\)/);
  assert.match(editor, /editor\.view\.dispatch\(editor\.state\.tr\.delete\(open\.from, open\.to\)\);\s*onTemplateRef\.current\?\.\(entry\.kind === 'template' \? entry\.id : null\)/);
  const enhanced = read('src/components/notes/NotesEnhanced.tsx');
  assert.match(enhanced, /req\.kind === 'template' \? \{ noteTemplateId: req\.id \} : req\.kind === 'mode' \? \{ modeId: req\.id \} : \{\}/);
  assert.match(enhanced, /<NotesTemplateMenu/);
  assert.doesNotMatch(read('src/components/notes/NotesTemplateMenu.tsx') + read('src/components/notes/NoteTemplateGallery.tsx'), /Sparkles/);
});

test('recipes in Granola\'s shapes (2026-10-31): a quote reads as its line; recipes come from the shared catalogue and Retry reruns them', async () => {
  const { plainAnswerText } = await import('../notesView.ts');
  assert.equal(plainAnswerText('You could say:\n\n> The midpoint method gives 0.73.'), 'You could say:\n\nThe midpoint method gives 0.73.');
  assert.equal(plainAnswerText('**To do:**\n- Read chapter 6'), 'To do:\n- Read chapter 6');
  const win = read('src/components/NotesWindow.tsx');
  // Granola's chips: the live helpers while live, then the follow-up email and todos (electron/llm/noteRecipes.ts).
  assert.match(win, /const CHIP_IDS: Record<'live' \| 'ended', string\[\]> = \{ live: \['what-did-i-miss', 'sound-smart'\], ended: \['follow-up-email', 'todos'\] \};/);
  // The turn shows the recipe's name; Retry runs the same recipe with what was typed after it.
  assert.match(win, /const label = extra \? `\$\{recipe\.label\} \$\{extra\}` : recipe\.label;/);
  assert.match(win, /if \(recipe\) runRecipe\(recipe, turn\.extra \?\? ''\);/);
});
