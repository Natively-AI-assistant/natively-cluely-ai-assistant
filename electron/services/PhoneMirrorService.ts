import crypto from 'crypto';
import { app, BrowserWindow } from 'electron';
import http from 'http';
import os from 'os';
import QRCode from 'qrcode';
import { URL } from 'url';
import { WebSocket, WebSocketServer } from 'ws';
import { SettingsManager } from './SettingsManager';
import { CredentialsManager } from './CredentialsManager';
import { PHONE_MIRROR_HTML } from './phoneMirrorClient';
import { DOM_CONTEXT_MAX_CHARS } from '../config/constants';
import { sanitizeContextEnvelope } from './browser-context/sanitize';
import { isPhoneImagePath } from '../utils/phoneImage';
import { splitGistLine, stripGistTrailer } from '../../src/lib/displayMarkup';

export interface PhoneMirrorInfo {
  running: boolean;
  enabled: boolean;
  exposeOnLan: boolean;
  port: number;
  loopbackUrl: string | null;
  primaryUrl: string | null;
  lanUrls: string[];
  /** Phone (LAN) token — embedded in loopbackUrl/lanUrls/QR. NOT the extension token. */
  token: string | null;
  /** Loopback-scoped extension token — used for the manual `port:extToken` pairing string. */
  extToken: string | null;
  qrDataUrl: string | null;
  clients: number;
  /** True when a companion browser extension is connected over /ws (capture-ready). */
  extensionConnected: boolean;
  /**
   * Epoch ms of the last successful one-click /pair this session (0 = none).
   * A Re-pair while the extension is already connected changes nothing else —
   * same persisted token, same open socket — so this is the only way Settings
   * can tell the pairing window it opened has been used.
   */
  extPairedAt: number;
  /** Resolved bind host ('127.0.0.1' or '0.0.0.0') so the UI can show "loopback only" / "LAN". */
  bindAddress: string;
}

/**
 * Thrown by setExposeOnLan when the caller tries to flip ON LAN exposure without
 * first confirming via the IPC-layer `dialog.showMessageBoxSync` prompt. The
 * IPC handler catches this, prompts the user, and either flips the sentinel
 * + retries or returns { declined: true } so the toggle stays off.
 */
export class LANBindConfirmationRequired extends Error {
  constructor() {
    super('LAN bind requires explicit user confirmation');
    this.name = 'LANBindConfirmationRequired';
  }
}

export type StreamEvent =
  | { type: 'history'; messages: PersistedMessage[] }
  | { type: 'user'; id: string; content: string; createdAt: string; awaiting?: boolean }
  | { type: 'token'; streamId: string; token: string }
  | { type: 'done'; streamId: string; content: string; createdAt: string; html?: string; gist?: string | null }
  | { type: 'error'; streamId: string; message: string }
  | { type: 'assistant'; id: string; content: string; label: string; createdAt: string; html?: string; gist?: string | null }
  | { type: 'render'; streamId: string; html: string; gist: string | null }
  // A diagram the desktop finished drawing after its answer was already sent
  // (PhoneDiagramBroker). `src` is an image data URL; absent means it could not
  // be drawn and the phone keeps the Mermaid source view.
  | { type: 'diagram'; key: string; src?: string }
  | { type: 'ack'; action: string; message: string }
  | { type: 'transcript'; speaker: string; text: string; final: boolean; ts: number }
  | {
      type: 'transcript-history';
      segments: PhoneTranscriptSegment[];
      partial: PhoneTranscriptSegment | null;
      meetingActive: boolean;
      /** The last meeting ended and no new one has started (the phone says so). */
      meetingEnded: boolean;
    }
  | { type: 'meeting'; active: boolean; reset: boolean }
  | { type: 'attachments'; items: PhoneAttachment[] }
  | { type: 'images'; id: string; images: PhoneAttachment[]; createdAt: string };

/**
 * A desktop screenshot as the phone sees it: an opaque id and a small JPEG/PNG
 * data URL (the overlay's own thumbnail). Never a local path.
 */
export interface PhoneAttachment {
  id: string;
  thumb: string;
}

/**
 * An image the phone sent (a photo, or a screenshot from its library), already
 * checked to BE an image by its leading bytes. The type is what the bytes say,
 * never what the request claimed.
 */
export interface PhoneImage {
  data: Buffer;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  ext: 'jpg' | 'png' | 'webp';
}

/** One line of live transcript as the phone receives it. */
export interface PhoneTranscriptSegment {
  speaker: string;
  text: string;
  ts: number;
}

/** Command sent from the phone browser to the desktop. */
export type PhoneCommand =
  | { type: 'chat'; message: string }
  | { type: 'action'; action: string }
  | { type: 'screenshot' }
  /** Take a screenshot or photo off the overlay's tray (the phone names it by id; listeners get its path). */
  | { type: 'detach'; path: string };

/**
 * Metadata the companion extension sends alongside a captured DOM (drives the
 * desktop "Page context" preview chip). All fields optional/best-effort.
 */
export interface DomCaptureMeta {
  title?: string;
  url?: string;
  source?: string;
  pageType?: string;
  firstLine?: string;
}

/** A single open tab reported by the extension for the multi-tab picker. */
export interface ExtensionTab {
  id: number;
  title: string;
  url: string;
}

interface PersistedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  label?: string;
  /** The answer as the phone shows it, from the answer renderer (absent without one). */
  html?: string;
  gist?: string | null;
  /** Screenshots a question was sent with (content is empty on these). */
  images?: PhoneAttachment[];
  /** Replay only: a desktop question whose answer has not started yet. */
  awaiting?: boolean;
}

/** Markdown → the page's HTML (+ the [[GIST]] line split off). See phoneMirrorMarkdown.ts. */
export type PhoneAnswerRenderer = (markdown: string, opts?: { streaming?: boolean }) => { html: string; gist: string | null };

const DEFAULT_PORT = 4123;
const PORT_PROBE_RANGE = 12;
const HISTORY_LIMIT = 40;
// Live transcript kept for a phone that joins mid-meeting. Bounded by both
// segment count and characters so a long meeting stays flat in memory.
const TRANSCRIPT_SEGMENT_LIMIT = 80;
const TRANSCRIPT_CHAR_LIMIT = 12_000;
// Speakers the phone shows. Matches the overlay's rolling bar, which shows the
// interviewer (system audio) only; the user's own mic never leaves the desktop.
const PHONE_TRANSCRIPT_SPEAKERS = new Set(['interviewer']);
// Phone image uploads: the page downscales to 2048 px JPEG (~0.3-1.5 MB), so
// this cap only has to stop abuse, not fit an original 48 MP photo.
const PHONE_IMAGE_MAX_BYTES = 12 * 1024 * 1024;
const PHONE_IMAGE_HANDLER_TIMEOUT_MS = 20_000;
// Desktop screenshots on the phone: the overlay's thumbnails (480 px JPEG,
// ~30-60 kB). Main downscales anything bigger before it gets here; this cap is
// the backstop. The overlay keeps its last 5, so does the phone's tray.
export const PHONE_THUMB_MAX_CHARS = 400_000;
const PHONE_THUMB_DATA_URL = /^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;
const PHONE_TRAY_LIMIT = 5;
// Screenshots remembered by path, so a sent question can name them by path.
const PHONE_SHOTS_REMEMBERED = 24;
// Sent screenshots replayed to a phone that (re)connects: older ones leave the
// history so the history frame stays small. The newest is always kept.
const PHONE_IMAGE_HISTORY_CHARS = 1_200_000;
// A phone question's answer is re-rendered at most this often while it streams.
const LIVE_RENDER_INTERVAL_MS = 120;
const RATE_WINDOW_MS = 60_000;
const RATE_HTTP_LIMIT = 120;
const TOKEN_BYTES = 24;
const HANDSHAKE_TIMEOUT_MS = 5_000;
const STATUS_LISTENERS_KEY = Symbol('phone-mirror-status-listeners');

// One-click /pair: how long the "Connect browser extension" button keeps the
// /pair endpoint open after the user clicks it. Single-use — burns on success.
const PAIR_ARM_WINDOW_MS = 60_000;
// Desktop → extension capture push default deadline. README: "short capture
// timeout + screenshot fallback" — if the extension doesn't ack `done` in time,
// the hotkey path falls back to a screenshot rather than silently no-op.
const CAPTURE_TIMEOUT_MS = 2_500;
// Auto-context deadline when the opt-in AI metadata classifier is on: the
// extension does an extra /classify round-trip + a second extract, so it needs
// more headroom than the snappy non-AI default. Still bounded so a slow/missing
// provider degrades to "no browser context" rather than hanging the answer.
const AUTO_CONTEXT_AI_TIMEOUT_MS = 6_000;
const LIST_TABS_TIMEOUT_MS = 1_500;
// Application-level keepalive cadence to extension clients (under Chrome's ~30s MV3
// idle-kill). Each `ka` frame runs the SW onmessage handler → resets its idle timer.
const EXT_KEEPALIVE_MS = 20_000;
// Default poll window for waitForExtension() — covers a just-woken MV3 service
// worker reconnecting right after the user presses the capture hotkey.
const WAIT_FOR_EXTENSION_MS = 1_200;

// Companion extension IDs the one-click /pair endpoint accepts. /pair requires an
// EXACT origin match (not the structural [a-p]{32} check /dom uses), so it must
// know every legitimate ID the extension can present:
//   - the Chrome Web Store build (Google RE-SIGNS with its own key → this ID),
//   - the unpacked dev build (deterministic from the manifest `key` → this ID),
//   - an optional override for contributors loading a differently-keyed build.
// A web page cannot forge a chrome-extension:// origin, and a different extension
// won't match any of these exact IDs. See natively-browser/README.md + CONTRACT.md.
const STORE_EXTENSION_ID = 'lmhgnkbjnelmciecjkleaomjpejcgaln'; // Chrome Web Store
const DEV_EXTENSION_ID = 'macjecgdfliikhplbbdbpljomcigjnjg'; // unpacked (manifest key)
const PINNED_EXTENSION_IDS = new Set(
  [STORE_EXTENSION_ID, DEV_EXTENSION_ID, process.env.NATIVELY_DOM_EXTENSION_ID].filter(
    (id): id is string => !!id,
  ),
);
const PINNED_EXTENSION_ORIGINS = new Set(
  [...PINNED_EXTENSION_IDS].map((id) => `chrome-extension://${id}`),
);

type StatusListener = (info: PhoneMirrorInfo) => void;

function isPhoneThumb(thumb: string): boolean {
  return thumb.length <= PHONE_THUMB_MAX_CHARS && PHONE_THUMB_DATA_URL.test(thumb);
}

