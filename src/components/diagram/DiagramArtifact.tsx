// A visual block shown as a card: a Mermaid diagram, a chart
// (`natively-chart`) or a notation diagram (`natively-diagram`: Chen ER, a
// formal automaton). One shell for all three — the same tabs, zoom, copy,
// export and states — because to the reader they are the same thing: a
// picture in the answer, with what it was drawn from one tap away.
//
// Used by every surface that shows an AI answer (live overlay, saved meeting
// usage, meeting chat). The card is driven by what the block IS, not by which
// action produced the answer:
//
//   still streaming, fence open   → "Generating diagram…" (or the previous
//                                    version, dimmed, with "Updating diagram…")
//   closing fence arrived          → validate, draw, show — while the rest of
//                                    the answer may still be streaming
//   drawing failed                 → one bounded automatic repair on a live
//                                    answer; otherwise a readable fallback
//                                    with the source
//   answer ended inside the block  → "cut off" fallback, never a spinner
//
// The drawing is shown through an <img> with a data: URL, so the SVG is an
// isolated document: it cannot run script, cannot load anything, and its ids
// cannot collide with another diagram's on the page. Nothing is injected into
// this component's DOM as HTML.
//
// Mermaid is never called for a block that is still arriving, and never per
// token: the render effect depends on the completed source only.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Download, Maximize2, Minus, Plus, Wrench } from 'lucide-react';
import { useT } from '../../i18n';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import {
  renderDiagram,
  peekDiagramRender,
  whenDiagramRendered,
  svgToDataUrl,
  diagramThemeKey,
  type DiagramRenderResult,
  type DiagramThemeColors,
} from '../../lib/diagram/mermaidRenderer';
import { detectDiagramType, diagramCardLabel, diagramSourceKey, isPlaceholderDiagram, DIAGRAM_LIMITS } from '../../lib/diagram/diagramPolicy.mjs';
import { compileVisualSource, type CompiledVisual } from '../../lib/diagram/visualArtifact.mjs';
import { analyseErDiagram, describeErDiagram } from '../../lib/diagram/erSemantics.mjs';
import { formatNumber } from '../../lib/diagram/chartCompute.mjs';
import { fitDiagram, zoomAbout, clampPan, wheelZoomsDiagram, DIAGRAM_VIEW_LIMITS } from '../../lib/diagram/diagramViewport.mjs';
import { diagramTimings } from '../../lib/diagram/diagramTimings.mjs';
import {
  diagramColorsFor,
  exportDiagram,
  canAutoRepair,
  manualRepairAvailable,
  requestDiagramRepair,
  DIAGRAM_DARK_SURFACE,
  DIAGRAM_LIGHT_SURFACE,
  type DiagramExportFormat,
} from '../../lib/diagram/diagramRuntime';

export type DiagramArtifactKind = 'mermaid' | 'chart' | 'notation';

export interface DiagramArtifactProps {
  /**
   * What the block is written in, from its fence tag: Mermaid source, a chart
   * payload, or a notation model. Defaults to Mermaid.
   */
  kind?: DiagramArtifactKind;
  /** Block content as written (may still be growing while `complete` is false). */
  source: string;
  /** The fence's info string ("mermaid", "mermaid source", …). */
  info?: string;
  /** The closing fence has arrived. */
  complete: boolean;
  /** The owning answer is still streaming. */
  streaming: boolean;
  /** Stable id for this artifact: the owning message/turn plus the block's ordinal. */
  artifactId: string;
  /** The owning turn, for timing marks. */
  turnId?: string;
  /** What the diagram shows, from the answer's own text (accessible description). */
  description?: string;
  /** The last valid version of the same design, shown while an update generates. */
  previousSource?: string;
  /** Live answers may repair a broken block once, automatically. Replays never do. */
  allowAutoRepair?: boolean;
  /** A repair drew successfully: the owner should put it in the answer text. */
  onRepaired?: (originalSource: string, repairedSource: string) => void;
  /** Changes when the surrounding theme changes (colour or interface theme). */
  themeKey?: string;
  /** Height cap for the diagram viewport (defaults to DIAGRAM_VIEW_LIMITS.maxHeight). */
  maxHeight?: number;
  /**
   * The card's height changed for a reason the owner cannot see in its own
   * state (the drawing arrived, a fallback replaced the spinner, a tab was
   * switched). The live overlay uses it to keep following the bottom of a
   * streaming answer.
   */
  onLayout?: () => void;
}

