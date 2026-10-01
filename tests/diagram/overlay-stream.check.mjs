// Real-overlay check for diagram answers.
//
// Mounts the REAL overlay (src/components/NativelyInterface.tsx, via the app's
// own index.html?window=overlay) in headless Chromium, with `window.electronAPI`
// replaced by a stub, and feeds it the same events the main process sends while
// an answer streams. No Electron app is launched and no model is called: the
// "provider" here is a list of chunks.
//
// What it proves about the live overlay path (token queue → paced reveal →
// React-owned card → finalize), which no unit test can:
//   1. text starts first, the diagram card appears and is DRAWN while the
//      answer is still streaming, and the rest of the answer keeps arriving;
//   2. the diagram is not held back by the paced reveal of its own source
//      (receipt → visible, measured), and prose order is preserved;
//   3. the finished row holds the answer exactly once — no duplicated text at
//      the imperative → React handoff, no raw ```mermaid left on screen;
//   4. an authoritative final text that differs from the stream replaces it
//      without duplicating or remounting the diagram;
//   5. a refinement stream (an intent outside the code card's whitelist) gets
//      the same card;
//   6. a discarded stream leaves nothing behind; an answer cut off inside the
//      block shows the cut-off fallback, never a spinner;
//   7. code answers are untouched, and a mixed answer shows both cards;
//   8. with the feature switched off a Mermaid block is an ordinary code card;
//   9. the card never makes the overlay scroll sideways.
//
// Run: npm run test:diagram:overlay   (needs Playwright's chromium)
import { join } from 'node:path';
import { snapshot, startOverlayHarness } from './overlayHarness.mjs';

const ROOT = process.cwd();
const fence = (src, tag = 'mermaid') => '```' + tag + '\n' + src + '\n```';
const NOTIFY = [
  'flowchart LR',
  '    producer["Producer Service"] -->|"enqueue"| queue["Notification Queue"]',
  '    queue --> worker["Delivery Worker"]',
  '    worker -->|"send"| provider["Email / SMS Provider"]',
  '    worker -->|"record"| log[("Delivery Log")]',
].join('\n');
const LEAD = "I'd put a queue between producers and delivery, assuming at-least-once sends with an idempotency key.";
const TAIL = 'Producers only enqueue. The worker owns delivery and records every attempt, so a slow provider never blocks a producer. The tradeoff is duplicate sends under retry, which the idempotency key absorbs. Retries go through a delayed queue with backoff, and anything that keeps failing lands in a dead-letter queue where it can be inspected and replayed by hand once the provider recovers.';
const DESIGN_ANSWER = `${LEAD}\n\n${fence(NOTIFY)}\n\n${TAIL}`;
const CODE_ANSWER = 'Use a hash map for one pass.\n\n```python\ndef two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i\n```\n\nTime O(n), space O(n).';
const MIXED_ANSWER = `Idempotent at the edge.\n\n${fence('flowchart LR\n    client["Client"] --> api["Payment API"]\n    api --> store[("Idempotency Store")]')}\n\nThen the handler:\n\n\`\`\`ts\nexport async function handle(key: string) {\n  return key;\n}\n\`\`\`\n\nDone.`;

const failures = [];
const notes = [];
function check(name, condition, detail = '') {
  if (condition) console.log(`  ok   ${name}`);
  else {
    console.log(`  FAIL ${name}${detail ? ` — ${String(detail).slice(0, 600)}` : ''}`);
    failures.push(name);
  }
}