export class PhoneMirrorService {
  private static _instance: PhoneMirrorService | null = null;

  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private port = 0;
  // Resolved bind host for the HTTP/WS listener. '127.0.0.1' when LAN is off
  // (loopback only), '0.0.0.0' when LAN is on (any interface). Mirrored into
  // PhoneMirrorInfo.bindAddress so the renderer can label it.
  private bindAddress: '127.0.0.1' | '0.0.0.0' = '127.0.0.1';
  // Phone token: LAN-scoped. Serves the phone HTML page (`/`) and authenticates
  // phone WebSocket clients. Embedded in the QR/pairing URL, which travels over
  // plaintext HTTP on the LAN when exposeOnLan is on — so it is per-session (NOT
  // persisted) and "Rotate token" cycles it.
  private token = '';
  // Extension token: loopback-scoped. Issued by /pair and required by /dom (the
  // capture capability) + extension WebSocket clients. Persisted (encrypted) so
  // the extension pairs once. Kept separate from the phone token so a sniffed LAN
  // phone token can never reach /dom. See the token-split rationale in CredentialsManager.
  private extToken = '';
  private exposeOnLan = false;
  private history: PersistedMessage[] = [];
  // Single string instead of token array: O(1) append, O(1) replay (one WS frame).
  private livePartial: { streamId: string; content: string } | null = null;
  private transcriptFinals: PhoneTranscriptSegment[] = [];
  private transcriptPartial: PhoneTranscriptSegment | null = null;
  private meetingActive = false;
  private meetingEnded = false;
  // The overlay's attached-screenshot tray, mirrored (see setAttachments), and
  // every screenshot seen in it lately, by path.
  private attachments: PhoneAttachment[] = [];
  private attachmentPaths: string[] = [];
  private shots = new Map<string, PhoneAttachment & { fromPhone: boolean }>();
  private rateBuckets = new Map<string, { count: number; resetAt: number }>();
  private statusListeners = new Set<StatusListener>();
  private phoneCommandListeners = new Set<(cmd: PhoneCommand) => void>();
  private phoneImageHandler: ((image: PhoneImage) => Promise<unknown>) | null = null;
  private answerRenderer: PhoneAnswerRenderer | null = null;
  // Phone answers still streaming when a new meeting started. They belong to
  // the old session: their late tokens / done / error are not sent or kept.
  private droppedStreams = new Set<string>();
  // Desktop questions whose answer will stream under the same id and has not
  // started: the phone shows Thinking under them (one that connects too).
  private awaitingAnswers = new Set<string>();
  private liveRenderTimer: ReturnType<typeof setTimeout> | null = null;
  private cachedInfo: PhoneMirrorInfo | null = null;
  private cachedQrUrl: string | null = null;
  private cachedQrDataUrl: string | null = null;
  private starting: Promise<PhoneMirrorInfo> | null = null;
  // Debounce rapid connect/disconnect status events to avoid redundant QR re-renders.
  private statusDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // ----- companion browser extension (v2) state -----
  // Epoch (ms) until which the one-click /pair endpoint accepts a handshake.
  // Set by armExtensionPairing(); burned to 0 on the first successful /pair.
  private armedUntil = 0;
  // When /pair last succeeded (see PhoneMirrorInfo.extPairedAt).
  private extPairedAt = 0;
  // WebSocket clients that announced `{type:'hello', role:'extension'}`. Tracked
  // separately from phone clients so capture frames go only to the extension and
  // StreamEvents (phone chat) never reach it.
  private extClients = new Set<WebSocket>();
  // Timestamp of the extension socket per most-recent browser activity, so when
  // several browsers are paired the capture push targets the one in use.
  private extActiveAt = new WeakMap<WebSocket, number>();
  // Timestamp the extension socket announced `hello` — the tie-break for picking a
  // target when no browser has reported activity yet (most-recently-connected wins).
  private extConnectedAt = new WeakMap<WebSocket, number>();
  // Sockets that authenticated with the EXTENSION token at upgrade. A `hello`
  // only self-declares its role, and the phone token travels in the LAN QR code,
  // so meeting tabs (and larger frames) are trusted from these alone.
  private extTokenSockets = new WeakSet<WebSocket>();
  // Whether the app wants each browser's meeting tabs (meetingDetection); told
  // to every extension on its `hello`. The listener gets a socket's latest tabs,
  // or null when that socket closes (null socket: clear every browser).
  private meetingTabsWanted = false;
  private meetingTabsListener: ((socket: object | null, tabs: unknown) => void) | null = null;
  // Who is in a meeting page's call and who is speaking (the Meet reader).
  private meetingPeopleListener: ((socket: object, report: Record<string, unknown>) => void) | null = null;
  // In-flight desktop→extension requests keyed by reqId, resolved by the
  // matching `capture-ack`/`tabs` control frame (or a timeout).
  private pendingCaptures = new Map<string, { resolve: (r: { ok: boolean; reason?: string; category?: string }) => void; timer: ReturnType<typeof setTimeout> }>();
  private pendingTabs = new Map<string, { resolve: (tabs: ExtensionTab[]) => void; timer: ReturnType<typeof setTimeout> }>();
  // reqIds the desktop issued for capture-dom and is still waiting to receive over
  // /dom. The FIRST matching /dom POST consumes its reqId and delivers to the
  // overlay; a later/duplicate POST for the same reqId (a 2nd browser that also
  // captured) finds no entry → answered 200 {duplicate:true} but NOT delivered, so
  // it cannot clobber the winner's "Page context" chip. reqId-less v1 POSTs (popup
  // capture) always deliver. See dom_capture_window_targeting memory (multibrowser).
  private openCaptureReqIds = new Set<string>();
  // Application-level keepalive to extension clients. An incoming WS frame runs the
  // MV3 service worker's onmessage handler → resets its idle-death timer, keeping the
  // capture channel warm while the desktop is up. The protocol ping (15s) keeps the
  // SOCKET alive but does not run SW JS; this `ka` frame does. The extension ignores
  // unknown frame types, so `ka` is harmless to it. See CONTRACT.md MV3 lifecycle.
  private extKeepaliveTimer: ReturnType<typeof setInterval> | null = null;
  // Resolvers waiting on waitForExtension() — settled the instant an extension
  // announces `hello`, so a just-woken MV3 service worker that connects right after
  // the hotkey press is used instead of falling back to a screenshot.
  private extWaiters = new Set<() => void>();
  // Resolver for the window that should receive captured DOM (the overlay that
  // mounts NativelyInterface). When it yields no live window, /dom returns 409.
  private overlayResolver: (() => BrowserWindow | null) | null = null;
  // Smart Browser Context v2 — injected AI metadata classifier (opt-in). When set,
  // the /classify endpoint routes sanitized page metadata through it (which uses
  // the existing provider stack + hard policy engine). Null → /classify is a no-op
  // (404) and the extension proceeds without AI classification.
  private metadataClassifier:
    | ((meta: unknown) => Promise<{ autoPolicy: string; category?: string }>)
    | null = null;
  /**
   * Per-session sentinel: once the IPC layer has shown the "Allow LAN access?"
   * dialog and the user picked "Allow", subsequent calls to setExposeOnLan(true)
   * do not re-prompt. Resets on app restart so a fresh run gets a fresh
   * confirmation. Cleared by markLanBindDialogShown() in the IPC handler.
   */
  private hasShownLanBindDialog = false;

  static getInstance(): PhoneMirrorService {
    if (!PhoneMirrorService._instance) PhoneMirrorService._instance = new PhoneMirrorService();
    return PhoneMirrorService._instance;
  }

  // ----- public lifecycle -----

  isRunning(): boolean {
    return this.server !== null;
  }

