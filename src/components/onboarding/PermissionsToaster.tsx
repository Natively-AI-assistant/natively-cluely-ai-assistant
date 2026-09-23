// src/components/onboarding/PermissionsToaster.tsx
//
// Skills: ui-ux-pro-max · ui-design-system · canvas-designer · frontend-design
//
// Split-view permissions onboarding card.
// Shows once on first launch, after the launcher UI is visible.
// macOS: raises the mic consent prompt, opens System Settings for screen recording.
// Windows: mic only — there is no per-app screen-capture gate — and the macOS
// visual guide is not rendered at all.
//
// Row presentation lives in src/lib/permissionRowPolicy.mjs so both platform
// branches are testable without mutating process.platform (CLAUDE.md). This
// file renders; it does not decide.
//
// The card NEVER writes a permission state it has not observed. Actions open a
// panel or raise a prompt; the real status arrives via the focus refresh below.
//

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { X, Monitor, Mic, Settings, Check, Lock, Loader2 } from 'lucide-react';
import nativelyIcon from '../../../assets/icon.png';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { describePermRow, allPermissionsResolved } from '../../lib/permissionRowPolicy.mjs';
import type { RowPresentation } from '../../lib/permissionRowPolicy.mjs';

const STORAGE_KEY = 'natively_perms_shown_v1';

const SCREEN_SETTINGS_URI =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

// ─── Design tokens ────────────────────────────────────────────
const T = {
  font:  '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
  blue:  '#007AFF',
  green: '#34D399',
  amber: '#F59E0B',
};

type PermStatus = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown' | 'loading';
type RowKind = 'screen' | 'microphone';

/** Resolved per-theme surface values, shared with the guide sub-components. */
interface CardColors {
  cardBg: string;
  boxShadow: string;
  overlayBg: string;
  rightBg: string;
  rightBorderLeft: string;
  gridOpacity: number;
  gridLineColor: string;
  closeBtnColor: string;
  closeBtnOpacityDefault: number;
  closeBtnOpacityHover: number;
  closeBtnBgHover: string;
  mockBg: string;
  mockBorder: string;
  mockShadow: string;
  mockIconShadow: string;
  mockTextPrimary: string;
  mockTextMuted: string;
  mockSecondaryBg: string;
  mockSecondaryBorder: string;
  mockSecondaryText: string;
  panelBg: string;
  panelBorder: string;
  panelShadow: string;
  panelIconBg: string;
  panelIconBorder: string;
  panelText: string;
  connector: string;
}

interface Props {
  isOpen:    boolean;
  onDismiss: () => void;
}

// ─── Spring configs for Apple-like feel ───────────────────────
const SPRING = {
  gentle: { type: 'spring' as const, stiffness: 180, damping: 22, mass: 0.9 },
  smooth: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
};

const FADE = {
  enter: { opacity: 0, y: 12, filter: 'blur(4px)' },
  in:    { opacity: 1, y: 0,  filter: 'blur(0px)' },
  exit:  { opacity: 0, scale: 0.97, filter: 'blur(3px)' },
};

