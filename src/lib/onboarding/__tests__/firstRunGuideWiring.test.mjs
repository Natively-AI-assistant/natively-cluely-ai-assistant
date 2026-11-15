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
test('entering step 5 hands the meeting from the overlay to the notepad, in main', () => {
  const store = read('electron/services/firstRunGuideStore.ts');
  assert.ok(/onEnterStep\?: \(step: GuideStepId\) => void/.test(store), 'the store tells main which step it entered');
  assert.ok(/next\.step !== current\.step[\s\S]{0,120}deps\.onEnterStep\?\.\(next\.step\)/.test(store), 'only on a real step change');
  const ipc = read('electron/ipcHandlers.ts');
  const hook = ipc.slice(ipc.indexOf('onEnterStep: (step) => {'), ipc.indexOf('onEnterStep: (step) => {') + 260);
  assert.ok(hook.includes("if (step !== 'notepad') return;"));
  assert.ok(hook.includes("setTimeout(() => { const g = getGuideState(); if (g.status === 'active' && g.step === 'notepad') appState.showNotepadForGuide(); }, 1000);"), 'after the tick, only if still on step 5 (not skipped)');
  const main = read('electron/main.ts');
  const fn = main.slice(main.indexOf('public showNotepadForGuide(): void {'), main.indexOf('public showNotepadForGuide(): void {') + 900);
  assert.ok(fn.length > 100, 'showNotepadForGuide exists');
  assert.ok(fn.includes('if (!this.isMeetingActive) return;'), 'only during a meeting');
  assert.ok(fn.includes("this.meetingSurface = 'notepad';"), '"Meeting ongoing" then brings back the notepad');
  assert.ok(fn.includes("this.windowHelper.setWindowMode('overlay', true, { hidden: true });"), 'the overlay is held hidden, as a notepad meeting');
  assert.ok(fn.includes('this.notesWindowHelper.open({ activate: false });'), 'the notepad opens without taking focus');
  // The overlay no longer opens the notepad itself, and never draws a step the notepad is showing.
  const ov = read('src/components/guide/OverlayGuide.tsx');
  assert.ok(!ov.includes('openedForStep'), 'no renderer-side auto-open');
  assert.ok(ov.includes("if (guideOn(state, 'stop') && !notesOpen)"), 'the stop prompt is the notepad\'s when it is open');
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
