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

import { originPatternFromUrl } from './capture/originPattern';
import { sanitizeUrl } from './capture/classifier/tab-classifier';
// Static, NOT a dynamic import: chrome.permissions.request must run inside the
// popup's user-gesture window, and a dynamic import can resolve on a later
// microtask than that window allows ("may only be called from a user gesture").
import { requestOriginPermission, requestAllSitesPermission, hasAllSitesPermission } from './capture/permissions';
import {
  normalizeProjectPath,
  type ExternalProjectFile,
  type ProjectCaptureResult,
  type ProjectDiscovery,
  type ProjectPageIdentity,
} from './capture/project-context';
import type {
  CodingProjectPayload,
  ProjectFileContext,
} from './capture/types';

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
  // Chrome refused to run the extractor because this host was never granted.
  // Carries the origin so the popup can request exactly that one site from a
  // user gesture, and so the desktop can name the site instead of failing mute.
  | { kind: 'needs-host-permission'; origin: string; message?: string }
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

/** Options passed to the read-only MAIN-world loaded-editor probe. */
export interface LoadedProjectEditorsReadOptions {
  includeContent?: boolean;
  selectedPaths?: string[];
  previousRevisions?: Record<string, string>;
}

/** @deprecated Use {@link LoadedProjectEditorsReadOptions}. */
export type MonacoProjectReadOptions = LoadedProjectEditorsReadOptions;

/**
 * Read already-loaded editor models without interacting with the editor UI.
 * This function is intentionally self-contained because Chrome serializes it
 * into the page's MAIN world with `executeScript({ func })`.
 *
 * It never clicks, focuses, dispatches events, edits a model, or mutates the
 * host DOM. Monaco, CodeMirror 5/6, Ace, and conservatively identified plain
 * text editors are supported. Closed files that the site has not loaded remain
 * undisclosed and are reported separately by the DOM explorer provider.
 */
