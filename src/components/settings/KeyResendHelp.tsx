import React, { useState } from 'react';
import { useT } from '../../i18n';

/**
 * "Bought a key but no email?" — shown under the activation card while no key
 * is saved. Key emails sometimes land in Spam or Promotions; this says so and
 * lets the buyer have the key sent again.
 *
 * The server (POST /keys/resend, via the main process) sends the key to the
 * address on file and never returns it, and answers the same whether or not a
 * key exists, so the message here never says "found" or "not found".
 * Platform-neutral: renderer UI plus one fetch in the main process.
 */
export function KeyResendHelp() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const errorText = (code?: string) =>
    code === 'rate_limited'
      ? t('Too many tries. Please try again in an hour.')
      : code === 'invalid_email'
        ? t("That doesn't look like an email address.")
        : t("Couldn't reach Natively. Check your connection and try again.");

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!address.includes('@')) {
      setNote({ tone: 'error', text: errorText('invalid_email') });
      return;
    }
    setSending(true);
    setNote(null);
    try {
      const r = await window.electronAPI?.resendNativelyKey?.(address);
      if (r?.ok) {
        setNote({
          tone: 'ok',
          text: t("If that email has a Natively API key, we've sent it again. It can take a minute; check Spam and Promotions too."),
        });
        setOpen(false);
      } else {
        setNote({ tone: 'error', text: errorText(r?.error) });
      }
    } catch {
      setNote({ tone: 'error', text: errorText('network_error') });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-2.5 px-1 text-[11px] leading-relaxed text-text-tertiary text-center">
      <p>
        {t('Bought a key but no email? Check Spam and Promotions, or')}{' '}
        <button
          type="button"
          onClick={() => { setOpen(true); setNote(null); }}
          className="text-text-secondary hover:text-text-primary underline decoration-border-muted underline-offset-[3px] transition-colors duration-150 motion-reduce:transition-none"
        >
          {t('email it again')}
        </button>
        .
      </p>

      {open && (
        <form onSubmit={send} className="mt-2 flex items-center gap-2 justify-center">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('Email you paid with')}
            autoComplete="email"
            spellCheck={false}
            autoFocus
            className="h-8 w-[220px] px-2.5 text-[12px] rounded-md bg-transparent border border-border-muted text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-text-tertiary"
          />
          <button
            type="submit"
            disabled={sending || !email.trim()}
            className="h-8 px-3 text-[12px] rounded-md border border-border-muted text-text-secondary hover:text-text-primary disabled:opacity-50 disabled:cursor-default"
          >
            {sending ? t('Sending…') : t('Send')}
          </button>
        </form>
      )}

      {note && (
        <p
          role="status"
          className={`mt-2 ${note.tone === 'error' ? 'text-[var(--text-danger)]' : 'text-text-secondary'}`}
        >
          {note.text}
        </p>
      )}
    </div>
  );
}
