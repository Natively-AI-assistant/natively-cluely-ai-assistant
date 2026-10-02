// Local Mermaid rendering for diagram artifacts.
//
// Model-written Mermaid goes in; a sanitised, self-contained SVG string comes
// out. Nothing here talks to the network: Mermaid is bundled with the app and
// loaded on demand (it is large, and most answers never need it).
//
// Validation stages, each reported separately so a failure says what failed:
//   policy  — diagramPolicy.mjs: supported family, size, no config/interaction
//             /remote resources/raw HTML
//   parse   — Mermaid's own parser, same pinned version that renders
//   render  — layout + SVG generation
//   output  — the produced SVG is sanitised and re-checked for anything that
//             could load or run
//
// What "ok" means: the text is a drawable diagram. It does not mean the
// architecture is correct.
//
// Cancellation: Mermaid lays out on the calling thread and cannot be
// interrupted. Work is bounded up front by the policy limits instead; the
// timeout below only stops *waiting* (the caller moves on to the fallback and
// a late result is cached, not shown). See docs/diagrams/README.md.

import DOMPurify from 'dompurify';
import { checkDiagramSource, isSafeDiagramSvg } from './diagramPolicy.mjs';

export interface DiagramThemeColors {
  /** Primary text / stroke colour. */
  text: string;
  /** Muted text (edge labels, notes). */
  muted: string;
  /** Node fill. */
  nodeFill: string;
  /** Node / edge stroke. */
  stroke: string;
  /** Subgraph / lane fill. */
  groupFill: string;
  /** Accent used for sequence activations and state markers. */
  accent: string;
  /** True for a dark panel; only steers Mermaid's contrast maths. */
  dark: boolean;
}

export type DiagramRenderStage = 'policy' | 'load' | 'parse' | 'render' | 'output' | 'timeout';

export interface DiagramRenderSuccess {
  ok: true;
  svg: string;
  width: number;
  height: number;
  type: string;
  view: string;
  /** What was changed before rendering (see DiagramPolicyResult.neutralised). */
  neutralised: string[];
  /** The source that was actually drawn (differs from the input when `neutralised` is non-empty). */
  renderSource: string;
  timings: { parseMs: number; renderMs: number; coldLoadMs: number };
}

export interface DiagramRenderFailure {
  ok: false;
  stage: DiagramRenderStage;
  /** Stable machine code (policy rejection code, 'syntax', 'layout', …). */
  code: string;
  /** One readable sentence for the card. */
  message: string;
  /** Bounded parser/renderer diagnostic, for a repair request. Never shown as answer text. */
  diagnostic?: string;
}

export type DiagramRenderResult = DiagramRenderSuccess | DiagramRenderFailure;

const DIAGNOSTIC_MAX_CHARS = 600;
const RENDER_WAIT_MS = 8000;
const CACHE_MAX_ENTRIES = 48;
/**
 * System fonts only. The SVG is shown through an <img> (an isolated document
 * that cannot see the app's web fonts), so the font Mermaid measures labels
 * with must be one that resolves identically there.
 */
export const DIAGRAM_FONT_FAMILY =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

type MermaidApi = typeof import('mermaid').default;

let mermaidPromise: Promise<MermaidApi> | null = null;
let coldLoadMs = 0;
let initialisedThemeKey: string | null = null;
let renderSeq = 0;
/** Mermaid keeps global state; renders must not overlap. */
let renderChain: Promise<unknown> = Promise.resolve();

const cache = new Map<string, DiagramRenderResult>();
const inflight = new Map<string, Promise<DiagramRenderResult>>();

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Load Mermaid once. Safe to call early (idle / meeting start) to warm up. */
export function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    const started = now();
    mermaidPromise = import('mermaid')
      .then((mod) => {
        coldLoadMs = now() - started;
        return mod.default;
      })
      .catch((err) => {
        mermaidPromise = null; // allow a later retry
        throw err;
      });
  }
  return mermaidPromise;
}

export function isMermaidLoaded(): boolean {
  return coldLoadMs > 0;
}

export function diagramThemeKey(colors: DiagramThemeColors): string {
  return [colors.text, colors.muted, colors.nodeFill, colors.stroke, colors.groupFill, colors.accent, colors.dark ? 'd' : 'l'].join('|');
}

