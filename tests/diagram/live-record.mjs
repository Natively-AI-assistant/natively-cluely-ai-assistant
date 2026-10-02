// Screen recording of real model answers playing in the REAL overlay.
//
//   node tests/diagram/live-record.mjs [--in=<dir with live-answers.json>] --out=<dir> [--ids=L2.1,L2.2,…]
//   node tests/diagram/live-record.mjs [--in=…] --out=<dir> --plan=catalog
//
// `--plan=catalog` records the nine-mode catalog: one clip per mode (a fresh
// overlay each, so every mode starts with an empty conversation), written as
// clip-NN-<mode>.webm with a clips.json that says how much page-load to trim
// from the start of each. Joining the clips is left to the caller.
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
const PLAN = arg('plan', '');

// The catalog plan: which recorded turns play in which mode's clip, and the
// card controls shown once after a turn (`after`).
const MODE_NAMES = {
  general: 'General', 'looking-for-work': 'Looking for work', 'technical-interview': 'Technical Interview', sales: 'Sales',
  recruiting: 'Recruiting', 'team-meet': 'Team Meet', lecture: 'Lecture', seminar: 'Seminar', 'call-center': 'Call Center',
};
const CATALOG_PLAN = [
  { mode: 'sales', ids: ['M1.1', 'M1.2', 'M1.3', 'M1.4', 'M2', 'M3', 'M4'], after: { 'M1.1': 'data-tab' } },
  { mode: 'technical-interview', ids: ['M5', 'M6', 'L8', 'C1'], after: { M5: 'zoom' } },
  { mode: 'lecture', ids: ['M7', 'M8', 'N3'], after: { M7: 'source-tab' } },
  { mode: 'call-center', ids: ['M9', 'N2'] },
  { mode: 'recruiting', ids: ['M10'] },
  { mode: 'looking-for-work', ids: ['M11'] },
  { mode: 'team-meet', ids: ['M12', 'M16'] },
  { mode: 'general', ids: ['M13', 'M15'] },
  { mode: 'seminar', ids: ['M14'] },
];
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
    '<div id="rec-earlier" style="margin-top:3px;font-size:12px;color:#aab0bb;display:none;"></div>',
    '<div id="rec-question" style="margin-top:3px;font-size:15px;font-weight:600;"></div>',
    `<div style="margin-top:5px;font-size:11px;color:#8b919c;">Real ${model} answer, recorded live and replayed at the speed it arrived. Overlay component in a test browser, not the app window.</div>`,
  ].join('');
  document.body.appendChild(strip);
  window.__rec = {
    timer: null,
    set(kind, question, earlier) {
      document.getElementById('rec-kind').textContent = kind;
      document.getElementById('rec-question').textContent = question;
      document.getElementById('rec-clock').textContent = '';
      const said = document.getElementById('rec-earlier');
      said.textContent = earlier ? `Said earlier in the meeting: ${earlier}` : '';
      said.style.display = earlier ? 'block' : 'none';
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
async function play(page, record, modeName = '') {
  const what = { create: 'They ask', update: 'Follow-up', explain: 'Follow-up', view: 'Follow-up', refine: 'You press Shorten', control: 'They ask' }[record.label] || 'Question';
  const kind = modeName ? `${modeName} mode · ${what}` : what;
  const earlier = Array.isArray(record.seed) && record.seed.length ? record.seed.map((line) => `“${line}”`).join(' ') : '';
  await page.evaluate(({ kind, question, earlier }) => window.__rec.set(kind, question, earlier), { kind, question: record.route === 'refine' ? 'Shorten' : record.question, earlier });
  // Long enough to read what was said before the question.
  await sleep(earlier ? 900 + Math.min(2600, earlier.length * 22) : 900);
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

/** The card's own controls, shown once after a turn. */
async function showControls(page, which) {
  const card = page.locator('figure.diagram-card').last();
  if (which === 'data-tab' || which === 'source-tab') {
    await card.getByRole('tab', { name: which === 'data-tab' ? 'Data' : 'Source' }).click();
    await sleep(2600);
    await card.getByRole('tab', { name: which === 'data-tab' ? 'Chart' : 'Diagram' }).click();
    await sleep(900);
  } else if (which === 'zoom') {
    await card.getByRole('button', { name: 'Zoom in' }).click();
    await sleep(500);
    await card.getByRole('button', { name: 'Zoom in' }).click();
    await sleep(1800);
    await card.getByRole('button', { name: 'Fit to card' }).click();
    await sleep(1000);
  }
}

/** One clip per mode, each in a fresh overlay. */
async function recordCatalog() {
  const { writeFileSync } = await import('node:fs');
  const harness = await startOverlayHarness();
  const clips = [];
  try {
    for (let g = 0; g < CATALOG_PLAN.length; g += 1) {
      const group = CATALOG_PLAN[g];
      const turns = group.ids.map((id) => recording.records.find((r) => r.id === id)).filter((r) => r && r.tokens.length);
      if (!turns.length) continue;
      const dir = join(OUT_DIR, `raw-${String(g + 1).padStart(2, '0')}`);
      mkdirSync(dir, { recursive: true });
      const opened = Date.now();
      const overlay = await harness.openOverlay({ recordVideoDir: dir, width: 760, height: 940, model: recording.model });
      const { page } = overlay;
      await page.evaluate(installCaption, recording.model);
      const trim = (Date.now() - opened) / 1000 + 0.3;
      await sleep(500);
      for (const record of turns) {
        const r = await play(page, record, MODE_NAMES[group.mode] || group.mode);
        console.log(`${group.mode.padEnd(20)} ${record.id.padEnd(6)} ${String(record.label).padEnd(12)} played in ${r.totalMs} ms`);
        await sleep(2400);
        if (group.after && group.after[record.id]) await showControls(page, group.after[record.id]);
      }
      await sleep(600);
      const video = page.video();
      await overlay.context.close();
      const from = video ? await video.path() : '';
      if (!from || !existsSync(from)) throw new Error(`no video for ${group.mode}`);
      const name = `clip-${String(g + 1).padStart(2, '0')}-${group.mode}.webm`;
      renameSync(from, join(OUT_DIR, name));
      clips.push({ file: name, mode: group.mode, trimStartSeconds: Number(trim.toFixed(1)), turns: turns.map((t) => t.id) });
    }
  } finally {
    await harness.close();
  }
  writeFileSync(join(OUT_DIR, 'clips.json'), JSON.stringify(clips, null, 1));
  console.log(`clips: ${join(OUT_DIR, 'clips.json')}`);
}

async function main() {
  if (PLAN === 'catalog') return recordCatalog();
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
