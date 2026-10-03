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

    // ── 7a. a repair that lands while the answer is still being revealed ────
    // Found in review: the repaired source was written only into React state;
    // the next reveal tick (and then the seal) wrote the model's broken text
    // back, the card lost its repair, and its one automatic attempt was spent.
    console.log('repair during the stream');
    o = await openOverlay();
    const BROKEN_BLOCK = 'flowchart LR\n    client["Client"] -> api["API Service"]\n    api --> db[("Orders DB")]';
    const FIXED_BLOCK = 'flowchart LR\n    client["Client"] --> api["API Service"]\n    api --> db[("Orders DB")]';
    const tail = 'The client calls the API service, which reads and writes orders in the database. '.repeat(14);
    const REPAIR_ANSWER = `I'd keep it to one service and one store.\n\n\`\`\`mermaid\n${BROKEN_BLOCK}\n\`\`\`\n\n${tail}`;
    await o.page.evaluate((fixed) => { window.__repairWith = fixed; window.__repairDelayMs = 60; }, FIXED_BLOCK);
    // The model pauses just after the block: the reveal catches up and goes
    // idle, the repair lands and is written into the answer — and then more
    // tokens arrive and the stream commits its own (broken) text again.
    await o.page.evaluate(async ({ text, pauseAt }) => {
      const send = async (from, to) => {
        for (let i = from; i < to; i += 8) {
          window.__emit('onIntelligenceSuggestedAnswerToken', { token: text.slice(i, Math.min(to, i + 8)) });
          await new Promise((res) => setTimeout(res, 5));
        }
      };
      await send(0, pauseAt);
      await new Promise((res) => setTimeout(res, 2500));
      await send(pauseAt, text.length);
      window.__emit('onIntelligenceSuggestedAnswer', { answer: text });
      await new Promise((res) => setTimeout(res, 4500));
    }, { text: REPAIR_ANSWER, pauseAt: REPAIR_ANSWER.indexOf('The client calls') + 24 });
    await o.page.waitForTimeout(500);
    const repaired = await o.page.evaluate(() => {
      const rows = [...document.querySelectorAll('.ai-response-card')];
      const row = rows[rows.length - 1];
      const card = row.querySelector('figure.diagram-card');
      const img = card && card.querySelector('img.diagram-card__img');
      return {
        state: card ? card.getAttribute('data-diagram-state') : null,
        drawn: Boolean(img && img.complete && img.naturalWidth > 0),
        requests: (window.__repairRequests || []).length,
        accepted: window.__calls.filter((c) => c === 'acceptDiagramRepair').length,
        text: row.innerText,
      };
    });
    check('exactly one repair was requested, while the answer was still streaming', repaired.requests === 1, JSON.stringify({ requests: repaired.requests }));
    check('the repaired diagram is what the finished answer shows', repaired.state === 'ready' && repaired.drawn, JSON.stringify({ state: repaired.state, drawn: repaired.drawn }));
    check('…with no syntax-error fallback left behind', !/syntax error|could not be/i.test(repaired.text), repaired.text.slice(0, 160));
    await o.page.locator('figure.diagram-card').last().getByRole('tab', { name: 'Source' }).click();
    await o.page.waitForTimeout(200);
    const repairedSource = await o.page.evaluate(() => document.querySelector('.ai-response-card:last-of-type .diagram-card__source, .diagram-card__source')?.textContent || '');
    check('the Source tab holds the repaired source, not the broken one', repairedSource.includes('client["Client"] --> api') && !repairedSource.includes('client["Client"] -> api'), repairedSource.slice(0, 120));
    check('the prose after the block is intact', repaired.text.split('The client calls the API service').length === 15, String(repaired.text.split('The client calls the API service').length));
    check('no page errors', o.errors.length === 0, o.errors.slice(0, 3).join(' | '));
    await o.context.close();

    // ── 7a1. …and the final text DIFFERS from what streamed ─────────────────
    // Found in the second review: the engine's final text is cleaned and
    // trimmed, so it is not the streamed text. It replaced the row with the
    // model's broken source again, at a commit site the first fix had missed.
    console.log('repair during the stream, then a different final text');
    o = await openOverlay();
    {
      const STREAMED = `I'd keep it to one service and one store.\n\n\`\`\`mermaid\n${BROKEN_BLOCK}\n\`\`\`\n\nThe client calls the API service, which owns the orders database.`;
      const FINAL = `I'd keep it to one service and one store.\n\n\`\`\`mermaid\n${BROKEN_BLOCK}\n\`\`\`\n\nThe client calls the API service. It owns the orders database outright.`;
      await o.page.evaluate((fixed) => { window.__repairWith = fixed; window.__repairDelayMs = 40; }, FIXED_BLOCK);
      await o.page.evaluate(async ({ streamed, final }) => {
        for (let i = 0; i < streamed.length; i += 8) {
          window.__emit('onIntelligenceSuggestedAnswerToken', { token: streamed.slice(i, i + 8) });
          await new Promise((res) => setTimeout(res, 5));
        }
        // The repair lands; then the authoritative text arrives.
        await new Promise((res) => setTimeout(res, 2500));
        window.__emit('onIntelligenceSuggestedAnswer', { answer: final });
        await new Promise((res) => setTimeout(res, 3000));
      }, { streamed: STREAMED, final: FINAL });
      const after = await o.page.evaluate(() => {
        const rows = [...document.querySelectorAll('.ai-response-card')];
        const row = rows[rows.length - 1];
        const card = row.querySelector('figure.diagram-card');
        const img = card && card.querySelector('img.diagram-card__img');
        return {
          state: card ? card.getAttribute('data-diagram-state') : null,
          drawn: Boolean(img && img.complete && img.naturalWidth > 0),
          requests: (window.__repairRequests || []).length,
          text: row.innerText,
        };
      });
      check('the final text is what the row shows', /It owns the orders database outright\./.test(after.text) && !/which owns the orders database/.test(after.text), after.text.slice(-160));
      check('…and its diagram is still the repaired one, drawn', after.state === 'ready' && after.drawn && !/syntax error|could not be/i.test(after.text), JSON.stringify({ state: after.state, drawn: after.drawn }));
      check('…with one repair request, not a second', after.requests === 1, String(after.requests));
      check('no page errors', o.errors.length === 0, o.errors.slice(0, 3).join(' | '));
    }
    await o.context.close();

    // ── 7a2. the lead of a diagram answer stays formatted ───────────────────
    // Found in review: when the fence ARRIVED ahead of the paced reveal, the
    // lead (already on screen as formatted Markdown) was repainted as raw
    // text — literal "**", "#", "- " — until the reveal reached the fence.
    console.log('formatted lead, fence arrives ahead of the reveal');
    o = await openOverlay();
    {
      const LEAD = [
        'I would put a **durable queue** between the producers and the delivery workers, so a slow provider never blocks the callers.',
        '',
        '- **Producers** write and return at once',
        '- **Workers** pull, send and retry with backoff',
        '- A **dead-letter queue** keeps what kept failing, so it can be replayed by hand',
        '',
        'That keeps the write path fast and makes every failure visible instead of silent, which is the property that matters most here.',
      ].join('\n');
      const FORMATTED = `${LEAD}\n\n\`\`\`mermaid\nflowchart LR\n    producer["Producer"] --> queue["Queue"]\n    queue --> worker["Worker"]\n\`\`\`\n\nRetries stay inside the worker.`;
      const seen = await o.page.evaluate(async (text) => {
        const lastRowText = () => {
          const rows = document.querySelectorAll('.ai-response-card');
          const row = rows[rows.length - 1];
          return row ? row.innerText : '';
        };
        const out = { rawBold: 0, rawBullet: 0, samples: 0, firstRaw: '', strongSeen: false, sawText: false, wentBack: 0, emptyAtTaskEnd: 0, mutations: 0, maxLeads: 0 };
        // The timer below samples what is on screen every 8 ms, so it catches a
        // blank row only when a frame happens to land in the gap: it failed
        // once in about twenty runs, and passed four times out of four with
        // the defect put back. This observer does not depend on timing. It is
        // told of EVERY change to the row, and asks whether the row is empty
        // once the task that changed it has finished (its microtasks drained)
        // — the point at which the browser is free to paint. The old code
        // emptied the node in one task and React refilled it in a later one.
        let observedText = false;
        const blank = (t) => !t.trim() || /^Thinking/.test(t.trim());
        const observer = new MutationObserver(async () => {
          out.mutations += 1;
          const now = lastRowText();
          // The fix keeps the on-screen text until React replaces its node. It
          // must be replaced, not joined: the lead is never on screen twice.
          out.maxLeads = Math.max(out.maxLeads, now.split('durable queue').length - 1);
          if (!blank(now)) { observedText = true; return; }
          if (!observedText) return;
          // Let every microtask queued by this task run (a synchronous React
          // flush would refill the row here); what is left is what a frame
          // painted now would show.
          for (let i = 0; i < 5; i += 1) await Promise.resolve();
          if (blank(lastRowText())) out.emptyAtTaskEnd += 1;
        });
        observer.observe(document.body, { subtree: true, childList: true, characterData: true });
        const timer = setInterval(() => {
          const t = lastRowText();
          // Once the lead is on screen it stays: the row never falls back to
          // its empty "Thinking…" state (it did, at the switch to the React
          // path, for as long as a sentence hold).
          if (out.sawText && (!t.trim() || /^Thinking/.test(t.trim()))) out.wentBack += 1;
          if (!t.trim()) return;
          if (!/^Thinking/.test(t.trim())) out.sawText = true;
          out.samples += 1;
          // A bold span that is CLOSED and still shown with its asterisks. (One
          // that is still being revealed shows "**" for a frame or two on every
          // streaming path; that is not this defect.)
          if (/\*\*[^*\n]+\*\*/.test(t)) { out.rawBold += 1; if (!out.firstRaw) out.firstRaw = t.slice(0, 160); }
          if (/^- \*\*|\n- /.test(t)) out.rawBullet += 1;
          const rows = document.querySelectorAll('.ai-response-card');
          if (rows[rows.length - 1]?.querySelector('strong')) out.strongSeen = true;
        }, 8);
        // The whole answer arrives in a few frames; the reveal takes over a second.
        for (let sent = 0; sent < text.length; sent += 90) {
          window.__emit('onIntelligenceSuggestedAnswerToken', { token: text.slice(sent, sent + 90) });
          await new Promise((r) => setTimeout(r, 12));
        }
        await new Promise((r) => setTimeout(r, 2500));
        window.__emit('onIntelligenceSuggestedAnswer', { answer: text });
        await new Promise((r) => setTimeout(r, 1500));
        clearInterval(timer);
        observer.disconnect();
        const rows = document.querySelectorAll('.ai-response-card');
        const row = rows[rows.length - 1];
        out.finalCards = row ? row.querySelectorAll('figure.diagram-card').length : 0;
        out.finalText = row ? row.innerText : '';
        out.leadCount = out.finalText.split('durable queue').length - 1;
        return out;
      }, FORMATTED);
      check('the lead is never shown as raw Markdown while the reveal catches up', seen.samples > 20 && seen.rawBold === 0 && seen.rawBullet === 0, JSON.stringify({ samples: seen.samples, rawBold: seen.rawBold, rawBullet: seen.rawBullet, first: seen.firstRaw }));
      check('…it is formatted throughout', seen.strongSeen, JSON.stringify({ strongSeen: seen.strongSeen }));
      check('…and never blanks back to "Thinking…" once it is on screen', seen.sawText && seen.wentBack === 0, JSON.stringify({ sawText: seen.sawText, wentBack: seen.wentBack }));
      check('…and at no point is the lead on screen twice (every DOM change observed)', seen.maxLeads === 1, JSON.stringify({ maxLeads: seen.maxLeads }));
      check('…at no point is the row empty when a frame could be painted (every DOM change observed, not sampled)', seen.mutations > 20 && seen.emptyAtTaskEnd === 0, JSON.stringify({ mutations: seen.mutations, emptyAtTaskEnd: seen.emptyAtTaskEnd }));
      check('…and the finished answer has the lead once and one card', seen.leadCount === 1 && seen.finalCards === 1, JSON.stringify({ lead: seen.leadCount, cards: seen.finalCards }));
      check('no page errors', o.errors.length === 0, o.errors.slice(0, 3).join(' | '));
    }
    await o.context.close();

    // ── 7b. charts and notation diagrams, streamed ──────────────────────────
    console.log('charts and notation diagrams, streamed');
    const fenced = (tag, body) => '```' + tag + '\n' + body + '\n```';
    const chartPayload = (rate) => JSON.stringify({ v: 1, type: 'line', title: `Monthly revenue at ${rate}% net growth`, x: { label: 'Month' }, y: { label: 'Revenue', unit: 'USD' }, compute: { kind: 'compound_growth', baseline: 10000, ratePercent: rate, period: 'month', periods: 3 }, assumptions: [`Net growth stays at ${rate}% every month`] });
    const CHART_ANSWER = `At 5% net growth a month from $10,000 this is a scenario, not a prediction.\n\n${fenced('natively-chart', chartPayload(5))}\n\nThe chart shows each month under that one assumption. It says nothing about what will actually happen, and it does not mean the product causes the growth. If the starting point or the rate changes, the whole line moves with it.`;
    const lastVisualRow = () => {
      const rows = [...document.querySelectorAll('.ai-response-card')];
      const row = rows[rows.length - 1];
      const cards = row ? [...row.querySelectorAll('figure.diagram-card')] : [];
      const img = cards[0] && cards[0].querySelector('img.diagram-card__img');
      return {
        cards: cards.length,
        kind: cards[0] ? cards[0].getAttribute('data-diagram-kind') : null,
        state: cards[0] ? cards[0].getAttribute('data-diagram-state') : null,
        label: cards[0] ? cards[0].querySelector('[role="tab"]')?.textContent : null,
        missing: cards[0] ? cards[0].getAttribute('data-diagram-missing') : null,
        drawn: Boolean(img && img.complete && img.naturalWidth > 0),
        svg: img ? decodeURIComponent(img.src.slice(img.src.indexOf(',') + 1)) : '',
        text: row ? row.innerText : '',
        codeCards: row ? row.querySelectorAll('.overlay-code-block-surface:not(.diagram-card)').length : 0,
        cardWidth: cards[0] ? Math.round(cards[0].getBoundingClientRect().width) : 0,
        rowWidth: row ? Math.round(row.getBoundingClientRect().width) : 0,
      };
    };
    o = await openOverlay();
    r = await streamWta(o.page, CHART_ANSWER);
    let last = await o.page.evaluate(lastVisualRow);
    check('a chart is drawn while the answer is still streaming', r.marks.cardReady !== null && r.marks.cardReady < r.marks.streamEnd, JSON.stringify(r.marks));
    check('it is not held back by the paced reveal of its own payload (< 600 ms after its last token)', r.marks.cardReady - r.marks.blockReceivedAt < 600, `receipt→visible ${Math.round(r.marks.cardReady - r.marks.blockReceivedAt)} ms`);
    check('one chart card, drawn, titled Forecast', last.cards === 1 && last.kind === 'chart' && last.state === 'ready' && last.drawn && last.label === 'Forecast', JSON.stringify({ ...last, svg: undefined, text: undefined }));
    check('the values on it are the computed ones', last.svg.includes('>11,576.25<') && last.svg.includes('>Scenario<'), last.svg.slice(0, 160));
    check('no raw payload and no fence is left on screen', !/```|"compute"|natively-chart|ratePercent/.test(last.text), last.text.slice(0, 300));
    check('the prose before and after it appears exactly once', last.text.split('this is a scenario, not a prediction').length === 2 && last.text.split('the whole line moves with it').length === 2, last.text.slice(0, 200));
    check('the chart spans the row and the overlay does not scroll sideways', last.cardWidth >= last.rowWidth - 2 && r.final.scrollX <= 0, JSON.stringify({ card: last.cardWidth, row: last.rowWidth, scrollX: r.final.scrollX }));

    // "Make it 3%": a second answer, a second card, the first one untouched.
    const CHART_3 = `Dropping the rate to 3%.\n\n${fenced('natively-chart', chartPayload(3))}\n\nGrowth compounds more slowly, so the last month is lower.`;
    const update = await o.page.evaluate(
      async ({ text }) => {
        let sawPrevious = false;
        const timer = setInterval(() => {
          const rows = [...document.querySelectorAll('.ai-response-card')];
          const row = rows[rows.length - 1];
          if (row && row.querySelector('.diagram-card__viewport.is-previous img')) sawPrevious = true;
        }, 8);
        for (let i = 0; i < text.length; i += 6) {
          window.__emit('onIntelligenceSuggestedAnswerToken', { token: text.slice(i, i + 6) });
          await new Promise((res) => setTimeout(res, 6));
        }
        window.__emit('onIntelligenceSuggestedAnswer', { answer: text });
        await new Promise((res) => setTimeout(res, 2500));
        clearInterval(timer);
        return { sawPrevious };
      },
      { text: CHART_3 },
    );
    last = await o.page.evaluate(lastVisualRow);
    const allCards = await o.page.evaluate(() => [...document.querySelectorAll('figure.diagram-card img.diagram-card__img')].map((img) => decodeURIComponent(img.src.slice(img.src.indexOf(',') + 1))));
    check('while the update is written, the previous chart stays up', update.sawPrevious, JSON.stringify(update));
    check('the updated chart is drawn from the changed input', last.drawn && last.svg.includes('>10,927.27<') && !last.svg.includes('>11,576.25<'), last.svg.slice(0, 160));
    check('the earlier answer keeps its own chart (two answers, two cards)', allCards.length === 2 && allCards[0].includes('>11,576.25<'), String(allCards.length));

    // A forecast the model could not ground: a reason, not a picture, and no repair.
    const NO_BASE = `I can chart that once there is a starting value.\n\n${fenced('natively-chart', JSON.stringify({ v: 1, type: 'line', title: 'Revenue at 5% growth', compute: { kind: 'compound_growth', ratePercent: 5, period: 'month', periods: 3 } }))}\n\nThe growth rate alone does not say where revenue starts.`;
    await streamWta(o.page, NO_BASE);
    last = await o.page.evaluate(lastVisualRow);
    check('a chart missing an input shows what it needs, in the answer, with no picture', last.cards === 1 && last.state === 'error' && !last.drawn && last.missing === 'a starting value' && /This forecast needs a starting value\./.test(last.text), JSON.stringify({ ...last, svg: undefined }));
    check('…and never asks a model to "repair" it', (await o.page.evaluate(() => window.__calls.filter((c) => c === 'repairDiagram').length)) === 0);

    // Chen and an automaton arrive as notation blocks.
    const CHEN_ANSWER = `In Chen notation.\n\n${fenced('natively-diagram', JSON.stringify({ kind: 'chen-er', title: 'Orders', entities: [{ name: 'Customer', attributes: [{ name: 'customer_id', key: true }] }, { name: 'Order', attributes: [{ name: 'order_id', key: true }] }], relationships: [{ name: 'places', participants: [{ entity: 'Customer', cardinality: '1' }, { entity: 'Order', cardinality: 'N', participation: 'total' }] }] }))}\n\nEvery order has a customer.`;
    await streamWta(o.page, CHEN_ANSWER);
    last = await o.page.evaluate(lastVisualRow);
    check('a Chen diagram streams into a drawn notation card', last.cards === 1 && last.kind === 'notation' && last.drawn && last.label === 'ER diagram (Chen)' && last.svg.includes('chen-relationship'), JSON.stringify({ ...last, svg: undefined, text: undefined }));
    const DFA_ANSWER = `This DFA accepts strings ending in ab.\n\n${fenced('natively-diagram', JSON.stringify({ kind: 'automaton', type: 'dfa', alphabet: ['a', 'b'], states: ['q0', 'q1', 'q2'], start: 'q0', accepting: ['q2'], transitions: [{ from: 'q0', symbol: 'a', to: 'q1' }, { from: 'q0', symbol: 'b', to: 'q0' }, { from: 'q1', symbol: 'a', to: 'q1' }, { from: 'q1', symbol: 'b', to: 'q2' }, { from: 'q2', symbol: 'a', to: 'q1' }, { from: 'q2', symbol: 'b', to: 'q0' }] }))}\n\nEach state remembers how much of ab was just read.`;
    await streamWta(o.page, DFA_ANSWER);
    last = await o.page.evaluate(lastVisualRow);
    check('an automaton streams into a drawn DFA card', last.cards === 1 && last.kind === 'notation' && last.drawn && last.label === 'DFA' && !/"transitions"/.test(last.text), JSON.stringify({ ...last, svg: undefined, text: undefined }));

    // A chart beside real code keeps both.
    const CHART_AND_CODE = `Scenario first, then the script.\n\n${fenced('natively-chart', chartPayload(5))}\n\n\`\`\`python\ndef project(base, rate, n):\n    return [base * (1 + rate) ** t for t in range(n + 1)]\n\`\`\`\n\nThe script reproduces the same numbers.`;
    await streamWta(o.page, CHART_AND_CODE);
    last = await o.page.evaluate(lastVisualRow);
    check('a chart and a code block in one answer are a chart card AND a code card', last.cards === 1 && last.kind === 'chart' && last.drawn && last.codeCards === 1 && /def project/.test(last.text), JSON.stringify({ ...last, svg: undefined, text: undefined }));
    // A diagram made only of placeholders: the sentences stay, the drawing does not.
    const GAP_ANSWER = `I can't draw the method, because the paper was not retrieved for this turn.\n\n${fenced('mermaid', 'flowchart TD\n    paper["Paper (not retrieved)"] -->|"steps unknown"| method["Method (unknown)"]\n    method --> inputs["Inputs (unknown)"]')}\n\nPoint me at the method section and I will draw exactly what it lays out.`;
    await streamWta(o.page, GAP_ANSWER);
    last = await o.page.evaluate(lastVisualRow);
    check('a placeholder-only diagram leaves no card, no code block and no raw source', last.cards === 0 && last.codeCards === 0 && !/```|not retrieved\)|flowchart TD/.test(last.text), JSON.stringify({ cards: last.cards, code: last.codeCards, text: last.text.slice(0, 200) }));
    check('the sentences around it are both there', /paper was not retrieved for this turn/.test(last.text) && /Point me at the method section/.test(last.text), last.text.slice(0, 200));
    check('no page errors', o.errors.length === 0, o.errors.slice(0, 3).join(' | '));
    if (process.env.DIAGRAM_CHECK_SHOTS) await o.page.screenshot({ path: join(process.env.DIAGRAM_CHECK_SHOTS, 'overlay-chart-answers.png') });
    await o.context.close();

    // ── 8. feature off ──────────────────────────────────────────────────────
    console.log('feature switched off');
    o = await openOverlay({ diagramsEnabled: false });
    await o.page.waitForTimeout(300);
    r = await streamWta(o.page, DESIGN_ANSWER);
    check('with diagrams off, a Mermaid block is an ordinary code card', r.final.diagramCards === 0 && r.final.codeCards === 1 && /flowchart LR/.test(r.final.text), JSON.stringify({ d: r.final.diagramCards, c: r.final.codeCards }));
    r = await streamWta(o.page, CHART_ANSWER);
    const offChart = await o.page.evaluate(lastVisualRow);
    check('…and so is a chart block: its payload is shown as code, nothing is drawn', offChart.cards === 0 && offChart.codeCards === 1 && /compound_growth/.test(offChart.text), JSON.stringify({ d: offChart.cards, c: offChart.codeCards }));
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
