// intelligence-eval-real-ui/helpers/what-to-answer-ui.ts
// Clicks the REAL "What to answer?" button in the overlay and observes the
// streamed suggested answer. The button calls window.electronAPI.generateWhatToSay,
// which streams via onIntelligenceSuggestedAnswerToken / onIntelligenceSuggestedAnswer
// (distinct from the gemini chat stream). We tap those production events.

import type { Page } from 'playwright-core';
import { UiLatencyRecorder } from './latency-recorder-ui.ts';

export interface WtaResponse { text: string; domText: string; visibleConfirmed: boolean; error?: string }

async function armSuggestionTap(win: Page): Promise<void> {
  await win.evaluate(() => {
    const api: any = (window as any).electronAPI;
    const w: any = window as any;
    w.__wtaEval = { t0: performance.now(), firstTokenMs: -1, doneMs: -1, text: '', done: false, error: null };
    const onTok = api?.onIntelligenceSuggestedAnswerToken?.((p: any) => {
      const e = w.__wtaEval; const tok = typeof p === 'string' ? p : (p?.token ?? '');
      if (tok && /\S/.test(tok) && e.firstTokenMs < 0) e.firstTokenMs = performance.now() - e.t0;
      e.text += tok;
    });
    const onFinal = api?.onIntelligenceSuggestedAnswer?.((p: any) => {
      const e = w.__wtaEval;
      const ans = typeof p === 'string' ? p : (p?.answer ?? p?.fullAnswer ?? '');
      if (ans) e.text = ans;
      e.doneMs = performance.now() - e.t0; e.done = true; onTok?.(); onFinal?.();
    });
    if (!onTok && !onFinal) { w.__wtaEval.error = 'no suggested-answer bridges'; w.__wtaEval.done = true; }
  });
}

// Intelligence events (suggested_answer / suggested_answer_token) are sent to
// mainWindow() in main.ts — which is the LAUNCHER window (currentWindowMode=
// 'launcher' default). The WTA button lives in the overlay, but the event
// arrives in the launcher. eventWin defaults to win (overlay) for backward
// compat but callers should pass the launcher window as eventWin so the
// stream listener is armed on the correct Playwright page.
export async function clickWhatToAnswer(win: Page, rec: UiLatencyRecorder, timeoutMs = 100_000, eventWin?: Page): Promise<WtaResponse> {
  const listenWin = eventWin ?? win;
  await armSuggestionTap(listenWin);
  // Find the real BUTTON (not the decorative "What should I answer?" bubble span
  // in NativelyInterfaceCard). Scope to <button> with the exact label.
  const btn = win.locator('button', { hasText: /what to answer\?/i });
  if (await btn.count() === 0) {
    throw new Error('[what-to-answer] real button not found in overlay');
  }
  await btn.first().click({ timeout: 15_000 });
  rec.mark('buttonClick');

  const deadline = Date.now() + timeoutMs;
  let firstSeen = false;
  while (Date.now() < deadline) {
    const e: any = await listenWin.evaluate(() => (window as any).__wtaEval).catch(() => null);
    if (e) {
      if (!firstSeen && e.firstTokenMs > 0) { rec.mark('firstUsefulToken'); rec.mark('firstVisibleText'); firstSeen = true; }
      if (e.done) {
        rec.mark('responseComplete');
        const domText = await readVisible(win);
        const text = (e.text || '').trim() || domText;
        return { text, domText, visibleConfirmed: !!domText, error: e.error };
      }
    }
    await new Promise(r => setTimeout(r, 200)); // use setTimeout not waitForTimeout to survive Electron restart
  }
  const domText = await readVisible(win);
  return { text: domText, domText, visibleConfirmed: !!domText, error: 'wta_observer_timeout' };
}

async function readVisible(win: Page): Promise<string> {
  return win.evaluate(() => {
    const sel = '[class*="suggested"], [class*="answer"], [class*="message"], [data-role="assistant"]';
    const els = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
    const texts = els.map(e => (e.innerText || '').trim()).filter(t => t.length > 2);
    return (texts[texts.length - 1] || '').slice(0, 4000);
  });
}
