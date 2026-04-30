import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const MAX_CHARS = 15_000;
const SOFT_WARN = 10_000;
const HARD_WARN = 14_000;
const DEBOUNCE_MS = 1_500;

interface Props {
    open: boolean;
    onClose: () => void;
}

const MeetingContextPanel: React.FC<Props> = ({ open, onClose }) => {
    const [text, setText] = useState('');
    const [serverChars, setServerChars] = useState(0);
    const [truncatedNotice, setTruncatedNotice] = useState(false);
    const [saving, setSaving] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const lastSavedRef = useRef('');

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        window.electronAPI?.meetingContextGet?.()
            .then(({ text: t }) => {
                if (cancelled) return;
                setText(t);
                setServerChars(t.length);
                lastSavedRef.current = t;
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [open]);

    useEffect(() => {
        const unsub = window.electronAPI?.onMeetingContextChanged?.((info) => {
            setServerChars(info.chars);
            if (!info.hasContext) {
                setText('');
                lastSavedRef.current = '';
            }
        });
        return () => unsub?.();
    }, []);

    useEffect(() => {
        if (open) {
            const id = setTimeout(() => textareaRef.current?.focus(), 120);
            return () => clearTimeout(id);
        }
    }, [open]);

    const flushSave = async (next: string) => {
        if (next === lastSavedRef.current) return;
        setSaving(true);
        try {
            const res = await window.electronAPI?.meetingContextSet?.(next);
            if (res?.success) {
                setServerChars(res.chars);
                setTruncatedNotice(res.truncated);
                lastSavedRef.current = next.slice(0, res.chars);
            }
        } finally {
            setSaving(false);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const next = e.target.value.slice(0, MAX_CHARS);
        setText(next);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => flushSave(next), DEBOUNCE_MS);
    };

    const handleBlur = () => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
            debounceRef.current = null;
        }
        void flushSave(text);
    };

    const handleClear = async () => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
            debounceRef.current = null;
        }
        setText('');
        setTruncatedNotice(false);
        await window.electronAPI?.meetingContextClear?.();
        lastSavedRef.current = '';
    };

    const len = text.length;
    const counterColor =
        len >= HARD_WARN ? 'text-red-400'
        : len >= SOFT_WARN ? 'text-amber-400'
        : '';

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    key="meeting-context-panel"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                    className="overflow-hidden"
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    <div className="border-t border-[var(--console-rule)] mx-5 pt-3 pb-1 no-drag">
                        {/* Header */}
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <span
                                    className="console-label"
                                    style={{ color: 'var(--console-ink-soft)', letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: '10px' }}
                                >
                                    Meeting Context
                                </span>
                                <AnimatePresence>
                                    {saving && (
                                        <motion.span
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            exit={{ opacity: 0 }}
                                            transition={{ duration: 0.15 }}
                                            className="console-label"
                                            style={{ color: 'var(--console-ink-dim)', fontSize: '9px' }}
                                        >
                                            saving…
                                        </motion.span>
                                    )}
                                </AnimatePresence>
                            </div>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={handleClear}
                                    disabled={len === 0}
                                    className="console-label px-2 py-0.5 rounded"
                                    style={{
                                        color: 'var(--console-ink-dim)',
                                        fontSize: '10px',
                                        cursor: len === 0 ? 'default' : 'pointer',
                                        opacity: len === 0 ? 0.35 : 1,
                                        transition: 'opacity 0.15s',
                                    }}
                                    onMouseEnter={(e) => { if (len > 0) (e.currentTarget as HTMLButtonElement).style.color = 'var(--console-ink)'; }}
                                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--console-ink-dim)'; }}
                                >
                                    Clear
                                </button>
                                <button
                                    onClick={onClose}
                                    className="console-label px-2 py-0.5 rounded"
                                    style={{ color: 'var(--console-ink-dim)', fontSize: '10px', cursor: 'pointer', transition: 'color 0.15s' }}
                                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--console-ink)'; }}
                                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--console-ink-dim)'; }}
                                >
                                    Close
                                </button>
                            </div>
                        </div>

                        {/* Textarea */}
                        <textarea
                            ref={textareaRef}
                            value={text}
                            onChange={handleChange}
                            onBlur={handleBlur}
                            placeholder="Paste architecture notes, project context, open decisions, or anything the AI should know about this meeting…"
                            rows={6}
                            className="w-full px-3 py-2.5 rounded-xl outline-none resize-none text-[12px] leading-relaxed transition-all duration-150"
                            style={{
                                background: 'var(--console-key-bg)',
                                border: '1px solid var(--console-rule)',
                                color: 'var(--console-ink)',
                                fontFamily: 'inherit',
                            }}
                            onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--console-rule-strong)'; }}
                            onBlurCapture={(e) => { e.currentTarget.style.borderColor = 'var(--console-rule)'; }}
                        />

                        {/* Footer */}
                        <div className="flex items-center justify-between mt-1.5 mb-2">
                            <span className="console-label" style={{ color: 'var(--console-ink-dim)', fontSize: '10px' }}>
                                {truncatedNotice && (
                                    <span className="text-amber-400 mr-1">Truncated to cap.</span>
                                )}
                                Cleared when the meeting ends.
                            </span>
                            <span
                                className={`console-label tabular-nums ${counterColor}`}
                                style={{ fontSize: '10px', color: counterColor ? undefined : 'var(--console-ink-dim)' }}
                            >
                                {len.toLocaleString()} / {MAX_CHARS.toLocaleString()}
                            </span>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default MeetingContextPanel;
