/**
 * Background service worker — the ONLY component that holds the pairing token
 * and talks to the desktop loopback `/dom` endpoint.
 *
 * Flow per capture (one user gesture = one POST; the desktop read-and-clears,
 * so we must never auto-push or stream):
 *
 *   hotkey / popup button
 *        -> ensure pairing exists
 *        -> chrome.scripting.executeScript(content-script.js) into the active tab
 *        -> chrome.tabs.sendMessage('natively:extract')  (token NEVER crosses this)
 *        -> postDomToDesktop({ port, token }, cleanText)
 *        -> classify 200/400/401/413/429/refused and report to the popup
 */

const STORAGE_KEY = 'pairing';
const PAIR_PROBE_DOM = '__pair_probe__';

export interface Pairing {
  /**
   * Last-known good port — a CACHE HINT, not the source of truth. The live port
   * is discovered via /healthz (resolveLivePort) because it can drift between
   * desktop launches. Kept so the fast path tries the right port first.
   */
  port: number;
  token: string;
}

export type DomPostOutcome =
  | { kind: 'success' }
  | { kind: 'unauthorized' } // 401 — token rotated/invalid -> user must re-pair
  | { kind: 'no-session' } // 409 — Natively running but no active session/overlay
  | { kind: 'bad-request' } // 400
  | { kind: 'too-large' } // 413
  | { kind: 'rate-limited' } // 429
  | { kind: 'refused' } // connection refused — Phone Mirror off / port moved
  | { kind: 'http-error'; status: number }
  | { kind: 'error'; message: string };

/** Minimal injectable fetch so the core is unit-testable without a browser. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Metadata sent alongside the DOM for the desktop preview chip. */
export interface CaptureMeta {
  title?: string;
  url?: string;
  source?: string;
  pageType?: string;
  firstLine?: string;
}

/**
 * POST clean text to the desktop `/dom` endpoint and classify the result.
 * Pure relative to the injected `fetchImpl` — no globals, no chrome.* access.
 * `reqId` (v2 desktop-pull) correlates the POST with the WS capture request;
 * `meta` drives the desktop preview chip. Both optional/backward-compatible.
 */
export async function postDomToDesktop(
  pairing: Pairing,
  dom: string,
  fetchImpl: FetchLike,
  extras?: { reqId?: string; meta?: CaptureMeta; probe?: boolean; envelope?: unknown },
): Promise<DomPostOutcome> {
  const url = `http://127.0.0.1:${pairing.port}/dom?t=${encodeURIComponent(pairing.token)}`;
  const payload: Record<string, unknown> = { dom };
  if (extras?.reqId) payload.reqId = extras.reqId;
  if (extras?.meta) payload.meta = extras.meta;
  // Smart Browser Context v2: the structured envelope rides alongside the legacy
  // `dom` string. The desktop treats it as an ADDED field (back-compatible).
  if (extras?.envelope) payload.envelope = extras.envelope;
  // probe = a liveness/auth check (connection status, pairing validation). The
  // desktop still authenticates it (so status works) but must NOT deliver it to
  // the overlay as captured page content — otherwise a phantom "14 chars" chip
  // appears on every status check / meeting start.
  if (extras?.probe) payload.probe = true;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // fetch throws on connection refused / network failure (Phone Mirror off).
    return { kind: 'refused' };
  }

  switch (res.status) {
    case 200: {
      try {
        const body = (await res.json()) as { success?: boolean };
        return body && body.success ? { kind: 'success' } : { kind: 'error', message: 'Unexpected response body' };
      } catch {
        return { kind: 'error', message: 'Malformed success response' };
      }
    }
    case 400:
      return { kind: 'bad-request' };
    case 401:
      return { kind: 'unauthorized' };
    case 409:
      // Natively is running and paired, but no active session/overlay to receive
      // the context. The user must start a Natively session, then capture again.
      return { kind: 'no-session' };
    case 413:
      return { kind: 'too-large' };
    case 429:
      return { kind: 'rate-limited' };
    default:
      return { kind: 'http-error', status: res.status };
  }
}

/** Parse a `port:token` pairing string. Returns null when malformed. */
export function parsePairingString(raw: string): Pairing | null {
  const trimmed = (raw || '').trim();
  const idx = trimmed.indexOf(':');
  if (idx <= 0) return null;
  const portStr = trimmed.slice(0, idx).trim();
  const token = trimmed.slice(idx + 1).trim();
  const port = Number(portStr);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  // Token is crypto.randomBytes(24).toString('base64url') => 32 base64url chars.
  if (!/^[A-Za-z0-9_-]{16,}$/.test(token)) return null;
  return { port, token };
}