function hashString(text: string): string {
  // FNV-1a, 32-bit. A cache key, not a security boundary.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function diagramCacheKey(source: string, colors: DiagramThemeColors): string {
  return `${hashString(source)}:${source.length}:${hashString(diagramThemeKey(colors))}`;
}

function initialise(mermaid: MermaidApi, colors: DiagramThemeColors): void {
  const key = diagramThemeKey(colors);
  if (initialisedThemeKey === key) return;
  mermaid.initialize({
    startOnLoad: false,
    // 'strict': labels are text, click handlers are off.
    securityLevel: 'strict',
    // Model text may not change any of these through a directive.
    secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'suppressErrorRendering', 'htmlLabels', 'theme', 'themeVariables', 'themeCSS', 'fontFamily'],
    suppressErrorRendering: true,
    logLevel: 'fatal',
    maxTextSize: 20000,
    maxEdges: 200,
    theme: 'base',
    // App-owned CSS, built only from the palette above (never from model
    // text; `themeCSS` is in the `secure` list). Edge labels get an opaque chip
    // in the node colour so the connector does not run through the words, and
    // boxes take the app's soft corner.
    themeCSS: [
      `.edgeLabel rect, .labelBkg { fill: ${colors.nodeFill}; opacity: 1; }`,
      `.edgeLabel { background-color: ${colors.nodeFill}; }`,
      '.node rect, .cluster rect, rect.actor, .note rect { rx: 6px; ry: 6px; }',
      // Mind map: the root is drawn in the same quiet fill as every other node
      // (Mermaid's default gives it a saturated fill with dark text).
      `.section-root rect, .section-root path, .section-root circle, .section-root polygon { fill: ${colors.groupFill}; stroke: ${colors.stroke}; }`,
      `.section-root text, .mindmap-node text { fill: ${colors.text}; }`,
      // Data model: the crow's-foot ends ARE the notation, so the relationship
      // line is drawn in the text colour and a little heavier than a box edge
      // (seen in the overlay: at the scale a tall model is shown, a hairline
      // in the border colour made "one" and "many" hard to tell apart).
      `.relationshipLine, .er.relationshipLine { stroke: ${colors.text}; stroke-width: 1.4px; }`,
      `.marker.er path, .marker.er circle, marker[id*="ONLY_ONE"] path, marker[id*="ZERO_OR"] path, marker[id*="ONE_OR_MORE"] path, marker[id*="ZERO_OR"] circle { stroke: ${colors.text}; }`,
    ].join(' '),
    fontFamily: DIAGRAM_FONT_FAMILY,
    // SVG <text> labels, not HTML in <foreignObject>: keeps the output
    // sanitisable as plain SVG and exportable to PNG.
    htmlLabels: false,
    // Compact spacing. The card is narrow (about 560–670 px) and a diagram is
    // scaled down to fit it, so every pixel of whitespace costs legibility.
    // Measured on ten diagrams a real model wrote (2026-10-01): flowcharts come
    // out ~14% narrower than with Mermaid's roomier spacing, sequence diagrams
    // ~38% (narrower participant boxes, names wrap inside them).
    flowchart: { htmlLabels: false, useMaxWidth: false, curve: 'basis', padding: 8, nodeSpacing: 22, rankSpacing: 26, diagramPadding: 4 },
    sequence: {
      useMaxWidth: false,
      mirrorActors: false,
      showSequenceNumbers: false,
      actorMargin: 14,
      messageMargin: 22,
      width: 110,
      height: 40,
      boxMargin: 6,
      wrap: true,
      diagramMarginX: 8,
      diagramMarginY: 8,
    },
    state: { useMaxWidth: false, padding: 6 },
    mindmap: { useMaxWidth: false, padding: 8 },
    timeline: { useMaxWidth: false },
    // A Gantt chart is as wide as it is told to be; the card is about this wide.
    gantt: { useMaxWidth: false, useWidth: 720, barHeight: 18, barGap: 5, topPadding: 44, leftPadding: 96, rightPadding: 16, fontSize: 11, sectionFontSize: 11, gridLineStartPadding: 30, axisFormat: '%b %e' },
    class: { useMaxWidth: false, htmlLabels: false },
    er: { useMaxWidth: false },
    themeVariables: {
      darkMode: colors.dark,
      background: 'transparent',
      fontFamily: DIAGRAM_FONT_FAMILY,
      fontSize: '13px',
      primaryColor: colors.nodeFill,
      primaryTextColor: colors.text,
      primaryBorderColor: colors.stroke,
      secondaryColor: colors.groupFill,
      secondaryTextColor: colors.text,
      secondaryBorderColor: colors.stroke,
      tertiaryColor: colors.groupFill,
      tertiaryTextColor: colors.text,
      tertiaryBorderColor: colors.stroke,
      lineColor: colors.stroke,
      // Data model attribute rows: the same two quiet fills as everything else
      // (this Mermaid reads rowOdd / rowEven; its defaults are near-black bands).
      rowOdd: colors.nodeFill,
      rowEven: colors.groupFill,
      textColor: colors.text,
      mainBkg: colors.nodeFill,
      nodeBorder: colors.stroke,
      clusterBkg: colors.groupFill,
      clusterBorder: colors.stroke,
      titleColor: colors.text,
      edgeLabelBackground: colors.nodeFill,
      actorBkg: colors.nodeFill,
      actorBorder: colors.stroke,
      actorTextColor: colors.text,
      actorLineColor: colors.stroke,
      signalColor: colors.stroke,
      signalTextColor: colors.text,
      labelBoxBkgColor: colors.groupFill,
      labelBoxBorderColor: colors.stroke,
      labelTextColor: colors.text,
      loopTextColor: colors.muted,
      noteBkgColor: colors.groupFill,
      noteBorderColor: colors.stroke,
      noteTextColor: colors.text,
      activationBkgColor: colors.accent,
      activationBorderColor: colors.stroke,
      labelColor: colors.text,
      altBackground: colors.groupFill,
      stateLabelColor: colors.text,
      stateBkg: colors.nodeFill,
      compositeBackground: colors.groupFill,
      compositeTitleBackground: colors.groupFill,
      transitionColor: colors.stroke,
      transitionLabelColor: colors.muted,
      specialStateColor: colors.accent,
      innerEndBackground: colors.accent,
      classText: colors.text,
      attributeBackgroundColorOdd: colors.nodeFill,
      attributeBackgroundColorEven: colors.groupFill,
      // Mind map and timeline sections take their colours from this scale. One
      // neutral fill for all of them: the hierarchy is carried by position and
      // lines, and a rainbow would suggest categories that are not there.
      ...Object.fromEntries(Array.from({ length: 12 }, (_v, i) => [`cScale${i}`, colors.nodeFill])),
      ...Object.fromEntries(Array.from({ length: 12 }, (_v, i) => [`cScaleLabel${i}`, colors.text])),
      ...Object.fromEntries(Array.from({ length: 12 }, (_v, i) => [`cScaleInv${i}`, colors.stroke])),
      // Gantt
      sectionBkgColor: colors.groupFill,
      altSectionBkgColor: 'transparent',
      sectionBkgColor2: colors.groupFill,
      taskBkgColor: colors.nodeFill,
      taskBorderColor: colors.stroke,
      taskTextColor: colors.text,
      taskTextLightColor: colors.text,
      taskTextDarkColor: colors.text,
      taskTextOutsideColor: colors.text,
      activeTaskBkgColor: colors.accent,
      activeTaskBorderColor: colors.stroke,
      doneTaskBkgColor: colors.groupFill,
      doneTaskBorderColor: colors.stroke,
      critBkgColor: colors.nodeFill,
      critBorderColor: colors.accent,
      gridColor: colors.stroke,
      todayLineColor: colors.accent,
    },
  });
  initialisedThemeKey = key;
}

