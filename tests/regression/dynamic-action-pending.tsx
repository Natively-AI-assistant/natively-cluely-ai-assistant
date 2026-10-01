// Run via Vite: /tests/regression/dynamic-action-pending.html.
// Uses the real React components and DOM with a synthetic Electron bridge.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { DynamicActionBar } from '../../src/components/dynamic-actions/DynamicActionBar';
import type { DynamicActionPayload } from '../../src/types/electron';

let receive: ((value: { action: DynamicActionPayload }) => void) | undefined;
let finish: ((value: boolean) => void) | undefined;
let accepts = 0;
let shortcut: ((value: { action: string }) => void) | undefined;
const acknowledgements: string[] = [];
const dismissals: string[] = [];
window.electronAPI = {
  onIntelligenceDynamicAction: (callback: typeof receive) => { receive = callback; return () => { receive = undefined; }; },
  onGlobalShortcut: (callback: typeof shortcut) => { shortcut = callback; return () => { shortcut = undefined; }; },
  acceptDynamicAction: async (id: string) => { acknowledgements.push(id); },
  dismissDynamicAction: async (id: string) => { dismissals.push(id); },
} as unknown as typeof window.electronAPI;
const tick = () => new Promise(resolve => setTimeout(resolve, 40));
const root = createRoot(document.getElementById('root')!);
root.render(<DynamicActionBar onAcceptAction={() => {
  accepts += 1;
  return new Promise<boolean>(resolve => { finish = resolve; });
}} />);
const results = document.getElementById('results')!;
const check = (condition: unknown, label: string) => {
  if (!condition) throw new Error(label);
  results.textContent += `PASS: ${label}\n`;
};
const card = (id: string) => document.querySelector<HTMLElement>(`[data-testid="dynamic-action-card-${id}"]`)!;
const acceptButton = (id: string) => card(id).querySelector<HTMLButtonElement>('button')!;
const dismiss = (id: string) => card(id).querySelector<HTMLButtonElement>(`button[aria-label="Dismiss ${id}"]`)!;
const tab = () => {
  const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  document.body.dispatchEvent(event);
  return event;
};
document.getElementById('run')!.onclick = async () => {
  (document.getElementById('run') as HTMLButtonElement).disabled = true;
  results.textContent = '';
  try {
    for (const route of ['click', 'keyboard']) {
      const id = `pending-${route}`;
      receive!({ action: { id, label: id, createdAt: Date.now(), priority: 10 } as DynamicActionPayload });
      await tick();
      const before = accepts;
      if (route === 'click') acceptButton(id).click();
      else shortcut!({ action: 'acceptSuggestion' });
      dismiss(id).click();
      check(dismissals.length === 0, `${route}: synchronous dismissal guard holds before render`);
      await tick();
      check(accepts === before + 1, `${route}: acceptance starts once`);
      check(dismiss(id).disabled, `${route}: dismiss disabled while pending`);
      dismiss(id).click();
      check(dismissals.length === 0, `${route}: pending card cannot be dismissed`);
      check(!tab().defaultPrevented, `${route}: pending Tab preserves focus navigation`);
      acceptButton(id).click();
      check(accepts === before + 1, `${route}: duplicate acceptance suppressed`);
      finish!(false);
      await tick();
      check(!dismiss(id).disabled, `${route}: failed acceptance restores dismissal`);
      check(acknowledgements.length === (route === 'click' ? 0 : 1), `${route}: failure does not acknowledge`);
      acceptButton(id).click();
      await tick();
      check(accepts === before + 2, `${route}: failed acceptance is retryable`);
      finish!(true);
      await new Promise(resolve => setTimeout(resolve, 350));
      check(acknowledgements.includes(id), `${route}: successful retry acknowledged`);
    }
    results.textContent += 'ALL PASSED\n';
  } catch (error) {
    results.textContent += `FAIL: ${String(error)}\n`;
    throw error;
  }
};