type Tab = 'diagram' | 'source';
type DrawnResult = Extract<DiagramRenderResult, { ok: true }>;
/** What a chart / notation block carries besides its picture (see visualArtifact.mjs). */
type VisualMeta = Extract<CompiledVisual, { ok: true }>;
type RenderState =
  | { status: 'idle' }
  | { status: 'rendering' }
  | { status: 'repairing' }
  | { status: 'ready'; result: DrawnResult; source: string; meta: VisualMeta | null }
  | { status: 'error'; message: string; stage: string; diagnostic?: string; source: string; repairTried: boolean; missing?: string[] };

type Drawn = { result: DiagramRenderResult; meta: VisualMeta | null; missing?: string[] };

/**
 * Turn a completed block into a drawing. Mermaid goes to the Mermaid renderer;
 * a chart or a notation model is validated and drawn by its local adapter
 * (synchronously — there is nothing to load), except an automaton, whose
 * adapter writes Mermaid source that then takes the Mermaid path.
 */
async function drawArtifact(kind: DiagramArtifactKind, source: string, colors: DiagramThemeColors): Promise<Drawn> {
  if (kind === 'mermaid') return { result: await renderDiagram(source, colors), meta: null };
  const compiled = compileVisualSource(kind, source, colors);
  if (!compiled.ok) {
    return { result: { ok: false, stage: 'policy', code: compiled.code, message: compiled.message }, meta: null, missing: compiled.missing };
  }
  if (compiled.renderer === 'mermaid') return { result: await renderDiagram(compiled.mermaid, colors), meta: compiled };
  return {
    result: {
      ok: true,
      svg: compiled.svg,
      width: compiled.width,
      height: compiled.height,
      type: compiled.view,
      view: compiled.view,
      neutralised: [],
      renderSource: source,
      timings: { parseMs: 0, renderMs: 0, coldLoadMs: 0 },
    },
    meta: compiled,
  };
}

const PENDING_LABEL: Record<DiagramArtifactKind, string> = { mermaid: 'Diagram', chart: 'Chart', notation: 'Diagram' };

