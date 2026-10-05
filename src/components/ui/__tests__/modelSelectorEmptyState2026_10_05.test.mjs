// The overlay's model picker when no model is connected.
//
// It used to say "No models connected" / "Connect one in Settings." and offer
// nothing to click. In the 141px menu both sentences broke onto a second line
// (measured: a 96px-tall, four-line block), and the user had to close the menu
// and find Settings themselves.
//
// It is now an empty state with one action: a quiet centred line ("No models
// yet") over a button that fills the menu ("Add a model") and opens Settings on
// AI Providers, closing the menu. A first version used a model-style row for
// the action; the owner turned it down (a row with a hover fill read as a
// model, and its arrow sat away from the label), and of three redesigns picked
// the full-width button over a capsule and a native-menu item.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Line comments out: the component's own comment quotes the old copy.
const source = fs.readFileSync(path.join(here, '../../ModelSelectorWindow.tsx'), 'utf8').replace(/(^|\s)\/\/.*$/gm, '$1');
const empty = source.slice(
    source.indexOf('availableModels.length === 0 ? ('),
    source.indexOf('role="listbox"'),
);

test('the two sentences that wrapped are gone', () => {
    assert.ok(empty.length > 0);
    assert.doesNotMatch(source, /No models connected|Connect one in Settings/);
});

test('one line of status and one button, each on a single line', () => {
    assert.match(empty, /text-center[^"]*whitespace-nowrap"[^>]*>\s*No models yet\s*</, 'centred, by owner request');
    assert.match(empty, /whitespace-nowrap[^"]*"\s*>\s*Add a model\s*</);
    assert.equal(empty.split('<button').length - 1, 1);
});

test('the action looks like a control at rest, not like a model row', () => {
    assert.match(empty, /w-full h-\[28px\] rounded-\[10px\]/, 'fills the menu; corners concentric with the panel (14px less 4px of padding)');
    assert.match(empty, /bg-\[var\(--overlay-control-bg\)\] hover:bg-\[var\(--overlay-control-hover-bg\)\]/, 'theme tokens, so all four themes follow');
    assert.doesNotMatch(empty, /model-selector-row/);
});

test('it answers on press, and holds still for people who asked for less motion', () => {
    assert.match(empty, /active:scale-\[0\.97\] motion-reduce:transform-none/);
});

test('the button opens Settings on AI Providers and takes the menu out of the way', () => {
    assert.match(empty, /onClick=\{openProviders\}/);
    const handler = source.slice(source.indexOf('const openProviders = () => {'), source.indexOf('const isDarkBg'));
    assert.match(handler, /openSettingsTab\?\.\('ai-providers'\)/);
    assert.match(handler, /modelSelectorCloseIfOpen\?\.\(\)/);
});

test('no tooltip: an overlay tooltip is a separate window that screen capture can see', () => {
    assert.doesNotMatch(empty, /\btitle=/);
});
