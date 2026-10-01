// Renderer-side runtime helpers for diagram artifacts: the feature switch, the
// colours a diagram is drawn with, export, and the repair call. Kept out of the
// component so every surface (overlay, saved meeting, meeting chat) shares them.

import { useEffect, useState } from 'react';
import type { DiagramThemeColors } from './mermaidRenderer';
import { svgToDataUrl, renderDiagram, loadMermaid } from './mermaidRenderer';
import { exportPixelSize } from './diagramViewport.mjs';
import { isRepairableStage } from './diagramRepair.mjs';
import { diagramTimings } from './diagramTimings.mjs';

// ── feature switch ──────────────────────────────────────────────────────────
//
// One value for the whole window, fetched once and kept current by the main
// process's broadcast. Until the first answer arrives it is ON (the default),
// so a diagram already on screen does not flash as a code block at startup.

let enabledValue = true;
let enabledLoaded = false;
const enabledSubscribers = new Set<(value: boolean) => void>();
let unsubscribeEnabled: (() => void) | null = null;

function setEnabled(value: boolean): void {
  enabledLoaded = true;
  if (enabledValue === value) return;
  enabledValue = value;
  enabledSubscribers.forEach((fn) => fn(value));
}

function ensureEnabledSubscription(): void {
  if (unsubscribeEnabled || typeof window === 'undefined') return;
  const api = window.electronAPI;
  unsubscribeEnabled = api?.onDiagramsEnabledChanged?.((value) => setEnabled(value === true)) ?? (() => undefined);
  if (!enabledLoaded) {
    api?.getDiagramsEnabled?.()
      .then((value) => setEnabled(value !== false))
      .catch(() => { /* keep the default */ });
  }
}

/** Is the system-design diagram feature on? Reactive. */
export function useDiagramsEnabled(): boolean {
  const [value, setValue] = useState(enabledValue);
  useEffect(() => {
    ensureEnabledSubscription();
    enabledSubscribers.add(setValue);
    setValue(enabledValue);
    return () => {
      enabledSubscribers.delete(setValue);
    };
  }, []);
  return value;
}

/** Non-reactive read, for event handlers and the token path. */
export function diagramsEnabledNow(): boolean {
  ensureEnabledSubscription();
  return enabledValue;
}

// ── colours ─────────────────────────────────────────────────────────────────

function parseRgb(color: string): [number, number, number, number] | null {
  const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)/i.exec(color);
  if (!m) return null;
  const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? Number.parseFloat(m[4]) / 100 : Number.parseFloat(m[4]);
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number.isFinite(alpha) ? alpha : 1];
}

const hex = (n: number): string => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
const toHex = (r: number, g: number, b: number): string => `#${hex(r)}${hex(g)}${hex(b)}`;
/** `fg` at `alpha` over `bg`, as an opaque colour (SVG export has no backdrop to blend with). */
const mix = (fg: [number, number, number], bg: [number, number, number], alpha: number): string =>
  toHex(fg[0] * alpha + bg[0] * (1 - alpha), fg[1] * alpha + bg[1] * (1 - alpha), fg[2] * alpha + bg[2] * (1 - alpha));

export const DIAGRAM_DARK_SURFACE: [number, number, number] = [17, 19, 24];
export const DIAGRAM_LIGHT_SURFACE: [number, number, number] = [255, 255, 255];

/**
 * The palette for a diagram, derived from the text colour the card actually
 * has. That one computed value already encodes every theme combination (colour
 * theme × interface theme): liquid-glass and modern paint a dark panel even in
 * the light colour theme, and their text colour says so.
 */
export function diagramColorsFor(element: Element | null): DiagramThemeColors {
  let text: [number, number, number] = [241, 245, 249];
  try {
    if (element && typeof getComputedStyle === 'function') {
      const parsed = parseRgb(getComputedStyle(element).color);
      if (parsed) text = [parsed[0], parsed[1], parsed[2]];
    }
  } catch { /* default dark palette */ }
  const luminance = (0.2126 * text[0] + 0.7152 * text[1] + 0.0722 * text[2]) / 255;
  const dark = luminance > 0.55; // light text ⇒ dark panel
  const surface = dark ? DIAGRAM_DARK_SURFACE : DIAGRAM_LIGHT_SURFACE;
  return {
    text: toHex(text[0], text[1], text[2]),
    muted: mix(text, surface, 0.68),
    nodeFill: mix(text, surface, dark ? 0.1 : 0.05),
    stroke: mix(text, surface, 0.5),
    groupFill: mix(text, surface, dark ? 0.05 : 0.03),
    accent: dark ? '#7aa2f7' : '#2563eb',
    dark,
  };
}

