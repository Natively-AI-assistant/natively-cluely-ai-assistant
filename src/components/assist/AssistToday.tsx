import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Mail, X } from 'lucide-react';
import { useT } from '../../i18n';
import { buildReminderDraft, clipboardText, mailtoUrl, reminderGmailUrl, type ReminderDraft, type ReminderKind } from '../../lib/reminderDrafts.mjs';
import type { AssistEvent, AssistSender } from '../../types/assist';
import { copyText } from '../../lib/copyText';

/**
 * The calendar reminder's "Running late" draft, opened above the launcher's
 * meeting list (main: electron/services/assist/reminderDraftWindow.ts). It
 * shows only when the reminder asks for it and closes with its X.
 *
 * The launcher's list itself holds meeting names only (2026-11-01): the
 * "Coming up today", "Catch up" and "Yours to do" sections were taken out.
 */

const HEADING = 'text-[13px] font-medium text-text-secondary mb-3 pl-1';
const SMALL_BUTTON = 'inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 h-7 rounded-md text-text-primary transition-colors';

interface AssistTodayProps {
  isLight: boolean;
  /** A draft to open (the calendar reminder's "Running late"); a new `seq` is a new request. */
  draftRequest?: { event: AssistEvent; kind: ReminderKind; seq: number } | null;
}

export const AssistToday: React.FC<AssistTodayProps> = ({ isLight, draftRequest }) => {
  const t = useT();
  const [draftFor, setDraftFor] = useState<{ event: AssistEvent; kind: ReminderKind } | null>(null);
  const [sender, setSender] = useState<AssistSender | null>(null);

  useEffect(() => {
    window.electronAPI?.assistGetSender?.().then((s) => setSender(s ?? null)).catch(() => {});
  }, []);

  // App receives the reminder's request (always mounted) and the Launcher
  // hands it down here.
  const handledDraft = useRef(draftRequest?.seq ?? 0);
  useEffect(() => {
    if (!draftRequest || draftRequest.seq === handledDraft.current) return;
    handledDraft.current = draftRequest.seq;
    setDraftFor({ event: draftRequest.event, kind: draftRequest.kind });
  }, [draftRequest]);

  if (!draftFor) return null;

  return (
    <section>
      <h3 className={HEADING}>{draftFor.event.title || t('Meeting')}</h3>
      <ReminderDraftPanel event={draftFor.event} kind={draftFor.kind} sender={sender} isLight={isLight} onClose={() => setDraftFor(null)} />
    </section>
  );
};

/** A reminder draft: copy it, or open it in a mail app. Never sent by Natively. */
const ReminderDraftPanel: React.FC<{ event: AssistEvent; kind: ReminderKind; sender: AssistSender | null; isLight: boolean; onClose: () => void }> = ({ event, kind, sender, isLight, onClose }) => {
  const t = useT();
  const [minutes, setMinutes] = useState(5);
  const [note, setNote] = useState<string | null>(null);
  const draft: ReminderDraft = useMemo(
    () => buildReminderDraft({ kind, event, senderName: sender?.name ?? null, minutesLate: minutes }),
    [kind, event, sender?.name, minutes],
  );
  const hover = isLight ? 'bg-black/[0.05] hover:bg-black/[0.09]' : 'bg-white/[0.06] hover:bg-white/[0.1]';

  const copy = async (): Promise<boolean> => {
    try {
      await copyText(clipboardText(draft));
      setNote(t('Copied. Paste it into your email or chat.'));
      return true;
    } catch {
      setNote(t('Could not copy. Select the text and copy it instead.'));
      return false;
    }
  };
  const openMail = async () => {
    const url = mailtoUrl(draft);
    if (!url) { await copy(); return; }
    const r = await window.electronAPI?.assistOpenMailDraft?.(url).catch(() => null);
    if (!r?.ok) {
      await copy();
      setNote(r?.error ?? t('No mail app opened. The draft is on your clipboard instead.'));
    }
  };
  const openGmail = () => {
    void window.electronAPI?.openExternal?.(reminderGmailUrl(draft, sender?.email ?? undefined));
  };

  return (
    <div className="mx-3 mb-2 mt-1 pl-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] font-medium text-text-secondary truncate">{t('To')}: {draft.to.join(', ')}</div>
        <button type="button" aria-label={t('Close')} onClick={onClose} className="p-1 text-text-tertiary hover:text-text-primary transition-colors"><X size={13} /></button>
      </div>
      {kind === 'running_late' && (
        <div className="flex items-center gap-1.5">
          {[5, 10, 15].map((n) => (
            <button key={n} type="button" onClick={() => setMinutes(n)} className={`${SMALL_BUTTON} h-6 ${minutes === n ? (isLight ? 'bg-black/[0.12]' : 'bg-white/[0.16]') : hover}`}>
              {n} {t('min')}
            </button>
          ))}
        </div>
      )}
      <div className="text-[13px] text-text-primary font-medium select-text">{draft.subject}</div>
      <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-text-primary select-text">{draft.body}</pre>
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <button type="button" onClick={() => { void copy(); }} className={`${SMALL_BUTTON} ${hover}`}><Copy size={12} />{t('Copy')}</button>
        <button type="button" onClick={() => { void openMail(); }} className={`${SMALL_BUTTON} ${hover}`}><Mail size={12} />{t('Open in mail app')}</button>
        {sender?.google && (
          <button type="button" onClick={openGmail} className={`${SMALL_BUTTON} ${hover}`}>{t('Open in Gmail')}</button>
        )}
      </div>
      {note && <p className="text-[12px] text-text-secondary">{note}</p>}
    </div>
  );
};

export default AssistToday;
