// src/components/onboarding/BrowserExtensionToaster.tsx
//
// Skills: ui-ux-pro-max · ui-design-system · frontend-design
//
// Claymorphic "install the browser extension" nudge.
// Shown ONCE per install/update to v2.8.0+ when the Natively browser
// extension is not yet connected. Indigo accent to differentiate from
// the violet trial and coral support toasters.
//
// Self-contained: no props. Gates via toasterGating + a permanent
// localStorage dismiss flag. Auto-dismisses silently the moment the
// extension connects while visible.
//
// Chrome Web Store URL canonical source: src/components/settings/HelpSettings.tsx
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { X, ArrowRight } from 'lucide-react';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { BrowserExtensionIcon } from './BrowserExtensionIcon';

const DISMISS_KEY         = 'natively_ext_connect_dismissed_v1';
const MIN_VERSION         = '2.8.0';

// Canonical Chrome Web Store URL (also in HelpSettings.tsx).
const CHROME_STORE_URL =
  'https://chromewebstore.google.com/detail/lmhgnkbjnelmciecjkleaomjpejcgaln?utm_source=item-share-cb';

// ─── Design tokens ────────────────────────────────────────────
const T = {
  font:   '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
  indigo: '#6366F1',
  indigoB:'#4F46E5',
  indigoD:'#4338CA',
  indigoG:'rgba(99,102,241,0.35)',
  indigo2:'rgba(99,102,241,0.14)',
};

const STAGGER = { hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } } };
const ITEM    = {
  hidden: { opacity: 0, y: 14, filter: 'blur(4px)' },
  show:   { opacity: 1, y: 0,  filter: 'blur(0px)', transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as any } },
};

// ─── Custom hero icon: simplified browser frame with extension piece ──
// Reads instantly as "browser extension" — the affordance Chrome itself uses
// for extension install UI. Avoids the generic-Puzzle / AI-piece metaphor.
// (Imported from BrowserExtensionIcon so PhoneMirrorSettings can reuse it.)
const BrowserExtensionHeroIcon: React.FC<{ size?: number }> = ({ size = 64 }) => (
  <BrowserExtensionIcon color={T.indigo} size={size} />
);

// Tiny inline semver compare (only major.minor.patch).
function versionGte(a: string, b: string): boolean {
  const pa = a.split('.').map(n => parseInt(n, 10));
  const pb = b.split('.').map(n => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return true;
    if (na < nb) return false;
  }
  return true;
}

interface Props {
  isOpen:    boolean;
  onDismiss: () => void;
  onSkip?:   () => void;
}

