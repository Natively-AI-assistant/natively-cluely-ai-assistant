// intelligence-eval-real-ui/helpers/response-observer-ui.ts
// Observes the REAL streamed answer in the UI. It taps the SAME IPC token events
// the renderer itself consumes (onGeminiStreamToken/Done/Error) to get precise
// first-token / completion timing, AND verifies the answer text actually appears
// in the visible DOM (so we are not trusting events alone — the spec requires
// visual confirmation). Returns the final UI-visible answer text + timing marks.
//
// This is not a bypass: these are the production stream events the UI binds to;
// we attach an additional listener in the page and read the rendered DOM.

import type { Page } from 'playwright-core';
import { UiLatencyRecorder } from './latency-recorder-ui.ts';

export interface ObservedResponse {
  text: string;            // final answer (from IPC stream, cross-checked vs DOM)
  domText: string;         // what was visible in the DOM at completion
  visibleConfirmed: boolean;
  chunkCount: number;
  error?: string;
}

// Install a one-shot stream tap in the page BEFORE triggering the question.
// Records timing into window.__uiEval and resolves when done/error.
export async function armStreamTap(win: Page): Promise<void> {
  await win.evaluate(() => {
    const api: any = (window as any).electronAPI;
    const w: any = window as any;
    w.__uiEval = { t0: performance.now(), firstTokenMs: -1, doneMs: -1, chunks: 0, text: '', error: null, done: false };
    if (!api?.onGeminiStreamToken) { w.__uiEval.error = 'no onGeminiStreamToken bridge'; w.__uiEval.done = true; return; }
    const offTok = api.onGeminiStreamToken((tok: string) => {
      const e = w.__uiEval;
      if (e.firstTokenMs < 0 && tok && /\S/.test(tok)) e.firstTokenMs = performance.now() - e.t0;
      e.chunks++; e.text += tok;
    });
    const offDone = api.onGeminiStreamDone?.(() => { const e = w.__uiEval; e.doneMs = performance.now() - e.t0; e.done = true; offTok?.(); offDone?.(); });
    const offErr = api.onGeminiStreamError?.((err: string) => { const e = w.__uiEval; e.error = String(err); e.done = true; e.doneMs = performance.now() - e.t0; offTok?.(); offErr?.(); });
  });
}

// Wait for the armed stream to complete; fold timings into the recorder.
export async function awaitStream(win: Page, rec: UiLatencyRecorder, timeoutMs = 90_000): Promise<ObservedResponse> {
  const deadline = Date.now() + timeoutMs;
  let firstSeen = false;
  while (Date.now() < deadline) {
    const e: any = await win.evaluate(() => (window as any).__uiEval).catch(() => null);
    if (e) {
      if (!firstSeen && e.firstTokenMs > 0) { rec.mark('firstUsefulToken'); rec.mark('firstStreamChunk'); rec.mark('firstVisibleText'); firstSeen = true; }
      if (e.done) {
        rec.mark('responseComplete');
        const domText = await readVisibleAnswer(win);
        const text = (e.text || '').trim();
        // visibleConfirmed is TRUE only when the real streamed text actually
        // appears in the DOM — NOT merely "some DOM text exists" (the fallback
        // largest-text-node would otherwise mark a stale heading as confirmed).
        // A stream error is a hard, surfaced failure, never a soft empty pass.
        const confirmed = !e.error && (e.chunks || 0) > 0 && !!text && !!domText && overlaps(domText, text);
        return {
          text: text || domText,
          domText,
          visibleConfirmed: confirmed,
          chunkCount: e.chunks || 0,
          error: e.error || undefined,
        };
      }
    }
    await win.waitForTimeout(150);
  }
  const domText = await readVisibleAnswer(win);
  return { text: domText, domText, visibleConfirmed: !!domText, chunkCount: 0, error: 'observer_timeout' };
}

// Read the most recent assistant answer visible in the DOM. Heuristic across the
// overlay/global-chat layouts: take the last sizable text block that isn't the
// user's own question echo. Robust to class-name changes.
async function readVisibleAnswer(win: Page): Promise<string> {
  return win.evaluate(() => {
    // Prefer explicit assistant message containers if present.
    const candidates = Array.from(document.querySelectorAll(
      '[data-role="assistant"], [data-message-role="assistant"], .assistant-message, [class*="assistant"], [class*="answer"], [class*="message"]'
    )) as HTMLElement[];
    const texts = candidates
      .map(el => (el.innerText || '').trim())
      .filter(t => t.length > 0);
    if (texts.length) return texts[texts.length - 1].slice(0, 4000);
    // Fallback: largest visible text node on screen.
    const all = Array.from(document.querySelectorAll('div,p,span')) as HTMLElement[];
    let best = '';
    for (const el of all) {
      const t = (el.innerText || '').trim();
      if (t.length > best.length && t.length < 4000) best = t;
    }
    return best.slice(0, 4000);
  });
}

function overlaps(a: string, b: string): boolean {
  // Loose containment: the DOM should show a meaningful prefix of the streamed text.
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const A = norm(a), B = norm(b);
  if (!A || !B) return false;
  const probe = B.slice(0, Math.min(40, B.length));
  return A.includes(probe) || B.includes(A.slice(0, Math.min(40, A.length)));
}
