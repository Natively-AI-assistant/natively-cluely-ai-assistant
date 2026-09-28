// src/components/onboarding/DemoOverlay.tsx
//
// A working miniature of the in-meeting overlay for the first-launch shortcut
// tour. It is drawn with the overlay's own parts — the real TopPill, the same
// class names and getOverlayAppearance() styles as NativelyInterface — and it
// reacts the way the real one does (traced from NativelyInterface.tsx):
//
//   toggle   The pill and the panel fade out together: 220ms ease-in to
//            opacity 0, y 6, scale 0.98; back in over 340ms ease-out.
//   answer   A "What should I say?" user bubble (or "What should I say about
//            this?" with screenshots attached, which move into the bubble),
//            then the shimmering "Thinking..." label, then the answer revealed
//            word by word (.reveal-word-in).
//   shot     The overlay blinks out while the screen is captured, then the
//            "N screenshot(s) attached" tray appears above the input, 48px
//            thumbnails, at most five.
//
// Nothing here talks to a model or captures the screen: the "screenshot" is
// the current frame of the demo call, and the answers are canned.

import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, ChevronDown, HelpCircle, MessageSquare, Pencil, PointerOff, RefreshCw, SlidersHorizontal, X, Zap } from 'lucide-react';
import TopPill from '../ui/TopPill';
import { getDefaultOverlayOpacity, getOverlayAppearance } from '../../lib/overlayAppearance';

type Msg =
  | { id: number; role: 'user'; text: string; shots?: string[] }
  | { id: number; role: 'answer'; words: string[]; shown: number };

const WHAT_TO_SAY = 'What should I say?';
const WHAT_TO_SAY_SHOT = 'What should I say about this?';
const ANSWERS = [
  'I’d say Docker gives us one environment from a laptop to production. The app ships with its dependencies, so “it works on my machine” stops being a problem.',
  'I’d start with the index: it lets the database jump straight to the rows it needs instead of scanning the whole table, which is what keeps our lookups fast as data grows.',
  'From what’s on screen, I’d point to the numbers in the second column: they’re trending up week over week, and I can walk through what’s driving that.',
];
const SEED: Msg[] = [
  { id: 1, role: 'user', text: WHAT_TO_SAY },
  { id: 2, role: 'answer', words: ANSWERS[0].split(' '), shown: Infinity },
];

// Stands in for the call frame if the canvas cannot be read back (a tainted
// canvas throws on export), so the tray still shows what the shortcut does.
const FALLBACK_SHOT = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#26262b"/>'
  + '<rect x="24" y="24" width="200" height="222" rx="10" fill="#3a3a42"/><rect x="256" y="24" width="200" height="222" rx="10" fill="#33333b"/></svg>',
);

const HIDE = { duration: 0.22, ease: [0.32, 0, 0.67, 0] as const };
const SHOW = { duration: 0.34, ease: [0.23, 1, 0.32, 1] as const };

interface Props {
  isLight: boolean;
  hidden: boolean;
  /** Bump to press What to Answer. */
  answerKey: number;
  /** Bump to take a screenshot. */
  shotKey: number;
  /** Returns the demo "screenshot" (a frame of the call), or null (a stand-in is used). */
  captureFrame: () => string | null;
  /** The selective-screenshot keycaps for the input placeholder. */
  placeholderKeys: string[];
}