export const PermissionsToaster: React.FC<Props> = ({ isOpen, onDismiss }) => {
  const [visible,    setVisible]    = useState(false);
  const [platform,   setPlatform]   = useState<string>('darwin');
  const [micStatus,  setMicStatus]  = useState<PermStatus>('loading');
  const [scrStatus,  setScrStatus]  = useState<PermStatus>('loading');
  const [requesting, setRequesting] = useState<RowKind | null>(null);
  const reduced = useReducedMotion() ?? false;

  const theme = useResolvedTheme();
  const isLight = theme === 'light';

  // This card is mounted as a sibling of the meeting subtree (App.tsx), outside
  // any [data-interface-theme] wrapper, so the colour theme is the only axis in
  // play here and a light/dark pair is correct.
  const colors: CardColors = {
    cardBg: isLight
      ? 'linear-gradient(160deg, #FFFFFF 0%, #FAFAFC 100%)'
      : 'linear-gradient(160deg, rgba(24,24,32,0.98) 0%, rgba(16,16,22,0.99) 100%)',
    boxShadow: isLight
      ? '0 32px 80px rgba(0,0,0,0.12), 0 0 1px rgba(0,0,0,0.12)'
      : '0 40px 100px rgba(0,0,0,0.9), 0 0 1px rgba(255,255,255,0.08)',
    overlayBg: isLight ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.6)',
    rightBg: isLight ? '#F5F5F7' : 'rgba(0,0,0,0.3)',
    rightBorderLeft: isLight ? '1px solid rgba(0,0,0,0.07)' : '1px solid rgba(255,255,255,0.1)',
    gridOpacity: isLight ? 0.08 : 0.04,
    gridLineColor: isLight ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.5)',

    closeBtnColor: isLight ? '#1C1C1E' : '#FFFFFF',
    closeBtnOpacityDefault: isLight ? 0.45 : 0.4,
    closeBtnOpacityHover: isLight ? 0.85 : 0.8,
    closeBtnBgHover: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)',

    // Mock of the macOS consent dialog. No backdrop-filter: these sit on an
    // opaque pane, so the blur cost bought nothing and this card's animated
    // blur layers were the subject of the ?isolate=permissions-toaster bisect.
    mockBg: isLight ? '#FFFFFF' : 'rgba(28, 28, 36, 0.95)',
    mockBorder: isLight ? '1px solid rgba(0,0,0,0.09)' : '1px solid rgba(255,255,255,0.12)',
    mockShadow: isLight
      ? '0 16px 36px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04)'
      : '0 24px 50px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.1)',
    mockIconShadow: isLight ? '0 4px 10px rgba(0,0,0,0.12)' : '0 4px 12px rgba(0,0,0,0.4)',
    mockTextPrimary: isLight ? '#1C1C1E' : '#FFFFFF',
    mockTextMuted: isLight ? 'rgba(0,0,0,0.48)' : 'rgba(255,255,255,0.45)',
    mockSecondaryBg: isLight
      ? 'linear-gradient(180deg, #FFFFFF 0%, #F3F3F5 100%)'
      : 'linear-gradient(180deg, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0.08) 100%)',
    mockSecondaryBorder: isLight
      ? '1px solid rgba(0,0,0,0.14)'
      : '1px solid rgba(255,255,255,0.10)',
    mockSecondaryText: isLight ? '#1C1C1E' : '#FFFFFF',

    panelBg: isLight ? '#FFFFFF' : 'rgba(36, 36, 46, 0.8)',
    panelBorder: isLight ? '1px solid rgba(0,0,0,0.08)' : '1px solid rgba(255,255,255,0.08)',
    panelShadow: isLight
      ? '0 10px 24px rgba(0,0,0,0.05)'
      : '0 12px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.05)',
    panelIconBg: isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.06)',
    panelIconBorder: isLight ? '1px solid rgba(0,0,0,0.02)' : '1px solid rgba(255,255,255,0.04)',
    panelText: isLight ? '#1C1C1E' : '#FFFFFF',

    connector: isLight ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.28)',
  };

  const t1 = isLight ? '#1C1C1E' : '#FFFFFF';
  const t3 = isLight ? 'rgba(28, 28, 30, 0.48)' : 'rgba(255, 255, 255, 0.44)';

  const refreshStatus = useCallback(async () => {
    try {
      const p = await window.electronAPI?.checkPermissions?.();
      if (!p) return;
      setPlatform(p.platform);
      setMicStatus(p.microphone as PermStatus);
      setScrStatus(p.screen     as PermStatus);
    } catch {
      setMicStatus('not-determined');
      setScrStatus('not-determined');
    }
  }, []);

  useEffect(() => {
    if (!isOpen) { setVisible(false); return; }
    // Pure presentational: orchestrator already gated on the homepage-mounted
    // duration predicate. We just refresh status and become visible.
    refreshStatus().then(() => setVisible(true));
  }, [isOpen, refreshStatus]);

  useEffect(() => {
    if (!visible) return;
    // The only way a grant reaches this card. Every row action is fire-and-
    // re-read: nothing below writes 'granted' on its own.
    const onFocus = () => refreshStatus();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [visible, refreshStatus]);

  const openScreenSettings = useCallback(() => {
    if (platform !== 'darwin') return;
    window.electronAPI?.openExternal?.(SCREEN_SETTINGS_URI);
  }, [platform]);

  const handleRowAction = useCallback(async (kind: RowKind, remedy: RowPresentation['remedy']) => {
    if (remedy === 'request') {
      // macOS consent prompt. CR-03: re-read the real status rather than
      // asserting one — off darwin nothing is requested at all.
      setRequesting(kind);
      try {
        await window.electronAPI?.requestMicPermission?.();
        await refreshStatus();
      } finally {
        setRequesting(null);
      }
      return;
    }
    if (remedy !== 'settings') return;

    if (kind === 'microphone') {
      // Resolves the per-platform privacy URI in the main process via
      // micSettingsUri, so Windows lands on ms-settings:privacy-microphone.
      await window.electronAPI?.openMicSettings?.();
    } else {
      openScreenSettings();
    }
  }, [refreshStatus, openScreenSettings]);

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    onDismiss();
  };

  const isMac = platform === 'darwin';
  const allResolved = allPermissionsResolved(platform, { microphone: micStatus, screen: scrStatus });
  const checking = micStatus === 'loading' || (isMac && scrStatus === 'loading');

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="perm-overlay"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          style={{
            position: 'fixed', inset: 0, zIndex: 9998,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: colors.overlayBg,
          }}
          onClick={e => { if (e.target === e.currentTarget) handleDismiss(); }}
        >
          {/* Card */}
          <motion.div
            key="perm-card"
            initial={reduced ? FADE.enter : { opacity: 0, scale: 0.95, y: 16, filter: 'blur(12px)' }}
            animate={reduced ? FADE.in   : { opacity: 1, scale: 1,    y: 0,  filter: 'blur(0px)' }}
            exit={   reduced ? FADE.exit : { opacity: 0, scale: 0.97, y: 8,  filter: 'blur(4px)' }}
            transition={SPRING.gentle}
            style={{
              // Windows renders no visual guide, so the card loses that column
              // rather than leaving 260px of empty pane.
              width: isMac ? '680px' : '420px',
              maxWidth: '92vw',
              borderRadius: '20px', overflow: 'hidden',
              background: colors.cardBg,
              boxShadow: colors.boxShadow,
              fontFamily: T.font,
              position: 'relative',
            }}
          >
            {/* Close — on the card, so it survives the guide pane being absent */}
            <button onClick={handleDismiss} aria-label="Dismiss"
              style={{
                position: 'absolute', top: '16px', right: '16px', zIndex: 10,
                background: 'none', border: 'none', cursor: 'pointer',
                width: '26px', height: '26px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: '50%', opacity: colors.closeBtnOpacityDefault,
                transition: 'opacity 200ms, background 200ms',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.opacity = String(colors.closeBtnOpacityHover);
                e.currentTarget.style.background = colors.closeBtnBgHover;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.opacity = String(colors.closeBtnOpacityDefault);
                e.currentTarget.style.background = 'transparent';
              }}>
              <X size={12} strokeWidth={2.5} color={colors.closeBtnColor} />
            </button>

            {/* Two-column layout. No min-height: the card is sized by its
                content, so a two-row list no longer strands ~170px of gap
                above the button. */}
            <div style={{ display: 'flex', alignItems: 'stretch' }}>

              {/* ── LEFT: Permission controls ── */}
              <div style={{ flex: 1, minWidth: 0, padding: '32px 32px 28px', display: 'flex', flexDirection: 'column' }}>

                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
                  <img src={nativelyIcon} alt="Natively" style={{ width: '18px', height: '18px', borderRadius: '4px', flexShrink: 0 }} />
                  <span style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: t3 }}>
                    Permissions
                  </span>
                </div>

                {allResolved ? (
                  <AllSetPanel isLight={isLight} reduced={reduced} onContinue={handleDismiss} />
                ) : (
                  <>
                    {/* Title + subtitle */}
                    <motion.div
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ ...SPRING.smooth, delay: 0.05 }}
                      style={{ marginBottom: '24px' }}
                    >
                      <h2 style={{ fontSize: '24px', fontWeight: 700, letterSpacing: '-0.03em', color: t1, margin: '0 0 8px', lineHeight: 1.2 }}>
                        Let's get you set up
                      </h2>
                      <p style={{ fontSize: '13px', lineHeight: 1.65, color: t3, margin: 0 }}>
                        {isMac
                          ? 'Natively needs a few permissions to capture meetings and transcribe speech.'
                          : 'Natively needs microphone access to transcribe speech.'}
                      </p>
                    </motion.div>

                    {/* Permission items */}
                    <motion.div
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      transition={{ delay: 0.12 }}
                      style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '24px' }}
                    >
                      {isMac && (
                        <PermItem
                          icon={Monitor}
                          label="Screen Recording"
                          row={describePermRow(platform, 'screen', scrStatus)}
                          busy={requesting === 'screen'}
                          onAction={r => handleRowAction('screen', r)}
                          reduced={reduced}
                          isLight={isLight}
                        />
                      )}
                      <PermItem
                        icon={Mic}
                        label="Microphone"
                        row={describePermRow(platform, 'microphone', micStatus)}
                        busy={requesting === 'microphone'}
                        onAction={r => handleRowAction('microphone', r)}
                        reduced={reduced}
                        isLight={isLight}
                      />
                    </motion.div>

                    {/* Footer button */}
                    <motion.div
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ ...SPRING.smooth, delay: 0.2 }}
                    >
                      <PrimaryButton
                        isLight={isLight}
                        disabled={checking}
                        // On Windows the row itself carries the only real
                        // action, so this is an acknowledgement — and it now
                        // says so instead of claiming to open Settings while
                        // actually dismissing the card.
                        icon={isMac ? Settings : undefined}
                        label={isMac ? 'Open Settings' : 'Got it'}
                        onClick={isMac ? openScreenSettings : handleDismiss}
                      />
                    </motion.div>
                  </>
                )}
              </div>

              {/* ── RIGHT: Visual guide — macOS only ──
                   The mock below is a macOS consent dialog and a macOS
                   Privacy & Security row. Showing either on Windows would be
                   troubleshooting for the wrong OS (CLAUDE.md). */}
              {isMac && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ ...SPRING.gentle, delay: 0.08 }}
                  style={{
                    width: '260px', flexShrink: 0,
                    background: colors.rightBg,
                    borderLeft: colors.rightBorderLeft,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '32px 22px',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  {/* Subtle grid pattern */}
                  <div aria-hidden style={{
                    position: 'absolute', inset: 0, opacity: colors.gridOpacity,
                    backgroundImage: `linear-gradient(${colors.gridLineColor} 1px, transparent 1px),
                                     linear-gradient(90deg, ${colors.gridLineColor} 1px, transparent 1px)`,
                    backgroundSize: '24px 24px',
                  }} />

                  {allResolved
                    ? <GuideResolved isLight={isLight} colors={colors} t3={t3} />
                    : <GuideSteps colors={colors} t3={t3} reduced={reduced} />}
                </motion.div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// ─── Primary button ───────────────────────────────────────────
function PrimaryButton({
  isLight, label, icon: Icon, onClick, disabled, variant = 'blue',
}: {
  isLight: boolean;
  label: string;
  icon?: React.ElementType;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'blue' | 'green';
}) {
  const bg = variant === 'green'
    ? 'linear-gradient(160deg, #34D399 0%, #10B981 50%, #059669 100%)'
    : 'linear-gradient(160deg, #5B8EF0 0%, #3B6FE8 50%, #2D5FD4 100%)';
  const glow = variant === 'green' ? 'rgba(16,185,129,' : 'rgba(37,99,235,';

  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      whileHover={disabled ? {} : { scale: 1.01 }}
      whileTap={disabled ? {} : { scale: 0.98 }}
      style={{
        width: '100%', height: '48px',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
        padding: '0 20px', borderRadius: '11px', border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        background: bg,
        boxShadow: isLight
          ? `0 6px 18px ${glow}0.25), inset 0 1px 0 rgba(255,255,255,0.2)`
          : `0 8px 24px ${glow}0.35), inset 0 1px 0 rgba(255,255,255,0.2)`,
        fontFamily: T.font, fontSize: '14px', fontWeight: 600, color: '#fff',
        letterSpacing: '-0.01em',
        position: 'relative', overflow: 'hidden',
      }}
    >
      {/* Gloss highlight */}
      <span aria-hidden style={{
        position: 'absolute', top: '2px', left: '8px', right: '8px', height: '40%',
        borderRadius: '9999px',
        background: 'linear-gradient(to bottom, rgba(255,255,255,0.7), rgba(255,255,255,0.05))',
        filter: 'blur(0.5px)', pointerEvents: 'none', zIndex: 1,
      }} />
      <span style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', gap: '8px' }}>
        {Icon && <Icon size={14} strokeWidth={2} />}
        {label}
      </span>
    </motion.button>
  );
}

// ─── Completion state ─────────────────────────────────────────
// `allPermissionsResolved` used to be computed and then thrown away, so the
// card kept demanding "Open Settings" from a user who had already granted
// everything. This is what it renders now.
function AllSetPanel({ isLight, reduced, onContinue }: {
  isLight: boolean; reduced: boolean; onContinue: () => void;
}) {
  const t1 = isLight ? '#1C1C1E' : '#FFFFFF';
  const t3 = isLight ? 'rgba(28, 28, 30, 0.48)' : 'rgba(255, 255, 255, 0.44)';

  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? { duration: 0.15 } : SPRING.gentle}
      style={{ display: 'flex', flexDirection: 'column' }}
    >
      <motion.div
        initial={reduced ? {} : { scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 18, delay: 0.05 }}
        style={{
          width: '46px', height: '46px', borderRadius: '14px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(52,211,153,0.14)',
          border: '1px solid rgba(52,211,153,0.28)',
          marginBottom: '18px',
        }}
      >
        <Check size={24} strokeWidth={2.5} color={T.green} />
      </motion.div>

      <h2 style={{ fontSize: '24px', fontWeight: 700, letterSpacing: '-0.03em', color: t1, margin: '0 0 8px', lineHeight: 1.2 }}>
        You're all set
      </h2>
      <p style={{ fontSize: '13px', lineHeight: 1.65, color: t3, margin: '0 0 28px' }}>
        Natively has everything it needs to capture and transcribe your meetings.
      </p>

      <PrimaryButton isLight={isLight} variant="green" label="Continue" onClick={onContinue} />
    </motion.div>
  );
}

