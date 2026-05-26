// src/components/onboarding/PermissionsToaster.tsx
//
// Skills: ui-ux-pro-max · ui-design-system · canvas-designer · frontend-design
//
// Premium Apple-style permissions request card.
// Shows once on first launch, after the launcher UI is visible.
// macOS: requests mic via system dialog, opens System Preferences for screen recording.
// Windows: shows a simple instruction notice (OS handles permissions at first use).

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { X, Monitor, Mic, CheckCircle, AlertCircle, ExternalLink, ArrowRight } from 'lucide-react';

const STORAGE_KEY  = 'natively_perms_shown_v1';
const STARTUP_DELAY_MS = 1_400;

// ─── Design tokens ────────────────────────────────────────────
const T = {
  font:    '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
  violet:  '#8B5CF6',
  violetG: 'rgba(139,92,246,0.38)',
  green:   '#34D399',
  greenG:  'rgba(52,211,153,0.32)',
  amber:   '#FBBF24',
  red:     '#F87171',
  t1: '#FFFFFF',
  t2: 'rgba(255,255,255,0.72)',
  t3: 'rgba(255,255,255,0.44)',
  t4: 'rgba(255,255,255,0.26)',
  glass:    'rgba(255,255,255,0.04)',
  glassMid: 'rgba(255,255,255,0.07)',
  rule:     'rgba(255,255,255,0.08)',
};

const GT: React.CSSProperties = {
  background: 'linear-gradient(140deg, #FFFFFF 25%, rgba(196,181,253,0.9) 100%)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
};

const STAGGER = { hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } } };
const ITEM    = {
  hidden: { opacity: 0, y: 12, filter: 'blur(4px)' },
  show:   { opacity: 1, y: 0,  filter: 'blur(0px)', transition: { duration: 0.46, ease: [0.22, 1, 0.36, 1] as any } },
};

type PermStatus = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'loading';

interface Props {
  isOpen:    boolean;
  onDismiss: () => void;
}