  async start(opts?: { exposeOnLan?: boolean; persist?: boolean }): Promise<PhoneMirrorInfo> {
    if (this.starting) return this.starting;
    if (this.isRunning()) {
      if (typeof opts?.exposeOnLan === 'boolean' && opts.exposeOnLan !== this.exposeOnLan) {
        return this.restart({ exposeOnLan: opts.exposeOnLan, persist: opts.persist });
      }
      return this.snapshot();
    }

    const exposeOnLan =
      opts?.exposeOnLan ?? !!SettingsManager.getInstance().get('phoneMirrorExposeOnLan');
    this.starting = this._start(exposeOnLan, opts?.persist !== false);
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async stop(opts?: { persist?: boolean }): Promise<void> {
    if (opts?.persist !== false) {
      SettingsManager.getInstance().set('phoneMirrorEnabled', false);
    }
    await this._teardown();
    this.emitStatus();
  }

  async restart(opts: { exposeOnLan: boolean; persist?: boolean }): Promise<PhoneMirrorInfo> {
    await this._teardown();
    return this.start({ exposeOnLan: opts.exposeOnLan, persist: opts.persist });
  }

  async setExposeOnLan(value: boolean): Promise<PhoneMirrorInfo> {
    // LAN exposure binds the server to 0.0.0.0 so any device on the same Wi-Fi
    // can connect with the pairing token. That is a deliberate security widening,
    // so require an explicit confirmation in the IPC handler — the per-session
    // sentinel short-circuits the prompt for subsequent in-session flips.
    // The phone token is also rotated on every flip (see _start → generateToken)
    // to invalidate any prior QR that may have already leaked to the LAN.
    if (value === true && !this.hasShownLanBindDialog) {
      throw new LANBindConfirmationRequired();
    }
    SettingsManager.getInstance().set('phoneMirrorExposeOnLan', value);
    if (!this.isRunning()) {
      this.exposeOnLan = value;
      return this.snapshot();
    }
    return this.restart({ exposeOnLan: value });
  }

  /**
   * IPC-layer helper: flip the per-session "user has confirmed LAN bind" sentinel
   * AFTER the dialog has returned an explicit Allow. Without this the next
   * setExposeOnLan(true) would re-prompt unnecessarily.
   */
  markLanBindDialogShown(): void {
    this.hasShownLanBindDialog = true;
  }

  /**
   * Whether phone-mirror:enable binding with `exposeOnLan` needs the "Allow
   * LAN access?" consent first: the same per-session rule setExposeOnLan()
   * enforces. A saved phoneMirrorExposeOnLan does not satisfy it, because
   * _start() persists whatever it was given and enable used to bind 0.0.0.0
   * without asking. (The boot-time restore still binds from the saved value
   * without a prompt, as it always has; that path is not an IPC request.)
   */
  needsLanBindConfirmation(exposeOnLan: boolean): boolean {
    if (exposeOnLan !== true || this.hasShownLanBindDialog) return false;
    // Already on the LAN, or starting there (_start sets exposeOnLan first):
    // start() returns that server, so this call binds nothing new, and a
    // decline could not stop the bind already under way.
    return !((this.isRunning() || this.starting !== null) && this.exposeOnLan);
  }

  async rotateToken(): Promise<PhoneMirrorInfo> {
    // Rotate BOTH secrets — the "Rotate token" button is the single deliberate
    // reset for every paired surface. The phone token is per-session anyway; the
    // extension token is persisted, so rotating it (and saving) is the one thing
    // that forces a deliberate extension re-pair, as documented in CONTRACT.md.
    this.token = generateToken();
    this.extToken = generateToken();
    try {
      CredentialsManager.getInstance().setPhoneMirrorToken(this.extToken);
    } catch (_) {
      /* credentials not ready — token still rotates for this session */
    }
    this.invalidateQrCache();
    this.disconnectAllClients(4401, 'Token rotated');
    const info = await this.snapshot();
    this.emitStatus(info);
    return info;
  }

  async dispose(): Promise<void> {
    await this._teardown();
    this.statusListeners.clear();
    this.phoneCommandListeners.clear();
  }

  // ----- public publishing API (called from ipcHandlers) -----

  /**
   * A question asked on the desktop (or the phone's own, echoed back). The
   * desktop publishes it as soon as it has it, before any answer work, so
   * the phone shows it at once; `awaitingAnswer` means an answer will stream
   * under the same id, and the phone shows Thinking until it starts.
   * Published once per id: a fallback path may publish the same question again.
   */
  publishUserMessage(id: string, content: string, opts?: { awaitingAnswer?: boolean }): void {
    if (!this.isRunning() || !content?.trim()) return;
    const msgId = 'u:' + id;
    if (this.history.some((m) => m.id === msgId)) return;
    const msg: PersistedMessage = {
      id: msgId,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    const awaiting = opts?.awaitingAnswer === true;
    if (awaiting) {
      this.awaitingAnswers.add(id);
      if (this.awaitingAnswers.size > 16) this.awaitingAnswers.delete(this.awaitingAnswers.values().next().value as string);
    }
    this.recordHistory(msg);
    this.broadcast({ type: 'user', id: msg.id, content: msg.content, createdAt: msg.createdAt, ...(awaiting ? { awaiting: true } : {}) });
  }

  publishToken(streamId: string, token: string): void {
    if (!this.isRunning() || !token || this.droppedStreams.has(streamId)) return;
    this.awaitingAnswers.delete(streamId);
    if (!this.livePartial || this.livePartial.streamId !== streamId) {
      this.livePartial = { streamId, content: '' };
    }
    this.livePartial.content += token;
    this.broadcast({ type: 'token', streamId, token });
    this.scheduleLiveRender();
  }

  publishDone(streamId: string, fullContent: string): void {
    if (!this.isRunning()) return;
    if (this.droppedStreams.delete(streamId)) return;
    this.awaitingAnswers.delete(streamId);
    const createdAt = new Date().toISOString();
    let content =
      fullContent || (this.livePartial?.streamId === streamId ? this.livePartial.content : '');
    // Prompt System v2 no-action sentinel: never display or record on the
    // phone surface (a second live sink parallel to the renderer).
    try {
      const { shouldSuppressModelOutput, stripLeadingNoActionSentinel } = require('../llm/promptSystemV2') as typeof import('../llm/promptSystemV2');
      if (shouldSuppressModelOutput(content)) content = '';
      else content = stripLeadingNoActionSentinel(content) || content;
    } catch { /* non-fatal */ }
    if (this.livePartial?.streamId === streamId) this.cancelLiveRender();
    if (content.trim()) {
      const payload = this.answerPayload(content);
      const msg: PersistedMessage = { id: 'a:' + streamId, role: 'assistant', createdAt, ...payload };
      this.recordHistory(msg);
      this.broadcast({ type: 'done', streamId, createdAt, ...payload });
    } else {
      // Nothing to show (suppressed, or no words came): still end it, so the
      // phone clears the Thinking it shows for this answer.
      this.broadcast({ type: 'done', streamId, content: '', createdAt });
    }
    if (this.livePartial?.streamId === streamId) this.livePartial = null;
  }

  publishError(streamId: string, message: string): void {
    if (!this.isRunning()) return;
    if (this.droppedStreams.delete(streamId)) return;
    this.awaitingAnswers.delete(streamId);
    if (this.livePartial?.streamId === streamId) this.cancelLiveRender();
    this.broadcast({ type: 'error', streamId, message: String(message || 'Stream error') });
    if (this.livePartial?.streamId === streamId) this.livePartial = null;
  }

  /**
   * Publish a non-streaming assistant response (e.g. from shortcut-triggered actions like
   * Code Hint, What to Answer, Brainstorm, Recap, etc.).  The label is shown in the phone
   * UI as the card's header (e.g. "Code Hint", "What to Answer").
   */
  publishAssistantMessage(id: string, content: string, label: string): void {
    if (!this.isRunning() || !content?.trim()) return;
    // Prompt System v2 no-action sentinel: suppress on the phone surface.
    try {
      const { shouldSuppressModelOutput } = require('../llm/promptSystemV2') as typeof import('../llm/promptSystemV2');
      if (shouldSuppressModelOutput(content)) return;
    } catch { /* non-fatal */ }
    const createdAt = new Date().toISOString();
    const payload = this.answerPayload(content);
    const msg: PersistedMessage = {
      id: 'a:' + id,
      role: 'assistant',
      createdAt,
      label,
      ...payload,
    };
    this.recordHistory(msg);
    this.broadcast({ type: 'assistant', id: msg.id, label, createdAt, ...payload });
  }

  /**
   * Broadcast a one-shot acknowledgement to all connected phones.
   * Used for stealth operations that succeed silently on the desktop side
   * (e.g. "Screenshot captured — queued for AI") so the phone shows a toast.
   */
  publishAck(action: string, message: string): void {
    if (!this.isRunning()) return;
    this.broadcast({ type: 'ack', action, message });
  }

  /**
   * Mirror one STT segment to the phone's live transcript. Called from the same
   * display-only send that feeds the overlay's rolling bar, so partials arrive
   * already throttled. Finals are kept (bounded) so a phone that connects
   * mid-meeting can replay them; the latest partial is kept for the same reason.
   */
  publishTranscript(payload: { speaker: string; text: string; final: boolean; timestamp?: number }): void {
    if (!this.isRunning()) return;
    if (!PHONE_TRANSCRIPT_SPEAKERS.has(payload.speaker)) return;
    const text = String(payload.text || '').trim();
    if (!text) return;
    const segment: PhoneTranscriptSegment = {
      speaker: payload.speaker,
      text,
      ts: typeof payload.timestamp === 'number' ? payload.timestamp : Date.now(),
    };
    if (payload.final) {
      this.transcriptFinals.push(segment);
      this.trimTranscript();
      if (this.transcriptPartial?.speaker === segment.speaker) this.transcriptPartial = null;
    } else {
      this.transcriptPartial = segment;
    }
    this.broadcast({ type: 'transcript', speaker: segment.speaker, text, final: !!payload.final, ts: segment.ts });
  }

  /**
   * Follow the desktop meeting lifecycle. Both edges start the phone over: a
   * meeting START is a new session (the overlay resets on the same boundary),
   * and a meeting END leaves a clean canvas that says the meeting is over, its
   * summary being on the desktop. Tracked even while stopped, so enabling the
   * mirror mid-meeting (or after one) reports it.
   */
  publishMeetingState(active: boolean): void {
    const starting = active && !this.meetingActive;
    const ending = !active && this.meetingActive;
    this.meetingActive = active;
    if (starting || ending) {
      this.meetingEnded = ending;
      // The last meeting's answers and transcript must not greet a phone that
      // connects (or is already open) now.
      this.transcriptFinals = [];
      this.transcriptPartial = null;
      this.history = [];
      this.awaitingAnswers.clear();
      if (this.livePartial) {
        this.droppedStreams.add(this.livePartial.streamId);
        // Bounded: a stream that never finishes must not pin memory.
        if (this.droppedStreams.size > 32) this.droppedStreams.delete(this.droppedStreams.values().next().value as string);
      }
      this.livePartial = null;
      this.cancelLiveRender();
    }
    if (!this.isRunning()) return;
    this.broadcast({ type: 'meeting', active, reset: starting || ending });
  }

  /**
   * Mirror the overlay's attached-screenshot tray: what its next answer will be
   * sent with. The overlay owns the tray, so it reports the whole list on every
   * change (add, remove, clear, send) and this only mirrors it. Tracked while
   * stopped too, so a phone that connects later sees the current tray.
   */
  setAttachments(items: Array<{ path: string; thumb: string }>): void {
    const next: PhoneAttachment[] = [];
    const paths: string[] = [];
    for (const item of Array.isArray(items) ? items.slice(-PHONE_TRAY_LIMIT) : []) {
      const path = typeof item?.path === 'string' ? item.path : '';
      const thumb = typeof item?.thumb === 'string' ? item.thumb : '';
      if (!path || !isPhoneThumb(thumb)) continue;
      const known = this.shots.get(path);
      const shot = { id: known?.id || crypto.randomUUID(), thumb, fromPhone: isPhoneImagePath(path) };
      // Re-inserted so the map drops the least recently seen first.
      this.shots.delete(path);
      this.shots.set(path, shot);
      if (next.some((a) => a.id === shot.id)) continue;
      next.push({ id: shot.id, thumb });
      paths.push(path);
    }
    while (this.shots.size > PHONE_SHOTS_REMEMBERED) this.shots.delete(this.shots.keys().next().value as string);
    const same =
      next.length === this.attachments.length &&
      next.every((a, i) => a.id === this.attachments[i].id && a.thumb === this.attachments[i].thumb);
    this.attachmentPaths = paths;
    if (same) return;
    this.attachments = next;
    this.broadcast({ type: 'attachments', items: next });
  }

  /** The screenshots in the overlay's tray, for a question typed on the phone (the overlay then clears it). */
  getAttachmentPaths(): string[] {
    return [...this.attachmentPaths];
  }

  /** The id a screenshot is known by on the phone (made up now if the tray has not listed it yet). */
  private shotIdFor(path: string): string {
    const known = this.shots.get(path);
    if (known) return known.id;
    const id = crypto.randomUUID();
    this.shots.set(path, { id, thumb: '', fromPhone: isPhoneImagePath(path) });
    while (this.shots.size > PHONE_SHOTS_REMEMBERED) this.shots.delete(this.shots.keys().next().value as string);
    return id;
  }

  private shotPath(id: string): string | null {
    for (const [path, shot] of this.shots) if (shot.id === id) return path;
    return null;
  }

  /**
   * The screenshots a question was just sent with (the overlay's question card
   * shows them). Only screenshots the tray held count, so a card from before an
   * overlay reload is never sent again. The phone's own photos are skipped: it
   * already shows each one where it sent it.
   */
  publishSentImages(id: string, paths: string[]): void {
    if (!this.isRunning() || !id) return;
    const images: PhoneAttachment[] = [];
    for (const path of Array.isArray(paths) ? paths : []) {
      const shot = typeof path === 'string' ? this.shots.get(path) : undefined;
      if (!shot || shot.fromPhone || !shot.thumb || images.some((i) => i.id === shot.id)) continue;
      images.push({ id: shot.id, thumb: shot.thumb });
    }
    const msgId = 'i:' + id;
    if (!images.length || this.history.some((m) => m.id === msgId)) return;
    const createdAt = new Date().toISOString();
    this.recordHistory({ id: msgId, role: 'user', content: '', createdAt, images });
    this.trimImageHistory();
    this.broadcast({ type: 'images', id: msgId, images, createdAt });
  }

  private trimImageHistory(): void {
    let chars = 0;
    let newest = true;
    for (let i = this.history.length - 1; i >= 0; i--) {
      const images = this.history[i].images;
      if (!images) continue;
      for (const image of images) chars += image.thumb.length;
      if (!newest && chars > PHONE_IMAGE_HISTORY_CHARS) this.history.splice(i, 1);
      newest = false;
    }
  }

  private trimTranscript(): void {
    if (this.transcriptFinals.length > TRANSCRIPT_SEGMENT_LIMIT) {
      this.transcriptFinals = this.transcriptFinals.slice(-TRANSCRIPT_SEGMENT_LIMIT);
    }
    let chars = 0;
    for (const s of this.transcriptFinals) chars += s.text.length;
    // Drop whole segments from the front; always keep the newest one.
    let drop = 0;
    while (chars > TRANSCRIPT_CHAR_LIMIT && drop < this.transcriptFinals.length - 1) {
      chars -= this.transcriptFinals[drop].text.length;
      drop++;
    }
    if (drop > 0) this.transcriptFinals = this.transcriptFinals.slice(drop);
  }

  /** Returns true when at least one phone browser is connected. */
  hasClients(): boolean {
    return this.phoneClientCount() > 0;
  }

  /**
   * Subscribe to commands sent from the phone browser.
   * Returns an unsubscribe function.
   */
  onPhoneCommand(listener: (cmd: PhoneCommand) => void): () => void {
    this.phoneCommandListeners.add(listener);
    return () => this.phoneCommandListeners.delete(listener);
  }

  /**
   * Where images the phone sends (POST /image) go. The service stores nothing:
   * it checks the upload, hands the bytes here, and answers the phone with how
   * that went. One handler (main.ts owns the screenshot queue); a later call
   * replaces it, and the returned function clears it if it is still current.
   */
  /**
   * How answers become the phone's HTML. main.ts registers the desktop-side
   * renderer (marked + the overlay's math and gist rules); it lives outside
   * this service so marked and KaTeX are bundled once, not into every bundle
   * that imports the service. Without one, the page renders answers itself.
   */
  setAnswerRenderer(renderer: PhoneAnswerRenderer | null): void {
    this.answerRenderer = renderer;
  }

  /**
   * A finished answer as the phone receives and stores it. `content` is the
   * answer TEXT (what "Copy conversation" and replays use), without the
   * trailing [[GIST]] line; the gist rides separately in `gist` for the chip.
   * Rendered from the RAW answer first, so the desktop renderer still sees
   * the marker it splits.
   */
  private answerPayload(raw: string): { content: string; html?: string; gist?: string | null } {
    const rendered = this.renderAnswer(raw);
    const content = stripGistTrailer(raw);
    if (rendered) return { content, html: rendered.html, gist: rendered.gist };
    const gist = content === raw ? null : splitGistLine(raw).gist;
    return gist ? { content, gist } : { content };
  }

  private renderAnswer(markdown: string, streaming = false): { html: string; gist: string | null } | null {
    if (!this.answerRenderer || !markdown) return null;
    try {
      return this.answerRenderer(markdown, { streaming });
    } catch (err: any) {
      console.warn('[PhoneMirror] answer render failed, the page will render it:', err?.message || err);
      return null;
    }
  }

  /**
   * A diagram finished drawing (or failed) after answers containing it were
   * already rendered. Tell connected phones, and re-render the stored history
   * entries that hold it so a phone joining later gets the picture too.
   * `dataUrl` null = it could not be drawn.
   */
  publishDiagram(key: string, dataUrl: string | null): void {
    if (!key) return;
    const marker = `data-diagram="${key}"`;
    for (const msg of this.history) {
      if (msg.role !== 'assistant' || !msg.html || !msg.html.includes(marker)) continue;
      const rendered = this.renderAnswer(msg.content);
      if (rendered) msg.html = rendered.html;
    }
    if (!this.isRunning()) return;
    this.broadcast(dataUrl ? { type: 'diagram', key, src: dataUrl } : { type: 'diagram', key });
    // An answer still streaming re-renders on its own timer; nudge it so the
    // picture does not wait for the next token.
    if (this.livePartial) this.scheduleLiveRender();
  }

  /** While a phone question streams, send its rendered HTML at most every LIVE_RENDER_INTERVAL_MS. */
  private scheduleLiveRender(): void {
    if (this.liveRenderTimer || !this.answerRenderer) return;
    this.liveRenderTimer = setTimeout(() => {
      this.liveRenderTimer = null;
      const live = this.livePartial;
      if (!live || !this.hasClients()) return;
      const rendered = this.renderAnswer(live.content, true);
      if (rendered) this.broadcast({ type: 'render', streamId: live.streamId, html: rendered.html, gist: rendered.gist });
    }, LIVE_RENDER_INTERVAL_MS);
  }

  private cancelLiveRender(): void {
    if (this.liveRenderTimer) clearTimeout(this.liveRenderTimer);
    this.liveRenderTimer = null;
  }

  setPhoneImageHandler(handler: (image: PhoneImage) => Promise<unknown>): () => void {
    this.phoneImageHandler = handler;
    return () => {
      if (this.phoneImageHandler === handler) this.phoneImageHandler = null;
    };
  }

  // ----- companion browser extension (v2) public API -----

  /**
   * Open the one-click /pair window for the companion extension. The user clicks
   * "Connect browser extension" in Settings → this arms /pair for 60s; the next
   * /pair POST from the pinned extension origin succeeds and burns the window.
   */
  armExtensionPairing(): { armedMs: number } {
    this.armedUntil = Date.now() + PAIR_ARM_WINDOW_MS;
    console.log('[PhoneMirror] extension pairing armed for', PAIR_ARM_WINDOW_MS, 'ms');
    return { armedMs: PAIR_ARM_WINDOW_MS };
  }

  /** True while the /pair window is open (set by armExtensionPairing). */
  private isArmed(): boolean {
    return Date.now() < this.armedUntil;
  }

  /**
   * Ask the connected extensions to report their open meeting tabs (keys and
   * titles only) or to stop. Each extension also hears it on connect.
   */
  setMeetingTabsWanted(on: boolean): void {
    this.meetingTabsWanted = on;
    for (const c of this.extClients) {
      if (this.extTokenSockets.has(c)) this.sendMeetingTabsSubscribe(c, on);
    }
    if (!on) this.meetingTabsListener?.(null, null);
  }

  /** Where each browser's meeting tabs go (see meetingDetection/extensionMeetingTabs.ts). */
  onMeetingTabs(listener: ((socket: object | null, tabs: unknown) => void) | null): void {
    this.meetingTabsListener = listener;
  }

  /** Where a meeting page's participants and speaking reports go (meetingDetection/extensionMeetingTabs.ts). */
  onMeetingPeople(listener: ((socket: object, report: Record<string, unknown>) => void) | null): void {
    this.meetingPeopleListener = listener;
  }

  private sendMeetingTabsSubscribe(ws: WebSocket, on: boolean): void {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'meeting-tabs-subscribe', on }));
    } catch (_) {
      /* the close handler clears this socket */
    }
  }

  /** True when at least one companion extension is connected over /ws. */
  hasExtensionClient(): boolean {
    for (const c of this.extClients) {
      if (c.readyState === WebSocket.OPEN) return true;
    }
    return false;
  }

  /**
   * Resolve true once an extension is connected, waiting up to `timeoutMs` for one
   * to appear. The MV3 race fix: when the capture hotkey fires, the extension's
   * service worker may have been idle-killed and is only just reconnecting (its
   * wake-on-interaction / alarm handlers re-open the WS). Without this poll a
   * just-woken SW means an instant screenshot fallback instead of the page capture
   * the user wanted. Resolves immediately if already connected, or the moment a
   * `hello` arrives mid-wait, else false on timeout. See CONTRACT.md MV3 lifecycle.
   */
  waitForExtension(timeoutMs: number = WAIT_FOR_EXTENSION_MS): Promise<boolean> {
    if (this.hasExtensionClient()) return Promise.resolve(true);
    if (!this.isRunning()) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.extWaiters.delete(waiter);
        resolve(ok);
      };
      // Re-check on wake rather than assuming true: a teardown also fires waiters
      // (after clearing extClients), and that must resolve false → screenshot.
      const waiter = () => finish(this.hasExtensionClient());
      const timer = setTimeout(() => finish(false), Math.max(0, timeoutMs));
      this.extWaiters.add(waiter);
    });
  }

  /** Count of connected PHONE clients (excludes companion extension sockets). */
  private phoneClientCount(): number {
    if (!this.wss) return 0;
    let n = 0;
    for (const c of this.wss.clients) {
      if (this.extClients.has(c)) continue;
      n++;
    }
    return n;
  }

  /**
   * Set the resolver for the window that should receive captured DOM. This is
   * the overlay window that mounts NativelyInterface — captured page content is
   * only meaningful when an active session/overlay exists. When the resolver
   * returns no live window, /dom answers 409 no_active_session.
   */
  setOverlayResolver(fn: () => BrowserWindow | null): void {
    this.overlayResolver = fn;
  }

  /**
   * Inject the AI metadata classifier (opt-in). The function receives SANITIZED
   * metadata only (the extension's buildSafeMetadata output) and returns the hard
   * policy verdict. Pass null to disable the /classify endpoint. Wired from
   * ipcHandlers with a BrowserMetadataClassifierService bound to the live LLMHelper.
   */
  setMetadataClassifier(
    fn: ((meta: unknown) => Promise<{ autoPolicy: string; category?: string }>) | null,
  ): void {
    this.metadataClassifier = fn;
  }

  /**
   * Ask the most-recently-active companion extension to capture the active tab
   * (or `tabId`) and POST it to /dom. Resolves when the extension acks `done`,
   * or `{ok:false}` on error/timeout/no-extension so the caller can fall back
   * to a screenshot. The DOM itself flows over /dom, not this promise.
   */
  requestDomCapture(opts?: { tabId?: number; timeoutMs?: number }): Promise<{ ok: boolean; reason?: string }> {
    const target = this.pickExtensionClient();
    if (!target) return Promise.resolve({ ok: false, reason: 'no-extension' });
    const reqId = generateToken();
    // Register the reqId so the FIRST matching /dom POST delivers to the overlay and
    // any later duplicate (a 2nd browser that also captured) is gated out. The entry
    // is consumed on first /dom POST or cleared on settle below.
    this.openCaptureReqIds.add(reqId);
    return new Promise((resolve) => {
      const settle = (r: { ok: boolean; reason?: string }) => {
        this.openCaptureReqIds.delete(reqId);
        resolve(r);
      };
      const timer = setTimeout(() => {
        this.pendingCaptures.delete(reqId);
        settle({ ok: false, reason: 'timeout' });
      }, opts?.timeoutMs ?? CAPTURE_TIMEOUT_MS);
      this.pendingCaptures.set(reqId, { resolve: settle, timer });
      try {
        target.send(
          JSON.stringify({ type: 'capture-dom', reqId, tabId: opts?.tabId }),
        );
      } catch (_) {
        clearTimeout(timer);
        this.pendingCaptures.delete(reqId);
        settle({ ok: false, reason: 'send-failed' });
      }
    });
  }

  /**
   * Smart Browser Context v2 — ask the active extension to AUTO-attach context
   * just before an answer. The extension classifies the active tab IN the page
   * and only posts a structured envelope to /dom when its local policy permits
   * (high-confidence coding). Resolves:
   *   { attached:true }  — context was captured + posted (arrives over /dom),
   *   { attached:false, reason:'none'|'no-extension'|'timeout'|... } — nothing
   *     eligible (no coding page, or a sensitive page deliberately skipped) →
   *     the caller proceeds WITHOUT browser context.
   * Mirrors requestDomCapture's reqId anti-clobber + timeout machinery.
   */
  requestAutoContext(opts?: {
    timeoutMs?: number;
    fullPage?: boolean;
    /** Tell the extension the AI metadata classifier is enabled (opt-in). */
    aiClassify?: boolean;
    /** Opted-in extra categories treated as auto-eligible (e.g. job_description). */
    extraCategories?: string[];
    /**
     * Whether high-confidence coding pages should auto-attach. Defaults to true
     * (back-compat); when the caller passes false, the extension drops the
     * coding eligibility branch so a coding page is NOT captured even if another
     * auto path is enabled.
     */
    codingEnabled?: boolean;
  }): Promise<{ attached: boolean; reason?: string; category?: string }> {
    const target = this.pickExtensionClient();
    if (!target) return Promise.resolve({ attached: false, reason: 'no-extension' });
    const reqId = generateToken();
    const fullPage = opts?.fullPage === true;
    const aiClassify = opts?.aiClassify === true;
    // Default true so existing callers (and the back-compat tests) keep coding
    // auto-attach; only an explicit false disables the coding branch.
    const codingEnabled = opts?.codingEnabled !== false;
    // The AI path does an extra /classify round-trip + a second extract, so allow
    // a longer deadline when it's enabled (still bounded; the `started` ack also
    // extends once). Non-AI captures keep the snappy default.
    const defaultTimeout = aiClassify ? AUTO_CONTEXT_AI_TIMEOUT_MS : CAPTURE_TIMEOUT_MS;
    this.openCaptureReqIds.add(reqId);
    return new Promise((resolve) => {
      const settle = (r: { ok: boolean; reason?: string; category?: string }) => {
        this.openCaptureReqIds.delete(reqId);
        resolve(
          r.ok
            ? { attached: true, category: r.category }
            : { attached: false, reason: r.reason },
        );
      };
      const timer = setTimeout(() => {
        this.pendingCaptures.delete(reqId);
        settle({ ok: false, reason: 'timeout' });
      }, opts?.timeoutMs ?? defaultTimeout);
      this.pendingCaptures.set(reqId, { resolve: settle, timer });
      try {
        target.send(
          JSON.stringify({
            type: 'request-auto-context',
            reqId,
            fullPage,
            aiClassify,
            codingEnabled,
            extraCategories: opts?.extraCategories,
          }),
        );
      } catch (_) {
        clearTimeout(timer);
        this.pendingCaptures.delete(reqId);
        settle({ ok: false, reason: 'send-failed' });
      }
    });
  }

  /**
   * Ask the active extension for its open-tab list (multi-tab picker). Resolves
   * with [] on timeout / no extension. Plumbed now even before a UI consumes it.
   */
  listTabs(timeoutMs?: number): Promise<ExtensionTab[]> {
    const target = this.pickExtensionClient();
    if (!target) return Promise.resolve([]);
    const reqId = generateToken();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingTabs.delete(reqId);
        resolve([]);
      }, timeoutMs ?? LIST_TABS_TIMEOUT_MS);
      this.pendingTabs.set(reqId, { resolve, timer });
      try {
        target.send(JSON.stringify({ type: 'list-tabs', reqId }));
      } catch (_) {
        clearTimeout(timer);
        this.pendingTabs.delete(reqId);
        resolve([]);
      }
    });
  }

  /**
   * Choose which single extension socket to push to when several browsers are
   * paired. We send to exactly ONE (never broadcast) so several browsers can't race
   * N captures into /dom and clobber each other's overlay chip. The pick is the
   * browser most-recently-active (the `{type:'active'}` focus signal → extActiveAt),
   * tie-broken by most-recently-connected (extConnectedAt). Arbitration lives in the
   * pure pickTargetExtensionIndex() helper so it is unit-testable.
   */
  private pickExtensionClient(): WebSocket | null {
    const open: WebSocket[] = [];
    for (const c of this.extClients) {
      if (c.readyState === WebSocket.OPEN) open.push(c);
    }
    if (open.length === 0) return null;
    const idx = pickTargetExtensionIndex(
      open.map((c) => ({
        activeAt: this.extActiveAt.get(c) ?? 0,
        connectedAt: this.extConnectedAt.get(c) ?? 0,
      })),
    );
    return open[idx] ?? null;
  }

  /** Release everyone parked in waitForExtension() (an extension just connected). */
  private notifyExtensionWaiters(): void {
    if (this.extWaiters.size === 0) return;
    // Copy first — each waiter removes itself from the set as it settles.
    for (const w of [...this.extWaiters]) {
      try {
        w();
      } catch (_) {
        /* noop */
      }
    }
  }

  /**
   * Start the application-level keepalive that pings extension clients with a
   * `{type:'ka'}` frame every ~20s. An incoming WS frame runs the MV3 service
   * worker's onmessage handler, resetting its idle-death timer so the capture
   * channel stays warm while the desktop is up. No-op if already running or if no
   * extension is connected; stopped in _teardown.
   */
  private ensureExtensionKeepalive(): void {
    if (this.extKeepaliveTimer !== null) return;
    this.extKeepaliveTimer = setInterval(() => {
      let sent = 0;
      const frame = JSON.stringify({ type: 'ka', ts: Date.now() });
      for (const c of this.extClients) {
        if (c.readyState !== WebSocket.OPEN) continue;
        try {
          c.send(frame);
          sent++;
        } catch (_) {
          /* socket gone — close handler cleans up */
        }
      }
      // Nothing left to keep warm → stop the timer until the next extension connects.
      if (sent === 0) this.stopExtensionKeepalive();
    }, EXT_KEEPALIVE_MS);
    // Don't let the keepalive hold the event loop open on shutdown.
    (this.extKeepaliveTimer as any)?.unref?.();
  }

  private stopExtensionKeepalive(): void {
    if (this.extKeepaliveTimer !== null) {
      clearInterval(this.extKeepaliveTimer);
      this.extKeepaliveTimer = null;
    }
  }

  /**
   * The live window that should receive captured DOM. Prefers the configured
   * overlay resolver (the window mounting NativelyInterface); falls back to any
   * live BrowserWindow only if no resolver is set (keeps standalone use working).
   * Returns null when no live window exists → /dom answers 409.
   */
  private resolveDomTargetWindow(): BrowserWindow | null {
    if (this.overlayResolver) {
      try {
        const win = this.overlayResolver();
        if (win && !win.isDestroyed()) return win;
        return null;
      } catch (_) {
        return null;
      }
    }
    const fallback =
      BrowserWindow.getFocusedWindow() ||
      BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ||
      null;
    return fallback && !fallback.isDestroyed() ? fallback : null;
  }

  /**
   * Route an inbound control frame from a companion extension socket. Resolves
   * pending requestDomCapture()/listTabs() promises and records browser activity
   * for multi-browser arbitration. Returns true if the frame was an extension
   * control frame (so the phone-command path is skipped).
   */
  private handleExtensionFrame(ws: WebSocket, msg: Record<string, unknown>): boolean {
    switch (msg.type) {
      case 'hello':
        if (msg.role === 'extension') {
          const now = Date.now();
          this.extClients.add(ws);
          this.extActiveAt.set(ws, now);
          this.extConnectedAt.set(ws, now);
          console.log('[PhoneMirror] companion extension connected (capture channel ready)');
          // Begin keeping the MV3 service worker warm and release any hotkey waiters.
          this.ensureExtensionKeepalive();
          this.notifyExtensionWaiters();
          // Push a status update so the Settings "Connected" dot flips green the
          // instant the extension's `hello` arrives. The raw-connection emit in
          // handleWsConnection() fired BEFORE this hello (socket not yet in
          // extClients → extensionConnected still false), and the only other emit
          // is on disconnect — so without this, the dot stays "Not connected"
          // until an unrelated status event (a phone joining, or reopening
          // Settings) happens to refresh it.
          this.emitStatusClientCount();
          if (this.meetingTabsWanted && this.extTokenSockets.has(ws)) this.sendMeetingTabsSubscribe(ws, true);
          return true;
        }
        return false;
      case 'meeting-tabs':
        // A browser's open meeting tabs, which calendar linking reads. Only from
        // an extension-token socket, and only while the app asked for them.
        if (this.meetingTabsWanted && this.extTokenSockets.has(ws)) this.meetingTabsListener?.(ws, msg.tabs);
        return true;
      case 'meeting-people':
        // A meeting page's participants and who is speaking, for names on the
        // transcript. Same gate as the tabs.
        if (this.meetingTabsWanted && this.extTokenSockets.has(ws)) this.meetingPeopleListener?.(ws, msg);
        return true;
      case 'active':
        if (this.extClients.has(ws)) this.extActiveAt.set(ws, Date.now());
        return true;
      case 'capture-ack': {
        if (typeof msg.reqId !== 'string') return true;
        this.extActiveAt.set(ws, Date.now());
        const status = msg.status;
        if (status === 'done' || status === 'error' || status === 'none') {
          // Terminal — settle the pending capture. `none` (Smart Browser Context
          // v2 auto-context) means the extension found nothing eligible to
          // auto-attach (no high-confidence coding page, or a sensitive page that
          // is deliberately not captured) — NOT an error. The caller proceeds
          // without browser context.
          const pending = this.pendingCaptures.get(msg.reqId);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingCaptures.delete(msg.reqId);
            pending.resolve(
              status === 'done'
                ? { ok: true, category: typeof msg.category === 'string' ? msg.category : undefined }
                : status === 'none'
                  ? { ok: false, reason: 'none' }
                  : { ok: false, reason: typeof msg.error === 'string' ? msg.error : 'error' },
            );
          }
        } else if (status === 'started' || status === 'posting') {
          // Progress: the extension is alive and actively working (injecting the
          // content script, extracting, POSTing). Extend the deadline once so a slow
          // page (big DOM, multi-port /healthz discovery) doesn't trip the 2.5s
          // timeout and fall back to a screenshot while a real capture is in flight.
          // This is what CONTRACT.md means by "`started` extends the desktop deadline".
          const reqId = msg.reqId;
          const pending = this.pendingCaptures.get(reqId);
          if (pending) {
            clearTimeout(pending.timer);
            const timer = setTimeout(() => {
              // pending.resolve is the settle() closure from requestDomCapture — it
              // clears openCaptureReqIds and resolves. Delete the in-flight entry too.
              this.pendingCaptures.delete(reqId);
              pending.resolve({ ok: false, reason: 'timeout' });
            }, CAPTURE_TIMEOUT_MS);
            (timer as any)?.unref?.();
            pending.timer = timer;
          }
        }
        return true;
      }
      case 'tabs': {
        if (typeof msg.reqId !== 'string') return true;
        const pending = this.pendingTabs.get(msg.reqId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingTabs.delete(msg.reqId);
          const tabs = Array.isArray(msg.tabs)
            ? (msg.tabs as unknown[])
                .map((t) => t as Record<string, unknown>)
                .filter((t) => typeof t.id === 'number')
                .map((t) => ({
                  id: t.id as number,
                  title: typeof t.title === 'string' ? t.title : '',
                  url: typeof t.url === 'string' ? t.url : '',
                }))
            : [];
          pending.resolve(tabs);
        }
        return true;
      }
      default:
        return false;
    }
  }

  // ----- snapshot / status -----

  async snapshot(): Promise<PhoneMirrorInfo> {
    const enabled = !!SettingsManager.getInstance().get('phoneMirrorEnabled');
    if (!this.isRunning()) {
      const info: PhoneMirrorInfo = {
        running: false,
        enabled,
        exposeOnLan: this.exposeOnLan,
        port: 0,
        loopbackUrl: null,
        primaryUrl: null,
        lanUrls: [],
        token: null,
        extToken: null,
        qrDataUrl: null,
        clients: 0,
        extensionConnected: false,
        extPairedAt: this.extPairedAt,
        bindAddress: this.exposeOnLan ? '0.0.0.0' : '127.0.0.1',
      };
      this.cachedInfo = info;
      return info;
    }
    const loopbackUrl = `http://127.0.0.1:${this.port}/?t=${this.token}`;
    const lanUrls = this.exposeOnLan
      ? getLanIPs().map((ip) => `http://${ip}:${this.port}/?t=${this.token}`)
      : [];
    // If LAN is on, only advertise a real LAN URL — falling back to 127.0.0.1
    // would print a QR code the phone cannot reach (loopback ≠ phone).
    const primaryUrl = this.exposeOnLan ? lanUrls[0] || null : loopbackUrl;
    let qrDataUrl: string | null = null;
    if (primaryUrl) {
      if (this.cachedQrUrl === primaryUrl && this.cachedQrDataUrl) {
        qrDataUrl = this.cachedQrDataUrl;
      } else {
        qrDataUrl = await safeQr(primaryUrl);
        this.cachedQrUrl = primaryUrl;
        this.cachedQrDataUrl = qrDataUrl;
      }
    } else {
      this.cachedQrUrl = null;
      this.cachedQrDataUrl = null;
    }
    const info: PhoneMirrorInfo = {
      running: true,
      enabled,
      exposeOnLan: this.exposeOnLan,
      port: this.port,
      loopbackUrl,
      primaryUrl,
      lanUrls,
      token: this.token,
      extToken: this.extToken,
      qrDataUrl,
      clients: this.phoneClientCount(),
      extensionConnected: this.hasExtensionClient(),
      extPairedAt: this.extPairedAt,
      bindAddress: this.bindAddress,
    };
    this.cachedInfo = info;
    return info;
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  // ----- internals -----

  private async _start(exposeOnLan: boolean, persistEnabled: boolean): Promise<PhoneMirrorInfo> {
    this.exposeOnLan = exposeOnLan;
    // Phone token: fresh per session. It rides the LAN in a plaintext QR URL, so a
    // short-lived secret is the safer default — the phone re-scans each session.
    this.token = generateToken();
    // Extension token: reuse the persisted value so the extension pairs ONCE and
    // survives restarts; mint + persist only when there is none yet. Only a
    // deliberate Rotate changes it (see rotateToken).
    this.extToken = loadOrCreatePersistedExtToken();
    this.invalidateQrCache();

    const host = exposeOnLan ? '0.0.0.0' : '127.0.0.1';
    const basePort = DEFAULT_PORT;
    const server = http.createServer((req, res) => this.handleHttp(req, res));
    server.on('clientError', (_err, socket) => {
      try {
        socket.destroy();
      } catch (_) {
        /* noop */
      }
    });

    const port = await listenWithProbe(server, host, basePort, PORT_PROBE_RANGE);
    this.server = server;
    this.port = port;
    // Cache the resolved bind host for snapshot() — the UI uses it to render
    // "loopback only" vs "(LAN)" in the Enable status row.
    this.bindAddress = host;

    const wss = new WebSocketServer({ noServer: true });
    this.wss = wss;
    server.on('upgrade', (req, socket, head) =>
      this.handleUpgrade(req as http.IncomingMessage, socket as any, head),
    );
    wss.on('connection', (ws, req) => this.handleWsConnection(ws, req));

    if (persistEnabled) {
      SettingsManager.getInstance().set('phoneMirrorEnabled', true);
      SettingsManager.getInstance().set('phoneMirrorExposeOnLan', exposeOnLan);
    }

    const info = await this.snapshot();
    this.emitStatus(info);
    console.log(`[PhoneMirror] listening on ${host}:${port} (lan=${exposeOnLan})`);
    return info;
  }

  private async _teardown(): Promise<void> {
    // Cancel any pending debounced status emit so it doesn't fire after teardown.
    if (this.statusDebounceTimer !== null) {
      clearTimeout(this.statusDebounceTimer);
      this.statusDebounceTimer = null;
    }
    const wss = this.wss;
    const server = this.server;
    this.wss = null;
    this.server = null;
    this.port = 0;
    this.token = '';
    this.extToken = '';
    this.livePartial = null;
    this.cancelLiveRender();
    this.rateBuckets.clear();
    this.armedUntil = 0;
    this.extClients.clear();
    this.meetingTabsListener?.(null, null);
    this.openCaptureReqIds.clear();
    this.stopExtensionKeepalive();
    // Release any waitForExtension() callers so the capture path doesn't hang on
    // shutdown — they resolve false (no extension) and fall back to a screenshot.
    for (const w of [...this.extWaiters]) {
      try {
        w();
      } catch (_) {
        /* noop */
      }
    }
    this.extWaiters.clear();
    // Settle any in-flight extension requests so callers don't hang on shutdown.
    for (const { resolve, timer } of this.pendingCaptures.values()) {
      clearTimeout(timer);
      resolve({ ok: false, reason: 'shutting-down' });
    }
    this.pendingCaptures.clear();
    for (const { resolve, timer } of this.pendingTabs.values()) {
      clearTimeout(timer);
      resolve([]);
    }
    this.pendingTabs.clear();
    if (wss) {
      for (const c of wss.clients) {
        try {
          c.close(1001, 'shutting down');
        } catch (_) {
          /* noop */
        }
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    }
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    const remote = req.socket.remoteAddress || '0.0.0.0';
    if (!this.rateAllow(remote)) {
      res.writeHead(429, { 'Content-Type': 'text/plain', 'Retry-After': '30' });
      res.end('Too many requests');
      return;
    }

    const fullUrl = new URL(req.url || '/', 'http://localhost');
    const requestOrigin = req.headers.origin || '';
    // Enforce strict 32-character [a-p] Chrome extension ID structure to prevent generic extension spoofing
    const originMatch = requestOrigin.match(/^chrome-extension:\/\/([a-p]{32})$/);
    const allowedOrigin = originMatch ? requestOrigin : '';

    // CORS preflight options check for /dom route specifically
    if (req.method === 'OPTIONS' && fullUrl.pathname === '/dom') {
      const headers: Record<string, string> = {
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      };
      if (allowedOrigin) {
        headers['Access-Control-Allow-Origin'] = allowedOrigin;
      }
      res.writeHead(204, headers);
      res.end();
      return;
    }

    const provided = fullUrl.searchParams.get('t');

    // Health endpoint — minimal info, never reveals token or DB paths.
    if (fullUrl.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, clients: this.phoneClientCount() }));
      return;
    }

    // Cross-process companion extension DOM context bridge.
    // Gated by the EXTENSION token (loopback-scoped), NOT the phone token — a
    // phone token sniffed off the plaintext LAN QR must never reach this capture
    // capability. Only the extension, which paired over the exact-origin /pair
    // gate, holds extToken.
    if (fullUrl.pathname === '/dom') {
      if (req.method !== 'POST') {
        const headers: Record<string, string> = { 'Content-Type': 'text/plain' };
        if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;
        res.writeHead(405, headers);
        res.end('Method Not Allowed');
        return;
      }

      if (!provided || !timingSafeEqualStr(provided, this.extToken)) {
        const headers: Record<string, string> = { 'Content-Type': 'text/plain' };
        if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;
        res.writeHead(401, headers);
        res.end('Pairing token missing or invalid.');
        return;
      }

      let body = '';
      let limitExceeded = false;
      req.on('data', (chunk) => {
        if (limitExceeded) return;
        body += chunk;
        if (body.length > 500000) {
          limitExceeded = true;
          const headers: Record<string, string> = { 'Content-Type': 'text/plain' };
          if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;
          res.writeHead(413, headers);
          res.end('Payload Too Large');
          req.socket.destroy();
        }
      });
      req.on('end', () => {
        if (limitExceeded) return;
        try {
          const parsed = JSON.parse(body);
          if (parsed && typeof parsed.dom === 'string') {
            const jsonHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
            if (allowedOrigin) jsonHeaders['Access-Control-Allow-Origin'] = allowedOrigin;

            // A probe is a liveness/auth check (connection status, manual-pair
            // validation). It authenticated above, so answer 200 — but NEVER
            // deliver it to the overlay, or a phantom "14 chars" page-context
            // chip would appear on every status check.
            if (parsed.probe === true) {
              res.writeHead(200, jsonHeaders);
              res.end(JSON.stringify({ success: true }));
              return;
            }

            // Anti-clobber gate (multi-browser): a desktop-pull capture stamps a
            // reqId. The FIRST /dom POST carrying that reqId is the winner and
            // delivers to the overlay; consuming the reqId here. A later POST for the
            // SAME reqId (a 2nd browser — Chrome+Edge+Arc — that also captured, or a
            // retry) finds no open reqId → authenticated 200 {duplicate:true} but is
            // NOT delivered, so it can't overwrite the winner's "Page context" chip.
            // reqId-less POSTs (v1 popup "Capture") always deliver.
            if (typeof parsed.reqId === 'string') {
              if (!this.openCaptureReqIds.has(parsed.reqId)) {
                res.writeHead(200, jsonHeaders);
                res.end(JSON.stringify({ success: true, duplicate: true }));
                return;
              }
              this.openCaptureReqIds.delete(parsed.reqId);
            }

            const cappedDom = parsed.dom.substring(0, DOM_CONTEXT_MAX_CHARS);
            // Deliver to the overlay window (the one that mounts NativelyInterface).
            // No live overlay → no active session to receive context → 409, so the
            // extension can tell the user to start a Natively session first.
            const targetWin = this.resolveDomTargetWindow();
            if (!targetWin) {
              res.writeHead(409, jsonHeaders);
              res.end(JSON.stringify({ error: 'no_active_session' }));
              return;
            }
            const meta = sanitizeCaptureMeta(parsed.meta);
            // Smart Browser Context v2: an optional structured envelope rides
            // alongside the legacy `dom` string. Validate + sanitize it; on any
            // problem it is dropped (undefined) and we fall back to the plain
            // string behaviour. The third IPC arg is ADDITIVE — existing 2-arg
            // listeners (onDomContextReceived(dom, meta)) keep working unchanged.
            const envelope = sanitizeContextEnvelope(parsed.envelope);
            targetWin.webContents.send('dom-context-received', cappedDom, meta, envelope);
            res.writeHead(200, jsonHeaders);
            res.end(JSON.stringify({ success: true }));
            return;
          }
        } catch (_) {}
        const headers: Record<string, string> = { 'Content-Type': 'text/plain' };
        if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;
        res.writeHead(400, headers);
        res.end('Bad Request');
      });
      return;
    }

    // Smart Browser Context v2 — AI metadata classification (opt-in). The
    // extension POSTs SANITIZED METADATA ONLY (no page body/code/secrets) and
    // gets back the hard-policy verdict. Same extToken auth + extension-origin
    // CORS as /dom; a small body cap (metadata is tiny). 404 when no classifier
    // is injected (feature off) so the extension proceeds without AI.
    if (fullUrl.pathname === '/classify') {
      const jsonHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (allowedOrigin) jsonHeaders['Access-Control-Allow-Origin'] = allowedOrigin;
      if (req.method === 'OPTIONS') {
        const h: Record<string, string> = {
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        };
        if (allowedOrigin) h['Access-Control-Allow-Origin'] = allowedOrigin;
        res.writeHead(204, h);
        res.end();
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405, jsonHeaders);
        res.end(JSON.stringify({ error: 'method_not_allowed' }));
        return;
      }
      if (!provided || !timingSafeEqualStr(provided, this.extToken)) {
        res.writeHead(401, jsonHeaders);
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      if (!this.metadataClassifier) {
        // Feature off / no provider wired — tell the extension to skip AI.
        res.writeHead(404, jsonHeaders);
        res.end(JSON.stringify({ error: 'classifier_unavailable' }));
        return;
      }
      let body = '';
      let tooLarge = false;
      req.on('data', (chunk) => {
        if (tooLarge) return;
        body += chunk;
        // Sanitized metadata is small; a generous 32 KB cap rejects abuse.
        if (body.length > 32_768) {
          tooLarge = true;
          res.writeHead(413, jsonHeaders);
          res.end(JSON.stringify({ error: 'payload_too_large' }));
          req.socket.destroy();
        }
      });
      req.on('end', () => {
        if (tooLarge) return;
        let meta: unknown;
        try {
          const parsed = JSON.parse(body);
          meta = parsed && typeof parsed === 'object' ? (parsed as { meta?: unknown }).meta : undefined;
        } catch {
          res.writeHead(400, jsonHeaders);
          res.end(JSON.stringify({ error: 'bad_request' }));
          return;
        }
        if (!meta || typeof meta !== 'object') {
          res.writeHead(400, jsonHeaders);
          res.end(JSON.stringify({ error: 'bad_request' }));
          return;
        }
        // Route through the injected classifier (existing provider stack + hard
        // policy engine). Any failure → conservative manual verdict, never a 500.
        this.metadataClassifier!(meta)
          .then((verdict) => {
            res.writeHead(200, jsonHeaders);
            res.end(
              JSON.stringify({
                autoPolicy: verdict?.autoPolicy || 'manual',
                category: verdict?.category,
              }),
            );
          })
          .catch(() => {
            res.writeHead(200, jsonHeaders);
            res.end(JSON.stringify({ autoPolicy: 'manual' }));
          });
      });
      return;
    }

    // One-click pairing for the companion extension. Strictly gated:
    //  - loopback caller only (never reachable off-box even with exposeOnLan),
    //  - Origin must EXACTLY equal the pinned extension origin (not the structural
    //    [a-p]{32} check /dom uses),
    //  - must be armed (user clicked "Connect browser extension"); single-use.
    if (fullUrl.pathname === '/pair') {
      const pairOrigin = PINNED_EXTENSION_ORIGINS.has(requestOrigin) ? requestOrigin : '';
      if (req.method === 'OPTIONS') {
        const headers: Record<string, string> = {
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        };
        if (pairOrigin) headers['Access-Control-Allow-Origin'] = pairOrigin;
        res.writeHead(204, headers);
        res.end();
        return;
      }
      const jsonHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (pairOrigin) jsonHeaders['Access-Control-Allow-Origin'] = pairOrigin;

      if (req.method !== 'POST') {
        res.writeHead(405, jsonHeaders);
        res.end(JSON.stringify({ error: 'method_not_allowed' }));
        return;
      }
      // Loopback-only: a phone on the LAN must never reach /pair.
      if (!isLoopbackAddress(remote) || !pairOrigin) {
        res.writeHead(403, jsonHeaders);
        res.end(JSON.stringify({ error: 'forbidden' }));
        return;
      }
      if (!this.isArmed()) {
        res.writeHead(410, jsonHeaders);
        res.end(JSON.stringify({ error: 'not_armed' }));
        return;
      }
      // Burn the window — single-use.
      this.armedUntil = 0;
      this.extPairedAt = Date.now();
      console.log('[PhoneMirror] extension paired via one-click /pair');
      // Tell Settings now. On a first pair the extension's socket follows in a
      // few ms (its hello flips extensionConnected); on a Re-pair while already
      // connected nothing else will ever change, and the countdown would run
      // out its whole window.
      // Counts are read live, not from cachedInfo: that is only refreshed while
      // someone is listening, and would otherwise report a connected extension
      // as disconnected.
      if (this.cachedInfo) {
        const info = {
          ...this.cachedInfo,
          clients: this.phoneClientCount(),
          extensionConnected: this.hasExtensionClient(),
          extPairedAt: this.extPairedAt,
        };
        this.cachedInfo = info;
        this.emitStatusNow(info);
      }
      res.writeHead(200, jsonHeaders);
      // Hand out the EXTENSION token (loopback-scoped), not the phone token.
      res.end(JSON.stringify({ token: this.extToken, port: this.port }));
      return;
    }

    if (fullUrl.pathname === '/image') {
      this.handleImageUpload(req, res, provided || '');
      return;
    }

    if (fullUrl.pathname !== '/' && fullUrl.pathname !== '/index.html') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    // No token, or a stale one (a reload after Rotate token): still 401, but
    // with the page itself, marked refused, so it opens on its own lock screen
    // ("needs a pairing link" / "has expired") instead of a bare line of text.
    // The page holds no secrets; the socket and every endpoint still need the
    // token. HEAD stays bodiless (the page probes it to tell an expired link).
    const refused = !provided || !timingSafeEqualStr(provided, this.token);

    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self' ws: wss:",
      "frame-ancestors 'none'",
      "base-uri 'none'",
    ].join('; ');

    res.writeHead(refused ? 401 : 200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(refused ? PHONE_MIRROR_HTML.replace('<html lang="en">', '<html lang="en" data-link="refused">') : PHONE_MIRROR_HTML);
  }

  /**
   * POST /image?t=<phone token>, body = the image bytes. Phone token only: the
   * loopback extension token must never be able to put files on this machine.
   * Answers 200 {ok:true} once the handler has taken the image, or an error
   * status the page shows as "Not delivered".
   */
  private handleImageUpload(req: http.IncomingMessage, res: http.ServerResponse, provided: string): void {
    const reply = (status: number, body: Record<string, unknown>, extra?: Record<string, string>) => {
      if (res.headersSent) return;
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST') {
      reply(405, { ok: false, error: 'method' }, { Allow: 'POST' });
      return;
    }
    if (!provided || !this.token || !timingSafeEqualStr(provided, this.token)) {
      reply(401, { ok: false, error: 'token' });
      req.resume();
      return;
    }
    const handler = this.phoneImageHandler;
    if (!handler) {
      reply(503, { ok: false, error: 'unavailable' });
      req.resume();
      return;
    }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > PHONE_IMAGE_MAX_BYTES) {
      reply(413, { ok: false, error: 'too-large' });
      req.socket.destroy();
      return;
    }

    // Binary-safe: collect Buffers (a string accumulator corrupts image bytes).
    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;
    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      total += chunk.length;
      if (total > PHONE_IMAGE_MAX_BYTES) {
        aborted = true;
        reply(413, { ok: false, error: 'too-large' });
        req.socket.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', () => {
      aborted = true;
    });
    req.on('end', () => {
      if (aborted) return;
      const data = Buffer.concat(chunks, total);
      const kind = sniffImage(data);
      if (!kind) {
        reply(415, { ok: false, error: 'not-an-image' });
        return;
      }
      let timer: ReturnType<typeof setTimeout> | null = null;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out')), PHONE_IMAGE_HANDLER_TIMEOUT_MS);
      });
      Promise.race([Promise.resolve().then(() => handler({ data, ...kind })), timeout])
        .then((saved) => {
          console.log(`[PhoneMirror] phone image received (${kind.mime}, ${data.length} bytes)`);
          // The id the tray will list it under, so the page can offer Remove
          // on the photo it sent. The handler resolves with the saved path.
          reply(200, typeof saved === 'string' && saved ? { ok: true, id: this.shotIdFor(saved) } : { ok: true });
        })
        .catch((err: any) => {
          console.warn('[PhoneMirror] phone image not delivered:', err?.message || err);
          reply(500, { ok: false, error: 'not-delivered' });
        })
        .finally(() => {
          if (timer) clearTimeout(timer);
        });
    });
  }

  private handleUpgrade(req: http.IncomingMessage, socket: any, head: Buffer): void {
    const remote = req.socket.remoteAddress || '0.0.0.0';
    if (!this.rateAllow(remote)) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      socket.destroy();
      return;
    }
    let url: URL;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }

    if (url.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    // The WS carries both client roles: phones authenticate with the phone token,
    // the extension with the loopback extension token. Accept EITHER (constant-time
    // against both; role is later self-declared via the `hello` frame).
    const provided = url.searchParams.get('t') || '';
    const wsTokenOk =
      (this.token && timingSafeEqualStr(provided, this.token)) ||
      (this.extToken && timingSafeEqualStr(provided, this.extToken));
    if (!wsTokenOk) {
      // Custom 4401 close code signals "auth failed" to the client (won't reconnect).
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const viaExtToken = !!(this.extToken && timingSafeEqualStr(provided, this.extToken));
    const wss = this.wss;
    if (!wss) {
      socket.destroy();
      return;
    }

    // Drop any client that doesn't complete handshake quickly — avoids slow-loris.
    let upgraded = false;
    const handshakeTimer = setTimeout(() => {
      if (!upgraded) socket.destroy();
    }, HANDSHAKE_TIMEOUT_MS);
    wss.handleUpgrade(req, socket, head, (ws) => {
      upgraded = true;
      clearTimeout(handshakeTimer);
      if (viaExtToken) this.extTokenSockets.add(ws);
      wss.emit('connection', ws, req);
    });
  }

  private handleWsConnection(ws: WebSocket, req: http.IncomingMessage): void {
    // Send recent history immediately so a phone joining mid-session has context.
    try {
      const replay = this.history
        .slice(-HISTORY_LIMIT)
        .map((m) => (m.role === 'user' && this.awaitingAnswers.has(m.id.slice(2)) ? { ...m, awaiting: true } : m));
      ws.send(JSON.stringify({ type: 'history', messages: replay }));
      // Replay in-flight partial as a SINGLE token frame containing the full
      // accumulated content so far.  Previously this sent one frame per token
      // (up to 500+ frames for a long response) — now it's always 1 frame.
      if (this.livePartial && this.livePartial.content) {
        ws.send(
          JSON.stringify({
            type: 'token',
            streamId: this.livePartial.streamId,
            token: this.livePartial.content,
          }),
        );
        const rendered = this.renderAnswer(this.livePartial.content, true);
        if (rendered) {
          ws.send(JSON.stringify({ type: 'render', streamId: this.livePartial.streamId, html: rendered.html, gist: rendered.gist }));
        }
      }
      // Extension sockets also land here before their `hello`; broadcast() never
      // sends them phone events, and this frame is ignored by the extension.
      ws.send(
        JSON.stringify({
          type: 'transcript-history',
          segments: this.transcriptFinals,
          partial: this.transcriptPartial,
          meetingActive: this.meetingActive,
          meetingEnded: this.meetingEnded,
        }),
      );
      // Always sent, so a phone coming back never keeps a tray the desktop has since cleared.
      ws.send(JSON.stringify({ type: 'attachments', items: this.attachments }));
    } catch (_) {
      /* client may be gone already */
    }

    // Keepalive heartbeat. Drop dead clients within ~45s.
    let alive = true;
    ws.on('pong', () => {
      alive = true;
    });
    const ping = setInterval(() => {
      if (!alive) {
        try {
          ws.terminate();
        } catch (_) {}
        return;
      }
      alive = false;
      try {
        ws.ping();
      } catch (_) {}
    }, 15_000);

    ws.on('close', () => {
      clearInterval(ping);
      // Drop any extension bookkeeping for this socket (no-op for phones).
      const wasExtension = this.extClients.delete(ws);
      if (this.extTokenSockets.has(ws)) this.meetingTabsListener?.(ws, null);
      // Stop the keepalive once the last extension is gone (it restarts on the next
      // `hello`). With no extension connected, any in-flight capture can't be served
      // here — let it time out to the screenshot fallback as designed.
      if (wasExtension && !this.hasExtensionClient()) this.stopExtensionKeepalive();
      this.emitStatusClientCount();
    });
    ws.on('error', () => {
      /* swallow — close fires next */
    });

    // Parse and route commands. A socket is either a phone (chat/action/
    // screenshot) or a companion extension (hello/capture-ack/tabs/active).
    ws.on('message', (data: any) => {
      try {
        const raw = typeof data === 'string' ? data : (data as Buffer).toString('utf8');
        // Guard oversized payloads. An extension's `tabs` reply lists every open
        // tab, which passes 4 KB at about 20 tabs, so its sockets get more room.
        if (raw.length > (this.extTokenSockets.has(ws) ? 65_536 : 4096)) return;
        const cmd = JSON.parse(raw) as unknown;
        if (!cmd || typeof cmd !== 'object') return;
        const c = cmd as Record<string, unknown>;

        // Companion-extension control frames are handled separately and must not
        // fall through to the phone-command path. handleExtensionFrame returns
        // true when it consumed the frame.
        if (this.handleExtensionFrame(ws, c)) return;

        let validated: PhoneCommand | null = null;
        if (
          c.type === 'chat' &&
          typeof c.message === 'string' &&
          c.message.trim().length > 0 &&
          c.message.length <= 2000
        ) {
          validated = { type: 'chat', message: c.message.trim() };
        } else if (
          c.type === 'action' &&
          typeof c.action === 'string' &&
          // Digits allowed: shortcut ids like dynamicAction4 have them, and a
          // letters-only pattern silently dropped the phone's Recap button.
          /^[a-zA-Z0-9:_-]{1,64}$/.test(c.action)
        ) {
          validated = { type: 'action', action: c.action };
        } else if (c.type === 'screenshot') {
          validated = { type: 'screenshot' };
        } else if (c.type === 'detach' && typeof c.id === 'string' && /^[0-9a-f-]{36}$/.test(c.id)) {
          // The phone only ever knows ids; the path stays on this side.
          const path = this.shotPath(c.id);
          if (path) validated = { type: 'detach', path };
        }

        if (validated) {
          console.log(`[PhoneMirror] phone command: ${validated.type}`);
          this.emitPhoneCommand(validated);
        }
      } catch (_) {
        /* malformed JSON — ignore */
      }
    });

    console.log(`[PhoneMirror] phone connected from ${req.socket.remoteAddress}`);
    this.emitStatusClientCount();
  }

  private broadcast(event: StreamEvent): void {
    const wss = this.wss;
    // Skip JSON serialization entirely when no phones are watching — this path
    // is hot (every LLM token goes through it) so the early-exit matters.
    if (!wss || wss.clients.size === 0) return;
    const payload = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      // Phone StreamEvents (history/token/done/chat) are for phones only — never
      // leak them to a companion extension socket.
      if (this.extClients.has(client)) continue;
      // Backpressure guard: skip if buffered amount has run away (slow client).
      if ((client as any).bufferedAmount > 1_000_000) continue;
      try {
        client.send(payload);
      } catch (_) {
        /* noop */
      }
    }
  }

  private recordHistory(msg: PersistedMessage): void {
    this.history.push(msg);
    // slice+reassign is O(1) GC pressure vs splice(0,n) which shifts every element.
    if (this.history.length > HISTORY_LIMIT * 2) {
      this.history = this.history.slice(-HISTORY_LIMIT);
    }
  }

  private rateAllow(ip: string): boolean {
    const now = Date.now();
    let bucket = this.rateBuckets.get(ip);
    if (!bucket || bucket.resetAt < now) {
      bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
      this.rateBuckets.set(ip, bucket);
    }
    bucket.count += 1;
    // Cheap LRU pruning so the map can't grow unbounded.
    if (this.rateBuckets.size > 256) {
      for (const [k, v] of this.rateBuckets) {
        if (v.resetAt < now) this.rateBuckets.delete(k);
      }
    }
    return bucket.count <= RATE_HTTP_LIMIT;
  }

  private disconnectAllClients(code: number, reason: string): void {
    if (!this.wss) return;
    for (const c of this.wss.clients) {
      try {
        c.close(code, reason);
      } catch (_) {}
    }
  }

  private invalidateQrCache(): void {
    this.cachedQrUrl = null;
    this.cachedQrDataUrl = null;
  }

  private emitStatusClientCount(): void {
    if (this.statusListeners.size === 0) return;
    // A socket can close after _teardown() (stop, restart), when cachedInfo still
    // describes the server that just went away. Report a fresh snapshot instead
    // of laying these counts over it.
    if (!this.wss) {
      this.emitStatus();
      return;
    }
    const clients = this.phoneClientCount();
    const extensionConnected = this.hasExtensionClient();
    // Emit on a change to EITHER the phone-client count OR the extension-connected
    // flag. The flag flips on the extension's `hello`/disconnect WITHOUT changing
    // the phone count, so the Settings/popup indicator must react to it too.
    if (
      this.cachedInfo &&
      (clients !== this.cachedInfo.clients || extensionConnected !== this.cachedInfo.extensionConnected)
    ) {
      const extensionFlipped = extensionConnected !== this.cachedInfo.extensionConnected;
      const info = { ...this.cachedInfo, clients, extensionConnected };
      this.cachedInfo = info;
      // The extension flag is what Settings' pairing countdown and the launcher's
      // extension toaster wait on, so it goes out now instead of 150 ms later.
      // A phone-count change stays debounced: the extension's raw socket counts
      // as a phone for the 1-3 ms before its hello, and the debounce is what
      // keeps that from flashing "1 phone connected".
      if (extensionFlipped) this.emitStatusNow(info);
      else this.emitStatus(info);
      return;
    }
    this.emitStatus();
  }

  /**
   * Emit at once, superseding any debounced emit still waiting. Only called
   * while the server runs, when everything a pending emit could carry is
   * already folded into cachedInfo, which `info` is built from.
   */
  private emitStatusNow(info: PhoneMirrorInfo): void {
    if (this.statusListeners.size === 0) return;
    if (this.statusDebounceTimer !== null) {
      clearTimeout(this.statusDebounceTimer);
      this.statusDebounceTimer = null;
    }
    for (const l of this.statusListeners) {
      try {
        l(info);
      } catch (_) {
        /* noop */
      }
    }
  }

  private emitStatus(prebuilt?: PhoneMirrorInfo): void {
    if (this.statusListeners.size === 0) return;
    // Debounce: rapid connect/disconnect storms (bad network, iOS reconnect loop)
    // used to regenerate the QR code on every event — each safeQr() call costs
    // ~3 ms CPU.  Coalesce into one emission within a 150 ms window.
    if (this.statusDebounceTimer !== null) clearTimeout(this.statusDebounceTimer);
    this.statusDebounceTimer = setTimeout(async () => {
      this.statusDebounceTimer = null;
      const info = prebuilt || (await this.snapshot());
      for (const l of this.statusListeners) {
        try {
          l(info);
        } catch (_) {
          /* noop */
        }
      }
    }, 150);
  }

  private emitPhoneCommand(cmd: PhoneCommand): void {
    for (const l of this.phoneCommandListeners) {
      try {
        l(cmd);
      } catch (_) {
        /* noop */
      }
    }
  }
}

