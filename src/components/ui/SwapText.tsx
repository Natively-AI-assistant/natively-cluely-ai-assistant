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
 *  the swap span itself is inline-block. */
const SwapText: React.FC<{
  swapKey: string;
  children: React.ReactNode;
  /** Called with the key whose content is now on screen (after the exit). */
  onShown?: (key: string) => void;
}> = ({ swapKey, children, onShown }) => {
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
    setPhase('exit');
    const t = setTimeout(() => {
      setShownKey(swapKey);
      setPhase('enter');
    }, cssMs(ref.current, '--text-swap-dur', 150));
    return () => clearTimeout(t);
  }, [swapKey, shownKey]);
  useLayoutEffect(() => {
    if (phase !== 'enter') return;
    void ref.current?.offsetHeight; // reflow: start from below, then transition back
    setPhase('idle');
  }, [phase]);
  const cls = phase === 'exit' ? ' is-exit' : phase === 'enter' ? ' is-enter-start' : '';
  return (
    <span ref={ref} className={`t-text-swap${cls}`}>
      {shownKey === swapKey ? children : held.current}
    </span>
  );
};

export default SwapText;