function boundDiagnostic(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  return raw.replace(/\s+$/g, '').slice(0, DIAGNOSTIC_MAX_CHARS);
}

/** A lone surrogate half (an emoji cut in two) is not text: show the replacement character. */
function wellFormedText(text: string): string {
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}

/** Does this text parse as an XML document? (An <img> shows nothing for one that does not.) */
function isWellFormedXml(xml: string): boolean {
  if (typeof DOMParser === 'undefined') return true;
  try {
    const doc = new DOMParser().parseFromString(xml, 'image/svg+xml');
    return doc.getElementsByTagName('parsererror').length === 0;
  } catch {
    return false;
  }
}

/** Sanitise Mermaid's SVG and verify nothing in it can load or run. */
export function sanitiseDiagramSvg(svg: string): { ok: true; svg: string } | { ok: false; reason: string; malformed?: boolean } {
  const sanitised = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    // <style> carries Mermaid's own generated CSS; it is checked below.
    ADD_TAGS: ['style'],
    FORBID_TAGS: ['foreignObject', 'script', 'a', 'image', 'use', 'animate', 'set', 'animateTransform', 'animateMotion'],
    FORBID_ATTR: ['href', 'xlink:href', 'onload', 'onerror', 'onclick'],
    RETURN_TRUSTED_TYPE: false,
  }) as string;
  // The sanitiser serialises as HTML, which writes a no-break space as
  // `&nbsp;` — an entity an SVG document does not define. The drawing is shown
  // as an image, i.e. parsed as XML, where that one entity made the whole image
  // fail to load ("wait 10 ms" with a no-break space was enough).
  const clean = wellFormedText(String(sanitised || '').replace(/&nbsp;/g, '&#160;'));
  if (!clean || !/^\s*<svg[\s>]/i.test(clean)) return { ok: false, reason: 'sanitiser removed the drawing' };
  if (!isWellFormedXml(clean)) return { ok: false, reason: 'drawing is not well-formed XML', malformed: true };
  // The same text check the main process applies before an SVG leaves for the phone.
  if (!isSafeDiagramSvg(clean)) return { ok: false, reason: 'drawing contains an external or active reference, or is too large' };
  return { ok: true, svg: clean };
}