// Desktop probes DEFAULT_PORT..DEFAULT_PORT+range-1 (PhoneMirrorService:
// DEFAULT_PORT=4123, PORT_PROBE_RANGE=12). The port can drift between launches,
// so we discover it via the unauthenticated /healthz endpoint rather than trusting
// a stored value. This is what lets a paired extension survive a port change with
// no re-pair.
const PORT_BASE = 4123;
const PORT_RANGE = 12;

/**
 * Find the live PhoneMirror port by probing /healthz across the candidate range.
 * Tries `hint` first (the last-known good port) for a fast path. Returns the first
 * port whose /healthz returns 200 {ok:true}, or null if none respond (Phone Mirror
 * off). Pure relative to the injected fetch — unit-testable without a browser.
 */
export async function resolveLivePort(
  fetchImpl: FetchLike,
  hint?: number,
): Promise<number | null> {
  const candidates: number[] = [];
  if (hint && hint >= PORT_BASE && hint < PORT_BASE + PORT_RANGE) candidates.push(hint);
  for (let p = PORT_BASE; p < PORT_BASE + PORT_RANGE; p++) {
    if (p !== hint) candidates.push(p);
  }
  for (const port of candidates) {
    try {
      const res = await fetchImpl(`http://127.0.0.1:${port}/healthz`, { method: 'GET' });
      if (res.status === 200) {
        const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
        if (body && body.ok === true) return port;
      }
    } catch {
      // refused / timeout — try the next candidate.
    }
  }
  return null;
}

/** Outcome of the one-click /pair handshake. */
export type PairFetchOutcome =
  | { kind: 'paired'; token: string }
  | { kind: 'not-armed' } // 410 — desktop window not open (user must click "Connect browser")
  | { kind: 'forbidden' } // 403 — origin/loopback check failed
  | { kind: 'refused' } // Phone Mirror off / no port
  | { kind: 'error'; message: string };

/**
 * Call the desktop one-click /pair endpoint to fetch the token (no copy-paste).
 * Only succeeds when the desktop window is armed (user clicked "Connect browser").
 * Pure relative to the injected fetch.
 */
