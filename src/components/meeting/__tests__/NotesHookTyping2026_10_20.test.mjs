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
  // The clear button is a down chevron, "Close" (2026-11-01).
  assert.match(page, /aria-label="Close" title="Close" onClick=\{\(\) => \{ npTrack\('answers_closed'\); setTurns\(\[\]\); \}\}[^>]*>\s*<ChevronDown/);
  // Answers are drawn from Markdown in notepad ink (2026-11-01); Copy still copies plain text.
  assert.match(page, /<NotepadAnswer text=\{turn\.text\} \/>/);
  assert.match(page, /copyText\(`turn-\$\{i\}`, plainAnswerText\(turn\.text\)\)/);
  assert.doesNotMatch(read('src/components/NativelyInterface.tsx'), /onOverlayAskFromNotes/);
  // Return in a small field (Ask among them) submits it while hook-typing.
  assert.match(page, /ev\.isKeyDown && \(ev\.keyCode === 36 \|\| ev\.keyCode === 76\)\) \{\s*setFieldSel\(null\);\s*tf\.submit\(\);/);
  const ipc = read('electron/ipcHandlers.ts');
  assert.match(ipc, /safeHandle\('live-notes:meeting-info'/);
});

test('the notepad as a preview: talks to nothing, no drag handle, takes no clicks', () => {
  const page = read('src/components/NotesWindow.tsx');
  // Every effect that talks to main (state, info, transcript, status, stream, hook, keys, ping, title, template)
  // returns early, and so does the notepad's telemetry (npTrack, 2026-11-01).
  assert.equal((page.match(/if \(preview\b|if \(phase !== 'live' \|\| preview\)|if \(preview \|\|/g) ?? []).length, 11);
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

test('notepad Ask answers: Markdown in notepad ink, no math, no accent edge on the quote (2026-11-01)', () => {
  const answer = read('src/components/notes/NotepadAnswer.tsx');
  assert.match(answer, /remarkPlugins=\{\[remarkGfm\]\}/);
  // "$175,000 ... $160,000" must stay money, not KaTeX.
  assert.doesNotMatch(answer, /remark-math|rehype-katex/);
  assert.doesNotMatch(answer, /border-l/);
  const css = read('src/index.css');
  assert.match(css, /\.np-md \.np-md-ul > \.np-md-li::before \{[^}]*background: var\(--np-ink-tertiary\)/);
  assert.match(css, /\.natively-thinking-label\.np-thinking \{ --natively-thinking-base: var\(--np-ink-tertiary\); --natively-thinking-sweep: var\(--np-ink\); \}/);
  assert.doesNotMatch(read('src/components/NotesWindow.tsx'), /np-dots/);
});

test('notepad notes: Share has no Copy row, the Copy button beside it is the one (2026-11-01)', () => {
  const menu = read('src/components/meeting/ShareMenu.tsx');
  assert.match(menu, /onCopy\?: \(\) => Promise<boolean>;/);
  assert.match(menu, /\.\.\.\(onCopy \? \[\{ key: 'copy'/);
  const notes = read('src/components/notes/NotesEnhanced.tsx');
  assert.match(notes, /<ShareMenu\s+meetingId=\{meetingId\}\s+disabled=\{regenerating\}/);
  assert.doesNotMatch(notes, /<ShareMenu[^>]*onCopy=/);
  // Share is the icon alone in the notepad, in the same 28px pill as Notes and Copy (2026-11-01:
  // "remove the share text, then position it correctly"); its menu hangs from its left edge.
  assert.match(notes, /iconOnly\s+triggerClassName="np-outline np-wash h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-full transition-colors"\s+triggerStyle=\{ink\('--np-ink'\)\}/);
  assert.match(menu, /aria-label=\{iconOnly \? t\('Share'\) : undefined\}/);
  assert.match(menu, /\{iconOnly \? \(\s*<span className="sr-only" role="status">\{saved\}<\/span>/);
  assert.match(menu, /data-origin=\{iconOnly \? 'top-left' : 'top-right'\}/);
  assert.match(menu, /absolute \$\{iconOnly \? 'left-0 mt-1\.5' : 'right-\[-4px\] mt-2'\} top-full z-50 w-\[110px\]/);
  // The meeting page keeps its labelled Share.
  assert.doesNotMatch(read('src/components/MeetingDetails.tsx'), /<ShareMenu[^>]*iconOnly/);
  // The meeting page has no Copy button of its own, so its Share menu keeps Copy.
  assert.match(read('src/components/MeetingDetails.tsx'), /<ShareMenu[\s\S]{0,600}onCopy=\{handleCopy\}/);
});

test('notepad "Writing your notes": Granola\'s pill and grey sweep (2026-11-01)', () => {
  const notes = read('src/components/notes/NotesEnhanced.tsx');
  assert.match(notes, /className=\{`np-writing-pill [^`]*h-10[^`]*rounded-full/);
  assert.match(notes, /<span aria-hidden className="np-spinner" \/>/);
  // The words step through what the summary does, swapped like transitions.dev's text swap.
  // Its words carry transitions.dev's shimmer text, in notepad ink.
  assert.match(notes, /key=\{pillLabel\}[\s\S]{0,200}className="t-shimmer max-w-full truncate align-top"\s*data-text=\{pillLabel\}/);
  // Every variable the snippet reads is set on the pill: the app sets them only on the
  // meeting page (.mn-root, .mn-followup), and without them the shimmer did not run at all.
  const pillShimmer = read('src/index.css').match(/\.np-writing-pill \.t-shimmer \{([^}]*)\}/)[1];
  const snippet = read('src/index.css').match(/\.t-shimmer::before \{[^}]*\}/)[0] + read('src/index.css').match(/\.t-shimmer \{[^}]*\}/)[0];
  for (const v of new Set(snippet.match(/--shimmer-[a-z]+/g))) assert.match(pillShimmer, new RegExp(`${v}:`), `${v} is not set for the notepad pill`);
  assert.match(notes, /exit=\{still \? \{ opacity: 0 \} : \{ opacity: 0, y: -4, filter: 'blur\(2px\)' \}\}\s*transition=\{\{ duration: 0\.15, ease: 'easeInOut' \}\}/);
  assert.match(notes, /const pillLabel = revealing \? 'Writing your notes' : steps\[Math\.min\(labelStep, steps\.length - 1\)\];/);
  assert.match(notes, /scale: 0\.96, filter: 'blur\(2px\)'/);
  const css = read('src/index.css');
  assert.match(css, /\.np-sweep-text \{[^}]*var\(--np-ink\) 46%, var\(--np-ink-secondary\) 50%, var\(--np-ink\) 54%[^}]*background-size: 320% 100%[^}]*animation: np-sweep 2\.2s linear infinite/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.np-spinner[^}]*\}\s*\.np-sweep-text \{ animation: none;/);
});

test('notepad after Stop: your notes sweep down under the pill, same-size chips, Natively logo opens the meeting (2026-11-01)', async () => {
  const notes = read('src/components/notes/NotesEnhanced.tsx');
  // Granola's X6 grayscalePulse: every line on the sweep, 140ms after the one above.
  assert.match(notes, /const SWEEP_LINE_MS = 140;/);
  assert.match(notes, /style=\{\{ animationDelay: `\$\{i \* SWEEP_LINE_MS\}ms` \}\}/);
  assert.match(read('src/components/NotesWindow.tsx'), /<NotesEnhanced [^>]*myNotes=\{text\} bottomInset=\{bottomInset\} \/>/);
  // The template menu and Copy share one chip shape.
  assert.match(notes, /const softBtn = `\$\{NP_PILL\} justify-center`;/);
  assert.match(read('src/components/notes/NotesTemplateMenu.tsx'), /className=\{`\$\{NP_PILL\} justify-center disabled:opacity-50`\}/);
  // The Open meeting logo button beside Share was removed (2026-11-01, Evin).
  assert.doesNotMatch(notes, /aria-label="Open meeting"|NativelyLogoMark/);
  assert.doesNotMatch(notes, /ExternalLink/);
});

test('notepad telemetry: every action the notepad reports is in the catalogue, and none carries text (2026-11-01)', async () => {
  const { NOTEPAD_ACTIONS } = await import('../../../lib/funnel/funnelCatalog.mjs');
  const sent = new Set();
  for (const f of ['src/components/NotesWindow.tsx', 'src/components/notes/NotesEnhanced.tsx']) {
    for (const m of read(f).matchAll(/npTrack\('([a-z_]+)'/g)) sent.add(m[1]);
  }
  for (const a of sent) assert.ok(NOTEPAD_ACTIONS.includes(a), `${a} is not in NOTEPAD_ACTIONS`);
  // Main reports these itself: the window up, closed by the user, typed into.
  const main = read('electron/main.ts');
  assert.match(main, /notepadUsed\('opened'\)/);
  assert.match(main, /notepadUsed\('closed'\)/);
  assert.match(read('electron/ipcHandlers.ts'), /if \(text\.trim\(\)\) \{ try \{ funnelTelemetry\.notepadUsed\('notes_typed'\); \}/);
  // Only a fixed name, the phase and a recipe id leave the renderer.
  assert.match(read('src/components/NotesWindow.tsx'), /funnelTrack\?\.\('notepad_used', \{ action, phase, \.\.\.\(recipe \? \{ recipe: recipe\.replace\(\/-\/g, '_'\) \} : \{\}\) \}\)/);
  const ipc = read('electron/ipcHandlers.ts');
  assert.match(ipc, /'answer_failed', 'notepad_used'\]\);/);
  assert.match(ipc, /funnelTelemetry\.meetingSurfaceSet\(before, surface\)/);
});

test('notepad: the notes are written down the page behind the pill, as in the owner\'s Granola recording (2026-11-01)', async () => {
  const notes = read('src/components/notes/NotesEnhanced.tsx');
  // One pill from Stop until the last line has settled, then it leaves.
  assert.match(notes, /const showPill = \(!ready && !unwritten && loaded\) \|\| regenerating \|\| pendingReveal \|\| revealing;/);
  // Lines come out one at a time: `shown` counts them, null = all.
  assert.match(notes, /const \[shown, setShown\] = useState<number \| null>\(null\);/);
  assert.match(notes, /return \{ out: i < shown, className: 'np-write-line', line: i \};/);
  assert.match(notes, /revealTick\.current = setInterval\(\(\) => \{\s*out \+= 1;\s*setShown\(out\);/);
  // The pill comes AFTER the written lines (the write head), above your notes before that.
  const order = ['{ready && (\n                <div className={`mt-5 space-y-5', '<AnimatePresence mode="popLayout">', '{!ready && unwritten && (', '{!ready && !unwritten && loaded && ('].map((m) => notes.indexOf(m));
  assert.ok(order.every((n) => n > 0) && order[0] < order[1] && order[1] < order[2] && order[2] < order[3], String(order));
  assert.match(notes, /\$\{ready \? 'np-write-head' : ''\}/);
  // Its ride is a velocity-keeping spring on a motion value (FLIP from a layout marker), not a
  // retargeted tween (that lurched: 10–20px a frame, then stops).
  assert.match(notes, /const WRITE_HEAD_SPRING = \{ type: 'spring', stiffness: 170, damping: 26, mass: 1 \} as const;/);
  assert.match(notes, /const velocity = pillY\.getVelocity\(\);\s*pillY\.jump\(pillY\.get\(\) \+ delta\);\s*animate\(pillY, 0, \{ \.\.\.WRITE_HEAD_SPRING, velocity \}\);/);
  assert.match(notes, /const seenAt = \(at: number\) => Math\.min\(rootTop \+ at - WRITE_HEAD_OVERLAP_PX, lowest\);/);
  assert.match(notes, /<div ref=\{markerRef\} aria-hidden \/>/);
  assert.doesNotMatch(notes, /layout="position"/);
  // Only notes written while the pill waited are written out; an old meeting just shows.
  assert.match(notes, /if \(waited >= 600\) startReveal\(lineCount\);/);
  // A rewrite is written out too.
  assert.match(notes, /pendingSince\.current = details\?\.detailedSummary;\s*setPendingReveal\(true\);\s*load\(\);/);
  const css = read('src/index.css');
  // Motion tokens (transitions-polish): arrival = text reveal (500ms ease-in-out, 12px, 3px blur);
  // the grey-to-ink settle is Granola's, 900ms.
  assert.match(css, /\.np-write-line \{ animation: np-write-in 500ms ease-in-out both, np-write-ink 900ms cubic-bezier\(0\.22, 1, 0\.36, 1\) both; \}/);
  assert.match(css, /@keyframes np-write-in \{\s*from \{ opacity: 0; transform: translateY\(12px\); filter: blur\(3px\); \}/);
  assert.match(css, /@keyframes np-write-ink \{\s*0%, 30% \{ color: var\(--np-ink-tertiary\); \}\s*\}/);
  // Lines hidden under the stopped pill settle as it leaves.
  // Its own keyframe: reusing np-write-ink (already finished on that line) would not restart.
  assert.match(css, /\.np-write-late \{ animation: np-write-late 900ms[^}]*\}\s*@keyframes np-write-late \{\s*0%, 30% \{ color: var\(--np-ink-tertiary\); \}/);
  assert.match(notes, /className: lateFrom !== null && i >= lateFrom \? 'np-write-late' : ''/);
  assert.equal((notes.match(/data-np-line=\{/g) ?? []).length, 3);
  // Leaves as a toast closes: 350ms smooth-out with a 2px blur (150ms read as a blink: 1 → 0.44 in one frame),
  // contracting slightly as it goes (0.96).
  assert.match(notes, /exit=\{still \? \{ opacity: 0 \} : \{ opacity: 0, scale: 0\.96, filter: 'blur\(2px\)', transition: \{ duration: 0\.35, ease: \[0\.22, 1, 0\.36, 1\] \} \}\}/);

  // Your notes fade out instead of being cut.
  assert.match(notes, /key="your-notes"\s*exit=\{still \? \{ opacity: 0 \} : \{ opacity: 0, filter: 'blur\(2px\)', transition: \{ duration: 0\.15/);
  // It stops above the Ask bar, and what is written past it stays hidden under it.
  // The 12px overlap is a translate, never a negative top margin: the leaving pill is pinned where it
  // stands and a margin would apply twice (a 12px hop). No height in the page, so removing it moves nothing.
  assert.match(css, /\.np-write-head \{ position: sticky; bottom: 8rem; z-index: 10; translate: 0 -0\.75rem; margin-bottom: -2\.5rem; \}/);
  assert.doesNotMatch(css, /\.np-write-head \{[^}]*margin-top/);
  assert.match(notes, /bottom: stopPx - WRITE_HEAD_OVERLAP_PX/);
  assert.match(css, /\.np-write-head::after \{[^}]*top: 100%;[^}]*background: linear-gradient\(to bottom, transparent, var\(--np-surface\) 12px\)/);
  assert.match(css, /\.np-fade-in-soft \{ animation: np-fade-in 400ms ease-in-out both; \}/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.np-write-line, \.np-write-late, \.np-fade-in-soft \{ animation: none; \} \}/);
});

test('notepad writing pace: 140ms a line, faster for long notes, about 4s at most', async () => {
  const src = read('src/components/notes/NotesEnhanced.tsx');
  const pick = (re) => src.match(re)[0].replace(/export const /g, 'const ').replace(/export function (\w+)\((\w+): number\): number/g, 'function $1($2)');
  const body = [/export function revealStepMs[\s\S]*?\n\}/, /export const WRITE_SETTLE_MS = \d+;/, /export function revealDurationMs[\s\S]*?\n\}/].map(pick).join('\n');
  const { revealStepMs, revealDurationMs } = new Function(`const SWEEP_LINE_MS = 140; ${body}; return { revealStepMs, revealDurationMs };`)();
  assert.equal(revealStepMs(1), 140);
  assert.equal(revealStepMs(20), 140);
  assert.equal(revealStepMs(60), 70);
  assert.equal(revealStepMs(500), 45);
  assert.equal(revealDurationMs(1), 140 + 900);
  assert.equal(revealDurationMs(20), 20 * 140 + 900);
  assert.ok(revealDurationMs(60) <= 5200);
});

test('notepad pill words: real steps, one per 2.2s sweep, holding on the last (2026-11-01)', async () => {
  const src = read('src/components/notes/NotesEnhanced.tsx');
  const body = src.match(/export function writingLabels[\s\S]*?\n\}/)[0]
    .replace(/export function writingLabels\(hasMyNotes: boolean, rewrite: boolean\): string\[\]/, 'function writingLabels(hasMyNotes, rewrite)');
  const writingLabels = new Function(`${body}; return writingLabels;`)();
  assert.deepEqual(writingLabels(true, false), ['Reading the transcript', 'Going through your notes', 'Finding the key points', 'Pulling out decisions and next steps', 'Writing your notes']);
  assert.deepEqual(writingLabels(false, false), ['Reading the transcript', 'Finding the key points', 'Pulling out decisions and next steps', 'Writing your notes']);
  assert.deepEqual(writingLabels(true, true), ['Reading the transcript again', 'Rewriting your notes']);
  assert.match(src, /const LABEL_STEP_MS = 2200;/);
});

test('notepad: notes longer than the window are followed down as they are written; scrolling yourself stops it (2026-11-01)', () => {
  const src = read('src/components/notes/NotesEnhanced.tsx');
  // The pill stops above the bottom bar as the window measures it (128px only until then),
  // so it never slides behind the My notes / Enhanced switch.
  assert.match(src, /const BOTTOM_BAR_PX = 128;/);
  assert.match(src, /const stopPx = \(bottomInset \?\? BOTTOM_BAR_PX\) \+ WRITE_HEAD_GAP_PX;/);
  assert.match(src, /style=\{ready \? \{ y: pillY, bottom: stopPx - WRITE_HEAD_OVERLAP_PX \} : \{ y: pillY \}\}/);
  assert.match(src, /scroller\.getBoundingClientRect\(\)\.bottom - stopRef\.current;/);
  const win = read('src/components/NotesWindow.tsx');
  assert.match(win, /const covered = Math\.round\(page\.getBoundingClientRect\(\)\.bottom - bar\.getBoundingClientRect\(\)\.top\);/);
  assert.match(win, /ro\.observe\(page\);\s*ro\.observe\(bar\);/);
  assert.match(win, /<div ref=\{bottomBarRef\} className="relative px-4 pb-\[27\.5px\]/);
  // The scroll rides the same spring, keeping its speed from line to line.
  assert.match(src, /pageRide\.current = animate\(pageY, target, \{\s*\.\.\.WRITE_HEAD_SPRING,\s*velocity,\s*onUpdate: \(v\) => \{ if \(follow\.current\) scroller\.scrollTop = v; \},/);
  assert.match(src, /const stop = \(\) => \{ follow\.current = false; pageRide\.current\?\.stop\(\); pageRide\.current = null; \};/);
  // Measured from layout, not from the rising line or the gliding pill.
  assert.match(src, /newest\.offsetTop \+ newest\.offsetHeight \+ WRITE_HEAD_BELOW_PX/);
  for (const ev of ['wheel', 'touchmove', 'pointerdown']) assert.match(src, new RegExp(`scroller\\.addEventListener\\('${ev}', stop`));
  assert.match(src, /follow\.current = true;\s*scrollerRef\.current = scrollParent\(rootRef\.current\);/);
  // The sticky stop stays as the fallback when the user takes over.
  assert.match(read('src/index.css'), /\.np-write-head \{ position: sticky; bottom: 8rem;/);
});

test('notepad: the page fades out under the heading once scrolled, instead of being cut at a straight edge (2026-11-01)', () => {
  const win = read('src/components/NotesWindow.tsx');
  assert.match(win, /onScroll=\{\(e\) => setPageScrolled\(e\.currentTarget\.scrollTop > 2\)\}/);
  // Sticks to the page's top edge, takes no room, never catches clicks.
  assert.match(win, /className="np-fade-top np-page-fade pointer-events-none sticky top-0 z-\[11\] -mb-7 h-7"\s*data-shown=\{pageScrolled \? 'true' : undefined\}/);
  const css = read('src/index.css');
  assert.match(css, /\.np-fade-top \{ background: linear-gradient\(to bottom, var\(--np-surface\), transparent\); \}/);
  assert.match(css, /\.np-page-fade \{ opacity: 0; transition: opacity 150ms ease-out; \}\s*\.np-page-fade\[data-shown="true"\] \{ opacity: 1; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.np-page-fade \{ transition: none; \} \}/);
});

test('the notepad stops waiting when main finished with no notes (2026-11-01)', () => {
    const src = readFileSync(new URL('../../notes/NotesEnhanced.tsx', import.meta.url), 'utf8');
    assert.match(src, /const outcome = notesOutcome\(ready, details\?\.summaryStatus\)/);
    assert.match(src, /const unwritten = \(outcome === 'nothing' \|\| outcome === 'failed'\) && !rewriting/);
    // The pill, its label timer and the 4s reload all stop; the sweep over your notes too.
    assert.match(src, /const showPill = \(!ready && !unwritten && loaded\) \|\| regenerating/);
    assert.match(src, /const waitingForNotes = \(\(!ready && !unwritten\) \|\| rewriting\)/);
    assert.match(src, /if \(ready \|\| unwritten\) return;\s*const timer = setInterval\(load/);
    assert.match(src, /\{!ready && !unwritten && loaded && \(/);
    // Nothing until the meeting's first load is back: no pill flashing on a finished meeting.
    assert.match(src, /getMeetingDetails\?\.\(meetingId\)\.then\(\(d: any\) => \{\s*setLoaded\(true\);/);
    assert.match(src, /\.catch\(\(\) => \{ setLoaded\(true\);/);
    // It says so, and a failed pass can be tried again.
    assert.match(src, /'No notes to write'/);
    assert.match(src, /'Your notes couldn’t be written'/);
    assert.match(src, /outcome === 'failed' && \(\s*<button type="button" onClick=\{\(\) => \{ void regenerate\(\{ kind: 'rewrite' \}\); \}\}[\s\S]{0,120}Try again/);
});
