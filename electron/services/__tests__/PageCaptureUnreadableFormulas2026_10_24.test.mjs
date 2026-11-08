// electron/services/__tests__/PageCaptureUnreadableFormulas2026_10_24.test.mjs
//
// Issue #645: ⌘/Ctrl+Y on a HackerRank problem delivered page text with the
// formulas missing (HackerRank draws them as bare SVG paths), and nothing said
// so. The extension now marks each one and reports `meta.unreadableFormulas`
// on its /dom POST. These tests pin the desktop half:
//   - PhoneMirrorService carries the count from the /dom POST to the
//     requestDomCapture() result, and keeps it out of the renderer's meta;
//   - a capture from the extension popup (no reqId, so no screenshot) gets a
//     notice that the formulas are missing;
//   - describeUnreadableFormulas() words the notice (attached / failed / not taken);
//   - FormulaScreenshotHandoff gets the screenshot to an answer already on its
//     way in the one-motion ⌘Y→Enter flow, and to the overlay otherwise;
//   - main.ts attaches a screenshot (no auto-answer) only after a successful
//     capture that reported the count; both answer requests ask for it.
// Follow-up: the extension now draws those formulas into an image sent with
// the text (`formulaImages`), so the answer does not wait for a screenshot;
// the desktop checks the images, hands them on, and screenshots only when the
// extension sent none.
//
// Compiled modules from dist-electron, per the repo convention.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../');
const require = createRequire(path.join(repoRoot, 'package.json'));
const WS = require('ws').WebSocket;
const dist = (p) => pathToFileURL(path.resolve(repoRoot, 'dist-electron/electron', p)).href;

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-formulas-test-'));
class FakeBrowserWindow {
  constructor() {
    this.sent = [];
    this.webContents = { send: (channel, ...args) => this.sent.push({ channel, args }) };
  }
  isDestroyed() {
    return false;
  }
  static getFocusedWindow() {
    return null;
  }
  static getAllWindows() {
    return [];
  }
}
const electronStub = {
  app: { isReady: () => true, getPath: () => userDataDir, whenReady: () => Promise.resolve(), on: () => {} },
  BrowserWindow: FakeBrowserWindow,
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('enc:' + s, 'utf8'),
    decryptString: (buf) => Buffer.from(buf).toString('utf8').replace(/^enc:/, ''),
  },
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronStub;
  return originalLoad.call(this, request, parent, isMain);
};

let PhoneMirrorService;
let unreadableFormulasOf;
let describeUnreadableFormulas;
let UNREADABLE_FORMULA_MARKER;
let PAGE_CAPTURE_FALLBACK_CHANNEL;
let FormulaScreenshotHandoff;
let markMissingFormulas;
let formulaImagesOf;
let describeFormulaImage;
let hasFormulaMarker;
let FORMULA_IN_IMAGE_RE;
let AUTO_FORMULA_IMAGE_MAX_AGE_MS;
before(async () => {
  ({ PhoneMirrorService, unreadableFormulasOf, formulaImagesOf } = await import(dist('services/PhoneMirrorService.js')));
  ({ describeUnreadableFormulas, UNREADABLE_FORMULA_MARKER, PAGE_CAPTURE_FALLBACK_CHANNEL, describeFormulaImage, hasFormulaMarker, FORMULA_IN_IMAGE_RE } =
    await import(dist('services/pageCaptureFallback.js')));
  ({ FormulaScreenshotHandoff, markMissingFormulas, AUTO_FORMULA_IMAGE_MAX_AGE_MS } = await import(dist('services/formulaScreenshotHandoff.js')));
});
after(() => {
  Module._load = originalLoad;
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch {}
});

function connectExtension(port, token) {
  return new Promise((resolve, reject) => {
    const ws = new WS(`ws://127.0.0.1:${port}/ws?t=${encodeURIComponent(token)}`);
    const frames = [];
    ws.on('message', (d) => {
      try {
        frames.push(JSON.parse(d.toString()));
      } catch {}
    });
    ws.on('error', reject);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'hello', role: 'extension', v: 1 }));
      setTimeout(() => resolve({ ws, frames }), 60);
    });
  });
}

const waitFor = async (fn, ms = 2000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timed out');
};

// The extension's side of a desktop-pull capture: POST /dom with the reqId and
// meta, then ack `done` (the real service worker acks only after the 200).
async function answerCapture({ port, token, ws, frames }, meta, extra = {}) {
  const req = await waitFor(() => frames.find((f) => f.type === 'capture-dom'));
  const res = await fetch(`http://127.0.0.1:${port}/dom?t=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dom: 'TITLE: Matrix Layer Rotation\n\n[formula not captured]', reqId: req.reqId, meta, ...extra }),
  });
  assert.equal(res.status, 200);
  ws.send(JSON.stringify({ type: 'capture-ack', reqId: req.reqId, status: 'done' }));
}

async function captureWith(meta, extra) {
  const svc = PhoneMirrorService.getInstance();
  if (svc.isRunning()) await svc.stop({ persist: false });
  const info = await svc.start({ exposeOnLan: false, persist: false });
  const overlay = new FakeBrowserWindow();
  svc.setOverlayResolver(() => overlay);
  const ext = await connectExtension(info.port, info.extToken);
  const pending = svc.requestDomCapture({ timeoutMs: 3000 });
  await answerCapture({ port: info.port, token: info.extToken, ...ext }, meta, extra);
  const result = await pending;
  ext.ws.close();
  await svc.stop({ persist: false });
  return { result, delivered: overlay.sent.find((s) => s.channel === 'dom-context-received'), sent: overlay.sent };
}

// The popup's Capture button: the extension POSTs /dom on its own, no reqId.
async function popupCapture(meta, extra = {}) {
  const svc = PhoneMirrorService.getInstance();
  if (svc.isRunning()) await svc.stop({ persist: false });
  const info = await svc.start({ exposeOnLan: false, persist: false });
  const overlay = new FakeBrowserWindow();
  svc.setOverlayResolver(() => overlay);
  const res = await fetch(`http://127.0.0.1:${info.port}/dom?t=${encodeURIComponent(info.extToken)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dom: 'TITLE: Matrix Layer Rotation\n\n[formula not captured]', meta, ...extra }),
  });
  assert.equal(res.status, 200);
  await svc.stop({ persist: false });
  return overlay.sent;
}

