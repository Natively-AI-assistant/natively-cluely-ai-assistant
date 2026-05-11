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
import { X, ArrowRight, Zap, Mic, Search, Clock } from 'lucide-react';

const STORAGE_KEY      = 'natively_trial_promo_ts';
const PERMS_KEY        = 'natively_perms_shown_v1';
const STARTUP_DELAY_MS = 10_000;
const COOLDOWN_DAYS    = 7;

// ─── Design tokens ────────────────────────────────────────────
const T = {
  font:    '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
  violet:  '#8B5CF6',
  violetB: '#7C3AED',
  violetD: '#5B21B6',
  violetG: 'rgba(139,92,246,0.40)',
  violet2: 'rgba(139,92,246,0.18)',
  t1: '#FFFFFF',
  t2: 'rgba(255,255,255,0.72)',
  t3: 'rgba(255,255,255,0.44)',
  t4: 'rgba(255,255,255,0.24)',
  glass:  'rgba(255,255,255,0.04)',
  rule:   'rgba(255,255,255,0.08)',
};

const GT: React.CSSProperties = {
  background: 'linear-gradient(140deg, #FFFFFF 20%, rgba(196,181,253,0.92) 100%)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
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
  isOpen, hasNativelyKey, hasTrialToken, onDismiss, onStartTrial, onManualSetup,
}) => {
  const [visible,  setVisible]  = useState(false);
  const [starting, setStarting] = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const reduced = useReducedMotion() ?? false;

  useEffect(() => {
    if (!isOpen) { setVisible(false); return; }

    // Don't show if user has a key or trial already
    if (hasNativelyKey || hasTrialToken) return;

    // Don't show on very first launch (permissions toaster shows instead)
    const permsShown = localStorage.getItem(PERMS_KEY);
    if (!permsShown) return;

    // Cooldown check
    const lastShown = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
    if (lastShown && Date.now() - lastShown < COOLDOWN_DAYS * 86_400_000) return;

    const t = setTimeout(() => setVisible(true), STARTUP_DELAY_MS);
    return () => clearTimeout(t);
  }, [isOpen, hasNativelyKey, hasTrialToken]);

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
    setVisible(false);
    onDismiss();
  };

  const handleStartTrial = async () => {
    setStarting(true);
    setError(null);
    try {
      await onStartTrial();
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
      setVisible(false);
    } catch (e: any) {
      setError(e.message || 'Could not start trial. Check your connection.');
      setStarting(false);
    }
  };

  const handleManual = () => {
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
    setVisible(false);
    onManualSetup();
  };

  if (!visible) return null;

  return (
    <AnimatePresence>
      <style>{`
        @keyframes trial-border-flow {
          0%, 100% { background-position: 0% 50%; }
          50%       { background-position: 100% 50%; }
        }
        .trial-border {
          background: linear-gradient(145deg,
            rgba(139,92,246,0.80),
            rgba(109,40,217,0.65),
            rgba(167,139,250,0.72),
            rgba(139,92,246,0.80)
          );
          background-size: 300% 300%;
          animation: trial-border-flow 6s ease infinite;
        }
        .trial-border-reduced {
          background: linear-gradient(145deg, rgba(139,92,246,0.65), rgba(109,40,217,0.5), rgba(167,139,250,0.58));
        }
      `}</style>

      {/* Backdrop */}
      <motion.div
        key="trial-backdrop"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.24 }}
        style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'radial-gradient(ellipse 80% 70% at 50% 50%, rgba(139,92,246,0.08) 0%, rgba(0,0,0,0.84) 100%)',
          backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        } as React.CSSProperties}
        onClick={e => { if (e.target === e.currentTarget) handleDismiss(); }}
      >
        {/* Border wrapper */}
        <motion.div
          key="trial-card"
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.93, y: 22, filter: 'blur(10px)' }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1,    y: 0,  filter: 'blur(0px)' }}
          exit={   reduced ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 14, filter: 'blur(4px)' }}
          transition={{ type: 'spring', stiffness: 290, damping: 25, mass: 0.82 }}
          className={reduced ? 'trial-border-reduced' : 'trial-border'}
          style={{ padding: '1.5px', borderRadius: '23px', boxShadow: '0 48px 120px -20px rgba(0,0,0,0.95), 0 0 80px rgba(139,92,246,0.07)' }}
        >
          <div style={{
            position: 'relative', width: '452px', borderRadius: '22px', overflow: 'hidden',
            background: 'linear-gradient(155deg, rgba(11,8,20,0.99) 0%, rgba(6,5,12,1) 100%)',
            fontFamily: T.font,
          }}>
            {/* Catch-light */}
            <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '1px', background: 'rgba(255,255,255,0.12)', pointerEvents: 'none', zIndex: 5 }} />

            {/* Aurora — violet pulse */}
            {!reduced && (
              <motion.div aria-hidden
                animate={{ opacity: [0.1, 0.22, 0.1] }}
                transition={{ duration: 6.5, repeat: Infinity, ease: 'easeInOut' }}
                style={{ position: 'absolute', top: '-110px', left: '50%', transform: 'translateX(-50%)', width: '460px', height: '320px', background: 'radial-gradient(ellipse, rgba(139,92,246,0.35) 0%, transparent 62%)', pointerEvents: 'none', zIndex: 1 }}
              />
            )}

            {/* Grain */}
            <div aria-hidden style={{
              position: 'absolute', inset: 0, borderRadius: '22px', pointerEvents: 'none', zIndex: 4, opacity: 0.028, mixBlendMode: 'overlay',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)'/%3E%3C/svg%3E")`,
              backgroundSize: '180px 180px',
            }} />

            <div style={{ padding: '28px 30px 30px', position: 'relative', zIndex: 6 }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '26px', paddingBottom: '16px', borderBottom: `1px solid ${T.rule}` }}>
                <span style={{ fontSize: '10.5px', fontWeight: 660, letterSpacing: '0.15em', textTransform: 'uppercase', color: T.t2 }}>
                  Natively API
                </span>
                <button onClick={handleDismiss} aria-label="Dismiss"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', opacity: 0.35, padding: 0, transition: 'opacity 150ms, background 150ms' }}
                  onMouseEnter={e => { e.currentTarget.style.opacity = '0.8'; e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = '0.35'; e.currentTarget.style.background = 'transparent'; }}>
                  <X size={13} strokeWidth={2.3} color="#fff" />
                </button>
              </div>

              <motion.div variants={STAGGER} initial="hidden" animate="show" style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>

                {/* Hero — large "10" number */}
                <motion.div variants={ITEM} style={{ textAlign: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: '10px', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                      {/* Pulsing clock icon above number */}
                      {!reduced && (
                        <motion.div
                          animate={{ opacity: [0.6, 1, 0.6] }}
                          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                          style={{ position: 'absolute', marginTop: '-8px' }}
                        />
                      )}
                      <span style={{
                        fontSize: '88px', fontWeight: 800, lineHeight: 1, letterSpacing: '-0.055em',
                        color: T.violet, fontFamily: T.font,
                        textShadow: `0 0 64px ${T.violetG}, 0 0 120px rgba(139,92,246,0.2)`,
                      }}>
                        10
                      </span>
                      <div style={{ paddingBottom: '14px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: '2px' }}>
                        <span style={{ fontSize: '16px', fontWeight: 700, color: 'rgba(167,139,250,0.9)', letterSpacing: '-0.02em', lineHeight: 1 }}>min</span>
                        <span style={{ fontSize: '10px', fontWeight: 600, color: T.t4, textTransform: 'uppercase', letterSpacing: '0.1em' }}>free</span>
                      </div>
                    </div>
                  </div>

                  <h2 style={{ ...GT, fontSize: '21px', fontWeight: 720, letterSpacing: '-0.03em', lineHeight: 1.2, margin: '0 0 9px' }}>
                    Try everything. No card needed.
                  </h2>
                  <p style={{ fontSize: '13px', lineHeight: 1.66, color: T.t3, margin: '0 auto', maxWidth: '330px' }}>
                    Full Natively API access — AI chat, meeting transcription, and company research — free for 10 minutes. Bound to this device. No sign-in.
                  </p>
                </motion.div>

                {/* Feature chips */}
                <motion.div variants={ITEM}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                    {[
                      { icon: Zap,    label: 'AI Chat',       sub: '10 requests' },
                      { icon: Mic,    label: 'Transcription', sub: '10 min STT' },
                      { icon: Search, label: 'Research',      sub: '2 searches' },
                    ].map(({ icon: Icon, label, sub }) => (
                      <div key={label} style={{
                        padding: '12px 14px', borderRadius: '12px',
                        background: T.glass, border: `1px solid ${T.rule}`,
                        display: 'flex', flexDirection: 'column', gap: '6px',
                        position: 'relative', overflow: 'hidden',
                      }}>
                        {/* Violet top accent stripe */}
                        <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: 'linear-gradient(90deg, rgba(139,92,246,0.7), transparent 70%)' }} />
                        <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: T.violet2, border: '1px solid rgba(139,92,246,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Icon size={13} strokeWidth={1.8} color={T.violet} />
                        </div>
                        <div>
                          <div style={{ fontSize: '12px', fontWeight: 620, color: T.t1, letterSpacing: '-0.01em', fontFamily: T.font }}>{label}</div>
                          <div style={{ fontSize: '10.5px', color: T.t4, marginTop: '1px', fontFamily: T.font }}>{sub}</div>
                        </div>
                      </div>
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
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: T.t4, fontFamily: T.font, padding: '4px 0', width: '100%', textAlign: 'center', transition: 'color 150ms' }}
                    onMouseEnter={e => (e.currentTarget.style.color = T.t3)}
                    onMouseLeave={e => (e.currentTarget.style.color = T.t4)}
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
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      whileHover={reduced || disabled ? {} : { scale: 1.012, filter: 'brightness(1.06)' }}
      whileTap={{ scale: 0.983 }}
      style={{
        position: 'relative', width: '100%', height: '54px', overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 22px', borderRadius: '14px', border: 'none',
        background: disabled
          ? 'rgba(139,92,246,0.3)'
          : 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 50%, #6D28D9 100%)',
        boxShadow: disabled ? 'none' : `0 0 0 1px rgba(109,40,217,0.45), 0 10px 32px rgba(139,92,246,0.38), inset 0 1px 0 rgba(255,255,255,0.16)`,
        cursor: disabled ? 'wait' : 'pointer', fontFamily: T.font, outline: 'none',
        opacity: disabled ? 0.65 : 1,
      }}
    >
      {/* Shimmer */}
      {!reduced && !disabled && (
        <motion.div aria-hidden
          style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.12) 50%, transparent 100%)',
            transform: 'skewX(-14deg)',
          }}
          animate={{ x: ['-130%', '230%'] }}
          transition={{ duration: 1.8, ease: 'easeInOut', repeat: Infinity, repeatDelay: 5.5 }}
        />
      )}
      <span style={{ position: 'relative', zIndex: 1, fontSize: '14px', fontWeight: 660, color: '#fff', letterSpacing: '-0.016em' }}>
        {label}
      </span>
      <motion.span
        style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center' }}
        animate={reduced ? {} : { x: hovered ? 4 : 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        <ArrowRight size={16} strokeWidth={2.4} color="rgba(255,255,255,0.9)" />
      </motion.span>
    </motion.button>
  );
};
