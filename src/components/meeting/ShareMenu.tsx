// The meeting page's Share menu: Copy (the tab you are on, as text), File (a
// PDF), Link, then Slack, Notion or a CRM. Copy was its own button beside Share
// until the owner folded it in (2026-10-17); the HTML "Share as file" went the
// same day, and the labels were cut to one word. Quiet text, no card; the menu
// is the tone menu's dropdown.
//
// Nothing leaves the computer until the user presses Send in a destination's
// dialog. Slack opens on an editable draft; a CRM shows who matched first.
// Connections are made in Settings › Connectors, which a dialog links to when
// a destination is not set up yet.

import React, { useEffect, useId, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Check, Contact, Copy, ExternalLink, FileDown, Link2, Loader2, Share } from 'lucide-react';
import { useT } from '../../i18n';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { SettingsSwitch } from '../settings/SettingsRow';
import { ConnectorMark } from '../settings/ConnectorMark';
import type { ConnectionsStatus, CrmMatchPreview, CrmService, MeetingOutputsApi } from '../../types/meetingOutputs';
import { crmSendable, notionResultView, slackDraftStatus } from './outputsView';
import { copyText } from '../../lib/copyText';

const api = (): MeetingOutputsApi | undefined => window.electronAPI?.meetingOutputs;
const MENU_CLOSE_MS = 150;
const DIALOG_LAYER = 400;
const CRM_NAMES: Record<CrmService, string> = { hubspot: 'HubSpot', attio: 'Attio', affinity: 'Affinity', salesforce: 'Salesforce', pipedrive: 'Pipedrive' };

type DialogKind = 'slack' | 'notion' | 'crm' | 'message';

const BTN = 'px-3 py-1.5 rounded-md text-xs font-medium border border-border-subtle bg-bg-input hover:bg-bg-elevated text-text-primary transition-colors flex items-center gap-1.5 disabled:opacity-50';
const FIELD_LABEL = 'text-xs font-medium text-text-secondary uppercase tracking-wide block';

