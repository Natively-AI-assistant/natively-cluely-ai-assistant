import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** CSS time value in ms. The production CSS minifier rewrites `150ms` as
 *  `.15s`, so a bare parseFloat would read 0.15. */
const cssMs = (el: Element | null, name: string, fallback: number) => {
  const raw = el ? getComputedStyle(el).getPropertyValue(name).trim() : '';
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  return raw.endsWith('ms') ? n : raw.endsWith('s') ? n * 1000 : fallback;
};

/** transitions.dev #04 text states swap, keyed: when `swapKey` changes the old
 *  content leaves up with a blur and the new one rises in from below. While the
 *  key holds, children update live. Timing comes from `--text-swap-dur` on the
 *  nearest scope that sets it (`.ov-motion` in the meeting overlay). Children
 *  that need their own layout (an icon beside a label) bring a wrapper, because
 *  the swap span itself is inline-block.
 *
 *  `overlap`: the old content leaves WHILE the new one arrives, so the line is
 *  never empty (a banner's title changing in place). The old copy is taken out
 *  of the flow and laid over the new one for the length of the swap; its own
 *  rules live with the caller's styles (.t-text-swap-leaving, OverlayBanner.css).
 *  Leave it off where the box is sized by its label (Answer / Stop, the chips):
 *  there the old label must be gone before the new width arrives. */
const SwapText: React.FC<{
  swapKey: string;
  children: React.ReactNode;
  /** Called with the key whose content is now on screen (after the exit). */
  onShown?: (key: string) => void;
  /** Cross over instead of one after the other (see above). */
  overlap?: boolean;
}> = ({ swapKey, children, onShown, overlap }) => {
  const [shownKey, setShownKey] = useState(swapKey);
  const onShownRef = useRef(onShown);
  onShownRef.current = onShown;
  useLayoutEffect(() => {
    onShownRef.current?.(shownKey);
  }, [shownKey]);
  const [phase, setPhase] = useState<'idle' | 'exit' | 'enter'>('idle');
  const held = useRef<React.ReactNode>(children);
  if (shownKey === swapKey) held.current = children;
  const ref = useRef<HTMLSpanElement>(null);
  // overlap: the content on its way out, until its transition has run.
  const [leaving, setLeaving] = useState<{ key: string; node: React.ReactNode } | null>(null);
  // In a ref, not the effect's cleanup: the effect below changes its own key
  // and re-runs at once, which would cancel the removal before it could fire.
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); }, []);
  useEffect(() => {
    // The key came back before the exit finished (Answer, then Stop within
    // 150ms): cancel the exit so the label settles back instead of staying
    // faded out.
    if (swapKey === shownKey) {
      setPhase((p) => (p === 'exit' ? 'idle' : p));
      return;
    }
    // Reduced motion: the snippet's guard drops the transitions, so the exit
    // would only be an empty gap. Swap at once instead.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setShownKey(swapKey);
      return;
    }
    if (overlap) {
      // The new words go in now, from below; the old ones are laid over them
      // and leave upward (their rule starts them where they were).
      setLeaving({ key: shownKey, node: held.current });
      setShownKey(swapKey);
      setPhase('enter');
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
      leaveTimer.current = setTimeout(() => {
        leaveTimer.current = null;
        setLeaving(null);
      }, cssMs(ref.current, '--text-swap-dur', 150));
      return;
    }
    setPhase('exit');
    const t = setTimeout(() => {
      setShownKey(swapKey);
      setPhase('enter');
    }, cssMs(ref.current, '--text-swap-dur', 150));
    return () => clearTimeout(t);
  }, [swapKey, shownKey, overlap]);
  useLayoutEffect(() => {
    if (phase !== 'enter') return;
    void ref.current?.offsetHeight; // reflow: start from below, then transition back
    setPhase('idle');
  }, [phase]);
  const cls = phase === 'exit' ? ' is-exit' : phase === 'enter' ? ' is-enter-start' : '';
  const current = (
    <span ref={ref} className={`t-text-swap${cls}`}>
      {shownKey === swapKey ? children : held.current}
    </span>
  );
  if (!overlap) return current;
  return (
    <span className="t-text-swap-stack">
      {leaving && <span key={leaving.key} className="t-text-swap-leaving" aria-hidden="true">{leaving.node}</span>}
      {current}
    </span>
  );
};

export default SwapText;