describe('PhoneMirrorService carries unreadableFormulas to the capture result', () => {
  test('a capture that reported formulas resolves with the count', async () => {
    const { result, delivered } = await captureWith({ title: 'Matrix Layer Rotation', source: 'statement', unreadableFormulas: 15 });
    assert.equal(result.ok, true);
    assert.equal(result.unreadableFormulas, 15);
    // The page text still reached the overlay, and the renderer's meta shape is unchanged.
    assert.ok(delivered);
    assert.equal(delivered.args[1].unreadableFormulas, undefined);
    assert.equal(delivered.args[1].source, 'statement');
  });

  test('a capture without the field (older extension) resolves without it', async () => {
    const { result } = await captureWith({ title: 'Two Sum' });
    assert.equal(result.ok, true);
    assert.equal(result.unreadableFormulas, undefined);
  });

  test('a ⌘Y capture with formulas gets no "missing" notice from here (main sends one with its screenshot)', async () => {
    const svc = PhoneMirrorService.getInstance();
    if (svc.isRunning()) await svc.stop({ persist: false });
    const info = await svc.start({ exposeOnLan: false, persist: false });
    const overlay = new FakeBrowserWindow();
    svc.setOverlayResolver(() => overlay);
    const ext = await connectExtension(info.port, info.extToken);
    const pending = svc.requestDomCapture({ timeoutMs: 3000 });
    await answerCapture({ port: info.port, token: info.extToken, ...ext }, { unreadableFormulas: 4 });
    await pending;
    ext.ws.close();
    await svc.stop({ persist: false });
    assert.equal(overlay.sent.filter((s) => s.channel === PAGE_CAPTURE_FALLBACK_CHANNEL).length, 0);
  });

  test('a popup capture with formulas says they are missing', async () => {
    const sent = await popupCapture({ title: 'Matrix Layer Rotation', unreadableFormulas: 7 });
    assert.ok(sent.find((s) => s.channel === 'dom-context-received'), 'the page text still arrives');
    const notice = sent.find((s) => s.channel === PAGE_CAPTURE_FALLBACK_CHANNEL);
    assert.ok(notice, 'no notice');
    assert.equal(notice.args[0].kind, 'formulas');
    assert.match(notice.args[0].label, /formulas missing/);
    assert.match(notice.args[0].detail, /^7 formulas .* Take a screenshot of the formulas before answering\.$/);
  });

  test('a popup capture without formulas gets no notice', async () => {
    const sent = await popupCapture({ title: 'Two Sum' });
    assert.equal(sent.filter((s) => s.channel === PAGE_CAPTURE_FALLBACK_CHANNEL).length, 0);
  });

  test('unreadableFormulasOf accepts only positive whole numbers', () => {
    assert.equal(unreadableFormulasOf({ unreadableFormulas: 4 }), 4);
    assert.equal(unreadableFormulasOf({ unreadableFormulas: 0 }), 0);
    assert.equal(unreadableFormulasOf({ unreadableFormulas: -2 }), 0);
    assert.equal(unreadableFormulasOf({ unreadableFormulas: 2.5 }), 0);
    assert.equal(unreadableFormulasOf({ unreadableFormulas: '7' }), 0);
    assert.equal(unreadableFormulasOf(null), 0);
    assert.equal(unreadableFormulasOf({ unreadableFormulas: 1e9 }), 10_000);
  });
});

describe('describeUnreadableFormulas', () => {
  test('screenshot attached: says the page text is attached too', () => {
    const n = describeUnreadableFormulas(15);
    assert.equal(n.kind, 'formulas');
    assert.match(n.label, /Page attached/);
    assert.match(n.detail, /^15 formulas on this page are drawn as pictures with no text/);
    assert.match(n.detail, /screenshot was attached with the page text/);
    assert.equal(n.reason, 'unreadable-formulas:15');
  });

  test('one formula reads in the singular', () => {
    assert.match(describeUnreadableFormulas(1).detail, /^1 formula on this page is drawn/);
  });

  test('screenshot failed: the hint for the user\'s own platform, no raw error', () => {
    const mac = describeUnreadableFormulas(3, 'failed', 'darwin');
    assert.equal(mac.kind, 'formulas');
    assert.match(mac.label, /formulas missing/);
    assert.match(mac.detail, /screenshot for them failed\. Screenshots need Screen Recording permission\. Take a screenshot/);
    const win = describeUnreadableFormulas(3, 'failed', 'win32');
    assert.match(win.detail, /Protected \(DRM\) windows block screenshots\./);
    assert.doesNotMatch(win.detail, /Screen Recording/);
    assert.doesNotMatch(mac.detail, /DRM/);
  });

  test('not taken (popup capture): asks for a screenshot, claims none was attached', () => {
    const n = describeUnreadableFormulas(2, 'not-taken');
    assert.match(n.label, /formulas missing/);
    assert.doesNotMatch(n.detail, /attached|failed/);
    assert.match(n.detail, /Take a screenshot of the formulas before answering/);
  });

  test('main\'s marker is the extension\'s', () => {
    const mathText = fs.readFileSync(path.resolve(repoRoot, 'natively-browser/src/math-text.ts'), 'utf8');
    const m = /export const UNREADABLE_FORMULA = '([^']+)'/.exec(mathText);
    assert.ok(m, 'UNREADABLE_FORMULA not found in math-text.ts');
    assert.equal(UNREADABLE_FORMULA_MARKER, m[1]);
  });
});

