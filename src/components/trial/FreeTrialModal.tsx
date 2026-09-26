// src/components/trial/FreeTrialModal.tsx
//
// End-of-trial card: pick a plan or fall back to your own API keys.
//
// Same two-pane family as the trial, support, review and upgrade cards (see
// SupportToaster.tsx for the ink table): the words on a flat ground on the
// left, the image in its own inset panel on the right: an hourglass, for
// the trial's time running out.
//
// Unlike the rest of the family it has no close: the trial token is gone, so
// the app has no AI until the user chooses one of the paths below.
//
// It pours out of, and back into, the bottom of the window like every other
// popup (GenieModal).

import React, { useEffect, useState } from 'react';
import { useTrialRemaining } from './useTrialRemaining';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { GenieModal } from '../ui/GenieModal';
import { ArrowRight, Loader2, X } from 'lucide-react';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import {
  formatCompact,
  type NativelyPlanLimits, type TrialUsage,
} from '../../types/nativelyUsage';
import timerArt from '../../assets/cards/timer.jpg';

const PLAN_STANDARD_URL = 'https://checkout.dodopayments.com/buy/pdt_0NbFixGmD8CSeawb5qvVl';
const PLAN_PRO_URL      = 'https://checkout.dodopayments.com/buy/pdt_0NcM6Aw0IWdspbsgUeCLA';
const PLAN_MAX_URL      = 'https://checkout.dodopayments.com/buy/pdt_0NcM7JElX4Af6LNVFS1Yf';
const PLAN_ULTRA_URL    = 'https://checkout.dodopayments.com/buy/pdt_0NcM7rC2kAb69TFKsZnUU';

type PlanKey = 'pro' | 'max' | 'ultra' | 'standard';

/*
  Each paid tier is described as a multiple of Standard rather than raw
  allowances. `times` is the fallback until the plan catalog arrives, from
  natively-api/lib/plans.js (Standard 3M tokens / 300 min; Pro 6.5M / 700,
  Max 10M / 1,000, Ultra 14M / 1,500), the same figures MaxUltraUpgradeToaster
  quotes. Once the catalog is here the multiple is computed from it.
*/
const PLANS: { key: PlanKey; name: string; price: number; times: number | null; url: string }[] = [
  { key: 'pro',      name: 'Pro',      price: 15, times: 2,    url: PLAN_PRO_URL },
  { key: 'max',      name: 'Max',      price: 25, times: 3,    url: PLAN_MAX_URL },
  { key: 'ultra',    name: 'Ultra',    price: 35, times: 4.5,  url: PLAN_ULTRA_URL },
  { key: 'standard', name: 'Standard', price: 8,  times: null, url: PLAN_STANDARD_URL },
];

/**
 * The tier against Standard, on whichever of AI tokens and voice minutes grows
 * less, rounded DOWN to the half so it never overstates (Ultra is 4.67× the
 * tokens and 5× the minutes: "4.5×").
 */
function timesStandard(plan: NativelyPlanLimits | undefined, standard: NativelyPlanLimits | undefined): number | null {
  if (!plan || !standard || !standard.ai_tokens || !standard.transcription_minutes) return null;
  const r = Math.min(plan.ai_tokens / standard.ai_tokens, plan.transcription_minutes / standard.transcription_minutes);
  return Math.floor(r * 2) / 2;
}

function planGist(key: PlanKey, times: number | null): string {
  if (key === 'standard') return 'Base plan, no Pro app';
  return times ? `${times}× Standard, Pro app` : 'More than Standard, Pro app';
}

// ─── Tokens ────────────────────────────────────────────────────
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif';

// Same measured ink sets as the rest of the family.
const INK_DARK = {
  strong: '#F2F2F4',
  body:   'rgba(255,255,255,0.66)',
  quiet:  'rgba(255,255,255,0.52)',
  faint:  'rgba(255,255,255,0.48)',
};
const INK_LIGHT = {
  strong: '#0B1020',
  body:   'rgba(11,16,32,0.68)',
  quiet:  'rgba(11,16,32,0.66)',
  faint:  'rgba(11,16,32,0.58)',
};