/** The fixed light palette used for the phone (its card is white in both themes). */
export const PHONE_DIAGRAM_COLORS: DiagramThemeColors = Object.freeze({
  text: '#111827',
  muted: '#4b5563',
  nodeFill: '#f3f4f6',
  stroke: '#6b7280',
  groupFill: '#f9fafb',
  accent: '#2563eb',
  dark: false,
});

// ── warm-up + phone render host ─────────────────────────────────────────────

/**
 * Start loading Mermaid now. Called the moment a diagram fence starts
 * streaming: the block needs a second or more to finish arriving, which is
 * enough for the library to be ready when it does. Nothing is loaded at app
 * start, and nothing at all for sessions that never see a diagram.
 */
export function warmDiagramRenderer(): void {
  void loadMermaid().catch(() => undefined);
}

let idleWarmScheduled = false;

/**
 * Load Mermaid in the background the first time the user asks for an answer,
 * so the first diagram of a session does not pay the load after its fence has
 * already arrived (measured live: a fast model finishes a whole answer in
 * about two seconds, and the load was most of the wait for the first drawing).
 * Once per window, only with the feature on, and at idle priority so it never
 * competes with the answer that is about to stream.
 */
export function warmDiagramRendererOnIdle(): void {
  if (idleWarmScheduled || typeof window === 'undefined' || !diagramsEnabledNow()) return;
  idleWarmScheduled = true;
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof idle === 'function') idle(() => warmDiagramRenderer(), { timeout: 1500 });
  else setTimeout(warmDiagramRenderer, 200);
}

/**
 * Lets the main process ask THIS window to draw a diagram for the phone (the
 * main process has no DOM). The result goes back as SVG text; the main process
 * re-checks it before the phone sees anything. Mount once per app window.
 */
export function useDiagramRenderHost(): void {
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api?.onDiagramRenderRequest || !api.sendDiagramRenderResult) return;
    return api.onDiagramRenderRequest((request) => {
      const requestId = typeof request?.requestId === 'string' ? request.requestId : '';
      const key = typeof request?.key === 'string' ? request.key : '';
      const source = typeof request?.source === 'string' ? request.source : '';
      if (!requestId || !key || !source) return;
      const reply = (ok: boolean, svg?: string): void => api.sendDiagramRenderResult?.({ requestId, key, ok, ...(svg ? { svg } : {}) });
      void renderDiagram(source, PHONE_DIAGRAM_COLORS)
        .then((result) => (result.ok ? reply(true, result.svg) : reply(false)))
        .catch(() => reply(false));
    });
  }, []);
}

// ── export ──────────────────────────────────────────────────────────────────

export type DiagramExportFormat = 'svg' | 'png' | 'mmd';
export interface DiagramExportResult {
  saved: boolean;
  canceled?: boolean;
  fileName?: string;
  silent?: boolean;
  error?: string;
}

/** Rasterise a rendered SVG to PNG (base64, no data: prefix) on an explicit background. */
export async function svgToPngBase64(svg: string, naturalWidth: number, naturalHeight: number, background: string): Promise<string> {
  const { width, height } = exportPixelSize(naturalWidth, naturalHeight);
  const image = new Image();
  image.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The diagram image could not be loaded for export.'));
    image.src = svgToDataUrl(svg);
  });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No drawing context for export.');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  const dataUrl = canvas.toDataURL('image/png');
  // Release the bitmap now rather than at the next GC.
  canvas.width = 0;
  canvas.height = 0;
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

