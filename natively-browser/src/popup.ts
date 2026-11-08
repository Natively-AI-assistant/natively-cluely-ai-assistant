/**
 * Popup UI controller. All privileged work (token storage, loopback fetch) is
 * delegated to the service worker via chrome.runtime.sendMessage — the popup
 * itself never holds the token persistently nor talks to the desktop directly.
 * The one exception is chrome.permissions.request: it needs the click's user
 * activation, which never reaches the service worker, so the popup calls it.
 *
 * Motion (popup-motion.ts): work in progress shows on the button pressed (its
 * words shimmer), a result as a drawn check there and a line in the heading's
 * corner, and a permission row folds away once Chrome has given it.
 */
import type { CaptureReport, DomPostOutcome, PairFetchOutcome } from './service-worker';
import {
  requestAllSitesPermission,
  requestOriginPermission,
} from './capture/permissions';
import { browserPlatform, modifierKeyLabel } from './hotkey-label';
import { collapse, flashDone, initButtons, resetButtonLabel, setButtonLabel, shake, swapText } from './popup-motion';

type StatusOutcome = DomPostOutcome | { kind: 'unpaired' };
type Tone = 'ok' | 'err' | 'warn' | '';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const corner = $('corner');
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

initButtons(document);

function send<R>(message: unknown): Promise<R> {
  return chrome.runtime.sendMessage(message) as Promise<R>;
}

/**
 * The heading's corner pill; `null` when all is well (connected, it shows
 * nothing). A pill already showing swaps its words; one arriving pops in
 * (CSS); one leaving just goes. `pending` shimmers ("Connecting").
 */
function setStatus(text: string | null, tone: Tone | 'pending' = ''): void {
  const apply = (): void => {
    statusText.textContent = text ?? '';
    statusText.className = 'status t-text-swap' + (tone ? ` ${tone}` : '') + (text ? '' : ' hidden');
    statusText.classList.toggle('t-shimmer', tone === 'pending');
    if (tone === 'pending' && text) statusText.dataset.text = text;
    else delete statusText.dataset.text;
  };
  const showing = !statusText.classList.contains('hidden') && statusText.getClientRects().length > 0;
  if (showing && text) swapText(statusText, apply);
  else apply();
}

/** The corner's message: swapped in place; an error also shakes the corner. */
function setMsg(text: string, kind: Tone): void {
  swapText(msg, () => {
    msg.textContent = text;
    // One line in the corner; the whole message on hover.
    msg.title = text;
    msg.className = 'msg t-text-swap' + (kind ? ` ${kind}` : '');
    if (kind === 'err') shake(corner);
  });
}

