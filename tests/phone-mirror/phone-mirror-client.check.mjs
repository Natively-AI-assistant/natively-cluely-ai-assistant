// tests/phone-mirror/phone-mirror-client.check.mjs
//
// Drives the REAL phone mirror page against the REAL PhoneMirrorService over
// its real WebSocket, with this process standing in for the desktop. Runs every
// device shape the page lays out for (small/large phones portrait and
// landscape, Android, iPad both ways) in dark and light, in WebKit (iOS Safari's
// engine) and Chromium (Android).
//
//   npm run test:phone-mirror
//   node tests/phone-mirror/phone-mirror-client.check.mjs --only=ipad --scheme=light --shots=/tmp/pm-shots
//
// Needs Playwright's browsers: npx playwright install webkit chromium
//
// Covers: no horizontal overflow; the dock stays on screen; the feed is the
// scroller and follows new answers only when already at the bottom; the jump
// pill; interviewer transcript partial → final merge with de-dupe and no user
// mic; action placeholders replaced in place by the labelled answer; typed
// question → echo reconciled → streamed answer; reconnect mid-stream without
// doubled text; the transcript island's tap / flick / drag / tap-outside; the
// split column; screen-capture confirmation; expired links (4401 close and a
// refused reconnect); text contrast; and no page errors.
//
// Not covered (needs a physical device): the real on-screen keyboard and
// visualViewport, real safe-area insets (simulated here), backdrop blur (not
// rendered headless), touch gestures (driven with a mouse here).
//
// Ports: 4123-4134 refuse to bind so the service takes an ephemeral port and
// never collides with (or shadows) a running Natively.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(REPO, 'package.json'));
const { webkit, chromium, devices } = require('playwright');
const esbuild = require('esbuild');

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const SHOTS = typeof args.shots === 'string' ? path.resolve(args.shots) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

// ── electron stub + port guard (never touch a real Natively on 4123-4134) ──
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-harness-'));
const electronStub = {
  app: { isReady: () => true, getPath: () => userDataDir, whenReady: () => Promise.resolve(), on: () => {} },
  BrowserWindow: class { static getFocusedWindow() { return null; } static getAllWindows() { return []; } },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('enc:' + s, 'utf8'),
    decryptString: (b) => Buffer.from(b).toString('utf8').replace(/^enc:/, ''),
  },
};
const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'electron') return electronStub;
  return origLoad.call(this, req, parent, isMain);
};
const origListen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...a) {
  if (typeof a[0] === 'number' && a[0] >= 4123 && a[0] < 4135) {
    process.nextTick(() => this.emit('error', Object.assign(new Error('taken'), { code: 'EADDRINUSE' })));
    return this;
  }
  return origListen.apply(this, a);
};

// Bundle the service (and the page it inlines) from source. Written under the
// repo's node_modules so its external packages (ws, qrcode) resolve.
const bundleDir = path.join(REPO, 'node_modules', '.cache', 'phone-mirror-check', String(process.pid));
const bundlePath = path.join(bundleDir, 'PhoneMirrorService.cjs');
await esbuild.build({
  entryPoints: [path.join(REPO, 'electron/services/PhoneMirrorService.ts')],
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile: bundlePath, logLevel: 'warning',
});
const { PhoneMirrorService } = await import(pathToFileURL(bundlePath).href);
// The answer renderer main.ts registers (marked + the overlay's math and gist rules).
const markdownPath = path.join(bundleDir, 'phoneMirrorMarkdown.cjs');
await esbuild.build({
  entryPoints: [path.join(REPO, 'electron/services/phoneMirrorMarkdown.ts')],
  bundle: true, platform: 'node', format: 'cjs', outfile: markdownPath, logLevel: 'warning',
});
const { renderPhoneAnswer } = await import(pathToFileURL(markdownPath).href);
const svc = PhoneMirrorService.getInstance();
svc.setAnswerRenderer(renderPhoneAnswer);
let info = await svc.start({ exposeOnLan: false, persist: false });

// ── fake desktop ──
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let streamSeq = 1000;
// The labels the real desktop publishes per action (ipcHandlers.ts), pinned by
// electron/services/__tests__/PhoneMirrorPhoneActions2026_09_27.test.mjs.
const LABELS = { whatToAnswer: 'What to Answer', followUp: 'Follow-Up Questions', clarify: 'Clarify', codeHint: 'Code Hint', brainstorm: 'Brainstorm', recap: 'Recap' };
const ANSWERS = {
  'What to Answer': "**Lead with the trade-off.** I'd say: *\"We picked eventual consistency for the feed because a stale like-count for two seconds costs nothing, but a blocked write path costs us checkout.\"*\n\n- Name the constraint (p99 write latency under 40 ms)\n- Say what you gave up (read-your-writes on the feed)\n- Close with how you'd measure it",
  'Follow-Up Questions': 'Ask them: **"What does on-call look like for this team in the first 90 days?"**',
  Clarify: 'They are asking whether the cache is **write-through** or **write-behind** — answer with the one you actually shipped.',
  'Code Hint': 'Use a monotonic stack:\n\n```python\ndef next_greater(nums):\n    out = [-1] * len(nums)\n    stack = []\n    for i, n in enumerate(nums):\n        while stack and nums[stack[-1]] < n:\n            out[stack.pop()] = n\n        stack.append(i)\n    return out\n```\n\nO(n) time — every index is pushed and popped once.',
  Brainstorm: '1. Shard by tenant\n2. Keep a hot-key cache in front\n3. Move fan-out to write time',
  Recap: 'So far: they want a **payments** background, care about **idempotency**, and asked twice about on-call.',
};
// The desktop's side of phone images (main.ts saves them; here we keep them).
const images = [];
let failNextImage = false;
// Timeout scenarios: a desktop that drops one chat, or ignores actions.
// trayUploads: a thumbnail for the photos the phone sends, which the real
// desktop lists in the overlay's tray (null: it never shows them there).
const desktop = { dropChatOnce: new Set(), ignoreActions: false, ignoreDetach: false, trayUploads: null };
// The overlay's tray as this fake desktop holds it; every change is reported
// whole, as the overlay does.
const desktopTray = [];
function setDesktopTray(items) {
  desktopTray.splice(0, desktopTray.length, ...items);
  svc.setAttachments(items);
}
svc.setPhoneImageHandler(async (image) => {
  if (failNextImage) { failNextImage = false; throw new Error('test: desktop could not take it'); }
  images.push(image);
  const saved = `/Users/someone/natively/extra_screenshots/phone-${images.length}.jpg`;
  if (desktop.trayUploads) {
    const thumb = desktop.trayUploads;
    setTimeout(() => setDesktopTray([...desktopTray, { path: saved, thumb }]), 60);
  }
  return saved;
});
svc.onPhoneCommand(async (cmd) => {
  if (cmd.type === 'chat' && desktop.dropChatOnce.delete(cmd.message)) return;
  if (cmd.type === 'action') {
    const label = LABELS[cmd.action];
    if (!label || desktop.ignoreActions) return;
    // The overlay sends its attached screenshots with the answer, in its order:
    // the tray empties, then the question card reports what it was sent with.
    const tray = svc.getAttachmentPaths();
    if (tray.length) {
      setDesktopTray([]);
      svc.publishSentImages('card-' + (++streamSeq), tray);
    }
    await sleep(1400);
    svc.publishAssistantMessage(String(++streamSeq), ANSWERS[label], label);
  } else if (cmd.type === 'chat') {
    const id = String(++streamSeq);
    svc.publishUserMessage(id, cmd.message);
    await sleep(900);
    const answer = 'Short version: **say the number first**, then the reason. "About 40 ms at p99 — because the write path skips the ledger lock." Then stop talking.';
    for (const word of answer.split(/(?<= )/)) { svc.publishToken(id, word); await sleep(25); }
    svc.publishDone(id, answer);
  } else if (cmd.type === 'screenshot') {
    await sleep(500);
    svc.publishAck('screenshot', 'Screenshot captured — queued for AI');
  } else if (cmd.type === 'detach') {
    // The overlay takes it off its tray and reports the tray back.
    if (desktop.ignoreDetach) return;
    await sleep(80);
    setDesktopTray(desktopTray.filter((shot) => shot.path !== cmd.path));
  }
});

