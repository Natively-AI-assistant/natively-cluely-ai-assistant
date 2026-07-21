// src/components/trial/TrialPromoToaster.tsx
//
// Skills: ui-ux-pro-max · ui-design-system · canvas-designer · frontend-design · ux-researcher-designer
//
// Premium Apple-inspired trial offer card.
// Shows 5 seconds after launcher is visible on non-first launches,
// when no Natively API key is stored and no trial is active.
// Violet/purple accent — consistent with the trial brand throughout the app.

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { X, ArrowRight, MessageSquareCode, AudioLines, Compass } from 'lucide-react';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';

const PERMS_KEY        = 'natively_perms_shown_v1';

// ─── Design tokens ────────────────────────────────────────────
const T = {
  font:    '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
  violet:  '#8B5CF6',
  violetB: '#7C3AED',
  violetD: '#5B21B6',
  violetG: 'rgba(139,92,246,0.35)',
  violet2: 'rgba(139,92,246,0.14)',
};

const STAGGER = { hidden: {}, show: { transition: { staggerChildren: 0.07, delayChildren: 0.12 } } };
const ITEM    = {
  hidden: { opacity: 0, y: 14, filter: 'blur(4px)' },
  show:   { opacity: 1, y: 0,  filter: 'blur(0px)', transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as any } },
};

interface Props {
  isOpen:         boolean;
  hasNativelyKey: boolean;
  hasTrialToken:  boolean;
  onDismiss:      () => void;
  onStartTrial:   () => Promise<void>;
  onManualSetup:  () => void;   // dismiss + open settings
}