export function readLoadedProjectEditorsInPage(
  options: LoadedProjectEditorsReadOptions = {},
): ExternalProjectFile[] {
  type MonacoModel = {
    uri?: { path?: string; fsPath?: string; toString?: () => string };
    getLanguageId?: () => string;
    getVersionId?: () => number;
    getValueLength?: () => number;
    getValue?: () => string;
  };
  type CodeMirror5 = {
    getValue?: () => string;
    getOption?: (name: string) => unknown;
  };
  type TextDocumentLike = { toString?: () => string; length?: number };
  type CodeMirror6View = {
    state?: { doc?: TextDocumentLike };
    doc?: TextDocumentLike;
  };
  type CodeMirror6Attachment = CodeMirror6View & { view?: CodeMirror6View };
  type AceSession = {
    getValue?: () => string;
    getMode?: () => { $id?: string } | string;
  };
  type AceEditor = {
    getValue?: () => string;
    session?: AceSession;
    getSession?: () => AceSession;
  };
  type EditorElement = Element & {
    CodeMirror?: CodeMirror5;
    cmView?: CodeMirror6Attachment;
    editorView?: CodeMirror6View;
    view?: CodeMirror6View;
    state?: CodeMirror6View['state'];
    env?: { editor?: AceEditor };
    value?: unknown;
  };
  type Candidate = ExternalProjectFile & { sourceRank: number };
  type DomCandidate = {
    element: EditorElement;
    kind: 'codemirror5' | 'codemirror6' | 'ace' | 'plain';
  };

  const root = globalThis as unknown as {
    monaco?: {
      editor?: {
        getModels?: () => MonacoModel[];
      };
    };
    document?: Document;
  };

  const cleanPath = (value: string): string => {
    let path = String(value || '').trim().replace(/\\/g, '/');
    try { path = decodeURIComponent(path); } catch { /* keep the raw URI */ }
    path = path.replace(/[?#].*$/, '');
    path = path.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*\/?/i, '');
    path = path.replace(/^\/+/, '').replace(/^[a-z]:\/?/i, '').replace(/\/{2,}/g, '/');
    const parts: string[] = [];
    for (const rawPart of path.split('/')) {
      const part = rawPart.trim();
      if (!part || part === '.') continue;
      if (part === '..') parts.pop();
      else parts.push(part.replace(/[\u0000-\u001f\u007f]/g, ''));
    }
    return parts.filter(Boolean).join('/').slice(0, 512);
  };
  const knownSecretReason = (value: string): string | undefined => {
    const path = cleanPath(value);
    const segments = path.toLowerCase().split('/');
    const base = segments[segments.length - 1] || '';
    if (!base) return undefined;
    const safeTemplate = /(?:^|[._-])(?:example|sample|template|defaults?)(?:[._-]|$)/i.test(base);
    if ((base === '.env' || base.startsWith('.env.') || base.endsWith('.env')) && !safeTemplate) {
      return 'ignored known secret-bearing environment file';
    }
    if (new Set([
      '.dockercfg', '.netrc', '.npmrc', '.pypirc',
      'auth.json', 'token.json',
      'credentials.json', 'credentials.yml', 'credentials.yaml',
      'secrets.json', 'secrets.yml', 'secrets.yaml', 'secrets.toml',
      'service-account.json', 'serviceaccount.json', 'serviceaccountkey.json',
      'terraform.tfstate', 'terraform.tfstate.backup',
    ]).has(base) && !safeTemplate) {
      return 'ignored known secret-bearing file';
    }
    if (base === 'config.json' && segments[segments.length - 2] === '.docker' && !safeTemplate) {
      return 'ignored known secret-bearing Docker credential file';
    }
    if (/^(?:id_(?:rsa|dsa|ecdsa|ed25519)|.*\.(?:pem|p12|pfx|key))$/i.test(base)) {
      return 'ignored private key or certificate credential file';
    }
    return undefined;
  };
  const looksLikeFilePath = (value: string): boolean => {
    const path = cleanPath(value);
    if (!path || /[\n\r]/.test(path)) return false;
    if (knownSecretReason(path) || /^\.env\.(?:example|sample|template|defaults?)$/i.test(path.slice(path.lastIndexOf('/') + 1))) return true;
    const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
    if (/^(?:cmakelists\.txt|dockerfile|gemfile|makefile|pom\.xml|procfile|rakefile)$/i.test(base)) return true;
    return /\.(?:bash|c|cc|cfg|conf|cpp|cxx|h|hpp|cs|css|dart|dockerignore|editorconfig|env|ex|exs|gitignore|go|gradle|graphql|gql|groovy|hbs|html?|java|js|jsx|json|kt|kts|less|lua|md|mjs|mod|mts|php|pl|properties|proto|prisma|py|rb|rs|sass|scala|scss|sh|sql|svelte|swift|tf|tfvars|toml|ts|tsx|txt|vue|xml|ya?ml|zsh)$/i.test(base);
  };
  const pathFromLabel = (input: string): string => {
    const raw = String(input || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    if (!raw) return '';
    const candidates = [
      raw,
      ...raw.split(/\s+(?:—|–|•|·|\|)\s+|,\s*|\s+\((?=[^)]+\)?$)/),
    ];
    for (const candidate of candidates) {
      const cleaned = candidate
        .trim()
        .replace(/^(?:file|tab|editor|modified|unsaved|active)\s*[:\-]?\s*/i, '')
        .replace(/^\[[^\]]{1,24}\]\s*/, '')
        .replace(/\s+\([^)]*\)\s*$/, '')
        .replace(/^['"`]|['"`]$/g, '');
      const path = cleanPath(cleaned);
      if (looksLikeFilePath(path)) return path;
    }
    return '';
  };
  const stableHash = (value: string): string => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  };
  const selected = (options.selectedPaths || []).map(cleanPath).filter(Boolean);
  const previous = options.previousRevisions || {};
  const isSelected = (path: string): boolean =>
    selected.length === 0 || selected.some((entry) => path === entry || path.startsWith(`${entry}/`));
  const safeAttr = (element: EditorElement, name: string): string => {
    try {
      const value = element.getAttribute?.(name);
      return typeof value === 'string' ? value.trim() : '';
    } catch {
      return '';
    }
  };
  const safeQueryAll = (selectors: readonly string[]): EditorElement[] => {
    const document = root.document;
    if (!document) return [];
    const found: EditorElement[] = [];
    const seen = new Set<EditorElement>();
    for (const selector of selectors) {
      try {
        for (const node of Array.from(document.querySelectorAll(selector)) as EditorElement[]) {
          if (!seen.has(node)) {
            seen.add(node);
            found.push(node);
          }
        }
      } catch {
        // A hostile selector shim must not block the other read-only probes.
      }
    }
    return found;
  };
  const explicitPath = (element: EditorElement): string => {
    const attributes = [
      'data-natively-file-path', 'data-file-path', 'data-path', 'data-uri',
      'data-resource-path', 'data-model-uri', 'data-item-path', 'data-node-path',
      'data-file', 'data-key', 'data-node-key',
    ];
    for (const attribute of attributes) {
      const value = safeAttr(element, attribute);
      const path = cleanPath(value);
      if (path) return path;
    }
    return '';
  };
  const labelledPath = (element: EditorElement): string => {
    for (const attribute of ['aria-label', 'title']) {
      const value = safeAttr(element, attribute);
      const path = pathFromLabel(value);
      if (path) return path;
    }
    return '';
  };
  const pathFromElement = (element: EditorElement): string => {
    let current: EditorElement | null = element;
    for (let depth = 0; current && depth < 10; depth += 1) {
      const path = explicitPath(current);
      if (path) return path;
      current = current.parentElement as EditorElement | null;
    }
    const directLabel = labelledPath(element);
    // VS Code's explorer/tab rows keep role/selection state on the row but put
    // the exact resource path on a nested `.monaco-icon-label.explorer-item`
    // (often as a Windows-style aria-label). Keep this bounded and only inspect
    // path-oriented descendants so arbitrary editor text is never a filename.
    const nestedSelectors = [
      '[data-natively-file-path]', '[data-file-path]', '[data-path]', '[data-uri]',
      '[data-resource-path]', '[data-model-uri]', '[data-item-path]', '[data-node-path]',
      '[aria-label]', '[title]', '.monaco-icon-label', '.explorer-item',
      '.monaco-highlighted-label', '.label-name', '.file-name', '.filename',
    ];
    const nested: EditorElement[] = [];
    const nestedSeen = new Set<EditorElement>();
    for (const selector of nestedSelectors) {
      try {
        for (const descendant of Array.from(element.querySelectorAll?.(selector) || []) as EditorElement[]) {
          if (!nestedSeen.has(descendant) && nested.length < 20) {
            nestedSeen.add(descendant);
            nested.push(descendant);
          }
        }
      } catch { /* continue with the other path-oriented selectors */ }
    }
    let nestedLabel = '';
    for (const descendant of nested) {
      const path = explicitPath(descendant) || labelledPath(descendant)
        || pathFromLabel(descendant.textContent || '');
      if (path.includes('/')) return path;
      if (path && !nestedLabel) nestedLabel = path;
    }
    if (directLabel) return directLabel;
    if (nestedLabel) return nestedLabel;
    current = element.parentElement as EditorElement | null;
    for (let depth = 0; current && depth < 5; depth += 1) {
      const path = labelledPath(current);
      if (path) return path;
      current = current.parentElement as EditorElement | null;
    }
    return '';
  };
  const languageFromAttrs = (element: EditorElement): string | undefined => {
    let current: EditorElement | null = element;
    for (let depth = 0; current && depth < 6; depth += 1) {
      for (const attribute of ['data-natively-language', 'data-language', 'data-lang', 'data-mode', 'data-editor-language']) {
        const language = safeAttr(current, attribute);
        if (language) return language.replace(/^ace\/mode\//i, '').replace(/^language-/i, '');
      }
      const className = typeof current.className === 'string' ? current.className : '';
      const classLanguage = className.match(/(?:^|\s)(?:language|lang)-([\w-]+)/i)?.[1];
      if (classLanguage) return classLanguage;
      current = current.parentElement as EditorElement | null;
    }
    return undefined;
  };
  const textFromCodeMirrorContent = (element: EditorElement): string | undefined => {
    try {
      const content = element.querySelector?.('.cm-content') as EditorElement | null;
      if (!content) return undefined;
      const lines = Array.from(content.querySelectorAll?.('.cm-line') || []) as EditorElement[];
      if (lines.length) return lines.map((line) => line.textContent || '').join('\n');
      return typeof content.textContent === 'string' ? content.textContent : undefined;
    } catch {
      return undefined;
    }
  };
  const insideKnownEditor = (element: EditorElement): boolean => {
    try {
      if (typeof element.closest === 'function') {
        return Boolean(element.closest('.monaco-editor, .CodeMirror, .cm-editor, .ace_editor'));
      }
    } catch { /* fall through to parent inspection */ }
    let current = element.parentElement as EditorElement | null;
    while (current) {
      const className = typeof current.className === 'string' ? current.className : '';
      if (/(?:^|\s)(?:monaco-editor|CodeMirror|cm-editor|ace_editor)(?:\s|$)/.test(className)) return true;
      current = current.parentElement as EditorElement | null;
    }
    return false;
  };
  const tabs = safeQueryAll([
    '[role="tab"]', '[data-natively-file-path][aria-selected]', '[data-file-path][aria-selected]',
    '[data-path][aria-selected]', '[data-resource-path][aria-selected]',
  ]).map((element) => ({
    element,
    path: pathFromElement(element),
    active: safeAttr(element, 'aria-selected') === 'true'
      || /(?:^|\s)(?:active|selected)(?:\s|$)/i.test(typeof element.className === 'string' ? element.className : ''),
  })).filter((tab) => Boolean(tab.path));
  const pathFromMountedTab = (element: EditorElement, editorCount: number): string => {
    const editorId = safeAttr(element, 'id');
    if (editorId) {
      const controlling = tabs.find((tab) => safeAttr(tab.element, 'aria-controls') === editorId);
      if (controlling) return controlling.path;
    }
    const active = tabs.filter((tab) => tab.active);
    if (editorCount === 1 && active.length === 1) return active[0].path;
    // Never pair multiple editors to tabs by DOM position. Split panes and
    // virtualized tab strips do not guarantee matching order, so positional
    // pairing can silently attach one file's body under another file's path.
    return '';
  };

  const byPath = new Map<string, Candidate>();
  const addCandidate = (candidate: Candidate): void => {
    if (!candidate.path) return;
    const current = byPath.get(candidate.path);
    if (!current
      || candidate.sourceRank > current.sourceRank
      || (candidate.sourceRank === current.sourceRank && current.content === undefined && candidate.content !== undefined)) {
      byPath.set(candidate.path, candidate);
    }
  };

  const models = root.monaco?.editor?.getModels?.();
  if (Array.isArray(models)) {
    for (const model of models) {
      try {
        const rawPath = model.uri?.path || model.uri?.fsPath || model.uri?.toString?.() || '';
        const path = cleanPath(rawPath);
        if (!path) continue;
        const secretReason = knownSecretReason(path);
        if (secretReason) {
          addCandidate({
            path,
            charCount: 0,
            readable: false,
            reason: secretReason,
            sourceRank: 60,
          });
          continue;
        }
        let snapshot: string | undefined;
        try {
          if (typeof model.getValue === 'function') snapshot = String(model.getValue());
        } catch {
          // Keep the descriptor, but do not claim that an unreadable model has a
          // stable revision. The next capture will retry instead of reusing stale
          // content.
        }

        // Monaco version ids are scoped to a model instance and can restart after
        // a page/model reload. A content-derived revision remains comparable across
        // instances, so a reloaded model can never silently reuse stale source.
        const revision = snapshot === undefined ? undefined : `content-${stableHash(snapshot)}`;
        const content = snapshot !== undefined
          && options.includeContent === true
          && isSelected(path)
          && previous[path] !== revision
          ? snapshot
          : undefined;
        const charCount = snapshot !== undefined ? snapshot.length : Number(model.getValueLength?.() ?? 0);
        addCandidate({
          path,
          language: model.getLanguageId?.() || undefined,
          revision,
          charCount: Number.isFinite(charCount) ? charCount : 0,
          readable: snapshot !== undefined,
          content,
          sourceRank: 50,
        });
      } catch {
        // A single hostile/broken model must not block the remaining editors.
      }
    }
  }

  const domCandidates: DomCandidate[] = [];
  const seenElements = new Set<EditorElement>();
  const addElements = (kind: DomCandidate['kind'], elements: EditorElement[]): void => {
    for (const element of elements) {
      if (!seenElements.has(element)) {
        seenElements.add(element);
        domCandidates.push({ element, kind });
      }
    }
  };
  addElements('codemirror5', safeQueryAll(['.CodeMirror'])
    .filter((element) => typeof element.CodeMirror?.getValue === 'function'));
  addElements('codemirror6', safeQueryAll(['.cm-editor']));
  addElements('ace', safeQueryAll(['.ace_editor']).filter((element) => {
    const editor = element.env?.editor;
    return typeof editor?.getValue === 'function'
      || typeof editor?.session?.getValue === 'function'
      || typeof editor?.getSession === 'function';
  }));
  addElements('plain', safeQueryAll(['textarea', '[contenteditable="true"]', '[contenteditable="plaintext-only"]'])
    .filter((element) => !insideKnownEditor(element) && Boolean(pathFromElement(element))));

  domCandidates.forEach(({ element, kind }) => {
    try {
      const path = pathFromElement(element)
        || (kind === 'plain' ? '' : pathFromMountedTab(element, domCandidates.length));
      if (!path) return;

      const secretReason = knownSecretReason(path);
      if (secretReason) {
        addCandidate({
          path,
          language: languageFromAttrs(element),
          charCount: 0,
          readable: false,
          reason: secretReason,
          sourceRank: 60,
        });
        return;
      }

      let content: string | undefined;
      let descriptorCharCount: number | undefined;
      let readable = true;
      let reason: string | undefined;
      let language = languageFromAttrs(element);
      let sourceRank = 10;
      if (kind === 'codemirror5') {
        content = String(element.CodeMirror?.getValue?.() ?? '');
        const mode = element.CodeMirror?.getOption?.('mode');
        if (!language) language = typeof mode === 'string'
          ? mode
          : (mode && typeof mode === 'object' && 'name' in mode ? String((mode as { name?: unknown }).name || '') : undefined);
        sourceRank = 40;
      } else if (kind === 'codemirror6') {
        const attached = element.cmView;
        const view = attached?.view || attached || element.editorView || element.view;
        const doc = view?.state?.doc || view?.doc
          || attached?.state?.doc
          || element.state?.doc;
        if (doc && typeof doc.toString === 'function') {
          content = String(doc.toString());
          sourceRank = 40;
        } else {
          const viewportText = textFromCodeMirrorContent(element);
          descriptorCharCount = viewportText?.length ?? 0;
          readable = false;
          reason = 'CodeMirror 6 exposes only a virtualized viewport; the full document is unavailable';
          sourceRank = 20;
        }
      } else if (kind === 'ace') {
        const editor = element.env?.editor;
        const session = editor?.session || editor?.getSession?.();
        if (typeof session?.getValue === 'function') content = String(session.getValue());
        else if (typeof editor?.getValue === 'function') content = String(editor.getValue());
        const mode = session?.getMode?.();
        if (!language) language = (typeof mode === 'string' ? mode : mode?.$id)?.replace(/^ace\/mode\//i, '');
        sourceRank = 40;
      } else if (typeof element.value === 'string') {
        content = element.value;
      } else if (typeof element.textContent === 'string') {
        content = element.textContent;
      }
      if (content === undefined && readable) return;

      const revision = content === undefined ? undefined : `content-${stableHash(content)}`;
      addCandidate({
        path,
        language: language || undefined,
        revision,
        charCount: content?.length ?? descriptorCharCount ?? 0,
        readable,
        ...(reason ? { reason } : {}),
        content: readable && options.includeContent === true && isSelected(path) && previous[path] !== revision
          ? content
          : undefined,
        sourceRank,
      });
    } catch {
      // Editor internals are not public APIs; skip only the broken instance.
    }
  });

  return [...byPath.values()].map(({ sourceRank: _sourceRank, ...file }) => file);
}

/**
 * Read a BrowserFS asynchronous key-value filesystem from an existing
 * IndexedDB database in this frame.
 *
 * HackerRank's browser VS Code keeps closed project files in this format in a
 * separate extension-host iframe, where no Monaco model is exposed. This probe
 * deliberately uses only `readonly` transactions and follows references from
 * BrowserFS's `/` inode; it never scans unrelated records, opens a guessed
 * database, upgrades a schema, or invokes the page's filesystem APIs.
 *
 * The function is self-contained because Chrome serializes it into MAIN world.
 */
export async function readBrowserFsIndexedDbProjectFilesInPage(
  options: LoadedProjectEditorsReadOptions = {},
): Promise<ExternalProjectFile[]> {
  type BrowserFsInode = {
    dataId: string;
    size: number;
    kind: 'file' | 'directory';
    revision: string;
  };

  const factory = (globalThis as unknown as { indexedDB?: IDBFactory }).indexedDB;
  if (!factory || typeof factory.databases !== 'function') return [];

  // These are probe limits, not prompt limits. The project assembler applies
  // the much smaller 7k/file and 22k/total prompt budgets after this read.
  const MAX_DATABASES = 4;
  const MAX_STORES = 4;
  const MAX_DEPTH = 24;
  const MAX_NODES = 1_024;
  const MAX_FILES = 300;
  const MAX_DIRECTORY_BYTES = 256 * 1_024;
  const MAX_FILE_BYTES = 512 * 1_024;
  const MAX_TOTAL_FILE_BYTES = 2 * 1_024 * 1_024;
  const MAX_RECORD_READS = 2_100;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const SOURCE_EXTENSIONS = new Set([
    'bash', 'c', 'cc', 'cfg', 'conf', 'cpp', 'cxx', 'h', 'hpp', 'cs', 'css', 'dart',
    'dockerignore', 'editorconfig', 'env', 'ex', 'exs', 'gitignore', 'go', 'gradle',
    'graphql', 'gql', 'groovy', 'hbs', 'html', 'htm', 'java', 'js', 'jsx', 'json',
    'kt', 'kts', 'less', 'lua', 'md', 'mjs', 'mod', 'mts', 'php', 'pl', 'properties',
    'proto', 'prisma', 'py', 'rb', 'rs', 'sass', 'scala', 'scss', 'sh', 'sql',
    'svelte', 'swift', 'tf', 'tfvars', 'toml', 'ts', 'tsx', 'txt', 'vue', 'xml',
    'yaml', 'yml', 'zsh',
  ]);
  const SOURCE_FILENAMES = new Set([
    'cmakelists.txt', 'dockerfile', 'gemfile', 'makefile', 'pom.xml', 'procfile', 'rakefile',
  ]);
  const BINARY_EXTENSIONS = new Set([
    '7z', 'a', 'avi', 'bin', 'bmp', 'class', 'db', 'dll', 'dylib', 'eot', 'exe',
    'gif', 'gz', 'ico', 'jar', 'jpeg', 'jpg', 'lockb', 'map', 'mov', 'mp3', 'mp4',
    'o', 'ogg', 'otf', 'pdf', 'png', 'pyc', 'so', 'sqlite', 'tar', 'tgz', 'ttf',
    'wav', 'webm', 'webp', 'woff', 'woff2', 'xz', 'zip',
  ]);
  const IGNORED_DIRECTORIES = new Set([
    '.git', '.gradle', '.idea', '.next', '.nuxt', '.output', '.turbo', '.vscode',
    '__pycache__', 'bower_components', 'build', 'coverage', 'deps', 'dist', 'generated',
    'node_modules', 'out', 'target', 'vendor',
  ]);

  const cleanPath = (value: string): string => {
    const parts: string[] = [];
    for (const rawPart of String(value || '').replace(/\\/g, '/').split('/')) {
      const part = rawPart.trim().replace(/[\u0000-\u001f\u007f]/g, '');
      if (!part || part === '.') continue;
      if (part === '..') parts.pop();
      else parts.push(part);
    }
    return parts.join('/').slice(0, 512);
  };
  const knownSecretReason = (value: string): string | undefined => {
    const path = cleanPath(value);
    const segments = path.toLowerCase().split('/');
    const base = segments[segments.length - 1] || '';
    if (!base) return undefined;
    const safeTemplate = /(?:^|[._-])(?:example|sample|template|defaults?)(?:[._-]|$)/i.test(base);
    if ((base === '.env' || base.startsWith('.env.') || base.endsWith('.env')) && !safeTemplate) {
      return 'ignored known secret-bearing environment file';
    }
    if (new Set([
      '.dockercfg', '.netrc', '.npmrc', '.pypirc',
      'auth.json', 'token.json',
      'credentials.json', 'credentials.yml', 'credentials.yaml',
      'secrets.json', 'secrets.yml', 'secrets.yaml', 'secrets.toml',
      'service-account.json', 'serviceaccount.json', 'serviceaccountkey.json',
      'terraform.tfstate', 'terraform.tfstate.backup',
    ]).has(base) && !safeTemplate) {
      return 'ignored known secret-bearing file';
    }
    if (base === 'config.json' && segments[segments.length - 2] === '.docker' && !safeTemplate) {
      return 'ignored known secret-bearing Docker credential file';
    }
    if (/^(?:id_(?:rsa|dsa|ecdsa|ed25519)|.*\.(?:pem|p12|pfx|key))$/i.test(base)) {
      return 'ignored private key or certificate credential file';
    }
    return undefined;
  };
  const pathKind = (path: string): 'text' | 'binary' | 'unknown' => {
    const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
    if (/^\.env\.(?:example|sample|template|defaults?)$/i.test(base)) return 'text';
    if (SOURCE_FILENAMES.has(base)) return 'text';
    const extension = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : '';
    if (BINARY_EXTENSIONS.has(extension)) return 'binary';
    if (SOURCE_EXTENSIONS.has(extension)) return 'text';
    return 'unknown';
  };
  const selectedPaths = (options.selectedPaths || []).map(cleanPath).filter(Boolean);
  const isSelected = (path: string): boolean => selectedPaths.length === 0
    || selectedPaths.some((entry) => path === entry || path.startsWith(`${entry}/`));
  const previous = options.previousRevisions || {};
  const bytesFromValue = (value: unknown): Uint8Array | null => {
    if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
    if (ArrayBuffer.isView(value)) {
      const view = value as ArrayBufferView;
      return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
    }
    return null;
  };
  const hashBytes = (bytes: Uint8Array): string => {
    let hash = 0x811c9dc5;
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  };
  const parseInode = (bytes: Uint8Array): BrowserFsInode | null => {
    // BrowserFS v1 serializes 30 bytes of fixed metadata plus a 36-byte UUID.
    // Reject other layouts rather than guessing offsets into an unrelated DB.
    if (bytes.byteLength !== 66) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const size = view.getUint32(0, true);
    const type = view.getUint16(4, true) & 0xf000;
    if (type !== 0x4000 && type !== 0x8000) return null;
    let dataId = '';
    for (let index = 30; index < 66; index += 1) dataId += String.fromCharCode(bytes[index]);
    if (!UUID.test(dataId)) return null;
    return {
      dataId,
      size,
      kind: type === 0x4000 ? 'directory' : 'file',
      revision: `browserfs-${hashBytes(bytes)}`,
    };
  };
  const parseDirectory = (bytes: Uint8Array): Record<string, string> | null => {
    if (bytes.byteLength > MAX_DIRECTORY_BYTES) return null;
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const parsed = JSON.parse(decoded) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      const entries = Object.entries(parsed as Record<string, unknown>);
      if (entries.length > MAX_NODES) return null;
      const result: Record<string, string> = Object.create(null) as Record<string, string>;
      for (const [name, inodeId] of entries) {
        if (!name || name.length > 255 || name === '.' || name === '..'
          || /[\/\\\u0000-\u001f\u007f]/.test(name)
          || typeof inodeId !== 'string' || !UUID.test(inodeId)) return null;
        result[name] = inodeId;
      }
      return result;
    } catch {
      return null;
    }
  };
  const decodeTextFile = (bytes: Uint8Array): string | null => {
    if (bytes.includes(0)) return null;
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      let suspiciousControls = 0;
      for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        if (code < 32 && code !== 9 && code !== 10 && code !== 13) suspiciousControls += 1;
      }
      if (suspiciousControls > Math.max(2, Math.floor(text.length / 100))) return null;
      return text;
    } catch {
      return null;
    }
  };
  const openExistingDatabase = (name: string): Promise<IDBDatabase | null> => new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    let settled = false;
    let upgradeAttempted = false;
    const finish = (database: IDBDatabase | null): void => {
      if (settled) {
        database?.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(database);
    };
    const timer = setTimeout(() => finish(null), 1_000);
    try {
      request = factory.open(name);
    } catch {
      finish(null);
      return;
    }
    request.onupgradeneeded = () => {
      // A database removed between `databases()` and `open()` would otherwise
      // be recreated. Abort that implicit upgrade and report no provider.
      upgradeAttempted = true;
      try { request.transaction?.abort(); } catch { /* already aborting */ }
    };
    request.onerror = () => finish(null);
    request.onblocked = () => finish(null);
    request.onsuccess = () => {
      if (upgradeAttempted || request.result.name !== name) {
        request.result.close();
        finish(null);
      } else {
        finish(request.result);
      }
    };
  });

  let databaseInfos: IDBDatabaseInfo[];
  try {
    databaseInfos = await factory.databases();
  } catch {
    return [];
  }
  const databaseNames = [...new Set(databaseInfos
    .map((info) => info.name)
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
    .filter((name) => /browserfs|(?:^|[-_.])memfs(?:$|[-_.])/i.test(name)))]
    .sort((left, right) => (left === 'vscode-memfs' ? -1 : right === 'vscode-memfs' ? 1 : left < right ? -1 : 1))
    .slice(0, MAX_DATABASES);

  for (const databaseName of databaseNames) {
    const database = await openExistingDatabase(databaseName);
    if (!database) continue;
    try {
      const storeNames = Array.from(database.objectStoreNames)
        .filter((name) => name === databaseName || /browserfs|memfs/i.test(name))
        .sort((left, right) => (left === databaseName ? -1 : right === databaseName ? 1 : left < right ? -1 : 1))
        .slice(0, MAX_STORES);

      for (const storeName of storeNames) {
        let shapeIsCompatible = false;
        try {
          const store = database.transaction(storeName, 'readonly').objectStore(storeName);
          shapeIsCompatible = store.keyPath === null && store.autoIncrement === false;
        } catch {
          shapeIsCompatible = false;
        }
        if (!shapeIsCompatible) continue;

        let recordReads = 0;
        const readRecord = (key: string): Promise<Uint8Array | null> => new Promise((resolve) => {
          if (recordReads >= MAX_RECORD_READS) {
            resolve(null);
            return;
          }
          recordReads += 1;
          try {
            const transaction = database.transaction(storeName, 'readonly');
            const request = transaction.objectStore(storeName).get(key);
            let done = false;
            const finish = (value: Uint8Array | null): void => {
              if (done) return;
              done = true;
              clearTimeout(timer);
              resolve(value);
            };
            const timer = setTimeout(() => finish(null), 750);
            request.onsuccess = () => finish(bytesFromValue(request.result));
            request.onerror = () => finish(null);
            transaction.onabort = () => finish(null);
            transaction.onerror = () => finish(null);
          } catch {
            resolve(null);
          }
        });

        const rootBytes = await readRecord('/');
        const rootInode = rootBytes ? parseInode(rootBytes) : null;
        if (!rootInode || rootInode.kind !== 'directory') continue;

        const files: ExternalProjectFile[] = [];
        const visitedInodes = new Set<string>();
        const queue: Array<{ path: string; inode: BrowserFsInode; inodeId: string; depth: number }> = [
          { path: '', inode: rootInode, inodeId: '/', depth: 0 },
        ];
        let nodes = 0;
        let totalFileBytes = 0;
        let structurallyInvalid = false;

        while (queue.length && nodes < MAX_NODES && files.length < MAX_FILES) {
          const current = queue.shift()!;
          if (visitedInodes.has(current.inodeId)) continue;
          visitedInodes.add(current.inodeId);
          nodes += 1;

          if (current.inode.kind === 'directory') {
            if (current.depth > MAX_DEPTH) continue;
            const directoryBytes = await readRecord(current.inode.dataId);
            const listing = directoryBytes ? parseDirectory(directoryBytes) : null;
            if (!listing) {
              structurallyInvalid = current.path === '';
              if (structurallyInvalid) break;
              continue;
            }
            for (const [name, inodeId] of Object.entries(listing)) {
              const path = cleanPath(current.path ? `${current.path}/${name}` : name);
              if (!path || path.length > 512) continue;
              const inodeBytes = await readRecord(inodeId);
              const inode = inodeBytes ? parseInode(inodeBytes) : null;
              if (!inode) continue;
              if (inode.kind === 'directory' && IGNORED_DIRECTORIES.has(name.toLowerCase())) continue;
              queue.push({ path, inode, inodeId, depth: current.depth + 1 });
              if (queue.length + nodes >= MAX_NODES) break;
            }
            continue;
          }

          const path = cleanPath(current.path);
          if (!path) continue;
          const descriptor: ExternalProjectFile = {
            path,
            charCount: current.inode.size,
            revision: current.inode.revision,
            readable: true,
          };
          const secretReason = knownSecretReason(path);
          const kind = pathKind(path);
          if (secretReason) {
            descriptor.readable = false;
            descriptor.reason = secretReason;
          } else if (kind === 'binary') {
            descriptor.readable = false;
            descriptor.reason = 'ignored binary file type';
          } else if (kind === 'unknown') {
            descriptor.readable = false;
            descriptor.reason = 'file type is not supported for text capture';
          } else if (current.inode.size > MAX_FILE_BYTES) {
            descriptor.readable = false;
            descriptor.reason = `file exceeds the ${MAX_FILE_BYTES}-byte read limit`;
          } else if (options.includeContent === true
            && isSelected(path)
            && previous[path] !== current.inode.revision) {
            if (totalFileBytes + current.inode.size > MAX_TOTAL_FILE_BYTES) {
              descriptor.readable = false;
              descriptor.reason = 'BrowserFS project read budget was exhausted';
            } else {
              const data = await readRecord(current.inode.dataId);
              if (!data || data.byteLength !== current.inode.size) {
                descriptor.readable = false;
                descriptor.reason = 'BrowserFS file data is missing or inconsistent';
              } else {
                totalFileBytes += data.byteLength;
                const content = decodeTextFile(data);
                if (content === null) {
                  descriptor.readable = false;
                  descriptor.reason = 'file data is not valid UTF-8 text';
                } else {
                  descriptor.content = content;
                  descriptor.charCount = content.length;
                }
              }
            }
          }
          files.push(descriptor);
        }

        // A valid root directory is the format discriminator. Nested corruption
        // omits only that branch; an invalid root fails the entire candidate.
        if (!structurallyInvalid && files.length > 0) return files;
      }
    } finally {
      database.close();
    }
  }
  return [];
}

