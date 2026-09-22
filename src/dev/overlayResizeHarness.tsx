// DEV-ONLY A/B rig for the overlay's auto expand / contract motion.
// Not part of the shipped app — vite's build input is index.html alone
// (vite.config.mts), so this and overlayResizeHarness.html exist for the dev
// server only. Same precedent as launcherTransitionHarness.tsx.
//
// WHAT IT COMPARES — pick the columns with `?v=` (comma-separated VARIANT keys):
//   before  the shipped motion up to 2026-09-13: the panel WIDTH springs
//           (OVERLAY_RESIZE_SPRING, visualDuration 420ms, bounce 0) and the
//           HEIGHT does not animate at all — every discrete layout change is an
//           instant cut, because the card was a plain auto-height box.
//   after   the transitions.dev "Card resize" signature on BOTH axes
//           (OVERLAY_RESIZE_TWEEN: 300ms / cubic-bezier(0.22, 1, 0.36, 1)).
//   opt1    the ORIGINAL spring on both axes — the height glide is the only new
//           thing; the curve is untouched.
//   opt2    original spring on width, the 300ms bezier on height — two curves.
//   opt3    the original spring loosened to bounce 0.35 on both axes.
//   opt4    the original spring's shape at 300ms instead of 420ms.
// Default is `opt1,opt2,opt3,opt4`; `?v=before,after` reproduces the first A/B.
//
// Every column imports the REAL motion objects and the REAL commit rule from the
// same modules NativelyInterface.tsx imports, so this compares shipped values
// rather than a lookalike. The structure mirrors the card that matters: fixed
// chrome above and below, one elastic viewport between them.
//
// Playwright hooks:
//   window.__ab.step(name)  — jump to a scenario step
//   window.__ab.steps       — the ordered step names
//   window.__ab.ready       — true once mounted
//
// Recorder + probe: scripts/overlay-motion/ (ab-record.mjs, ab-retarget-probe.mjs).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { animate, motion, useMotionValue, useTransform } from 'framer-motion';
import {
  OVERLAY_RESIZE_SPRING,
  OVERLAY_RESIZE_TWEEN,
} from '../../electron/utils/overlayResizeEasing.mjs';
import { decideHeightCommit } from '../lib/overlayHeightTween.mjs';

const SHELL_COLLAPSED = 600;
const SHELL_EXPANDED = 732;

// The original spring, loosened so it overshoots instead of dead-stopping.
// 0.35, not the 0.15 first tried: measured over the real travel distances here
// (113px and 193px), bounce 0.15 produced a ONE PIXEL overshoot — invisible, so
// it was not a third option at all, just a slightly quicker settle.
const SPRING_BOUNCY = { ...OVERLAY_RESIZE_SPRING, bounce: 0.35 };

// The original spring's SHAPE at the new pace. This is the other reading of
// "keep the original design, take the new one's dynamism": nothing about the
// curve changes, it just stops taking ~650ms to settle.
const SPRING_QUICK = { ...OVERLAY_RESIZE_SPRING, visualDuration: 0.3 };

type Variant = {
  key: string;
  label: string;
  sub: string;
  accent: string;
  /** framer options for the width channel. */
  width: Record<string, unknown>;
  /** framer options for the height channel; null = no height animation at all. */
  height: Record<string, unknown> | null;
};

const VARIANTS: Record<string, Variant> = {
  before: {
    key: 'before',
    label: 'BEFORE',
    sub: '420ms spring · height cuts',
    accent: '#8b8b96',
    width: OVERLAY_RESIZE_SPRING,
    height: null,
  },
  after: {
    key: 'after',
    label: 'AFTER',
    sub: '300ms bezier · both axes',
    accent: '#6ee7b7',
    width: OVERLAY_RESIZE_TWEEN,
    height: OVERLAY_RESIZE_TWEEN,
  },
  opt1: {
    key: 'opt1',
    label: '1 · ORIGINAL CURVE, HEIGHT MOVES',
    sub: 'spring 420ms bounce 0 · both axes',
    accent: '#7dd3fc',
    width: OVERLAY_RESIZE_SPRING,
    height: OVERLAY_RESIZE_SPRING,
  },
  opt2: {
    key: 'opt2',
    label: '2 · SPRING WIDTH, BEZIER HEIGHT',
    sub: 'spring 420ms · bezier 300ms',
    accent: '#fcd34d',
    width: OVERLAY_RESIZE_SPRING,
    height: OVERLAY_RESIZE_TWEEN,
  },
  opt3: {
    key: 'opt3',
    label: '3 · ORIGINAL CURVE, LOOSENED',
    sub: 'spring 420ms bounce 0.35 · both axes',
    accent: '#f0abfc',
    width: SPRING_BOUNCY,
    height: SPRING_BOUNCY,
  },
  opt4: {
    key: 'opt4',
    label: '4 · ORIGINAL CURVE, QUICKER',
    sub: 'spring 300ms bounce 0 · both axes',
    accent: '#fda4af',
    width: SPRING_QUICK,
    height: SPRING_QUICK,
  },
};