// ─── Guide: the two steps, macOS only ─────────────────────────
// Previously carried three infinite loops (a 2.2s setInterval driving a mock
// toggle, a floating icon and a pulsing button) stacked over two backdrop-filter
// layers. That combination is what ?isolate=permissions-toaster was added to
// bisect against a native OOM, and none of it taught the user anything a still
// image does not. Entrance animation only now.
function GuideSteps({ colors, t3, reduced }: {
  colors: CardColors;
  t3: string;
  reduced: boolean;
}) {
  const rise = (delay: number) => (reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.2, delay } }
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { type: 'spring' as const, stiffness: 180, damping: 18, delay } });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', position: 'relative', zIndex: 1, width: '100%' }}>

      {/*
        Step 1 — the macOS consent alert, laid out the way the real TCC alert
        is: the app icon centred at the top, the title beneath it, the
        explanation beneath that, and the two push buttons side by side on one
        row with the default filled blue on the RIGHT.

        The previous mock was an icon-beside-text banner with right-aligned
        pills — the shape of a web toast, not a system alert — and it painted
        "Deny" as the blue default, teaching the exact wrong tap.
      */}
      <motion.div
        {...rise(0.15)}
        style={{
          width: '216px',
          backgroundColor: colors.mockBg,
          borderRadius: '12px',
          padding: '16px 14px 12px',
          border: colors.mockBorder,
          boxShadow: colors.mockShadow,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          textAlign: 'center',
        }}
      >
        <img src={nativelyIcon} alt="" aria-hidden style={{
          width: '38px', height: '38px', borderRadius: '9px',
          marginBottom: '10px', boxShadow: colors.mockIconShadow,
        }} />

        <div style={{
          fontSize: '10.5px', fontWeight: 600, color: colors.mockTextPrimary,
          lineHeight: 1.35, letterSpacing: '-0.005em', marginBottom: '4px',
        }}>
          Natively wants to record the screen.
        </div>
        <div style={{
          fontSize: '10px', color: colors.mockTextMuted,
          lineHeight: 1.35, marginBottom: '13px',
        }}>
          Enable access in Privacy &amp; Security settings.
        </div>

        <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
          <div style={{
            flex: 1, height: '21px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: '6px',
            background: colors.mockSecondaryBg,
            border: colors.mockSecondaryBorder,
            fontSize: '10px', fontWeight: 500, color: colors.mockSecondaryText,
            letterSpacing: '-0.005em',
          }}>
            Deny
          </div>
          <div style={{
            flex: 1, height: '21px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: '6px',
            background: T.blue,
            fontSize: '10px', fontWeight: 500, color: '#FFFFFF',
            letterSpacing: '-0.005em',
            boxShadow: '0 1px 3px rgba(0,122,255,0.35), inset 0 1px 0 rgba(255,255,255,0.22)',
          }}>
            Open Settings
          </div>
        </div>
      </motion.div>

      {/* Connector */}
      <div aria-hidden style={{ width: '1.5px', height: '14px', background: colors.connector, borderRadius: '1px' }} />

      {/* Step 2 — the Privacy & Security row, already switched on */}
      <motion.div
        {...rise(0.25)}
        style={{
          width: '216px',
          backgroundColor: colors.panelBg,
          borderRadius: '10px',
          padding: '9px 11px',
          border: colors.panelBorder,
          boxShadow: colors.panelShadow,
          display: 'flex', alignItems: 'center', gap: '9px',
          textAlign: 'left',
        }}
      >
        <div style={{
          width: '22px', height: '22px', borderRadius: '5px', flexShrink: 0,
          background: colors.panelIconBg, border: colors.panelIconBorder,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <img src={nativelyIcon} alt="" aria-hidden style={{ width: '14px', height: '14px', borderRadius: '3px' }} />
        </div>
        <span style={{ fontSize: '11px', fontWeight: 550, color: colors.panelText, flex: 1, letterSpacing: '-0.01em' }}>
          Natively
        </span>
        {/* A still switch in its target position. It used to flip itself every
            2.2s, which read as a control rather than an illustration. */}
        <div aria-hidden style={{
          width: '26px', height: '15px', borderRadius: '7.5px',
          padding: '1.5px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          flexShrink: 0,
          background: 'linear-gradient(160deg, #34D399 0%, #10B981 100%)',
          boxShadow: '0 0 8px rgba(52,211,153,0.3)',
        }}>
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
        </div>
      </motion.div>

      <p style={{ fontSize: '10px', fontWeight: 500, color: t3, lineHeight: 1.4, margin: '6px 0 0', textAlign: 'center', opacity: 0.85, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        System Settings → Privacy &amp; Security
      </p>
    </div>
  );
}

// ─── Guide: completion ────────────────────────────────────────
function GuideResolved({ isLight, colors, t3 }: {
  isLight: boolean;
  colors: CardColors;
  t3: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', position: 'relative', zIndex: 1 }}>
      <div style={{
        width: '54px', height: '54px', borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: isLight ? 'rgba(52,211,153,0.12)' : 'rgba(52,211,153,0.16)',
        border: '1px solid rgba(52,211,153,0.3)',
        boxShadow: colors.panelShadow,
      }}>
        <Check size={26} strokeWidth={2.5} color={T.green} />
      </div>
      <p style={{ fontSize: '10px', fontWeight: 500, color: t3, lineHeight: 1.4, margin: 0, textAlign: 'center', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        Ready to go
      </p>
    </div>
  );
}

// ─── Single permission row ────────────────────────────────────
// Status in, presentation out. The row has no opinion of its own: it cannot
// flip itself green, and clicking a granted row does nothing, because nothing
// was revoked.
function PermItem({
  icon: Icon, label, row, busy, onAction, reduced, isLight,
}: {
  icon:     React.ElementType;
  label:    string;
  row:      RowPresentation;
  busy:     boolean;
  onAction: (remedy: RowPresentation['remedy']) => void;
  reduced:  boolean;
  isLight:  boolean;
}) {
  const t1 = isLight ? '#1C1C1E' : '#FFFFFF';
  const t3 = isLight ? 'rgba(28, 28, 30, 0.48)' : 'rgba(255, 255, 255, 0.44)';
  const rule = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.1)';
  const glass = isLight ? 'rgba(0, 0, 0, 0.03)' : 'rgba(255, 255, 255, 0.06)';

  const accent =
    row.tone === 'granted' ? T.green :
    row.tone === 'blocked' ? T.amber :
    row.tone === 'pending' ? (isLight ? 'rgba(28,28,30,0.35)' : 'rgba(255,255,255,0.35)') :
    T.blue;

  const wellBg =
    row.tone === 'granted' ? 'rgba(52,211,153,0.12)' :
    row.tone === 'blocked' ? 'rgba(245,158,11,0.12)' :
    row.tone === 'pending' ? (isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.05)') :
    'rgba(0,122,255,0.1)';

  const wellBorder =
    row.tone === 'granted' ? 'rgba(52,211,153,0.2)' :
    row.tone === 'blocked' ? 'rgba(245,158,11,0.2)' :
    row.tone === 'pending' ? rule :
    'rgba(0,122,255,0.15)';

  const interactive = row.actionable && !busy;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 24 }}
      onClick={interactive ? () => onAction(row.remedy) : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAction(row.remedy); }
      } : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: '14px',
        padding: '14px 16px', borderRadius: '12px',
        background: glass,
        border: `1px solid ${row.tone === 'granted' ? 'rgba(52,211,153,0.18)' : rule}`,
        transition: 'border-color 300ms, transform 150ms',
        cursor: interactive ? 'pointer' : 'default',
      }}
      whileHover={interactive ? { scale: 1.005 } : {}}
      whileTap={interactive ? { scale: 0.995 } : {}}
    >
      {/* Icon well */}
      <div style={{
        width: '38px', height: '38px', borderRadius: '10px', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: wellBg, border: `1px solid ${wellBorder}`,
      }}>
        <Icon size={17} strokeWidth={1.75} color={accent} />
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13.5px', fontWeight: 580, color: t1, letterSpacing: '-0.01em' }}>{label}</div>
        <div style={{ fontSize: '11.5px', color: t3, marginTop: '2px', lineHeight: 1.35 }}>
          {row.sublabel}
        </div>
      </div>

      {/* Trailing affordance — a state badge, not a switch */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        {busy ? (
          <motion.div
            animate={reduced ? {} : { rotate: 360 }}
            transition={reduced ? {} : { repeat: Infinity, duration: 0.9, ease: 'linear' }}
            style={{ display: 'flex' }}
          >
            <Loader2 size={17} strokeWidth={2} color={T.blue} />
          </motion.div>
        ) : row.tone === 'granted' ? (
          <div aria-label="Access granted" style={{
            width: '24px', height: '24px', borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(52,211,153,0.16)', border: '1px solid rgba(52,211,153,0.3)',
          }}>
            <Check size={13} strokeWidth={3} color={T.green} />
          </div>
        ) : row.tone === 'blocked' ? (
          <Lock size={15} strokeWidth={2} color={T.amber} />
        ) : row.tone === 'pending' ? null : (
          <span style={{
            padding: '6px 11px', borderRadius: '8px',
            background: isLight ? 'rgba(0,122,255,0.1)' : 'rgba(0,122,255,0.18)',
            border: `1px solid ${isLight ? 'rgba(0,122,255,0.2)' : 'rgba(0,122,255,0.28)'}`,
            fontSize: '11.5px', fontWeight: 600, color: isLight ? '#0A6CD8' : '#6BAEFF',
            letterSpacing: '-0.01em', whiteSpace: 'nowrap',
          }}>
            {row.actionLabel}
          </span>
        )}
      </div>
    </motion.div>
  );
}
