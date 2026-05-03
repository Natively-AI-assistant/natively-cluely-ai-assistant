import React from "react";
import { motion } from "framer-motion";
import nativelyLogo from "../assets/logo.webp";

const DARK_GLASS = {
  background: "linear-gradient(160deg, rgba(90,90,108,0.88) 0%, rgba(55,55,70,0.93) 50%, rgba(36,36,50,0.97) 100%)",
  boxShadow: "0 4px 12px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.12)",
};

const GLOSS = (
  <div className="absolute inset-x-1 top-0.5 h-[45%] rounded-full bg-gradient-to-b from-white/20 to-white/0 blur-[0.5px] pointer-events-none" />
);

const hotkeys = [
  { label: "What should I answer?", icon: <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6h8M2 3.5h5M2 8.5h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg> },
  { label: "Clarify", icon: <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" /><path d="M6 8V6M6 4h.01" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg> },
  { label: "Follow up questions", icon: <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M10 6H2M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg> },
  { label: "Recap", icon: <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M10 6A4 4 0 112 6M10 6l-1.5-1.5M10 6l1.5-1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg> },
];

interface Props {
  className?: string;
  isMobile?: boolean;
  isStatic?: boolean;
  hidePill?: boolean;
  /** Hide the query bubble and AI response, showing only hotkeys + input */
  hideMessages?: boolean;
  /** Apply dreamy translucent mystical effect */
  dreamyVariant?: boolean;
  /** Spread hotkeys across full width */
  spreadHotkeys?: boolean;
}

const NativelyInterfaceCard = ({ className = "", isMobile = false, isStatic = false, hidePill = false, hideMessages = false, dreamyVariant = false, spreadHotkeys = false }: Props) => {
  const motionProps = isStatic
    ? {
      initial: { opacity: 0, y: 16 },
      whileInView: { opacity: 1, y: 0 },
      viewport: { once: true },
      transition: { duration: 0.7, ease: [0.23, 1, 0.32, 1] as [number, number, number, number] },
    }
    : {
      initial: isMobile ? { opacity: 0, y: 20 } : { opacity: 0, x: "-50%" },
      animate: isMobile ? { opacity: 1, y: 0 } : { opacity: 1, x: "-50%" },
      transition: isMobile
        ? { delay: 2.2, duration: 1, ease: "easeOut" as any }
        : { delay: 5.5, duration: 1.4, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
    };

  return (
    <div className={className} style={{ transform: isStatic ? undefined : (isMobile ? "scale(1)" : "scale(0.85)"), transformOrigin: "top center" }}>
      <motion.div
        {...motionProps}
        className="flex flex-col items-center gap-2 w-full"
      >
        {/* ── TopPill ── */}
        {!hidePill && (
          <div
            className="flex items-center gap-1 rounded-full relative overflow-hidden"
            style={{ background: "linear-gradient(160deg, rgba(90,90,108,0.68) 0%, rgba(55,55,70,0.72) 50%, rgba(36,36,50,0.76) 100%)", backdropFilter: "blur(3px)", padding: "4px", boxShadow: "0 4px 20px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.11)" }}
          >
            <div className="absolute inset-x-1 top-0.5 h-[45%] rounded-full bg-gradient-to-b from-white/20 to-white/0 blur-[0.5px] pointer-events-none" />

            {/* Logo */}
            <div className="w-8 h-8 rounded-full flex items-center justify-center relative overflow-hidden" style={DARK_GLASS}>
              {GLOSS}
              <img src={nativelyLogo} alt="Natively" className="w-[28px] h-[28px] object-contain relative" draggable={false} />
            </div>

            {/* Hide */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-white/75 text-[12px] font-medium tracking-[0.02em] relative overflow-hidden" style={DARK_GLASS}>
              {GLOSS}
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="opacity-70 relative"><path d="M3 7.5L6 4.5L9 7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <span className="relative">Hide</span>
            </div>

            {/* Stop */}
            <div className="w-8 h-8 rounded-full flex items-center justify-center border border-white/15 text-white/50 relative overflow-hidden"
              style={{ background: "linear-gradient(170deg, rgba(60,60,72,0.9) 0%, rgba(25,25,30,0.95) 100%)" }}>
              <div className="absolute inset-x-1 top-0.5 h-[45%] rounded-full bg-gradient-to-b from-white/20 to-transparent pointer-events-none" />
              <div className="w-3 h-3 rounded-[2px] bg-current opacity-90 relative" />
            </div>
          </div>
        )}

        {/* ── Main Panel ── */}
        <div
          className="w-full border overflow-hidden flex flex-col relative"
          style={dreamyVariant ? {
            background: "rgba(255, 255, 255, 0.08)",
            backdropFilter: "blur(30px)",
            borderColor: "rgba(255,255,255,0.15)",
            borderRadius: "20px",
            boxShadow: "inset 0 1px 1px rgba(255,255,255,0.2), 0 20px 40px rgba(0,0,0,0.15)",
          } : {
            ...DARK_GLASS,
            borderRadius: "24px",
            backdropFilter: "blur(3px)",
            borderColor: "rgba(255,255,255,0.2)",
            boxShadow: "0 12px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.12), 0 0 0 0.5px rgba(255,255,255,0.08)",
          }}
        >
          {/* Jelly gloss */}
          <div className="absolute inset-x-0 top-0 h-[42%] pointer-events-none"
            style={{ borderRadius: dreamyVariant ? "20px 20px 0 0" : "24px 24px 0 0", background: dreamyVariant ? "linear-gradient(to bottom, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0) 100%)" : "linear-gradient(to bottom, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0.01) 100%)" }} />

          {/* "What should I answer?" bubble */}
          {!hideMessages && (
            <div className="px-4 pt-4 pb-2 flex justify-end">
              <div className="relative px-4 py-2 rounded-full text-white text-[13px] font-semibold shadow-[0_8px_20px_rgba(37,99,235,0.35)] border border-white/20"
                style={{ background: "linear-gradient(160deg, #5B8EF0 0%, #3B6FE8 50%, #2D5FD4 100%)" }}>
                <div className="absolute top-0.5 left-2 right-2 h-[45%] rounded-full bg-gradient-to-b from-white/70 to-white/5 blur-[0.5px] pointer-events-none" />
                <span className="relative drop-shadow-sm">What should I answer?</span>
              </div>
            </div>
          )}

          {/* AI response */}
          {!hideMessages && (
            <div className="px-4 pb-2">
              <p className="text-white/90 text-[14px] leading-relaxed font-normal whitespace-pre-wrap">
                Based on the project requirements and current timeline, I've outlined the critical path for the next sprint.
              </p>
            </div>
          )}

          {/* Hotkeys */}
          <div className={`flex items-center px-[18px] pb-0 ${hideMessages ? "pt-5" : "pt-[6px]"} w-full ${spreadHotkeys ? "justify-between gap-1" : "gap-2 overflow-x-auto hide-scrollbar scroll-smooth flex-nowrap"}`}>
            {hotkeys.map((a) => (
              <button
                key={a.label}
                className="flex items-center justify-center gap-[5px] px-[12px] py-[6px] rounded-full text-[10px] font-semibold flex-nowrap shrink-0 relative overflow-hidden"
                style={dreamyVariant ? {
                  background: "rgba(255,255,255,0.08)",
                  color: "rgba(255,255,255,0.8)",
                  border: "1px solid rgba(255,255,255,0.15)",
                } : {
                  ...DARK_GLASS,
                  color: "white",
                  border: "1px solid rgba(255,255,255,0.2)",
                }}
              >
                {!dreamyVariant && <div className="absolute top-0.5 left-2 right-2 h-[45%] rounded-full bg-gradient-to-b from-white/20 to-white/0 blur-[0.5px] pointer-events-none" />}
                <span className="relative flex items-center gap-[5px] whitespace-pre">{a.icon} {a.label}</span>
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="px-3 pb-[11px] pt-[7px]">
            <div className="relative">
              <div
                className="w-full border rounded-[12px] px-[13px] py-[9px] text-[12px]"
                style={dreamyVariant ? {
                  background: "rgba(255,255,255,0.06)",
                  borderColor: "rgba(255,255,255,0.15)",
                  color: "rgba(255,255,255,0.6)",
                  fontStyle: "normal"
                } : {
                  background: "rgba(255,255,255,0.05)",
                  borderColor: "rgba(255,255,255,0.1)",
                  color: "rgba(255,255,255,0.3)",
                  fontStyle: "italic"
                }}
              >
                {dreamyVariant ? (
                  <span className="flex items-center gap-1.5">
                    Ask about your screen or conversation, or
                    <kbd className="bg-white/10 px-1.5 py-0.5 rounded text-[10px] border border-white/10 font-sans">⌘</kbd>
                    <kbd className="bg-white/10 px-1.5 py-0.5 rounded text-[10px] border border-white/10 font-sans">↵</kbd>
                    for Assist
                  </span>
                ) : (
                  "Ask anything — Natively knows your resume and this company..."
                )}
              </div>
            </div>
            <div className="flex items-center justify-between mt-[7px] px-[1px]">
              <button
                className="flex items-center gap-[5px] rounded-[7px] px-[9px] py-[4px] text-[10px] font-medium border"
                style={dreamyVariant ? {
                  background: "rgba(255,255,255,0.08)",
                  borderColor: "rgba(255,255,255,0.2)",
                  color: "rgba(255,255,255,0.7)",
                  fontFamily: "var(--font-mono, monospace)"
                } : {
                  background: "rgba(255,255,255,0.05)",
                  borderColor: "rgba(255,255,255,0.1)",
                  color: "rgba(255,255,255,0.5)",
                  fontFamily: "var(--font-mono, monospace)"
                }}
              >
                Natively AI
                <svg width="8" height="8" viewBox="0 0 10 10" fill="none"><path d="M3 4l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
              </button>
              <button className="w-[26px] h-[26px] rounded-full flex items-center justify-center relative overflow-hidden border border-white/20"
                style={{ background: "linear-gradient(160deg, #5B8EF0 0%, #3B6FE8 50%, #2D5FD4 100%)", boxShadow: "0 8px 20px rgba(37,99,235,0.35)" }}>
                <div className="absolute top-0.5 left-1 right-1 h-[45%] rounded-full bg-gradient-to-b from-white/70 to-white/5 blur-[0.5px] pointer-events-none" />
                <svg width="10" height="10" viewBox="0 0 11 11" fill="none"><path d="M2.5 5.5H8.5M6 3l2.5 2.5L6 8" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default NativelyInterfaceCard;