// ── devices ── (Playwright can't emulate safe areas; notch profiles override the vars)
const NOTCH = {
  portrait: { '--safe-top': '59px', '--safe-bottom': '34px', '--gl': '16px', '--gr': '16px' },
  landscape: { '--safe-top': '0px', '--safe-bottom': '21px', '--gl': '59px', '--gr': '59px' },
};
const DEVICES = [
  { name: 'iphone-se', engine: webkit, desc: devices['iPhone SE'] },
  { name: 'iphone-15-pro-max', engine: webkit, desc: devices['iPhone 15 Pro Max'], notch: 'portrait' },
  { name: 'iphone-15-pro-max-landscape', engine: webkit, desc: devices['iPhone 15 Pro Max landscape'], notch: 'landscape' },
  { name: 'pixel-7', engine: chromium, desc: devices['Pixel 7'] },
  { name: 'ipad-portrait', engine: webkit, desc: devices['iPad Pro 11'] },
  { name: 'ipad-landscape', engine: webkit, desc: devices['iPad Pro 11 landscape'] },
  { name: 'galaxy-landscape', engine: chromium, desc: devices['Galaxy S9+ landscape'] },
];
// channel 'chromium' = the full build, so the separate headless shell isn't needed.
const launch = (engine) => engine.launch(engine === chromium ? { channel: 'chromium' } : {});

const failures = [];
function check(dev, name, ok, detail) {
  const line = `${ok ? 'PASS' : 'FAIL'} [${dev}] ${name}${detail ? ' — ' + detail : ''}`;
  console.log(line);
  if (!ok) failures.push(line);
}

