import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'framer-motion';
import { AlertCircle, ArrowRight, Check, Loader2, Mail, X } from 'lucide-react';
import { useT } from '../../i18n';
import '../../ui-components/LiquidGlassButton.css';

/**
 * "Lost your key?": a quiet text button at the right of the activation card's
 * heading row (KeyResendLink), and the pill it reveals inside the card, between
 * the heading and the key field (KeyResendHelp): ask for the key by email, then
 * paste it into the field below. Both render only while no key is saved; the
 * parent owns `open`. Key emails sometimes land in Spam or Promotions; this lets
 * the buyer have the key sent again without the help taking space on the card
 * the rest of the time.
 *
 * The pill, one capsule in two states, materials from the card above:
 *   open  a recessed well (the key field's recipe) holding the address, a ×
 *         and a round Activate-style send button
 *   sent  a quiet glass chip (.lg-chip, periwinkle edge) with an emerald
 *         check, held 12 s, then the whole pill folds away
 * Styles: `.natively-key-resend` in index.css.
 *
 * Motion, chosen to feel settled rather than snappy (it is seen rarely):
 *   reveal  a critically damped spring, no overshoot: the row opens its height
 *           while the capsule rises 6px out of 97% scale and a 2px blur
 *   fold    faster than the reveal, an ease-out with no travel back down, so a
 *           close gets out of the way
 *   morph   open → sent resizes the capsule on the same spring; the content
 *           crossfades on a 2px blur so the two states read as one surface
 * Under prefers-reduced-motion everything is an opacity fade: no height, scale,
 * blur or travel.
 *
 * The server (POST /keys/resend, via the main process) sends the key to the
 * address on file and never returns it, and answers the same whether or not a
 * key exists, so nothing here says "found" or "not found".
 * Platform-neutral: renderer UI plus one fetch in the main process.
 */

// Apple's smooth spring: settles in ~0.5 s with no overshoot.
const SETTLE: Transition = { type: 'spring', duration: 0.5, bounce: 0 };
// Strong ease-out for anything leaving.
const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];
const FOLD: Transition = { duration: 0.28, ease: EASE_OUT };
const SWAP_IN: Transition = { duration: 0.22, ease: EASE_OUT, delay: 0.06 };
const SWAP_OUT: Transition = { duration: 0.14, ease: EASE_OUT };
const FADE: Transition = { duration: 0.15, ease: 'easeOut' };

const SENT_HOLD_MS = 12_000;

/** The trigger, at the right of the activation card's heading row. */
export const KeyResendLink = forwardRef<HTMLButtonElement, { open: boolean; onToggle: () => void }>(
  function KeyResendLink({ open, onToggle }, ref) {
    const t = useT();
    return (
      <button
        ref={ref}
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="key-resend-pill"
        className="natively-key-resend-link"
      >
        {t('Lost your key?')}
      </button>
    );
  },
);

type Phase = 'open' | 'sent';

