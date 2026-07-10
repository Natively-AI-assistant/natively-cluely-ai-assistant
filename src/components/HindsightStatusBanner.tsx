// src/components/HindsightStatusBanner.tsx
//
// Persistent top-of-overlay banner that surfaces Hindsight server lifecycle events. Without
// this, a spawn failure only logs to console + `<userData>/hindsight-server.log` and the user
// has no UI signal that the long-term-memory feature isn't working. We subscribe to the
// `hindsight-status` IPC once on mount and render an amber dismissible banner for the failure
// states ('spawn-failed', 'unreachable'); success states are no-ops (the Settings panel
// chip already covers them).
//
// The banner sits above NativelyInterface in the overlay tree with a high z-index so it's
// visible during meetings too — a silently-broken memory server during a meeting would
// otherwise be invisible until the user opens Settings.

import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, ExternalLink, X } from 'lucide-react';

type HindsightStatus =
  | { state: 'spawning'; reason?: string; logPath?: string }
  | { state: 'ready'; reason?: string; logPath?: string }
  | { state: 'unreachable'; reason?: string; logPath?: string }
  | { state: 'spawn-failed'; reason?: string; logPath?: string }
  | { state: 'auth-failed'; reason?: string; logPath?: string };

// Per-state copy. Kept short — the banner has limited horizontal space inside the overlay.
const STATUS_BODY: Record<'spawn-failed' | 'unreachable' | 'spawning' | 'auth-failed', { title: string; body: string }> = {
  'spawn-failed':   { title: 'Long-term memory server failed to start', body: 'The companion app couldn’t boot. Long-term memory is disabled this session.' },
  'unreachable':    { title: 'Long-term memory server didn’t respond',  body: 'The companion started but didn’t answer the health check. Check the log.' },
  'spawning':       { title: 'Starting long-term memory…',              body: 'First boot can take 2–3 minutes (downloading embedding models).' },
  'auth-failed':    { title: 'Hindsight Cloud key was rejected',       body: 'The endpoint answered but your Cloud account key is invalid. Update the key below.' },
};