export async function fetchPairToken(
  port: number,
  fetchImpl: FetchLike,
): Promise<PairFetchOutcome> {
  let res: Response;
  try {
    // POST (not GET): a Chrome MV3 service worker reliably sends the Origin header
    // on a POST so the desktop's exact-extension-ID origin pin succeeds; a GET
    // would often omit Origin → 403. Mirrors the working /dom route.
    res = await fetchImpl(`http://127.0.0.1:${port}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
  } catch {
    return { kind: 'refused' };
  }
  if (res.status === 200) {
    try {
      const body = (await res.json()) as { token?: string };
      if (body && typeof body.token === 'string' && body.token.length >= 16) {
        return { kind: 'paired', token: body.token };
      }
      return { kind: 'error', message: 'Malformed pair response' };
    } catch {
      return { kind: 'error', message: 'Malformed pair response' };
    }
  }
  if (res.status === 410) return { kind: 'not-armed' };
  if (res.status === 403) return { kind: 'forbidden' };
  return { kind: 'error', message: `Unexpected pair status ${res.status}` };
}

// ──────────────────────────────────────────────────────────────────────────
// Tab selection (pure) — which tab to capture. Kept side-effect-free so the
// resolution logic is unit-testable with plain fixtures (no chrome stub).
// ──────────────────────────────────────────────────────────────────────────

/** Minimal tab shape the pure selectors need. */
export interface TabLite {
  id?: number;
  url?: string;
  active?: boolean;
  incognito?: boolean;
}

/** Last user-foregrounded capturable tab, persisted in chrome.storage.session. */
export interface LastActive {
  tabId: number;
  windowId?: number;
  url?: string;
  title?: string;
  ts: number;
}

// Pages we can't (or shouldn't) extract: browser-internal, the new-tab page,
// devtools, view-source, and incognito (the extension usually can't see it, and
// it's privacy-sensitive). Unified across resolution, capture, and the picker.
const INTERNAL_URL_RE = /^(chrome|edge|brave|arc|about|chrome-extension|moz-extension|devtools|view-source|chrome-untrusted):/i;

export function isCapturable(tab: TabLite | undefined | null): tab is TabLite & { id: number; url: string } {
  if (!tab || tab.id == null || !tab.url) return false;
  if (tab.incognito) return false;
  if (INTERNAL_URL_RE.test(tab.url)) return false;
  return true;
}

// A last-active record older than this is not trusted as "the page I'm on" — we
// re-confirm with a live query instead. Tuned for "I was just looking at it".
export const LAST_ACTIVE_TTL_MS = 5 * 60 * 1000;

/**
 * Pure tab chooser. Given the stored last-active record, the per-window active
 * tabs (last-focused window FIRST), and `now`, decide which tabId to capture:
 *   1. The tracked last-active tab if it's fresh (< ttl), still present, and
 *      capturable — the strongest signal ("the tab I was on before I switched").
 *   2. else the first capturable active tab, scanning windows in the given order
 *      (caller passes last-focused window first) — falls THROUGH internal pages.
 *   3. else null.
 * `windows` is an ordered array of each window's active tab.
 */
export function pickBestTab(
  lastActive: LastActive | null,
  windows: TabLite[],
  now: number,
  ttlMs: number = LAST_ACTIVE_TTL_MS,
): number | null {
  if (lastActive && now - lastActive.ts < ttlMs) {
    // Validate against current reality: the live tab for this id (if the caller
    // included it) must still be capturable. Caller passes the live tab list, so
    // confirm the id is present & capturable there.
    const live = windows.find((t) => t.id === lastActive.tabId);
    if (live && isCapturable(live)) return lastActive.tabId;
    // If the id isn't in the active-tab list it may simply not be the active tab
    // of any window right now — that's fine, fall through to the live pick.
  }
  for (const t of windows) {
    if (isCapturable(t)) return t.id!;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Below this line: chrome.* glue. Kept thin and side-effecting; the testable
// logic lives in the pure functions above.
// ---------------------------------------------------------------------------

async function getPairing(): Promise<Pairing | null> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const p = stored[STORAGE_KEY] as Partial<Pairing> | undefined;
  if (p && typeof p.port === 'number' && typeof p.token === 'string') {
    return { port: p.port, token: p.token };
  }
  return null;
}

async function setPairing(pairing: Pairing): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: pairing });
}

async function clearPairing(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

interface ExtractedTab {
  text: string;
  source?: string;
  title?: string;
  pageType?: string;
  firstLine?: string;
}

/** Run the content script in a tab and ask it to extract clean text + meta. */
async function extractFromTab(tabId: number): Promise<ExtractedTab> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content-script.js'],
  });
  const response = (await chrome.tabs.sendMessage(tabId, { type: 'natively:extract' })) as
    | { ok: true; result: { text: string; source?: string; title?: string; pageType?: string; firstLine?: string } }
    | { ok: false; error: string }
    | undefined;
  if (!response) throw new Error('No response from page');
  if (!response.ok) throw new Error(response.error || 'Extraction failed');
  return response.result;
}

export interface CaptureReport {
  outcome: DomPostOutcome;
  chars?: number;
}

/**
 * Send a DOM payload using the stored token, discovering the live port and
 * self-healing across restarts:
 *   - Resolve the port via /healthz (last-known hint first), POST.
 *   - On `refused` (stale port / app moved), re-resolve once and retry.
 *   - On `401`, re-resolve + retry once (covers a transient mint race); only
 *     drop the pairing if a re-probed 401 persists (token genuinely revoked).
 * Updates the stored port hint whenever discovery finds a new live port.
 */
async function sendDom(
  token: string,
  hintPort: number | undefined,
  dom: string,
  extras?: { reqId?: string; meta?: CaptureMeta; probe?: boolean; envelope?: unknown },
): Promise<DomPostOutcome> {
  const attempt = async (port: number): Promise<DomPostOutcome> =>
    postDomToDesktop({ port, token }, dom, fetch, extras);

  let port = await resolveLivePort(fetch, hintPort);
  if (port == null) return { kind: 'refused' };
  if (port !== hintPort) await setPairing({ port, token });

  let outcome = await attempt(port);

  // Self-heal: a stale port or a transient 401 → re-discover the live port once
  // and retry before surfacing the error (or dropping the pairing).
  if (outcome.kind === 'refused' || outcome.kind === 'unauthorized') {
    const rePort = await resolveLivePort(fetch, undefined);
    if (rePort == null) return { kind: 'refused' };
    if (rePort !== port) {
      await setPairing({ port: rePort, token });
      port = rePort;
    }
    outcome = await attempt(port);
  }

  // Only now, after a re-probe, is a 401 a genuine revocation → force re-pair.
  if (outcome.kind === 'unauthorized') {
    await clearPairing();
  }
  return outcome;
}

const LAST_ACTIVE_KEY = 'lastActive';

/** Read the tracked last-active tab from session storage (survives SW death). */
async function readLastActive(): Promise<LastActive | null> {
  try {
    const s = await chrome.storage.session.get(LAST_ACTIVE_KEY);
    const v = s[LAST_ACTIVE_KEY] as Partial<LastActive> | undefined;
    if (v && typeof v.tabId === 'number' && typeof v.ts === 'number') return v as LastActive;
  } catch { /* storage.session may be unavailable */ }
  return null;
}

/** Record the user's last-foregrounded capturable tab (on tab/window events). */
async function recordLastActive(tab: chrome.tabs.Tab): Promise<void> {
  if (!isCapturable(tab)) return;
  try {
    const rec: LastActive = {
      tabId: tab.id as number,
      windowId: tab.windowId,
      url: tab.url,
      title: tab.title,
      ts: Date.now(),
    };
    await chrome.storage.session.set({ [LAST_ACTIVE_KEY]: rec });
  } catch { /* non-fatal */ }
}

/**
 * Resolve the tab to capture. CRITICAL for the desktop-pull flow: when the
 * Natively hotkey fires, Chrome is NOT the focused OS app, so `currentWindow`
 * (the window the service worker belongs to — none) is unreliable. We prefer the
 * continuously-tracked last-active tab ("the page I was on before I switched to
 * the overlay"), then fall through to live queries of the last-focused window —
 * skipping internal/new-tab pages to the next-best window instead of erroring.
 */
async function resolveCaptureTab(): Promise<chrome.tabs.Tab | undefined> {
  // Gather active tabs across all normal windows, last-focused FIRST.
  const ordered: chrome.tabs.Tab[] = [];
  let lastFocusedId: number | undefined;
  try {
    const lf = await chrome.windows.getLastFocused({ populate: true, windowTypes: ['normal'] });
    lastFocusedId = lf?.id;
    const a = lf?.tabs?.find((t) => t.active);
    if (a) ordered.push(a);
  } catch { /* fall through */ }
  try {
    const wins = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
    for (const w of wins) {
      if (w.id === lastFocusedId) continue; // already added, keep it first
      const a = w.tabs?.find((t) => t.active);
      if (a) ordered.push(a);
    }
  } catch { /* fall through */ }
  // Currency fallback when window enumeration yielded nothing.
  if (ordered.length === 0) {
    try {
      const tabs = await chrome.tabs.query({ active: true, windowType: 'normal' });
      ordered.push(...tabs.sort((a, b) => (b.id ?? 0) - (a.id ?? 0)));
    } catch { /* give up */ }
  }

  const lastActive = await readLastActive();
  const pickedId = pickBestTab(lastActive as LastActive | null, ordered as TabLite[], Date.now());
  if (pickedId == null) return undefined;
  // Return the live tab object for the chosen id (from the active set, or fetch).
  const fromSet = ordered.find((t) => t.id === pickedId);
  if (fromSet) return fromSet;
  try { return await chrome.tabs.get(pickedId); } catch { return undefined; }
}

/**
 * Full capture pipeline for a tab. Used by the desktop WS push (reqId + optional
 * tabId), the hotkey, and the popup. When tabId is omitted, captures the active
 * tab of the last-focused browser window (robust when Chrome isn't foreground).
 */
async function captureActiveTab(opts?: { reqId?: string; tabId?: number }): Promise<CaptureReport> {
  const pairing = await getPairing();
  if (!pairing) return { outcome: { kind: 'unauthorized' } };

  let tab: chrome.tabs.Tab | undefined;
  if (typeof opts?.tabId === 'number') {
    try { tab = await chrome.tabs.get(opts.tabId); } catch { tab = undefined; }
  } else {
    tab = await resolveCaptureTab();
  }
  if (!tab || tab.id == null) return { outcome: { kind: 'error', message: 'No active tab' } };
  if (!isCapturable(tab)) {
    return { outcome: { kind: 'error', message: 'Cannot capture browser/internal pages' } };
  }

  let extracted: ExtractedTab;
  try {
    extracted = await extractFromTab(tab.id);
  } catch (err) {
    return { outcome: { kind: 'error', message: err instanceof Error ? err.message : String(err) } };
  }
  if (!extracted.text) return { outcome: { kind: 'error', message: 'Page had no readable content' } };

  const meta: CaptureMeta = {
    title: extracted.title || tab.title || '',
    url: tab.url || '',
    source: extracted.source,
    pageType: extracted.pageType,
    firstLine: extracted.firstLine,
  };
  const outcome = await sendDom(pairing.token, pairing.port, extracted.text, { reqId: opts?.reqId, meta });
  return { outcome, chars: extracted.text.length };
}

/** A smart-extract result returned by the content script (structured + legacy). */
interface SmartExtractResult {
  candidate: { matchedCategory?: string; matchedPlatform?: string; autoPolicy: string; confidenceScore: number };
  envelope: unknown | null;
  dom: string;
  blocked: boolean;
  /** Sanitized metadata for the desktop AI classifier (no body/secrets). */
  safeMetadata?: unknown;
}

interface SmartExtractOpts {
  contextId: string;
  capturedAt: number;
  mode: 'auto' | 'manual';
  fullPage?: boolean;
  classifyOnly?: boolean;
  extraCategories?: string[];
  aiApproved?: boolean;
  /** Defaults true; false drops the coding eligibility branch in smartCapture. */
  codingEnabled?: boolean;
}

/** Run the content script's smart-extract path (classify + structured extract). */
async function smartExtractFromTab(tabId: number, opts: SmartExtractOpts): Promise<SmartExtractResult> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content-script.js'] });
  const response = (await chrome.tabs.sendMessage(tabId, {
    type: 'natively:smart-extract',
    contextId: opts.contextId,
    capturedAt: opts.capturedAt,
    mode: opts.mode,
    fullPage: opts.fullPage === true,
    classifyOnly: opts.classifyOnly === true,
    extraCategories: opts.extraCategories,
    aiApproved: opts.aiApproved === true,
    // Only send the flag when explicitly disabling coding (false); omitting it
    // keeps the content-script default of coding-enabled.
    codingEnabled: opts.codingEnabled,
  })) as { ok: true; smart: SmartExtractResult } | { ok: false; error: string } | undefined;
  if (!response) throw new Error('No response from page');
  if (!response.ok) throw new Error(response.error || 'Smart extraction failed');
  return response.smart;
}

/** Desktop AI metadata classifier verdict (relayed over /classify). */
interface ClassifyVerdict {
  autoPolicy: 'auto' | 'auto_if_high_confidence' | 'ask' | 'manual' | 'blocked';
  category?: string;
}

/**
 * Ask the DESKTOP to AI-classify sanitized page metadata (never page content).
 * Returns the desktop's hard-policy verdict, or null if classification isn't
 * available (no provider, disabled, error, timeout). POSTs to /classify with the
 * extension token, exactly like /dom.
 */
async function classifyMetaWithDesktop(
  token: string,
  port: number,
  safeMetadata: unknown,
): Promise<ClassifyVerdict | null> {
  if (!safeMetadata) return null;
  const livePort = await resolveLivePort(fetch, port);
  if (livePort == null) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${livePort}/classify?t=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meta: safeMetadata }),
    });
    if (res.status !== 200) return null;
    const body = (await res.json()) as { autoPolicy?: string; category?: string };
    if (!body || typeof body.autoPolicy !== 'string') return null;
    return { autoPolicy: body.autoPolicy as ClassifyVerdict['autoPolicy'], category: body.category };
  } catch {
    return null;
  }
}

/** Outcome of an auto-context request (desktop pull just before an answer). */
export type AutoContextOutcome =
  | { kind: 'none'; reason: string } // nothing eligible to auto-attach
  | { kind: 'blocked' } // sensitive page — deliberately not captured
  | { kind: 'sent'; chars: number; category?: string }
  | DomPostOutcome;

/** Options for the desktop-pull auto-context capture (from the WS frame). */
interface AutoContextOpts {
  fullPage?: boolean;
  /** The desktop AI metadata classifier is enabled (opt-in). */
  aiClassify?: boolean;
  /** Extra opted-in categories (e.g. job_description, developer_docs). */
  extraCategories?: string[];
  /**
   * Whether high-confidence coding pages auto-attach. Defaults true; when the
   * desktop sends false ("auto-attach coding" off) the extension must NOT capture
   * a coding page even if another auto path is on.
   */
  codingEnabled?: boolean;
}

/** AI policies that mean "capture this page". */
const AI_ELIGIBLE_POLICIES = new Set(['auto', 'auto_if_high_confidence', 'ask']);

/** Post a captured smart-extract result to /dom. */
async function postSmartCapture(
  pairing: Pairing,
  reqId: string,
  tab: chrome.tabs.Tab,
  smart: SmartExtractResult,
): Promise<AutoContextOutcome> {
  const meta: CaptureMeta = {
    title: tab.title || '',
    url: tab.url || '',
    source: 'smart-auto',
    pageType: smart.candidate.matchedCategory,
  };
  const outcome = await sendDom(pairing.token, pairing.port, smart.dom, {
    reqId,
    meta,
    envelope: smart.envelope ?? undefined,
  });
  if (outcome.kind === 'success') {
    return { kind: 'sent', chars: smart.dom.length, category: smart.candidate.matchedCategory };
  }
  return outcome;
}

/**
 * Just-in-time auto-context capture. Picks the best tab, classifies it IN the
 * page, and only posts when the page is auto-eligible:
 *   - local high-confidence coding (auto / auto_if_high_confidence), OR
 *   - an opted-in extra category (job_description / developer_docs), OR
 *   - EXPERIMENTAL full-page mode (any non-sensitive page), OR
 *   - the DESKTOP AI metadata classifier approves it (opt-in).
 * Sensitive pages return `blocked` and capture NOTHING in every path. The body is
 * never read until the page is approved — the AI round-trip classifies sanitized
 * metadata first (classify-only, no body), then re-extracts only if approved.
 */
async function captureAutoContext(reqId: string, opts: AutoContextOpts = {}): Promise<AutoContextOutcome> {
  const pairing = await getPairing();
  if (!pairing) return { kind: 'unauthorized' };

  const tab = await resolveCaptureTab();
  if (!tab || tab.id == null || !isCapturable(tab)) {
    return { kind: 'none', reason: 'no capturable tab' };
  }

  const contextId = `auto-${reqId}`;
  const extraCategories = opts.extraCategories;

  // Pass 1: classify + extract whatever is LOCALLY eligible (coding / opted-in
  // categories / full-page). For a non-eligible page this reads no body (the
  // content script skips extraction) but still returns the candidate + metadata.
  let smart: SmartExtractResult;
  try {
    smart = await smartExtractFromTab(tab.id, {
      contextId,
      capturedAt: Date.now(),
      mode: 'auto',
      fullPage: opts.fullPage,
      extraCategories,
      codingEnabled: opts.codingEnabled,
    });
  } catch (err) {
    return { kind: 'none', reason: err instanceof Error ? err.message : String(err) };
  }

  // SENSITIVE FLOOR — never captured, never AI-classified.
  if (smart.blocked) return { kind: 'blocked' };

  // Locally eligible and we got content → post it.
  if (smart.dom) {
    return postSmartCapture(pairing, reqId, tab, smart);
  }

  // Not locally eligible. If the AI classifier is enabled, ask the DESKTOP to
  // classify the SANITIZED METADATA (never page content). If it approves, do a
  // second pass that actually extracts the page (aiApproved relaxes the gate).
  if (opts.aiClassify && smart.safeMetadata) {
    const verdict = await classifyMetaWithDesktop(pairing.token, pairing.port, smart.safeMetadata);
    if (verdict && verdict.autoPolicy !== 'blocked' && AI_ELIGIBLE_POLICIES.has(verdict.autoPolicy)) {
      try {
        const approved = await smartExtractFromTab(tab.id, {
          contextId,
          capturedAt: Date.now(),
          mode: 'auto',
          aiApproved: true,
        });
        if (approved.blocked) return { kind: 'blocked' }; // floor re-checked
        if (approved.dom) return postSmartCapture(pairing, reqId, tab, approved);
      } catch (err) {
        return { kind: 'none', reason: err instanceof Error ? err.message : String(err) };
      }
    }
  }

  return { kind: 'none', reason: `policy=${smart.candidate.autoPolicy}` };
}

/** Validate a pasted pairing by sending a tiny probe POST (manual fallback). */
async function pairFromString(raw: string): Promise<DomPostOutcome> {
  const parsed = parsePairingString(raw);
  if (!parsed) return { kind: 'error', message: 'Invalid format — expected port:token' };
  // Store first so sendDom's discovery/retry can self-heal the port if needed.
  await setPairing(parsed);
  const outcome = await sendDom(parsed.token, parsed.port, PAIR_PROBE_DOM, { probe: true });
  if (outcome.kind !== 'success') await clearPairing();
  return outcome;
}

/** One-click pairing: discover the port, fetch the token from /pair, store it. */
async function autoPair(): Promise<PairFetchOutcome> {
  const port = await resolveLivePort(fetch, undefined);
  if (port == null) return { kind: 'refused' };
  const result = await fetchPairToken(port, fetch);
  if (result.kind === 'paired') {
    await setPairing({ port, token: result.token });
  }
  return result;
}

async function connectionStatus(): Promise<DomPostOutcome | { kind: 'unpaired' }> {
  const pairing = await getPairing();
  if (!pairing) return { kind: 'unpaired' };
  return sendDom(pairing.token, pairing.port, PAIR_PROBE_DOM, { probe: true });
}

// ───────────────────────────────────────────────────────────────────────────
// Desktop → extension WebSocket (v2 capture trigger).
//
// The desktop pushes `capture-dom`/`list-tabs` over the same PhoneMirror /ws the
// phone uses. This lets a NATIVELY global hotkey trigger capture from any focused
// app — the old chrome.commands hotkey only fired while Chrome was frontmost.
//
// MV3 lifecycle: the service worker is killed when idle, which would tear down the
// WS. Mitigations (layered):
//   1. chrome.alarms (25s) wakes the SW and ensures the WS is open while paired.
//   2. reconnect-on-close with backoff.
//   3. (desktop side) a short capture timeout + screenshot fallback, so even a
//      briefly-dead SW degrades gracefully instead of a silent no-op.
// ───────────────────────────────────────────────────────────────────────────

let ws: WebSocket | null = null;
let wsConnecting = false;
let wsBackoffMs = 1000;
const WS_BACKOFF_MAX = 15000;

function wsSend(obj: unknown): void {
  try {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  } catch (_) { /* socket gone */ }
}

async function handleCaptureDom(reqId: string, tabId?: number): Promise<void> {
  wsSend({ type: 'capture-ack', reqId, status: 'started' });
  try {
    const report = await captureActiveTab({ reqId, tabId });
    const ok = report.outcome.kind === 'success';
    // Send the descriptive message ("No active tab", "Cannot capture browser/
    // internal pages") when present, else the outcome kind — so the desktop log
    // shows WHY a capture failed rather than just "error".
    const reason = !ok
      ? ('message' in report.outcome && report.outcome.message) || report.outcome.kind
      : undefined;
    wsSend({ type: 'capture-ack', reqId, status: ok ? 'done' : 'error', error: reason });
  } catch (err) {
    wsSend({ type: 'capture-ack', reqId, status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Desktop pull just before an answer: try to auto-attach high-confidence coding
 * context. Acks `done` when context was sent, `none` when nothing eligible (so
 * the desktop proceeds without browser context), `error` on failure. Sensitive
 * pages ack `none` (deliberately not captured).
 */
async function handleRequestAutoContext(reqId: string, opts: AutoContextOpts = {}): Promise<void> {
  wsSend({ type: 'capture-ack', reqId, status: 'started' });
  try {
    const result = await captureAutoContext(reqId, opts);
    if (result.kind === 'sent') {
      wsSend({ type: 'capture-ack', reqId, status: 'done', category: result.category });
    } else if (result.kind === 'none' || result.kind === 'blocked') {
      wsSend({ type: 'capture-ack', reqId, status: 'none', reason: result.kind === 'blocked' ? 'blocked' : result.reason });
    } else {
      const reason = ('message' in result && result.message) || result.kind;
      wsSend({ type: 'capture-ack', reqId, status: 'error', error: reason });
    }
  } catch (err) {
    wsSend({ type: 'capture-ack', reqId, status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleListTabs(reqId: string): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({});
    const list = tabs
      .filter((t) => isCapturable(t))
      .map((t) => ({ id: t.id as number, title: t.title || '', url: t.url || '' }));
    wsSend({ type: 'tabs', reqId, tabs: list });
  } catch (_) {
    wsSend({ type: 'tabs', reqId, tabs: [] });
  }
}

async function ensureWsConnected(): Promise<void> {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  if (wsConnecting) return;
  const pairing = await getPairing();
  if (!pairing) return; // not paired → nothing to connect to
  const port = await resolveLivePort(fetch, pairing.port);
  if (port == null) return; // desktop not running

  wsConnecting = true;
  try {
    const sock = new WebSocket(`ws://127.0.0.1:${port}/ws?t=${encodeURIComponent(pairing.token)}`);
    ws = sock;
    sock.onopen = () => {
      wsConnecting = false;
      wsBackoffMs = 1000;
      wsSend({ type: 'hello', role: 'extension', v: 1 });
    };
    sock.onmessage = (ev) => {
      let msg: any;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'capture-dom' && typeof msg.reqId === 'string') {
        void handleCaptureDom(msg.reqId, typeof msg.tabId === 'number' ? msg.tabId : undefined);
      } else if (msg.type === 'request-auto-context' && typeof msg.reqId === 'string') {
        void handleRequestAutoContext(msg.reqId, {
          fullPage: msg.fullPage === true,
          aiClassify: msg.aiClassify === true,
          // Defaults true; only an explicit false from the desktop disables coding.
          codingEnabled: msg.codingEnabled !== false,
          extraCategories: Array.isArray(msg.extraCategories)
            ? (msg.extraCategories as unknown[]).filter((x): x is string => typeof x === 'string')
            : undefined,
        });
      } else if (msg.type === 'list-tabs' && typeof msg.reqId === 'string') {
        void handleListTabs(msg.reqId);
      }
      // Ignore phone-targeted StreamEvents (history/token/etc.) — not for us.
    };
    sock.onclose = () => {
      wsConnecting = false;
      if (ws === sock) ws = null;
      // Reconnect with backoff (only matters while the SW is alive; the alarm
      // re-attempts on the next tick if the SW was killed).
      setTimeout(() => { void ensureWsConnected(); }, wsBackoffMs);
      wsBackoffMs = Math.min(wsBackoffMs * 2, WS_BACKOFF_MAX);
    };
    sock.onerror = () => { try { sock.close(); } catch (_) {} };
  } catch (_) {
    wsConnecting = false;
  }
}