export const PermissionsToaster: React.FC<Props> = ({ isOpen, onDismiss }) => {
  const [visible,    setVisible]    = useState(false);
  const [platform,   setPlatform]   = useState<string>('darwin');
  const [micStatus,  setMicStatus]  = useState<PermStatus>('loading');
  const [scrStatus,  setScrStatus]  = useState<PermStatus>('loading');
  const [requesting, setRequesting] = useState(false);
  const reduced = useReducedMotion() ?? false;

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
    const t = setTimeout(async () => {
      await refreshStatus();
      setVisible(true);
    }, STARTUP_DELAY_MS);
    return () => clearTimeout(t);
  }, [isOpen, refreshStatus]);

  // Re-check permissions when window regains focus (user returned from System Preferences)
  useEffect(() => {
    if (!visible) return;
    const onFocus = () => refreshStatus();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [visible, refreshStatus]);

  const handleMicRequest = async () => {
    setRequesting(true);
    await window.electronAPI?.requestMicPermission?.();
    await refreshStatus();
    setRequesting(false);
  };

  const openScreenSettings = () => {
    // Defense-in-depth: even though every caller is gated on platform === 'darwin'
    // and the IPC allowlist rejects the URL on non-darwin, refuse to even
    // construct the URL on Windows so a future regression cannot leak it.
    if (platform !== 'darwin') return;
    window.electronAPI?.openExternal?.('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  };

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    onDismiss();
  };

  if (!visible) return null;

  // Windows has no Screen Recording TCC concept; the IPC handler reports it
  // as 'granted' on non-Darwin so the check is harmless either way, but we
  // gate explicitly to make the platform contract obvious.
  const allGranted = platform === 'darwin'
    ? micStatus === 'granted' && scrStatus === 'granted'
    : micStatus === 'granted';

  return (
    <AnimatePresence>
      <style>{`
        @keyframes perm-border-flow {
          0%, 100% { background-position: 0% 50%; }
          50%       { background-position: 100% 50%; }
        }
        .perm-border {
          background: linear-gradient(145deg,
            rgba(139,92,246,0.75),
            rgba(59,130,246,0.55),
            rgba(139,92,246,0.7),
            rgba(52,211,153,0.5)
          );
          background-size: 300% 300%;
          animation: perm-border-flow 6s ease infinite;
        }
        .perm-border-reduced {
          background: linear-gradient(145deg, rgba(139,92,246,0.55), rgba(59,130,246,0.4), rgba(52,211,153,0.38));
        }
      `}</style>

      {/* Backdrop */}
      <motion.div
        key="perm-backdrop"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.22 }}
        style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'radial-gradient(ellipse 80% 70% at 50% 50%, rgba(139,92,246,0.06) 0%, rgba(0,0,0,0.84) 100%)',
          backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        } as React.CSSProperties}
        onClick={e => { if (e.target === e.currentTarget) handleDismiss(); }}
      >
        {/* Gradient border wrapper */}
        <motion.div
          key="perm-card"
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.93, y: 20, filter: 'blur(10px)' }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1,    y: 0,  filter: 'blur(0px)' }}
          exit={   reduced ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 14, filter: 'blur(4px)' }}
          transition={{ type: 'spring', stiffness: 290, damping: 25, mass: 0.82 }}
          className={reduced ? 'perm-border-reduced' : 'perm-border'}
          style={{ padding: '1.5px', borderRadius: '23px', boxShadow: '0 48px 120px -20px rgba(0,0,0,0.95), 0 0 80px rgba(139,92,246,0.06)' }}
        >
          <div style={{
            position: 'relative', width: '430px', borderRadius: '22px', overflow: 'hidden',
            background: 'linear-gradient(150deg, rgba(10,10,18,0.99) 0%, rgba(6,6,11,1) 100%)',
            fontFamily: T.font,
          }}>
            {/* Catch-light */}
            <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '1px', background: 'rgba(255,255,255,0.14)', pointerEvents: 'none', zIndex: 5 }} />

            {/* Aurora glow */}
            {!reduced && (
              <motion.div aria-hidden
                animate={{ opacity: [0.07, 0.15, 0.07] }}
                transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
                style={{ position: 'absolute', top: '-80px', left: '50%', transform: 'translateX(-50%)', width: '400px', height: '280px', background: 'radial-gradient(ellipse, rgba(139,92,246,0.28) 0%, transparent 65%)', pointerEvents: 'none', zIndex: 1 }}
              />
            )}

            {/* Grain texture */}
            <div aria-hidden style={{
              position: 'absolute', inset: 0, borderRadius: '22px', pointerEvents: 'none', zIndex: 4, opacity: 0.028, mixBlendMode: 'overlay',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)'/%3E%3C/svg%3E")`,
              backgroundSize: '180px 180px',
            }} />

            <div style={{ padding: '26px 28px 28px', position: 'relative', zIndex: 6 }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '22px', paddingBottom: '16px', borderBottom: `1px solid ${T.rule}` }}>
                <span style={{ fontSize: '10.5px', fontWeight: 660, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.t2 }}>
                  Natively · Permissions
                </span>
                <button onClick={handleDismiss} aria-label="Dismiss"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', opacity: 0.35, padding: 0, transition: 'opacity 150ms, background 150ms' }}
                  onMouseEnter={e => { e.currentTarget.style.opacity = '0.8'; e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = '0.35'; e.currentTarget.style.background = 'transparent'; }}>
                  <X size={13} strokeWidth={2.3} color="#fff" />
                </button>
              </div>

              <motion.div variants={STAGGER} initial="hidden" animate="show" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {/* Headline */}
                <motion.div variants={ITEM}>
                  <h2 style={{ ...GT, fontSize: '22px', fontWeight: 720, letterSpacing: '-0.03em', lineHeight: 1.2, margin: '0 0 8px' }}>
                    Before we start
                  </h2>
                  <p style={{ fontSize: '13px', lineHeight: 1.64, color: T.t3, margin: 0, maxWidth: '340px' }}>
                    {platform === 'darwin'
                      ? 'Natively needs access to your screen and microphone to capture meetings and transcribe speech.'
                      : 'Click "Allow" if Windows asks for microphone or screen access when you start a meeting.'}
                  </p>
                </motion.div>

                {/* Permission rows — macOS only shows real status. Screen Recording
                    is a macOS-only TCC concept; Windows has no equivalent so we
                    omit the row entirely instead of rendering a "System handles
                    this" placeholder that confuses Windows users. */}
                <motion.div variants={ITEM} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {platform === 'darwin' && (
                    <PermRow
                      icon={Monitor}
                      label="Screen Recording"
                      description="Required to capture meeting content"
                      status={scrStatus}
                      platform={platform}
                      actionLabel="Open Settings"
                      actionIcon={ExternalLink}
                      onAction={openScreenSettings}
                      reduced={reduced}
                    />
                  )}
                  <PermRow
                    icon={Mic}
                    label="Microphone"
                    description="Required for speech transcription"
                    status={micStatus}
                    platform={platform}
                    actionLabel={requesting ? 'Requesting…' : 'Request Access'}
                    onAction={micStatus !== 'granted' && !requesting ? handleMicRequest : undefined}
                    reduced={reduced}
                  />
                </motion.div>

                {/* CTA */}
                <motion.div variants={ITEM}>
                  <button
                    onClick={handleDismiss}
                    style={{
                      width: '100%', height: '50px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '0 20px', borderRadius: '13px', border: 'none', cursor: 'pointer',
                      background: allGranted
                        ? 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 50%, #5B21B6 100%)'
                        : 'rgba(255,255,255,0.07)',
                      boxShadow: allGranted ? `0 0 0 1px rgba(109,40,217,0.5), 0 8px 28px rgba(139,92,246,0.35), inset 0 1px 0 rgba(255,255,255,0.18)` : `0 0 0 1px ${T.rule}`,
                      transition: 'background 0.3s, box-shadow 0.3s',
                      fontFamily: T.font,
                    }}
                    onMouseEnter={e => { if (!allGranted) e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
                    onMouseLeave={e => { if (!allGranted) e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; }}
                  >
                    <span style={{ fontSize: '14px', fontWeight: 640, color: allGranted ? '#fff' : T.t2, letterSpacing: '-0.01em' }}>
                      {allGranted ? 'All set — continue' : 'Continue'}
                    </span>
                    <ArrowRight size={15} strokeWidth={2.2} color={allGranted ? '#fff' : T.t3} />
                  </button>
                  {!allGranted && (
                    <p style={{ fontSize: '11px', color: T.t4, textAlign: 'center', marginTop: '10px', fontFamily: T.font }}>
                      {platform === 'darwin'
                        ? 'You can grant permissions later in System Preferences.'
                        : 'Windows will prompt you the first time Natively needs the microphone.'}
                    </p>
                  )}
                </motion.div>
              </motion.div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

// ─── Single permission row ─────────────────────────────────────
function PermRow({
  icon: Icon, label, description, status, platform,
  actionLabel, actionIcon: ActionIcon, onAction, reduced,
}: {
  icon:         React.ElementType;
  label:        string;
  description:  string;
  status:       PermStatus;
  platform:     string;
  actionLabel:  string;
  actionIcon?:  React.ElementType;
  onAction?:    () => void;
  reduced:      boolean;
}) {
  const isGranted  = status === 'granted';
  const isDenied   = status === 'denied' || status === 'restricted';
  const isPending  = status === 'loading' || status === 'not-determined';

  const statusColor = isGranted ? T.green : isDenied ? T.red : T.amber;
  const statusLabel = platform !== 'darwin' ? 'System handles this'
    : isGranted ? 'Granted' : isDenied ? 'Denied — re-enable in Settings' : 'Not yet granted';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '14px',
      padding: '14px 16px', borderRadius: '13px',
      background: T.glass, border: `1px solid ${T.rule}`,
      transition: 'border-color 0.3s',
      ...(isGranted ? { borderColor: 'rgba(52,211,153,0.2)' } : {}),
    }}>
      {/* Icon well */}
      <div style={{
        width: '36px', height: '36px', borderRadius: '10px', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: isGranted ? 'rgba(52,211,153,0.12)' : isDenied ? 'rgba(248,113,113,0.1)' : 'rgba(139,92,246,0.12)',
        border: `1px solid ${isGranted ? 'rgba(52,211,153,0.22)' : isDenied ? 'rgba(248,113,113,0.18)' : 'rgba(139,92,246,0.2)'}`,
      }}>
        <Icon size={16} strokeWidth={1.75} color={isGranted ? T.green : isDenied ? T.red : T.violet} />
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 580, color: T.t1, letterSpacing: '-0.01em', fontFamily: T.font }}>{label}</div>
        <div style={{ fontSize: '11.5px', color: T.t3, marginTop: '2px', fontFamily: T.font }}>
          {isPending || platform !== 'darwin' ? description : statusLabel}
        </div>
      </div>

      {/* Status badge + action */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        {/* Dot indicator */}
        {platform === 'darwin' && !isPending && (
          <motion.div
            initial={{ scale: 0 }} animate={{ scale: 1 }}
            transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 20 }}
            style={{ width: '6px', height: '6px', borderRadius: '50%', background: statusColor, boxShadow: `0 0 8px ${isGranted ? T.greenG : 'rgba(248,113,113,0.5)'}` }}
          />
        )}

        {/* Action button (only when not granted) */}
        {onAction && !isGranted && (
          <button
            onClick={onAction}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              padding: '6px 12px', borderRadius: '8px', border: 'none', cursor: 'pointer',
              background: 'rgba(139,92,246,0.18)', fontSize: '11.5px', fontWeight: 600,
              color: 'rgba(196,181,253,0.9)', fontFamily: T.font, transition: 'background 150ms',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(139,92,246,0.28)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(139,92,246,0.18)'}
          >
            {ActionIcon && <ActionIcon size={11} strokeWidth={2} />}
            {actionLabel}
          </button>
        )}

        {/* Granted checkmark */}
        {isGranted && <CheckCircle size={16} strokeWidth={1.75} color={T.green} />}
        {isDenied && platform === 'darwin' && <AlertCircle size={16} strokeWidth={1.75} color={T.red} />}
      </div>
    </div>
  );
}