function readSvgSize(svg: string): { width: number; height: number } {
  const viewBox = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i.exec(svg);
  if (viewBox) return { width: Math.ceil(Number(viewBox[1])), height: Math.ceil(Number(viewBox[2])) };
  const w = /\swidth\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(svg);
  const h = /\sheight\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(svg);
  return { width: w ? Math.ceil(Number(w[1])) : 0, height: h ? Math.ceil(Number(h[1])) : 0 };
}

/**
 * Give the root <svg> explicit pixel width/height (from its viewBox) and the
 * XML namespace, so it has an intrinsic size as an <img> and as a file.
 */
function finaliseSvg(svg: string, width: number, height: number): string {
  return svg.replace(/^\s*<svg\b([^>]*)>/i, (_all, attrs: string) => {
    let a = attrs
      .replace(/\swidth\s*=\s*["'][^"']*["']/i, '')
      .replace(/\sheight\s*=\s*["'][^"']*["']/i, '')
      .replace(/\sstyle\s*=\s*["'][^"']*["']/i, '');
    if (!/\sxmlns\s*=/.test(a)) a += ' xmlns="http://www.w3.org/2000/svg"';
    return `<svg${a} width="${width}" height="${height}">`;
  });
}

function removeLeftovers(id: string): void {
  if (typeof document === 'undefined') return;
  for (const sel of [`#${id}`, `#d${id}`, `#i${id}`]) {
    document.querySelectorAll(sel).forEach((el) => el.remove());
  }
}

