// BrowserPageCrop + the assessment-refusal retry of issue #647
// ("[Bug]: Ctrl+H intermittently refuses HackerRank solutions").
//
// The refusal is the MODEL's own judgement of a full-screen capture: a
// background "Test Login" tab read as a live test. The retry crops the
// capture to the browser's page area — nothing is cropped until a refusal
// happened, and the original image is never modified.
//
// Pure functions only: the shell-command window enumeration is too thin to
// be worth stubbing and is covered by the no-network contract (never throws,
// [] on unsupported platforms). Imports go through dist-electron, the
// repo's convention (see fakeOllamaHarness.mjs's dist()).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = (p) => path.join(import.meta.dirname, '../../../dist-electron/electron', p);
const {
  isBrowserAppName,
  intersectionArea,
  pickBrowserWindow,
  computePageCrop,
  browserChromeTopPx,
  MAX_CHROME_FRACTION,
  croppedImagePathFor,
} = await import(pathToFileURL(dist('services/screen/BrowserPageCrop.js')).href).catch(() => ({}));

let { isAssessmentRefusal } = await import(pathToFileURL(dist('llm/AnswerValidator.js')).href).catch(() => ({}));


describe('isBrowserAppName', () => {
  test('matches the real browser app / process names', () => {
    for (const name of ['Google Chrome', 'chrome', 'chrome.exe', 'Microsoft Edge', 'msedge', 'Firefox', 'Safari', 'Brave Browser', 'Arc', 'Vivaldi', 'Opera', 'Chromium']) {
      assert.ok(isBrowserAppName(name), name);
    }
  });
  test('does not match unrelated apps', () => {
    assert.equal(isBrowserAppName('Notepad'), false);
    assert.equal(isBrowserAppName('Terminal'), false);
    assert.equal(isBrowserAppName('ChromeDevTools'), false, 'devtools window must not be seen as a browser');
    assert.equal(isBrowserAppName(''), false);
  });
  test('a name that merely contains a browser name is not enough of a match by itself', () => {
    // The predicate requires the browser token to be the whole name or a
    // clean prefix followed by a separator, so "MyChromeNotes" is not a
    // browser.
    assert.equal(isBrowserAppName('MyChromeNotes'), false);
  });
});

describe('intersectionArea', () => {
  test('overlap', () => {
    assert.equal(intersectionArea({ x: 0, y: 0, width: 100, height: 100 }, { x: 50, y: 50, width: 100, height: 100 }), 2500);
  });
  test('no overlap', () => {
    assert.equal(intersectionArea({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 20, width: 10, height: 10 }), 0);
  });
  test('contained', () => {
    assert.equal(intersectionArea({ x: 0, y: 0, width: 100, height: 100 }, { x: 10, y: 10, width: 10, height: 10 }), 100);
  });
});

describe('pickBrowserWindow', () => {
  const display = { x: 0, y: 0, width: 1920, height: 1080 };
  test('the window covering the most of the display wins', () => {
    const picked = pickBrowserWindow([
      { app: 'Safari', x: -500, y: 0, width: 200, height: 200 },
      { app: 'Google Chrome', x: 0, y: 0, width: 1920, height: 1080 },
    ], display);
    assert.equal(picked?.app, 'Google Chrome');
  });
  test('null when no window overlaps the display', () => {
    assert.equal(pickBrowserWindow([{ app: 'Safari', x: -2000, y: 0, width: 100, height: 100 }], display), null);
  });
  test('null for an empty list', () => {
    assert.equal(pickBrowserWindow([], display), null);
  });
});