async function openPage(browser, dev, scheme) {
  const ctx = await browser.newContext({ ...dev.desc, colorScheme: scheme, reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  // WebKit logs unknown viewport keys as errors; interactive-widget is for Chrome on Android.
  page.on('console', (m) => { if (m.type() === 'error' && !/interactive-widget/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto(`http://127.0.0.1:${info.port}/?t=${encodeURIComponent(info.token)}`);
  if (dev.notch) {
    const vars = NOTCH[dev.notch];
    await page.addStyleTag({ content: ':root{' + Object.entries(vars).map(([k, v]) => `${k}:${v} !important`).join(';') + '}' });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  }
  await page.waitForFunction(() => document.getElementById('app').dataset.conn === 'live', null, { timeout: 5000 });
  return { ctx, page, errors };
}

const geo = (page) => page.evaluate(() => {
  const r = (sel) => { const n = document.querySelector(sel); if (!n) return null; const b = n.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, height: b.height, width: b.width }; };
  const feed = document.getElementById('feed');
  const cards = [...document.querySelectorAll('#feedInner > :not(#empty)')];
  const last = cards.length ? cards[cards.length - 1].getBoundingClientRect() : null;
  return {
    vw: innerWidth, vh: innerHeight,
    docScrollW: document.documentElement.scrollWidth,
    appScrollW: document.getElementById('app').scrollWidth,
    feed: { scrollTop: feed.scrollTop, scrollHeight: feed.scrollHeight, clientHeight: feed.clientHeight },
    dock: r('#dock'), bar: r('#bar'), tx: r('#tx'), chips: r('#chips'), input: r('#input'),
    lastCard: last && { top: last.top, bottom: last.bottom },
    cards: cards.length,
  };
});

async function scenario(dev, scheme) {
  // One service serves every run: start each from an empty desktop.
  svc.history = [];
  svc.livePartial = null;
  svc.publishMeetingState(true);
  svc.publishMeetingState(false);
  const browser = await launch(dev.engine);
  const tag = `${dev.name}/${scheme}`;
  const { ctx, page, errors } = await openPage(browser, dev, scheme);
  const shot = (n) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${dev.name}-${scheme}-${n}.png`) });
  try {
    await sleep(700);
    await shot('01-empty');
    const g0 = await geo(page);
    check(tag, 'no horizontal overflow', g0.docScrollW <= g0.vw && g0.appScrollW <= g0.vw, `doc ${g0.docScrollW} app ${g0.appScrollW} vw ${g0.vw}`);
    check(tag, 'dock inside viewport', g0.dock.bottom <= g0.vh + 0.5 && g0.dock.top > g0.bar.bottom, JSON.stringify({ dockTop: g0.dock.top, dockBottom: g0.dock.bottom, vh: g0.vh }));

    // ── live transcript: lowercase partials then the punctuated final ──
    svc.publishMeetingState(true);
    const partials = ['so walk me', 'so walk me through how', 'so walk me through how you would design the cache'];
    for (const p of partials) { svc.publishTranscript({ speaker: 'interviewer', text: p, final: false }); await sleep(120); }
    const liveText = await page.textContent('#txLines .tl.is-live');
    check(tag, 'partial shows as the live line', liveText === partials[2], JSON.stringify(liveText));
    const speaking = await page.getAttribute('#app', 'data-speaking');
    check(tag, 'speaking state while partials arrive', speaking === 'true');
    const split = await page.evaluate(() => window.matchMedia('(min-width: 760px) and (min-height: 500px)').matches);
    if (!split) {
      // The rolling line, as on the overlay: one italic line, newest words last.
      const tk = await page.$eval('#tkLine', (n) => ({ text: n.textContent, h: n.clientHeight, italic: getComputedStyle(n).fontStyle, ws: getComputedStyle(n).whiteSpace }));
      check(tag, 'ticker ends with the words being spoken', tk.text.endsWith(partials[2]), JSON.stringify(tk.text));
      check(tag, 'ticker is one italic line', tk.h <= 26 && tk.italic === 'italic' && tk.ws === 'pre', JSON.stringify(tk));
    }
    svc.publishTranscript({ speaker: 'interviewer', text: 'So, walk me through how you would design the cache?', final: true });
    svc.publishTranscript({ speaker: 'interviewer', text: 'So, walk me through how you would design the cache?', final: true }); // provider re-send
    svc.publishTranscript({ speaker: 'user', text: 'my own mic words', final: true });
    await sleep(150);
    const lines = await page.$$eval('#txLines .tl', (ns) => ns.map((n) => ({ live: n.classList.contains('is-live'), text: n.lastChild ? n.lastChild.textContent : '' })));
    check(tag, 'final replaces the partial, no duplicate, user mic absent', lines.length === 1 && !lines[0].live && lines[0].text === 'So, walk me through how you would design the cache?', JSON.stringify(lines));
    const tkAfterFinal = await page.textContent('#tkLine');
    check(tag, 'ticker shows the final once, no user mic', tkAfterFinal === 'So, walk me through how you would design the cache?', JSON.stringify(tkAfterFinal));
    svc.publishTranscript({ speaker: 'interviewer', text: 'And what happens when a region goes down', final: false });
    await sleep(200);
    await shot('02-transcript');

    // ── action → placeholder → labelled answer replaces it in place ──
    await page.click('.chip[data-action="whatToAnswer"]');
    await page.waitForSelector('.answer.is-pending', { timeout: 1000 });
    const pending = await page.$eval('.answer.is-pending', (n) => ({ ask: n.querySelector('.ask-label')?.textContent, thinking: n.querySelector('.thinking')?.textContent, skel: !!document.querySelector('.skel') }));
    check(tag, 'placeholder asks as the overlay does, then says Thinking... (no skeleton)', pending.ask === 'What should I say?' && pending.thinking === 'Thinking...' && !pending.skel, JSON.stringify(pending));
    await shot('03-pending');
    await page.waitForSelector('.answer.is-pending', { state: 'detached', timeout: 4000 });
    await sleep(500);
    const labels = await page.$$eval('.answer', (ns) => ns.map((n) => n.dataset.label));
    check(tag, 'answer took the placeholder slot (one answer)', labels.filter((l) => l === 'What to Answer').length === 1, JSON.stringify(labels));
    const chrome = await page.$eval('.answer:not(.is-pending)', (n) => { const cs = getComputedStyle(n); return { bg: cs.backgroundColor, shadow: cs.boxShadow }; });
    check(tag, 'no card around the answer, as on the overlay', chrome.bg === 'rgba(0, 0, 0, 0)' && chrome.shadow === 'none', JSON.stringify(chrome));
    // ── Answer (voice toggle) gets no placeholder ──
    await page.click('.chip[data-action="answer"]');
    await sleep(150);
    check(tag, 'Answer chip adds no placeholder', (await page.$$('.answer.is-pending')).length === 0);

    // ── typed question: bubble → Thinking → streamed answer ──
    await page.fill('#input', 'How fast is the write path?');
    check(tag, 'send enabled with text', await page.isEnabled('#sendBtn'));
    await page.keyboard.press('Enter');
    await page.waitForSelector('.row-user', { timeout: 1000 });
    await page.waitForSelector('.answer.is-pending .thinking', { timeout: 1000 });
    // Sampled in one step while text is streaming (the fake answer finishes in <1 s).
    const caretHost = await page.waitForFunction(() => {
      const c = document.querySelector('.answer.is-streaming .caret');
      return c && c.parentElement.textContent.length > 20 ? c.parentElement.tagName : null;
    }, null, { timeout: 3000, polling: 'raf' }).then((h) => h.jsonValue(), () => 'no caret seen');
    check(tag, 'streaming caret sits inside the last text block', caretHost === 'P' || caretHost === 'LI', caretHost);
    await shot('04-streaming');
    await page.waitForSelector('.answer.is-streaming', { state: 'detached', timeout: 8000 });
    await sleep(200);
    const userState = await page.$eval('.row-user', (n) => n.className);
    check(tag, 'bubble delivered (no sending/failed state)', !/is-sending|is-failed/.test(userState), userState);
    const bubbles = await page.$$('.row-user');
    check(tag, 'server echo reconciled with the local bubble (one bubble)', bubbles.length === 1, String(bubbles.length));
    const lastAnswer = await page.$$eval('.answer .answer-body', (ns) => ns[ns.length - 1].textContent);
    check(tag, 'streamed answer complete, no caret', /Then stop talking\./.test(lastAnswer) && !(await page.$('.answer .caret')), lastAnswer.slice(-40));

    // ── a question asked on the DESKTOP shows at once, Thinking under it ──
    const deskId = String(++streamSeq);
    svc.publishUserMessage(deskId, 'What does the rollout look like?', { awaitingAnswer: true });
    await sleep(250);
    const asked = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#feedInner > :not(#empty)')];
      const i = rows.findIndex((n) => n.classList.contains('row-user') && n.textContent.includes('What does the rollout look like?'));
      const next = rows[i + 1];
      return { found: i >= 0, thinking: next ? next.querySelector('.thinking')?.textContent : null };
    });
    check(tag, 'a desktop question shows before any answer, with Thinking under it', asked.found && asked.thinking === 'Thinking...', JSON.stringify(asked));
    await shot('04b-desktop-question');
    for (const w of 'Canary first, then ten percent. '.split(/(?<= )/)) { svc.publishToken(deskId, w); await sleep(30); }
    svc.publishDone(deskId, 'Canary first, then ten percent.');
    await sleep(400);
    const deskAnswered = await page.evaluate((id) => ({ pending: !!document.querySelector('.answer.is-pending'), answer: document.querySelector('[data-key="a:' + id + '"] .answer-body')?.textContent.trim() }), deskId);
    check(tag, 'its Thinking turns into the streamed answer in place', !deskAnswered.pending && deskAnswered.answer === 'Canary first, then ten percent.', JSON.stringify(deskAnswered));

    // ── fill the feed and prove it scrolls ──
    for (const l of ['Code Hint', 'Follow-Up Questions', 'Clarify', 'Recap', 'Brainstorm']) svc.publishAssistantMessage(String(++streamSeq), ANSWERS[l], l);
    await sleep(700);
    let g = await geo(page);
    check(tag, 'feed is the scroller and overflows', g.feed.scrollHeight > g.feed.clientHeight, JSON.stringify(g.feed));
    check(tag, 'pinned to bottom after new answers', g.feed.scrollHeight - g.feed.clientHeight - g.feed.scrollTop < 2, JSON.stringify(g.feed));
    check(tag, 'last card clears the dock', g.lastCard.bottom <= g.dock.top + 1 + 24, JSON.stringify({ last: g.lastCard.bottom, dockTop: g.dock.top }));
    await shot('04b-feed');
    await page.evaluate(() => { document.getElementById('feed').scrollTop = 0; });
    await sleep(150);
    g = await geo(page);
    check(tag, 'user can scroll up', g.feed.scrollTop === 0);
    // A new answer while scrolled up must NOT yank the view; the jump pill counts it.
    svc.publishAssistantMessage(String(++streamSeq), ANSWERS['Follow-Up Questions'], 'Follow-Up Questions');
    await sleep(400);
    const g2 = await geo(page);
    check(tag, 'no auto-scroll while reading history', g2.feed.scrollTop === 0, String(g2.feed.scrollTop));
    const jumpOpen = await page.$eval('#jump', (n) => n.classList.contains('is-open'));
    const count = await page.textContent('#jumpCount');
    check(tag, 'jump pill shows with a count', jumpOpen && count === '1', `${jumpOpen} ${count}`);
    await shot('05-jump');
    await page.click('#jump');
    await sleep(1400);
    g = await geo(page);
    check(tag, 'jump returns to the latest', g.feed.scrollHeight - g.feed.clientHeight - g.feed.scrollTop < 2, JSON.stringify(g.feed));

    // ── screen capture ack ──
    await page.click('#captureBtn');
    await page.waitForSelector('.sys', { timeout: 2000 });
    const capState = await page.getAttribute('#captureBtn', 'data-state');
    const toastOpen = await page.$eval('#toast', (n) => n.classList.contains('is-open'));
    check(tag, 'capture: row + check on the button, no duplicate toast', capState === 'c' && !toastOpen, `${capState} toast=${toastOpen}`);
    await sleep(300);
    await shot('06-capture');

    // ── transcript island (narrow) / column (split) ──
    for (let i = 0; i < 14; i++) svc.publishTranscript({ speaker: 'interviewer', text: `Line ${i}: and how would you roll that out across ${i + 2} regions without downtime?`, final: true });
    await sleep(900);
    if (!split) {
      const roll = await page.$eval('#tkLine', (n) => ({ left: n.scrollLeft, w: n.clientWidth, sw: n.scrollWidth, text: n.textContent }));
      check(tag, 'ticker rolled to the newest words', roll.sw > roll.w && roll.left + roll.w >= roll.sw - 2 && roll.text.endsWith('15 regions without downtime?'), JSON.stringify({ left: roll.left, w: roll.w, sw: roll.sw }));
      await shot('06b-ticker');
      const h0 = (await geo(page)).tx.height;
      await page.click('#txTicker');
      await sleep(900);
      const h1 = (await geo(page)).tx.height;
      check(tag, 'tap opens the transcript', h1 > h0 + 100, `${h0} → ${h1}`);
      const scrollable = await page.$eval('#txBody', (n) => n.scrollHeight > n.clientHeight && getComputedStyle(n).overflowY === 'auto');
      check(tag, 'open transcript scrolls', scrollable);
      await shot('07-transcript-open');
      // Flick it shut from the head.
      const box = await page.$eval('#txHead', (n) => { const b = n.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
      await page.mouse.move(box.x, box.y);
      await page.mouse.down();
      for (let s = 1; s <= 6; s++) { await page.mouse.move(box.x, box.y - s * 30); await sleep(8); }
      await page.mouse.up();
      await sleep(900);
      const h2 = (await geo(page)).tx.height;
      check(tag, 'flick up closes it', Math.abs(h2 - h0) < 2, `${h2} vs ${h0}`);
      // Drag it open slowly past half-way.
      await page.mouse.move(box.x, box.y);
      await page.mouse.down();
      for (let s = 1; s <= 20; s++) { await page.mouse.move(box.x, box.y + s * 16); await sleep(16); }
      await sleep(150);
      await page.mouse.up();
      await sleep(900);
      const h3 = (await geo(page)).tx.height;
      check(tag, 'drag down opens it', h3 > h0 + 100, `${h3}`);
      const gOpen = await geo(page);
      await page.mouse.click(gOpen.vw / 2, gOpen.tx.bottom + 24);
      await sleep(900);
      const h4 = (await geo(page)).tx.height;
      check(tag, 'tap outside closes it', Math.abs(h4 - h0) < 2, `${h4}`);
    } else {
      const col = await page.$eval('#txBody', (n) => ({ sh: n.scrollHeight, ch: n.clientHeight, oy: getComputedStyle(n).overflowY }));
      check(tag, 'split: transcript column scrolls', col.sh > col.ch && col.oy === 'auto', JSON.stringify(col));
      const disp = await page.$eval('#txLines .tl', (n) => getComputedStyle(n).display);
      check(tag, 'split: lines are blocks', disp === 'block', disp);
      await shot('07-split');
    }

    // ── reconnect in the middle of a streamed answer: no doubled text ──
    const sid = String(++streamSeq);
    svc.publishUserMessage(sid, 'Mid-stream reconnect check');
    for (const w of ['Alpha ', 'beta ', 'gamma ']) svc.publishToken(sid, w);
    await sleep(200);
    // The pill resizes with its label: at each state change it is given a
    // pixel width to ease from and the new label's width to ease to.
    await page.evaluate(() => {
      window.__pill = [];
      const conn = document.getElementById('conn');
      new MutationObserver(() => {
        const cs = getComputedStyle(conn);
        window.__pill.push({ state: document.getElementById('app').dataset.conn, inline: conn.style.width, transition: cs.transitionProperty });
      }).observe(document.getElementById('app'), { attributes: true, attributeFilter: ['data-conn'] });
    });
    svc.disconnectAllClients(1001, 'test restart');
    await page.waitForFunction(() => document.getElementById('app').dataset.conn !== 'live', null, { timeout: 3000 });
    await shot('08-reconnecting');
    await page.waitForFunction(() => document.getElementById('app').dataset.conn === 'live', null, { timeout: 6000 });
    // A shrink waits one text-swap beat (150 ms), then resizes (300 ms).
    await sleep(800);
    const pill = await page.evaluate(() => {
      const conn = document.getElementById('conn');
      const text = document.getElementById('connText');
      const settledInline = conn.style.width;
      const w = conn.getBoundingClientRect().width;
      conn.style.width = '';
      const natural = conn.getBoundingClientRect().width;
      return { changes: window.__pill, settledInline, w, natural, clipped: text.getBoundingClientRect().right > conn.getBoundingClientRect().right + 0.5, label: text.textContent };
    });
    const eased = pill.changes.length >= 2 && pill.changes.every((c) => /^[\d.]+px$/.test(c.inline) && /width/.test(c.transition));
    check(tag, 'the pill eases its width at each change (Reconnecting, then Connected)', eased, JSON.stringify(pill.changes));
    check(tag, 'and settles at its natural width, label whole', pill.settledInline === '' && Math.abs(pill.w - pill.natural) < 0.6 && !pill.clipped && pill.label === 'Connected', JSON.stringify(pill));
    const liveBody = await page.$eval('.answer.is-streaming .answer-body', (n) => n.textContent.trim()).catch(() => null);
    check(tag, 'replayed stream not doubled', liveBody === 'Alpha beta gamma', JSON.stringify(liveBody));
    svc.publishToken(sid, 'delta');
    svc.publishDone(sid, 'Alpha beta gamma delta');
    await sleep(300);
    const cardsWithAlpha = await page.$$eval('.answer .answer-body', (ns) => ns.filter((n) => n.textContent.includes('Alpha beta')).length);
    check(tag, 'one card for the resumed answer', cardsWithAlpha === 1, String(cardsWithAlpha));
    const txAfter = await page.$$eval('#txLines .tl', (ns) => ns.length);
    check(tag, 'transcript survives reconnect (replayed)', txAfter >= 14, String(txAfter));

    // ── waking the phone mid-reconnect must not open a second socket ──
    // (lock/unlock during a Wi-Fi blip: visibilitychange fires while a retry
    // socket is already connecting). Two sockets = every token twice.
    svc.disconnectAllClients(1001, 'blip');
    await page.waitForFunction(() => document.getElementById('app').dataset.conn !== 'live', null, { timeout: 3000 });
    await page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => document.getElementById('app').dataset.conn === 'live', null, { timeout: 6000 });
    await sleep(1500);
    check(tag, 'one socket after waking mid-reconnect', svc.phoneClientCount() === 1, String(svc.phoneClientCount()));
    const wid = String(++streamSeq);
    svc.publishUserMessage(wid, 'Wake check');
    svc.publishToken(wid, 'Once ');
    svc.publishToken(wid, 'only');
    svc.publishDone(wid, 'Once only');
    await sleep(400);
    const onceBodies = await page.$$eval('.answer .answer-body', (ns) => ns.filter((n) => n.textContent.includes('Once')).map((n) => n.textContent.trim()));
    check(tag, 'streamed text renders once after the wake', onceBodies.length === 1 && onceBodies[0] === 'Once only', JSON.stringify(onceBodies));
    const wakeBubbles = await page.$$eval('.row-user .bubble', (ns) => ns.filter((n) => n.textContent === 'Wake check').length);
    check(tag, 'echoed question renders once after the wake', wakeBubbles === 1, String(wakeBubbles));

    // ── colour contrast of answer text (on the page itself, no card) ──
    const contrast = await page.evaluate(() => {
      function rgb(s) { return s.match(/[\d.]+/g).map(Number); }
      function lum([r, g, b]) { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }
      function blend(fg, bg) { const a = fg[3] ?? 1; return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)); }
      const answer = [...document.querySelectorAll('.answer:not(.is-pending)')].find((n) => n.querySelector('.ask-label'));
      const body = answer.querySelector('.answer-body');
      const bg = rgb(getComputedStyle(document.body).backgroundColor);
      const fg = blend(rgb(getComputedStyle(body).color), bg);
      const chip = answer.querySelector('.ask-label');
      const chipBg = blend(rgb(getComputedStyle(chip).backgroundColor), bg);
      const label = blend(rgb(getComputedStyle(chip).color), chipBg);
      const meta = blend(rgb(getComputedStyle(answer.querySelector('.answer-meta')).color), bg);
      const cr = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
      return { body: cr(fg, bg), label: cr(label, chipBg), meta: cr(meta, bg) };
    });
    check(tag, 'body text contrast >= 7', contrast.body >= 7, contrast.body.toFixed(2));
    check(tag, 'action label contrast >= 4.5', contrast.label >= 4.5, contrast.label.toFixed(2));
    check(tag, 'timestamp contrast >= 4.5', contrast.meta >= 4.5, contrast.meta.toFixed(2));

    check(tag, 'no page errors', errors.length === 0, errors.join(' | '));
  } finally {
    await ctx.close();
    await browser.close();
  }
}

async function tokenScenarios() {
  const dev = DEVICES[1];
  const browser = await launch(dev.engine);
  // Rotation closes sockets with 4401 → lock screen.
  let { ctx, page } = await openPage(browser, dev, 'dark');
  info = await svc.rotateToken();
  await page.waitForFunction(() => document.getElementById('app').dataset.conn === 'rejected', null, { timeout: 3000 }).catch(() => {});
  check('token', 'rotation shows the expired-link screen', await page.$eval('#lock', (n) => !n.hidden));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'token-expired.png') });
  await ctx.close();
  // A socket drop, then a rotation while the phone is away: the reconnect's
  // upgrade is refused with HTTP 401 (close 1006), found by the HEAD probe.
  ({ ctx, page } = await openPage(browser, dev, 'dark'));
  const oldToken = info.token;
  svc.disconnectAllClients(1001, 'drop');
  info = await svc.rotateToken();
  await page.waitForFunction(() => document.getElementById('app').dataset.conn === 'rejected', null, { timeout: 12000 }).catch(() => {});
  check('token', 'refused reconnect (1006) detected as expired', (await page.getAttribute('#app', 'data-conn')) === 'rejected', await page.getAttribute('#app', 'data-conn'));
  check('token', 'page used the old token', oldToken !== info.token);
  await ctx.close();
  await browser.close();
}

// The two slow paths, once, on one device (~70 s): a question the desktop never
// echoes turns "Not delivered" with a Retry that works, and an action nobody
// answers says so and clears itself.
async function timeoutScenarios() {
  const dev = DEVICES[1];
  svc.history = [];
  svc.livePartial = null;
  svc.publishMeetingState(true);   // the unanswered action is a meeting action
  const browser = await launch(dev.engine);
  const { ctx, page, errors } = await openPage(browser, dev, 'dark');
  try {
    desktop.dropChatOnce.add('Did this arrive?');
    await page.fill('#input', 'Did this arrive?');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.row-user.is-sending', { timeout: 1000 });
    await page.waitForSelector('.row-user.is-failed', { timeout: 12000 });
    const status = await page.textContent('.row-user .row-status');
    check('timeouts', 'undelivered question says so', /Not delivered/.test(status), status);
    const placeholderGone = await page.waitForSelector('.answer.is-pending', { state: 'detached', timeout: 1500 }).then(() => true, () => false);
    check('timeouts', 'its Thinking placeholder collapses away', placeholderGone);
    await page.click('.row-user .row-status button');
    await page.waitForSelector('.answer.is-streaming', { timeout: 4000 });
    await page.waitForSelector('.answer.is-streaming', { state: 'detached', timeout: 8000 });
    const cls = await page.$eval('.row-user', (n) => n.className);
    check('timeouts', 'Retry delivers it and the answer streams', !/is-failed|is-sending/.test(cls), cls);
    check('timeouts', 'still one bubble after the retry', (await page.$$('.row-user')).length === 1);

    desktop.ignoreActions = true;
    await page.click('.chip[data-action="clarify"]');
    await page.waitForSelector('.answer.is-pending', { timeout: 1000 });
    await page.waitForSelector('.answer.is-idle', { timeout: 48000 });
    const idle = await page.textContent('.answer.is-idle .answer-body');
    check('timeouts', 'an unanswered action says nothing came back', /Nothing came back/.test(idle), idle);
    await page.waitForSelector('.answer.is-idle', { state: 'detached', timeout: 9000 });
    check('timeouts', 'and then clears itself', true);
    check('timeouts', 'no page errors', errors.length === 0, errors.join(' | '));
  } finally {
    desktop.ignoreActions = false;
    await ctx.close();
    await browser.close();
  }
}

// Photos and screenshots from the phone: picked, shrunk to 2048 px, EXIF
// rotation applied (then stripped), uploaded in order, Retry on failure.
async function imageScenarios(dev) {
  const sharp = require('sharp');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-images-'));
  const wide = path.join(dir, 'wide.png');
  const sideways = path.join(dir, 'sideways.jpg');
  const small = path.join(dir, 'small.jpg');
  await sharp({ create: { width: 3200, height: 1800, channels: 3, background: { r: 40, g: 90, b: 200 } } }).png().toFile(wide);
  // A phone photo: stored 1200x800 with EXIF orientation 6 (shown rotated 90°,
  // 800x1200 upright) and GPS coordinates, which must not leave the phone.
  await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 200, g: 60, b: 60 } } })
    .jpeg()
    .withExif({
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '37/1 46/1 30/1', GPSLongitudeRef: 'W', GPSLongitude: '122/1 25/1 10/1' },
    })
    .withMetadata({ orientation: 6 })   // an IFD0 Orientation in withExif is dropped
    .toFile(sideways);
  const hasGps = (exif) => !!exif && (exif.includes(Buffer.from([0x88, 0x25])) || exif.includes(Buffer.from([0x25, 0x88])));
  const fixture = await sharp(sideways).metadata();
  if (fixture.orientation !== 6 || !hasGps(fixture.exif)) throw new Error('fixture lacks orientation/GPS');
  await sharp({ create: { width: 640, height: 480, channels: 3, background: '#888' } }).jpeg().toFile(small);

  const tag = `${dev.name}/images`;
  svc.history = [];
  svc.livePartial = null;
  images.length = 0;
  const browser = await launch(dev.engine);
  const { ctx, page, errors } = await openPage(browser, dev, 'dark');
  const attached = (n) => page.waitForFunction((count) => {
    const rows = [...document.querySelectorAll('.row-image .row-status')];
    return rows.length >= count && rows.slice(0, count).every((r) => r.textContent === 'Sent to your desktop');
  }, n, { timeout: 15000 });
  try {
    await page.setInputFiles('#imageInput', wide);
    await attached(1);
    const m1 = await sharp(images[0].data).metadata();
    check(tag, 'big image arrives as a 2048 px JPEG', images[0].mime === 'image/jpeg' && m1.format === 'jpeg' && m1.width === 2048 && m1.height === 1152, `${images[0].mime} ${m1.width}x${m1.height}`);
    const thumb = await page.$eval('.row-image img', (n) => n.getAttribute('src').slice(0, 23));
    check(tag, 'thumbnail is a data: URL (CSP blocks blob:)', thumb === 'data:image/jpeg;base64,', thumb);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${dev.name}-images-1.png`) });

    await page.setInputFiles('#imageInput', sideways);
    await attached(2);
    const m2 = await sharp(images[1].data).metadata();
    check(tag, 'EXIF rotation applied (sideways photo arrives upright)', m2.width === 800 && m2.height === 1200, `${m2.width}x${m2.height}`);
    check(tag, 'the photo\'s GPS location does not leave the phone', !hasGps(m2.exif) && m2.orientation !== 6, `gps=${hasGps(m2.exif)} orientation=${m2.orientation}`);

    await page.setInputFiles('#imageInput', [small, wide]);
    await attached(4);
    const m3 = await sharp(images[2].data).metadata();
    check(tag, 'several at once upload in the order picked', images.length === 4 && m3.width === 640, `${images.length} first=${m3.width}`);

    failNextImage = true;
    await page.setInputFiles('#imageInput', small);
    await page.waitForFunction(() => /Not delivered/.test(document.querySelector('.row-image:last-of-type .row-status')?.textContent || ''), null, { timeout: 15000 });
    check(tag, 'a failed delivery says so, with Retry', true);
    await page.click('.row-image:last-of-type .row-status button');
    await attached(5);
    check(tag, 'Retry delivers it', images.length === 5);
    // The one expected error: the deliberate 500 above.
    const unexpected = errors.filter((e) => !/status of 500/.test(e));
    check(tag, 'no page errors', unexpected.length === 0, unexpected.join(' | '));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${dev.name}-images-2.png`) });
  } finally {
    failNextImage = false;
    await ctx.close();
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// The desktop's attached screenshots: the tray above the buttons (as the
// overlay lists them above its input), then, once an answer goes out with
// them, the row they were sent with. Every device shape and theme.
async function screenshotThumbs() {
  const sharp = require('sharp');
  const colors = ['#2b59c3', '#c3462b', '#2bc37a', '#c3a92b', '#8a2bc3'];
  return Promise.all(colors.map(async (c, i) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${i === 4 ? 300 : 480}" height="${i === 4 ? 480 : 300}"><rect width="100%" height="100%" fill="#1d1f24"/><rect x="18" y="18" width="60%" height="22" rx="4" fill="${c}"/><rect x="18" y="56" width="80%" height="10" rx="3" fill="#6b7280"/><rect x="18" y="76" width="70%" height="10" rx="3" fill="#6b7280"/></svg>`;
    const buf = await sharp(Buffer.from(svg)).jpeg({ quality: 70 }).toBuffer();
    return 'data:image/jpeg;base64,' + buf.toString('base64');
  }));
}
let THUMBS = null;
let UPLOAD_FIXTURE = null;
async function trayScenario(dev, scheme) {
  THUMBS = THUMBS || await screenshotThumbs();
  if (!UPLOAD_FIXTURE) {
    UPLOAD_FIXTURE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pm-tray-upload-')), 'photo.jpg');
    await require('sharp')({ create: { width: 800, height: 600, channels: 3, background: '#557' } }).jpeg().toFile(UPLOAD_FIXTURE);
  }
  svc.history = [];
  svc.livePartial = null;
  setDesktopTray([]);
  svc.publishMeetingState(true);
  const browser = await launch(dev.engine);
  const tag = `${dev.name}/${scheme}/tray`;
  const { ctx, page, errors } = await openPage(browser, dev, scheme);
  const shot = (n) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${dev.name}-${scheme}-tray-${n}.png`) });
  const paths = THUMBS.map((_, i) => `/Users/someone/natively/screenshots/cap-${i}.png`);
  const trayGeo = () => page.evaluate(() => {
    const r = (sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, height: b.height }; };
    const title = document.getElementById('trayTitle');
    const imgs = [...document.querySelectorAll('.tray-thumb img')];
    const cards = [...document.querySelectorAll('#feedInner > :not(#empty)')];
    return {
      vw: innerWidth, docScrollW: document.documentElement.scrollWidth,
      open: document.getElementById('trayWrap').dataset.open,
      tray: r('.tray'), chips: r('#chips'), dock: r('#dock'),
      thumbs: imgs.length, loaded: imgs.every((i) => i.complete && i.naturalWidth > 0),
      title: title.textContent, titleClipped: title.scrollWidth > title.clientWidth + 1,
      lastCardBottom: cards.length ? cards[cards.length - 1].getBoundingClientRect().bottom : null,
      lastCard: cards.length ? cards[cards.length - 1].className : null,
      feedMetrics: (() => { const f = document.getElementById('feed'); return { top: f.scrollTop, h: f.scrollHeight, ch: f.clientHeight, pb: getComputedStyle(f).paddingBottom }; })(),
      chipsShown: getComputedStyle(document.getElementById('chips')).display !== 'none',
    };
  });
  try {
    svc.publishAssistantMessage(String(++streamSeq), ANSWERS.Clarify, 'Clarify');
    await sleep(600);
    const before = await trayGeo();
    check(tag, 'no tray until the desktop attaches a screenshot', before.open === 'false' && before.thumbs === 0);

    setDesktopTray([{ path: paths[0], thumb: THUMBS[0] }]);
    await page.waitForFunction(() => document.getElementById('trayWrap').dataset.open === 'true', null, { timeout: 3000 });
    await sleep(500);
    await shot('1-one');
    const one = await trayGeo();
    check(tag, 'a desktop screenshot shows in the tray, loaded', one.thumbs === 1 && one.loaded && one.title === '1 screenshot attached', JSON.stringify({ n: one.thumbs, loaded: one.loaded, title: one.title }));
    check(tag, 'the tray sits above the buttons, inside the screen', one.tray.bottom <= one.chips.top + 0.5 && one.tray.left >= 0 && one.tray.right <= one.vw + 0.5 && one.docScrollW <= one.vw, JSON.stringify({ tray: one.tray, chipsTop: one.chips.top, vw: one.vw }));
    check(tag, 'the dock grows by the tray', one.dock.height >= before.dock.height + 40, `${before.dock.height} -> ${one.dock.height}`);
    check(tag, 'the latest answer stays clear of the taller dock', one.lastCardBottom !== null && one.lastCardBottom <= one.dock.top + 1, `card ${one.lastCardBottom} dock ${one.dock.top}`);

    setDesktopTray(paths.map((p, i) => ({ path: p, thumb: THUMBS[i] })));
    await page.waitForFunction(() => document.querySelectorAll('.tray-thumb').length === 5, null, { timeout: 3000 });
    await sleep(400);
    await shot('2-five');
    const five = await trayGeo();
    check(tag, 'five screenshots, one row, title whole', five.thumbs === 5 && five.title === '5 screenshots attached' && !five.titleClipped && five.tray.right <= five.vw + 0.5 && five.docScrollW <= five.vw, JSON.stringify({ n: five.thumbs, title: five.title, clipped: five.titleClipped, right: five.tray.right, vw: five.vw }));

    // Remove on the phone: gone at once, and the desktop's tray follows.
    await page.click('.tray-thumb:nth-child(2) .tray-remove');
    await page.waitForFunction(() => document.querySelectorAll('.tray-thumb:not(.is-leaving)').length === 4, null, { timeout: 1500 });
    await sleep(500);
    const removed = await trayGeo();
    const deskPaths = svc.getAttachmentPaths();
    check(tag, 'Remove takes it off at once; the desktop tray follows', removed.thumbs === 4 && removed.title === '4 screenshots attached' && deskPaths.length === 4 && !deskPaths.includes(paths[1]), JSON.stringify({ n: removed.thumbs, title: removed.title, desk: deskPaths.length }));
    const hit = await page.$eval('.tray-thumb .tray-remove', (b) => { const r = b.getBoundingClientRect(); const a = getComputedStyle(b, '::after'); return { w: r.width, hitW: parseFloat(a.width), hitH: parseFloat(a.height) }; });
    check(tag, 'the remove target is bigger than its 18 px disc', hit.hitW >= 34 && hit.hitH >= 34, JSON.stringify(hit));
    await shot('2b-removed');
    if (dev.name === 'iphone-15-pro-max' && scheme === 'dark') {
      // A desktop that never confirms: the screenshot comes back, as it still is.
      desktop.ignoreDetach = true;
      await page.click('.tray-thumb:nth-child(1) .tray-remove');
      await sleep(400);
      const hidden = await trayGeo();
      await sleep(5200);
      const back = await trayGeo();
      check(tag, 'unconfirmed removal comes back after a few seconds', hidden.title === '3 screenshots attached' && back.title === '4 screenshots attached' && back.thumbs === 4, `${hidden.title} -> ${back.title}`);
      desktop.ignoreDetach = false;
    }

    // Sent with an answer: the tray folds away, the screenshots land above the
    // answer (which replaces the placeholder in place).
    await page.click('.chip[data-action="whatToAnswer"]');
    await page.waitForFunction(() => document.getElementById('trayWrap').dataset.open === 'false', null, { timeout: 3000 });
    await page.waitForSelector('.row-shots', { timeout: 3000 });
    const order = await page.$$eval('#feedInner > :not(#empty)', (ns) => ns.map((n) => n.classList.contains('row-shots') ? 'shots' : n.classList.contains('is-pending') ? 'pending' : n.tagName.toLowerCase()));
    check(tag, 'screenshots land above the waiting answer', order.slice(-2).join(',') === 'shots,pending', JSON.stringify(order));
    await page.waitForSelector('.answer.is-pending', { state: 'detached', timeout: 4000 });
    await sleep(500);
    await shot('3-sent');
    const sent = await page.evaluate(() => {
      const row = document.querySelector('.row-shots');
      const next = row.nextElementSibling;
      const imgs = [...row.querySelectorAll('img')];
      const b = row.getBoundingClientRect();
      return {
        n: imgs.length, loaded: imgs.every((i) => i.complete && i.naturalWidth > 0),
        status: row.querySelector('.row-status').textContent,
        nextLabel: next && next.dataset ? next.dataset.label || null : null,
        left: b.left, right: b.right, vw: innerWidth,
        thumbsLeft: document.querySelectorAll('.tray-thumb').length,
      };
    });
    check(tag, 'the sent row shows all four, the answer right under it', sent.n === 4 && sent.loaded && sent.status === '4 screenshots from your desktop' && sent.nextLabel === 'What to Answer', JSON.stringify(sent));
    check(tag, 'the sent row fits the screen; the folded tray empties', sent.left >= 0 && sent.right <= sent.vw + 0.5 && sent.thumbsLeft === 0, JSON.stringify(sent));

    await page.reload();
    await page.waitForFunction(() => document.getElementById('app').dataset.conn === 'live', null, { timeout: 5000 });
    await sleep(400);
    const replay = await page.evaluate(() => ({ rows: document.querySelectorAll('.row-shots img').length, open: document.getElementById('trayWrap').dataset.open }));
    check(tag, 'a reload brings the sent screenshots back, and no stale tray', replay.rows === 4 && replay.open === 'false', JSON.stringify(replay));

    // A photo sent from the phone: its row offers Remove while the desktop's
    // tray holds it, and says so once removed.
    desktop.trayUploads = THUMBS[2];
    await page.setInputFiles('#imageInput', UPLOAD_FIXTURE);
    await page.waitForFunction(() => /Attached to the next answer/.test(document.querySelector('.row-image:last-of-type .row-status')?.textContent || ''), null, { timeout: 15000 });
    await sleep(500);
    const listed = await trayGeo();
    check(tag, 'a phone photo shows Remove on its row while attached', listed.open === 'true' && listed.thumbs === 1);
    check(tag, 'the photo row stays clear of the dock as the tray opens', listed.lastCardBottom !== null && listed.lastCardBottom <= listed.dock.top + 1, `row ${listed.lastCardBottom} dock ${listed.dock.top} ${listed.lastCard} ${JSON.stringify(listed.feedMetrics)}`);
    await shot('4-photo-attached');
    await page.click('.row-image:last-of-type .row-status button');
    await page.waitForFunction(() => document.getElementById('trayWrap').dataset.open === 'false', null, { timeout: 3000 });
    await sleep(400);
    const rowAfter = await page.textContent('.row-image:last-of-type .row-status');
    check(tag, 'Remove on the row takes it off; the row says so', rowAfter === 'Removed from the next answer' && svc.getAttachmentPaths().length === 0, JSON.stringify(rowAfter));
    check(tag, 'no page errors', errors.length === 0, errors.join(' | '));
  } finally {
    desktop.ignoreDetach = false;
    desktop.trayUploads = null;
    setDesktopTray([]);
    await ctx.close();
    await browser.close();
  }
}

// No meeting / live / ended, as the phone tells them apart: the pill, the
// empty page, the transcript line. Ending a meeting leaves a clean canvas.
async function meetingStateScenario(dev, scheme) {
  svc.history = [];
  svc.livePartial = null;
  setDesktopTray([]);
  svc.publishMeetingState(false);
  svc.meetingEnded = false;   // a desktop that has not had a meeting yet
  const browser = await launch(dev.engine);
  const tag = `${dev.name}/${scheme}/meeting`;
  const { ctx, page, errors } = await openPage(browser, dev, scheme);
  const shot = (n) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${dev.name}-${scheme}-meeting-${n}.png`) });
  const state = () => page.evaluate(() => {
    const t = (id) => document.getElementById(id).textContent;
    const empty = document.getElementById('empty');
    return {
      pill: t('connText'), dot: getComputedStyle(document.querySelector('.conn-dot')).backgroundColor,
      title: t('emptyTitle'), sub: t('emptySub'), emptyShown: getComputedStyle(empty).display !== 'none',
      ticker: t('tkEmpty'), txState: t('txState'),
      rows: document.querySelectorAll('#feedInner > :not(#empty)').length,
      lines: document.querySelectorAll('#txLines .tl').length,
    };
  });
  try {
    await sleep(700);
    const idle = await state();
    const live0Dot = await page.evaluate(() => { const probe = document.createElement('i'); probe.style.background = 'var(--live)'; document.body.append(probe); const c = getComputedStyle(probe).backgroundColor; probe.remove(); return c; });
    await shot('1-no-meeting');
    check(tag, 'no meeting: the page and the line say so; the pill says Connected', idle.pill === 'Connected' && idle.title === 'No meeting running' && idle.ticker === 'No meeting running' && idle.emptyShown, JSON.stringify(idle));
    const faded = await page.$eval('#tkLine', (n) => getComputedStyle(n).webkitMaskImage || getComputedStyle(n).maskImage);
    check(tag, 'a status on the line is not faded at its end', !faded || faded === 'none', faded);
    const chipsIdle = await page.$$eval('.chip[data-needs-meeting]', (ns) => ns.map((n) => n.classList.contains('needs-meeting')));
    check(tag, 'no meeting: conversation buttons look quieter', chipsIdle.length === 4 && chipsIdle.every(Boolean), JSON.stringify(chipsIdle));
    await page.click('.chip[data-action="recap"]');
    const shook = await page.$eval('.chip[data-action="recap"]', (n) => n.classList.contains('is-shaking') && getComputedStyle(n).animationName);
    await sleep(250);
    const idleTap = await page.evaluate(() => ({ toast: document.getElementById('toastText').textContent, pending: !!document.querySelector('.answer.is-pending') }));
    await sleep(200);
    const settled = await page.$eval('.chip[data-action="recap"]', (n) => n.classList.contains('is-shaking'));
    check(tag, 'a denied tap shakes the button once, then clears for the next', shook === 't-input-shake' && !settled, JSON.stringify({ shook, settled }));
    check(tag, 'tapping one says a meeting is needed, sends nothing', idleTap.toast === 'Start a meeting on your Mac first' && !idleTap.pending, JSON.stringify(idleTap));
    setDesktopTray([{ path: '/Users/someone/natively/screenshots/cap-x.png', thumb: 'data:image/jpeg;base64,/9j/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=' }]);
    await sleep(300);
    const withShot = await page.$$eval('.chip[data-needs-meeting]', (ns) => ns.some((n) => n.classList.contains('needs-meeting')));
    check(tag, 'an attached screenshot is enough to answer from: not dimmed', !withShot);
    setDesktopTray([]);
    await sleep(200);
    check(tag, 'the pill is the connection only: green when connected, meeting or not', idle.dot !== 'rgba(0, 0, 0, 0)' && idle.dot === live0Dot, `${idle.dot} vs ${live0Dot}`);

    svc.publishMeetingState(true);
    await sleep(700);
    const live = await state();
    const toast = await page.textContent('#toastText');
    const chipsLive = await page.$$eval('.chip[data-needs-meeting]', (ns) => ns.some((n) => n.classList.contains('needs-meeting')));
    check(tag, 'a meeting running: the buttons are back', !chipsLive);
    check(tag, 'a meeting starts: still Connected, now listening', live.pill === 'Connected' && live.dot === idle.dot && live.title === 'Connected to your meeting' && live.ticker === 'Listening…' && toast === 'New meeting', JSON.stringify({ ...live, toast }));
    svc.publishTranscript({ speaker: 'interviewer', text: 'Walk me through the rollout plan.', final: true });
    svc.publishAssistantMessage(String(++streamSeq), ANSWERS.Clarify, 'Clarify');
    await sleep(600);
    await shot('2-live');

    svc.publishMeetingState(false);
    await sleep(800);
    const ended = await state();
    await shot('3-ended');
    check(tag, 'the meeting ends: a clean canvas that says so', ended.rows === 0 && ended.lines === 0 && ended.emptyShown && ended.title === 'Meeting ended' && /summary/.test(ended.sub) && ended.ticker === 'Meeting ended' && ended.pill === 'Connected' && ended.txState === 'Meeting ended', JSON.stringify(ended));

    await page.reload();
    await page.waitForFunction(() => document.getElementById('app').dataset.conn === 'live', null, { timeout: 5000 });
    await sleep(700);
    const again = await state();
    check(tag, 'a phone that comes back still hears the meeting ended', again.title === 'Meeting ended' && again.rows === 0 && again.pill === 'Connected', JSON.stringify(again));
    check(tag, 'no page errors', errors.length === 0, errors.join(' | '));
  } finally {
    await ctx.close();
    await browser.close();
  }
}