export const TrialPromoToaster: React.FC<Props> = ({
  isOpen, hasNativelyKey: _hasNativelyKey, hasTrialToken: _hasTrialToken, onDismiss, onStartTrial, onManualSetup,
}) => {
  const [visible,  setVisible]  = useState(false);
  const [starting, setStarting] = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const reduced = useReducedMotion() ?? false;
  const isLight = useResolvedTheme() === 'light';

  const t1 = isLight ? '#111111' : '#FFFFFF';
  const t2 = isLight ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.85)';
  const t3 = isLight ? 'rgba(0,0,0,0.58)' : 'rgba(255,255,255,0.5)';
  const t4 = isLight ? 'rgba(0,0,0,0.38)' : 'rgba(255,255,255,0.28)';
  const rule = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)';
  const glass = isLight ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.02)';

  const GT: React.CSSProperties = {
    background: isLight 
      ? 'linear-gradient(140deg, #111111 20%, #7C3AED 100%)'
      : 'linear-gradient(140deg, #FFFFFF 20%, #C4B5FD 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  };

  useEffect(() => {
    if (!isOpen) { setVisible(false); return; }
    // Pure presentational: orchestrator has already gated on key/token/perms.
    // Just become visible.
    setVisible(true);
  }, [isOpen]);

  const handleDismiss = () => {
    setVisible(false);
    onDismiss();
  };

  const handleStartTrial = async () => {
    setStarting(true);
    setError(null);
    try {
      await onStartTrial();
      setVisible(false);
    } catch (e: any) {
      setError(e.message || 'Could not start trial. Check your connection.');
      setStarting(false);
    }
  };

  const handleManual = () => {
    setVisible(false);
    onManualSetup();
  };

  if (!visible) return null;

  return (
    <AnimatePresence>
      {/* Backdrop */}
      <motion.div
        key="trial-backdrop"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.24 }}
        style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: isLight 
            ? 'radial-gradient(ellipse 80% 70% at 50% 50%, rgba(139,92,246,0.04) 0%, rgba(0,0,0,0.3) 100%)'
            : 'radial-gradient(ellipse 80% 70% at 50% 50%, rgba(139,92,246,0.08) 0%, rgba(0,0,0,0.84) 100%)',
          backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        } as React.CSSProperties}
        onClick={e => { if (e.target === e.currentTarget) handleDismiss(); }}
      >
        {/* Core Outer Wrapper — Borderless Bento Grid container */}
        <motion.div
          key="trial-card"
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.93, y: 22, filter: 'blur(10px)' }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1,    y: 0,  filter: 'blur(0px)' }}
          exit={   reduced ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 14, filter: 'blur(4px)' }}
          transition={{ type: 'spring', stiffness: 290, damping: 25, mass: 0.82 }}
          style={{ 
            padding: '0px', 
            borderRadius: '28px', 
            background: 'none',
            border: 'none',
            boxShadow: isLight
              ? '0 32px 64px -16px rgba(0, 0, 0, 0.12), 0 8px 32px -8px rgba(0, 0, 0, 0.04)'
              : '0 48px 120px -20px rgba(0,0,0,0.9), 0 0 80px rgba(139,92,246,0.03)'
          }}
        >
          {/* Inner Core Enclosure */}
          <div style={{
            position: 'relative', width: '468px', borderRadius: '22px', overflow: 'hidden',
            background: isLight 
              ? 'linear-gradient(155deg, #FAF9F6 0%, #FFFFFF 100%)'
              : 'linear-gradient(155deg, #1E1E24 0%, #121215 100%)',
            border: 'none',
            fontFamily: T.font,
          }}>

            {/* Aurora — violet pulse */}
            {!reduced && (
              <motion.div aria-hidden
                animate={{ opacity: isLight ? [0.06, 0.14, 0.06] : [0.1, 0.22, 0.1] }}
                transition={{ duration: 6.5, repeat: Infinity, ease: 'easeInOut' }}
                style={{ position: 'absolute', top: '-120px', left: '50%', transform: 'translateX(-50%)', width: '420px', height: '280px', background: 'radial-gradient(ellipse, rgba(139,92,246,0.22) 0%, transparent 65%)', pointerEvents: 'none', zIndex: 1 }}
              />
            )}

            {/* Fine Organic Grain */}
            <div aria-hidden style={{
              position: 'absolute', inset: 0, borderRadius: '22px', pointerEvents: 'none', zIndex: 4, opacity: isLight ? 0.012 : 0.024, mixBlendMode: 'overlay',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)'/%3E%3C/svg%3E")`,
              backgroundSize: '180px 180px',
            }} />

            <div style={{ padding: '28px 24px 26px', position: 'relative', zIndex: 6 }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '22px', paddingBottom: '16px' }}>
                <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: t3 }}>
                  Natively Trial
                </span>
                <button onClick={handleDismiss} aria-label="Dismiss"
                  style={{ 
                    background: 'none', border: 'none', cursor: 'pointer', width: '26px', height: '26px', 
                    display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', 
                    opacity: 0.35, padding: 0, transition: 'opacity 150ms, background 150ms' 
                  }}
                  onMouseEnter={e => { e.currentTarget.style.opacity = '0.8'; e.currentTarget.style.background = isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)'; }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = '0.35'; e.currentTarget.style.background = 'transparent'; }}>
                  <X size={13} strokeWidth={2.2} color={isLight ? '#000' : '#fff'} />
                </button>
              </div>

              <motion.div variants={STAGGER} initial="hidden" animate="show" style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>

                {/* Hero — large "10" number */}
                <motion.div variants={ITEM} style={{ textAlign: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'stretch', justifyContent: 'center', gap: '5px', marginBottom: '16px' }}>
                    <span style={{
                      fontSize: '72px', fontWeight: 800, lineHeight: 1, letterSpacing: '-0.055em',
                      color: isLight ? '#7C3AED' : '#A78BFA', fontFamily: T.font,
                      textShadow: isLight
                        ? `0 0 48px rgba(124,58,237,0.18)`
                        : `0 0 64px rgba(139,92,246,0.3), 0 0 120px rgba(139,92,246,0.1)`,
                    }}>
                      10
                    </span>
                    {/* Stacked label column — tight stack at bottom */}
                    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: '3px', paddingBottom: '6px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: isLight ? '#7C3AED' : 'rgba(167,139,250,0.9)', letterSpacing: '0.08em', lineHeight: 1, textTransform: 'uppercase' }}>min</span>
                      <span style={{ fontSize: '10px', fontWeight: 600, color: t4, textTransform: 'uppercase', letterSpacing: '0.12em', lineHeight: 1 }}>free</span>
                    </div>
                  </div>

                  <h2 style={{ ...GT, fontSize: '21px', fontWeight: 720, letterSpacing: '-0.03em', lineHeight: 1.2, margin: '0 0 9px' }}>
                    Try everything. No card needed.
                  </h2>
                  <p style={{ fontSize: '13px', lineHeight: 1.66, color: t3, margin: '0 auto', maxWidth: '330px' }}>
                    Full Natively API access — AI chat, meeting transcription, and company research — free for 10 minutes. Bound to this device. No sign-in.
                  </p>
                </motion.div>

                {/* Feature chips */}
                <motion.div variants={ITEM}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                    {[
                      { icon: MessageSquareCode, label: 'AI Chat',       sub: '10 requests' },
                      { icon: AudioLines,        label: 'Transcription', sub: '10 min STT' },
                      { icon: Compass,           label: 'Research',      sub: '2 searches' },
                    ].map(({ icon: Icon, label, sub }) => (
                      <motion.div 
                        key={label}
                        whileHover={reduced ? {} : { scale: 1.03, y: -2 }}
                        whileTap={reduced ? {} : { scale: 0.97 }}
                        style={{
                          flex: 1,
                          padding: '12px 10px',
                          borderRadius: '16px',
                          border: isLight ? '1px solid rgba(139,92,246,0.22)' : '1px solid rgba(139,92,246,0.3)',
                          background: isLight
                            ? 'linear-gradient(135deg, rgba(139,92,246,0.08) 0%, rgba(255, 255, 255, 0.8) 100%)'
                            : 'linear-gradient(135deg, rgba(139,92,246,0.12) 0%, rgba(15, 23, 42, 0.6) 100%)',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '8px',
                          position: 'relative',
                          overflow: 'hidden',
                          cursor: 'default',
                          boxShadow: isLight
                            ? 'inset 0 1px 0 rgba(255,255,255,0.8), 0 2px 8px rgba(139,92,246,0.05)'
                            : 'inset 0 1px 0 rgba(255,255,255,0.08), 0 4px 12px rgba(0,0,0,0.3)',
                        }}
                      >
                        {/* Specular Gloss Sheen Overlay */}
                        <span style={{ 
                          position: 'absolute', inset: 0, borderRadius: 'inherit',
                          background: isLight
                            ? 'linear-gradient(135deg, rgba(255,255,255,0.65) 0%, rgba(255,255,255,0.01) 45%, rgba(0,0,0,0.01) 100%)'
                            : 'linear-gradient(135deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.01) 45%, rgba(0,0,0,0.06) 100%)', 
                          pointerEvents: 'none', zIndex: 10,
                        }} />

                        {/* Icon container */}
                        <div style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '10px',
                          background: 'rgba(139, 92, 246, 0.12)',
                          border: '1px solid rgba(139, 92, 246, 0.2)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          zIndex: 20,
                        }}>
                          <Icon size={15} color={T.violet} strokeWidth={2.4} />
                        </div>

                        <div style={{ zIndex: 20, textAlign: 'center' }}>
                          <div style={{ fontSize: '11px', fontWeight: 800, color: t1, lineHeight: 1.25, letterSpacing: '-0.01em', fontFamily: T.font }}>{label}</div>
                          <div style={{ fontSize: '9px', fontWeight: 600, color: t3, lineHeight: 1.3, marginTop: '3px', fontFamily: T.font }}>{sub}</div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>

                {/* CTAs */}
                <motion.div variants={ITEM} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <VioletCTA
                    label={starting ? 'Starting trial…' : 'Start free trial'}
                    onClick={handleStartTrial}
                    disabled={starting}
                    reduced={reduced}
                  />
                  {error && (
                    <p style={{ fontSize: '11px', color: 'rgba(248,113,113,0.85)', textAlign: 'center', margin: 0, fontFamily: T.font }}>
                      {error}
                    </p>
                  )}
                  <button onClick={handleManual}
                    style={{ 
                      background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: t4, 
                      fontFamily: T.font, padding: '4px 0', width: '100%', textAlign: 'center', transition: 'color 150ms' 
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = t3)}
                    onMouseLeave={e => (e.currentTarget.style.color = t4)}
                  >
                    I'll set up manually
                  </button>
                </motion.div>
              </motion.div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

// ─── Violet CTA button ────────────────────────────────────────
const VioletCTA: React.FC<{ label: string; onClick: () => void; disabled: boolean; reduced: boolean }> = ({ label, onClick, disabled, reduced }) => {
  const [hovered, setHovered] = useState(false);
  const isLight = useResolvedTheme() === 'light';

  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      whileHover={reduced || disabled ? {} : { scale: 1.015, y: -1 }}
      whileTap={{ scale: 0.985 }}
      style={{
        position: 'relative', width: '100%', height: '50px', overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        paddingLeft: '22px', paddingRight: '22px', borderRadius: '16px', border: 'none',
        background: disabled
          ? 'rgba(139,92,246,0.3)'
          : 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 50%, #6D28D9 100%)',
        boxShadow: disabled 
          ? 'none' 
          : isLight
            ? `inset 0 4px 5px rgba(255, 255, 255, 0.6), inset 0 -4px 5px rgba(0, 0, 0, 0.15), 0 8px 24px rgba(124, 58, 237, 0.25)`
            : `inset 0 4px 5px rgba(255, 255, 255, 0.25), inset 0 -5px 6px rgba(0, 0, 0, 0.45), 0 10px 32px rgba(139, 92, 246, 0.38)`,
        cursor: disabled ? 'wait' : 'pointer', fontFamily: T.font, outline: 'none',
        opacity: disabled ? 0.65 : 1,
      }}
    >
      {/* 3D Jelly Gloss Highlight overlay */}
      {!disabled && (
        <span style={{ 
          position: 'absolute', top: '2px', left: '8px', right: '8px', height: '35%', 
          borderRadius: '9999px', background: 'linear-gradient(180deg, rgba(255,255,255,0.65) 0%, rgba(255,255,255,0.05) 100%)', 
          filter: 'blur(0.3px)', pointerEvents: 'none', zIndex: 4
        }} />
      )}

      {/* Shimmer */}
      {!reduced && !disabled && (
        <motion.div aria-hidden
          style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.1) 50%, transparent 100%)',
            transform: 'skewX(-14deg)',
            zIndex: 2
          }}
          animate={{ x: ['-130%', '230%'] }}
          transition={{ duration: 1.8, ease: 'easeInOut', repeat: Infinity, repeatDelay: 5.5 }}
        />
      )}
      <span style={{ position: 'relative', zIndex: 3, fontSize: '13.5px', fontWeight: 750, color: '#fff', letterSpacing: '-0.015em' }}>
        {label}
      </span>
      
      {/* Trailing Icon (Button-in-Button Pattern) */}
      {!disabled && (
        <div style={{
          position: 'absolute', right: '10px', top: '50%', zIndex: 3,
          width: '32px', height: '32px', borderRadius: '50%',
          background: 'rgba(255,255,255,0.16)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.2), 0 2px 4px rgba(0,0,0,0.06)',
          transition: 'transform 200ms ease',
          transform: hovered ? 'translateY(-50%) scale(1.05) translateX(2px)' : 'translateY(-50%) scale(1) translateX(0)',
        }}>
          <ArrowRight size={14} strokeWidth={2.4} color="#fff" />
        </div>
      )}
    </motion.button>
  );
};