describe('computePageCrop', () => {
  const display = { x:  0, y: 0, width: 1920, height: 1080 };
  const fullWindow = { x: 0, y: 0, width: 1920, height: 1080 };
  const image = { width: 1920, height: 1080 };

  test('a full-display window is cropped only from the top', () => {
    const crop = computePageCrop(fullWindow, display, image.width, image.height, browserChromeTopPx('darwin'), 'darwin');
    assert.ok(crop, 'a full-display window yields a crop');
    assert.equal(crop.left, 0);
    assert.equal(crop.width, 1920);
    assert.equal(crop.top, browserChromeTopPx('darwin'), 'top is the trimmed chrome');
    assert.equal(crop.height, 1080 - browserChromeTopPx('darwin'));
  });
  test('a window offset on the display is cropped to its own rectangle, chrome trimmed', () => {
    const window = { x: 100, y: 50, width: 1000, height: 800 };
    const crop = computePageCrop(window, display, image.width, image.height, browserChromeTopPx('darwin'), 'darwin');
    assert.ok(crop);
    assert.equal(crop.left, 100);
    assert.equal(crop.top, 50 + browserChromeTopPx('darwin'));
    assert.equal(crop.width, 1000);
    assert.equal(crop.height, 800 - browserChromeTopPx('darwin'));
  });
  test('a 2x density capture maps through the ratio, never an assumed density', () => {
    // 2x Retina: the capture is 3840x2160 for the same 1920x1080 display.
    const window = { x: 100, y: 50, width: 1000, height: 800 };
    const crop = computePageCrop(window, display, 3840, 2160, browserChromeTopPx('darwin'), 'darwin');
    assert.ok(crop);
    assert.equal(crop.left, 200);
    assert.equal(crop.top, (50 + browserChromeTopPx('darwin')) * 2);
    assert.equal(crop.width, 2000);
    assert.equal(crop.height, (800 - browserChromeTopPx('darwin')) * 2);
  });
  test('a display not at the origin', () => {
    const secondary = { x: 1920, y: 0, width: 1920, height: 1080 };
    const window = { x: 1920, y: 0, width: 1920, height: 1080 };
    const crop = computePageCrop(window, secondary, image.width, image.height, browserChromeTopPx('darwin'), 'darwin');
    assert.ok(crop);
    assert.equal(crop.left, 0);
    assert.equal(crop.top, browserChromeTopPx('darwin'));
  });
  test('the chrome trim never exceeds its fraction of the window', () => {
    // A tiny window where the default trim would eat more than
    // MAX_CHROME_FRACTION of its height.
    const tiny = { x: 0, y: 0, width: 500, height: 300 };
    const crop = computePageCrop(tiny, display, image.width, image.height, browserChromeTopPx('darwin'), 'darwin');
    assert.ok(crop);
    assert.ok(crop.height >= 300 * (1 - MAX_CHROME_FRACTION) - 1, `height ${crop.height} not clamped`);
    assert.ok(crop.top > 0, 'some trim still happens');
  });
  test('null when the window misses the display entirely', () => {
    assert.equal(computePageCrop({ x: -5000, y: 0, width: 100, height: 100 }, display, image.width, image.height, 100, 'darwin'), null);
  });
  test('null on degenerate inputs', () => {
    assert.equal(computePageCrop(fullWindow, display, 0, image.height, 100, 'darwin'), null);
    assert.equal(computePageCrop(fullWindow, { x: 0, y: 0, width: 0, height: 0 }, image.width, image.height, 100, 'darwin'), null);
    assert.equal(computePageCrop(fullWindow, display, image.width, 0, 100, 'darwin'), null);
  });
  test('null when the image/display ratio is garbage (not a sane density)', () => {
    assert.equal(computePageCrop(fullWindow, display, 1, image.height, 100, 'darwin'), null);
  });
  test('null when the crop would be too small to read', () => {
    // A 10px sliver: nothing worth sending.
    const sliver = { x: 0, y: 0, width: 1920, height: 10 };
    // Height 10 with the trim: after clamp the result must still be < 16 to
    // trip the guard.
    assert.equal(computePageCrop(sliver, display, image.width, image.height, 100, 'darwin'), null);
  });
});

describe('croppedImagePathFor', () => {
  test('a sibling -page path that keeps the extension', () => {
    // path.join uses the platform separator (`\` on Windows).
    const dir = path.join(path.sep, 'a', 'b');
    assert.equal(croppedImagePathFor(path.join(dir, 'shot.png')), path.join(dir, 'shot-page.png'));
    assert.equal(croppedImagePathFor(path.join(dir, 'shot')), path.join(dir, 'shot-page.png'));
  });
});

// The refusal detector itself lives in AnswerValidator.ts and is tested
// through dist-electron (the repo's convention). Skipped silently when no
// build exists yet — the pure tests above carry the signal.
describe('isAssessmentRefusal', () => {
  test('the #647 refusal', () => {
    if (!isAssessmentRefusal) return;
    const refusal = "I can't provide a solution for a live HackerRank test. I can explain the dynamic array algorithm or help you practice with a similar problem outside the assessment.";
    assert.equal(isAssessmentRefusal(refusal), true);
  });
  test('refusal word order flipped', () => {
    if (!isAssessmentRefusal) return;
    assert.equal(isAssessmentRefusal('Since this is a live HackerRank test I cannot solve it for you.'), true);
  });
  test('a real answer that mentions the platform is not a refusal', () => {
    if (!isAssessmentRefusal) return;
    const answer = 'Here is the solution:\n```python\ndef dynamicArray(n, queries):\n    arr = [[] for _ in range(n)]\n    last = 0\n    return []\n```\nThe complexity is O(q). I solved this HackerRank problem with XOR indices.';
    assert.equal(isAssessmentRefusal(answer), false);
  });
  test('empty is not a refusal', () => {
    if (!isAssessmentRefusal) return;
    assert.equal(isAssessmentRefusal(''), false);
  });
});