// ----- helpers -----

function generateToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Return the persisted loopback-scoped EXTENSION token, minting + persisting one
 * on first use. Persisting makes it stable across restarts so the extension pairs
 * once; rotation (rotateToken) is the only thing that changes it. Falls back to an
 * in-memory token if CredentialsManager isn't ready (works for this session, just
 * not persisted). The phone token is separate and per-session — never persisted here.
 */
function loadOrCreatePersistedExtToken(): string {
  try {
    const cm = CredentialsManager.getInstance();
    const existing = cm.getPhoneMirrorToken();
    if (existing && /^[A-Za-z0-9_-]{16,}$/.test(existing)) return existing;
    const fresh = generateToken();
    cm.setPhoneMirrorToken(fresh);
    return fresh;
  } catch (_) {
    return generateToken();
  }
}

/**
 * Pure single-target arbitration for multi-browser capture. Given each connected
 * extension's `activeAt` (last `{type:'active'}` focus signal) and `connectedAt`
 * (its `hello` time), return the index of the one to push `capture-dom` to:
 *   - highest `activeAt` wins (the browser the user most recently focused),
 *   - ties broken by highest `connectedAt` (most-recently-connected),
 *   - empty input → 0 (caller guards against an empty list).
 * Sending to exactly ONE extension is what stops Chrome+Edge+Arc from racing N
 * captures into /dom and clobbering each other's overlay chip.
 */
