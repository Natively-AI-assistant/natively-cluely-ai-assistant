// The welcome, the tour and the demo overlay are translated (src/i18n.onboarding.ts).
// Source-level, like welcomeWiring: the components need a DOM. This catches a string
// added to one of them without a row in the dictionary, and a translation that drops
// or renames a {placeholder} the component fills.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ONBOARDING_RU, ONBOARDING_ZH, ONBOARDING_JA, ONBOARDING_ES } from '../../../i18n.onboarding.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const onboarding = path.resolve(here, '../../../components/onboarding');
const FILES = ['WelcomeScreen.tsx', 'ShortcutTour.tsx', 'WelcomeFlow.tsx', 'welcomeShared.tsx', 'DemoOverlay.tsx'];
const source = Object.fromEntries(FILES.map(f => [f, fs.readFileSync(path.join(onboarding, f), 'utf8')]));

const DICTS = { ru: ONBOARDING_RU, zh: ONBOARDING_ZH, ja: ONBOARDING_JA, es: ONBOARDING_ES };
// Translated in the generated files (or a product name), so not rows of ours.
const ALREADY_TRANSLATED = new Set(['Back', 'What to answer?', 'Clarify', 'Recap', 'Follow Up Question', 'Ask anything on screen or conversation, or', 'for selective screenshot']);

/** Every English string a component hands to tr(), plus the lesson and answer literals. */
function englishStrings() {
  const out = new Set();
  for (const src of Object.values(source)) {
    for (const m of src.matchAll(/\btr\('((?:[^'\\]|\\.)*)'\)/g)) out.add(m[1].replace(/\\'/g, "'"));
  }
  for (const m of source['ShortcutTour.tsx'].matchAll(/(?:title|text): '((?:[^'\\]|\\.)*)'/g)) out.add(m[1]);
  const demo = source['DemoOverlay.tsx'];
  for (const name of ['ANSWERS']) {
    const block = demo.slice(demo.indexOf(`const ${name} = [`), demo.indexOf('];', demo.indexOf(`const ${name} = [`)));
    for (const m of block.matchAll(/^\s*'((?:[^'\\]|\\.)*)',?$/gm)) out.add(m[1]);
  }
  for (const m of demo.matchAll(/const (WHAT_TO_SAY(?:_SHOT)?) = '([^']*)'/g)) out.add(m[2]);
  // tr(cond ? 'a' : 'b') and the plural pair
  for (const m of demo.matchAll(/'(\{n\} screenshots? attached)'/g)) out.add(m[1]);
  return [...out];
}

test('the scan finds the strings it should', () => {
  const found = englishStrings();
  for (const s of ['Welcome to Natively', 'Step {n} of {total}', 'Get the answer', 'What should I say?', 'Thinking...', '{n} screenshots attached']) {
    assert.ok(found.includes(s), `scan missed ${s}`);
  }
  assert.ok(found.filter(s => s.startsWith('I’d ') || s.startsWith('From what’s')).length === 3, 'the three canned answers');
  assert.ok(found.length > 30, `only ${found.length} strings found`);
});

test('every string the onboarding shows has a translation in all four languages', () => {
  for (const en of englishStrings()) {
    if (ALREADY_TRANSLATED.has(en) || en === 'Answer' || en === 'Ask a question or click Answer') continue;
    for (const [lang, dict] of Object.entries(DICTS)) {
      assert.ok(dict[en], `${lang} has no translation for: ${en}`);
      assert.notEqual(dict[en], en, `${lang} left this in English: ${en}`);
    }
  }
});

test('a translation keeps exactly the placeholders of its English', () => {
  const slots = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
  for (const [lang, dict] of Object.entries(DICTS)) {
    for (const [en, tx] of Object.entries(dict)) {
      assert.equal(slots(tx), slots(en), `${lang}: placeholders of "${en}" changed in "${tx}"`);
    }
  }
});

test('the four dictionaries hold the same keys', () => {
  const keys = Object.keys(ONBOARDING_RU).sort();
  for (const [lang, dict] of Object.entries(DICTS)) assert.deepEqual(Object.keys(dict).sort(), keys, lang);
});

test('the demo takes its metrics from the real overlay, not literals', () => {
  const demo = source['DemoOverlay.tsx'];
  assert.match(demo, /DEMO_OVERLAY_WIDTH = OVERLAY_DEFAULT_COLLAPSED_WIDTH/);
  assert.match(demo, /width: MODEL_SELECTOR_WIDTH/);
  assert.match(demo, /<ModelSelectorLabel>/);
  assert.doesNotMatch(demo, /width: 600\b|width: 141\b/);
});

test('the plate follows the window and the hint hangs off the call', () => {
  const shared = source['welcomeShared.tsx'];
  assert.match(shared, /new ResizeObserver\(fit\)/);
  assert.doesNotMatch(shared, /maxWidth: 600/);
  assert.doesNotMatch(shared, /top: 108/);
  assert.match(shared, /bottom: '100%'/);
});

test('the demo screenshot is the screen its question is about, and screenshot answers read it', () => {
  const demo = source['DemoOverlay.tsx'];
  assert.match(demo, /import sharedScreen from '\.\.\/\.\.\/assets\/welcome\/shared-screen\.jpg'/);
  assert.ok(fs.existsSync(path.resolve(here, '../../../assets/welcome/shared-screen.jpg')));
  assert.doesNotMatch(demo, /captureFrame|toDataURL/);
  // With a screenshot attached the answer is ANSWERS[SCREEN_ANSWER]: the one about "what's on screen".
  const answers = demo.slice(demo.indexOf('const ANSWERS = ['), demo.indexOf('];', demo.indexOf('const ANSWERS = [')))
    .split('\n').filter(l => l.trim().startsWith("'"));
  const screenIdx = Number(/const SCREEN_ANSWER = (\d+)/.exec(demo)[1]);
  assert.match(answers[screenIdx], /on screen.*second column/);
  assert.match(demo, /shots\.length \? SCREEN_ANSWER/);
});
