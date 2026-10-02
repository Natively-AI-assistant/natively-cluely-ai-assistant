// Replays answers recorded from a REAL model (live-deepseek.cjs) through the
// REAL overlay, with the token timing the model actually had.
//
//   node tests/diagram/live-replay.check.mjs [--in=<dir with live-answers.json>] [--shots=<dir>]
//   (npm run test:diagram:live runs the recording and this replay back to back)
//
// The recording is what the engine emitted to the overlay: every token and the
// millisecond it arrived. This check feeds exactly that to the mounted overlay
// (headless Chromium, electronAPI stubbed) and reports, per answer:
//   - whether every Mermaid block the model wrote was DRAWN by the pinned
//     Mermaid (the one thing the main process cannot know);
//   - whether a repair was requested (it must not be, for a block that draws);
//   - when the card became visible relative to the model's stream: after its
//     closing fence arrived, and how long before the answer finished;
//   - that controls (code, concept, behavioural) show no diagram card.
//
// It makes no model call. It fails when a recorded diagram does not draw.
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { snapshot, startOverlayHarness } from './overlayHarness.mjs';
import { isPlaceholderDiagram } from '../../src/lib/diagram/diagramPolicy.mjs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).slice(k.length + 3);
// Default: where live-deepseek.cjs writes when it is given no --out.
const IN_DIR = resolve(arg('in', join(tmpdir(), 'natively-diagram-live')));
const SHOTS = arg('shots', '');
const file = join(IN_DIR, 'live-answers.json');
if (!existsSync(file)) {
  console.log(`skipped: no ${file} (run live-deepseek.cjs first)`);
  process.exit(0);
}
if (SHOTS) mkdirSync(resolve(SHOTS), { recursive: true });
const recording = JSON.parse(readFileSync(file, 'utf8'));

const failures = [];
function check(name, condition, detail = '') {
  if (condition) console.log(`  ok   ${name}`);
  else {
    console.log(`  FAIL ${name}${detail ? ` — ${String(detail).slice(0, 500)}` : ''}`);
    failures.push(name);
  }
}