// ----- chrome event wiring -----

type PopupMessage =
  | { type: 'pair'; value: string }
  | { type: 'autopair' }
  | { type: 'capture' }
  | { type: 'status' }
  | { type: 'ws-status' }
  | { type: 'unpair' };

/** Is the desktop capture WebSocket currently open? (live push-readiness) */
function wsIsOpen(): boolean {
  return !!ws && ws.readyState === WebSocket.OPEN;
}

// Guard so importing this module under `node --test` (to exercise the pure
// exports above) doesn't touch the chrome.* globals, which only exist in the SW.
const hasChrome = typeof globalThis !== 'undefined' &&
  typeof (globalThis as { chrome?: typeof chrome }).chrome !== 'undefined' &&
  !!chrome?.runtime?.onMessage;

if (hasChrome) {
chrome.runtime.onMessage.addListener((msg: PopupMessage, _sender, sendResponse) => {
  // These come from the popup (the extension's own context), never from a page.
  (async () => {
    switch (msg?.type) {
      case 'pair': {
        const r = await pairFromString(msg.value);
        if (r.kind === 'success') void ensureWsConnected();
        sendResponse(r);
        return;
      }
      case 'autopair': {
        const r = await autoPair();
        if (r.kind === 'paired') void ensureWsConnected();
        sendResponse(r);
        return;
      }
      case 'capture':
        sendResponse(await captureActiveTab());
        return;
      case 'status':
        sendResponse(await connectionStatus());
        return;
      case 'ws-status':
        // Ensure we're attempting a connection, then report live WS state so the
        // popup can show "capture-ready" vs merely "paired".
        void ensureWsConnected();
        sendResponse({ open: wsIsOpen() });
        return;
      case 'unpair':
        await clearPairing();
        sendResponse({ kind: 'success' });
        return;
      default:
        return;
    }
  })();
  return true; // async sendResponse
});

// NOTE: the old chrome.commands `capture-page` hotkey was removed in v2 — it only
// fired while Chrome was the focused OS app, so it never worked while the user was
// looking at the Natively overlay. Capture is now triggered by a NATIVELY global
// hotkey → desktop pushes `capture-dom` over /ws → handleCaptureDom (above).

// MV3 keep-alive: a periodic alarm wakes the SW and re-ensures the WS is open so
// the desktop can push capture commands. 25s is under Chrome's ~30s idle kill.
// Listeners are registered SYNCHRONOUSLY at top level (MV3 requirement) so they
// fire on the wake-up event that loaded the worker.
try { chrome.alarms.create('natively-ws-keepalive', { periodInMinutes: 0.5 }); } catch (_) {}
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'natively-ws-keepalive') void ensureWsConnected();
});
chrome.runtime.onStartup.addListener(() => { void ensureWsConnected(); });
chrome.runtime.onInstalled.addListener(() => { void ensureWsConnected(); });