function browserDownload(fileName: string, mime: string, data: string, base64: boolean): void {
  const href = base64 ? `data:${mime};base64,${data}` : `data:${mime};charset=utf-8,${encodeURIComponent(data)}`;
  const a = document.createElement('a');
  a.href = href;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Save a diagram. Goes through the main process (validated, Undetectable-aware
 * save dialog). In a plain browser — the dev harness — it falls back to a download.
 */
export async function exportDiagram(input: {
  format: DiagramExportFormat;
  name: string;
  source: string;
  svg?: string;
  width?: number;
  height?: number;
  background: string;
}): Promise<DiagramExportResult> {
  let data: string;
  if (input.format === 'mmd') {
    data = input.source;
  } else if (!input.svg) {
    return { saved: false, error: 'not_rendered' };
  } else if (input.format === 'svg') {
    data = input.svg;
  } else {
    data = await svgToPngBase64(input.svg, input.width || 1, input.height || 1, input.background);
  }
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (api?.exportDiagram) return api.exportDiagram({ format: input.format, data, name: input.name });
  const mime = input.format === 'svg' ? 'image/svg+xml' : input.format === 'png' ? 'image/png' : 'text/plain';
  browserDownload(`${input.name || 'diagram'}.${input.format}`, mime, data, input.format === 'png');
  return { saved: true };
}

// ── repair ──────────────────────────────────────────────────────────────────
//
// One automatic attempt per diagram source per window (the main process holds
// the same rule and a rate cap — this copy only avoids the round trip). Every
// in-flight request is tracked so Stop, a session reset or an unmount can
// cancel it and no late result is applied.

const autoRepairTried = new Set<string>();
const repairsInFlight = new Set<string>();
let repairSeq = 0;

export type DiagramRepairOutcome = { ok: true; source: string } | { ok: false; reason: string };

function repairKey(source: string): string {
  return source.replace(/\r\n?/g, '\n').trim();
}

/** May an automatic repair be attempted for this failure? (Not yet tried, and a stage a retry can fix.) */
export function canAutoRepair(source: string, stage: string): boolean {
  if (!diagramsEnabledNow() || !isRepairableStage(stage)) return false;
  if (typeof window === 'undefined' || !window.electronAPI?.repairDiagram) return false;
  return !autoRepairTried.has(repairKey(source));
}

export function manualRepairAvailable(): boolean {
  return diagramsEnabledNow() && typeof window !== 'undefined' && Boolean(window.electronAPI?.repairDiagram);
}

/** Ask for one repair. Returns the cancel function and the outcome promise. */
export function requestDiagramRepair(input: { source: string; diagnostic?: string; stage?: string; manual?: boolean }): {
  cancel: () => void;
  result: Promise<DiagramRepairOutcome>;
} {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api?.repairDiagram) return { cancel: () => undefined, result: Promise.resolve({ ok: false, reason: 'unavailable' }) };
  if (!input.manual) autoRepairTried.add(repairKey(input.source));
  if (autoRepairTried.size > 200) autoRepairTried.clear();
  repairSeq += 1;
  const requestId = `dr-${Date.now().toString(36)}-${repairSeq}`;
  repairsInFlight.add(requestId);
  let cancelled = false;
  const cancel = (): void => {
    if (cancelled || !repairsInFlight.has(requestId)) return;
    cancelled = true;
    repairsInFlight.delete(requestId);
    void api.cancelDiagramRepair?.(requestId).catch(() => undefined);
  };
  const result = api
    .repairDiagram({ requestId, source: input.source, diagnostic: input.diagnostic, stage: input.stage, manual: input.manual === true })
    .then((outcome): DiagramRepairOutcome => {
      if (cancelled) return { ok: false, reason: 'cancelled' };
      // A handler that answered nothing (older main process, torn-down window)
      // is a failed repair, not a crash that leaves the card on "repairing".
      return outcome && typeof outcome === 'object' ? outcome : { ok: false, reason: 'provider_error' };
    })
    .catch((): DiagramRepairOutcome => ({ ok: false, reason: cancelled ? 'cancelled' : 'provider_error' }))
    .finally(() => {
      repairsInFlight.delete(requestId);
    });
  return { cancel, result };
}

/** Stop every repair this window started (Stop pressed, session reset, meeting end). */
export function cancelAllDiagramRepairs(): void {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  for (const requestId of [...repairsInFlight]) {
    repairsInFlight.delete(requestId);
    void api?.cancelDiagramRepair?.(requestId).catch(() => undefined);
  }
}

// ── timing read-out ─────────────────────────────────────────────────────────
//
// `window.__nativelyDiagramTimings()` returns the per-answer summaries (ms from
// request, render durations, repair outcome). Numbers and short categories
// only — no question, answer or diagram text ever enters the log — so it is
// safe to leave available; it is how latency is measured against a live
// provider (docs/diagrams/README.md).
if (typeof window !== 'undefined') {
  (window as unknown as { __nativelyDiagramTimings?: () => unknown }).__nativelyDiagramTimings = () =>
    diagramTimings.all().map((entry) => diagramTimings.summary(entry.id));
}

/** Test hook. */
export function __resetDiagramRuntimeForTests(): void {
  autoRepairTried.clear();
  repairsInFlight.clear();
  enabledValue = true;
  enabledLoaded = false;
}
