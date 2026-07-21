/**
 * Popup UI controller. All privileged work (token storage, loopback fetch) is
 * delegated to the service worker via chrome.runtime.sendMessage — the popup
 * itself never holds the token persistently nor talks to the desktop directly.
 */
import type { CaptureReport, DomPostOutcome, PairFetchOutcome } from './service-worker';

type StatusOutcome = DomPostOutcome | { kind: 'unpaired' };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const dot = $('dot');
const statusText = $('statusText');
const pairCard = $('pairCard');
const captureCard = $('captureCard');
const pairInput = $<HTMLInputElement>('pairInput');
const pairBtn = $<HTMLButtonElement>('pairBtn');
const connectBtn = $<HTMLButtonElement>('connectBtn');
const captureBtn = $<HTMLButtonElement>('captureBtn');
const unpairBtn = $<HTMLButtonElement>('unpairBtn');
const msg = $('msg');

function send<R>(message: unknown): Promise<R> {
  return chrome.runtime.sendMessage(message) as Promise<R>;
}

function setDot(color: 'green' | 'red' | 'amber' | 'grey'): void {
  dot.className = 'dot' + (color === 'grey' ? '' : ` ${color}`);
}

function setMsg(text: string, kind: 'ok' | 'err' | 'warn' | ''): void {
  msg.textContent = text;
  msg.className = 'msg' + (kind ? ` ${kind}` : '');
}

function describe(outcome: DomPostOutcome): { text: string; kind: 'ok' | 'err' | 'warn' } {
  switch (outcome.kind) {
    case 'success':
      return { text: 'Sent to Natively.', kind: 'ok' };
    case 'unauthorized':
      return { text: 'Pairing expired (token rotated). Re-pair below.', kind: 'warn' };
    case 'no-session':
      return { text: 'Start a Natively session, then capture again.', kind: 'warn' };
    case 'refused':
      return { text: 'Open Natively and enable Phone Mirror.', kind: 'err' };
    case 'rate-limited':
      return { text: 'Too many requests — wait a moment and retry.', kind: 'warn' };
    case 'too-large':
      return { text: 'Page too large to send.', kind: 'err' };
    case 'bad-request':
      return { text: 'Desktop rejected the request.', kind: 'err' };
    case 'http-error':
      return { text: `Unexpected response (${outcome.status}).`, kind: 'err' };
    case 'error':
      return { text: outcome.message, kind: 'err' };
  }
}

function showPaired(paired: boolean): void {
  pairCard.classList.toggle('hidden', paired);
  captureCard.classList.toggle('hidden', !paired);
}

async function refreshStatus(): Promise<void> {
  const outcome = await send<StatusOutcome>({ type: 'status' });
  if (outcome.kind === 'unpaired' || outcome.kind === 'unauthorized') {
    setDot(outcome.kind === 'unauthorized' ? 'amber' : 'grey');
    statusText.textContent =
      outcome.kind === 'unauthorized' ? 'Pairing expired — re-pair' : 'Not paired';
    showPaired(false);
    if (outcome.kind === 'unauthorized') setMsg('Token rotated on desktop. Re-pair below.', 'warn');
    return;
  }
  if (outcome.kind === 'success') {
    showPaired(true);
    // Distinguish "capture-ready" (the push WebSocket is live, so the Natively
    // hotkey can trigger capture) from merely "paired" (HTTP reachable, but the
    // service worker's WS isn't open yet — capture would fall back to screenshot).
    let wsOpen = false;
    try {
      const r = await send<{ open: boolean }>({ type: 'ws-status' });
      wsOpen = !!r?.open;
    } catch { /* ignore */ }
    setDot('green');
    statusText.textContent = wsOpen ? 'Connected — capture ready' : 'Connected (connecting capture…)';
    return;
  }
  // Paired but desktop unreachable (refused / error / rate-limited).
  setDot('red');
  statusText.textContent =
    outcome.kind === 'refused' ? 'Desktop offline — enable Phone Mirror' : 'Desktop unreachable';
  showPaired(true);
}

function describePair(outcome: PairFetchOutcome): { text: string; kind: 'ok' | 'err' | 'warn' } {
  switch (outcome.kind) {
    case 'paired':
      return { text: 'Connected.', kind: 'ok' };
    case 'not-armed':
      return { text: 'Click "Connect browser extension" in Natively settings first.', kind: 'warn' };
    case 'forbidden':
      return { text: 'Pairing refused by desktop.', kind: 'err' };
    case 'refused':
      return { text: 'Open Natively and enable Phone Mirror.', kind: 'err' };
    case 'error':
      return { text: outcome.message, kind: 'err' };
  }
}

connectBtn.addEventListener('click', async () => {
  connectBtn.disabled = true;
  setMsg('Connecting…', '');
  const outcome = await send<PairFetchOutcome>({ type: 'autopair' });
  connectBtn.disabled = false;
  if (outcome.kind === 'paired') {
    setMsg('Connected.', 'ok');
    await refreshStatus();
  } else {
    const d = describePair(outcome);
    setMsg(d.text, d.kind);
  }
});

pairBtn.addEventListener('click', async () => {
  const value = pairInput.value.trim();
  if (!value) return;
  pairBtn.disabled = true;
  setMsg('Pairing…', '');
  const outcome = await send<DomPostOutcome>({ type: 'pair', value });
  pairBtn.disabled = false;
  if (outcome.kind === 'success') {
    pairInput.value = '';
    setMsg('Paired.', 'ok');
    await refreshStatus();
  } else {
    const d = describe(outcome);
    setMsg(d.text, d.kind);
  }
});

captureBtn.addEventListener('click', async () => {
  captureBtn.disabled = true;
  setMsg('Capturing…', '');
  const report = await send<CaptureReport>({ type: 'capture' });
  captureBtn.disabled = false;
  const d = describe(report.outcome);
  const suffix = report.outcome.kind === 'success' && report.chars ? ` (${report.chars} chars)` : '';
  setMsg(d.text + suffix, d.kind);
  if (report.outcome.kind === 'unauthorized') await refreshStatus();
});

unpairBtn.addEventListener('click', async () => {
  await send({ type: 'unpair' });
  setMsg('Unpaired.', '');
  await refreshStatus();
});

pairInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') pairBtn.click();
});

void refreshStatus();