async function renderNow(source: string, colors: DiagramThemeColors): Promise<DiagramRenderResult> {
  const policy = checkDiagramSource(source);
  if (!policy.ok) {
    return { ok: false, stage: 'policy', code: policy.rejection || 'rejected', message: policy.message || 'This diagram could not be drawn.' };
  }

  let mermaid: MermaidApi;
  try {
    mermaid = await loadMermaid();
  } catch (err) {
    return { ok: false, stage: 'load', code: 'load_failed', message: 'The diagram renderer could not be loaded.', diagnostic: boundDiagnostic(err) };
  }
  initialise(mermaid, colors);

  const parseStart = now();
  try {
    await mermaid.parse(policy.renderSource);
  } catch (err) {
    return { ok: false, stage: 'parse', code: 'syntax', message: 'The diagram has a syntax error.', diagnostic: boundDiagnostic(err) };
  }
  const parseMs = now() - parseStart;

  renderSeq += 1;
  const id = `natively-diagram-${renderSeq}`;
  const renderStart = now();
  let rawSvg: string;
  try {
    const out = await mermaid.render(id, policy.renderSource);
    rawSvg = out.svg;
  } catch (err) {
    return { ok: false, stage: 'render', code: 'layout', message: 'The diagram could not be laid out.', diagnostic: boundDiagnostic(err) };
  } finally {
    removeLeftovers(id);
  }
  const renderMs = now() - renderStart;

  const safe = sanitiseDiagramSvg(rawSvg);
  if (!safe.ok) {
    return safe.malformed
      ? { ok: false, stage: 'output', code: 'malformed_output', message: 'The diagram could not be shown.', diagnostic: safe.reason }
      : { ok: false, stage: 'output', code: 'unsafe_output', message: 'The diagram was blocked because it is not safe to display.', diagnostic: safe.reason };
  }
  const size = readSvgSize(safe.svg);
  if (!size.width || !size.height) {
    return { ok: false, stage: 'render', code: 'empty_drawing', message: 'The diagram could not be laid out.' };
  }
  return {
    ok: true,
    svg: finaliseSvg(safe.svg, size.width, size.height),
    width: size.width,
    height: size.height,
    type: policy.type as string,
    view: policy.view as string,
    neutralised: policy.neutralised,
    renderSource: policy.renderSource,
    timings: { parseMs, renderMs, coldLoadMs },
  };
}

function remember(key: string, result: DiagramRenderResult): void {
  // A renderer that failed to LOAD says nothing about this diagram: the next
  // attempt may succeed (loadMermaid forgets a failed import for that reason).
  if (!result.ok && result.stage === 'load') return;
  cache.delete(key);
  cache.set(key, result);
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** A finished render for this source + theme, if one is cached. */
export function peekDiagramRender(source: string, colors: DiagramThemeColors): DiagramRenderResult | undefined {
  return cache.get(diagramCacheKey(source, colors));
}

/**
 * Validate and render a completed Mermaid block. Results (success and
 * failure) are cached by source + theme, so the same diagram in several
 * messages or windows is drawn once.
 */
export function renderDiagram(source: string, colors: DiagramThemeColors): Promise<DiagramRenderResult> {
  const key = diagramCacheKey(source, colors);
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(key);
  if (pending) return pending;

  // The wait is counted from when THIS diagram's turn comes, not from when it
  // joined the queue: with several cards waiting, the later ones used to time
  // out before Mermaid had even started on them.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let giveUp: (result: DiagramRenderResult) => void = () => undefined;
  const gaveUp = new Promise<DiagramRenderResult>((resolve) => {
    giveUp = resolve;
  });
  const work = renderChain.then(() => {
    timer = setTimeout(
      () => giveUp({ ok: false, stage: 'timeout', code: 'timeout', message: 'Drawing the diagram took too long.' }),
      RENDER_WAIT_MS,
    );
    return renderNow(source, colors);
  });
  renderChain = work.catch(() => undefined);

  const waited = Promise.race<DiagramRenderResult>([work, gaveUp])
    .catch((err): DiagramRenderResult => ({ ok: false, stage: 'render', code: 'layout', message: 'The diagram could not be laid out.', diagnostic: boundDiagnostic(err) }))
    .finally(() => {
      if (timer) clearTimeout(timer);
      inflight.delete(key);
    });

  // Cache the real outcome even if the caller stopped waiting.
  work.then((result) => remember(key, result)).catch(() => undefined);
  inflight.set(key, waited);
  return waited;
}

/** Test hook: forget everything rendered so far. */
export function clearDiagramRenderCache(): void {
  cache.clear();
  inflight.clear();
}

/**
 * A drawing that finished after its caller stopped waiting (stage 'timeout'),
 * or undefined while it is still being drawn. Resolves from the cache.
 */
export function whenDiagramRendered(source: string, colors: DiagramThemeColors): Promise<DiagramRenderResult | undefined> {
  const key = diagramCacheKey(source, colors);
  return renderChain.then(() => cache.get(key));
}

/**
 * An <img>-ready URL for a rendered SVG. No object URL to revoke. Total: it is
 * called during render, and `encodeURIComponent` throws on a lone surrogate
 * (a label that ended in half an emoji took the whole window down).
 */
export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(wellFormedText(svg))}`;
}
