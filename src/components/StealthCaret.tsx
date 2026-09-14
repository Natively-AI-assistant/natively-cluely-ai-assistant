import React, { useEffect, useRef, useState } from 'react';
import { computeStealthCaretLeft, measureTextWidth } from '../lib/stealthCaretPosition.mjs';

/**
 * The blinking caret the Windows overlay input cannot draw for itself.
 *
 * See src/lib/stealthCaretPosition.mjs for why this exists and why pinning it
 * to the end of the value is exact rather than approximate. This component is
 * rendered ONLY on win32 while a stealth-typing session is engaged; macOS
 * renders nothing and keeps Chromium's own caret, untouched.
 *
 * It must be a sibling of the <input>, inside a positioned ancestor (the
 * `relative` wrapper that already carries data-stealth-engage).
 */

// Chromium's own caret cadence. Matching it is the whole point — a caret that
// blinks at a different rate than every other text field on the machine reads
// as "something is wrong" even when the user can't say what.
const BLINK_MS = 530;

interface StealthCaretProps {
  /** The input this caret belongs to. Structural, so any ref flavour fits. */
  inputRef: { current: HTMLInputElement | null };
  /** Current value — drives both the measurement and the blink reset. */
  value: string;
  /** Whether a stealth-typing session is engaged. */
  active: boolean;
}

export const StealthCaret: React.FC<StealthCaretProps> = ({ inputRef, value, active }) => {
  const [left, setLeft] = useState<number | null>(null);
  const [height, setHeight] = useState(16);
  const [on, setOn] = useState(true);
  // Bumped on every value change so the blink restarts solid, the way a real
  // caret does while you type — a caret caught mid-blink as a character lands
  // looks like a dropped keystroke.
  const blinkEpoch = useRef(0);

  useEffect(() => {
    if (!active) return;
    const el = inputRef.current;
    if (!el) return;

    const style = window.getComputedStyle(el);
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingRight = parseFloat(style.paddingRight) || 0;
    const contentWidth = Math.max(0, el.clientWidth - paddingLeft - paddingRight);
    const textWidth = measureTextWidth(value, style.font);

    // An unfocused input never scrolls itself to reveal the insertion point, so
    // a long question would keep growing off the right edge with the user
    // staring at its beginning. Drive it manually: keep the tail visible, which
    // is also the assumption computeStealthCaretLeft's overflow branch makes.
    if (textWidth > contentWidth) {
      el.scrollLeft = el.scrollWidth;
    } else if (el.scrollLeft !== 0) {
      el.scrollLeft = 0;
    }

    setLeft(computeStealthCaretLeft({ textWidth, paddingLeft, contentWidth }));
    // Track the real line box rather than hardcoding: the overlay's font size
    // follows the user's Appearance settings.
    const lineHeight = parseFloat(style.lineHeight);
    const fontSize = parseFloat(style.fontSize) || 13;
    setHeight(Number.isFinite(lineHeight) ? lineHeight : fontSize * 1.35);

    blinkEpoch.current += 1;
    setOn(true);
  }, [value, active, inputRef]);

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setOn((v) => !v), BLINK_MS);
    return () => window.clearInterval(id);
    // blinkEpoch in the dep list restarts the interval on each keystroke so the
    // solid phase above gets a full BLINK_MS, instead of being cut short by an
    // interval that happened to be about to fire.
  }, [active, blinkEpoch.current]);

  if (!active || left === null) return null;

  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute top-1/2 -translate-y-1/2"
      style={{
        left,
        width: 1.5,
        height,
        // currentColor would resolve against the wrapper, not the input's own
        // resolved text colour (which Appearance settings can override).
        background: 'currentColor',
        opacity: on ? 0.85 : 0,
        // No CSS transition: a caret is a hard on/off. Fading one in and out
        // reads as a glow effect rather than a text cursor.
        borderRadius: 1,
      }}
    />
  );
};