export const HindsightStatusBanner: React.FC<{ variant?: 'top-strip' | 'floating-card' }> = ({ variant = 'top-strip' }) => {
  const [status, setStatus] = useState<HindsightStatus | null>(null);
  // Per-session dismissal — once the user clicks X the banner stays hidden until a NEW
  // failure occurs (state goes null → failure again). Avoids re-showing the same nudge
  // for every poll cycle.
  const [dismissed, setDismissed] = useState(false);

  // TEMP: preview trigger — force a spawn-failed status on mount for 30s so the
  // floating-card variant is visible without needing to actually break the server.
  // Remove this block before committing.
  useEffect(() => {
    setStatus({ state: 'spawn-failed', reason: 'preview', logPath: '/tmp/preview-hindsight.log' });
    const t = setTimeout(() => setStatus(null), 30000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const handler = (data: HindsightStatus) => {
      // Success state → hide banner, reset dismissal so the NEXT failure can re-show.
      if (data.state === 'ready') {
        setStatus(null);
        setDismissed(false);
        return;
      }
      // Failure state → show (or re-show after a previous dismissal).
      setStatus(data);
      setDismissed(false);
    };
    const off = window.electronAPI?.onHindsightStatus?.(handler);
    return () => { try { off?.(); } catch { /* unmount */ } };
  }, []);

  const openLog = useCallback(async () => {
    try {
      const res = await window.electronAPI?.openHindsightLog?.();
      if (res && !res.ok && res.error) {
        console.warn('[HindsightStatusBanner] failed to open log:', res.error);
      }
    } catch (e: any) {
      console.warn('[HindsightStatusBanner] openHindsightLog threw:', e?.message);
    }
  }, []);

  // Don't render anything on success states or when dismissed.
  if (!status || status.state === 'ready' || dismissed) return null;
  const copy = STATUS_BODY[status.state];
  if (!copy) return null;

  // Spawning: neutral (working) — smaller, less alarming. Failures: amber, with action.
  const isFailing = status.state === 'spawn-failed' || status.state === 'unreachable' || status.state === 'auth-failed';

  // Floating card (launcher window only). Premium liquid-glass recipe matching the
  // onboarding toaster family — src/components/trial/TrialPromoToaster.tsx, the
  // PermissionsToaster / BrowserExtensionToaster / SupportToaster. Key tokens:
  //   - Linear-gradient card surface: linear-gradient(155deg, #1E1E24 0%, #121215 100%)
  //   - Soft layered shadow: 0 48px 120px -20px rgba(0,0,0,0.9), 0 0 1px white-inset-ring
  //   - Larger 24px border-radius (vs flat-dark's 16px)
  //   - Spring entrance with blur-filter: stiffness 290, damping 25, mass 0.82;
  //     initial { opacity:0, scale:0.93, y:22, filter: blur(10px) } → animate in.
  //   - Position: fixed bottom-7 right-7 z-50 (matches toaster family anchor)
  // Amber failure cue: a tinted glow + icon recolor; the card chrome stays
  // consistent with the rest of the launcher onboarding family.
  if (variant === 'floating-card') {
    return (
      <AnimatePresence>
        {!dismissed && (
          <motion.div
            key="hindsight-floating-card"
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, scale: 0.93, y: 22, filter: 'blur(10px)' }}
            animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.95, y: 14, filter: 'blur(4px)' }}
            transition={{ type: 'spring', stiffness: 290, damping: 25, mass: 0.82 }}
            style={{
              position: 'fixed', bottom: 28, right: 28, zIndex: 9999,
              width: 360,
              borderRadius: 24,
              background: 'linear-gradient(155deg, #1E1E24 0%, #121215 100%)',
              boxShadow: isFailing
                ? '0 48px 120px -20px rgba(0,0,0,0.9), 0 0 80px rgba(245,158,11,0.10)'
                : '0 48px 120px -20px rgba(0,0,0,0.9), 0 0 80px rgba(255,255,255,0.02)',
              padding: 20,
              pointerEvents: 'auto',
              fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
            } as React.CSSProperties}
          >
            {/* Fine organic grain — verbatim from TrialPromoToaster */}
            <div aria-hidden style={{
              position: 'absolute', inset: 0, borderRadius: 24, pointerEvents: 'none', zIndex: 0,
              opacity: 0.024, mixBlendMode: 'overlay',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)'/%3E%3C/svg%3E")`,
              backgroundSize: '180px 180px',
            }} />
            {/* Top inner-ring highlight — the "glass" feel from TrialPromoToaster */}
            <div aria-hidden style={{
              position: 'absolute', inset: 0, borderRadius: 24, pointerEvents: 'none', zIndex: 0,
              border: '1px solid rgba(255,255,255,0.08)',
              borderTopColor: 'rgba(255,255,255,0.14)',
            }} />

            <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <AlertTriangle
                  size={18}
                  style={{ marginTop: 2, flexShrink: 0, color: isFailing ? '#FBBF24' : 'rgba(255,255,255,0.5)' }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ color: '#FFFFFF', fontSize: 14, fontWeight: 600, letterSpacing: '-0.015em', margin: 0 }}>
                    {copy.title}
                  </h3>
                  <p style={{ color: 'rgba(255,255,255,0.62)', fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
                    {copy.body}
                    {status.reason ? <> — <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', opacity: 0.85 }}>{status.reason}</span></> : null}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDismissed(true)}
                  aria-label="Dismiss"
                  style={{
                    flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer',
                    width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: '50%', opacity: 0.4, padding: 0, color: '#FFFFFF',
                    transition: 'opacity 150ms, background 150ms',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = '0.85';
                    e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = '0.4';
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <X size={14} strokeWidth={2.2} />
                </button>
              </div>
              {isFailing && status.logPath ? (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={openLog}
                    title={status.logPath}
                    style={{
                      padding: '6px 12px', borderRadius: 10,
                      fontSize: 12, fontWeight: 500,
                      color: 'rgba(255,255,255,0.7)',
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      cursor: 'pointer',
                      transition: 'background 150ms, color 150ms',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.12)';
                      e.currentTarget.style.color = '#FFFFFF';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                      e.currentTarget.style.color = 'rgba(255,255,255,0.7)';
                    }}
                  >
                    View log
                  </button>
                </div>
              ) : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  const borderClass = isFailing ? 'border-amber-500/40' : 'border-border-subtle';
  const bgClass = isFailing ? 'bg-amber-500/10' : 'bg-bg-item-surface';
  const textClass = isFailing ? 'text-amber-200' : 'text-text-secondary';
  const titleClass = isFailing ? 'text-amber-100' : 'text-text-primary';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`absolute top-0 left-0 right-0 z-50 flex items-start gap-2 border-b ${borderClass} ${bgClass} px-3 py-2 text-xs ${textClass} shadow-sm`}
    >
      <AlertTriangle size={14} className={`mt-0.5 shrink-0 ${isFailing ? 'text-amber-400' : 'text-text-tertiary'}`} />
      <div className="min-w-0 flex-1">
        <div className={`font-medium ${titleClass}`}>{copy.title}</div>
        <div className="mt-0.5 text-[11px] leading-relaxed">
          {copy.body}
          {status.reason ? <> — <span className="font-mono opacity-80">{status.reason}</span></> : null}
        </div>
      </div>
      {isFailing && status.logPath ? (
        <button
          type="button"
          onClick={openLog}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-200 transition-colors hover:bg-amber-500/20 active:scale-[0.97] motion-reduce:active:scale-100"
          title={status.logPath}
        >
          <ExternalLink size={11} />
          View log
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="inline-flex shrink-0 items-center rounded-md p-1 text-text-tertiary transition-colors hover:text-text-primary"
      >
        <X size={12} />
      </button>
    </div>
  );
};

export default HindsightStatusBanner;