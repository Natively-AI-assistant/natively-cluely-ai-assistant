// DEV-ONLY visual harness for the streaming code-block fix (see
// StreamingHighlightedCode / CodeStreamLine in NativelyInterface.tsx).
//
// Not part of the shipped app — served only via harness.html, which is not
// referenced from index.html or vite.config.mts's rollup entry, so it is
// never bundled into the production build.
//
// Purpose: flicker, per-line reveal-fade, and pacing are not tsc/unit-
// testable (they're about WHAT PAINTS WHEN, not pure data transforms). This
// drives the REAL exported components with the REAL pacer
// (createPacerState/tickPacer from textRevealPacing.mjs) over a hardcoded
// answer, fed in deliberately bursty chunks — the same "a few characters,
// then a whole sentence" cadence real providers exhibit — so a screenshot
// taken over time is direct evidence of whether the fix behaves, not just
// that its pure helpers pass unit tests.
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { StreamingHighlightedCode } from '../components/NativelyInterface';
import { createPacerState, tickPacer } from '../lib/textRevealPacing.mjs';

// Deliberately includes: prose before the fence, a line with an OPEN quote
// that only closes after more characters arrive (the case the .trim()/
// unclosed-token bug would show up on), multiple lines, and a trailing
// explanation after the fence closes.
const ANSWER =
  "Here's an O(n) approach using a hash map:\n\n" +
  '```python\n' +
  'def two_sum(nums, target):\n' +
  '    seen = {}\n' +
  '    for i, n in enumerate(nums):\n' +
  '        msg = "checking " + str(n)\n' +
  '        if target - n in seen:\n' +
  '            return [seen[target - n], i]\n' +
  '        seen[n] = i\n' +
  '    return []\n' +
  '```\n\n' +
  'This runs in O(n) time and O(n) space.';

// A fixed, module-scope theme object — NOT recreated per render — so the
// harness itself never causes a re-tokenize by accidentally handing
// StreamingHighlightedCode a fresh `appearance`/`codeTheme` object identity
// every tick (that would defeat the exact memoization this fix relies on
// and produce a false-positive "still flickers").
const FIXED_APPEARANCE = {
  codeBlockStyle: { background: '#0d1117' },
  codeHeaderStyle: { background: '#161b22' },
};
const FIXED_CODE_THEME: Record<string, React.CSSProperties> = {
  'code[class*="language-"]': { color: '#c9d1d9' },
  'pre[class*="language-"]': { color: '#c9d1d9' },
  comment: { color: '#8b949e' },
  string: { color: '#a5d6ff' },
  keyword: { color: '#ff7b72' },
  function: { color: '#d2a8ff' },
  number: { color: '#79c0ff' },
};

function Harness() {
  const [text, setText] = useState('');
  const [tickLog, setTickLog] = useState<string[]>([]);
  const pacerRef = useRef(createPacerState());
  const lastTsRef = useRef<number | null>(null);
  const arrivedRef = useRef('');
  const startedAtRef = useRef<number | null>(null);
  const doneLoggedRef = useRef(false);

  useEffect(() => {
    // Simulate bursty token arrival: a chunk of 20-40 chars, then a
    // ~90ms pause, matching the "a few characters, a pause, then a whole
    // sentence" cadence the pacer module's own docs describe as the
    // problem it exists to smooth over.
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let cursor = 0;
    const feed = () => {
      if (cancelled) return;
      const chunkLen = 20 + Math.floor(Math.random() * 20);
      const next = ANSWER.slice(cursor, cursor + chunkLen);
      cursor += chunkLen;
      arrivedRef.current += next;
      if (cursor < ANSWER.length) {
        timeoutId = setTimeout(feed, 90);
      }
    };
    feed();
    return () => {
      cancelled = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    const tick = (ts: number) => {
      if (startedAtRef.current === null) startedAtRef.current = ts;
      const deltaMs = lastTsRef.current === null ? 1000 / 60 : ts - lastTsRef.current;
      lastTsRef.current = ts;
      const fullText = arrivedRef.current;
      const pacer = pacerRef.current;
      const prevLen = pacer.revealedLen;
      tickPacer(pacer, fullText, ts, deltaMs, { reducedMotion: false });
      if (pacer.revealedLen !== prevLen) {
        setText(fullText.slice(0, pacer.revealedLen));
      }
      if (
        !doneLoggedRef.current &&
        pacer.revealedLen >= ANSWER.length &&
        fullText.length >= ANSWER.length
      ) {
        doneLoggedRef.current = true;
        const elapsed = ts - (startedAtRef.current ?? ts);
        setTickLog((log) => [
          ...log,
          `DONE: revealed ${ANSWER.length} chars in ${elapsed.toFixed(0)}ms ` +
            `(~${(ANSWER.length / (elapsed / 1000)).toFixed(1)} chars/sec — cap is 120/sec)`,
        ]);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Extract the still-open fence's code-so-far, the same way
  // renderMessageText does: split on the fence regex, find the fence part,
  // strip the ```lang\n marker — WITHOUT trimming (see the .trim() bug fix
  // comment at the real call site in NativelyInterface.tsx).
  const parts = text.split(/(```[\s\S]*?(?:```|$))/g);
  const fencePart = parts.find((p) => p.startsWith('```'));
  const match = fencePart?.match(/```([\w+#-]*)\s+([\s\S]*?)(?:```|$)/);
  const code = match?.[2] ?? '';
  const lang = match?.[1] ?? 'python';
  const proseBeforeFence = fencePart ? text.slice(0, text.indexOf(fencePart)) : text;
  const proseAfterFence =
    fencePart && text.endsWith('```') ? text.slice(text.indexOf(fencePart) + fencePart.length) : '';

  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif', background: '#0b0e14', minHeight: '100vh', color: '#e6edf3' }}>
      <h2>Streaming code harness</h2>
      <p style={{ opacity: 0.7, fontSize: 13 }}>
        Feeding the fixture in bursty ~20-40 char chunks every ~90ms, painting via the REAL pacer
        (tickPacer, cap 120 chars/sec). Watch for: (1) text appearing gradually, not in one dump;
        (2) completed lines never re-flashing/recoloring; (3) the `msg = "checking..."` line staying
        PLAIN until its closing quote AND newline have both arrived.
      </p>
      <div data-testid="prose-before" style={{ whiteSpace: 'pre-wrap', marginBottom: 8 }}>
        {proseBeforeFence}
      </div>
      {fencePart && (
        <div data-testid="code-block-wrapper">
          <StreamingHighlightedCode
            code={code}
            lang={lang}
            isLightTheme={false}
            codeTheme={FIXED_CODE_THEME}
            codeBlockClass="border-zinc-700"
            codeHeaderClass="border-zinc-700"
            codeHeaderTextClass="text-zinc-400"
            codeLineNumberColor="#6e7681"
            appearance={FIXED_APPEARANCE}
            isModernTheme={false}
            isGlassTheme={false}
            showCodeHeader={true}
          />
        </div>
      )}
      <div data-testid="prose-after" style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>
        {proseAfterFence}
      </div>
      <div data-testid="tick-log" style={{ marginTop: 24, fontSize: 12, opacity: 0.8 }}>
        {tickLog.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
      <div data-testid="raw-revealed-length" style={{ display: 'none' }}>
        {text.length}
      </div>
    </div>
  );
}

const container = document.getElementById('harness-root');
if (container) {
  createRoot(container).render(<Harness />);
}
