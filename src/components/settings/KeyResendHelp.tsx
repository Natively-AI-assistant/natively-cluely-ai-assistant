import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertCircle, ArrowRight, Check, Loader2, Mail, X } from 'lucide-react';
import { useT } from '../../i18n';
import { EASE_ENTER, EASE_LEAVE, INK, SETTLE } from '../../lib/plansMotion';
import '../../ui-components/LiquidGlassButton.css';

/**
 * "Bought a key but no email?": one pill under the activation card, shown while
 * no key is saved. Key emails sometimes land in Spam or Promotions; this says
 * so and lets the buyer have the key sent again.
 *
 * One capsule, three states, one material each from the card above it:
 *   rest  a quiet glass chip (.lg-chip, periwinkle edge): hint + "email it again"
 *   open  the same capsule becomes a recessed well, like the key field, holding
 *         the address and a round Activate-style send button
 *   sent  the chip again, with a check, for 12 s, then back to rest
 * The capsule resizes between them (framer `layout`); the content swaps with
 * the tab's ink timing (INK / EASE_ENTER), and none of it moves under
 * prefers-reduced-motion. Styles: `.natively-key-resend` in index.css.
 *
 * The server (POST /keys/resend, via the main process) sends the key to the
 * address on file and never returns it, and answers the same whether or not a
 * key exists, so nothing here says "found" or "not found".
 * Platform-neutral: renderer UI plus one fetch in the main process.
 */
type Phase = 'rest' | 'open' | 'sent';

const SENT_HOLD_MS = 12_000;

export function KeyResendHelp() {
  const t = useT();
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('rest');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const returnFocus = useRef(false);

  // "Sent" is a moment, not a place: it hands the pill back after a while.
  useEffect(() => {
    if (phase !== 'sent') return;
    const id = window.setTimeout(() => setPhase('rest'), SENT_HOLD_MS);
    return () => window.clearTimeout(id);
  }, [phase]);

  // Closing with the keyboard puts focus back on the trigger it came from. A
  // ref callback, not an effect: with mode="wait" the trigger mounts only after
  // the form's exit animation, so an effect on `phase` would find no button.
  const trigger = (el: HTMLButtonElement | null) => {
    if (el && returnFocus.current) {
      returnFocus.current = false;
      el.focus();
    }
  };

  const errorText = (code?: string) =>
    code === 'rate_limited'
      ? t('Too many tries. Please try again in an hour.')
      : code === 'invalid_email'
        ? t("That doesn't look like an email address.")
        : t("Couldn't reach Natively. Check your connection and try again.");

  const close = (fromKeyboard = false) => {
    returnFocus.current = fromKeyboard;
    setError(null);
    setPhase('rest');
  };

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
  const capsule = { duration: reduce ? 0 : SETTLE.activate, ease: EASE_ENTER };
  const ink = {
    initial: reduce ? false : ({ opacity: 0, filter: 'blur(3px)' } as const),
    animate: { opacity: 1, filter: 'blur(0px)' },
    exit: reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, filter: 'blur(3px)', transition: { duration: INK.out, ease: EASE_LEAVE } },
    transition: { duration: reduce ? 0 : INK.in, ease: EASE_ENTER },
  };

  return (
    <div className="mt-3 flex flex-col items-center px-1">
      <motion.div
        layout
        transition={capsule}
        data-state={phase}
        className={`natively-key-resend ${phase === 'open' ? '' : 'lg-chip'} max-w-full`}
        style={{ borderRadius: 9999 }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {phase === 'rest' && (
            <motion.p key="rest" layout="position" {...ink} className="natively-key-resend-line">
              <Mail size={12} strokeWidth={2} aria-hidden="true" className="natively-key-resend-icon" />
              <span>
                {t('Bought a key but no email? Check Spam and Promotions, or')}{' '}
                <button
                  ref={trigger}
                  type="button"
                  onClick={() => { setError(null); setPhase('open'); }}
                  className="natively-key-resend-action"
                >
                  {t('email it again')}
                </button>
              </span>
            </motion.p>
          )}

          {phase === 'open' && (
            <motion.form
              key="open"
              layout="position"
              {...ink}
              onSubmit={send}
              // Our own error line, not Chromium's native bubble.
              noValidate
              onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(true); } }}
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
                onClick={() => close(false)}
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
          )}

          {phase === 'sent' && (
            <motion.p key="sent" layout="position" {...ink} role="status" className="natively-key-resend-line">
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
          <motion.p
            key={error}
            role="alert"
            initial={reduce ? false : { opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: reduce ? 0 : INK.out } }}
            transition={{ duration: reduce ? 0 : INK.in, ease: EASE_ENTER }}
            className="mt-2 flex items-center gap-1.5 text-[11px] leading-relaxed text-[var(--text-danger)]"
          >
            <AlertCircle size={12} className="shrink-0" />
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