export const DemoOverlay: React.FC<Props> = ({ isLight, hidden, answerKey, shotKey, captureFrame, placeholderKeys }) => {
  const reduced = useReducedMotion() ?? false;
  const appearance = getOverlayAppearance(getDefaultOverlayOpacity(), isLight ? 'light' : 'dark');

  const [messages, setMessages] = useState<Msg[]>(SEED);
  const [tray, setTray] = useState<string[]>([]);
  const [blink, setBlink] = useState(false);
  const nextId = useRef(3);
  const answerIndex = useRef(1);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const trayRef = useRef(tray);
  trayRef.current = tray;

  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const after = (ms: number, fn: () => void) => { timers.current.push(setTimeout(fn, ms)); };

  // What to Answer.
  useEffect(() => {
    if (!answerKey) return;
    const shots = trayRef.current;
    const userId = nextId.current++;
    const answerId = nextId.current++;
    const words = ANSWERS[answerIndex.current++ % ANSWERS.length].split(' ');
    setTray([]);
    setMessages(m => [
      ...m.slice(-4),
      { id: userId, role: 'user', text: shots.length ? WHAT_TO_SAY_SHOT : WHAT_TO_SAY, shots: shots.length ? shots : undefined },
      { id: answerId, role: 'answer', words, shown: 0 },
    ]);
    const reveal = (n: number) => {
      setMessages(m => m.map(x => (x.id === answerId && x.role === 'answer' ? { ...x, shown: n } : x)));
      if (n < words.length) after(reduced ? 0 : 45, () => reveal(n + 1));
    };
    after(reduced ? 300 : 1100, () => reveal(reduced ? words.length : 1));
  }, [answerKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Take Screenshot: the overlay steps aside for the capture, then attaches it.
  useEffect(() => {
    if (!shotKey) return;
    setBlink(true);
    after(120, () => {
      const frame = captureFrame() ?? FALLBACK_SHOT;
      setBlink(false);
      setTray(t => [...t, frame].slice(-5));
    });
  }, [shotKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow new text only while the reader is at the bottom, as the overlay
  // does: scrolling up to reread holds still until they scroll back down.
  const atBottom = useRef(true);
  const onScroll = () => {
    const el = scroller.current;
    if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };
  useEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
  }, [messages, reduced]);
  // A new question always brings the view down to it.
  useEffect(() => { if (answerKey) atBottom.current = true; }, [answerKey]);

  const gone = hidden || blink;
  const chip = 'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border whitespace-nowrap shrink-0 overlay-chip-surface overlay-text-interactive';

  return (
    <motion.div
      className="relative flex flex-col items-center gap-2"
      style={{ width: 600, pointerEvents: 'none' }}
      initial={false}
      animate={gone ? { opacity: 0, y: reduced ? 0 : 6, scale: reduced ? 1 : 0.98 } : { opacity: 1, y: 0, scale: 1 }}
      transition={blink ? { duration: 0.05 } : gone ? HIDE : SHOW}
      aria-hidden
    >
      <TopPill expanded={!hidden} onToggle={() => {}} onQuit={() => {}} appearance={appearance} />

      <div
        className="relative max-w-full w-full backdrop-blur-2xl border rounded-[24px] overflow-hidden flex flex-col overlay-shell-surface overlay-shell-container overlay-text-primary"
        style={appearance.shellStyle}
      >
        {/* Messages */}
        {/* Scrollable like the real one; the only part of the demo that takes the pointer. */}
        <div ref={scroller} onScroll={onScroll} className="p-4 space-y-3 overflow-y-auto overscroll-contain" style={{ height: 176, scrollbarWidth: 'none', pointerEvents: gone ? 'none' : 'auto' }}>
          {messages.map(msg => msg.role === 'user' ? (
            <div key={msg.id} className="flex justify-end min-w-0">
              <div className={`max-w-[72%] px-[13.6px] py-[10.2px] text-[15px] leading-relaxed whitespace-pre-wrap rounded-[20px] rounded-tr-[4px] shadow-sm font-medium backdrop-blur-md border ${
                isLight ? 'bg-blue-500/10 border-blue-500/20 text-blue-900' : 'bg-blue-600/20 border-blue-500/30 text-blue-100'
              }`}>
                {msg.shots && (
                  <div className={`mb-2 grid gap-1.5 ${msg.shots.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    {msg.shots.map((s, i) => (
                      <img key={i} src={s} alt="" className="w-full rounded-[14px] border border-white/15 object-cover object-top"
                        style={{ height: msg.shots!.length > 1 ? 74 : 132 }} />
                    ))}
                  </div>
                )}
                {msg.text}
              </div>
            </div>
          ) : (
            <div key={msg.id} className="w-full ai-response-card my-2.5 min-h-[24px] text-[14px] leading-relaxed overlay-text-primary">
              {msg.shown === 0 ? (
                <span className="natively-thinking-label text-[13px]">Thinking...</span>
              ) : (
                msg.words.slice(0, msg.shown).map((w, i) => (
                  <React.Fragment key={i}>{i > 0 && ' '}<span className="reveal-word-in">{w}</span></React.Fragment>
                ))
              )}
            </div>
          ))}
        </div>

        {/* Quick actions, in the overlay's order */}
        <div className="flex flex-wrap justify-center items-center gap-1.5 px-4 pb-3 pt-3">
          <span className={chip} style={appearance.chipStyle}><Pencil className="w-3 h-3 opacity-70" /> What to answer?</span>
          <span className={chip} style={appearance.chipStyle}><MessageSquare className="w-3 h-3 opacity-70" /> Clarify</span>
          <span className={chip} style={appearance.chipStyle}><RefreshCw className="w-3 h-3 opacity-70" /> Recap</span>
          <span className={chip} style={appearance.chipStyle}><HelpCircle className="w-3 h-3 opacity-70" /> Follow Up Question</span>
          <span className={`${chip} justify-center min-w-[74px]`} style={appearance.chipStyle}><Zap className="w-3 h-3 opacity-70" /> Answer</span>
        </div>

        {/* Input area */}
        <div className="p-3 pt-0">
          {tray.length > 0 && (
            <div className="mb-2 rounded-lg p-2 border overlay-subtle-surface" style={appearance.subtleStyle}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-medium overlay-text-primary">
                  {tray.length} screenshot{tray.length > 1 ? 's' : ''} attached
                </span>
                <span className="p-1 rounded-full overlay-icon-surface overlay-text-interactive" style={appearance.iconStyle}>
                  <X className="w-3.5 h-3.5" />
                </span>
              </div>
              <div className="flex gap-1.5 overflow-hidden max-w-full pb-1">
                {tray.map((s, i) => (
                  <motion.img key={i} src={s} alt=""
                    initial={reduced ? false : { opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={SHOW}
                    className={`h-12 w-auto rounded-[10px] border object-cover shadow-sm ${isLight ? 'border-black/15' : 'border-white/20'}`} />
                ))}
              </div>
              <span className="text-[10px] overlay-text-muted">Ask a question or click Answer</span>
            </div>
          )}

          <div className="relative">
            <div className="w-full border rounded-xl pl-3 pr-10 py-2.5 text-[13px] leading-relaxed overlay-input-surface overlay-input-text" style={{ ...appearance.inputStyle, minHeight: 42 }} />
            <div className="absolute inset-x-3 top-1/2 -translate-y-1/2 min-w-0 overflow-hidden whitespace-nowrap text-[13px] overlay-text-muted">
              <span className="inline-flex items-center gap-1.5">
                <span>Ask anything on screen or conversation, or</span>
                <span className="flex items-center gap-1 opacity-80">
                  {placeholderKeys.map((k, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && <span className="text-[10px]">+</span>}
                      <kbd className="px-1.5 py-0.5 rounded border text-[10px] font-sans min-w-[20px] text-center overlay-control-surface overlay-text-secondary" style={appearance.controlStyle}>{k}</kbd>
                    </React.Fragment>
                  ))}
                </span>
                <span>for selective screenshot</span>
              </span>
            </div>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-20 text-[10px]">↵</div>
          </div>

          <div className="flex items-center justify-between mt-3 px-0.5">
            <div className="flex items-center gap-1.5">
              <span className="flex items-center gap-2 px-3 py-1.5 border rounded-lg text-xs font-medium w-[140px] overlay-control-surface overlay-text-interactive" style={appearance.controlStyle}>
                <span className="truncate flex-1">Natively AI</span><ChevronDown size={14} className="opacity-60" />
              </span>
              <span className="w-px h-3 mx-1 overlay-divider-surface" style={appearance.dividerStyle} />
              <span className="w-7 h-7 rounded-lg flex items-center justify-center overlay-icon-surface overlay-text-interactive" style={appearance.iconStyle}><SlidersHorizontal className="w-3.5 h-3.5" /></span>
              <span className="w-7 h-7 rounded-lg flex items-center justify-center overlay-icon-surface overlay-text-interactive" style={appearance.iconStyle}><PointerOff className="w-3.5 h-3.5" /></span>
            </div>
            <span className="w-7 h-7 rounded-full flex items-center justify-center overlay-icon-surface overlay-text-muted" style={appearance.iconStyle}><ArrowRight className="w-3.5 h-3.5" /></span>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