export function KeyResendHelp({ open, onClose }: { open: boolean; onClose: (fromKeyboard: boolean) => void }) {
  const t = useT();
  const reduce = !!useReducedMotion();
  const [phase, setPhase] = useState<Phase>('open');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Every reveal starts at the form, with no leftover error.
  useEffect(() => {
    if (open) { setPhase('open'); setError(null); }
  }, [open]);

  // "Sent" is a moment, not a place: the pill folds away after a while.
  useEffect(() => {
    if (!open || phase !== 'sent') return;
    const id = window.setTimeout(() => closeRef.current(false), SENT_HOLD_MS);
    return () => window.clearTimeout(id);
  }, [open, phase]);

  const errorText = (code?: string) =>
    code === 'rate_limited'
      ? t('Too many tries. Please try again in an hour.')
      : code === 'invalid_email'
        ? t("That doesn't look like an email address.")
        : t("Couldn't reach Natively. Check your connection and try again.");

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    const address = email.trim();
    if (!address.includes('@')) {
      setError(errorText('invalid_email'));
      return;
    }
    setSending(true);
    setError(null);
    try {
      const r = await window.electronAPI?.resendNativelyKey?.(address);
      if (r?.ok) setPhase('sent');
      else setError(errorText(r?.error));
    } catch {
      setError(errorText('network_error'));
    } finally {
      setSending(false);
    }
  };

  const ready = !!email.trim() && !sending;

  // The row's height opens on the spring and folds on the ease-out; the capsule
  // inside carries the rise, the scale and the blur.
  const row = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1, transition: FADE }, exit: { opacity: 0, transition: FADE } }
    : {
        initial: { height: 0, opacity: 0 },
        animate: { height: 'auto', opacity: 1, transition: { height: SETTLE, opacity: { duration: 0.3, ease: EASE_OUT } } },
        exit: { height: 0, opacity: 0, transition: { height: FOLD, opacity: { duration: 0.18, ease: EASE_OUT } } },
      };
  const lift = reduce
    ? {}
    : {
        initial: { y: -6, scale: 0.97, filter: 'blur(2px)' },
        animate: { y: 0, scale: 1, filter: 'blur(0px)', transition: SETTLE },
        exit: { y: -4, scale: 0.98, filter: 'blur(2px)', transition: FOLD },
      };
  const swap = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1, transition: FADE }, exit: { opacity: 0, transition: { duration: 0 } } }
    : {
        initial: { opacity: 0, y: 4, filter: 'blur(2px)' },
        animate: { opacity: 1, y: 0, filter: 'blur(0px)', transition: SWAP_IN },
        exit: { opacity: 0, filter: 'blur(2px)', transition: SWAP_OUT },
      };

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div key="key-resend" {...row} id="key-resend-pill" style={{ overflow: 'hidden' }}>
          {/* 12px above (the card's own rhythm, animated with the height
              instead of popping in as a margin) and a 2px ring gutter on the
              other sides, inside the clip, so the focus ring is never cut. */}
          <div className="flex flex-col items-stretch -mx-0.5 -mb-0.5 px-0.5 pb-0.5 pt-3">
            <motion.div
              {...lift}
              layout
              transition={reduce ? { duration: 0 } : SETTLE}
              data-state={phase}
              className={`natively-key-resend ${phase === 'open' ? '' : 'lg-chip self-start'} max-w-full`}
              style={{ borderRadius: 9999, transformOrigin: '50% 0%' }}
            >
              <AnimatePresence mode="wait" initial={false}>
                {phase === 'open' ? (
                  <motion.form
                    key="open"
                    layout="position"
                    {...swap}
                    onSubmit={send}
                    // Our own error line, not Chromium's native bubble.
                    noValidate
                    onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(true); } }}
                    className="natively-key-resend-form"
                  >
                    <Mail size={13} strokeWidth={2} aria-hidden="true" className="natively-key-resend-icon ml-1" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); if (error) setError(null); }}
                      placeholder={t('Email you paid with')}
                      aria-label={t('Email you paid with')}
                      aria-invalid={error ? true : undefined}
                      autoComplete="email"
                      spellCheck={false}
                      autoFocus
                      className="natively-key-resend-input"
                    />
                    <button
                      type="button"
                      onClick={() => onClose(false)}
                      aria-label={t('Cancel')}
                      title={t('Cancel')}
                      className="natively-key-resend-dismiss"
                    >
                      <X size={12} strokeWidth={2.25} />
                    </button>
                    <button
                      type="submit"
                      disabled={!ready}
                      aria-label={sending ? t('Sending…') : t('Send')}
                      title={t('Send')}
                      data-state={sending ? 'saving' : ready ? 'ready' : 'idle'}
                      className={`natively-key-cta natively-key-resend-send ${sending ? 'cursor-wait' : ready ? 'cursor-pointer' : 'cursor-default'}`}
                    >
                      {sending ? <Loader2 size={13} className="animate-spin" /> : <ArrowRight size={13} strokeWidth={2.25} />}
                    </button>
                  </motion.form>
                ) : (
                  <motion.p key="sent" layout="position" {...swap} role="status" className="natively-key-resend-line">
                    <span className="natively-key-resend-check" aria-hidden="true">
                      <Check size={9} strokeWidth={3} />
                    </span>
                    <span>{t("If that email has a Natively API key, it's on its way. Check Spam and Promotions too.")}</span>
                  </motion.p>
                )}
              </AnimatePresence>
            </motion.div>

            <AnimatePresence initial={false}>
              {phase === 'open' && error && (
                // Height on the same spring, so the line below the pill eases
                // down instead of jumping.
                <motion.div
                  key={error}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0, filter: 'blur(2px)' }}
                  animate={reduce
                    ? { opacity: 1, transition: FADE }
                    : { opacity: 1, height: 'auto', filter: 'blur(0px)', transition: { height: SETTLE, opacity: SWAP_IN, filter: SWAP_IN } }}
                  exit={reduce
                    ? { opacity: 0, transition: FADE }
                    : { opacity: 0, height: 0, transition: { height: FOLD, opacity: SWAP_OUT } }}
                  style={{ overflow: 'hidden' }}
                >
                  <p role="alert" className="pt-2 pl-1 flex items-center gap-1.5 text-[11px] leading-relaxed text-[var(--text-danger)]">
                    <AlertCircle size={12} className="shrink-0" />
                    {error}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