const EASE_CSS = 'cubic-bezier(0.23, 1, 0.32, 1)';

const PLATE_ZOOM     = 0.05;
const PLATE_ZOOM_IN  = 1100;
const PLATE_ZOOM_OUT = 700;

const CTA_IN  = 420;
const CTA_OUT = 280;

// The card's drop shadow, shared with the stand-in that carries it mid-genie.
const SHADOW_LIGHT = '0 30px 70px -28px rgba(16,24,40,0.40)';
const SHADOW_DARK  = '0 40px 90px -30px rgba(0,0,0,0.85)';

// The genie is the entrance: the column is in place when the card pours out.
// Under reduced motion there is no genie, so the column fades in instead.
const STAGGER = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const ITEM = {
  hidden: { opacity: 0 },
  show:   { opacity: 1, transition: { duration: 0.3 } },
};

// ─────────────────────────────────────────────────────────────

interface TrialModalProps {
  usage:      TrialUsage;
  onByok:     () => Promise<void>;
  onStandard?: () => Promise<void>;
  /**
   * `'byok'` when the user deliberately ended the trial from this card and the
   * wipe has finished; `'dismissed'` when they simply closed it.
   *
   * The distinction is load-bearing. This card is ALSO opened mid-trial, from
   * "See your options" on the active-trial card, and closing it there must not
   * end anything — the host used to clear its trial state on every close, so
   * looking at the options read as the trial ending on the spot.
   */
  onDone?:    (reason: 'byok' | 'dismissed') => void;
  /**
   * Set ONLY when the trial is still running, to the moment it expires. It
   * turns this from the post-trial card into an options card: honest copy (no
   * "that was the trial" while minutes remain), a live countdown, a BYOK button
   * that says it ends the trial, and — the part that was missing entirely — a
   * way out that is not "end my trial".
   *
   * Left unset, every one of those is exactly as it was: the expiry card has no
   * dismissal on purpose, because by then there is nothing to go back to.
   */
  activeTrialExpiresAt?: string;
}

type Step = 'choose' | 'wiping' | 'done';