/** Stream recorded tokens at their recorded times; sample the overlay throughout. */
async function replay(page, record) {
  return page.evaluate(
    async ({ tokens, answer, refine, tail, snapshotSrc }) => {
      const snap = new Function(`return (${snapshotSrc})()`);
      // Rows already on screen are marked, so "this answer's row" is the newest
      // unmarked one however the overlay swaps its streaming row for the sealed one.
      for (const row of document.querySelectorAll('.ai-response-card')) row.setAttribute('data-replay-seen', '1');
      const repairsBefore = (window.__calls || []).filter((c) => c === 'repairDiagram').length;
      const lastRow = () => {
        const rows = [...document.querySelectorAll('.ai-response-card:not([data-replay-seen])')];
        return rows.length ? rows[rows.length - 1] : null;
      };
      const rowState = () => {
        const row = lastRow();
        const cards = row ? [...row.querySelectorAll('figure.diagram-card')] : [];
        return {
          cards: cards.length,
          states: cards.map((c) => c.getAttribute('data-diagram-state')),
          drawn: cards.filter((c) => { const img = c.querySelector('img.diagram-card__img'); return Boolean(img && img.complete && img.naturalWidth > 0); }).length,
          codeCards: row ? row.querySelectorAll('.overlay-code-block-surface:not(.diagram-card)').length : 0,
          // How large the drawing is shown relative to its natural size (1 = full size).
          scales: cards.map((c) => { const img = c.querySelector('img.diagram-card__img'); return img && img.naturalWidth ? Math.round((img.getBoundingClientRect().width / img.naturalWidth) * 100) / 100 : null; }),
          sizes: cards.map((c) => { const img = c.querySelector('img.diagram-card__img'); return img ? `${img.naturalWidth}x${img.naturalHeight}` : null; }),
          text: row ? row.innerText : '',
        };
      };
      const t0 = performance.now();
      const marks = { firstText: null, cardDrawn: null, streamEnd: null, sealed: null };
      const sample = () => {
        const s = rowState();
        const now = performance.now() - t0;
        if (marks.firstText === null && s.text.trim().length > 0) marks.firstText = now;
        if (marks.cardDrawn === null && s.drawn > 0) marks.cardDrawn = now;
      };
      const timer = setInterval(sample, 16);
      const tokenEvent = refine ? 'onIntelligenceRefinedAnswerToken' : 'onIntelligenceSuggestedAnswerToken';
      const base = tokens.length ? tokens[0][0] : 0;
      for (const [ms, text] of tokens) {
        const wait = ms - base - (performance.now() - t0);
        if (wait > 1) await new Promise((r) => setTimeout(r, wait));
        window.__emit(tokenEvent, refine ? { intent: 'shorten', token: text } : { token: text });
      }
      marks.streamEnd = performance.now() - t0;
      if (refine) window.__emit('onIntelligenceRefinedAnswer', { intent: 'shorten', answer });
      else window.__emit('onIntelligenceSuggestedAnswer', { answer });
      const deadline = performance.now() + 20_000;
      while (performance.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
        sample();
        const s = rowState();
        const streaming = document.querySelectorAll('.natively-streaming-answer').length;
        const settled = s.states.every((st) => st === 'ready' || st === 'error' || st === 'cut-off');
        const log = typeof window.__nativelyDiagramTimings === 'function' ? window.__nativelyDiagramTimings() : [];
        const latest = Array.isArray(log) && log.length ? log[log.length - 1] : null;
        const sealed = !latest || latest.answerCompleteMs !== null;
        if (streaming === 0 && settled && sealed && s.text.replace(/\s+/g, ' ').includes(tail)) break;
      }
      marks.sealed = performance.now() - t0;
      await new Promise((r) => setTimeout(r, 300));
      clearInterval(timer);
      const final = rowState();
      const page = snap();
      return {
        marks,
        final,
        scrollX: page.scrollX,
        repairs: (window.__calls || []).filter((c) => c === 'repairDiagram').length - repairsBefore,
        errorText: [...(lastRow()?.querySelectorAll('figure.diagram-card[data-diagram-state="error"]') || [])].map((n) => n.innerText.slice(0, 200)),
      };
    },
    {
      tokens: record.tokens,
      answer: record.answer,
      refine: record.route === 'refine',
      // The answer's last plain words: on screen only once the paced reveal has finished.
      tail: (record.answer.replace(/```[\s\S]*?```/g, ' ').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim().match(/[A-Za-z][A-Za-z ,']{10,40}[A-Za-z]\W*$/) || [''])[0].replace(/\W+$/, '').slice(-24),
      snapshotSrc: snapshot.toString(),
    },
  );
}

async function main() {
  const harness = await startOverlayHarness();
  const rows = [];
  try {
    console.log(`replaying ${recording.records.length} recorded turn(s) · model ${recording.model} · recorded ${recording.at}`);
    let overlay = null;
    let scenario = null;
    for (const record of recording.records) {
      // One overlay per scenario: follow-ups land in the same conversation.
      if (record.scenario !== scenario) {
        if (overlay) await overlay.context.close();
        overlay = await harness.openOverlay();
        scenario = record.scenario;
      }
      console.log(`\n${record.id} [${record.route}:${record.label}] ${JSON.stringify(record.question.slice(0, 72))}`);
      if (!record.tokens.length) {
        console.log('  (no token stream recorded for this route — skipped)');
        continue;
      }
      // What should be on screen: every Mermaid block that is more than a
      // placeholder and every chart or notation block that passed its own
      // checks, drawn; a refused chart as a card that says what it needs.
      const mermaid = record.analysis.mermaidBlocks.filter((b) => !isPlaceholderDiagram(b.source));
      const payloads = record.analysis.payloadBlocks || [];
      const refused = payloads.filter((b) => !b.ok).length;
      const expected = mermaid.length + payloads.length - refused;
      const r = await replay(overlay.page, record);
      const tokenBase = record.tokens[0][0];
      const fenceAt = record.analysis.diagramCompleteMs === null ? null : record.analysis.diagramCompleteMs - tokenBase;
      if (refused > 0) check(`${refused} refused chart(s) shown as a card with the reason, not drawn`, r.final.cards === expected + refused && r.final.states.filter((st) => st === 'error').length === refused && r.errorText.every((t) => /needs|does not say|could not/i.test(t)), JSON.stringify({ ...r.final, text: undefined, errorText: r.errorText }));
      if (expected > 0) {
        check(`${expected} visual card(s), all drawn`, r.final.cards === expected + refused && r.final.drawn === expected, JSON.stringify({ ...r.final, text: undefined, errorText: r.errorText }));
        check('no repair was needed', r.repairs === 0, `repairs=${r.repairs}`);
        // Not asserted against the END of the stream: a fast model finishes the
        // whole answer within a second or two of its first token, so "before the
        // stream ended" is a property of the model's speed, not of the overlay.
        // The table below reports both; what is asserted is a bound on the wait
        // after the block's closing fence arrived.
        const afterFence = fenceAt === null || r.marks.cardDrawn === null ? null : r.marks.cardDrawn - fenceAt;
        check('drawn within 2.5 s of its closing fence arriving', r.marks.cardDrawn !== null && (afterFence === null || afterFence < 2500), JSON.stringify({ afterFence, ...r.marks }));
        check('no raw fence or payload on screen', !/```|"compute"\s*:|"kind"\s*:\s*"(?:chen-er|automaton)"/.test(r.final.text));
      } else if (refused === 0) {
        check('no diagram card', r.final.cards === 0, JSON.stringify({ ...r.final, text: undefined }));
      }
      if (record.verdict) check(`live verdict: ${record.verdict.note.slice(0, 90)}`, record.verdict.pass === true, record.verdict.note);
      if (record.analysis.codeBlocks.length) check('the code block is still a code card', r.final.codeCards >= 1, `codeCards=${r.final.codeCards}`);
      check('the overlay does not scroll sideways', r.scrollX <= 0, `scrollX=${r.scrollX}`);
      check('no page errors', overlay.errors.length === 0, overlay.errors.join(' | '));
      rows.push({
        id: record.id,
        label: record.label,
        type: [...mermaid.map((b) => b.type), ...payloads.map((b) => (b.ok ? String(b.label).toLowerCase() : 'refused'))].join('+') || '—',
        firstTokenMs: record.analysis.firstTokenMs,
        fenceToDrawnMs: fenceAt === null || r.marks.cardDrawn === null ? null : Math.round(r.marks.cardDrawn - fenceAt),
        beforeStreamEnd: r.marks.cardDrawn !== null && r.marks.cardDrawn < r.marks.streamEnd,
        drawnAtMs: r.marks.cardDrawn === null ? null : Math.round(tokenBase + r.marks.cardDrawn),
        answerDoneMs: record.totalMs,
        drawn: r.final.drawn,
        expected,
        scale: r.final.scales.join('+') || '—',
        size: r.final.sizes.join('+') || '—',
      });
      if (SHOTS) await overlay.page.screenshot({ path: join(resolve(SHOTS), `live-${record.id}.png`), fullPage: true });
    }
    if (overlay) await overlay.context.close();
  } finally {
    await harness.close();
  }

  console.log('\nid      kind      diagram     first token   diagram on screen   answer done   fence→drawn   natural size   shown at');
  for (const r of rows) {
    const ms = (v) => (v === null || v === undefined ? '—' : `${v} ms`);
    console.log(`${r.id.padEnd(7)} ${String(r.label).padEnd(9)} ${String(r.type).padEnd(11)} ${ms(r.firstTokenMs).padEnd(13)} ${ms(r.drawnAtMs).padEnd(19)} ${ms(r.answerDoneMs).padEnd(13)} ${ms(r.fenceToDrawnMs).padEnd(13)} ${String(r.size).padEnd(14)} ${r.scale}`);
  }
  console.log('(fence→drawn is negative on an update: the previous version of the design stays on screen until the new one has drawn.)');
  console.log('(first token and answer done: measured live against the model. diagram on screen: the live stream replayed into the overlay in headless Chromium, so the draw time is this machine\'s, not the app window\'s.)');
  if (failures.length) {
    console.log(`\n${failures.length} check(s) failed.`);
    process.exit(1);
  }
  const drawnRows = rows.filter((r) => r.drawn > 0 && r.fenceToDrawnMs !== null && r.fenceToDrawnMs >= 0);
  const pct = (list, p) => { const sorted = [...list].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] : null; };
  console.log(`\nfence→drawn over ${drawnRows.length} first drawings: p50 ${pct(drawnRows.map((r) => r.fenceToDrawnMs), 0.5)} ms · p95 ${pct(drawnRows.map((r) => r.fenceToDrawnMs), 0.95)} ms`);
  console.log(`visual on screen (from the question): p50 ${pct(drawnRows.map((r) => r.drawnAtMs), 0.5)} ms · p95 ${pct(drawnRows.map((r) => r.drawnAtMs), 0.95)} ms`);
  console.log('\nAll recorded live visuals were drawn.');
}

main().catch((err) => {
  console.error('live replay crashed:', err);
  process.exit(2);
});
