// Screen recording of real model answers playing in the REAL overlay.
//
//   node tests/diagram/live-record.mjs [--in=<dir with live-answers.json>] --out=<dir> [--ids=L2.1,L2.2,…]
//
// What the video is: the overlay component (NativelyInterface, headless
// Chromium, electronAPI stubbed) receiving token streams that were recorded
// from a real model by live-deepseek.cjs, at the speed the model produced them,
// including the real wait before its first token. It is NOT a capture of the
// Electron app window, and no model is called while recording.
//
// The strip at the bottom (the question, a stopwatch, the note) is added by
// this script so a viewer can follow along; it is not part of the product.
import { readFileSync, existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startOverlayHarness } from './overlayHarness.mjs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).slice(k.length + 3);
const IN_DIR = resolve(arg('in', join(tmpdir(), 'natively-diagram-live')));
const OUT_DIR = resolve(arg('out', join(tmpdir(), 'natively-diagram-live', 'video')));
const IDS = arg('ids', 'L2.1,L2.2,L2.3,L2.4,L3,L5,L9,C1').split(',');
const file = join(IN_DIR, 'live-answers.json');
if (!existsSync(file)) {
  console.log(`skipped: no ${file} (run live-deepseek.cjs first)`);
  process.exit(0);
}
mkdirSync(OUT_DIR, { recursive: true });
const recording = JSON.parse(readFileSync(file, 'utf8'));
const records = IDS.map((id) => recording.records.find((r) => r.id === id)).filter((r) => r && r.tokens.length);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The caption strip: who asked what, how long it has been, and what this recording is. */
function installCaption(model) {
  // A dark desk for the glass overlay to sit on (the app paints no page background).
  const backdrop = document.createElement('style');
  backdrop.textContent = 'html, body { background: #15161a !important; }';
  document.head.appendChild(backdrop);
  const strip = document.createElement('div');
  strip.id = 'rec-caption';
  strip.style.cssText = 'position:fixed;left:20px;right:20px;bottom:14px;z-index:2147483647;font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e7e9ee;pointer-events:none;';
  strip.innerHTML = [
    '<div style="display:flex;gap:10px;align-items:baseline;">',
    '<span id="rec-kind" style="font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#9aa1ad;white-space:nowrap;"></span>',
    '<span id="rec-clock" style="margin-left:auto;font:600 13px ui-monospace,SFMono-Regular,Menlo,monospace;color:#c9ced8;white-space:nowrap;"></span>',
    '</div>',
    '<div id="rec-question" style="margin-top:3px;font-size:15px;font-weight:600;"></div>',
    `<div style="margin-top:5px;font-size:11px;color:#8b919c;">Real ${model} answer, recorded live and replayed at the speed it arrived. Overlay component in a test browser, not the app window.</div>`,
  ].join('');
  document.body.appendChild(strip);
  window.__rec = {
    timer: null,
    set(kind, question) {
      document.getElementById('rec-kind').textContent = kind;
      document.getElementById('rec-question').textContent = question;
      document.getElementById('rec-clock').textContent = '';
    },
    start() {
      const t0 = performance.now();
      const clock = document.getElementById('rec-clock');
      clearInterval(window.__rec.timer);
      window.__rec.timer = setInterval(() => { clock.textContent = `${((performance.now() - t0) / 1000).toFixed(1)} s`; }, 50);
    },
    stop(note) {
      clearInterval(window.__rec.timer);
      const clock = document.getElementById('rec-clock');
      clock.textContent = `${clock.textContent}${note ? ` · ${note}` : ''}`;
    },
  };
}