// Reconnecting that keeps failing: the pill offers a retry, and a tap
// reconnects at once.
async function retryScenario(dev) {
  const tag = `${dev.name}/retry`;
  svc.history = [];
  svc.livePartial = null;
  svc.publishMeetingState(true);
  const browser = await launch(dev.engine);
  const { ctx, page, errors } = await openPage(browser, dev, 'dark');
  const upgrade = svc.handleUpgrade;
  try {
    svc.handleUpgrade = (_req, sock) => sock.destroy();   // the desktop is unreachable
    svc.disconnectAllClients(1001, 'gone');
    await page.waitForFunction(() => document.getElementById('app').dataset.conn === 'reconnecting', null, { timeout: 3000 });
    await sleep(3600);
    const hint = await page.textContent('#connText');
    check(tag, 'still failing after a moment: the pill says Tap to retry', hint === 'Tap to retry', hint);
    svc.handleUpgrade = upgrade;
    const t0 = Date.now();
    await page.click('#conn');
    await page.waitForFunction(() => document.getElementById('app').dataset.conn === 'live', null, { timeout: 3000 });
    const took = Date.now() - t0;
    check(tag, 'a tap reconnects at once, not after the backoff', took < 1500, `${took} ms`);
    await sleep(500);
    check(tag, 'and the pill says Connected', (await page.textContent('#connText')) === 'Connected');

    // The refused sockets above are the scenario, not errors.
    const unexpected = errors.filter((e) => !/WebSocket connection to/.test(e));
    check(tag, 'no page errors', unexpected.length === 0, unexpected.join(' | '));
  } finally {
    svc.handleUpgrade = upgrade;
    await ctx.close();
    await browser.close();
  }
}