export function pickTargetExtensionIndex(
  clients: ReadonlyArray<{ activeAt: number; connectedAt: number }>,
): number {
  let best = 0;
  for (let i = 1; i < clients.length; i++) {
    const c = clients[i];
    const b = clients[best];
    if (
      c.activeAt > b.activeAt ||
      (c.activeAt === b.activeAt && c.connectedAt > b.connectedAt)
    ) {
      best = i;
    }
  }
  return best;
}

/**
 * Pure decision for whether PhoneMirror should auto-start on boot, given the
 * `NATIVELY_DISABLE_PHONE_MIRROR` kill switch (env.disablePhoneMirror) and the
 * persisted `phoneMirrorEnabled` setting. Extracted from main.ts's boot
 * sequence so the decision itself — not just its source text — is testable.
 */
export function shouldStartPhoneMirrorOnBoot(opts: {
  disablePhoneMirror: boolean;
  phoneMirrorEnabled: boolean;
}): boolean {
  if (opts.disablePhoneMirror) return false;
  return opts.phoneMirrorEnabled;
}

/** True for IPv4/IPv6 loopback remote addresses (gates the /pair endpoint). */
function isLoopbackAddress(addr: string): boolean {
  if (!addr) return false;
  // Node may report IPv4-mapped IPv6 (::ffff:127.0.0.1) or bare ::1 / 127.x.
  return (
    addr === '::1' ||
    addr === '::ffff:127.0.0.1' ||
    addr.startsWith('127.') ||
    addr.startsWith('::ffff:127.')
  );
}