/** Ask → wait the model's real time to first token → stream at its real pace → settle. */
async function play(page, record) {
  const kind = { create: 'They ask', update: 'Follow-up', explain: 'Follow-up', view: 'Follow-up', refine: 'You press Shorten', control: 'They ask' }[record.label] || 'They ask';
  await page.evaluate(({ kind, question }) => window.__rec.set(kind, question), { kind, question: record.route === 'refine' ? 'Shorten' : record.question });
  await sleep(900);
  return page.evaluate(
    async ({ tokens, answer, refine }) => {
      for (const row of document.querySelectorAll('.ai-response-card')) row.setAttribute('data-rec-seen', '1');
      window.__rec.start();
      const t0 = performance.now();
      const tokenEvent = refine ? 'onIntelligenceRefinedAnswerToken' : 'onIntelligenceSuggestedAnswerToken';
      for (const [ms, text] of tokens) {
        // `ms` is measured from the question, so the first wait is the model's real time to first token.
        const wait = ms - (performance.now() - t0);
        if (wait > 1) await new Promise((r) => setTimeout(r, wait));
        window.__emit(tokenEvent, refine ? { intent: 'shorten', token: text } : { token: text });
      }
      if (refine) window.__emit('onIntelligenceRefinedAnswer', { intent: 'shorten', answer });
      else window.__emit('onIntelligenceSuggestedAnswer', { answer });
      // Until the paced reveal has finished and any diagram has settled.
      const deadline = performance.now() + 20_000;
      let drawnAt = null;
      while (performance.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
        const cards = [...document.querySelectorAll('.ai-response-card:not([data-rec-seen]) figure.diagram-card')];
        const last = cards[cards.length - 1];
        const streaming = document.querySelectorAll('.natively-streaming-answer').length;
        const settled = cards.every((c) => ['ready', 'error', 'cut-off'].includes(c.getAttribute('data-diagram-state')));
        if (drawnAt === null && last && last.getAttribute('data-diagram-state') === 'ready') drawnAt = performance.now() - t0;
        const log = typeof window.__nativelyDiagramTimings === 'function' ? window.__nativelyDiagramTimings() : [];
        const latest = Array.isArray(log) && log.length ? log[log.length - 1] : null;
        if (streaming === 0 && settled && (!latest || latest.answerCompleteMs !== null)) break;
      }
      window.__rec.stop('done');
      return { totalMs: Math.round(performance.now() - t0), drawnAt: drawnAt === null ? null : Math.round(drawnAt) };
    },
    { tokens: record.tokens, answer: record.answer, refine: record.route === 'refine' },
  );
}

async function main() {
  const harness = await startOverlayHarness();
  let videoPath = '';
  try {
    const opened = Date.now();
    const overlay = await harness.openOverlay({ recordVideoDir: OUT_DIR, width: 760, height: 940, model: recording.model });
    const { page } = overlay;
    await page.evaluate(installCaption, recording.model);
    // The recording starts with the page still loading; say how much to cut.
    console.log(`trim_start_seconds=${((Date.now() - opened) / 1000 + 0.3).toFixed(1)}`);
    await sleep(1000);
    for (let i = 0; i < records.length; i += 1) {
      const record = records[i];
      const r = await play(page, record);
      // Only the total is reported: the draw is not sampled while tokens are being sent.
      console.log(`${record.id.padEnd(6)} ${record.label.padEnd(8)} played in ${r.totalMs} ms`);
      await sleep(2600);
      // Once, on the first diagram: the card's own controls.
      if (i === 0) {
        const card = page.locator('figure.diagram-card').last();
        await card.getByRole('tab', { name: 'Source' }).click();
        await sleep(1800);
        await card.getByRole('tab', { name: 'Diagram' }).click();
        await sleep(900);
        await card.getByRole('button', { name: 'Zoom in' }).click();
        await sleep(500);
        await card.getByRole('button', { name: 'Zoom in' }).click();
        await sleep(1300);
        await card.getByRole('button', { name: 'Fit to card' }).click();
        await sleep(1200);
      }
    }
    await sleep(800);
    const video = page.video();
    await overlay.context.close(); // flushes the recording
    if (video) videoPath = await video.path();
  } finally {
    await harness.close();
  }
  if (videoPath && existsSync(videoPath)) {
    const final = join(OUT_DIR, 'diagram-live.webm');
    renameSync(videoPath, final);
    console.log(`video: ${final}`);
  } else {
    console.log(`no video file was produced (looked in ${OUT_DIR}: ${readdirSync(OUT_DIR).join(', ')})`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('recording crashed:', err);
  process.exit(2);
});
