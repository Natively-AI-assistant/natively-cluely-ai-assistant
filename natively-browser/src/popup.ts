/**
 * Popup UI controller. All privileged work (token storage, loopback fetch) is
 * delegated to the service worker via chrome.runtime.sendMessage — the popup
 * itself never holds the token persistently nor talks to the desktop directly.
 * The one exception is chrome.permissions.request: it needs the click's user
 * activation, which never reaches the service worker, so the popup calls it.
 */
import type { CaptureReport, DomPostOutcome, PairFetchOutcome } from './service-worker';
import {
  requestAllSitesPermission,
  requestOriginPermission,
} from './capture/permissions';
import { browserPlatform, modifierKeyLabel } from './hotkey-label';

type StatusOutcome = DomPostOutcome | { kind: 'unpaired' };
type Tone = 'ok' | 'err' | 'warn' | '';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const statusText = $('statusText');
const pairCard = $('pairCard');
const captureCard = $('captureCard');
const setupCard = $('setupCard');
const pairInput = $<HTMLInputElement>('pairInput');
const pairBtn = $<HTMLButtonElement>('pairBtn');
const connectBtn = $<HTMLButtonElement>('connectBtn');
const captureBtn = $<HTMLButtonElement>('captureBtn');
const unpairBtn = $<HTMLButtonElement>('unpairBtn');
const allSitesRow = $('allSitesRow');
const allSitesBtn = $<HTMLButtonElement>('allSitesBtn');
// Lets the Meet reader run on meet.google.com: who is in the call and who is
// speaking, for names on Natively's transcript (sent to the local app only,
// while its meeting detection is on).
const meetNamesRow = $('meetNamesRow');
const meetNamesBtn = $<HTMLButtonElement>('meetNamesBtn');
const msg = $('msg');

// The shortcut keycaps name this keyboard's modifier (⌘ or Ctrl).
const modifier = modifierKeyLabel(browserPlatform(navigator as Navigator & { userAgentData?: { platform?: string } }));
for (const key of document.querySelectorAll<HTMLElement>('kbd[data-mod]')) key.textContent = modifier;

function send<R>(message: unknown): Promise<R> {
  return chrome.runtime.sendMessage(message) as Promise<R>;
}

/** The heading's corner pill; `null` when all is well (connected, it shows nothing). */
function setStatus(text: string | null, tone: Tone = ''): void {
  statusText.textContent = text ?? '';
  statusText.className = 'status' + (tone ? ` ${tone}` : '') + (text ? '' : ' hidden');
}

function setMsg(text: string, kind: Tone): void {
  msg.textContent = text;
  // Two lines at most in the corner; the whole message on hover.
  msg.title = text;
  msg.className = 'msg' + (kind ? ` ${kind}` : '');
}