/** @deprecated Kept for integrations that imported the Monaco-only probe. */
export const readMonacoProjectModelsInPage = readLoadedProjectEditorsInPage;

/**
 * Return cross-origin iframe origins that look like embedded browser IDEs.
 *
 * This function is self-contained because Chrome serializes it into the top
 * frame. It returns origins only (never iframe paths, queries, or page data),
 * which lets the service worker explain the otherwise-silent allFrames gap and
 * request precisely the missing optional host permission from a user gesture.
 */
export function findProjectIframePermissionCandidatesInPage(): string[] {
  type FrameElement = Element & {
    contentDocument?: Document | null;
    src?: string;
    name?: string;
    id?: string;
    className?: string;
  };
  const root = globalThis as unknown as { document?: Document; location?: Location };
  const document = root.document;
  if (!document) return [];
  const pageUrl = root.location?.href || document.location?.href || '';
  let pageOrigin = '';
  let pageHost = '';
  try {
    const parsedPage = new URL(pageUrl);
    pageOrigin = parsedPage.origin;
    pageHost = parsedPage.hostname.toLowerCase();
  } catch { /* a synthetic or opaque top frame has no comparable origin */ }

  let frames: FrameElement[] = [];
  try {
    frames = Array.from(document.querySelectorAll('iframe[src]')) as FrameElement[];
  } catch {
    return [];
  }

  const origins = new Set<string>();
  for (const frame of frames.slice(0, 64)) {
    try {
      const rawSrc = frame.getAttribute?.('src') || frame.src || '';
      const parsed = new URL(rawSrc, pageUrl || undefined);
      if (!/^https?:$/.test(parsed.protocol) || parsed.origin === pageOrigin) continue;

      let inaccessible = true;
      try { inaccessible = !frame.contentDocument; } catch { inaccessible = true; }
      if (!inaccessible) continue;

      const host = parsed.hostname.toLowerCase();
      const descriptor = [
        host,
        parsed.pathname,
        frame.getAttribute?.('title') || '',
        frame.getAttribute?.('aria-label') || '',
        frame.name || '',
        frame.id || '',
        typeof frame.className === 'string' ? frame.className : '',
      ].join(' ').toLowerCase();
      const knownHackerRankIde = (pageHost === 'hackerrank.com' || pageHost.endsWith('.hackerrank.com'))
        && (host === 'hrcdn.net' || host.endsWith('.hrcdn.net'));
      const looksLikeIde = knownHackerRankIde
        || /(?:^|[.\/_-])(?:browser-ide|code-editor|codeeditor|vscode|monaco|workspace|coding-editor)(?:[.\/_-]|$)/i.test(descriptor)
        || /\b(?:project|challenge)\b[^\n]{0,40}\b(?:ide|editor)\b/i.test(descriptor);
      if (looksLikeIde) origins.add(`${parsed.origin}/*`);
    } catch {
      // Malformed/hostile iframe metadata must not hide another candidate.
    }
  }
  return [...origins];
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
  await clearAllProjectSnapshots();
}