async function main() {
  const harness = await startOverlayHarness({ root: ROOT });
  const { openOverlay } = harness;

  /**
   * Stream `text` as What-to-Answer tokens, `chunk` chars every `gapMs`,
   * sampling the screen as it goes. Stops early at `stopAt` chars.
   */
  async function streamWta(page, text, { chunk = 6, gapMs = 6, stopAt = text.length, finalize = true, finalText = text } = {}) {
    return page.evaluate(
      async ({ text, chunk, gapMs, stopAt, finalize, finalText, snapshotSrc }) => {
        const snap = new Function(`return (${snapshotSrc})()`);
        const t0 = performance.now();
        const marks = { firstText: null, cardAppeared: null, cardReady: null, cardReadyAtChars: null, blockReceivedAt: null, streamEnd: null, ordered: true };
        const blockEnd = text.indexOf('```\n', text.indexOf('```mermaid') + 10) + 4;
        let sent = 0;
        const sample = () => {
          const s = snap();
          const now = performance.now() - t0;
          if (marks.firstText === null && s.text.trim().length > 0) marks.firstText = now;
          // The width the lead sentence wraps at, while it is the only thing in the row.
          if (s.diagramCards === 0 && s.text.trim().length > 60) {
            const rows = document.querySelectorAll('.ai-response-card');
            const row = rows[rows.length - 1];
            if (row && !row.querySelector('.diagram-answer-parts')) marks.leadWidthBefore = Math.round(row.getBoundingClientRect().width);
          }
          if (marks.cardAppeared === null && s.diagramCards > 0) marks.cardAppeared = now;
          if (marks.cardReady === null && s.imgLoaded) {
            marks.cardReady = now;
            marks.cardReadyAtChars = sent;
          }
          return s;
        };
        const timer = setInterval(sample, 8);
        while (sent < stopAt) {
          const piece = text.slice(sent, Math.min(stopAt, sent + chunk));
          sent += piece.length;
          window.__emit('onIntelligenceSuggestedAnswerToken', { token: piece });
          if (marks.blockReceivedAt === null && blockEnd > 4 && sent >= blockEnd) marks.blockReceivedAt = performance.now() - t0;
          await new Promise((r) => setTimeout(r, gapMs));
        }
        marks.streamEnd = performance.now() - t0;
        if (finalize) window.__emit('onIntelligenceSuggestedAnswer', { answer: finalText });
        // Let the paced reveal drain and the row seal.
        const deadline = performance.now() + 15_000;
        let last = sample();
        while (performance.now() < deadline) {
          await new Promise((r) => setTimeout(r, 50));
          last = sample();
          const streamingRows = document.querySelectorAll('.natively-streaming-answer').length;
          // Sealed = the row is committed AND the completion mark exists. On a
          // loaded machine the seal lands well after the last token; sampling on
          // the DOM alone raced it (the completion mark was still null).
          const log = typeof window.__nativelyDiagramTimings === 'function' ? window.__nativelyDiagramTimings() : [];
          const latest = Array.isArray(log) && log.length ? log[log.length - 1] : null;
          const sealed = !latest || latest.answerCompleteMs !== null;
          if (finalize && sealed && streamingRows === 0 && (last.diagramCards === 0 || last.diagramState !== 'generating')) break;
          if (!finalize) break;
        }
        await new Promise((r) => setTimeout(r, 400));
        clearInterval(timer);
        const partsList = document.querySelectorAll('.diagram-answer-parts');
        const parts = partsList[partsList.length - 1];
        if (parts) {
          const prose = parts.querySelector(':scope > .markdown-content');
          const card = parts.querySelector(':scope > figure.diagram-card');
          marks.rowWidth = Math.round(parts.getBoundingClientRect().width);
          marks.leadWidthAfter = prose ? Math.round(prose.getBoundingClientRect().width) : null;
          marks.cardWidth = card ? Math.round(card.getBoundingClientRect().width) : null;
          marks.listWidth = Math.round((parts.closest('[data-code-msg]') || parts).getBoundingClientRect().width);
        }
        return { marks, final: sample(), timings: typeof window.__nativelyDiagramTimings === 'function' ? window.__nativelyDiagramTimings() : null };
      },
      { text, chunk, gapMs, stopAt, finalize, finalText, snapshotSrc: snapshot.toString() },
    );
  }

  try {
    // ── 1–3. a design answer through the What-to-Answer stream ──────────────
    console.log('design answer, streamed');
    let o = await openOverlay();
    let r = await streamWta(o.page, DESIGN_ANSWER);
    check('the overlay rendered an answer row', r.final.answerRows >= 1, JSON.stringify(r.final));
    check('text is on screen before the diagram', r.marks.firstText !== null && r.marks.cardAppeared !== null && r.marks.firstText < r.marks.cardAppeared, JSON.stringify(r.marks));
    check('the diagram is DRAWN while the answer is still streaming', r.marks.cardReady !== null && r.marks.cardReady < r.marks.streamEnd && r.marks.cardReadyAtChars < DESIGN_ANSWER.length, JSON.stringify(r.marks));
    const receiptToVisible = r.marks.cardReady !== null && r.marks.blockReceivedAt !== null ? r.marks.cardReady - r.marks.blockReceivedAt : null;
    // Paced, the ~330-char block alone would take ~0.8 s to "type"; fast-forwarded
    // it is one render away.
    check('the diagram is not held back by the paced reveal of its own source (< 600 ms after its last token)', receiptToVisible !== null && receiptToVisible < 600, `receipt→visible ${receiptToVisible} ms`);
    check('exactly one diagram card, drawn, with no spinner left', r.final.diagramCards === 1 && r.final.diagramState === 'ready' && r.final.imgLoaded && r.final.spinnerInCard === 0, JSON.stringify(r.final));
    const count = (hay, needle) => hay.split(needle).length - 1;
    check('the lead sentence appears exactly once (no duplicate at the handoff)', count(r.final.text, 'put a queue between producers') === 1, r.final.text.slice(0, 300));
    check('the closing sentence appears exactly once', count(r.final.text, 'replayed by hand once the provider recovers') === 1, r.final.text.slice(-300));
    // Optional: DIAGRAM_CHECK_SHOTS=<dir> saves the overlay as a person would see it.
    if (process.env.DIAGRAM_CHECK_SHOTS) await o.page.screenshot({ path: join(process.env.DIAGRAM_CHECK_SHOTS, 'overlay-design-answer.png') });
    check('no raw Mermaid fence is left on screen', !r.final.rawFence && !/flowchart LR/.test(r.final.text.replace(/DIAGRAM|SOURCE/gi, '')) , r.final.text.slice(0, 200));
    check('the overlay does not scroll sideways, and the card fits it', r.final.scrollX <= 0 && r.final.cardWidth <= r.final.viewportWidth, JSON.stringify({ scrollX: r.final.scrollX, card: r.final.cardWidth, vw: r.final.viewportWidth }));
    // Found with real model output: at the usual 85% column a real diagram was
    // scaled down until its labels were unreadable. The drawing gets the whole
    // row; the prose keeps its measure, so it does not rewrap when the fence arrives.
    check('the drawing spans the full row', r.marks.cardWidth !== null && r.marks.cardWidth >= r.marks.listWidth - 2, JSON.stringify(r.marks));
    check('the prose keeps the 85% measure beside it', r.marks.leadWidthAfter !== null && Math.abs(r.marks.leadWidthAfter - r.marks.listWidth * 0.85) <= 2, JSON.stringify(r.marks));
    // Before the fence the row shrinks to its text, capped at the same 85%; so
    // "no rewrap" is: the lead never had a wider measure than it has now.
    check('the lead sentence does not rewrap when the diagram arrives', typeof r.marks.leadWidthBefore === 'number' && r.marks.leadWidthBefore <= r.marks.leadWidthAfter + 2, JSON.stringify(r.marks));
    const timing = (r.timings || []).filter((t) => t && t.diagramVisibleMs !== null).pop();
    check('timing marks were recorded: receipt, visible and completion are separate', Boolean(timing) && timing.diagramReceivedMs !== null && timing.diagramVisibleMs >= timing.diagramReceivedMs && timing.answerCompleteMs >= timing.diagramVisibleMs && typeof timing.renderMs === 'number', JSON.stringify(timing));
    check('no uncaught page errors', o.errors.length === 0, o.errors.slice(0, 3).join(' | '));
    if (timing) {
      notes.push(`one streamed design answer (fake provider, ${DESIGN_ANSWER.length} chars at ~1000 chars/s): first text visible ${timing.firstTextVisibleMs} ms, block received ${timing.diagramReceivedMs} ms, diagram visible ${timing.diagramVisibleMs} ms, answer complete ${timing.answerCompleteMs} ms after the first token; Mermaid parse ${timing.parseMs} ms + render ${timing.renderMs} ms (cold load ${timing.coldLoadMs} ms)`);
    }
    notes.push(`receipt → visible, measured from the page: ${Math.round(receiptToVisible)} ms`);

    // ── 4. an authoritative final that differs from the stream ──────────────
    console.log('authoritative final text');
    const REPAIRED = DESIGN_ANSWER.replace('The tradeoff is duplicate sends under retry', 'The cost is duplicate sends under retry');
    r = await streamWta(o.page, DESIGN_ANSWER, { finalText: REPAIRED });
    const rows = await o.page.evaluate(() => [...document.querySelectorAll('.ai-response-card')].map((n) => ({ text: n.innerText, cards: n.querySelectorAll('figure.diagram-card').length })));
    const lastRow = rows[rows.length - 1];
    check('the final text replaces the streamed text', lastRow.text.includes('The cost is duplicate sends') && !lastRow.text.includes('The tradeoff is duplicate sends'), lastRow.text.slice(0, 400));
    check('…once, with one diagram card', count(lastRow.text, 'put a queue between producers') === 1 && lastRow.cards === 1, JSON.stringify({ cards: lastRow.cards }));
    check('each answer keeps its own card (two answers, two cards)', rows.filter((x) => x.cards === 1).length === 2, JSON.stringify(rows.map((x) => x.cards)));
    await o.context.close();

    // ── 5. a refinement stream gets the same card ───────────────────────────
    console.log('refinement stream (intent outside the code-card whitelist)');
    o = await openOverlay();
    const refined = await o.page.evaluate(
      async ({ text, snapshotSrc }) => {
        const snap = new Function(`return (${snapshotSrc})()`);
        let sawCardWhileStreaming = false;
        for (let i = 0; i < text.length; i += 6) {
          window.__emit('onIntelligenceRefinedAnswerToken', { intent: 'shorten', token: text.slice(i, i + 6) });
          await new Promise((r) => setTimeout(r, 6));
          if (snap().imgLoaded) sawCardWhileStreaming = true;
        }
        window.__emit('onIntelligenceRefinedAnswer', { intent: 'shorten', answer: text });
        await new Promise((r) => setTimeout(r, 2500));
        return { sawCardWhileStreaming, final: snap() };
      },
      { text: DESIGN_ANSWER, snapshotSrc: snapshot.toString() },
    );
    check('the card is drawn mid-stream on a "shorten" stream too', refined.sawCardWhileStreaming, JSON.stringify(refined.final));
    check('and the finished row has one drawn card and no raw fence', refined.final.diagramCards === 1 && refined.final.imgLoaded && !refined.final.rawFence, JSON.stringify(refined.final));
    await o.context.close();

    // ── 6. discard and cut-off ──────────────────────────────────────────────
    console.log('discard and cut-off');
    o = await openOverlay();
    const midBlock = DESIGN_ANSWER.indexOf('queue --> worker');
    r = await streamWta(o.page, DESIGN_ANSWER, { stopAt: midBlock, finalize: false });
    check('mid-block the card says it is generating', r.final.diagramCards === 1 && r.final.diagramState === 'generating', JSON.stringify(r.final));
    await o.page.evaluate(() => window.__emit('onIntelligenceSuggestedAnswerDiscard'));
    await o.page.waitForTimeout(600);
    let s = await o.page.evaluate(snapshot);
    check('a discarded stream leaves no card and no spinner behind', s.diagramCards === 0 && s.answerRows === 0, JSON.stringify(s));

    r = await streamWta(o.page, DESIGN_ANSWER, { stopAt: midBlock, finalize: true, finalText: DESIGN_ANSWER.slice(0, midBlock) });
    check('an answer that ended inside the block shows the cut-off fallback', r.final.diagramCards === 1 && r.final.diagramState === 'cut-off' && /cut off before it finished/.test(r.final.text), JSON.stringify({ state: r.final.diagramState, text: r.final.text.slice(-200) }));
    check('…with no spinner', r.final.spinnerInCard === 0, String(r.final.spinnerInCard));
    const repairCalls = await o.page.evaluate(() => window.__calls.filter((c) => c === 'repairDiagram').length);
    check('and no repair request for a cut-off or discarded block', repairCalls === 0, String(repairCalls));
    await o.context.close();

    // ── 7. code answers and mixed answers ───────────────────────────────────
    console.log('code and mixed answers');
    o = await openOverlay();
    r = await streamWta(o.page, CODE_ANSWER);
    check('a code answer is the code card it always was, with no diagram card', r.final.diagramCards === 0 && r.final.codeCards === 1 && /def two_sum/.test(r.final.text), JSON.stringify({ d: r.final.diagramCards, c: r.final.codeCards }));
    r = await streamWta(o.page, MIXED_ANSWER);
    const mixed = await o.page.evaluate(() => {
      const row = [...document.querySelectorAll('.ai-response-card')].pop();
      return { diagrams: row.querySelectorAll('figure.diagram-card').length, code: row.querySelectorAll('.overlay-code-block-surface:not(.diagram-card)').length, text: row.innerText };
    });
    check('a mixed answer shows a diagram card AND a code card', mixed.diagrams === 1 && mixed.code === 1 && /export async function handle/.test(mixed.text), JSON.stringify({ d: mixed.diagrams, c: mixed.code }));
    check('still no page errors', o.errors.length === 0, o.errors.slice(0, 3).join(' | '));
    await o.context.close();

    // ── 8. feature off ──────────────────────────────────────────────────────
    console.log('feature switched off');
    o = await openOverlay({ diagramsEnabled: false });
    await o.page.waitForTimeout(300);
    r = await streamWta(o.page, DESIGN_ANSWER);
    check('with diagrams off, a Mermaid block is an ordinary code card', r.final.diagramCards === 0 && r.final.codeCards === 1 && /flowchart LR/.test(r.final.text), JSON.stringify({ d: r.final.diagramCards, c: r.final.codeCards }));
    await o.context.close();

    console.log('');
    for (const n of notes) console.log(`note: ${n}`);
  } finally {
    await harness.close();
  }

  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll overlay diagram checks passed.');
  process.exit(0);
}

main().catch((err) => {
  console.error('overlay diagram check crashed:', err);
  process.exit(1);
});