/** "https://www.youtube.com/*" -> "www.youtube.com" (display only). */
function hostOf(origin: string): string {
  return String(origin || '').replace(/^[a-z]+:\/\//i, '').replace(/\/\*$/, '');
}

function describe(outcome: DomPostOutcome): { text: string; kind: 'ok' | 'err' | 'warn' } {
  switch (outcome.kind) {
    case 'success':
      return { text: 'Sent to Natively.', kind: 'ok' };
    case 'unauthorized':
      return { text: 'Pairing expired. Connect again.', kind: 'warn' };
    case 'no-session':
      return { text: 'Start a session in Natively, then capture again.', kind: 'warn' };
    case 'refused':
      return { text: 'Open Natively and turn on Phone Mirror.', kind: 'err' };
    case 'rate-limited':
      return { text: 'Too many requests. Wait a moment, then retry.', kind: 'warn' };
    case 'too-large':
      return { text: 'This page is too large to send.', kind: 'err' };
    case 'bad-request':
      return { text: 'Natively rejected the request.', kind: 'err' };
    case 'http-error':
      return { text: `Unexpected response (${outcome.status}).`, kind: 'err' };
    case 'needs-host-permission':
      return { text: `Chrome needs permission for ${hostOf(outcome.origin)}.`, kind: 'warn' };
    case 'error':
      return { text: outcome.message, kind: 'err' };
  }
}

function showPaired(paired: boolean): void {
  pairCard.classList.toggle('hidden', paired);
  captureCard.classList.toggle('hidden', !paired);
  // Holds only the permissions still to give; with none it hides itself (CSS).
  setupCard.classList.toggle('hidden', !paired);
}

async function refreshStatus(): Promise<void> {
  const outcome = await send<StatusOutcome>({ type: 'status' });
  if (outcome.kind === 'unpaired' || outcome.kind === 'unauthorized') {
    setStatus(outcome.kind === 'unauthorized' ? 'Pairing expired' : 'Not paired', outcome.kind === 'unauthorized' ? 'warn' : '');
    showPaired(false);
    if (outcome.kind === 'unauthorized') setMsg('Pairing expired. Connect again.', 'warn');
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
    setStatus(wsOpen ? null : 'Connecting');
    return;
  }
  // Paired but desktop unreachable (refused / error / rate-limited).
  setStatus(outcome.kind === 'refused' ? 'Natively offline' : 'Can’t reach Natively', 'err');
  showPaired(true);
}

function describePair(outcome: PairFetchOutcome): { text: string; kind: 'ok' | 'err' | 'warn' } {
  switch (outcome.kind) {
    case 'paired':
      return { text: 'Connected.', kind: 'ok' };
    case 'not-armed':
      return { text: 'Click Connect in Natively first, then press this.', kind: 'warn' };
    case 'forbidden':
      return { text: 'Natively refused the pairing.', kind: 'err' };
    case 'refused':
      return { text: 'Open Natively and turn on Phone Mirror.', kind: 'err' };
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
  let report = await send<CaptureReport>({ type: 'capture' });

  // This click is a user gesture, and chrome.permissions.request requires one.
  // A site outside the coding registry (a ChatGPT thread, a YouTube page, an
  // internal wiki) has no granted host, so ask for exactly this origin — never
  // a wildcard — and retry once. Denial just falls through to the normal
  // message; nothing else changes.
  if (report.outcome.kind === 'needs-host-permission') {
    const origin = report.outcome.origin;
    setMsg(`Asking for access to ${hostOf(origin)}…`, '');
    const grant = await requestOriginPermission(chrome.permissions, origin);
    if (grant.granted) {
      void send({ type: 'clear-grant-nudge' }).catch(() => {});
      setMsg('Access given. Capturing…', '');
      report = await send<CaptureReport>({ type: 'capture' });
    }
  }

  captureBtn.disabled = false;
  const d = describe(report.outcome);
  const suffix = report.outcome.kind === 'success' && report.chars ? ` (${report.chars} chars)` : '';
  setMsg(d.text + suffix, d.kind);
  if (report.outcome.kind === 'unauthorized') await refreshStatus();
});

// One-time blanket grant: a single Chrome prompt covering https://*/* +
// http://*/* (declared in optional_host_permissions), after which the desktop
// hotkey captures ANY site — no per-site grants.
// chrome.permissions.request MUST run directly in the popup's click handler
// because Chrome does not propagate user gestures across runtime.sendMessage
// to background service workers.
allSitesBtn.addEventListener('click', async () => {
  allSitesBtn.disabled = true;
  const r = await requestAllSitesPermission(chrome.permissions);
  allSitesBtn.disabled = false;
  if (r.granted) {
    void send({ type: 'clear-grant-nudge' }).catch(() => {});
    setMsg(r.alreadyHad ? 'Already allowed on all sites.' : 'Allowed on all sites. The hotkey works anywhere now.', 'ok');
    await refreshAllSites();
    // All sites covers meet.google.com too.
    await refreshMeetNames();
  } else {
    setMsg('Not allowed. Capture still asks site by site.', 'warn');
  }
});

meetNamesBtn.addEventListener('click', async () => {
  meetNamesBtn.disabled = true;
  const r = await requestOriginPermission(chrome.permissions, 'https://meet.google.com/*');
  meetNamesBtn.disabled = false;
  if (r.granted) {
    await send({ type: 'meet-reader-refresh' }).catch(() => {});
    setMsg('Meet transcripts will show names.', 'ok');
    await refreshMeetNames();
  } else {
    setMsg('Not allowed. Meet transcripts keep "Speaker 1".', 'warn');
  }
});

/** Hide the Meet row once meet.google.com is allowed (all sites covers it too). */
async function refreshMeetNames(): Promise<void> {
  try {
    const r = await send<{ granted: boolean }>({ type: 'meet-reader-status' });
    meetNamesRow.classList.toggle('hidden', !!r?.granted);
  } catch {
    meetNamesRow.classList.remove('hidden');
  }
}

unpairBtn.addEventListener('click', async () => {
  await send({ type: 'unpair' });
  setMsg('Unpaired.', '');
  await refreshStatus();
});

pairInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') pairBtn.click();
});

void refreshStatus();
void refreshAllSites();
void refreshMeetNames();

/** Hide the all-sites row once granted. Hidden until known, so a granted one never flashes. */
async function refreshAllSites(): Promise<void> {
  try {
    const r = await send<{ granted: boolean }>({ type: 'all-sites-status' });
    allSitesRow.classList.toggle('hidden', !!r?.granted);
  } catch {
    allSitesRow.classList.remove('hidden');
  }
}