interface ExtractedTab {
  text: string;
  source?: string;
  title?: string;
  pageType?: string;
  firstLine?: string;
}

/** Run the content script in a tab and ask it to extract clean text + meta. */
export async function extractFromTab(tabId: number): Promise<ExtractedTab> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content-script.js'],
  });
  const response = (await chrome.tabs.sendMessage(
    tabId,
    { type: 'natively:extract' },
    { frameId: 0 },
  )) as
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
    const message = err instanceof Error ? err.message : String(err);
    // Chrome's own wording when the host was never granted:
    //   Cannot access contents of url "https://…". Extension manifest must
    //   request permission to access this host.
    // Report it as its own outcome carrying the origin, so callers can offer a
    // one-click grant instead of showing a raw internal error (or, on the
    // desktop pull, silently falling back to a screenshot that then fails too).
    if (/Cannot access contents of|must request permission to access this host|Missing host permission/i.test(message)) {
      const origin = originPatternFromUrl(tab.url || '');
      if (origin) return { outcome: { kind: 'needs-host-permission', origin } };
    }
    return { outcome: { kind: 'error', message } };
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

const PROJECT_SNAPSHOT_PREFIX = 'projectSnapshot:';

export interface ProjectSelectionSnapshot {
  selectedPaths: string[];
  files: ProjectFileContext[];
  /** Number of files exposed by discovery when this snapshot was captured. */
  totalFileCount?: number;
  /** True only when every readable discovery descriptor was selected. */
  wholeProjectSelected?: boolean;
}