type Step = 'empty' | 'thinking' | 'answer' | 'code' | 'collapse' | 'clear';
const STEPS: Step[] = ['empty', 'thinking', 'answer', 'code', 'collapse', 'clear'];

const ANSWER_LINES = [
  'You can dedupe the retry queue by keying on the request id rather than the',
  'payload hash — the hash changes when the caller re-serialises, so two',
  'attempts at the same call look like different work and both get sent.',
];

const CODE_LINES = [
  'const seen = new Map<string, Promise<Response>>();',
  '',
  'export function once(id: string, run: () => Promise<Response>) {',
  '  const inflight = seen.get(id);',
  '  if (inflight) return inflight;',
  '  const p = run().finally(() => seen.delete(id));',
  '  seen.set(id, p);',
  '  return p;',
  '}',
];

/** One overlay-shaped card, driven by the motion config in `v`. */
function Card({ v, step }: { v: Variant; step: Step }) {
  const shellWidth = useMotionValue(SHELL_COLLAPSED);
  const viewportHeight = useMotionValue(0);
  const viewportHeightPx = useTransform(viewportHeight, (h: number) =>
    `${Math.max(0, Math.round(h))}px`,
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const appliedRef = useRef<number | null>(0);
  const tweenRef = useRef<ReturnType<typeof animate> | null>(null);

  const wide = step === 'code';
  const showViewport = step !== 'empty' && step !== 'clear';
  const showAnswer = step === 'answer' || step === 'code' || step === 'collapse';
  const showCode = step === 'code';

  // WIDTH. A spring is retargeted in flight (no .stop()) exactly as
  // startTransition does. A column whose width is a TWEEN mirrors the shipped
  // hybrid: the card-resize tween for a FRESH transition, the spring when one is
  // already running, so a scroll-driven retarget keeps its velocity continuity.
  // Keeping the rig honest about this matters — ab-retarget-probe.mjs measures
  // these columns and its numbers are quoted in startTransition's comment.
  // (Note the hybrid only exists for a tweened width; every one of the three
  // options below springs its width, so none of them needs it.)
  const widthControlsRef = useRef<ReturnType<typeof animate> | null>(null);
  const syncHeightToContent = useCallback(() => {
    const natural = Math.max(0, Math.round(scrollRef.current?.offsetHeight ?? 0));
    if (appliedRef.current === natural) return;
    tweenRef.current?.stop();
    tweenRef.current = null;
    appliedRef.current = natural;
    viewportHeight.set(natural);
  }, [viewportHeight]);
  useEffect(() => {
    const target = wide ? SHELL_EXPANDED : SHELL_COLLAPSED;
    // ?retarget=tween forces a tweened-width column to use the tween even on a
    // retarget — the configuration the hybrid was measured against. Keeping the
    // losing variant reachable is what makes the numbers in startTransition's
    // comment reproducible instead of a claim.
    const forceTween = new URLSearchParams(location.search).get('retarget') === 'tween';
    const isTweenWidth = v.width.type !== 'spring';
    const retargeting = widthControlsRef.current !== null && !forceTween;
    const opts = isTweenWidth && retargeting ? OVERLAY_RESIZE_SPRING : v.width;
    const controls = animate(shellWidth, target, {
      ...opts,
      // Same-frame height sync, as the app does from startTransition's onUpdate:
      // the observer path is rAF-debounced and therefore one frame behind, which
      // is exactly the lag that reads as "width first, then height".
      onUpdate: () => syncHeightToContent(),
      onComplete: () => {
        if (widthControlsRef.current === controls) widthControlsRef.current = null;
        syncHeightToContent();
      },
    });
    widthControlsRef.current = controls;
  }, [wide, v, shellWidth, syncHeightToContent]);

  // HEIGHT. A variant with `height: null` has no height channel at all — the box
  // is whatever the content makes it, which is why it cuts. Every other variant
  // routes each measurement through the real decideHeightCommit and animates
  // with that variant's own options.
  const commit = useCallback(
    (measured: number) => {
      if (!v.height) {
        viewportHeight.set(measured);
        appliedRef.current = measured;
        return;
      }
      const d = decideHeightCommit({
        from: appliedRef.current,
        to: measured,
        streamingWithText: false,
        // Mirrors the app: while the width animates, the height is a
        // consequence of it re-wrapping, not a discrete change, so it snaps and
        // the two axes stay in lockstep.
        widthAnimating: widthControlsRef.current !== null,
        resizing: false,
        reducedMotion: false,
      });
      if (d.action === 'none') return;
      appliedRef.current = d.height;
      if (d.action === 'snap') {
        tweenRef.current?.stop();
        viewportHeight.set(d.height);
        return;
      }
      tweenRef.current = animate(viewportHeight, d.height, v.height);
    },
    [v, viewportHeight],
  );

  useEffect(() => {
    let raf: number | null = null;
    const measure = () => {
      raf = null;
      commit(scrollRef.current?.offsetHeight ?? 0);
    };
    const schedule = () => {
      if (raf === null) raf = requestAnimationFrame(measure);
    };
    const el = scrollRef.current;
    if (!el) {
      commit(0);
      return;
    }
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    schedule();
    return () => {
      ro.disconnect();
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [showViewport, commit]);

  return (
    <div style={{ width: SHELL_EXPANDED, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ marginBottom: 14, textAlign: 'center' }}>
        <div
          style={{
            font: '600 13px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace',
            letterSpacing: '0.06em',
            color: v.accent,
          }}
        >
          {v.label}
        </div>
        <div
          style={{
            font: '11px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace',
            color: '#6d6d78',
            marginTop: 4,
          }}
        >
          {v.sub}
        </div>
      </div>
      <motion.div
        data-card={v.key}
        style={{
          width: shellWidth,
          borderRadius: 24,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(22,22,26,0.92)',
          border: '1px solid rgba(255,255,255,0.09)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
          color: '#e8e8ef',
          font: '15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        {/* chrome: status pill row */}
        <div style={{ padding: '12px 16px 4px', display: 'flex', gap: 6, justifyContent: 'center' }}>
          <span style={pill}>● Listening</span>
          <span style={pill}>gpt · auto</span>
        </div>

        {/* THE ELASTIC BOX */}
        <motion.div style={{ height: viewportHeightPx, overflow: 'hidden', flexShrink: 0 }}>
          {showViewport && (
            <div ref={scrollRef} style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ alignSelf: 'flex-end', ...bubble, background: 'rgba(99,102,241,0.18)' }}>
                How do I stop the retry queue double-sending?
              </div>
              {!showAnswer && <div style={dot} />}
              {showAnswer && (
                <div style={{ ...bubble, alignSelf: 'flex-start', background: 'rgba(255,255,255,0.05)' }}>
                  {ANSWER_LINES.map((l) => (
                    <div key={l}>{l}</div>
                  ))}
                </div>
              )}
              {showCode && (
                <pre style={code}>
                  {CODE_LINES.join('\n')}
                </pre>
              )}
            </div>
          )}
        </motion.div>

        {/* chrome: input + footer */}
        <div style={{ padding: '10px 16px 6px' }}>
          <div
            style={{
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 14,
              padding: '9px 12px',
              color: '#6f6f7c',
              fontSize: 14,
            }}
          >
            Ask anything…
          </div>
        </div>
        <div
          style={{
            padding: '4px 16px 12px',
            display: 'flex',
            justifyContent: 'space-between',
            color: '#63636f',
            fontSize: 11,
          }}
        >
          <span>⌘↵ send</span>
          <span>⌘B hide</span>
        </div>
      </motion.div>
    </div>
  );
}

const pill: React.CSSProperties = {
  border: '1px solid rgba(255,255,255,0.09)',
  borderRadius: 999,
  padding: '3px 9px',
  fontSize: 11,
  color: '#9a9aa6',
};
const bubble: React.CSSProperties = {
  maxWidth: '85%',
  borderRadius: 18,
  padding: '10px 14px',
  fontSize: 15,
};
const dot: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 999,
  background: '#d4d4dc',
  margin: '9px 0',
};
const code: React.CSSProperties = {
  margin: 0,
  padding: 12,
  borderRadius: 12,
  background: 'rgba(0,0,0,0.38)',
  font: '12.5px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace',
  color: '#a5d6ff',
  overflowX: 'auto',
  whiteSpace: 'pre',
};

function Harness() {
  const [step, setStep] = useState<Step>('empty');
  // `?v=` picks the columns. Default is the three options under consideration;
  // `?v=before,after` reproduces the original A/B the probe measures.
  const shown = (new URLSearchParams(location.search).get('v') ?? 'opt1,opt2,opt3,opt4')
    .split(',')
    .map((k) => VARIANTS[k.trim()])
    .filter(Boolean);
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__ab = {
      step: (s: Step) => setStep(s),
      steps: STEPS,
      ready: true,
    };
  }, []);
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'radial-gradient(120% 90% at 50% 0%, #24242c 0%, #131318 60%, #0c0c10 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 44,
        gap: 30,
      }}
    >
      <div style={{ display: 'flex', gap: 36, alignItems: 'flex-start' }}>
        {shown.map((v) => (
          <Card key={v.key} v={v} step={step} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {STEPS.map((s) => (
          <button
            key={s}
            onClick={() => setStep(s)}
            style={{
              border: '1px solid rgba(255,255,255,0.12)',
              background: step === s ? 'rgba(110,231,183,0.16)' : 'transparent',
              color: step === s ? '#6ee7b7' : '#8b8b96',
              borderRadius: 8,
              padding: '6px 12px',
              font: '12px ui-monospace, Menlo, monospace',
              cursor: 'pointer',
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById('harness-root')!).render(<Harness />);