/** Slack mrkdwn shown as it will read: *bold*, _italic_, `code`, line breaks. Text only, no HTML injected. */
function SlackPreview({ text }: { text: string }) {
    const lines = text.split('\n');
    const render = (line: string, key: number) => {
        const parts: React.ReactNode[] = [];
        const re = /(\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`)/g;
        let last = 0;
        let m: RegExpExecArray | null;
        let i = 0;
        while ((m = re.exec(line)) !== null) {
            if (m.index > last) parts.push(line.slice(last, m.index));
            const inner = m[0].slice(1, -1);
            if (m[0][0] === '*') parts.push(<strong key={i++} className="font-semibold text-text-primary">{inner}</strong>);
            else if (m[0][0] === '_') parts.push(<em key={i++}>{inner}</em>);
            else parts.push(<code key={i++} className="font-mono text-[11px]">{inner}</code>);
            last = m.index + m[0].length;
        }
        if (last < line.length) parts.push(line.slice(last));
        return <div key={key} className="min-h-[1.2em]">{parts}</div>;
    };
    return <div className="text-[13px] leading-relaxed text-text-secondary">{lines.map(render)}</div>;
}

export const ShareMenu: React.FC<{
    meetingId: string;
    disabled?: boolean;
    hasTranscript: boolean;
    /**
     * Copies the tab the user is on; resolves true once it is on the clipboard.
     * Left out where a Copy button already sits beside Share (the notepad's
     * notes, 2026-11-01: "remove the copy from the dropdown, since its
     * repetition"), and then the menu has no Copy row.
     */
    onCopy?: () => Promise<boolean>;
    /** The menu opened (the notepad counts it for its telemetry, 2026-11-01). */
    onOpen?: () => void;
    /**
     * The notepad's toolbar (2026-11-01): the share icon alone, in the caller's pill
     * (triggerClassName/triggerStyle), its menu hanging from the button's left edge like
     * the Notes menu beside it. "Saved" / "Copied" still show as the check and are read out.
     */
    iconOnly?: boolean;
    triggerClassName?: string;
    triggerStyle?: React.CSSProperties;
}> = ({ meetingId, disabled, hasTranscript, onCopy, onOpen, iconOnly, triggerClassName, triggerStyle }) => {
    const t = useT();
    const isLight = useResolvedTheme() === 'light';
    const [open, setOpen] = useState(false);
    const [closing, setClosing] = useState(false);
    const [saved, setSaved] = useState<string | null>(null);
    const [busy, setBusy] = useState<null | 'pdf' | 'link'>(null);
    const [dialog, setDialog] = useState<DialogKind | null>(null);
    const [message, setMessage] = useState<string>('');
    const [conn, setConn] = useState<ConnectionsStatus | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const menuId = useId();

    useEffect(() => () => { clearTimeout(closeTimer.current); clearTimeout(savedTimer.current); }, []);

    // Opened from the keyboard, the first item takes focus (and shows it); opened
    // with the pointer, the menu itself does, so no row is lit until hovered.
    const viaKeyboard = useRef(false);
    const openMenu = (fromKeyboard: boolean) => {
        viaKeyboard.current = fromKeyboard;
        clearTimeout(closeTimer.current);
        setClosing(false);
        setOpen(true);
        onOpen?.();
        void api()?.getConnections().then((c) => c && setConn(c)).catch(() => {});
    };
    const close = (refocus: boolean) => {
        setOpen(false);
        setClosing(true);
        clearTimeout(closeTimer.current);
        closeTimer.current = setTimeout(() => setClosing(false), MENU_CLOSE_MS);
        if (refocus) rootRef.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.focus({ preventScroll: true });
    };
    useEffect(() => {
        if (!open) return;
        if (viaKeyboard.current) itemRefs.current[0]?.focus({ preventScroll: true });
        else menuRef.current?.focus({ preventScroll: true });
        const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) close(false); };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);
    const onMenuKeyDown = (e: React.KeyboardEvent) => {
        const items = itemRefs.current.filter(Boolean) as HTMLButtonElement[];
        const at = items.indexOf(document.activeElement as HTMLButtonElement);
        const go = (i: number) => { e.preventDefault(); items[(i + items.length) % items.length]?.focus(); };
        if (e.key === 'ArrowDown') go(at + 1);
        else if (e.key === 'ArrowUp') go(at - 1);
        else if (e.key === 'Home') go(0);
        else if (e.key === 'End') go(items.length - 1);
        else if (e.key === 'Escape') { e.preventDefault(); close(true); }
        else if (e.key === 'Tab') close(false);
    };

    const flashSaved = (label: string) => {
        setSaved(label);
        clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaved(null), 2000);
    };
    const showMessage = (text: string) => { setMessage(text); setDialog('message'); };
    // A destination dialog reads the connections fresh, so one set up a moment ago in Settings shows.
    useEffect(() => {
        if (!dialog || dialog === 'message') return;
        void api()?.getConnections().then((c) => c && setConn(c)).catch(() => {});
    }, [dialog]);

    const exportPdf = async () => {
        setBusy('pdf');
        const res = await api()?.exportPdf(meetingId).catch(() => undefined);
        setBusy(null);
        if (res?.ok) flashSaved(t('Saved'));
        else if (!res?.canceled) showMessage(res?.message || t('The PDF could not be made. Try again.'));
    };

    const copy = async () => {
        if (onCopy && await onCopy().catch(() => false)) flashSaved(t('Copied'));
    };

    // Link (owner, 2026-10-18: no card, "it says copied"): makes the link, or hands
    // back the one the meeting already has, and puts it on the clipboard. Main never
    // makes a second link for a meeting, nor one while its record is unreadable.
    const shareLink = async () => {
        setBusy('link');
        const res = await api()?.createShareLink(meetingId, { includeTranscript: true }).catch(() => undefined);
        setBusy(null);
        if (!res?.ok || !res.link) { showMessage(res?.message || t('The link could not be made. Try again.')); return; }
        const url = res.link.url;
        copyText(url).then(() => flashSaved(t('Copied'))).catch(() => showMessage(`${t('The link could not be copied. Here it is:')} ${url}`));
    };

    // One column: Copy (the tab you are on), File (a PDF) and Link, a rule, then
    // the destinations under their own logos, so no "Send to" is needed. The CRM
    // row is the connected CRM by name (the one the CRM dialog opens on), or
    // "CRM" while none is.
    const crm = (['hubspot', 'attio', 'affinity', 'salesforce', 'pipedrive'] as CrmService[]).find((sv) => conn?.[sv]?.connected);
    type Item = { key: string; label: string; icon: React.ReactNode; run: () => void; brand?: boolean };
    const keep: Item[] = [
        ...(onCopy ? [{ key: 'copy', label: t('Copy'), icon: <Copy size={14} />, run: () => void copy() }] : []),
        { key: 'pdf', label: t('File'), icon: <FileDown size={14} />, run: () => void exportPdf() },
        { key: 'link', label: t('Link'), icon: <Link2 size={14} />, run: () => void shareLink() },
    ];
    const send: Item[] = [
        { key: 'slack', label: 'Slack', icon: <ConnectorMark id="slack" size={14} />, brand: true, run: () => setDialog('slack') },
        { key: 'notion', label: 'Notion', icon: <ConnectorMark id="notion" size={14} />, brand: true, run: () => setDialog('notion') },
        crm
            ? { key: 'crm', label: CRM_NAMES[crm], icon: <ConnectorMark id={crm} size={14} />, brand: true, run: () => setDialog('crm') }
            : { key: 'crm', label: 'CRM', icon: <Contact size={14} />, run: () => setDialog('crm') },
        // Only once a directory key is saved: looks the attendees up and files
        // title / company suggestions. Nothing is applied here.
        ...(conn?.clearbit?.connected ? [{
            key: 'enrich',
            label: t('Look up attendees'),
            icon: <Contact size={14} />,
            run: () => {
                const failed = t('The lookup did not finish. Try again.');
                void api()?.enrichAttendees(meetingId).then((r) => showMessage(r?.message || failed)).catch(() => showMessage(failed));
            },
        }] : []),
    ];
    // Styled from its neighbours (owner, 2026-10-17: "visually disconnected"). It
    // borrows the notes tab switcher's language: grey --text-secondary labels that
    // turn --text-primary when lit, and the switcher's well grey (--bg-item-surface)
    // as the lit row. The surface is the tinted --bg-elevated near-white, never pure
    // white. Sized to the header it hangs from (owner: 36px rows read "very big"):
    // 12px labels like the Share trigger, 14px icons, 28px rows like the Calendar
    // chip's menu beside it; concentric 11px / 7px corners over a 4px inset.
    // Hovering a row focuses it, so the pointer and the keyboard share one lit row.
    const lit = isLight
        ? 'focus:bg-bg-item-surface focus:text-text-primary'
        : 'focus:bg-bg-item-surface focus:text-[#E9E9E9]';
    let flat = 0;
    const itemButton = (item: Item) => {
        const at = flat++;
        return (
            <button
                key={item.key}
                ref={(el) => { itemRefs.current[at] = el; }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => { close(true); item.run(); }}
                onMouseEnter={(e) => e.currentTarget.focus({ preventScroll: true })}
                className={`group w-full h-7 flex items-center gap-2 pl-2 pr-3 rounded-[7px] text-left text-[12px] font-medium text-text-secondary outline-none focus:outline-none transition-colors duration-[120ms] ${lit}`}
            >
                {/* One icon style: logos are drawn in the same grey as the line icons;
                    an icon steps up one grey with its row. */}
                <span className={`w-3.5 shrink-0 flex justify-center text-text-tertiary group-focus:text-text-secondary transition-colors duration-[120ms]${item.brand ? ' grayscale opacity-70 group-focus:opacity-100' : ''}`}>{item.icon}</span>
                <span className="whitespace-nowrap">{item.label}</span>
            </button>
        );
    };

    return (
        <div ref={rootRef} className="relative shrink-0">
            <button
                type="button"
                disabled={disabled || busy !== null}
                onClick={(e) => (open ? close(false) : openMenu(e.detail === 0))}
                onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); openMenu(true); } }}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={menuId}
                aria-label={iconOnly ? t('Share') : undefined}
                title={iconOnly ? t('Share') : undefined}
                style={iconOnly ? triggerStyle : undefined}
                className={iconOnly
                    ? `${triggerClassName ?? ''} disabled:opacity-40 disabled:cursor-default`
                    : 'flex items-center gap-2 text-xs font-medium text-text-secondary hover:text-text-primary transition-[color,opacity] disabled:opacity-40 disabled:cursor-default disabled:hover:text-text-secondary'}
            >
                {busy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" size={14} aria-hidden="true" />
                ) : (
                    <span className="t-icon-swap w-3.5 h-3.5" data-state={saved ? 'b' : 'a'} aria-hidden="true">
                        <Share className="t-icon w-3.5 h-3.5" data-icon="a" size={14} />
                        <Check className="t-icon w-3.5 h-3.5 text-emerald-500" data-icon="b" size={14} />
                    </span>
                )}
                {iconOnly ? (
                    <span className="sr-only" role="status">{saved}</span>
                ) : (
                <span className="grid">
                    <span aria-hidden="true" className="invisible col-start-1 row-start-1">{t('Share')}</span>
                    <span aria-hidden="true" className="invisible col-start-1 row-start-1">{t('Saved')}</span>
                    <span aria-hidden="true" className="invisible col-start-1 row-start-1">{t('Copied')}</span>
                    <span className="col-start-1 row-start-1">{saved || t('Share')}</span>
                </span>
                )}
            </button>
            <div
                ref={menuRef}
                id={menuId}
                role="menu"
                tabIndex={-1}
                data-origin={iconOnly ? 'top-left' : 'top-right'}
                inert={!open}
                onKeyDown={onMenuKeyDown}
                // Leaving the menu with the pointer unlights the row it was on.
                onMouseLeave={() => menuRef.current?.focus({ preventScroll: true })}
                // Hangs mt-2 under the trigger like the Calendar chip's menu beside it.
                // 110px wide (owner); the longest label, a connected "Salesforce", still fits.
                // Dark keeps the app's popover surface: --bg-elevated there is the page itself.
                className={`t-dropdown${open ? ' is-open' : closing ? ' is-closing' : ''} absolute ${iconOnly ? 'left-0 mt-1.5' : 'right-[-4px] mt-2'} top-full z-50 w-[110px] p-1 rounded-[11px] border outline-none ${isLight
                    ? 'bg-bg-elevated border-border-subtle shadow-[0_10px_32px_-6px_rgba(28,28,40,0.12),0_1px_2px_rgba(28,28,40,0.04)]'
                    : 'bg-[#1C1C1F] border-white/[0.08] shadow-[0_10px_32px_-6px_rgba(0,0,0,0.55),0_1px_2px_rgba(0,0,0,0.3)]'}`}
            >
                {keep.map(itemButton)}
                <div role="separator" className={`mx-2 my-1 h-px ${isLight ? 'bg-black/[0.06]' : 'bg-white/[0.08]'}`} />
                {send.map(itemButton)}
            </div>

            <OutputDialog
                kind={dialog}
                meetingId={meetingId}
                hasTranscript={hasTranscript}
                conn={conn}
                message={message}
                onClose={() => setDialog(null)}
            />
        </div>
    );
};

// ── Dialogs ──────────────────────────────────────────────────────────────

const DialogShell: React.FC<{ open: boolean; onClose: () => void; busy?: boolean; title: string; children: React.ReactNode; footer: React.ReactNode; wide?: boolean }> = ({ open, onClose, busy, title, children, footer, wide }) => (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
        <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 bg-black bg-opacity-50" style={{ zIndex: DIALOG_LAYER }} />
            <DialogPrimitive.Content
                className={`fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 ${wide ? 'w-[560px]' : 'w-[420px]'} max-w-[92vw] max-h-[86vh] flex flex-col bg-bg-elevated border border-border-subtle rounded-2xl shadow-2xl p-5`}
                style={{ zIndex: DIALOG_LAYER }}
                aria-describedby={undefined}
            >
                <DialogPrimitive.Title className="text-sm font-medium text-text-primary">{title}</DialogPrimitive.Title>
                <div className="mt-3 min-h-0 flex-1 overflow-y-auto">{children}</div>
                <div className="flex items-center justify-end gap-2 mt-5">{footer}</div>
            </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
);

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="flex items-center justify-between gap-4 py-2">
        <span className="text-xs text-text-primary">{label}</span>
        {children}
    </div>
);

const ErrorLine: React.FC<{ text?: string | null }> = ({ text }) => (text ? <p role="alert" className="mt-3 text-xs leading-relaxed text-red-500">{text}</p> : null);
const DoneLine: React.FC<{ text?: string | null }> = ({ text }) => (text ? <p className="mt-3 flex items-center gap-1.5 text-xs text-text-primary"><Check size={14} className="text-emerald-500" />{text}</p> : null);

const NotConnected: React.FC<{ service: string; onClose: () => void }> = ({ service, onClose }) => {
    const t = useT();
    return (
        <div className="space-y-3">
            <p className="text-xs leading-relaxed text-text-secondary">{t(`Connect ${service} in Settings, Connectors first. Nothing is sent until you press Send.`)}</p>
            <button
                type="button"
                className={BTN}
                onClick={() => { onClose(); void window.electronAPI?.openSettingsTab?.('connections'); }}
            >
                {t('Open Connectors')}
            </button>
        </div>
    );
};

const OutputDialog: React.FC<{
    kind: DialogKind | null;
    meetingId: string;
    hasTranscript: boolean;
    conn: ConnectionsStatus | null;
    message: string;
    onClose: () => void;
}> = ({ kind, meetingId, hasTranscript, conn, message, onClose }) => {
    const t = useT();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState<string | null>(null);
    // The transcript always goes with the notes (owner, 2026-10-17: "include it
    // regardless"); a meeting without one sends none.
    const includeTranscript = true;
    const [includeActions, setIncludeActions] = useState(true);
    // Slack
    const [webhookId, setWebhookId] = useState('');
    const [draft, setDraft] = useState('');
    const [preview, setPreview] = useState(false);
    // Notion
    const [pageUrl, setPageUrl] = useState<string | undefined>();
    // A page Notion made but did not fill: shown with its link, until the user adds the rest or starts over.
    const [partialPage, setPartialPage] = useState<{ url?: string; message: string } | null>(null);
    // CRM
    const [crm, setCrm] = useState<CrmService | null>(null);
    const [matches, setMatches] = useState<CrmMatchPreview | null>(null);
    const [chosen, setChosen] = useState<Set<string>>(new Set());

    const crmConnected = (['hubspot', 'attio', 'affinity', 'salesforce', 'pipedrive'] as CrmService[]).filter((s) => conn?.[s]?.connected);

    // Reset on every open.
    useEffect(() => {
        if (!kind) return;
        setBusy(false); setError(null); setDone(null); setPreview(false); setPageUrl(undefined); setPartialPage(null); setMatches(null); setChosen(new Set());
        setIncludeActions(true);
        if (kind === 'slack') setWebhookId(conn?.slack.webhooks[0]?.id || '');
        if (kind === 'crm') setCrm(crmConnected[0] || null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [kind]);

    // Connections can arrive after the dialog opened (read fresh on open): pick the
    // first channel / CRM then, unless the user already chose one that still exists.
    useEffect(() => {
        if (!kind || !conn) return;
        if (kind === 'slack' && !conn.slack.webhooks.some((w) => w.id === webhookId)) setWebhookId(conn.slack.webhooks[0]?.id || '');
        if (kind === 'crm' && (!crm || !conn[crm]?.connected)) setCrm(crmConnected[0] || null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [kind, conn]);

    // The Slack draft, recomposed when action items are switched.
    useEffect(() => {
        if (kind !== 'slack' || !conn?.slack.webhooks.length) return;
        let live = true;
        void api()?.composeSlack(meetingId, { includeActionItems: includeActions }).then((res) => {
            if (!live) return;
            if (res?.ok) setDraft(res.text || ''); else setError(res?.message || t('The draft could not be made.'));
        });
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [kind, includeActions, conn?.slack.webhooks.length]);

    // Who in the CRM, before anything is written.
    useEffect(() => {
        if (kind !== 'crm' || !crm) return;
        let live = true;
        // A new target starts from nothing: no people carried over from the last CRM's preview.
        setMatches(null); setChosen(new Set()); setError(null); setBusy(true);
        void api()?.previewCrm(meetingId, crm).then((res) => {
            if (!live) return;
            setBusy(false);
            if (!res?.ok) { setError(res?.message || t('The CRM could not be searched.')); return; }
            setMatches(res);
            setChosen(new Set(res.attendees.filter((a) => a.matched).map((a) => a.email)));
        });
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [kind, crm]);

    // A Notion answer: done, a half-made page (kept with its link), or a plain failure.
    const applyNotion = (res: Parameters<typeof notionResultView>[0]) => {
        const view = notionResultView(res);
        if (view.state === 'done') { setPartialPage(null); setPageUrl(view.url); setDone(t('The page is in Notion.')); return; }
        if (view.state === 'partial') { setPartialPage({ url: view.url, message: view.message }); return; }
        setError(view.message);
    };

    const run = async (fn: () => Promise<void>) => {
        setBusy(true); setError(null); setDone(null);
        try { await fn(); } catch { setError(t('Something went wrong. Try again.')); } finally { setBusy(false); }
    };

    const closeBtn = (label = t('Cancel')) => (
        <button type="button" className={BTN} onClick={onClose} disabled={busy}>{label}</button>
    );
    const primary = (label: string, onClick: () => void, enabled = true) => (
        <button type="button" className={BTN} onClick={onClick} disabled={busy || !enabled}>
            {busy && <Loader2 size={12} className="animate-spin" />}
            {label}
        </button>
    );

    if (kind === 'message') {
        return (
            <DialogShell open title={t('Could not finish')} onClose={onClose} footer={closeBtn(t('Close'))}>
                <p className="text-xs leading-relaxed text-text-secondary">{message}</p>
            </DialogShell>
        );
    }

    if (kind === 'slack') {
        const hooks = conn?.slack.webhooks || [];
        const target = hooks.find((w) => w.id === webhookId);
        // The same limit main enforces: over it, Send is off and the notice says by how much. Never cut.
        const limit = slackDraftStatus(draft);
        return (
            <DialogShell
                open
                wide
                title={t('Send to Slack')}
                onClose={onClose}
                busy={busy}
                footer={done ? closeBtn(t('Done')) : hooks.length ? <>{closeBtn()}{primary(target ? `${t('Send to')} ${target.label}` : t('Send'), () => void run(async () => {
                    const res = await api()?.sendSlack({ webhookId, meetingId, text: draft });
                    if (res?.ok) setDone(`${t('Sent to')} ${target?.label || 'Slack'}.`); else setError(res?.message || t('The message was not sent.'));
                }), !limit.empty && limit.over === 0 && !!target)}</> : closeBtn(t('Close'))}
            >
                {!hooks.length ? <NotConnected service="Slack" onClose={onClose} /> : (
                    <div className="space-y-3">
                        <label className="block">
                            <span className={FIELD_LABEL}>{t('Channel')}</span>
                            <select
                                className="mt-1 w-full rounded-lg border border-border-subtle bg-bg-input px-3 py-2 text-xs text-text-primary focus:outline-none"
                                value={webhookId}
                                onChange={(e) => setWebhookId(e.target.value)}
                                disabled={busy || !!done}
                            >
                                {hooks.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
                            </select>
                        </label>
                        <Row label={t('Include action items')}>
                            <SettingsSwitch checked={includeActions} onChange={() => setIncludeActions((v) => !v)} label={t('Include action items')} disabled={busy || !!done} />
                        </Row>
                        <div>
                            <div className="flex items-center justify-between">
                                <span className={FIELD_LABEL}>{t('Message')}</span>
                                <button type="button" className="text-xs font-medium text-text-secondary hover:text-text-primary transition-colors" onClick={() => setPreview((v) => !v)}>
                                    {preview ? t('Edit') : t('Preview')}
                                </button>
                            </div>
                            {preview ? (
                                <div className="mt-1 max-h-[320px] overflow-y-auto rounded-lg border border-border-subtle bg-bg-input px-3 py-2">
                                    <SlackPreview text={draft} />
                                </div>
                            ) : (
                                <textarea
                                    className="mt-1 w-full min-h-[220px] max-h-[320px] rounded-lg border border-border-subtle bg-bg-input px-3 py-2 text-xs leading-relaxed text-text-primary font-mono resize-y focus:outline-none"
                                    value={draft}
                                    onChange={(e) => setDraft(e.target.value)}
                                    disabled={busy || !!done}
                                    spellCheck
                                />
                            )}
                            <div className="mt-1 flex items-start justify-between gap-3 text-[11px] text-text-tertiary">
                                <span>{t('Slack formatting: *bold*, _italic_. The meeting title goes on top.')}</span>
                                <span className={`shrink-0 tabular-nums ${limit.over ? 'text-red-500' : ''}`}>{`${limit.length.toLocaleString()} / ${limit.max.toLocaleString()}`}</span>
                            </div>
                            {limit.over > 0 && (
                                <p role="alert" className="mt-1 text-xs leading-relaxed text-red-500">
                                    {`${t('This is')} ${limit.over.toLocaleString()} ${t('characters longer than one Slack message can be. Shorten it, or leave out the action items.')}`}
                                </p>
                            )}
                        </div>
                        <ErrorLine text={error} />
                        <DoneLine text={done} />
                    </div>
                )}
            </DialogShell>
        );
    }

    if (kind === 'notion') {
        const n = conn?.notion;
        return (
            <DialogShell
                open
                title={t('Send to Notion')}
                onClose={onClose}
                busy={busy}
                footer={done
                    ? <>{pageUrl && <button type="button" className={BTN} onClick={() => void api()?.openNotionPage(pageUrl)}><ExternalLink size={12} />{t('Open in Notion')}</button>}{closeBtn(t('Done'))}</>
                    : partialPage
                        // A half-made page: open it, add the rest to it, or start over with a new
                        // page. Create page is gone, so a second page is never made by accident.
                        ? <>
                            {partialPage.url && <button type="button" className={BTN} onClick={() => void api()?.openNotionPage(partialPage.url!)}><ExternalLink size={12} />{t('Open the partial page')}</button>}
                            {primary(t('Start over with a new page'), () => void run(async () => applyNotion(await api()?.sendNotion(meetingId, { includeTranscript, startOver: true }))))}
                            {primary(t('Add the rest'), () => void run(async () => applyNotion(await api()?.resumeNotion(meetingId))))}
                        </>
                        : n?.connected && n.parent ? <>{closeBtn()}{primary(t('Create page'), () => void run(async () => applyNotion(await api()?.sendNotion(meetingId, { includeTranscript }))))}</> : closeBtn(t('Close'))}
            >
                {!n?.connected ? <NotConnected service="Notion" onClose={onClose} /> : !n.parent ? (
                    <div className="space-y-3">
                        <p className="text-xs leading-relaxed text-text-secondary">{t('Pick where Notion pages go in Settings, Connectors.')}</p>
                        <button type="button" className={BTN} onClick={() => { onClose(); void window.electronAPI?.openSettingsTab?.('connections'); }}>{t('Open Connectors')}</button>
                    </div>
                ) : (
                    <div>
                        <p className="text-xs leading-relaxed text-text-secondary">
                            {hasTranscript ? t('A new page with the notes, action items and transcript, in') : t('A new page with the notes and action items, in')} <span className="font-medium text-text-primary">{n.parent.title}</span>.
                        </p>
                        {partialPage && <p role="alert" className="mt-3 text-xs leading-relaxed text-text-secondary">{partialPage.message}</p>}
                        <ErrorLine text={error} />
                        <DoneLine text={done} />
                    </div>
                )}
            </DialogShell>
        );
    }

    if (kind === 'crm') {
        const matched = matches?.attendees.filter((a) => a.matched) || [];
        const name = crm ? CRM_NAMES[crm] : 'CRM';
        // Only people a working preview of THIS CRM matched; nothing before that preview.
        const sendable = crmSendable(crm, matches, chosen);
        return (
            <DialogShell
                open
                title={t('Send to CRM')}
                onClose={onClose}
                busy={busy}
                footer={done ? closeBtn(t('Done')) : crmConnected.length ? <>{closeBtn()}{primary(
                    sendable.length === 1 ? t('Add note to 1 person') : `${t('Add note to')} ${sendable.length} ${t('people')}`,
                    () => void run(async () => {
                        if (!crm || !sendable.length) return;
                        const res = await api()?.sendCrm(meetingId, crm, sendable);
                        if (res?.ok) setDone(res.message || `${t('The note is in')} ${name}.`); else setError(res?.message || t('The note was not added.'));
                    }),
                    sendable.length > 0,
                )}</> : closeBtn(t('Close'))}
            >
                {!crmConnected.length ? <NotConnected service="HubSpot, Attio, Affinity or Salesforce" onClose={onClose} /> : (
                    <div className="space-y-3">
                        {crmConnected.length > 1 && (
                            <label className="block">
                                <span className={FIELD_LABEL}>{t('CRM')}</span>
                                <select
                                    className="mt-1 w-full rounded-lg border border-border-subtle bg-bg-input px-3 py-2 text-xs text-text-primary focus:outline-none"
                                    value={crm || ''}
                                    onChange={(e) => { setMatches(null); setChosen(new Set()); setCrm(e.target.value as CrmService); }}
                                    disabled={busy || !!done}
                                >
                                    {crmConnected.map((s) => <option key={s} value={s}>{CRM_NAMES[s]}</option>)}
                                </select>
                            </label>
                        )}
                        {busy && !matches && <p className="flex items-center gap-1.5 text-xs text-text-secondary"><Loader2 size={12} className="animate-spin" />{`${t('Looking up attendees in')} ${name}…`}</p>}
                        {matches && (
                            <>
                                <p className="text-xs leading-relaxed text-text-secondary">
                                    {matched.length
                                        ? `${t('The notes go on each person you tick. Found in')} ${name}: ${matched.length} ${t('of')} ${matches.attendees.length}.`
                                        : `${t('None of the attendees are in')} ${name}. ${t('Add them there first, then try again.')}`}
                                </p>
                                <ul className="divide-y divide-border-subtle">
                                    {matches.attendees.map((a) => (
                                        <li key={a.email} className="flex items-center justify-between gap-3 py-2">
                                            <span className="min-w-0">
                                                <span className={`block truncate text-xs ${a.matched ? 'text-text-primary' : 'text-text-tertiary'}`}>{a.recordName || a.name || a.email}</span>
                                                <span className="block truncate text-[11px] text-text-tertiary">{a.matched ? a.email : `${a.email} · ${t('not in')} ${name}`}</span>
                                            </span>
                                            {a.matched && (
                                                <SettingsSwitch
                                                    checked={chosen.has(a.email)}
                                                    onChange={() => setChosen((s) => { const n = new Set(s); if (n.has(a.email)) n.delete(a.email); else n.add(a.email); return n; })}
                                                    label={a.recordName || a.email}
                                                    disabled={busy || !!done}
                                                />
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </>
                        )}
                        <ErrorLine text={error} />
                        <DoneLine text={done} />
                    </div>
                )}
            </DialogShell>
        );
    }

    return null;
};

export default ShareMenu;
