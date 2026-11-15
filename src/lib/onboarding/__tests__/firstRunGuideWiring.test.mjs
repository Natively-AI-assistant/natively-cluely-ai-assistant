// First-run guide: the main process stores the guide and tells every window.
// Source checks, like the other IPC wiring tests: the reducer itself is tested
// in firstRunGuide.test.mjs.
// Run: node --test src/lib/onboarding/__tests__/firstRunGuideWiring.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('main handles guide:get and guide:dispatch and broadcasts guide:changed', () => {
  const ipc = read('electron/ipcHandlers.ts');
  assert.ok(ipc.includes("safeHandle('guide:get'"));
  assert.ok(ipc.includes("safeHandle('guide:dispatch'"));
  // The store (services/firstRunGuideStore.ts) validates, saves and broadcasts.
  const store = read('electron/services/firstRunGuideStore.ts');
  assert.ok(store.includes("'guide:changed'"));
  assert.ok(store.includes('GUIDE_EVENT_TYPES'), 'events are validated against the reducer list');
  assert.ok(/set\('firstRunGuide'/.test(store), 'state is saved with the other onboarding state');
});

test('preload exposes guideGet, guideDispatch and onGuideChanged (types and implementation)', () => {
  const pre = read('electron/preload.ts');
  for (const name of ['guideGet', 'guideDispatch', 'onGuideChanged']) {
    const hits = pre.split(`${name}:`).length - 1;
    assert.ok(hits >= 2, `${name} declared and implemented (found ${hits})`);
  }
  assert.ok(pre.includes("ipcRenderer.invoke('guide:get')"));
  assert.ok(pre.includes("ipcRenderer.invoke('guide:dispatch'"));
  assert.ok(pre.includes("'guide:changed'"));
});

test('SettingsManager has a firstRunGuide slot', () => {
  assert.ok(read('electron/services/SettingsManager.ts').includes('firstRunGuide?:'));
});

test('the renderer ElectronAPI type declares the guide calls', () => {
  const d = read('src/types/electron.d.ts');
  for (const name of ['guideGet:', 'guideDispatch:', 'onGuideChanged:']) assert.ok(d.includes(name), name);
});

// Evin, 2026-11-15: "both are being shown together ... after one completes the
// other is shown". Steps 2-4 are the overlay; step 5 is the notepad ALONE: main
// switches the running meeting to the notepad surface (the overlay held hidden,
// as a notepad meeting starts), the same path on macOS and Windows.
// Evin, 2026-11-15: two meetings. Meeting 1 is the overlay's; at step 7 the
// user picks the notepad in Settings › Overlay; meeting 2 is the notepad's.
// The old step-5 hand-off (main hid the overlay mid-meeting) is gone.
test('two meetings: the overlay first, the notepad picked in Settings, the overlay put back', () => {
  const store = read('electron/services/firstRunGuideStore.ts');
  assert.ok(/export function guideSurfaceSet\(surface: 'overlay' \| 'notepad'\): void/.test(store), 'main hears the switch');
  assert.ok(store.includes("g.step === 'surface') applyGuideEvent({ type: 'surface_notepad' })"), 'only step 7, only the notepad');
  assert.ok(/if \(began\) deps\.onGuideStart\?\.\(\);/.test(store) && /if \(ended\) deps\.onGuideEnd\?\.\(\);/.test(store));
  const ipc = read('electron/ipcHandlers.ts');
  assert.ok(ipc.includes("if (sm.get('guideSurfaceBefore') == null) sm.set('guideSurfaceBefore', normalizeMeetingSurface(sm.get('meetingSurface')));"), 'the user\'s own choice is kept');
  assert.ok(ipc.includes("sm.set('meetingSurface', 'overlay');"), 'meeting 1 is the overlay');
  assert.ok(ipc.includes("sm.set('meetingSurface', normalizeMeetingSurface(sm.get('guideSurfaceBefore') ?? 'overlay'));"), 'and it goes back at the end');
  assert.ok(ipc.includes('meetingSurface: () => appState.getMeetingSurface(),'), 'main says where the meeting opened');
  assert.ok(store.includes("if ((raw as { status?: unknown }).status === 'active') {") && store.includes('deps.onGuideEnd?.();'), 'an expired guide also puts it back');
  assert.ok(store.includes("meetingActive: deps.meetingActive() }, now);"), 'a save says whether a meeting runs');
  assert.ok(/plans_closed[\s\S]{0,400}deps\.factsProvider\(\)/.test(store), 'whether the guide starts uses main\'s facts');
  const setter = ipc.slice(ipc.indexOf("safeHandle('meeting-surface:set'"), ipc.indexOf("safeHandle('meeting-surface:set'") + 700);
  assert.ok(setter.includes('guideSurfaceSet(surface);'), 'the Settings switch reports to the guide');
  assert.ok(!read('electron/main.ts').includes('showNotepadForGuide'), 'no mid-meeting hand-off');
  assert.ok(!read('src/components/guide/OverlayGuide.tsx').includes('notesWindowToggle'), 'the overlay no longer opens the notepad');
});

test('main judges the trial events with its own facts, like plan_changed', () => {
  const src = fs.readFileSync(path.join(ROOT, 'electron/services/firstRunGuideStore.ts'), 'utf8');
  assert.ok(/event\.type === 'trial_out' \|\| event\.type === 'trial_unavailable'/.test(src), 'trial events get facts');
});

// Evin, 2026-11-15: "at this stage when i do any of the screenshot it should
// detect and move to next phase its not". ⌘H and ⌘⇧H go overlay -> invoke ->
// main and return the image directly; no screenshot-taken event is ever sent,
// so the overlay's listeners never heard them. Main moves step 4 itself.
test('every screenshot the user takes moves step 4, told by main', () => {
  const ipc = read('electron/ipcHandlers.ts');
  for (const ch of ['take-screenshot', 'take-selective-screenshot']) {
    const at = ipc.indexOf(`safeHandle('${ch}'`);
    assert.ok(at > 0, ch);
    const body = ipc.slice(at, ipc.indexOf('safeHandle(', at + 10));
    assert.ok(body.includes('guideScreenshotTaken()'), `${ch} tells the guide`);
  }
  const main = read('electron/main.ts');
  const cap = main.slice(main.indexOf('private async captureScreenAndProcess'), main.indexOf('private async captureScreenAndProcess') + 1500);
  assert.ok(cap.includes('guideScreenshotTaken()'), 'capture-and-answer tells the guide');
  const store = read('electron/services/firstRunGuideStore.ts');
  assert.ok(/export function guideScreenshotTaken\(\)/.test(store), 'one helper in the store');
});