interface StoredProjectSnapshot extends ProjectSelectionSnapshot {
  contextId: string;
  workspaceId: string;
  capturedAt: number;
}

export interface ProjectDiscoveryReport {
  outcome: DomPostOutcome;
  project?: ProjectDiscovery;
  ownerTarget?: ProjectDocumentTarget;
  tabId?: number;
  refreshAvailable?: boolean;
  previousSelectedPaths?: string[];
}

export interface ProjectCaptureReport extends CaptureReport {
  fileCount?: number;
  omittedCount?: number;
  truncatedCount?: number;
  unchanged?: boolean;
}

function projectSnapshotKey(tabId: number, workspaceId: string): string {
  return `${PROJECT_SNAPSHOT_PREFIX}${tabId}:${workspaceId}`;
}

async function readProjectSnapshot(tabId: number, workspaceId: string): Promise<StoredProjectSnapshot | null> {
  try {
    const key = projectSnapshotKey(tabId, workspaceId);
    const stored = await chrome.storage.session.get(key);
    const value = stored[key] as StoredProjectSnapshot | undefined;
    if (value && value.workspaceId === workspaceId && Array.isArray(value.files)) return value;
  } catch { /* session storage is best-effort */ }
  return null;
}

async function readLatestProjectSnapshotForTab(tabId: number): Promise<StoredProjectSnapshot | null> {
  try {
    const stored = await chrome.storage.session.get(null);
    const prefix = `${PROJECT_SNAPSHOT_PREFIX}${tabId}:`;
    const candidates = Object.entries(stored)
      .filter(([key]) => key.startsWith(prefix))
      .map(([, value]) => value as StoredProjectSnapshot)
      .filter((value) => value && Array.isArray(value.files) && typeof value.capturedAt === 'number')
      .sort((left, right) => right.capturedAt - left.capturedAt);
    return candidates[0] || null;
  } catch {
    return null;
  }
}

async function writeProjectSnapshot(
  tabId: number,
  payload: CodingProjectPayload,
  contextId: string,
  wholeProjectSelected: boolean,
): Promise<void> {
  try {
    const value: StoredProjectSnapshot = {
      contextId,
      workspaceId: payload.workspaceId,
      selectedPaths: payload.selectedPaths,
      files: payload.files,
      totalFileCount: payload.totalFileCount,
      wholeProjectSelected,
      capturedAt: Date.now(),
    };
    await chrome.storage.session.set({ [projectSnapshotKey(tabId, payload.workspaceId)]: value });
  } catch { /* project refresh still works as a full capture */ }
}

async function clearProjectSnapshotsForTab(tabId: number): Promise<void> {
  try {
    const stored = await chrome.storage.session.get(null);
    const prefix = `${PROJECT_SNAPSHOT_PREFIX}${tabId}:`;
    const keys = Object.keys(stored).filter((key) => key.startsWith(prefix));
    if (keys.length) await chrome.storage.session.remove(keys);
  } catch { /* best-effort privacy cleanup */ }
}

async function clearAllProjectSnapshots(): Promise<void> {
  try {
    const stored = await chrome.storage.session.get(null);
    const keys = Object.keys(stored).filter((key) => key.startsWith(PROJECT_SNAPSHOT_PREFIX));
    if (keys.length) await chrome.storage.session.remove(keys);
  } catch { /* best-effort privacy cleanup */ }
}

const PROJECT_IFRAME_PERMISSION_PREFIX = 'Project editor iframe host permission is missing for ';

function projectIframePermissionMessage(origin: string): string {
  return `${PROJECT_IFRAME_PERMISSION_PREFIX}${origin}. Grant this origin in the Natively extension, then scan again.`;
}

export function permissionFailureForTab(tab: chrome.tabs.Tab, err: unknown): DomPostOutcome | null {
  const message = err instanceof Error ? err.message : String(err);
  if (message.startsWith(PROJECT_IFRAME_PERMISSION_PREFIX)) {
    const origin = message.match(/https?:\/\/[^\s]+\/\*/)?.[0];
    return origin ? { kind: 'needs-host-permission', origin, message } : null;
  }
  if (!/Cannot access contents of|must request permission to access this host|Missing host permission/i.test(message)) {
    return null;
  }
  const citedUrl = message.match(/https?:\/\/[^\s"']+/)?.[0]?.replace(/[),.;]+$/, '');
  const origin = originPatternFromUrl(citedUrl || '') || originPatternFromUrl(tab.url || '');
  if (!origin) return null;
  const topOrigin = originPatternFromUrl(tab.url || '');
  return {
    kind: 'needs-host-permission',
    origin,
    ...(topOrigin && origin !== topOrigin ? { message: projectIframePermissionMessage(origin) } : {}),
  };
}

async function findMissingProjectIframePermission(tabId: number): Promise<string | null> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: findProjectIframePermissionCandidatesInPage,
    });
    const origins = [...new Set(results.flatMap((entry) => Array.isArray(entry.result) ? entry.result : []))];
    for (const origin of origins) {
      if (!(await chrome.permissions.contains({ origins: [origin] }))) return origin;
    }
  } catch {
    // The normal Chrome injection error still flows through
    // permissionFailureForTab; this metadata-only diagnostic is best-effort.
  }
  return null;
}

export interface ProjectDocumentTarget {
  frameId: number;
  documentId?: string;
}

type ProjectFilesByTarget = Map<string, ExternalProjectFile[]>;

function projectDocumentTargetKey(target: ProjectDocumentTarget): string {
  return `${target.frameId}\0${target.documentId || ''}`;
}

function projectDocumentTargetFrom(value: unknown): ProjectDocumentTarget | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as { frameId?: unknown; documentId?: unknown };
  if (typeof candidate.frameId !== 'number'
    || !Number.isInteger(candidate.frameId)
    || candidate.frameId < 0) return undefined;
  if (candidate.documentId === undefined) return { frameId: candidate.frameId };
  if (typeof candidate.documentId !== 'string'
    || !candidate.documentId
    || candidate.documentId.length > 256) return undefined;
  return { frameId: candidate.frameId, documentId: candidate.documentId };
}

export async function readLoadedProjectEditors(
  tabId: number,
  options: LoadedProjectEditorsReadOptions,
): Promise<ProjectFilesByTarget> {
  const byTarget: ProjectFilesByTarget = new Map();
  const mergeResults = (
    results: chrome.scripting.InjectionResult<ExternalProjectFile[]>[],
    preferIncoming: boolean,
  ): void => {
    for (const entry of results) {
      const frameId = typeof entry.frameId === 'number' ? entry.frameId : 0;
      const documentId = typeof entry.documentId === 'string' && entry.documentId
        ? entry.documentId
        : undefined;
      const key = projectDocumentTargetKey({ frameId, documentId });
      const merged = new Map((byTarget.get(key) || []).map((file) => [file.path, file]));
      for (const file of Array.isArray(entry.result) ? entry.result : []) {
        if (preferIncoming || !merged.has(file.path)) merged.set(file.path, file);
      }
      byTarget.set(key, [...merged.values()]);
    }
  };

  // The IndexedDB and mounted-editor probes are independent and read-only.
  // BrowserFS contributes closed files; mounted editor state is merged last so
  // unsaved Monaco/CodeMirror/Ace contents win an exact-path collision.
  const [browserFs, loadedEditors] = await Promise.allSettled([
    chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func: readBrowserFsIndexedDbProjectFilesInPage,
      args: [options],
    }),
    chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func: readLoadedProjectEditorsInPage,
      args: [options],
    }),
  ]);
  if (browserFs.status === 'fulfilled') mergeResults(browserFs.value, false);
  if (loadedEditors.status === 'fulfilled') mergeResults(loadedEditors.value, true);

  // Not every workspace exposes an editor or BrowserFS database in MAIN-world
  // state. The isolated-world DOM providers still disclose explorer-only files.
  return byTarget;
}

export type ProjectMessageResponse<T> = ({ ok: true } & T) & {
  ownerTarget: ProjectDocumentTarget;
};