/**
 * Validate + clamp the optional capture meta from the extension before it crosses
 * the IPC boundary to the renderer's "Page context" chip. All fields optional;
 * strings are length-capped; anything malformed is dropped.
 */
function sanitizeCaptureMeta(raw: unknown): DomCaptureMeta | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const m = raw as Record<string, unknown>;
  const str = (v: unknown, max: number): string | undefined =>
    typeof v === 'string' && v.length > 0 ? v.substring(0, max) : undefined;
  const out: DomCaptureMeta = {
    title: str(m.title, 300),
    url: str(m.url, 2048),
    source: str(m.source, 64),
    pageType: str(m.pageType, 64),
    firstLine: str(m.firstLine, 300),
  };
  // Drop the object entirely if nothing useful survived.
  return Object.values(out).some((v) => v !== undefined) ? out : undefined;
}

/** What an upload really is, from its leading bytes; null when not an image we take. */
function sniffImage(data: Buffer): Pick<PhoneImage, 'mime' | 'ext'> | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still compare to keep timing roughly constant.
    const dummy = Buffer.alloc(ab.length || 1);
    crypto.timingSafeEqual(ab.length ? ab : dummy, ab.length ? dummy : ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

// Filter out interfaces a phone on the same WiFi will NEVER be able to reach:
// - utun*: VPN tunnels (Tailscale, system VPN, WireGuard) — not on the LAN
// - awdl*, llw*: Apple Wireless Direct Link / low-latency WLAN — peer-to-peer only
// - anpi*, ap*: Apple Network Privacy / hotspot interfaces
// - bridge*: Internet Sharing / Thunderbolt bridge — different subnet
// - vmnet*, vboxnet*, docker*: virtualization-only networks
// - veth*, br-*: Linux container networks
const VIRTUAL_IFACE_RE =
  /^(utun|awdl|llw|anpi|ap\d|bridge|vmnet|vboxnet|docker|veth|br-|gif|stf|tap)/i;

function isPrivateLanIPv4(ip: string): boolean {
  // RFC1918 — the only ranges a phone on the same Wi-Fi will share with the desktop.
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('172.')) {
    const second = parseInt(ip.split('.')[1] || '0', 10);
    return second >= 16 && second <= 31;
  }
  return false;
}