describe('FormulaScreenshotHandoff', () => {
  const PAGE = 'TITLE: Matrix Layer Rotation\n\n1 [formula not captured] 300';
  const tick = () => new Promise((r) => setImmediate(r));

  test('⌘Y→Enter: an answer that starts while the screenshot is taken gets it, and the overlay does not', async () => {
    const h = new FormulaScreenshotHandoff();
    const shot = h.open();
    const request = h.addTo(PAGE, ['/u/screenshots/earlier.png']);
    await tick();
    assert.equal(shot.claimed, true);
    assert.equal(shot.deliverToOverlay(), false, 'it would also sit in the overlay for the next question');
    shot.settle(['/u/screenshots/formulas.png']);
    assert.deepEqual(await request, ['/u/screenshots/earlier.png', '/u/screenshots/formulas.png']);
  });

  test('the request can arrive before the screenshot is even started (before the ack)', async () => {
    const h = new FormulaScreenshotHandoff();
    const shot = h.open();
    const request = h.addTo(PAGE, undefined);
    await tick();
    shot.settle(['/u/screenshots/formulas.png']);
    assert.deepEqual(await request, ['/u/screenshots/formulas.png']);
  });

  test('an answer started after the screenshot was attached in the overlay is left alone', async () => {
    const h = new FormulaScreenshotHandoff();
    const shot = h.open();
    assert.equal(shot.deliverToOverlay(), true);
    shot.settle(['/u/screenshots/formulas.png']);
    // The overlay sent it, or the user removed it: either way not re-added.
    assert.deepEqual(await h.addTo(PAGE, []), []);
  });

  test('page text without formula markers never waits', async () => {
    const h = new FormulaScreenshotHandoff({ waitMs: 60_000 });
    const shot = h.open();
    const paths = ['/u/a.png'];
    assert.equal(await h.addTo('TITLE: Two Sum\n\nGiven an array', paths), paths);
    assert.equal(shot.claimed, false);
  });

  test('a capture with no screenshot (no formulas, or it failed) adds nothing', async () => {
    const h = new FormulaScreenshotHandoff();
    const shot = h.open();
    const request = h.addTo(PAGE, ['/u/a.png']);
    shot.settle(null);
    assert.deepEqual(await request, ['/u/a.png']);
  });

  test('too slow for this answer: it is released to the overlay instead of lost', async () => {
    const h = new FormulaScreenshotHandoff({ waitMs: 20 });
    const shot = h.open();
    assert.deepEqual(await h.addTo(PAGE, []), []);
    assert.equal(shot.deliverToOverlay(), true);
  });

  test('one screenshot, one answer', async () => {
    const h = new FormulaScreenshotHandoff();
    const shot = h.open();
    const first = h.addTo(PAGE, []);
    const second = await h.addTo(PAGE, []);
    shot.settle(['/u/screenshots/formulas.png']);
    assert.deepEqual(await first, ['/u/screenshots/formulas.png']);
    assert.deepEqual(second, []);
    assert.deepEqual(await h.addTo(PAGE, []), []);
  });

  test('an old capture\'s screenshot is not waited for', async () => {
    let now = 1_000;
    const h = new FormulaScreenshotHandoff({ now: () => now, maxAgeMs: 60_000 });
    const shot = h.open();
    now += 61_000;
    assert.deepEqual(await h.addTo(PAGE, []), []);
    assert.equal(shot.claimed, false);
  });

  test('never more than five images, never the same one twice', async () => {
    const five = ['/1', '/2', '/3', '/4', '/5'];
    let h = new FormulaScreenshotHandoff();
    let shot = h.open();
    let req = h.addTo(PAGE, five);
    shot.settle(['/6']);
    assert.deepEqual(await req, five);
    h = new FormulaScreenshotHandoff();
    shot = h.open();
    req = h.addTo(PAGE, ['/6']);
    shot.settle(['/6']);
    assert.deepEqual(await req, ['/6']);
  });
});