/** "https://www.youtube.com/*" -> "www.youtube.com" (display only). */
function hostOf(origin: string): string {
  return String(origin || '').replace(/^[a-z]+:\/\//i, '').replace(/\/\*$/, '');
}

function describe(outcome: DomPostOutcome): { text: string; kind: 'ok' | 'err' | 'warn' } {
  switch (outcome.kind) {
    case 'success':
      return { text: 'Sent to Natively', kind: 'ok' };
    case 'unauthorized':
      return { text: 'Pairing expired. Reconnect', kind: 'warn' };
    case 'no-session':
      return { text: 'Start a session in Natively', kind: 'warn' };
    case 'refused':
      return { text: 'Turn on Phone Mirror', kind: 'err' };
    case 'rate-limited':
      return { text: 'Too many tries. Wait a bit', kind: 'warn' };
    case 'too-large':
      return { text: 'Page too large to send', kind: 'err' };
    case 'bad-request':
      return { text: 'Natively rejected this', kind: 'err' };
    case 'http-error':
      return { text: `Unexpected response (${outcome.status})`, kind: 'err' };
    case 'needs-host-permission':
      return { text: `No access to ${hostOf(outcome.origin)}`, kind: 'warn' };
    case 'error':
      return { text: outcome.message, kind: 'err' };
  }
}

/** Swaps the pairing card for the capture card or back; the one arriving rises in (CSS). */
function showPaired(paired: boolean): void {
  pairCard.classList.toggle('hidden', paired);
  captureCard.classList.toggle('hidden', !paired);
  // Holds only the permissions still to give; with none it hides itself (CSS).
  setupCard.classList.toggle('hidden', !paired);
}

async function refreshStatus(): Promise<void> {
  const outcome = await send<StatusOutcome>({ type: 'status' });
  if (outcome.kind === 'unpaired' || outcome.kind === 'unauthorized') {
    // The pill says which; the card under it says what to do.
    setStatus(outcome.kind === 'unauthorized' ? 'Pairing expired' : 'Not paired', outcome.kind === 'unauthorized' ? 'warn' : '');
    showPaired(false);
    if (outcome.kind === 'unauthorized') setMsg('Pairing expired. Reconnect', 'warn');
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
    if (wsOpen) setStatus(null);
    else setStatus('Connecting', 'pending');
    return;
  }
  // Paired but desktop unreachable (refused / error / rate-limited).
  setStatus(outcome.kind === 'refused' ? 'Offline' : 'Can’t reach Natively', 'err');
  showPaired(true);
}

function describePair(outcome: PairFetchOutcome): { text: string; kind: 'ok' | 'err' | 'warn' } {
  switch (outcome.kind) {
    case 'paired':
      return { text: 'Connected', kind: 'ok' };
    case 'not-armed':
      return { text: 'Click Connect in Natively first', kind: 'warn' };
    case 'forbidden':
      return { text: 'Natively refused pairing', kind: 'err' };
    case 'refused':
      return { text: 'Turn on Phone Mirror', kind: 'err' };
    case 'error':
      return { text: outcome.message, kind: 'err' };
  }
}

/** A moment on the check before the capture card takes the pairing card's place. */
const PAIRED_HOLD_MS = 600;

connectBtn.addEventListener('click', async () => {
  connectBtn.disabled = true;
  setButtonLabel(connectBtn, { text: 'Connecting…', busy: true });
  const outcome = await send<PairFetchOutcome>({ type: 'autopair' });
  if (outcome.kind === 'paired') {
    setMsg('Connected', 'ok');
    await flashDone(connectBtn, 'Connected', PAIRED_HOLD_MS, false);
    await refreshStatus();
    resetButtonLabel(connectBtn);
  } else {
    setButtonLabel(connectBtn);
    const d = describePair(outcome);
    setMsg(d.text, d.kind);
  }
  connectBtn.disabled = false;
});

pairBtn.addEventListener('click', async () => {
  const value = pairInput.value.trim();
  if (!value) return;
  pairBtn.disabled = true;
  setButtonLabel(pairBtn, { text: 'Pairing…', busy: true });
  const outcome = await send<DomPostOutcome>({ type: 'pair', value });
  if (outcome.kind === 'success') {
    pairInput.value = '';
    setMsg('Paired', 'ok');
    await flashDone(pairBtn, 'Paired', PAIRED_HOLD_MS, false);
    await refreshStatus();
    resetButtonLabel(pairBtn);
  } else {
    setButtonLabel(pairBtn);
    const d = describe(outcome);
    setMsg(d.text, d.kind);
  }
  pairBtn.disabled = false;
});

captureBtn.addEventListener('click', async () => {
  captureBtn.disabled = true;
  setButtonLabel(captureBtn, { text: 'Capturing…', busy: true });
  let report = await send<CaptureReport>({ type: 'capture' });

  // This click is a user gesture, and chrome.permissions.request requires one.
  // A site outside the coding registry (a ChatGPT thread, a YouTube page, an
  // internal wiki) has no granted host, so ask for exactly this origin — never
  // a wildcard — and retry once. Denial just falls through to the normal
  // message; nothing else changes.
  if (report.outcome.kind === 'needs-host-permission') {
    const origin = report.outcome.origin;
    setMsg(`Asking for ${hostOf(origin)}…`, '');
    const grant = await requestOriginPermission(chrome.permissions, origin);
    if (grant.granted) {
      void send({ type: 'clear-grant-nudge' }).catch(() => {});
      setMsg('Access given', 'ok');
      report = await send<CaptureReport>({ type: 'capture' });
    }
  }

  captureBtn.disabled = false;
  const d = describe(report.outcome);
  const suffix = report.outcome.kind === 'success' && report.chars ? ` · ${report.chars.toLocaleString('en-US')} chars` : '';
  setMsg(d.text + suffix, d.kind);
  if (report.outcome.kind === 'success') void flashDone(captureBtn, 'Sent');
  else setButtonLabel(captureBtn);
  if (report.outcome.kind === 'unauthorized') await refreshStatus();
});

/** Whether Chrome has given what `type` asks the service worker about. */
async function granted(type: 'all-sites-status' | 'meet-reader-status'): Promise<boolean> {
  try {
    const r = await send<{ granted: boolean }>({ type });
    return !!r?.granted;
  } catch {
    return false; // shown, so it can still be asked for
  }
}

/**
 * Shows the permission rows Chrome has not given yet. With `fold`, a row that
 * goes folds away first (the whole card when it was the last), so the popup
 * closes up in one move. All sites covers meet.google.com too.
 */
async function syncSetup(fold = false): Promise<void> {
  const [allSites, meet] = await Promise.all([granted('all-sites-status'), granted('meet-reader-status')]);
  const rows: Array<[HTMLElement, boolean]> = [[allSitesRow, allSites], [meetNamesRow, meet]];
  const apply = (): void => {
    for (const [row, given] of rows) row.classList.toggle('hidden', given);
  };
  const shown = rows.filter(([row]) => !row.classList.contains('hidden'));
  const leaving = shown.filter(([, given]) => given).map(([row]) => row);
  if (!fold || !leaving.length || setupCard.classList.contains('hidden')) return apply();
  if (leaving.length === shown.length) return collapse(setupCard, apply);
  // One of two rows goes: it takes the gap beside it along.
  const [row] = leaving;
  const gap = `-${getComputedStyle(setupCard).rowGap}`;
  const staysAfter = shown.some(([other]) => other !== row && (row.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING));
  await collapse(row, apply, staysAfter ? { bottom: gap } : { top: gap });
}

/** How long a given permission's check shows before its row folds away. */
const GIVEN_HOLD_MS = 700;

// One-time blanket grant: a single Chrome prompt covering https://*/* +
// http://*/* (declared in optional_host_permissions), after which the desktop
// hotkey captures ANY site — no per-site grants.
// chrome.permissions.request MUST run directly in the popup's click handler
// because Chrome does not propagate user gestures across runtime.sendMessage
// to background service workers.
allSitesBtn.addEventListener('click', async () => {
  allSitesBtn.disabled = true;
  const r = await requestAllSitesPermission(chrome.permissions);
  if (r.granted) {
    void send({ type: 'clear-grant-nudge' }).catch(() => {});
    setMsg(r.alreadyHad ? 'Already allowed' : 'Allowed on all sites', 'ok');
    await flashDone(allSitesBtn, '', GIVEN_HOLD_MS, false);
    await syncSetup(true);
    resetButtonLabel(allSitesBtn);
  } else {
    setMsg('All sites not allowed', 'warn');
  }
  allSitesBtn.disabled = false;
});

meetNamesBtn.addEventListener('click', async () => {
  meetNamesBtn.disabled = true;
  const r = await requestOriginPermission(chrome.permissions, 'https://meet.google.com/*');
  if (r.granted) {
    await send({ type: 'meet-reader-refresh' }).catch(() => {});
    setMsg('Meet names on', 'ok');
    await flashDone(meetNamesBtn, '', GIVEN_HOLD_MS, false);
    await syncSetup(true);
    resetButtonLabel(meetNamesBtn);
  } else {
    setMsg('Meet names not allowed', 'warn');
  }
  meetNamesBtn.disabled = false;
});

unpairBtn.addEventListener('click', async () => {
  await send({ type: 'unpair' });
  setMsg('Unpaired', '');
  await refreshStatus();
});

pairInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') pairBtn.click();
});

void refreshStatus();
// Rows start hidden, so a permission already given never flashes in.
void syncSetup();