// Wake-on-browser-interaction: these fire whenever the user touches Chrome, which
// is exactly the moment right before they'd trigger a capture. Each wakes a dead
// service worker AND re-ensures the WS is open, so by the time the user presses the
// Natively hotkey the capture channel is already live — closing the MV3 idle-death
// gap that otherwise makes the first capture fall back to a screenshot.
// They ALSO record the last-active tab (so capture picks "the page I was on") and
// signal browser activity to the desktop (so it arbitrates between multiple
// browsers — most-recently-active wins).
chrome.tabs.onActivated.addListener(({ tabId }) => {
  void ensureWsConnected();
  chrome.tabs.get(tabId).then((t) => recordLastActive(t)).catch(() => {});
});
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (info.status === 'complete' || info.url) {
    void ensureWsConnected();
    if (tab?.active) void recordLastActive(tab);
  }
});
chrome.windows.onFocusChanged.addListener((winId) => {
  if (winId !== chrome.windows.WINDOW_ID_NONE) {
    void ensureWsConnected();
    wsSend({ type: 'active', ts: Date.now() }); // desktop multi-browser arbitration
    chrome.tabs.query({ active: true, windowId: winId })
      .then((tabs) => { if (tabs[0]) void recordLastActive(tabs[0]); })
      .catch(() => {});
  }
});
chrome.action.onClicked.addListener(() => { void ensureWsConnected(); });

// Also attempt a connection as soon as the worker loads (covers the common case
// where the worker was just spun up by any event).
void ensureWsConnected();
}
