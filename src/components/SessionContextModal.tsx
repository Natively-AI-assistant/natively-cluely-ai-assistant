// Launcher › "Resume & JD": the resume and job description the AI grounds
// its live answers in. Loaded before a session (a file, or pasted text) and
// kept until changed, so every later session uses them too. Main stores the
// text (services/SessionContext.ts) and adds it to every answer's system
// prompt while "Use in answers" is on. Free; independent of premium Profile
// Intelligence. Text is extracted on this machine.
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Briefcase, Check, ClipboardPaste, FileText, Upload, X } from 'lucide-react';
import { useT } from '../i18n';
import type { SessionContextInfo, SessionContextResult } from '../types/electron';

type Kind = 'resume' | 'jd';

interface Props {
    open: boolean;
    onClose: () => void;
    /** Told after every change, so the launcher pill can show what is loaded. */
    onChange?: (info: SessionContextInfo) => void;
}

const SlotCard: React.FC<{
    kind: Kind;
    info: SessionContextInfo;
    busy: boolean;
    error: string | null;
    onUpload: (kind: Kind) => void;
    onSaveText: (kind: Kind, text: string) => void;
    onClear: (kind: Kind) => void;
}> = ({ kind, info, busy, error, onUpload, onSaveText, onClear }) => {
    const t = useT();
    const slot = info[kind];
    const limit = info.limits[kind];
    const [pasting, setPasting] = useState(false);
    const [draft, setDraft] = useState(slot.text);
    useEffect(() => { if (!pasting) setDraft(slot.text); }, [slot.text, pasting]);

    const title = kind === 'resume' ? t('Resume') : t('Job description');
    const Icon = kind === 'resume' ? FileText : Briefcase;
    const loaded = slot.chars > 0;

    return (
        <div className="rounded-xl border border-border-subtle bg-bg-secondary p-3.5">
            <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${loaded ? 'bg-emerald-500/15 text-emerald-500' : 'bg-bg-elevated text-text-secondary'}`}>
                    {loaded ? <Check size={16} /> : <Icon size={16} />}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-text-primary">{title}</div>
                    <div className="text-xs text-text-tertiary truncate">
                        {loaded
                            ? `${slot.fileName || t('Pasted text')} · ${slot.chars.toLocaleString()} ${t('characters')}`
                            : t('Not added')}
                    </div>
                </div>
                {loaded && (
                    <button
                        onClick={() => onClear(kind)}
                        disabled={busy}
                        className="text-xs text-text-tertiary hover:text-red-400 px-2 py-1 rounded-md transition-colors disabled:opacity-50"
                    >
                        {t('Remove')}
                    </button>
                )}
            </div>

            <div className="flex gap-2 mt-3">
                <button
                    onClick={() => onUpload(kind)}
                    disabled={busy}
                    className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium rounded-lg px-3 py-2 bg-bg-elevated border border-border-subtle text-text-primary hover:border-accent-primary/50 transition-colors disabled:opacity-50"
                >
                    <Upload size={13} />
                    {busy ? t('Reading…') : loaded ? t('Replace file') : t('Upload PDF, DOCX or TXT')}
                </button>
                <button
                    onClick={() => setPasting((p) => !p)}
                    disabled={busy}
                    aria-pressed={pasting}
                    className="flex items-center justify-center gap-1.5 text-xs font-medium rounded-lg px-3 py-2 bg-bg-elevated border border-border-subtle text-text-primary hover:border-accent-primary/50 transition-colors disabled:opacity-50"
                >
                    <ClipboardPaste size={13} />
                    {pasting ? t('Close') : loaded ? t('Edit text') : t('Paste text')}
                </button>
            </div>

            {pasting && (
                <div className="mt-2.5">
                    <textarea
                        aria-label={title}
                        value={draft}
                        maxLength={limit}
                        onChange={(e) => setDraft(e.target.value.slice(0, limit))}
                        placeholder={kind === 'resume'
                            ? t('Paste your resume here…')
                            : t('Paste the job description here…')}
                        className="block w-full h-40 resize-y rounded-lg bg-bg-elevated border border-border-subtle px-3 py-2 text-xs leading-relaxed text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary/60"
                    />
                    <div className="flex items-center justify-between mt-1.5">
                        <span className="text-[11px] text-text-tertiary">{draft.length.toLocaleString()} / {limit.toLocaleString()}</span>
                        <button
                            onClick={() => { onSaveText(kind, draft); setPasting(false); }}
                            disabled={busy || draft.trim() === slot.text}
                            className="text-xs font-medium rounded-md px-3 py-1.5 bg-accent-primary text-white disabled:opacity-40"
                        >
                            {t('Save')}
                        </button>
                    </div>
                </div>
            )}

            {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
        </div>
    );
};

export const SessionContextModal: React.FC<Props> = ({ open, onClose, onChange }) => {
    const t = useT();
    const [info, setInfo] = useState<SessionContextInfo | null>(null);
    const [busy, setBusy] = useState<Kind | 'toggle' | null>(null);
    const [errors, setErrors] = useState<Record<Kind, string | null>>({ resume: null, jd: null });
    const live = useRef(true);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    useEffect(() => {
        live.current = true;
        return () => { live.current = false; };
    }, []);

    useEffect(() => {
        if (!open) return;
        void window.electronAPI?.sessionContextGet?.()
            .then((r) => { if (live.current && r) setInfo(r); })
            .catch(() => {});
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    const apply = async (kind: Kind | 'toggle', call: () => Promise<SessionContextResult> | undefined) => {
        setBusy(kind);
        if (kind !== 'toggle') setErrors((e) => ({ ...e, [kind]: null }));
        try {
            const res = await call();
            if (!live.current || !res) return;
            if (res.success) {
                const { success: _ok, ...next } = res;
                setInfo(next);
                onChangeRef.current?.(next);
            } else if (!res.cancelled && kind !== 'toggle') {
                const message = res.error === 'settings_store_degraded'
                    ? t('Could not save. The settings file is unavailable this session.')
                    : res.error || t('Something went wrong.');
                setErrors((e) => ({ ...e, [kind]: message }));
            }
        } catch {
            if (live.current && kind !== 'toggle') setErrors((e) => ({ ...e, [kind]: t('Something went wrong.') }));
        } finally {
            if (live.current) setBusy(null);
        }
    };

    if (!open || typeof document === 'undefined') return null;
    const api = window.electronAPI;

    return createPortal(
        <div
            className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div role="dialog" aria-modal="true" aria-label={t('Resume & job description')} className="w-full max-w-[480px] max-h-[90vh] overflow-y-auto rounded-2xl border border-border-subtle bg-bg-elevated shadow-2xl p-5">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h2 className="text-base font-semibold text-text-primary">{t('Resume & job description')}</h2>
                        <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                            {t('Answers are written from your resume and tailored to the job. Kept on this device and used in every session until you change it.')}
                        </p>
                    </div>
                    <button onClick={onClose} aria-label={t('Close')} className="p-1 rounded-md text-text-tertiary hover:text-text-primary">
                        <X size={16} />
                    </button>
                </div>

                {!info ? (
                    <div className="py-10 text-center text-xs text-text-tertiary">{t('Loading…')}</div>
                ) : (
                    <>
                        <div className="flex flex-col gap-3 mt-4">
                            {(['resume', 'jd'] as const).map((kind) => (
                                <SlotCard
                                    key={kind}
                                    kind={kind}
                                    info={info}
                                    busy={busy === kind}
                                    error={errors[kind]}
                                    onUpload={(k) => apply(k, () => api?.sessionContextUpload?.(k))}
                                    onSaveText={(k, text) => apply(k, () => api?.sessionContextSetText?.(k, text))}
                                    onClear={(k) => apply(k, () => api?.sessionContextClear?.(k))}
                                />
                            ))}
                        </div>

                        <div className="flex items-center justify-between mt-4 pt-4 border-t border-border-subtle">
                            <div>
                                <div className="text-sm font-medium text-text-primary">{t('Use in answers')}</div>
                                <div className="text-xs text-text-tertiary">{t('Turn off to answer without them, without removing them.')}</div>
                            </div>
                            <button
                                role="switch"
                                aria-checked={info.enabled}
                                aria-label={t('Use in answers')}
                                disabled={busy === 'toggle'}
                                onClick={() => apply('toggle', () => api?.sessionContextSetEnabled?.(!info.enabled))}
                                data-on={String(info.enabled)}
                                className="t-toggle t-toggle-sm shrink-0"
                            >
                                <span className="t-toggle-thumb" aria-hidden="true" />
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>,
        document.body,
    );
};

export default SessionContextModal;
