import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MousePointer2 } from 'lucide-react';

/**
 * The overlay's click-through (mouse passthrough) button.
 *
 * Once click-through is on nothing on the overlay can be clicked — including
 * this button — so the hotkey is the only way back out, and the button's job
 * is to teach it at the moment it is needed. On the off→on transition the bare
 * icon opens into a pill carrying the exit shortcut (`Ctrl Shift B to exit`),
 * holds for `settleMs`, then closes back to the bare icon in the accent
 * colour, which stays as the only trace of the mode. Turning off collapses it
 * at once. No bar, no dot (owner's call; see the pill mocks of 2026-10-01).
 *
 * The pill opens to exactly the width its label needs, measured from the
 * label itself: a fixed width clipped "to exit" on Windows, where the key caps
 * read `Ctrl` `Shift` rather than `⌘` `⇧`.
 *
 * Styling lives in index.css (`.ov-ct*`): the idle state is the toolbar's
 * bare icon (`overlay-bare-icon`); edge strength is a per-theme token because
 * a 42% accent line is right on the dark panels and a hard navy rule on the
 * pale light shell.
 */
export interface ClickThroughToggleProps {
  on: boolean;
  onToggle: () => void;
  /** Display keys of the exit shortcut, e.g. ['Ctrl', 'Shift', 'B']. */
  keys: string[];
  /** The words after the keys, e.g. t('to exit'). */
  exitLabel: string;
  ariaLabel: string;
  /** How long the pill stays open after turning on. */
  settleMs?: number;
}

type Phase = 'off' | 'expanded' | 'settled';

/** 8 left pad + 14 icon + 7 gap + label + 9 right pad. */
export const CLICK_THROUGH_PILL_CHROME_PX = 38;

const ClickThroughToggle: React.FC<ClickThroughToggleProps> = ({
  on,
  onToggle,
  keys,
  exitLabel,
  ariaLabel,
  settleMs = 3000,
}) => {
  const [phase, setPhase] = useState<Phase>(on ? 'settled' : 'off');
  const [labelWidth, setLabelWidth] = useState(0);
  const labelRef = useRef<HTMLSpanElement>(null);
  const wasOn = useRef(on);

  // off→on opens the pill; on→off closes it. Either source — the button or
  // the global hotkey — goes through `on`, so both get the same reveal.
  useEffect(() => {
    const turnedOn = on && !wasOn.current;
    wasOn.current = on;
    if (!on) {
      setPhase('off');
      return;
    }
    if (!turnedOn) return;
    setPhase('expanded');
    const timer = setTimeout(() => setPhase('settled'), settleMs);
    return () => clearTimeout(timer);
  }, [on, settleMs]);

  // The label is always laid out (just transparent), so it can be measured
  // whenever its contents change — the caps change with the platform and the
  // user's own binding.
  useLayoutEffect(() => {
    const el = labelRef.current;
    if (!el) return;
    const measure = () => setLabelWidth(Math.ceil(el.getBoundingClientRect().width));
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => observer?.disconnect();
  }, [keys, exitLabel]);

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      aria-label={ariaLabel}
      data-state={on ? 'on' : undefined}
      data-phase={phase}
      className="ov-ct w-7 h-7 rounded-[9px] flex items-center interaction-base interaction-press overlay-bare-icon"
      style={{ ['--ov-ct-w' as string]: `${labelWidth + CLICK_THROUGH_PILL_CHROME_PX}px` }}
    >
      {/* The dashed cursor: the pointer passes through. */}
      <MousePointer2 className="w-3.5 h-3.5 shrink-0" strokeDasharray="3 2.2" aria-hidden />
      <span ref={labelRef} className="ov-ct-label" aria-hidden>
        {keys.map((key, i) => (
          <kbd key={i} className="ov-ct-key">{key}</kbd>
        ))}
        <span className="ov-ct-exit">{exitLabel}</span>
      </span>
    </button>
  );
};

export default ClickThroughToggle;
