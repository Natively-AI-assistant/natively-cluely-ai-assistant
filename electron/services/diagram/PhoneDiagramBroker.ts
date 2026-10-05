// Diagrams on the Phone Mirror.
//
// The phone page is a string served by the main process, and the main process
// has no DOM — Mermaid cannot run here. So when an answer bound for the phone
// contains a completed Mermaid block, this broker asks an app window (which
// already bundles Mermaid) to draw it, checks what comes back, and gives the
// phone an inert image:
//
//   phoneMirrorMarkdown.code('mermaid')  ──lookup(key)──▶  cache hit → <img src="data:image/svg+xml…">
//                                        └─request(key, source) → 'diagram:render-request' → app window
//   app window: renderDiagram(source, phone palette) → 'diagram:render-result'
//   here: sender + request id + size + isSafeDiagramSvg  → cache → onRendered(key)
//   PhoneMirrorService: 'diagram' event to phones, and re-renders stored history
//
// Bounded and local: nothing leaves the machine except over the phone's own
// authenticated connection, one request per distinct diagram, a timeout, a
// size cap, a small LRU. The SVG reaches the phone only as an <img> data URL,
// where it cannot run script or load anything.

import { isSafeDiagramSvg, diagramSourceKey, DIAGRAM_LIMITS } from '../../../src/lib/diagram/diagramPolicy.mjs';

export const PHONE_DIAGRAM_CACHE_MAX = 24;
export const PHONE_DIAGRAM_TIMEOUT_MS = 10_000;
/** How long a failed diagram is not retried. */
export const PHONE_DIAGRAM_FAILURE_TTL_MS = 60_000;

export interface PhoneDiagramRenderTarget {
  /** webContents id of the window asked to render. */
  readonly id: number;
  send(channel: string, payload: unknown): void;
}

export interface PhoneDiagramBrokerDeps {
  /**
   * An app window that can render (launcher first, then overlay), or null.
   * `tried` holds the ids already asked for this diagram: a window that did
   * not answer is not asked again, the next one is.
   */
  pickTarget(tried?: readonly number[]): PhoneDiagramRenderTarget | null;
  /** Called when a diagram finishes (drawn or failed), so the phone can be told. */
  onSettled(key: string, dataUrl: string | null): void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

interface Pending {
  key: string;
  targetId: number;
  timer: unknown;
}

/** Windows asked for one diagram before it is given up on (launcher, overlay). */
const MAX_TARGETS_PER_DIAGRAM = 2;

export function phoneDiagramDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export class PhoneDiagramBroker {
  private readonly cache = new Map<string, string>();
  private readonly failedAt = new Map<string, number>();
  private readonly pending = new Map<string, Pending>();
  private readonly pendingByKey = new Map<string, string>();
  private seq = 0;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly deps: PhoneDiagramBrokerDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  key(source: string): string {
    return diagramSourceKey(source);
  }

  /** The image for a diagram, when it has been drawn. */
  lookup(key: string): string | undefined {
    const hit = this.cache.get(key);
    if (hit) {
      // LRU touch.
      this.cache.delete(key);
      this.cache.set(key, hit);
    }
    return hit;
  }

  /** Did this diagram fail recently (the phone shows the source instead)? */
  failed(key: string): boolean {
    const at = this.failedAt.get(key);
    if (at === undefined) return false;
    if (this.now() - at > PHONE_DIAGRAM_FAILURE_TTL_MS) {
      this.failedAt.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Ask an app window to draw this diagram, unless it is already drawn,
   * already asked for, recently failed, or too large to be worth asking.
   */
  request(key: string, source: string): void {
    if (this.cache.has(key) || this.pendingByKey.has(key) || this.failed(key)) return;
    if (typeof source !== 'string' || !source.trim() || source.length > DIAGRAM_LIMITS.maxSourceChars) {
      this.fail(key);
      return;
    }
    this.ask(key, source, []);
  }

  /**
   * Ask the next window that has not been tried. With none left the diagram
   * FAILS — it used to stay pending for ever, so with the app windows closed
   * the phone showed "Drawing diagram…" and never the source.
   */
  private ask(key: string, source: string, tried: readonly number[]): void {
    const target = tried.length < MAX_TARGETS_PER_DIAGRAM ? this.deps.pickTarget(tried) : null;
    if (!target || tried.includes(target.id)) {
      this.fail(key);
      return;
    }
    const next = [...tried, target.id];
    this.seq += 1;
    const requestId = `pd-${this.seq}`;
    const giveUpOnThisWindow = () => {
      if (!this.pending.has(requestId)) return;
      this.pending.delete(requestId);
      this.pendingByKey.delete(key);
      this.ask(key, source, next);
    };
    const timer = this.setTimer(giveUpOnThisWindow, PHONE_DIAGRAM_TIMEOUT_MS);
    this.pending.set(requestId, { key, targetId: target.id, timer });
    this.pendingByKey.set(key, requestId);
    try {
      target.send('diagram:render-request', { requestId, key, source });
    } catch {
      this.clearTimer(timer);
      giveUpOnThisWindow();
    }
  }

  /**
   * A window answered. Accepted only from the window that was asked, for a
   * request still pending, and only if the SVG passes the shared safety check.
   * Returns whether the result was accepted as a drawing.
   */
  receive(senderId: number, payload: unknown): boolean {
    const p = payload as { requestId?: unknown; key?: unknown; ok?: unknown; svg?: unknown } | null;
    const requestId = typeof p?.requestId === 'string' ? p.requestId : '';
    const pending = this.pending.get(requestId);
    if (!pending) return false; // unknown, timed out, or a replay
    if (pending.targetId !== senderId) return false; // not the window we asked
    if (p?.key !== pending.key) return false;
    this.clearTimer(pending.timer);
    this.pending.delete(requestId);
    this.pendingByKey.delete(pending.key);

    if (p?.ok !== true || !isSafeDiagramSvg(p.svg)) {
      this.fail(pending.key);
      return false;
    }
    const dataUrl = phoneDiagramDataUrl(p.svg as string);
    this.cache.set(pending.key, dataUrl);
    this.failedAt.delete(pending.key);
    while (this.cache.size > PHONE_DIAGRAM_CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    this.deps.onSettled(pending.key, dataUrl);
    return true;
  }

  private fail(key: string): void {
    this.failedAt.set(key, this.now());
    if (this.failedAt.size > 100) this.failedAt.delete(this.failedAt.keys().next().value as string);
    this.deps.onSettled(key, null);
  }

  /** Forget everything (tests, and when the phone mirror stops). */
  clear(): void {
    for (const p of this.pending.values()) this.clearTimer(p.timer);
    this.pending.clear();
    this.pendingByKey.clear();
    this.cache.clear();
    this.failedAt.clear();
  }
}