export const BrowserExtensionToaster: React.FC<Props> = ({ isOpen, onDismiss, onSkip: _onSkip }) => {
  const [opening, setOpening]     = useState(false);
  const reduced = useReducedMotion() ?? false;
  const isLight = useResolvedTheme() === 'light';

  // Color tokens (verbatim TrialPromoToaster pattern).
  const t1 = isLight ? '#111111' : '#FFFFFF';
  const t2 = isLight ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.85)';
  const t3 = isLight ? 'rgba(0,0,0,0.58)' : 'rgba(255,255,255,0.5)';
  const t4 = isLight ? 'rgba(0,0,0,0.38)' : 'rgba(255,255,255,0.28)';
  const rule = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)';
  const glass = isLight ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.02)';

  // ─── Visibility driven by orchestrator (isOpen) ────────────────
  // Test hook: ?extToaster=force bypasses orchestrator and shows immediately.
  const testForceShow = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('extToaster') === 'force';

  useEffect(() => {
    // Auto-dismiss silently the moment the extension connects while visible.
    if (!isOpen || testForceShow) return;
    const unsub = window.electronAPI?.onPhoneMirrorStatus?.(info => {
      if (info?.extensionConnected) {
        try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
        onDismiss();
      }
    });
    return () => { unsub?.(); };
  }, [isOpen, testForceShow, onDismiss]);

  // ─── Escape key ─────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handlePermanentDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // ─── Dismiss handlers ───────────────────────────────────────
  const handlePermanentDismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
    onDismiss();
  };

  const handleInstall = async () => {
    try {
      setOpening(true);
      await window.electronAPI?.openExternal?.(CHROME_STORE_URL);
    } catch (e) {
      console.warn('[BrowserExtensionToaster] openExternal failed:', e);
    } finally {
      // Close immediately — user is in Chrome store now. Don't permanently
      // dismiss so they can return next launch if they didn't install.
      onDismiss();
    }
  };

  // Pure presentational: visibility is driven by orchestrator's isOpen prop
  // (or the ?extToaster=force test hook).
  const visible = isOpen || testForceShow;
  if (!visible) return null;

  return (
    <AnimatePresence>
      {/* Backdrop */}
      <motion.div
        key="ext-backdrop"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.24 }}
        style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: isLight ? 'rgba(0,0,0,0.28)' : 'rgba(0,0,0,0.82)',
          backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        } as React.CSSProperties}
        onClick={e => { if (e.target === e.currentTarget) handlePermanentDismiss(); }}
      >
        {/* Outer wrapper — neutral 1px border, no gradient, no animation */}
        <motion.div
          key="ext-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ext-toast-title"
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.93, y: 22, filter: 'blur(10px)' }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1,    y: 0,  filter: 'blur(0px)' }}
          exit={   reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 14, filter: 'blur(4px)', transition: { duration: 0.15 } }}
          transition={{ type: 'spring', stiffness: 290, damping: 25, mass: 0.82 }}
          style={{
            borderRadius: '24px',
            border: isLight ? '1px solid rgba(0,0,0,0.08)' : '1px solid rgba(255,255,255,0.10)',
            boxShadow: isLight
              ? '0 32px 64px -16px rgba(0,0,0,0.14), 0 8px 32px -8px rgba(0,0,0,0.06)'
              : '0 48px 120px -20px rgba(0,0,0,0.92)',
          }}
        >
          {/* Inner card */}
          <div style={{
            position: 'relative', width: '440px', borderRadius: '22px', overflow: 'hidden',
            background: isLight
              ? 'linear-gradient(155deg, #FAFAFD 0%, #FFFFFF 100%)'
              : 'linear-gradient(155deg, #181A24 0%, #101116 100%)',
            fontFamily: T.font,
          }}>
            {/* Catch-light */}
            <div aria-hidden style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: '1px',
              background: isLight ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.12)',
              pointerEvents: 'none', zIndex: 5,
            }} />

            {/* SVG noise grain */}
            <div aria-hidden style={{
              position: 'absolute', inset: 0, borderRadius: '22px', pointerEvents: 'none', zIndex: 4,
              opacity: isLight ? 0.012 : 0.024, mixBlendMode: 'overlay',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)'/%3E%3C/svg%3E")`,
              backgroundSize: '180px 180px',
            }} />

            <div style={{ padding: '28px 24px 26px', position: 'relative', zIndex: 6 }}>
              {/* Header — no border, just spacing (more open, less dialog-like) */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: t3 }}>
                  <BrowserExtensionIcon color={T.indigo} size={13} />
                  Browser Extension
                </span>
                <button onClick={handlePermanentDismiss}
                  aria-label="Dismiss browser extension invitation"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: '50%', opacity: 0.35, padding: 0, transition: 'opacity 150ms, background 150ms',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.opacity = '0.8'; e.currentTarget.style.background = isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)'; }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = '0.35'; e.currentTarget.style.background = 'transparent'; }}>
                  <X size={13} strokeWidth={2.2} color={isLight ? '#000' : '#fff'} />
                </button>
              </div>

              <motion.div variants={STAGGER} initial="hidden" animate="show" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {/* Hero — custom browser-frame SVG, clean (no surrounding glow) */}
                <motion.div variants={ITEM} style={{ textAlign: 'center', display: 'flex', justifyContent: 'center' }}>
                  <BrowserExtensionHeroIcon size={72} />
                </motion.div>

                <motion.div variants={ITEM} style={{ textAlign: 'center' }}>
                  <h2 id="ext-toast-title" style={{
                    fontSize: '24px', fontWeight: 750, letterSpacing: '-0.025em', lineHeight: 1.2,
                    color: t1, margin: '0 0 8px', fontFamily: T.font,
                  }}>
                    Faster answers. Fewer tokens.
                  </h2>
                  <p style={{
                    fontSize: '13px', lineHeight: 1.66, color: t3,
                    margin: '0 auto 16px', maxWidth: '340px', fontFamily: T.font,
                  }}>
                    The browser extension sends the active tab straight to the assistant — no screenshots, no copy-paste. Responses come back ~3× faster and use a fraction of the tokens.
                  </p>

                  {/* Benefit chips */}
                  <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px',
                    maxWidth: '380px', margin: '0 auto',
                  }}>
                    {[
                      { label: '~3× faster',  sub: 'responses' },
                      { label: '−90% tokens', sub: 'per turn' },
                      { label: 'Auto-detect', sub: 'coding pages' },
                    ].map(({ label, sub }) => (
                      <div key={label} style={{
                        position: 'relative', overflow: 'hidden',
                        padding: '9px 6px',
                        borderRadius: '12px',
                        background: isLight
                          ? 'linear-gradient(135deg, rgba(99,102,241,0.06) 0%, rgba(255,255,255,0.7) 100%)'
                          : 'linear-gradient(135deg, rgba(99,102,241,0.1) 0%, rgba(15,23,42,0.5) 100%)',
                        border: isLight
                          ? '1px solid rgba(99,102,241,0.14)'
                          : '1px solid rgba(99,102,241,0.22)',
                        boxShadow: isLight
                          ? 'inset 0 1px 0 rgba(255,255,255,0.7)'
                          : 'inset 0 1px 0 rgba(255,255,255,0.06)',
                        textAlign: 'center',
                      }}>
                        {/* Specular gloss sheen overlay — claymorphic depth */}
                        <span style={{
                          position: 'absolute', inset: 0, borderRadius: 'inherit',
                          background: isLight
                            ? 'linear-gradient(135deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.01) 50%, rgba(0,0,0,0.02) 100%)'
                            : 'linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.01) 50%, rgba(0,0,0,0.06) 100%)',
                          pointerEvents: 'none', zIndex: 1,
                        }} />
                        <div style={{ position: 'relative', zIndex: 2, fontSize: '11.5px', fontWeight: 750, color: t1, letterSpacing: '-0.01em', fontFamily: T.font, lineHeight: 1.2 }}>{label}</div>
                        <div style={{ position: 'relative', zIndex: 2, fontSize: '9px', fontWeight: 600, color: t3, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '3px', fontFamily: T.font }}>{sub}</div>
                      </div>
                    ))}
                  </div>
                </motion.div>

                {/* CTAs */}
                <motion.div variants={ITEM} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <IndigoCTA
                    label={opening ? 'Opening Chrome Store…' : 'Install on Chrome'}
                    onClick={handleInstall}
                    disabled={opening}
                    reduced={reduced}
                  />

                  <button onClick={() => {
                      // "I don't want to" = explicit skip — distinct from
                      // background click or X (which counts as plain dismiss).
                      // For now both end up at the same handler since the
                      // extension's re-eligibility is controlled by the
                      // permanent DISMISS_KEY flag.
                      handlePermanentDismiss();
                      _onSkip?.();
                    }}
                    aria-label="Dismiss browser extension invitation"
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: '11px', fontWeight: 700, letterSpacing: '0.18em',
                      textTransform: 'uppercase', color: t4, padding: '4px 0',
                      width: '100%', textAlign: 'center', transition: 'color 150ms',
                      fontFamily: T.font,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = t3)}
                    onMouseLeave={e => (e.currentTarget.style.color = t4)}
                  >
                    I don't want to
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