// A link without a valid token: the desktop serves the page marked refused
// and it opens on its own lock screen (was a bare line of text).
async function refusedLinkScenario(dev, scheme) {
  const browser = await launch(dev.engine);
  const tag = `${dev.name}/${scheme}/refused`;
  const ctx = await browser.newContext({ ...dev.desc, colorScheme: scheme });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    for (const [q, title, pill, again] of [
      ['', 'This page needs a pairing link', 'Not paired', false],
      ['?t=stale-link', 'This pairing link has expired', 'Link expired', true],
    ]) {
      const res = await page.goto(`http://127.0.0.1:${info.port}/${q}`);
      await sleep(500);
      const st = await page.evaluate(() => {
        const lock = document.getElementById('lock');
        const r = lock.getBoundingClientRect();
        return { shown: !lock.hidden, title: document.getElementById('lockTitle').textContent, pill: document.getElementById('connText').textContent, again: !document.getElementById('lockAgain').hidden, covers: r.width >= innerWidth - 1 && r.height >= innerHeight - 1, conn: document.getElementById('app').dataset.conn };
      });
      check(tag, `${q ? 'stale token' : 'no token'}: the lock screen, not plain text`, res.status() === 401 && st.shown && st.covers && st.title === title && st.pill === pill && st.again === again, JSON.stringify({ status: res.status(), ...st }));
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${dev.name}-${scheme}-refused-${q ? 'stale' : 'none'}.png`) });
    }
    check(tag, 'no page errors', errors.length === 0, errors.join(' | '));
  } finally {
    await ctx.close();
    await browser.close();
  }
}

// Markdown as the overlay renders it (gist chip, tables, math, hot words,
// highlighted code), with and without the desktop renderer; and a new meeting
// starting a new session on the phone.
const RICH = [
  '## Approach',
  'Use a **monotonic stack**: $O(n)$ time.',
  '',
  '1. Walk once',
  '   - push while **decreasing**',
  '2. Return `out`',
  '',
  '| Approach | Time |',
  '|---|---|',
  '| Brute force | $O(n^2)$ |',
  '',
  '```python',
  'def f(nums):',
  '    return nums',
  '```',
  '',
  '[[GIST]] One pass with a stack',
].join('\n');
async function markdownAndSessionScenarios(dev) {
  const tag = `${dev.name}/markdown`;
  svc.history = [];
  svc.livePartial = null;
  svc.publishMeetingState(false);
  svc.setAnswerRenderer(renderPhoneAnswer);
  const browser = await launch(dev.engine);
  const { ctx, page, errors } = await openPage(browser, dev, 'dark');
  const lastCard = (fn) => page.$$eval('.answer:not(.is-pending)', (ns, src) => {
    const n = ns[ns.length - 1];
    return new Function('n', src)(n);
  }, fn);
  try {
    svc.publishAssistantMessage('md1', RICH, 'Code Hint');
    await page.waitForSelector('.answer .gist-chip', { timeout: 4000 });
    const r = await lastCard(`
      const strong = n.querySelector('.answer-body strong');
      return {
        text: n.textContent,
        gist: n.querySelector('.gist-chip .gist-text')?.textContent,
        table: !!n.querySelector('.table-wrap table th'),
        math: n.querySelectorAll('math').length,
        mathVisible: [...n.querySelectorAll('.katex-mathml, math')].some((m) => m.getBoundingClientRect().width > 0),
        katexHtmlHidden: [...n.querySelectorAll('.katex-html')].every((k) => getComputedStyle(k).display === 'none'),
        nested: !!n.querySelector('ol > li > ul'),
        hotword: strong ? getComputedStyle(strong).color : null,
        hotwordToken: getComputedStyle(document.documentElement).getPropertyValue('--hotword').trim(),
        highlighted: n.querySelectorAll('.codeblock .hl-k').length,
        inlineCodeBg: getComputedStyle(n.querySelector(':not(pre) > code')).backgroundColor,
      };`);
    check(tag, 'gist renders as the chip, never as [[GIST]] text', r.gist === 'One pass with a stack' && !r.text.includes('[[GIST]]'), JSON.stringify(r.gist));
    check(tag, 'tables, nested lists, highlighted code', r.table && r.nested && r.highlighted > 0, JSON.stringify({ t: r.table, n: r.nested, h: r.highlighted }));
    check(tag, 'math renders (MathML shown, KaTeX HTML hidden)', r.math >= 2 && r.mathVisible && r.katexHtmlHidden, JSON.stringify({ m: r.math, v: r.mathVisible, h: r.katexHtmlHidden }));
    check(tag, 'bold words take the overlay hot-word colour', r.hotword === 'rgb(169, 192, 251)' && r.hotwordToken === '#a9c0fb', `${r.hotword} ${r.hotwordToken}`);
    check(tag, 'inline code is styled', r.inlineCodeBg !== 'rgba(0, 0, 0, 0)', r.inlineCodeBg);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${dev.name}-markdown.png`) });

    // A streamed phone answer: the marker never flashes, the chip lands.
    const sid = String(++streamSeq);
    let sawMarker = false;
    const words = RICH.split(/(?<= )/);
    for (const w of words) {
      svc.publishToken(sid, w);
      await sleep(12);
      const t = await page.$eval('.answer.is-streaming .answer-body', (n) => n.textContent).catch(() => '');
      if (t.includes('[[')) sawMarker = true;
    }
    svc.publishDone(sid, RICH);
    await sleep(400);
    check(tag, 'streaming never shows a half-arrived gist marker', !sawMarker);
    const streamedGist = await lastCard(`return n.querySelector('.gist-chip .gist-text')?.textContent || null`);
    check(tag, 'streamed answer ends with the gist chip', streamedGist === 'One pass with a stack', String(streamedGist));

    // No desktop renderer: the page's own renderer still makes the chip.
    svc.setAnswerRenderer(null);
    svc.publishAssistantMessage('md2', 'Plain **answer**.\n[[GIST]] Fallback gist here', 'Clarify');
    await sleep(500);
    const fb = await lastCard(`return { gist: n.querySelector('.gist-chip .gist-text')?.textContent || null, text: n.textContent }`);
    check(tag, 'fallback renderer: gist chip too, no marker', fb.gist === 'Fallback gist here' && !fb.text.includes('[[GIST]]'), JSON.stringify(fb));
    svc.setAnswerRenderer(renderPhoneAnswer);

    // Stop, then start: each starts the phone over (the end on a canvas that
    // says the meeting ended), like the overlay.
    svc.publishMeetingState(true);
    svc.publishAssistantMessage('s1', 'Answer from meeting one', 'Recap');
    await sleep(300);
    svc.publishMeetingState(false);
    await sleep(500);
    check(tag, 'stopping clears the phone to a "meeting ended" canvas', (await page.$$('#feedInner > :not(#empty)')).length === 0 && (await page.textContent('#emptyTitle')) === 'Meeting ended');
    const oldStream = String(++streamSeq);
    svc.publishToken(oldStream, 'half of an old answer ');
    await sleep(200);
    svc.publishMeetingState(true);
    await sleep(400);
    check(tag, 'a new meeting clears the phone', (await page.$$('#feedInner > :not(#empty)')).length === 0);
    const toastText = await page.textContent('#toastText');
    check(tag, 'and says so', toastText === 'New meeting', toastText);
    svc.publishToken(oldStream, 'late tokens');
    svc.publishDone(oldStream, 'half of an old answer late tokens');
    await sleep(300);
    check(tag, 'the old session\'s late answer does not land in the new one', (await page.$$('.answer')).length === 0);
    svc.disconnectAllClients(1001, 'reconnect');
    await page.waitForFunction(() => document.getElementById('app').dataset.conn !== 'live', null, { timeout: 3000 });
    await page.waitForFunction(() => document.getElementById('app').dataset.conn === 'live', null, { timeout: 6000 });
    await sleep(400);
    const afterReconnect = await page.$$eval('.answer .answer-body', (ns) => ns.map((n) => n.textContent));
    check(tag, 'reconnecting does not bring the old session back (nor its late answer)', afterReconnect.length === 0, JSON.stringify(afterReconnect));
    check(tag, 'no page errors', errors.length === 0, errors.join(' | '));
  } finally {
    svc.setAnswerRenderer(renderPhoneAnswer);
    svc.publishMeetingState(false);
    await ctx.close();
    await browser.close();
  }
}

const only = args.only;
for (const dev of DEVICES) {
  if (only && !dev.name.includes(only)) continue;
  for (const scheme of args.scheme ? [args.scheme] : ['dark', 'light']) {
    try { await scenario(dev, scheme); }
    catch (e) { check(`${dev.name}/${scheme}`, 'scenario threw', false, e.message.split('\n')[0]); }
  }
}
if (!only || only === 'meeting') {
  for (const dev of [DEVICES[0], DEVICES[1], DEVICES[3], DEVICES[5]]) {
    for (const scheme of args.scheme ? [args.scheme] : ['dark', 'light']) {
      try { await meetingStateScenario(dev, scheme); } catch (e) { check(`${dev.name}/${scheme}/meeting`, 'threw', false, e.message.split('\n')[0]); }
    }
  }
}
if (!only || only === 'retry') {
  for (const dev of [DEVICES[1], DEVICES[3]]) {
    try { await retryScenario(dev); } catch (e) { check(`${dev.name}/retry`, 'threw', false, e.message.split('\n')[0]); }
  }
}
if (!only || only === 'refused') {
  for (const dev of [DEVICES[0], DEVICES[1], DEVICES[2], DEVICES[3], DEVICES[5]]) {
    for (const scheme of args.scheme ? [args.scheme] : ['dark', 'light']) {
      try { await refusedLinkScenario(dev, scheme); } catch (e) { check(`${dev.name}/${scheme}/refused`, 'threw', false, e.message.split('\n')[0]); }
    }
  }
}
if (!only || only === 'tray') {
  for (const dev of DEVICES) {
    for (const scheme of args.scheme ? [args.scheme] : ['dark', 'light']) {
      try { await trayScenario(dev, scheme); } catch (e) { check(`${dev.name}/${scheme}/tray`, 'threw', false, e.message.split('\n')[0]); }
    }
  }
}
if (!only || only === 'markdown') {
  for (const dev of [DEVICES[1], DEVICES[3]]) {
    try { await markdownAndSessionScenarios(dev); } catch (e) { check(`${dev.name}/markdown`, 'threw', false, e.message.split('\n')[0]); }
  }
}
if (!only || only === 'images') {
  for (const dev of [DEVICES[1], DEVICES[3]]) {
    try { await imageScenarios(dev); } catch (e) { check(`${dev.name}/images`, 'threw', false, e.message.split('\n')[0]); }
  }
}
if (!only || only === 'timeouts') {
  try { await timeoutScenarios(); } catch (e) { check('timeouts', 'threw', false, e.message.split('\n')[0]); }
}
if (!only || only === 'token') {
  try { await tokenScenarios(); } catch (e) { check('token', 'threw', false, e.message.split('\n')[0]); }
}
await svc.stop({ persist: false });
fs.rmSync(userDataDir, { recursive: true, force: true });
fs.rmSync(bundleDir, { recursive: true, force: true });
console.log(`\n${failures.length ? failures.length + ' FAILED' : 'ALL PASSED'}`);
process.exit(failures.length ? 1 : 0);