describe('main.ts wiring', () => {
  const main = fs.readFileSync(path.resolve(repoRoot, 'electron/main.ts'), 'utf8');

  test('the screenshot is added only on the success branch of the capture-dom hotkey', () => {
    const branch = main.slice(main.indexOf("actionId === 'general:capture-dom'"));
    const success = branch.indexOf("console.log('[Main] DOM capture delivered to overlay')");
    const attach = branch.indexOf('this.attachScreenshotForFormulas(result.unreadableFormulas, formulaShot)');
    const failure = branch.indexOf('domFailureReason = String(result.reason');
    assert.ok(success > 0 && attach > success && attach < failure, 'attach call sits in the captured branch');
  });

  test('the formulas screenshot is attached, not processed (no auto-answer)', () => {
    const fn = main.slice(main.indexOf('private async attachScreenshotForFormulas'));
    const body = fn.slice(0, fn.indexOf('\n  }\n') + 4);
    assert.match(body, /'screenshot-attached'/);
    assert.doesNotMatch(body, /capture-and-process|captureScreenAndProcess/);
    assert.match(body, /describeUnreadableFormulas\(count\)/);
    assert.match(body, /describeUnreadableFormulas\(count, 'failed', process\.platform\)/);
    // The overlay gets it only when no answer claimed it, decided after the last await.
    assert.match(body, /const inOverlay = shot\.deliverToOverlay\(\);\s*if \(inOverlay\) \{[\s\S]{0,200}this\.sendToWindow\(overlay\(\), 'screenshot-attached'/);
  });

  test('the handoff opens before the capture request and always settles', () => {
    const branch = main.slice(main.indexOf("actionId === 'general:capture-dom'"));
    const open = branch.indexOf('const formulaShot = this.formulaScreenshots.open();');
    const request = branch.indexOf('svc.requestDomCapture()');
    const settle = branch.indexOf('formulaShot.settle(null);');
    const fallback = branch.indexOf('if (!captured) {');
    assert.ok(open > 0 && open < request, 'opened before the request');
    assert.ok(settle > request && settle < fallback, 'settled after the capture, success or not');
  });
});

describe('ipcHandlers.ts: both answer requests ask for the formula screenshot', () => {
  const ipc = fs.readFileSync(path.resolve(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');

  test('What to answer, before its image paths are validated', () => {
    const h = ipc.slice(ipc.indexOf("'generate-what-to-say'"));
    const ask = h.indexOf('imagePaths = await appState.withFormulaScreenshot(options?.domContext, imagePaths);');
    const validate = h.indexOf('const validatedImagePaths');
    assert.ok(ask > 0 && ask < validate);
  });

  test('Direct Assist, before its request is normalized', () => {
    assert.match(ipc, /normalizeDirectAssistRequest\(await withPageFormulaScreenshot\(rawRequest\)\)/);
    assert.match(ipc, /appState\.withFormulaScreenshot\(dom, r\.imagePaths/);
  });

  test('both then mark the formulas no image in the request shows', () => {
    const h = ipc.slice(ipc.indexOf("'generate-what-to-say'"));
    const ask = h.indexOf('imagePaths = await appState.withFormulaScreenshot(options?.domContext, imagePaths);');
    const mark = h.indexOf('domContext: appState.formulaTextFor(options.domContext, imagePaths)');
    const used = h.indexOf("typeof options?.domContext === 'string'\n            ? options.domContext.substring(0, DOM_CONTEXT_MAX_CHARS)");
    assert.ok(ask > 0 && mark > ask && used > mark, 'marked after the images are final, before the text is used');
    assert.match(ipc, /const merged = await appState\.withFormulaScreenshot\(dom, r\.imagePaths as string\[\] \| undefined\);\s*const text = appState\.formulaTextFor\(dom, merged\);[\s\S]{0,200}pageContext: \{ \.\.\.\(page as Record<string, unknown>\), dom: text \}/);
  });
});

// What the extension's canvas produces: the leading bytes are what the desktop checks.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 3)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(32)]);
const dataUrl = (type, buf) => `data:${type};base64,${buf.toString('base64')}`;

describe('formula images from the extension (no screenshot wait)', () => {
  test('a ⌘Y capture resolves with the images, and the renderer never gets them', async () => {
    const { result, delivered } = await captureWith(
      { title: 'Matrix Layer Rotation', unreadableFormulas: 0 },
      { formulaImages: [dataUrl('image/png', PNG)] },
    );
    assert.equal(result.ok, true);
    assert.equal(result.formulaImages.length, 1);
    assert.equal(result.formulaImages[0].mime, 'image/png');
    assert.equal(result.formulaImages[0].ext, 'png');
    assert.ok(result.formulaImages[0].data.equals(PNG));
    assert.doesNotMatch(JSON.stringify(delivered.args), /base64/);
  });

  test('only PNG or JPEG data URLs whose bytes agree, at most three, none oversized', () => {
    const ok = formulaImagesOf([dataUrl('image/png', PNG), dataUrl('image/jpeg', JPEG)]);
    assert.deepEqual(ok.map((i) => i.ext), ['png', 'jpg']);
    assert.deepEqual(formulaImagesOf([dataUrl('image/png', JPEG)]).map((i) => i.ext), ['jpg'], 'the bytes decide the type');
    assert.equal(formulaImagesOf([dataUrl('image/png', WEBP)]).length, 0);
    assert.equal(formulaImagesOf([dataUrl('image/gif', PNG)]).length, 0);
    assert.equal(formulaImagesOf([dataUrl('image/png', Buffer.from('not an image at all'))]).length, 0);
    assert.equal(formulaImagesOf(['data:image/png;base64,***']).length, 0);
    assert.equal(formulaImagesOf(['https://example.com/x.png', 7, null]).length, 0);
    assert.equal(formulaImagesOf([dataUrl('image/png', Buffer.concat([PNG, Buffer.alloc(400_001)]))]).length, 0);
    assert.equal(formulaImagesOf(Array(5).fill(dataUrl('image/png', PNG))).length, 3);
    assert.deepEqual(formulaImagesOf(undefined), []);
  });

  test('each image keeps its formula range when it is two whole numbers in order', () => {
    const imgs = [dataUrl('image/png', PNG), 'junk', dataUrl('image/jpeg', JPEG)];
    const out = formulaImagesOf(imgs, [[1, 92], [93, 100], [101, 140]]);
    assert.equal(out.length, 2);
    // Ranges follow the image they were sent with, not the order of what is kept.
    assert.deepEqual(out.map((i) => i.formulas), [[1, 92], [101, 140]]);
    for (const bad of [[101, 9.5], [7, 3], [0, 2], [1], '1-2']) {
      assert.equal(formulaImagesOf([dataUrl('image/png', PNG)], [bad])[0].formulas, undefined, JSON.stringify(bad));
    }
    assert.equal(formulaImagesOf([dataUrl('image/png', PNG)], 'x')[0].formulas, undefined);
  });

  test('a popup capture hands its images to main, with no "missing" notice', async () => {
    const svc = PhoneMirrorService.getInstance();
    const calls = [];
    const off = svc.setFormulaImageHandler((images, unreadable) => calls.push({ images, unreadable }));
    try {
      const sent = await popupCapture({ unreadableFormulas: 2 }, { formulaImages: [dataUrl('image/png', PNG)] });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].images.length, 1);
      assert.equal(calls[0].unreadable, 2);
      assert.equal(sent.filter((s) => s.channel === PAGE_CAPTURE_FALLBACK_CHANNEL).length, 0);
    } finally {
      off();
    }
  });

  test('with nothing to hand them to, a popup capture still says the formulas are missing', async () => {
    const sent = await popupCapture({}, { formulaImages: [dataUrl('image/png', PNG)] });
    const notice = sent.find((s) => s.channel === PAGE_CAPTURE_FALLBACK_CHANNEL);
    assert.ok(notice);
    assert.match(notice.args[0].label, /formulas missing/);
  });

  test('the notice says the formulas came as an image, and how many did not', () => {
    const all = describeFormulaImage(0);
    assert.equal(all.kind, 'formulas');
    assert.equal(all.label, 'Page attached + formulas as image');
    assert.doesNotMatch(all.detail, /could not|screenshot/);
    const some = describeFormulaImage(2);
    assert.equal(some.label, 'Page attached + some formulas as image');
    assert.match(some.detail, / 2 more could not be captured; take a screenshot of them before answering\.$/);
    assert.match(describeFormulaImage(1).detail, / 1 more could not be captured; take a screenshot of it before answering\.$/);
  });

  test('main reads both of the extension\'s markers, the same pattern as the extension\'s', () => {
    assert.equal(hasFormulaMarker('a [formula 3, see image] b'), true);
    assert.equal(hasFormulaMarker(`a ${UNREADABLE_FORMULA_MARKER} b`), true);
    assert.equal(hasFormulaMarker('see the image below'), false);
    assert.equal(hasFormulaMarker(undefined), false);
    const mathText = fs.readFileSync(path.resolve(repoRoot, 'natively-browser/src/math-text.ts'), 'utf8');
    const m = /export const FORMULA_IN_IMAGE_RE = \/(.+)\/g;/.exec(mathText);
    assert.ok(m, 'FORMULA_IN_IMAGE_RE not found in math-text.ts');
    assert.equal(FORMULA_IN_IMAGE_RE.source, m[1]);
    const marker = /return `\[formula \$\{n\}, see image\]`/.test(mathText);
    assert.ok(marker, 'formulaInImage wording changed in math-text.ts');
  });

  test('an answer whose text has only image markers gets every image of its capture', async () => {
    const handoff = new FormulaScreenshotHandoff({ waitMs: 1000 });
    const shot = handoff.open();
    const claimed = handoff.addTo('1 [formula 1, see image] 300 [formula 2, see image]', ['/u/earlier.png']);
    assert.equal(shot.claimed, true);
    assert.equal(shot.deliverToOverlay(), false);
    shot.settle(['/u/formulas-a.png', '/u/formulas-b.png']);
    assert.deepEqual(await claimed, ['/u/earlier.png', '/u/formulas-a.png', '/u/formulas-b.png']);
  });

  test('an earlier capture\'s formula images in the request give way to this one\'s', async () => {
    const handoff = new FormulaScreenshotHandoff({ waitMs: 1000 });
    const shot = handoff.open();
    const claimed = handoff.addTo('[formula 1, see image]', ['/u/mine.png', '/u/formulas-old.png']);
    shot.settle(['/u/formulas-new.png']);
    assert.deepEqual(await claimed, ['/u/mine.png', '/u/formulas-new.png']);
    // Even when this capture's images did not come: their numbers are not this text's.
    const failed = new FormulaScreenshotHandoff({ waitMs: 1000 });
    const none = failed.open();
    const left = failed.addTo('[formula 1, see image]', ['/u/formulas-old.png']);
    none.settle(null);
    assert.deepEqual(await left, []);
  });

  test('a formula whose image did not fit in the request is marked not captured', () => {
    const ranges = { '/u/formulas-a.png': [1, 92], '/u/formulas-b.png': [93, 140] };
    const rangeOf = (p) => ranges[p];
    const text = 'n is [formula 1, see image], r is [formula 93, see image], again [formula 1, see image].';
    assert.equal(markMissingFormulas(text, ['/u/mine.png', '/u/formulas-a.png', '/u/formulas-b.png'], rangeOf), text);
    assert.equal(
      markMissingFormulas(text, ['/u/mine.png', '/u/formulas-a.png'], rangeOf),
      `n is [formula 1, see image], r is ${UNREADABLE_FORMULA_MARKER}, again [formula 1, see image].`,
    );
    assert.equal(
      markMissingFormulas(text, ['/u/1.png', '/u/2.png', '/u/3.png', '/u/4.png', '/u/5.png'], rangeOf),
      `n is ${UNREADABLE_FORMULA_MARKER}, r is ${UNREADABLE_FORMULA_MARKER}, again ${UNREADABLE_FORMULA_MARKER}.`,
    );
    // A formula image with no known range: nothing can be said, so nothing changes.
    assert.equal(markMissingFormulas(text, ['/u/formulas-old.png'], rangeOf), text);
    assert.equal(markMissingFormulas('no markers here', [], rangeOf), 'no markers here');
  });

  test('the images still respect the five-image limit', async () => {
    const handoff = new FormulaScreenshotHandoff({ waitMs: 1000 });
    const shot = handoff.open();
    const claimed = handoff.addTo('[formula 1, see image]', ['/1', '/2', '/3', '/4']);
    shot.settle(['/5', '/6', '/7']);
    assert.deepEqual(await claimed, ['/1', '/2', '/3', '/4', '/5']);
  });
});

describe('main.ts: the extension\'s images come first, a screenshot only without them', () => {
  const main = fs.readFileSync(path.resolve(repoRoot, 'electron/main.ts'), 'utf8');

  test('the capture-dom success branch attaches the images, and screenshots only when there are none', () => {
    const at = main.indexOf("console.log('[Main] DOM capture delivered to overlay');");
    const branch = main.slice(at, at + 700);
    const images = branch.indexOf('if (result.formulaImages?.length) {');
    const shot = branch.indexOf('} else if (result.unreadableFormulas) {');
    assert.ok(images > 0 && shot > images, branch);
    assert.match(branch.slice(images, shot), /await this\.attachFormulaImages\(result\.formulaImages, result\.unreadableFormulas \?\? 0, formulaShot\)/);
    assert.match(branch.slice(shot), /await this\.attachScreenshotForFormulas\(result\.unreadableFormulas, formulaShot\)/);
  });

  test('attachFormulaImages saves first, then decides overlay or waiting answer, and always settles', () => {
    const at = main.indexOf('public async attachFormulaImages(');
    const body = main.slice(at, main.indexOf('public withFormulaScreenshot(', at));
    const save = body.indexOf('const paths = await this.screenshotHelper.addFormulaImages(images);');
    const decide = body.indexOf('const inOverlay = shot ? shot.deliverToOverlay() : true;');
    assert.ok(save > 0 && decide > save, 'decided after the writes');
    assert.doesNotMatch(body, /addExternalImage/, 'not in the screenshot queue');
    assert.match(body.slice(decide), /shot\?\.settle\(paths\);\s*if \(inOverlay\) \{[\s\S]{0,600}'screenshot-attached', \{ path: imagePath, preview, formulaCapture \}/);
    // One id per capture, made outside the loop.
    assert.match(body, /const formulaCapture = crypto\.randomUUID\(\);\s*for \(const imagePath of paths\)/);
    assert.match(body, /catch \(err: any\) \{\s*shot\?\.settle\(null\);/);
    assert.doesNotMatch(body, /takeScreenshot|captureScreenAndProcess/);
  });

  test('a popup capture\'s images reach attachFormulaImages with no handoff', () => {
    assert.match(main, /setFormulaImageHandler\(\(images, unreadable\) => \{\s*void appState\.attachFormulaImages\(images, unreadable\);\s*\}\)/);
  });
});

describe('formula images never push out the user\'s screenshots', () => {
  let ScreenshotHelper;
  before(async () => {
    ({ ScreenshotHelper } = await import(dist('ScreenshotHelper.js')));
  });
  const image = { data: PNG, ext: 'png' };

  test('they join neither queue, and five screenshots stay five', async () => {
    const helper = new ScreenshotHelper('queue');
    const mine = [];
    for (let i = 0; i < 5; i++) mine.push(await helper.addExternalImage(PNG, 'png'));
    const sheets = await helper.addFormulaImages([image, image, image]);
    assert.equal(sheets.length, 3);
    assert.ok(sheets.every((p) => path.basename(p).startsWith('formulas-') && fs.existsSync(p)));
    assert.deepEqual(helper.getScreenshotQueue(), mine);
    assert.ok(mine.every((p) => fs.existsSync(p)));
    helper.clearQueues();
  });

  test('each formula image keeps its range until it is deleted', async () => {
    const helper = new ScreenshotHelper('queue');
    const [a, b] = await helper.addFormulaImages([{ ...image, formulas: [1, 92] }, image]);
    assert.deepEqual(helper.formulaRangeOf(a), [1, 92]);
    assert.equal(helper.formulaRangeOf(b), undefined);
    await helper.addFormulaImages([image]);
    await helper.addFormulaImages([image]);
    assert.equal(helper.formulaRangeOf(a), undefined, 'dropped with its capture');
    const [c] = await helper.addFormulaImages([{ ...image, formulas: [3, 4] }]);
    await helper.deleteScreenshot(c);
    assert.equal(helper.formulaRangeOf(c), undefined);
    const [d] = await helper.addFormulaImages([{ ...image, formulas: [5, 6] }]);
    helper.clearQueues();
    assert.equal(helper.formulaRangeOf(d), undefined);
  });

  test('the newest two captures are kept on disk, older ones deleted, and clearing removes them', async () => {
    const helper = new ScreenshotHelper('queue');
    const first = await helper.addFormulaImages([image]);
    const second = await helper.addFormulaImages([image, image]);
    const third = await helper.addFormulaImages([image]);
    assert.ok(!fs.existsSync(first[0]));
    assert.ok([...second, ...third].every((p) => fs.existsSync(p)));
    helper.clearQueues();
    await waitFor(() => [...second, ...third].every((p) => !fs.existsSync(p)));
  });
});

describe('the extension draws formula images only for a desktop that said it takes them', () => {
  test('on hello the desktop sends its limits, and a body that holds them is accepted', async () => {
    const svc = PhoneMirrorService.getInstance();
    if (svc.isRunning()) await svc.stop({ persist: false });
    const info = await svc.start({ exposeOnLan: false, persist: false });
    svc.setOverlayResolver(() => new FakeBrowserWindow());
    const ext = await connectExtension(info.port, info.extToken);
    try {
      const features = await waitFor(() => ext.frames.find((f) => f.type === 'desktop-features'));
      assert.deepEqual(features.formulaImages, { maxImages: 3, maxImageChars: 533_332, maxTotalChars: 1_200_000 });
      // The largest data URL the extension may send (prefix included, as it
      // measures) decodes within the desktop's own per-image check.
      const prefix = 'data:image/png;base64,'.length;
      const bytes = Math.floor((features.formulaImages.maxImageChars - prefix) / 4) * 3;
      const largest = Buffer.concat([PNG, Buffer.alloc(bytes - PNG.length, 1)]);
      const url = dataUrl('image/png', largest);
      assert.ok(url.length <= features.formulaImages.maxImageChars && url.length > features.formulaImages.maxImageChars - 4);
      assert.equal(formulaImagesOf([url]).length, 1);

      const pending = svc.requestDomCapture({ timeoutMs: 3000 });
      await answerCapture({ port: info.port, token: info.extToken, ...ext }, { unreadableFormulas: 0 }, {
        formulaImages: [dataUrl('image/png', largest), dataUrl('image/png', largest)],
      });
      const result = await pending;
      assert.equal(result.ok, true);
      assert.equal(result.formulaImages.length, 2);
    } finally {
      ext.ws.close();
      await svc.stop({ persist: false });
    }
  });

  test('the extension reads the same three limits, and asks the page for images only with them', () => {
    const sw = fs.readFileSync(path.resolve(repoRoot, 'natively-browser/src/service-worker.ts'), 'utf8');
    const sheet = fs.readFileSync(path.resolve(repoRoot, 'natively-browser/src/formula-sheet.ts'), 'utf8');
    const cs = fs.readFileSync(path.resolve(repoRoot, 'natively-browser/src/content-script.ts'), 'utf8');
    assert.match(sw, /msg\.type === 'desktop-features'\) \{\s*desktopFormulaImages = formulaImageLimitsOf\(msg\.formulaImages\);/);
    assert.match(sw, /\.\.\.\(desktopFormulaImages \? \{ formulaImages: desktopFormulaImages \} : \{\}\)/);
    for (const key of ['maxImages', 'maxImageChars', 'maxTotalChars']) assert.match(sheet, new RegExp(`whole\\(r\\.${key}\\)`));
    // Without the limits no formula is serialized, so none is numbered as an image.
    assert.match(cs, /\.\.\.\(formulaImages \? \{ serializeFormula: /);
    // Each image goes with the numbers it shows.
    assert.match(cs, /formulaImages: images, formulaImageRanges: ranges/);
    assert.match(sw, /if \(extras\.formulaImageRanges\?\.length\) payload\.formulaImageRanges = extras\.formulaImageRanges;/);
  });

  test('a popup capture waits briefly for the limits; a ⌘Y capture does not need to', () => {
    const sw = fs.readFileSync(path.resolve(repoRoot, 'natively-browser/src/service-worker.ts'), 'utf8');
    assert.match(sw, /if \(!opts\?\.reqId\) await waitForDesktopFeatures\(1500\);\s*let extracted: ExtractedTab;/);
    // It ends on the frame, 200 ms after the socket opens, or when no socket can open.
    assert.match(sw, /desktopFormulaImages = formulaImageLimitsOf\(msg\.formulaImages\);\s*flushDesktopFeatureWaiters\(\);/);
    assert.match(sw, /wsSend\(\{ type: 'hello', role: 'extension', v: 1 \}\);\s*setTimeout\(flushDesktopFeatureWaiters, 200\);/);
    assert.match(sw, /if \(port == null\) return flushDesktopFeatureWaiters\(\);/);
  });

  test('the upload restarts the desktop\'s deadline, and drawing has a budget inside it', () => {
    const sw = fs.readFileSync(path.resolve(repoRoot, 'natively-browser/src/service-worker.ts'), 'utf8');
    const cs = fs.readFileSync(path.resolve(repoRoot, 'natively-browser/src/content-script.ts'), 'utf8');
    assert.match(sw, /if \(opts\?\.reqId\) wsSend\(\{ type: 'capture-ack', reqId: opts\.reqId, status: 'posting' \}\);\s*const outcome = await sendDom\(/);
    const budget = Number(/const FORMULA_IMAGE_BUDGET_MS = (\d+);/.exec(cs)?.[1]);
    const deadline = Number(/const CAPTURE_TIMEOUT_MS = ([\d_]+);/.exec(fs.readFileSync(path.resolve(repoRoot, 'electron/services/PhoneMirrorService.ts'), 'utf8'))?.[1].replace(/_/g, ''));
    assert.ok(budget > 0 && budget <= deadline / 2, `${budget} ms of ${deadline}`);
  });
});

// What to answer pulls the page just before the answer (Smart Browser Context
// v2). Its formulas with no text come as an image too, handed to that answer.
describe('the automatic capture\'s formula images', () => {
  const PAGE = 'CONSTRAINTS:\nConstraints\n\n[formula 1, see image]';

  async function autoCaptureWith(meta, extra = {}) {
    const svc = PhoneMirrorService.getInstance();
    if (svc.isRunning()) await svc.stop({ persist: false });
    const info = await svc.start({ exposeOnLan: false, persist: false });
    const overlay = new FakeBrowserWindow();
    svc.setOverlayResolver(() => overlay);
    const { ws, frames } = await connectExtension(info.port, info.extToken);
    const pending = svc.requestAutoContext({ timeoutMs: 3000 });
    const req = await waitFor(() => frames.find((f) => f.type === 'request-auto-context'));
    const res = await fetch(`http://127.0.0.1:${info.port}/dom?t=${encodeURIComponent(info.extToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dom: PAGE, reqId: req.reqId, meta, ...extra }),
    });
    assert.equal(res.status, 200);
    ws.send(JSON.stringify({ type: 'capture-ack', reqId: req.reqId, status: 'done', category: 'coding_problem' }));
    const result = await pending;
    ws.close();
    await svc.stop({ persist: false });
    return { result, delivered: overlay.sent.find((s) => s.channel === 'dom-context-received'), sent: overlay.sent };
  }

  test('requestAutoContext resolves with the images; the renderer never gets them', async () => {
    const { result, delivered, sent } = await autoCaptureWith(
      { title: 'Matrix Layer Rotation', source: 'smart-auto', unreadableFormulas: 2 },
      { formulaImages: [dataUrl('image/png', PNG)], formulaImageRanges: [[1, 5]] },
    );
    assert.equal(result.attached, true);
    assert.equal(result.category, 'coding_problem');
    assert.equal(result.unreadableFormulas, 2);
    assert.equal(result.formulaImages.length, 1);
    assert.ok(result.formulaImages[0].data.equals(PNG));
    assert.deepEqual(result.formulaImages[0].formulas, [1, 5]);
    assert.ok(delivered, 'the page text still reaches the overlay');
    assert.doesNotMatch(JSON.stringify(delivered.args), /base64/);
    // No notice: the images go with the answer, not into the tray.
    assert.equal(sent.filter((s) => s.channel === PAGE_CAPTURE_FALLBACK_CHANNEL).length, 0);
  });

  test('the desktop says it takes them; the extension draws them only for a desktop that says so', async () => {
    const svc = PhoneMirrorService.getInstance();
    if (svc.isRunning()) await svc.stop({ persist: false });
    const info = await svc.start({ exposeOnLan: false, persist: false });
    svc.setOverlayResolver(() => new FakeBrowserWindow());
    const ext = await connectExtension(info.port, info.extToken);
    try {
      const features = await waitFor(() => ext.frames.find((f) => f.type === 'desktop-features'));
      assert.equal(features.autoFormulaImages, true);
    } finally {
      ext.ws.close();
      await svc.stop({ persist: false });
    }
    // An older desktop drops them while its answer still reads "see image".
    const sw = fs.readFileSync(path.resolve(repoRoot, 'natively-browser/src/service-worker.ts'), 'utf8');
    assert.match(sw, /desktopAutoFormulaImages = msg\.autoFormulaImages === true;/);
    assert.match(sw, /desktopFormulaImages = null;\s*desktopAutoFormulaImages = false;/);
    assert.match(sw, /\.\.\.\(desktopFormulaImages && desktopAutoFormulaImages && !opts\.classifyOnly \? \{ formulaImages: desktopFormulaImages \} : \{\}\)/);
  });

  test('a capture without images resolves exactly as before', async () => {
    const { result } = await autoCaptureWith({ title: 'Two Sum', source: 'smart-auto' });
    assert.deepEqual(result, { attached: true, category: 'coding_problem' });
  });

  test('the answer that pulled the capture, asking at once, gets them after its own images', async () => {
    const h = new FormulaScreenshotHandoff();
    const shot = h.open({ maxAgeMs: AUTO_FORMULA_IMAGE_MAX_AGE_MS });
    const request = h.addTo(PAGE, ['/u/screenshots/mine.png']);
    shot.settle(['/u/screenshots/formulas-1.png']);
    assert.deepEqual(await request, ['/u/screenshots/mine.png', '/u/screenshots/formulas-1.png']);
  });

  test('a later answer does not take them', async () => {
    let now = 1_000;
    const h = new FormulaScreenshotHandoff({ now: () => now });
    const shot = h.open({ maxAgeMs: AUTO_FORMULA_IMAGE_MAX_AGE_MS });
    shot.settle(['/u/screenshots/formulas-1.png']);
    now += AUTO_FORMULA_IMAGE_MAX_AGE_MS + 1;
    assert.deepEqual(await h.addTo(PAGE, []), []);
    // A ⌘Y capture keeps its own, longer, wait.
    const manual = h.open();
    now += AUTO_FORMULA_IMAGE_MAX_AGE_MS + 1;
    const request = h.addTo(PAGE, []);
    manual.settle(['/u/screenshots/formulas-2.png']);
    assert.deepEqual(await request, ['/u/screenshots/formulas-2.png']);
  });

  test('ipcHandlers.ts hands them to main and returns only the outcome', () => {
    const ipc = fs.readFileSync(path.resolve(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');
    const h = ipc.slice(ipc.indexOf("safeHandle('phone-mirror:request-auto-context'"));
    const body = h.slice(0, h.indexOf('\n  });\n'));
    assert.match(body, /const \{ formulaImages, unreadableFormulas, \.\.\.result \} = await PhoneMirrorService\.getInstance\(\)\.requestAutoContext\(request\);/);
    // Not awaited: main opens the handoff at once, and the answer waits for the files.
    assert.match(body, /if \(formulaImages\?\.length\) void appState\.handFormulaImagesToAnswer\(formulaImages, unreadableFormulas \?\? 0\);\s*return result;/);
  });

  test('main.ts opens the handoff before its first await and never attaches them in the overlay', () => {
    const main = fs.readFileSync(path.resolve(repoRoot, 'electron/main.ts'), 'utf8');
    const fn = main.slice(main.indexOf('public async handFormulaImagesToAnswer('));
    const body = fn.slice(0, fn.indexOf('\n  }\n') + 4);
    const open = body.indexOf('this.formulaScreenshots.open({ maxAgeMs: AUTO_FORMULA_IMAGE_MAX_AGE_MS })');
    assert.ok(open > 0 && open < body.indexOf('await '), 'opened before the first await');
    assert.match(body, /shot\.settle\(paths\)/);
    assert.match(body, /shot\.settle\(null\)/);
    assert.doesNotMatch(body, /screenshot-attached|deliverToOverlay|takeScreenshot/);
  });

  test('What to answer marks the structured fields too, against the images it sends', () => {
    const ipc = fs.readFileSync(path.resolve(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');
    const h = ipc.slice(ipc.indexOf("'generate-what-to-say'"));
    const ask = h.indexOf('imagePaths = await appState.withFormulaScreenshot(options?.domContext, imagePaths);');
    const header = h.indexOf('const header = appState.formulaTextFor(formatEnvelopeForPrompt(envelope), imagePaths);');
    assert.ok(ask > 0 && header > ask);
  });
});