// ─── Indigo CTA (jelly clay, mirrors VioletCTA from TrialPromoToaster) ───
const IndigoCTA: React.FC<{ label: string; onClick: () => void; disabled: boolean; reduced: boolean }> = ({
  label, onClick, disabled, reduced,
}) => {
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
      aria-label="Install Natively browser extension on Chrome"
      style={{
        position: 'relative', width: '100%', height: '48px', overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        paddingLeft: '22px', paddingRight: '22px', borderRadius: '15px', border: 'none',
        background: disabled
          ? 'rgba(99,102,241,0.3)'
          : 'linear-gradient(135deg, #6366F1 0%, #4F46E5 50%, #4338CA 100%)',
        boxShadow: disabled
          ? 'none'
          : isLight
            ? 'inset 0 4px 5px rgba(255,255,255,0.6), inset 0 -4px 5px rgba(0,0,0,0.15), 0 8px 22px rgba(79,70,229,0.28)'
            : 'inset 0 4px 5px rgba(255,255,255,0.22), inset 0 -5px 6px rgba(0,0,0,0.45), 0 10px 30px rgba(99,102,241,0.4)',
        cursor: disabled ? 'wait' : 'pointer', fontFamily: T.font, outline: 'none',
        opacity: disabled ? 0.7 : 1,
      }}
    >
      {/* 3D Jelly Gloss Highlight overlay */}
      {!disabled && (
        <span style={{
          position: 'absolute', top: '2px', left: '8px', right: '8px', height: '35%',
          borderRadius: '9999px', background: 'linear-gradient(180deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.05) 100%)',
          filter: 'blur(0.3px)', pointerEvents: 'none', zIndex: 4,
        }} />
      )}

      {/* Shimmer */}
      {!reduced && !disabled && (
        <motion.div aria-hidden
          style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.12) 50%, transparent 100%)',
            transform: 'skewX(-14deg)', zIndex: 2,
          }}
          animate={{ x: ['-130%', '230%'] }}
          transition={{ duration: 1.8, ease: 'easeInOut', repeat: Infinity, repeatDelay: 5.5 }}
        />
      )}

      <span style={{ position: 'relative', zIndex: 3, fontSize: '13.5px', fontWeight: 750, color: '#fff', letterSpacing: '-0.015em' }}>
        {label}
      </span>

      {/* Trailing icon */}
      {!disabled && (
        <div style={{
          position: 'absolute', right: '10px', top: '50%', zIndex: 3,
          width: '30px', height: '30px', borderRadius: '50%',
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

export default BrowserExtensionToaster;