export const FreeTrialModal: React.FC<TrialModalProps> = ({ usage, onByok, onStandard, onDone, activeTrialExpiresAt }) => {
  const [step,       setStep]       = useState<Step>('choose');
  const [error,      setError]      = useState<string | null>(null);
  const [plateHover, setPlateHover] = useState(false);
  const [ctaActive,  setCtaActive]  = useState(false);
  const [ctaPressed, setCtaPressed] = useState(false);
  const [planHover,  setPlanHover]  = useState<PlanKey | null>(null);
  const reduced = useReducedMotion() ?? false;
  const isLight = useResolvedTheme() === 'light';
  const INK = isLight ? INK_LIGHT : INK_DARK;

  // Unauthenticated and cached in the main process, so this is a cheap call
  // even on the card that opens the instant a trial ends.
  const [plans, setPlans] = useState<Record<string, NativelyPlanLimits> | null>(null);
  useEffect(() => {
    window.electronAPI?.getNativelyPlans?.()
      .then((r) => { if (r?.ok && r.plans) setPlans(r.plans); })
      .catch(() => { /* rows fall back to qualitative copy */ });
  }, []);

  const handlePlan = (key: PlanKey, url: string) => {
    window.electronAPI?.convertTrial?.(key)?.catch(() => {});
    if (key === 'standard' && onStandard) onStandard().catch(() => {});
    (window.electronAPI as any)?.openExternal?.(url);
  };

  // Both hosts unmount this the moment they hear onDone, so the done step's
  // button closes the card first (the genie) and reports from onClosed.
  const [open, setOpen] = useState(true);

  // Whether this card ENDED the trial, as opposed to merely being closed. Read
  // in onClosed, which fires for both, and a ref rather than state because the
  // genie's close animation outlives the render that sets it.
  const endedRef = React.useRef(false);

  const handleByok = async () => {
    setStep('wiping');
    setError(null);
    try   { await onByok(); endedRef.current = true; setStep('done'); }
    catch (e: any) { setError(e?.message || 'Something went wrong. Restart the app.'); setStep('choose'); }
  };

  // The trial is still running and this is the options card, not the eulogy.
  const isActiveTrial = !!activeTrialExpiresAt;
  const { clock: trialClock, isWarning: trialIsWarning } = useTrialRemaining(activeTrialExpiresAt ?? '');
  const dismiss = () => setOpen(false);

  const sttMin = (usage.stt_seconds / 60).toFixed(1);
  // `usage.search` is the CREDIT counter (2026-09-21): /v1/search bills each
  // query at its true Tavily cost, so one company research is ~20, not 1.
  // Round UP: a partially spent run has already consumed a run slot from the
  // customer's point of view.
  const creditsPerRun = plans?.trial?.research_credits_per_run
    ?? plans?.standard?.research_credits_per_run
    ?? 0;
  const researchRunsUsed = creditsPerRun > 0
    ? Math.ceil((usage.search ?? 0) / creditsPerRun)
    : (usage.search ?? 0);

  const item = ITEM;
  const ctaDur = ctaActive ? CTA_IN : CTA_OUT;
  const outline = (active: boolean) => ({
    border: `1px solid ${isLight
      ? (active ? 'rgba(11,16,32,0.46)' : 'rgba(11,16,32,0.22)')
      : (active ? 'rgba(255,255,255,0.44)' : 'rgba(255,255,255,0.24)')}`,
    background: isLight
      ? (active ? 'rgba(11,16,32,0.04)' : 'rgba(11,16,32,0)')
      : (active ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0)'),
    color: active ? INK.strong : (isLight ? 'rgba(11,16,32,0.84)' : 'rgba(255,255,255,0.88)'),
  });

  return (
    <GenieModal
      open={open}
      label="FreeTrialModal"
      // Its usage figures are this trial's: a kept picture would pour out
      // another reading.
      keepPictures={false}
      zIndex={9999}
      // Only while the trial is live. Once it has expired there is nothing to
      // dismiss back to, and the card is deliberately terminal.
      onBackdropClick={isActiveTrial ? dismiss : undefined}
      onClosed={() => onDone?.(endedRef.current ? 'byok' : 'dismissed')}
      // Dims, never blurs (3a9901ae4).
      backdropStyle={{ background: isLight ? 'rgba(10,10,18,0.30)' : 'rgba(0,0,0,0.80)' }}
      padding={16}
      wrapStyle={{ width: '640px', maxWidth: '100%' }}
      cardStyle={{
        background: isLight ? '#F7F8FC' : '#1C1C1E',
        boxShadow: isLight
          ? 'inset 0 0 0 1px rgba(11,16,32,0.10), inset 0 1px 0 rgba(255,255,255,0.80), ' + SHADOW_LIGHT
          : 'inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.06), ' + SHADOW_DARK,
        fontFamily: FONT,
        WebkitFontSmoothing: 'antialiased',
      } as React.CSSProperties}
      cardProps={{
        role: 'dialog',
        'aria-modal': true,
        'aria-labelledby': 'trial-end-title',
        'aria-describedby': 'trial-end-desc',
        onPointerEnter: e => { if (!reduced && e.pointerType === 'mouse') setPlateHover(true); },
        onPointerLeave: () => setPlateHover(false),
      }}
      shadow={isLight ? SHADOW_LIGHT : SHADOW_DARK}
      radius={20}
    >
    <div style={{ display: 'flex', alignItems: 'stretch', minHeight: '480px' }}>
      <div style={{
        position: 'relative', zIndex: 2,
        flex: '1 1 60%', minWidth: 0,
        padding: '36px 28px 28px 36px',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* The way out. Only while the trial is live, and only on the step that
            has something to go back TO — mid-wipe there is no cancelling, and
            the done step has its own button.

            It is a corner control rather than a third item in the action row
            below because that row is already two wide inside a 320px column;
            a "Not now" beside them wrapped. */}
        {isActiveTrial && step === 'choose' && (
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close"
            style={{
              position: 'absolute', top: '14px', right: '10px',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: '28px', height: '28px', borderRadius: '8px',
              background: 'none', border: 0, padding: 0,
              cursor: 'pointer', color: INK.faint,
              transition: `color 200ms ${EASE_CSS}`,
            }}
            onMouseEnter={e => (e.currentTarget.style.color = INK.body)}
            onMouseLeave={e => (e.currentTarget.style.color = INK.faint)}
            onFocus={e => (e.currentTarget.style.color = INK.body)}
            onBlur={e => (e.currentTarget.style.color = INK.faint)}
          >
            <X size={16} strokeWidth={1.9} aria-hidden />
          </button>
        )}
        <AnimatePresence mode="wait" initial={false}>
          {step === 'choose' && (
            <motion.div
              key="choose"
              variants={STAGGER} initial={reduced ? 'hidden' : false} animate="show"
              exit={{ opacity: 0, transition: { duration: 0.14 } }}
              style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
            >
              <motion.div variants={item} style={{
                fontSize: '12px', fontWeight: 500, letterSpacing: '-0.005em',
                color: INK.quiet, margin: '0 0 18px',
              }}>
                {isActiveTrial ? 'Natively free trial' : 'Natively trial ended'}
              </motion.div>

              <motion.h2 variants={item} id="trial-end-title" style={{
                fontSize: '32px', fontWeight: 300,
                letterSpacing: '-0.032em', lineHeight: 1.08,
                margin: '0 0 16px', color: INK.strong,
              }}>
                {isActiveTrial ? 'Your options.' : 'That was the trial.'}
              </motion.h2>

              <motion.p variants={item} id="trial-end-desc" style={{
                fontSize: '13px', lineHeight: 1.55, letterSpacing: '-0.008em',
                color: INK.body, margin: 0, maxWidth: '320px',
                textWrap: 'pretty',
              } as React.CSSProperties}>
                {isActiveTrial && (
                  <>
                    {/* The one number that is still moving, in the same amber the
                        active-trial card and the usage rows use when time or an
                        allowance runs low. */}
                    <span className={`tabular-nums ${trialIsWarning ? 'text-amber-500' : ''}`}>{trialClock}</span>
                    {' still left. '}
                  </>
                )}
                You{isActiveTrial ? '’ve used' : ' used'} {formatCompact(usage.ai_tokens ?? 0)} AI tokens, {sttMin} min
                of voice and {researchRunsUsed} research {researchRunsUsed === 1 ? 'run' : 'runs'}.
                {isActiveTrial
                  ? ' Nothing here ends your trial. Pick a plan when you are ready, or close this and carry on.'
                  : ' Pick a plan to carry on, or bring your own keys.'}
              </motion.p>

              <motion.div variants={item} style={{
                margin: '20px 0 0',
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px',
              }}>
                {PLANS.map(({ key, name, price, times, url }) => {
                  const on = planHover === key;
                  const shownPrice = plans?.[key]?.price_usd ?? price;
                  const shownGist = planGist(key, timesStandard(plans?.[key], plans?.standard) ?? times);
                  const dur = on ? CTA_IN : CTA_OUT;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handlePlan(key, url)}
                      onPointerEnter={e => { if (e.pointerType === 'mouse') setPlanHover(key); }}
                      onPointerLeave={() => setPlanHover(null)}
                      onFocus={e => { if (e.currentTarget.matches(':focus-visible')) setPlanHover(key); }}
                      onBlur={() => setPlanHover(null)}
                      aria-label={`${name}, $${shownPrice} a month: ${shownGist}. Opens checkout`}
                      style={{
                        display: 'flex', flexDirection: 'column', gap: '6px',
                        padding: '12px 14px', borderRadius: '12px',
                        border: `1px solid ${isLight
                          ? (on ? 'rgba(11,16,32,0.30)' : 'rgba(11,16,32,0.12)')
                          : (on ? 'rgba(255,255,255,0.30)' : 'rgba(255,255,255,0.10)')}`,
                        background: isLight
                          ? (on ? 'rgba(11,16,32,0.03)' : 'rgba(11,16,32,0)')
                          : (on ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0)'),
                        outline: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: FONT,
                        transition: `border-color ${dur}ms ${EASE_CSS}, background-color ${dur}ms ${EASE_CSS}`,
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', width: '100%' }}>
                        <span style={{ fontSize: '14px', fontWeight: 600, letterSpacing: '-0.015em', color: INK.strong, whiteSpace: 'nowrap' }}>
                          {name}{' '}
                          <span style={{ fontWeight: 500, color: on ? INK.strong : INK.body, transition: `color ${dur}ms ${EASE_CSS}` }}>
                            ${shownPrice}/mo
                          </span>
                        </span>
                        <ArrowRight
                          size={14} strokeWidth={1.9} aria-hidden
                          color={on ? INK.strong : INK.body}
                          style={{
                            flex: 'none',
                            transform: on && !reduced ? 'translateX(3px)' : 'translateX(0)',
                            transition: `transform ${dur}ms ${EASE_CSS}, color ${dur}ms ${EASE_CSS}`,
                          }}
                        />
                      </span>
                      <span style={{ fontSize: '12px', fontWeight: 500, letterSpacing: '-0.004em', color: INK.quiet, lineHeight: 1.35 }}>
                        {shownGist}
                      </span>
                    </button>
                  );
                })}
              </motion.div>

              {/* marginTop: auto pins the action row to the bottom of the column. */}
              <motion.div variants={item} style={{ marginTop: 'auto', paddingTop: '22px' }}>
                {error && (
                  <p role="alert" style={{
                    margin: '0 0 12px', fontSize: '12px', lineHeight: 1.45,
                    color: isLight ? '#B42318' : '#FCA5A5',
                  }}>
                    {error}
                  </p>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'nowrap' }}>
                  <button
                    type="button"
                    onClick={() => handlePlan('pro', PLAN_PRO_URL)}
                    onPointerEnter={e => { if (e.pointerType === 'mouse') setCtaActive(true); }}
                    onPointerLeave={() => { setCtaActive(false); setCtaPressed(false); }}
                    onPointerDown={() => setCtaPressed(true)}
                    onPointerUp={() => setCtaPressed(false)}
                    onFocus={e => { if (e.currentTarget.matches(':focus-visible')) setCtaActive(true); }}
                    onBlur={() => setCtaActive(false)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '8px',
                      flex: 'none', whiteSpace: 'nowrap',
                      padding: '9px 14px',
                      borderRadius: '9px',
                      ...outline(ctaActive),
                      outline: 'none',
                      cursor: 'pointer',
                      fontFamily: FONT,
                      fontSize: '13px', fontWeight: 500, letterSpacing: '-0.01em',
                      transform: ctaPressed && !reduced ? 'scale(0.97)' : 'none',
                      transition:
                        `border-color ${ctaDur}ms ${EASE_CSS}, background-color ${ctaDur}ms ${EASE_CSS},`
                        + ` color ${ctaDur}ms ${EASE_CSS}, transform 120ms ${EASE_CSS}`,
                    }}
                  >
                    <span>Continue with Pro</span>
                    <ArrowRight
                      size={14} strokeWidth={1.9} aria-hidden
                      style={{
                        flex: 'none',
                        transform: ctaActive && !reduced ? 'translateX(3px)' : 'translateX(0)',
                        transition: `transform ${ctaDur}ms ${EASE_CSS}`,
                      }}
                    />
                  </button>

                  <button
                    type="button"
                    onClick={handleByok}
                    style={{
                      background: 'none', border: 0, padding: '9px 0',
                      flex: 'none', whiteSpace: 'nowrap',
                      cursor: 'pointer', fontFamily: FONT,
                      fontSize: '13px', fontWeight: 500, letterSpacing: '-0.008em',
                      color: INK.faint,
                      transition: `color 200ms ${EASE_CSS}`,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = INK.body)}
                    onMouseLeave={e => (e.currentTarget.style.color = INK.faint)}
                    onFocus={e => (e.currentTarget.style.color = INK.body)}
                    onBlur={e => (e.currentTarget.style.color = INK.faint)}
                  >
                    {isActiveTrial ? 'End trial, use my own keys' : 'Use my own API keys'}
                  </button>
                </div>
                <div style={{ marginTop: '14px', fontSize: '11.5px', fontWeight: 500, color: INK.faint }}>
                  Cancel anytime. Secure checkout by Dodo Payments.
                </div>
              </motion.div>
            </motion.div>
          )}

          {step === 'wiping' && (
            <motion.div
              key="wiping"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.14 } }}
              role="status"
              style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
            >
              <motion.div
                animate={reduced ? {} : { rotate: 360 }}
                transition={{ duration: 1, repeat: reduced ? 0 : Infinity, ease: 'linear' }}
                style={{ width: '20px', height: '20px', marginBottom: '20px' }}
              >
                <Loader2 size={20} strokeWidth={1.75} color={INK.quiet} />
              </motion.div>
              <h2 id="trial-end-title" style={{ fontSize: '28px', fontWeight: 300, letterSpacing: '-0.03em', lineHeight: 1.1, margin: '0 0 12px', color: INK.strong }}>
                Cleaning up.
              </h2>
              <p id="trial-end-desc" style={{ fontSize: '13px', lineHeight: 1.55, color: INK.body, margin: 0, maxWidth: '300px' }}>
                Removing the trial's cached company research and Pro data from this device.
              </p>
            </motion.div>
          )}

          {step === 'done' && (
            <motion.div
              key="done"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
            >
              <h2 id="trial-end-title" style={{ fontSize: '32px', fontWeight: 300, letterSpacing: '-0.032em', lineHeight: 1.08, margin: '0 0 14px', color: INK.strong }}>
                All set.
              </h2>
              <p id="trial-end-desc" style={{ fontSize: '13px', lineHeight: 1.55, color: INK.body, margin: 0, maxWidth: '300px' }}>
                Trial data is gone. Add your keys in Settings, AI Providers, to get started.
              </p>
              {onDone && (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  onPointerEnter={e => { if (e.pointerType === 'mouse') setCtaActive(true); }}
                  onPointerLeave={() => setCtaActive(false)}
                  style={{
                    alignSelf: 'flex-start', marginTop: '26px',
                    display: 'inline-flex', alignItems: 'center', gap: '8px',
                    padding: '9px 14px', borderRadius: '9px',
                    ...outline(ctaActive),
                    outline: 'none', cursor: 'pointer', fontFamily: FONT,
                    fontSize: '13px', fontWeight: 500, letterSpacing: '-0.01em',
                    transition: `border-color ${ctaDur}ms ${EASE_CSS}, background-color ${ctaDur}ms ${EASE_CSS}, color ${ctaDur}ms ${EASE_CSS}`,
                  }}
                >
                  <span>Open Natively</span>
                  <ArrowRight size={14} strokeWidth={1.9} aria-hidden />
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div style={{ flex: '0 0 36%', padding: '8px 8px 8px 0', display: 'flex' }}>
        <div style={{
          position: 'relative', flex: 1,
          borderRadius: '14px', overflow: 'hidden',
          background: '#EEF1F8',
          boxShadow: isLight ? 'inset 0 0 0 1px rgba(11,16,32,0.07)' : 'none',
        }}>
          <div aria-hidden style={{
            position: 'absolute', inset: 0,
            backgroundImage: `url(${timerArt})`,
            backgroundSize: 'cover',
            backgroundPosition: '90% 50%',
            transform: plateHover ? `scale(${1 + PLATE_ZOOM})` : 'scale(1)',
            transformOrigin: '70% 50%',
            transition: reduced
              ? undefined
              : `transform ${plateHover ? PLATE_ZOOM_IN : PLATE_ZOOM_OUT}ms ${EASE_CSS}`,
            willChange: reduced ? undefined : 'transform',
            pointerEvents: 'none',
          }} />
        </div>
      </div>
    </div>
    </GenieModal>
  );
};