function rankLanIp(name: string, ip: string): number {
  // Lower score sorts earlier. We prefer:
  //   1. en0/en1 (Wi-Fi or Ethernet on macOS) over higher en* (often virtual).
  //   2. 192.168.x.x (home routers) over 10.x and 172.16-31.x.
  let score = 100;
  const m = name.match(/^en(\d+)$/i);
  if (m)
    score = parseInt(m[1], 10); // en0 -> 0, en1 -> 1, ...
  else if (/^eth\d+$|^enp/i.test(name)) score = 2;
  else if (/^wlan\d+|^wlp/i.test(name)) score = 1;
  if (ip.startsWith('192.168.')) score += 0;
  else if (ip.startsWith('10.')) score += 10;
  else score += 20; // 172.16-31.x
  return score;
}

function getLanIPs(): string[] {
  const candidates: { ip: string; name: string }[] = [];
  const ifaces = os.networkInterfaces();
  for (const [name, list] of Object.entries(ifaces)) {
    if (!list) continue;
    if (VIRTUAL_IFACE_RE.test(name)) continue;
    for (const a of list) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (!isPrivateLanIPv4(a.address)) continue;
      candidates.push({ ip: a.address, name });
    }
  }
  candidates.sort((a, b) => rankLanIp(a.name, a.ip) - rankLanIp(b.name, b.ip));
  // De-dup while preserving order.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    if (seen.has(c.ip)) continue;
    seen.add(c.ip);
    out.push(c.ip);
  }
  return out;
}

async function listenWithProbe(
  server: http.Server,
  host: string,
  basePort: number,
  range: number,
): Promise<number> {
  for (let i = 0; i < range; i++) {
    const port = basePort + i;
    const ok = await tryListen(server, host, port);
    if (ok) return port;
  }
  // Final attempt: ephemeral port chosen by OS.
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') resolve(addr.port);
      else reject(new Error('Failed to bind ephemeral port'));
    });
  });
}

function tryListen(server: http.Server, host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const onError = () => {
      server.removeListener('listening', onListening);
      resolve(false);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(true);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    try {
      server.listen(port, host);
    } catch (_) {
      resolve(false);
    }
  });
}

async function safeQr(text: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 1, scale: 6 });
  } catch (_) {
    return null;
  }
}

// Avoid unused-symbol TS error for STATUS_LISTENERS_KEY; reserved for future external coordination.
void STATUS_LISTENERS_KEY;
// Reference Electron's `app` to keep the import live in case we later need userData paths.
void app;