const toCss = (rgb: [number, number, number]): string => `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;

function fileStem(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'diagram';
}

/** Copy with a brief confirmed state; no dependence on the surrounding card. */
function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = useCallback((text: string) => {
    const p = navigator.clipboard?.writeText(text);
    if (!p) return;
    p.then(() => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    }).catch(() => undefined);
  }, []);
  return [copied, copy];
}

function DiagramArtifactImpl({
  kind = 'mermaid',
  source,
  info,
  complete,
  streaming,
  artifactId,
  turnId,
  description,
  previousSource,
  allowAutoRepair = false,
  onRepaired,
  themeKey,
  maxHeight = DIAGRAM_VIEW_LIMITS.maxHeight,
  onLayout,
}: DiagramArtifactProps) {
  const t = useT();
  const resolvedTheme = useResolvedTheme();
  // "mermaid source": the user asked for the text. Nothing is drawn unless
  // they open the Diagram tab themselves.
  const sourceOnly = useMemo(() => /\bsource\b/i.test(String(info ?? '').replace(/^\s*\S+/, '')), [info]);
  const [tab, setTab] = useState<Tab>(sourceOnly ? 'source' : 'diagram');
  const [colors, setColors] = useState<DiagramThemeColors | null>(null);
  const [state, setState] = useState<RenderState>({ status: 'idle' });
  const [previous, setPrevious] = useState<DrawnResult | null>(null);
  const [repairedSource, setRepairedSource] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [containerWidth, setContainerWidth] = useState(0);
  const [copied, copy] = useCopied();

  const rootRef = useRef<HTMLElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const renderToken = useRef(0);
  const repairCancel = useRef<(() => void) | null>(null);
  const exportNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const mounted = useRef(true);

  // A repair the owner has not (yet) written back into the answer text is
  // dropped the moment the block's own source changes.
  const sourceKey = useMemo(() => diagramSourceKey(source), [source]);
  useEffect(() => {
    setRepairedSource(null);
  }, [sourceKey]);
  const effectiveSource = repairedSource ?? source;

  const meta = state.status === 'ready' ? state.meta : null;
  const label = useMemo(() => {
    if (kind !== 'mermaid') return meta ? meta.label : PENDING_LABEL[kind];
    return diagramCardLabel(detectDiagramType(effectiveSource).view);
  }, [effectiveSource, kind, meta]);

  // An ER diagram is read back in words (both directions of every
  // relationship), and checked for the one slip its own text can show: a solid
  // identifying line on a child that has its own key.
  const er = useMemo(() => (kind === 'mermaid' && complete && /^\s*erDiagram\b/m.test(effectiveSource) ? analyseErDiagram(effectiveSource) : null), [kind, complete, effectiveSource]);

  // What the Source tab, Copy and the .mmd export hand out. When a keyword used
  // as a node id was renamed to make the diagram parse, that is the renamed
  // source: the text the user takes away must draw in any Mermaid tool, and
  // must be the text of the drawing they are looking at.
  const shareSource =
    state.status === 'ready' && state.source === effectiveSource && state.result.neutralised.includes('reserved_id')
      ? state.result.renderSource
      : effectiveSource;

  // ── colours: from the card's own computed text colour ─────────────────────
  useLayoutEffect(() => {
    setColors((prev) => {
      const next = diagramColorsFor(rootRef.current);
      return prev && diagramThemeKey(prev) === diagramThemeKey(next) ? prev : next;
    });
  }, [resolvedTheme, themeKey]);
  const colorsKey = colors ? diagramThemeKey(colors) : '';

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      renderToken.current += 1; // any render still in flight is now stale
      repairCancel.current?.();
      repairCancel.current = null;
      if (exportNoteTimer.current) clearTimeout(exportNoteTimer.current);
    };
  }, []);

  // ── timing: the block's closing fence has been revealed ───────────────────
  useEffect(() => {
    if (complete && turnId) diagramTimings.mark(turnId, 'block_revealed', performance.now());
  }, [complete, turnId]);

  // ── draw (only a COMPLETE block, only when the Diagram tab is showing) ────
  useEffect(() => {
    if (!colors || !complete || tab !== 'diagram') {
      if (!complete) setState((s) => (s.status === 'idle' ? s : { status: 'idle' }));
      return;
    }
    const token = (renderToken.current += 1);
    const target = effectiveSource;
    const cached = kind === 'mermaid' ? peekDiagramRender(target, colors) : null;
    const apply = ({ result, meta: drawnMeta, missing }: Drawn): void => {
      // Out-of-order completion: a newer source or theme owns the card now.
      if (!mounted.current || renderToken.current !== token) return;
      if (result.ok) {
        if (turnId) {
          diagramTimings.set(turnId, 'parseMs', Math.round(result.timings.parseMs));
          diagramTimings.set(turnId, 'renderMs', Math.round(result.timings.renderMs));
          diagramTimings.set(turnId, 'coldLoadMs', Math.round(result.timings.coldLoadMs));
        }
        setState({ status: 'ready', result, source: target, meta: drawnMeta });
        setView({ zoom: 1, x: 0, y: 0 });
      } else {
        if (turnId) diagramTimings.set(turnId, 'failureStage', result.stage);
        setState((prev) => ({
          status: 'error',
          message: result.message,
          stage: result.stage,
          diagnostic: result.diagnostic,
          source: target,
          repairTried: prev.status === 'error' && prev.source === target ? prev.repairTried : repairedSource !== null,
          ...(missing && missing.length ? { missing } : {}),
        }));
      }
    };
    if (cached) {
      apply({ result: cached, meta: null });
      return;
    }
    setState((s) => (s.status === 'ready' && s.source === target ? s : { status: 'rendering' }));
    void drawArtifact(kind, target, colors)
      .then((drawn) => {
        apply(drawn);
        // The wait ran out but Mermaid is still drawing: take the drawing when
        // it lands instead of leaving "took too long" up for good.
        if (!drawn.result.ok && drawn.result.stage === 'timeout' && kind === 'mermaid') {
          void whenDiagramRendered(target, colors).then((late) => {
            if (late && late.ok) apply({ result: late, meta: null });
          });
        }
      })
      // An adapter that throws must end as a fallback, never as a card stuck on "Drawing…".
      .catch(() => apply({ result: { ok: false, stage: 'render', code: 'failed', message: kind === 'chart' ? 'This chart could not be drawn.' : 'This diagram could not be drawn.' }, meta: null }));
    // `colors` is covered by colorsKey (same key ⇒ same palette object contents).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSource, complete, tab, colorsKey, turnId, kind]);

  // ── the previous version, while an update is still being written ──────────
  useEffect(() => {
    // No longer an update in progress (nothing to update, or the answer ended
    // inside the block): nothing to keep.
    if (!colors || !previousSource || (!complete && !streaming)) {
      setPrevious(null);
      return;
    }
    // The new block has closed: keep what is showing until the new drawing is
    // ready (cleared below). Dropping it here gave previous → "Drawing…" → new.
    if (complete) return;
    let alive = true;
    void drawArtifact(kind, previousSource, colors).then(({ result }) => {
      if (alive && mounted.current) setPrevious(result.ok ? result : null);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previousSource, complete, streaming, colorsKey, kind]);

  const settled = state.status === 'ready' || state.status === 'error';
  useEffect(() => {
    if (complete && settled) setPrevious(null);
  }, [complete, settled]);

  // ── repair ────────────────────────────────────────────────────────────────
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const startRepair = useCallback(
    (failed: Extract<RenderState, { status: 'error' }>, manual: boolean) => {
      if (repairCancel.current) return;
      const original = failed.source;
      setState({ status: 'repairing' });
      const { cancel, result } = requestDiagramRepair({ source: original, diagnostic: failed.diagnostic, stage: failed.stage, manual });
      repairCancel.current = cancel;
      void result.then((outcome) => {
        repairCancel.current = null;
        if (!mounted.current) return;
        // The card moved on to a different block while the repair was out: the
        // answer no longer holds the text this repair was for.
        if (diagramSourceKey(sourceRef.current) !== diagramSourceKey(original)) return;
        if (turnId) diagramTimings.set(turnId, 'repairs', manual ? 'manual' : 'automatic');
        if (!outcome.ok) {
          if (turnId) diagramTimings.set(turnId, 'repairOutcome', outcome.reason);
          setState({ ...failed, repairTried: true });
          return;
        }
        // The repaired text is only a candidate: it has to draw before it replaces anything.
        const palette = diagramColorsFor(rootRef.current);
        void renderDiagram(outcome.source, palette).then((drawn) => {
          if (!mounted.current) return;
          if (diagramSourceKey(sourceRef.current) !== diagramSourceKey(original)) return;
          if (!drawn.ok) {
            if (turnId) diagramTimings.set(turnId, 'repairOutcome', 'still_invalid');
            setState({ ...failed, repairTried: true });
            return;
          }
          if (turnId) diagramTimings.set(turnId, 'repairOutcome', 'fixed');
          setRepairedSource(outcome.source);
          onRepaired?.(original, outcome.source);
          void window.electronAPI?.acceptDiagramRepair?.({ originalSource: original, repairedSource: outcome.source }).catch(() => undefined);
        });
      });
    },
    [onRepaired, turnId],
  );

  useEffect(() => {
    // Only a model's own Mermaid is ever sent back for a syntax repair. A chart
    // or a notation model fails for what it SAYS (a missing input, an illegal
    // transition): a repair could only "fix" that by inventing something.
    if (kind !== 'mermaid') return;
    if (state.status !== 'error' || state.repairTried || !allowAutoRepair) return;
    if (!canAutoRepair(state.source, state.stage)) return;
    startRepair(state, false);
  }, [state, allowAutoRepair, startRepair, kind]);

  // ── viewport size ─────────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = (): void => setContainerWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [tab, state.status, previous]);

  const shown = state.status === 'ready' ? state.result : state.status === 'error' ? null : previous;
  const fit = useMemo(
    () => (shown ? fitDiagram({ naturalWidth: shown.width, naturalHeight: shown.height, containerWidth: containerWidth || shown.width, maxHeight }) : null),
    [shown, containerWidth, maxHeight],
  );
  // Memoised: a new object on every render re-attached the wheel listener on
  // every render.
  const box = useMemo(
    () => (fit ? { fitWidth: fit.width, fitHeight: fit.height, viewportWidth: containerWidth || fit.width, viewportHeight: fit.viewportHeight } : null),
    [fit, containerWidth],
  );
  const pan = box
    ? clampPan({ x: view.x, y: view.y }, { imageWidth: box.fitWidth * view.zoom, imageHeight: box.fitHeight * view.zoom, viewportWidth: box.viewportWidth, viewportHeight: box.viewportHeight })
    : { x: 0, y: 0 };
  const dataUrl = useMemo(() => (shown ? svgToDataUrl(shown.svg) : ''), [shown]);

  const zoomBy = useCallback(
    (factor: number, anchor?: { x: number; y: number }) => {
      if (!box) return;
      setView((v) => zoomAbout({ zoom: v.zoom, x: pan.x, y: pan.y }, v.zoom * factor, anchor ?? { x: box.viewportWidth / 2, y: box.viewportHeight / 2 }, box));
    },
    [box, pan.x, pan.y],
  );

  // A plain wheel is the chat's. Only a pinch / ctrl+wheel zooms, and only
  // then is the default prevented (a non-passive listener is needed for that).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !box) return;
    const onWheel = (event: WheelEvent): void => {
      if (!wheelZoomsDiagram(event)) return;
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [box, zoomBy]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (view.zoom <= 1 || event.button !== 0) return;
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: pan.x, originY: pan.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    setView((v) => ({ zoom: v.zoom, x: d.originX + (event.clientX - d.startX), y: d.originY + (event.clientY - d.startY) }));
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };
  // A zoomed drawing can be moved without a pointer (the render clamps the
  // result to the drawing's edges, as it does for a drag).
  const onViewportKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (view.zoom <= 1) return;
    const step = event.shiftKey ? 120 : 40;
    const move: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const delta = move[event.key];
    if (!delta) return;
    event.preventDefault();
    setView((v) => ({ zoom: v.zoom, x: pan.x + delta[0], y: pan.y + delta[1] }));
  };
  // Left/Right/Home/End move between the two tabs, as a tab list should.
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const next = event.key === 'ArrowLeft' || event.key === 'Home' ? 'diagram' : event.key === 'ArrowRight' || event.key === 'End' ? 'source' : null;
    if (!next) return;
    event.preventDefault();
    setTab(next);
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons[next === 'diagram' ? 0 : 1]?.focus();
  };

  const runExport = async (format: DiagramExportFormat): Promise<void> => {
    setExportOpen(false);
    const ready = state.status === 'ready' ? state.result : null;
    try {
      const outcome = await exportDiagram({
        format,
        name: fileStem(meta?.title || label),
        source: shareSource,
        text: format === 'json' ? meta?.exports.json : format === 'csv' ? meta?.exports.csv : undefined,
        svg: ready?.svg,
        width: ready?.width,
        height: ready?.height,
        // The drawing is transparent; a PNG needs the surface it was drawn for.
        background: toCss(colors?.dark === false ? DIAGRAM_LIGHT_SURFACE : DIAGRAM_DARK_SURFACE),
      });
      if (!mounted.current) return;
      if (outcome.canceled) return;
      setExportNote(outcome.saved ? (outcome.silent ? t('Saved to Downloads') : t('Saved')) : t('Could not save'));
    } catch {
      if (mounted.current) setExportNote(t('Could not save'));
    }
    if (exportNoteTimer.current) clearTimeout(exportNoteTimer.current);
    exportNoteTimer.current = setTimeout(() => {
      if (mounted.current) setExportNote(null);
    }, 2400);
  };

  // Tell the owner when the card's height may have changed without any change
  // to the owner's own state.
  const layoutHeight = fit ? fit.viewportHeight : 0;
  useEffect(() => {
    onLayout?.();
  }, [onLayout, state.status, tab, layoutHeight, exportOpen, meta]);

  const generating = !complete && streaming;
  const cutOff = !complete && !streaming;
  const canZoom = state.status === 'ready' && tab === 'diagram';
  // What the picture shows, in words. A chart or a notation model describes
  // itself exactly (its values, its relationships); a Mermaid diagram takes the
  // answer's own lead sentence, plus the ER reading when it is one.
  const erReading = er ? describeErDiagram(er) : '';
  const said = meta?.description || [description, erReading].filter(Boolean).join(' ');
  const altText = said ? `${label}. ${said}` : label;
  // What was corrected, assumed or left unknown — shown under the drawing so it
  // is read with it, not hidden behind a tab.
  // A chart already prints its first assumption and source inside the image
  // (so an exported picture keeps them); only the rest is listed here.
  const inImage = meta?.artifact === 'chart' ? 1 : 0;
  const notes = meta
    ? [...meta.assumptions.slice(inImage), ...meta.sources.slice(inImage).map((src) => `Source: ${src}`), ...meta.notes]
    : er ? er.notes : [];
  // A payload is shown indented, however compactly it was written.
  const sourceText = useMemo(() => {
    if (kind === 'mermaid') return shareSource;
    try {
      return JSON.stringify(JSON.parse(shareSource), null, 2);
    } catch {
      return shareSource;
    }
  }, [kind, shareSource]);
  const copyText = kind === 'chart' ? meta?.exports.csv ?? shareSource : shareSource;
  const copyTitle = kind === 'chart' ? 'Copy data' : kind === 'notation' ? 'Copy source' : 'Copy Mermaid';
  const viewTab = kind === 'chart' ? 'Chart' : 'Diagram';
  const sourceTab = kind === 'chart' ? 'Data' : 'Source';

  let body: React.ReactNode;
  if (tab === 'source') {
    const table = meta?.table ?? null;
    body = (
      <div className="diagram-card__data">
        {table ? (
          // The same numbers the picture was drawn from, as text.
          <div className="diagram-card__table-wrap">
            <table className="diagram-card__table">
              <thead>
                <tr>{table.columns.map((c, i) => <th key={i} scope="col">{c}</th>)}</tr>
              </thead>
              <tbody>
                {table.rows.map((row, r) => (
                  <tr key={r}>{row.map((cell, c) => (c === 0 ? <th key={c} scope="row">{String(cell)}</th> : <td key={c}>{typeof cell === 'number' ? formatNumber(cell) : String(cell)}</td>))}</tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <pre className="diagram-card__source" aria-label={t(kind === 'mermaid' ? 'Mermaid source' : 'Source')}>
          <code>{sourceText}</code>
        </pre>
      </div>
    );
  } else if (shown && fit && box) {
    const updating = state.status !== 'ready';
    body = (
      <div
        ref={viewportRef}
        className={`diagram-card__viewport${view.zoom > 1 ? ' is-zoomed' : ''}${updating ? ' is-previous' : ''}`}
        style={{ height: fit.viewportHeight }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        tabIndex={view.zoom > 1 ? 0 : undefined}
        onKeyDown={onViewportKeyDown}
      >
        <img
          className="diagram-card__img"
          src={dataUrl}
          alt={altText}
          draggable={false}
          width={Math.round(box.fitWidth * view.zoom)}
          height={Math.round(box.fitHeight * view.zoom)}
          style={{ transform: `translate(${Math.round(pan.x)}px, ${Math.round(pan.y)}px)` }}
          onLoad={() => {
            if (!updating && turnId) diagramTimings.mark(turnId, 'diagram_visible', performance.now());
          }}
          onError={() => {
            // The image could not be decoded: a broken picture under working
            // zoom controls is worse than the fallback with the source.
            if (updating) setPrevious(null);
            else setState((prev) => (prev.status === 'ready' ? { status: 'error', message: kind === 'chart' ? 'This chart could not be drawn.' : 'This diagram could not be drawn.', stage: 'output', source: prev.source, repairTried: true } : prev));
          }}
        />
        {updating ? (
          <div className="diagram-card__status diagram-card__status--over">
            <span className="natively-thinking-label diagram-card__status-text">{t('Updating diagram…')}</span>
          </div>
        ) : null}
      </div>
    );
  } else if (generating || state.status === 'rendering' || state.status === 'repairing' || (complete && state.status === 'idle')) {
    body = (
      <div ref={viewportRef} className="diagram-card__status" role="status">
        <span className="natively-thinking-label diagram-card__status-text">
          {state.status === 'repairing' ? t('Fixing diagram…') : generating ? t(kind === 'chart' ? 'Generating chart…' : 'Generating diagram…') : t(kind === 'chart' ? 'Drawing chart…' : 'Drawing diagram…')}
        </span>
      </div>
    );
  } else {
    const failed = state.status === 'error' ? state : null;
    const message = cutOff
      ? t(kind === 'chart' ? 'The chart was cut off before it finished.' : 'The diagram was cut off before it finished.')
      : failed ? t(failed.message) : t(kind === 'chart' ? 'This chart could not be drawn.' : 'This diagram could not be drawn.');
    // A retry can fix a syntax or layout error in Mermaid. It cannot fix a
    // policy rejection, a cut-off block, or anything a chart is missing.
    const offerFix = kind === 'mermaid' && Boolean(failed) && (failed!.stage === 'parse' || failed!.stage === 'render') && manualRepairAvailable();
    body = (
      <div ref={viewportRef} className="diagram-card__fallback" role="note">
        <p className="diagram-card__fallback-text">{message}</p>

        <div className="diagram-card__fallback-actions">
          <button type="button" className="diagram-card__text-btn" onClick={() => setTab('source')}>
            {t('View source')}
          </button>
          {offerFix ? (
            <button type="button" className="diagram-card__text-btn" onClick={() => failed && startRepair(failed, true)}>
              <Wrench size={12} strokeWidth={2} aria-hidden />
              {t('Try to fix')}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <figure
      ref={(el) => {
        rootRef.current = el;
      }}
      className="diagram-card overlay-code-block-surface"
      data-diagram-artifact={artifactId}
      data-diagram-kind={kind}
      // What a calculation was not given (its message says so in words).
      data-diagram-missing={state.status === 'error' && state.missing?.length ? state.missing.join('; ') : undefined}
      data-diagram-state={generating ? 'generating' : cutOff ? 'cut-off' : state.status}
      role="group"
      aria-label={t(label)}
    >
      <div className="diagram-card__head overlay-code-header-surface">
        {/* A div, not a span: the answer card recolours every span inside it. */}
        <div className="diagram-card__label">{t(label)}</div>
        <div className="diagram-card__tabs" role="tablist" aria-label={t('Diagram view')} onKeyDown={onTabKeyDown}>
          <button type="button" role="tab" aria-selected={tab === 'diagram'} tabIndex={tab === 'diagram' ? 0 : -1} className="diagram-card__tab" onClick={() => setTab('diagram')}>
            {t(viewTab)}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'source'} tabIndex={tab === 'source' ? 0 : -1} className="diagram-card__tab" onClick={() => setTab('source')}>
            {t(sourceTab)}
          </button>
        </div>
        <div className="diagram-card__actions">
          {exportNote ? <div className="diagram-card__note" role="status">{exportNote}</div> : null}
          {canZoom ? (
            <>
              <button type="button" className="diagram-card__icon-btn" onClick={() => zoomBy(1 / DIAGRAM_VIEW_LIMITS.zoomStep)} disabled={view.zoom <= 1} title={t('Zoom out')} aria-label={t('Zoom out')}>
                <Minus size={14} strokeWidth={2} />
              </button>
              <button type="button" className="diagram-card__icon-btn" onClick={() => zoomBy(DIAGRAM_VIEW_LIMITS.zoomStep)} disabled={view.zoom >= DIAGRAM_VIEW_LIMITS.maxZoom} title={t('Zoom in')} aria-label={t('Zoom in')}>
                <Plus size={14} strokeWidth={2} />
              </button>
              <button type="button" className="diagram-card__icon-btn" onClick={() => setView({ zoom: 1, x: 0, y: 0 })} disabled={view.zoom === 1} title={t('Fit to card')} aria-label={t('Fit to card')}>
                <Maximize2 size={14} strokeWidth={2} />
              </button>
            </>
          ) : null}
          <button type="button" className="diagram-card__icon-btn" onClick={() => copy(copyText)} title={copied ? t('Copied') : t(copyTitle)} aria-label={copied ? t('Copied') : t(copyTitle)}>
            {copied ? <Check size={14} strokeWidth={2.5} className="diagram-card__ok" /> : <Copy size={14} strokeWidth={2} />}
          </button>
          {complete ? (
            <button type="button" className="diagram-card__icon-btn" aria-expanded={exportOpen} onClick={() => setExportOpen((v) => !v)} title={t('Export')} aria-label={t('Export')}>
              <Download size={14} strokeWidth={2} />
            </button>
          ) : null}
        </div>
      </div>
      {exportOpen ? (
        <div className="diagram-card__export" role="group" aria-label={t('Export')}>
          <button type="button" className="diagram-card__text-btn" disabled={state.status !== 'ready'} onClick={() => void runExport('svg')}>SVG</button>
          <button type="button" className="diagram-card__text-btn" disabled={state.status !== 'ready'} onClick={() => void runExport('png')}>PNG</button>
          {kind === 'mermaid' ? (
            <button type="button" className="diagram-card__text-btn" onClick={() => void runExport('mmd')}>{t('Mermaid (.mmd)')}</button>
          ) : (
            <>
              {/* A chart's data and a model's source are this app's own formats, named as such. */}
              {meta?.exports.csv ? <button type="button" className="diagram-card__text-btn" onClick={() => void runExport('csv')}>CSV</button> : null}
              <button type="button" className="diagram-card__text-btn" disabled={!meta} onClick={() => void runExport('json')}>JSON</button>
            </>
          )}
        </div>
      ) : null}
      {body}
      {tab === 'diagram' && state.status === 'ready' && notes.length > 0 ? (
        <ul className="diagram-card__notes">
          {notes.slice(0, 4).map((note, i) => <li key={i}>{note}</li>)}
        </ul>
      ) : null}
    </figure>
  );
}

/**
 * Memoised on what the card actually depends on. The overlay re-renders its
 * message rows on every paced reveal tick; a finished diagram must not redo
 * work (or lose its zoom) because prose below it grew by a few characters.
 */
/**
 * A finished Mermaid block that holds only placeholders ("Method (unknown)",
 * "Dates not provided") draws nothing: the sentence beside it already says
 * what is missing. The user asked for the text ("mermaid source") still gets it.
 */
function DiagramArtifactOrNothing(props: DiagramArtifactProps) {
  const { kind = 'mermaid', source, complete, info } = props;
  const nothing = useMemo(
    () =>
      kind === 'mermaid' && complete
      // Policy refuses anything larger; do not scan what will not be drawn.
      && source.length <= DIAGRAM_LIMITS.maxSourceChars
      && !/\bsource\b/i.test(String(info ?? '').replace(/^\s*\S+/, ''))
      && isPlaceholderDiagram(source),
    [kind, source, complete, info],
  );
  if (nothing) return null;
  return (
    <DiagramErrorBoundary source={source} resetKey={`${kind}:${source.length}:${complete ? 1 : 0}`}>
      <DiagramArtifactImpl {...props} />
    </DiagramErrorBoundary>
  );
}

/**
 * One card failing to render must cost one card. Without this the nearest
 * boundary is the whole overlay (or launcher) window — and for a saved answer
 * it would fail again every time that answer is shown.
 */
class DiagramErrorBoundary extends React.Component<{ source: string; resetKey: string; children: React.ReactNode }, { failedKey: string | null }> {
  state = { failedKey: null as string | null };

  static getDerivedStateFromError(): Partial<{ failedKey: string | null }> {
    return { failedKey: '' };
  }

  componentDidCatch(): void {
    this.setState({ failedKey: this.props.resetKey });
  }

  render(): React.ReactNode {
    // A different block (or the same one, now complete) gets a fresh try.
    if (this.state.failedKey === null || (this.state.failedKey !== '' && this.state.failedKey !== this.props.resetKey)) return this.props.children;
    return (
      <figure className="diagram-card overlay-code-block-surface" data-diagram-state="error" role="group">
        <pre className="diagram-card__source">
          <code>{this.props.source}</code>
        </pre>
      </figure>
    );
  }
}

export const DiagramArtifact = React.memo(
  DiagramArtifactOrNothing,
  (prev, next) =>
    prev.kind === next.kind &&
    prev.source === next.source &&
    prev.info === next.info &&
    prev.complete === next.complete &&
    prev.streaming === next.streaming &&
    prev.artifactId === next.artifactId &&
    prev.turnId === next.turnId &&
    prev.description === next.description &&
    prev.previousSource === next.previousSource &&
    prev.allowAutoRepair === next.allowAutoRepair &&
    prev.themeKey === next.themeKey &&
    prev.maxHeight === next.maxHeight &&
    prev.onRepaired === next.onRepaired &&
    prev.onLayout === next.onLayout,
);

export default DiagramArtifact;