export async function sendProjectMessage<T>(
  tabId: number,
  message: unknown,
  externalFilesByTarget?: ReadonlyMap<string, ExternalProjectFile[]>,
  expectedWorkspaceId?: string,
  expectedOwnerTarget?: ProjectDocumentTarget,
): Promise<ProjectMessageResponse<T>> {
  const injections = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ['content-script.js'],
  });
  const seenTargets = new Set<string>();
  const targets = injections
    .map((entry) => ({
      frameId: entry.frameId,
      // Chrome 106+ supplies this field. Keep the runtime guard because older
      // implementations may omit it despite the current @types/chrome shape.
      documentId: typeof entry.documentId === 'string' && entry.documentId
        ? entry.documentId
        : undefined,
    }))
    .filter((target) => {
      const key = `${target.frameId}\0${target.documentId || ''}`;
      if (seenTargets.has(key)) return false;
      seenTargets.add(key);
      return true;
    })
    .sort((left, right) => left.frameId - right.frameId
      || (left.documentId || '').localeCompare(right.documentId || ''));
  const routedTargets = expectedOwnerTarget
    ? targets.filter((target) => target.frameId === expectedOwnerTarget.frameId
      && (!expectedOwnerTarget.documentId || target.documentId === expectedOwnerTarget.documentId))
    : targets;
  if (expectedOwnerTarget && routedTargets.length === 0) {
    throw new Error('The selected project document is no longer available; discover the project again');
  }
  let firstSuccessfulResponse: ProjectMessageResponse<T> | undefined;
  let strongestDiscoveryResponse: ProjectMessageResponse<T> | undefined;
  let strongestDiscoveryScore: readonly [number, number, number] | undefined;
  let lastError = '';
  const isDiscovery = (message as { type?: unknown })?.type === 'natively:project-discover';
  const isStrongerDiscovery = (
    left: readonly [number, number, number],
    right: readonly [number, number, number] | undefined,
  ): boolean => !right
    || left[0] > right[0]
    || (left[0] === right[0] && left[1] > right[1])
    || (left[0] === right[0] && left[1] === right[1] && left[2] > right[2]);
  for (const { frameId, documentId } of routedTargets) {
    try {
      // MAIN-world editor handles are frame-local. Giving their snapshots to a
      // different frame lets (for example) HackerRank's top problem frame claim
      // the VS Code iframe's models, causing us to return before the real IDE's
      // explorer can contribute its full paths. Preserve ownership all the way
      // through the isolated-world discovery/capture request.
      const frameMessage = message && typeof message === 'object'
        ? (() => {
            const base = message as Record<string, unknown>;
            let pageIdentity = base.pageIdentity;
            if (pageIdentity && typeof pageIdentity === 'object') {
              const frameLocalIdentity = { ...(pageIdentity as Record<string, unknown>) };
              // Never retain a caller's stale routing coordinates. These must
              // describe the document returned by this exact injection only.
              delete frameLocalIdentity.frameId;
              delete frameLocalIdentity.documentId;
              pageIdentity = {
                ...frameLocalIdentity,
                frameId,
                ...(documentId ? { documentId } : {}),
              };
            }
            return {
              ...base,
              ...(pageIdentity ? { pageIdentity } : {}),
              ...(externalFilesByTarget
                ? {
                    externalFiles: externalFilesByTarget.get(
                      projectDocumentTargetKey({ frameId, documentId }),
                    ) || [],
                  }
                : {}),
            };
          })()
        : message;
      const messageTarget: chrome.tabs.MessageSendOptions = documentId
        ? { frameId, documentId }
        : { frameId };
      const response = (await chrome.tabs.sendMessage(tabId, frameMessage, messageTarget)) as
        | ({ ok: true } & T)
        | { ok: false; error: string }
        | undefined;
      if (!response) continue;
      if (!response.ok) {
        lastError = response.error || lastError;
        continue;
      }
      const ownerTarget: ProjectDocumentTarget = documentId
        ? { frameId, documentId }
        : { frameId };
      const ownedResponse = { ...response, ownerTarget } as ProjectMessageResponse<T>;
      firstSuccessfulResponse ||= ownedResponse;
      if (expectedWorkspaceId) {
        const responseWorkspaceId = (response as {
          project?: { workspaceId?: unknown } | null;
          projectCapture?: { project?: { workspaceId?: unknown } | null };
        }).projectCapture?.project?.workspaceId
          ?? (response as { project?: { workspaceId?: unknown } | null }).project?.workspaceId;
        if (responseWorkspaceId === expectedWorkspaceId) return ownedResponse;
        // With allowEmpty enabled, a non-project top frame can still assemble
        // a syntactically successful empty capture. It must never win over the
        // iframe that owns the workspace selected in the overlay.
        continue;
      }
      if (!isDiscovery) return ownedResponse;

      const project = (response as {
        project?: {
          files?: Array<{ readable?: unknown; charCount?: unknown }>;
          estimatedChars?: unknown;
        } | null;
      }).project;
      if (project && Array.isArray(project.files) && project.files.length > 0) {
        const readableCount = project.files.filter((file) => file?.readable === true).length;
        const estimatedChars = typeof project.estimatedChars === 'number'
          && Number.isFinite(project.estimatedChars)
          ? Math.max(0, project.estimatedChars)
          : project.files.reduce((sum, file) => sum + (
            file?.readable === true && typeof file.charCount === 'number' && Number.isFinite(file.charCount)
              ? Math.max(0, file.charCount)
              : 0
          ), 0);
        const score = [readableCount, estimatedChars, project.files.length] as const;
        if (isStrongerDiscovery(score, strongestDiscoveryScore)) {
          strongestDiscoveryResponse = ownedResponse;
          strongestDiscoveryScore = score;
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  if (strongestDiscoveryResponse) return strongestDiscoveryResponse;
  if (firstSuccessfulResponse && !expectedWorkspaceId) return firstSuccessfulResponse;
  if (expectedWorkspaceId) {
    throw new Error(`No page frame exposed the selected workspace (${expectedWorkspaceId})`);
  }
  throw new Error(lastError || 'No response from page');
}

function projectPathIsSelected(path: string, selectedPaths: readonly string[]): boolean {
  return selectedPaths.some((selected) => path === selected || path.startsWith(`${selected}/`));
}

function previousSnapshotCoveredWholeProject(previous: ProjectSelectionSnapshot): boolean {
  if (typeof previous.wholeProjectSelected === 'boolean') return previous.wholeProjectSelected;
  // Backward-compatible inference for snapshots written by an intermediate
  // build that stored the total but not the explicit marker. Older snapshots
  // without either field conservatively retain their explicit subset.
  if (typeof previous.totalFileCount !== 'number') return false;
  const currentManifestEntries = previous.files.filter((file) => file.status !== 'removed').length;
  return currentManifestEntries >= previous.totalFileCount;
}

/**
 * Build the exact selection sent to the page capture provider.
 *
 * The overlay can select only readable files. Unreadable/ignored descriptors
 * are added here so the structured manifest discloses their omission without
 * ever reading their bodies. A refresh of a prior whole-project snapshot also
 * picks up newly exposed readable files, but only while the caller still
 * selects every surviving readable file from that snapshot; choosing a subset
 * remains an explicit opt-out from that automatic expansion.
 */
export function effectiveProjectSelection(
  project: ProjectDiscovery,
  selectedPaths: readonly string[],
  previous: ProjectSelectionSnapshot | null,
  refresh: boolean,
): string[] {
  const requested = [...new Set(
    selectedPaths.map(normalizeProjectPath).filter(Boolean),
  )];
  const currentFiles = new Map(project.files.map((file) => [file.path, file]));
  const missingPreviousSelections = refresh
    ? (previous?.selectedPaths || [])
      .map(normalizeProjectPath)
      .filter((path) => path && !currentFiles.get(path)?.readable)
    : [];
  const disclosurePaths = project.files
    .filter((file) => !file.readable)
    .map((file) => file.path);

  let newlyVisibleReadablePaths: string[] = [];
  if (refresh && previous && previousSnapshotCoveredWholeProject(previous)) {
    const survivingPreviousReadablePaths = previous.files
      .filter((file) => file.status === 'included'
        || file.status === 'unchanged'
        || file.status === 'truncated')
      .map((file) => normalizeProjectPath(file.path))
      .filter((path) => path && currentFiles.get(path)?.readable);
    const stillCoversPreviousReadableFiles = survivingPreviousReadablePaths.every((path) =>
      projectPathIsSelected(path, requested));
    if (stillCoversPreviousReadableFiles) {
      newlyVisibleReadablePaths = project.files
        .filter((file) => file.readable)
        .map((file) => file.path);
    }
  }

  return [...new Set([
    ...requested,
    ...missingPreviousSelections,
    ...disclosurePaths,
    ...newlyVisibleReadablePaths,
  ])];
}

function selectionCoversWholeProject(
  project: ProjectDiscovery,
  selectedPaths: readonly string[],
): boolean {
  return project.files.every((file) =>
    !file.readable || projectPathIsSelected(file.path, selectedPaths));
}

/**
 * Give an embedded editor the stable identity of its owning top-level tab.
 * Query strings are dropped except for a small workspace-id allow-list, so an
 * iframe never receives auth, tracking, or attempt tokens from the top page.
 */
export function projectPageIdentityForTab(
  tab: Pick<chrome.tabs.Tab, 'url' | 'title'>,
): ProjectPageIdentity {
  const identity: ProjectPageIdentity = {};
  if (typeof tab.title === 'string' && tab.title.trim()) {
    identity.title = tab.title.trim().slice(0, 300);
  }
  try {
    const parsed = new URL(tab.url || '');
    if (!/^https?:$/.test(parsed.protocol)) return identity;
    const hashValue = (value: string): string => {
      let hash = 0x811c9dc5;
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
      return `h-${hash.toString(16).padStart(8, '0')}`;
    };
    const stableParams = [...parsed.searchParams.entries()]
      .filter(([key]) => /^(?:workspace(?:id)?|project(?:id)?|challenge(?:id)?|folder|repo(?:sitory)?|sandbox(?:id)?|slug)$/i.test(key))
      // Hash even allow-listed identity values: they distinguish two SPA
      // workspaces without sending a raw repository/folder/user identifier to
      // an embedded third-party origin.
      .map(([key, value]) => [key.toLowerCase(), hashValue(value.slice(0, 512))] as const)
      .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
        `${leftKey}\0${leftValue}` < `${rightKey}\0${rightValue}` ? -1 : 1);
    const query = stableParams.length
      ? `?${stableParams.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')}`
      : '';
    identity.host = parsed.hostname;
    identity.url = `${sanitizeUrl(tab.url) || `${parsed.origin}${parsed.pathname}`}${query}`;
  } catch {
    // A malformed or opaque URL contributes only the bounded title.
  }
  return identity;
}

export interface OwnedProjectDiscovery {
  project: ProjectDiscovery;
  ownerTarget: ProjectDocumentTarget;
}

export async function discoverProjectFromTab(
  tab: chrome.tabs.Tab,
  allowEmpty = false,
  expectedOwnerTarget?: ProjectDocumentTarget,
): Promise<OwnedProjectDiscovery> {
  if (tab.id == null) throw new Error('No active tab');
  // Enforce the same local sensitive-page privacy floor used by smart capture
  // before MAIN-world editor APIs are asked for any source text.
  const privacy = await smartExtractFromTab(tab.id, {
    contextId: `project-privacy-${Date.now().toString(36)}`,
    capturedAt: Date.now(),
    mode: 'manual',
    classifyOnly: true,
  });
  if (privacy.blocked) {
    throw new Error('Project capture is blocked on sensitive pages');
  }
  const externalFilesByTarget = await readLoadedProjectEditors(tab.id, { includeContent: false });
  let response: ProjectMessageResponse<{ project: ProjectDiscovery | null }>;
  try {
    response = await sendProjectMessage<{ project: ProjectDiscovery | null }>(tab.id, {
      type: 'natively:project-discover',
      externalFiles: [],
      allowEmpty,
      pageIdentity: projectPageIdentityForTab(tab),
    }, externalFilesByTarget, undefined, expectedOwnerTarget);
  } catch (error) {
    const missingIframeOrigin = await findMissingProjectIframePermission(tab.id);
    if (missingIframeOrigin) throw new Error(projectIframePermissionMessage(missingIframeOrigin));
    throw error;
  }
  if (!response.project || (!allowEmpty && response.project.files.length < 2)) {
    const missingIframeOrigin = await findMissingProjectIframePermission(tab.id);
    if (missingIframeOrigin) throw new Error(projectIframePermissionMessage(missingIframeOrigin));
    throw new Error('This page does not expose a multi-file project without interacting with the editor');
  }
  return { project: response.project, ownerTarget: response.ownerTarget };
}

/** Discover a read-only browser-IDE workspace for the extension popup. */
async function discoverActiveProject(tabId?: number): Promise<ProjectDiscoveryReport> {
  if (!(await getPairing())) return { outcome: { kind: 'unauthorized' } };
  let tab: chrome.tabs.Tab | undefined;
  if (typeof tabId === 'number') {
    try { tab = await chrome.tabs.get(tabId); } catch { tab = undefined; }
  } else {
    tab = await resolveCaptureTab();
  }
  if (!tab || tab.id == null) return { outcome: { kind: 'error', message: 'No active tab' } };
  if (!isCapturable(tab)) return { outcome: { kind: 'error', message: 'Cannot capture browser/internal pages' } };
  try {
    const snapshotHint = await readLatestProjectSnapshotForTab(tab.id);
    const discovery = await discoverProjectFromTab(tab, Boolean(snapshotHint));
    const { project, ownerTarget } = discovery;
    const previous = await readProjectSnapshot(tab.id, project.workspaceId);
    if (project.files.length < 2 && !previous) {
      throw new Error('This page does not expose a multi-file project without interacting with the editor');
    }
    if (previous) {
      const revisions = new Map(previous.files.map((file) => [file.path, file.revision]));
      project.files = project.files.map((file) => ({
        ...file,
        changed: !file.revision || revisions.get(file.path) !== file.revision,
      }));
    }
    return {
      outcome: { kind: 'success' },
      project,
      ownerTarget,
      tabId: tab.id,
      refreshAvailable: Boolean(previous),
      previousSelectedPaths: previous?.selectedPaths,
    };
  } catch (err) {
    return { outcome: permissionFailureForTab(tab, err) || { kind: 'error', message: err instanceof Error ? err.message : String(err) } };
  }
}

/** Capture selected project files and post one bounded, path-aware context. */
async function captureActiveProject(
  workspaceId: string,
  selectedPaths: string[],
  refresh: boolean,
  options: { reqId?: string; tabId?: number; ownerTarget: ProjectDocumentTarget },
): Promise<ProjectCaptureReport> {
  const pairing = await getPairing();
  if (!pairing) return { outcome: { kind: 'unauthorized' } };
  let tab: chrome.tabs.Tab | undefined;
  if (typeof options.tabId === 'number') {
    try { tab = await chrome.tabs.get(options.tabId); } catch { tab = undefined; }
  } else {
    tab = await resolveCaptureTab();
  }
  if (!tab || tab.id == null) return { outcome: { kind: 'error', message: 'No active tab' } };
  if (!isCapturable(tab)) return { outcome: { kind: 'error', message: 'Cannot capture browser/internal pages' } };

  try {
    const previous = refresh ? await readProjectSnapshot(tab.id, workspaceId) : null;
    const discovery = await discoverProjectFromTab(
      tab,
      Boolean(previous),
      options.ownerTarget,
    );
    const { project, ownerTarget } = discovery;
    if (project.workspaceId !== workspaceId) {
      return { outcome: { kind: 'error', message: 'The active workspace changed; discover the project again' } };
    }

    const previousRevisions = Object.fromEntries(
      (previous?.files || [])
        .filter((file): file is ProjectFileContext & { revision: string } =>
          typeof file.revision === 'string'
          && file.content !== undefined
          && (file.status === 'included' || file.status === 'unchanged'))
        .map((file) => [file.path, file.revision]),
    );
    const effectiveSelectedPaths = effectiveProjectSelection(
      project,
      selectedPaths,
      previous,
      refresh,
    );
    let problemStatement: string | undefined;
    try {
      // The project itself may be hosted in a cross-origin IDE iframe while the
      // challenge statement remains in the top frame. Extract it once here and
      // pass a bounded value to whichever frame owns the project.
      const topFrame = await extractFromTab(tab.id);
      if (topFrame.text) problemStatement = topFrame.text.slice(0, 5_000);
    } catch {
      // Project capture can still proceed; the owning frame retains its legacy
      // local-extraction fallback for sites whose top frame is unreadable.
    }
    const externalFilesByTarget = await readLoadedProjectEditors(tab.id, {
      includeContent: true,
      selectedPaths: effectiveSelectedPaths,
      previousRevisions,
    });
    const contextId = `project-${Date.now().toString(36)}`;
    const response = await sendProjectMessage<{ projectCapture: ProjectCaptureResult }>(tab.id, {
      type: 'natively:project-capture',
      contextId,
      capturedAt: Date.now(),
      selectedPaths: effectiveSelectedPaths,
      refresh,
      baseContextId: previous?.contextId,
      previousSelectedPaths: previous?.selectedPaths,
      previousFiles: previous?.files,
      externalFiles: [],
      allowEmpty: Boolean(previous),
      problemStatement,
      pageIdentity: projectPageIdentityForTab(tab),
    }, externalFilesByTarget, workspaceId, ownerTarget);
    const result = response.projectCapture;
    const payload = result.envelope.payload as CodingProjectPayload;
    const fileCount = payload.capturedFileCount;
    const omittedCount = payload.omitted.length;
    const truncatedCount = payload.files.filter((file) => file.status === 'truncated').length;

    if (refresh && result.unchanged) {
      return { outcome: { kind: 'success' }, chars: result.dom.length, fileCount, omittedCount, truncatedCount, unchanged: true };
    }
    if (!result.dom) return { outcome: { kind: 'error', message: 'No selected project files were readable' } };

    const meta: CaptureMeta = {
      title: project.name || tab.title || 'Project',
      url: tab.url || '',
      source: refresh ? 'project-refresh' : 'project-capture',
      pageType: 'coding_project',
      firstLine: `${fileCount} project files`,
    };
    const outcome = await sendDom(pairing.token, pairing.port, result.dom, {
      reqId: options.reqId,
      meta,
      envelope: result.envelope,
    });
    if (outcome.kind === 'success') {
      await writeProjectSnapshot(
        tab.id,
        payload,
        contextId,
        selectionCoversWholeProject(project, effectiveSelectedPaths),
      );
    }
    return { outcome, chars: result.dom.length, fileCount, omittedCount, truncatedCount };
  } catch (err) {
    return { outcome: permissionFailureForTab(tab, err) || { kind: 'error', message: err instanceof Error ? err.message : String(err) } };
  }
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
export async function smartExtractFromTab(tabId: number, opts: SmartExtractOpts): Promise<SmartExtractResult> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content-script.js'] });
  const response = (await chrome.tabs.sendMessage(
    tabId,
    {
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
    },
    { frameId: 0 },
  )) as { ok: true; smart: SmartExtractResult } | { ok: false; error: string } | undefined;
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

/** Manifest default_title — restored when a grant nudge is cleared. */
const DEFAULT_ACTION_TITLE = 'Natively — capture this page';

/**
 * Pure: the toolbar-badge nudge for a failed DESKTOP-PUSH capture, or null when
 * the failure isn't user-fixable from the toolbar. Only needs-host-permission
 * qualifies: chrome.permissions.request needs a user gesture the desktop hotkey
 * can't provide, so the icon itself must pull the user in — the popup's Capture
 * button then grants + retries in one click.
 */
export function badgeForCaptureOutcome(kind: string): { text: string; title: string } | null {
  if (kind === 'needs-host-permission') {
    return {
      text: '!',
      title: 'Natively needs access to this site — click, then press Capture once to grant it.',
    };
  }
  return null;
}

/**
 * Surface a hotkey capture failure on the toolbar icon: badge + title only.
 * This is only reached from the desktop-push path (handleCaptureDom), which
 * has no user gesture — forcibly calling chrome.action.openPopup() here would
 * pull focus off the page the user is looking at (and be page-observable via
 * blur/focus) for a capture the user never initiated. The popup's own
 * "Capture" button (popup.ts `captureBtn`, which drives `case 'capture'` and
 * then `case 'grant-host'` below) already runs inside a real user gesture and
 * grants access without needing this nudge to open anything — the badge/title
 * alone is enough to point the user at the icon.
 */
function nudgeGrantViaAction(kind: string): void {
  const badge = badgeForCaptureOutcome(kind);
  if (!badge) return;
  try {
    void chrome.action.setBadgeText({ text: badge.text });
    void chrome.action.setBadgeBackgroundColor?.({ color: '#f59e0b' });
    void chrome.action.setTitle({ title: badge.title });
  } catch (_) { /* badge is best-effort */ }
}

/** Clear the grant nudge (a capture succeeded or the origin was granted). */
function clearGrantNudge(): void {
  try {
    void chrome.action.setBadgeText({ text: '' });
    void chrome.action.setTitle({ title: DEFAULT_ACTION_TITLE });
  } catch (_) { /* best-effort */ }
}

async function handleCaptureDom(reqId: string, tabId?: number): Promise<void> {
  wsSend({ type: 'capture-ack', reqId, status: 'started' });
  try {
    let resolvedTabId = tabId;
    if (typeof resolvedTabId !== 'number') {
      resolvedTabId = (await resolveCaptureTab())?.id;
    }
    // Ctrl/Cmd+Y is project-aware. Discover first without interacting with the
    // host UI; when the page exposes a workspace, capture the user's previous
    // overlay selection (or every readable file on first use). Unreadable files
    // are still carried as explicit omission records by captureActiveProject.
    // A genuinely
    // single-file page falls through to the proven page-capture path below.
    const discovery = await discoverActiveProject(resolvedTabId);
    if (discovery.outcome.kind === 'success' && discovery.project) {
      if (!discovery.ownerTarget) {
        wsSend({
          type: 'capture-ack',
          reqId,
          status: 'error',
          error: 'The project owner document is missing; discover the project again',
        });
        return;
      }
      const discoveredPaths = discovery.project.files
        .filter((file) => file.readable)
        .map((file) => file.path);
      const previousSelection = (discovery.previousSelectedPaths || [])
        .filter((selection) => discovery.project?.files.some(
          (file) => file.readable
            && (file.path === selection || file.path.startsWith(`${selection}/`)),
        ));
      const selectedPaths = previousSelection.length ? previousSelection : discoveredPaths;
      const projectReport = await captureActiveProject(
        discovery.project.workspaceId,
        selectedPaths,
        // A hotkey capture must always POST context. Refresh's unchanged fast
        // path intentionally skips /dom, which is correct for the overlay's
        // explicit Refresh button but would make a second Ctrl+Y attach nothing.
        false,
        { reqId, tabId: resolvedTabId, ownerTarget: discovery.ownerTarget },
      );
      const projectOk = projectReport.outcome.kind === 'success';
      if (projectOk) clearGrantNudge();
      else nudgeGrantViaAction(projectReport.outcome.kind);
      const projectReason = !projectOk
        ? ('message' in projectReport.outcome && projectReport.outcome.message) || projectReport.outcome.kind
        : undefined;
      wsSend({
        type: 'capture-ack',
        reqId,
        status: projectOk ? 'done' : 'error',
        category: projectOk ? 'coding_project' : undefined,
        error: projectReason,
        fileCount: projectReport.fileCount,
        omittedCount: projectReport.omittedCount,
        truncatedCount: projectReport.truncatedCount,
        unchanged: projectReport.unchanged === true,
      });
      return;
    }

    // Fall back only when discovery genuinely found no multi-file structure.
    // Permission/auth/privacy failures must remain visible instead of causing a
    // second extraction attempt with a misleading screenshot fallback.
    if (discovery.outcome.kind !== 'success') {
      const unsupported = discovery.outcome.kind === 'error'
        && /does not expose a multi-file project/i.test(discovery.outcome.message);
      if (!unsupported) {
        nudgeGrantViaAction(discovery.outcome.kind);
        wsSend({
          type: 'capture-ack',
          reqId,
          status: 'error',
          error: outcomeReason(discovery.outcome),
        });
        return;
      }
    }

    const report = await captureActiveTab({ reqId, tabId: resolvedTabId });
    const ok = report.outcome.kind === 'success';
    if (ok) clearGrantNudge();
    else nudgeGrantViaAction(report.outcome.kind);
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

function projectDiscoveryForControlFrame(project: ProjectDiscovery): ProjectDiscovery {
  return {
    ...project,
    // Discovery is metadata-only. File bodies flow solely through the bounded,
    // sanitized /dom capture after the user confirms an overlay selection.
    files: project.files.map(({ content: _content, ...file }) => file),
  };
}

function outcomeReason(outcome: DomPostOutcome): string {
  if ('message' in outcome && typeof outcome.message === 'string') return outcome.message;
  if (outcome.kind === 'needs-host-permission') return `needs-host-permission:${outcome.origin}`;
  return outcome.kind;
}

async function handleProjectDiscovery(reqId: string, tabId?: number): Promise<void> {
  try {
    const report = await discoverActiveProject(tabId);
    if (report.outcome.kind !== 'success' || !report.project) {
      wsSend({ type: 'project-discovery', reqId, ok: false, error: outcomeReason(report.outcome) });
      return;
    }
    wsSend({
      type: 'project-discovery',
      reqId,
      ok: true,
      project: projectDiscoveryForControlFrame(report.project),
      ownerTarget: report.ownerTarget,
      tabId: report.tabId,
      refreshAvailable: report.refreshAvailable === true,
      previousSelectedPaths: report.previousSelectedPaths || [],
    });
  } catch (err) {
    wsSend({
      type: 'project-discovery',
      reqId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function handleProjectCapture(
  reqId: string,
  workspaceId: string,
  selectedPaths: string[],
  refresh: boolean,
  tabId?: number,
  ownerTarget?: ProjectDocumentTarget,
): Promise<void> {
  wsSend({ type: 'capture-ack', reqId, status: 'started' });
  if (!ownerTarget) {
    wsSend({
      type: 'capture-ack',
      reqId,
      status: 'error',
      error: 'The project owner document is missing; discover the project again',
    });
    return;
  }
  try {
    const report = await captureActiveProject(
      workspaceId,
      selectedPaths,
      refresh,
      { reqId, tabId, ownerTarget },
    );
    const ok = report.outcome.kind === 'success';
    if (ok) clearGrantNudge();
    else nudgeGrantViaAction(report.outcome.kind);
    wsSend({
      type: 'capture-ack',
      reqId,
      status: ok ? 'done' : 'error',
      category: ok ? 'coding_project' : undefined,
      error: ok ? undefined : outcomeReason(report.outcome),
      fileCount: report.fileCount,
      omittedCount: report.omittedCount,
      truncatedCount: report.truncatedCount,
      unchanged: report.unchanged === true,
    });
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
      } else if (msg.type === 'discover-project' && typeof msg.reqId === 'string') {
        void handleProjectDiscovery(
          msg.reqId,
          typeof msg.tabId === 'number' ? msg.tabId : undefined,
        );
      } else if (msg.type === 'capture-project' && typeof msg.reqId === 'string') {
        const selectedPaths = Array.isArray(msg.selectedPaths)
          ? (msg.selectedPaths as unknown[]).filter((path): path is string => typeof path === 'string').slice(0, 300)
          : [];
        void handleProjectCapture(
          msg.reqId,
          typeof msg.workspaceId === 'string' ? msg.workspaceId : '',
          selectedPaths,
          msg.refresh === true,
          typeof msg.tabId === 'number' ? msg.tabId : undefined,
          projectDocumentTargetFrom(msg.ownerTarget),
        );
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
  | { type: 'project-discover' }
  | {
      type: 'project-capture';
      workspaceId: string;
      selectedPaths: string[];
      refresh?: boolean;
      ownerTarget?: ProjectDocumentTarget;
    }
  | { type: 'grant-host'; value: string }
  | { type: 'grant-all-sites' }
  | { type: 'all-sites-status' }
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
      case 'capture': {
        const report = await captureActiveTab();
        if (report.outcome.kind === 'success') clearGrantNudge();
        sendResponse(report);
        return;
      }
      case 'project-discover': {
        sendResponse(await discoverActiveProject());
        return;
      }
      case 'project-capture': {
        const workspaceId = typeof msg.workspaceId === 'string' ? msg.workspaceId : '';
        const selectedPaths = Array.isArray(msg.selectedPaths)
          ? msg.selectedPaths.filter((path): path is string => typeof path === 'string')
          : [];
        const ownerTarget = projectDocumentTargetFrom(msg.ownerTarget);
        const report = ownerTarget
          ? await captureActiveProject(
              workspaceId,
              selectedPaths,
              msg.refresh === true,
              { ownerTarget },
            )
          : {
              outcome: {
                kind: 'error' as const,
                message: 'The project owner document is missing; discover the project again',
              },
            };
        if (report.outcome.kind === 'success') clearGrantNudge();
        sendResponse(report);
        return;
      }
      case 'grant-host': {
        // The popup asks for ONE origin after a capture came back
        // needs-host-permission. chrome.permissions.request must run inside a
        // user gesture; the popup's click handler is that gesture, and the
        // gesture survives this round-trip because the popup awaits us.
        const origin = typeof msg.value === 'string' ? msg.value : '';
        const granted = await requestOriginPermission(chrome.permissions, origin);
        if ((granted as { granted?: boolean })?.granted) clearGrantNudge();
        sendResponse(granted);
        return;
      }
      case 'grant-all-sites': {
        // One-time "Allow on all sites": a single prompt covering the broad
        // optional_host_permissions patterns, so the desktop hotkey works on
        // any site without per-site grants. Gesture comes from the popup click.
        const r = await requestAllSitesPermission(chrome.permissions);
        if (r.granted) clearGrantNudge();
        sendResponse(r);
        return;
      }
      case 'all-sites-status':
        sendResponse({ granted: await hasAllSitesPermission(chrome.permissions) });
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
chrome.tabs.onRemoved.addListener((tabId) => {
  void clearProjectSnapshotsForTab(tabId);
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
