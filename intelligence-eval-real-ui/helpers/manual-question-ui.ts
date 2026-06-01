// intelligence-eval-real-ui/helpers/manual-question-ui.ts
// Drives a MANUAL question through the real chat UI: type into the visible input,
// submit (Enter/click), and observe the real streamed answer in the DOM. Uses
// the production streamGeminiChat path (the same the UI input triggers).

import type { Page } from 'playwright-core';
import { UiLatencyRecorder } from './latency-recorder-ui.ts';
import { armStreamTap, awaitStream, type ObservedResponse } from './response-observer-ui.ts';

// Locate the chat input ("Ask me anything...", "Ask about this meeting...",
// "Search or ask anything..."). Returns the locator or null.
async function findInput(win: Page) {
  // Prefer the stable test id (added to the real overlay input). The overlay
  // input renders its placeholder as a sibling <div>, so placeholder selectors
  // miss — testid is the reliable hook.
  const byId = win.locator('[data-testid="overlay-chat-input"]');
  if (await byId.count() > 0) return byId.first();
  const needles = ['Ask me anything', 'Ask about this meeting', 'Search or ask anything', 'ask anything'];
  for (const n of needles) {
    const loc = win.locator(`textarea[placeholder*="${n}"], input[placeholder*="${n}"]`);
    if (await loc.count() > 0) return loc.first();
  }
  const any = win.locator('textarea:visible, input[type="text"]:visible');
  if (await any.count() === 1) return any.first();
  return null;
}

export async function askManualQuestion(win: Page, question: string, rec: UiLatencyRecorder): Promise<ObservedResponse> {
  const input = await findInput(win);
  if (!input) throw new Error('[manual-question] could not find a visible chat input');
  await input.click({ timeout: 15_000 });
  await input.fill(question, { timeout: 15_000 });
  // Assert the text actually landed (the input is readOnly while a stealth tap
  // is active — a silent no-fill would otherwise submit an empty question).
  const landed = await input.inputValue().catch(() => '');
  if (!landed.includes(question.slice(0, Math.min(12, question.length)))) {
    throw new Error(`[manual-question] input did not accept text (readOnly/stealth tap?); got "${landed.slice(0, 40)}"`);
  }
  await armStreamTap(win);
  rec.mark('questionSubmit');
  await input.press('Enter');
  return awaitStream(win, rec, 100_000);
}
