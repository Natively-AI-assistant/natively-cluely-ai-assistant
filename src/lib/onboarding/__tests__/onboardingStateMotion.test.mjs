// How the onboarding changes state (source-level; the components need a DOM).
// Each of these was a visible defect in a frame-by-frame recording: an empty
// column between the welcome and the tour, the step label and status line
// standing alone between two lessons, a question bubble and a screenshot tray
// that jumped in and out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, '../../../components/onboarding');
const read = f => fs.readFileSync(path.join(dir, f), 'utf8');

test('the welcome and the tour overlap, so the column is never empty', () => {
  const flow = read('WelcomeFlow.tsx');
  assert.match(flow, /<AnimatePresence mode="popLayout"/);
  assert.doesNotMatch(flow, /<AnimatePresence mode="wait"/);
  assert.match(flow, /useSlideVariants\(true\)/);
});

test('the tour has no entrance of its own on top of the swap', () => {
  assert.doesNotMatch(read('ShortcutTour.tsx'), /useRise|rise\(/);
});

test('the step label, keycaps, title and status swap as one keyed unit', () => {
  const tour = read('ShortcutTour.tsx');
  assert.match(tour, /<AnimatePresence mode="popLayout" initial=\{false\} custom=\{dir\}>/);
  // The label is inside the keyed block: nothing in the tour swaps on `key={lesson}` except that block.
  assert.equal((tour.match(/key=\{lesson\}/g) ?? []).length, 1);
});

test('Skip and Back are one label swap that holds its width', () => {
  const tour = read('ShortcutTour.tsx');
  assert.match(tour, /lesson === 0 \? 'skip' : 'back'/);
  assert.match(tour, /visibility: 'hidden'/);
});

test('the demo overlay uses the real overlay motion: bubble entrance and the tray fold', () => {
  const demo = read('DemoOverlay.tsx');
  assert.match(demo, /ov-bubble-in/);
  assert.match(demo, /import \{ ChromeFold \} from '\.\.\/overlay\/ChromeFold'/);
  assert.match(demo, /<ChromeFold show=\{tray\.length > 0\} overlayVisible=\{!gone\}/);
});
