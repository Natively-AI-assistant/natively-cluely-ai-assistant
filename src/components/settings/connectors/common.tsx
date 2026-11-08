// Small pieces every Connectors page uses: a result notice under a row, a
// copyable value, and a spinner that stands in for a button's icon.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Copy, Loader2 } from 'lucide-react';
import { useT } from '../../../i18n';
import {
    Collapse, SETTINGS_FIELD_LABEL, SettingsNotice, useSettingsTones,
} from '../SettingsRow';
import type { OutputResult } from '../../../types/meetingOutputs';
import { GlassPill } from './parts';
import { copyText } from '../../../lib/copyText';

export type Flash = { tone: 'ok' | 'danger' | 'warn'; text: string } | null;

/** A result as a notice under the card's footer: the plain sentence main wrote, or a default. */
export function flashOf(res: OutputResult | undefined, okText?: string): Flash {
    if (!res) return { tone: 'danger', text: 'Something went wrong. Try again.' };
    if (res.ok) return res.message ? { tone: res.kind === 'storage_unavailable' ? 'warn' : 'ok', text: res.message } : okText ? { tone: 'ok', text: okText } : null;
    return { tone: 'danger', text: res.message || 'Something went wrong. Try again.' };
}

export const FlashNotice: React.FC<{ flash: Flash }> = ({ flash }) => {
    const tones = useSettingsTones();
    return (
        <Collapse open={!!flash}>
            <div className="pt-3">
                {flash && (
                    <SettingsNotice
                        tone={tones[flash.tone]}
                        icon={flash.tone === 'ok' ? <Check size={14} /> : <AlertCircle size={14} />}
                        alert={flash.tone === 'danger'}
                        shakeKey={flash.text}
                        className=""
                    >
                        {flash.text}
                    </SettingsNotice>
                )}
            </div>
        </Collapse>
    );
};

/** A copyable value, in the Intelligence pane's copy-field look; `multiline` for config snippets. */
export const CopyField: React.FC<{ text: string; label?: string; multiline?: boolean }> = ({ text, label, multiline }) => {
    const t = useT();
    const [copied, setCopied] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => clearTimeout(timer.current), []);
    const copy = useCallback(async () => {
        try {
            await copyText(text);
            setCopied(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1500);
        } catch { /* the text is selectable anyway */ }
    }, [text]);
    return (
        <div className="mt-1.5">
            {label ? <span className={SETTINGS_FIELD_LABEL}>{label}</span> : null}
            <div className={`mt-1 flex ${multiline ? 'items-start' : 'items-center'} gap-2`}>
                {multiline ? (
                    <pre className="flex-1 min-w-0 overflow-x-auto rounded-lg border border-border-subtle bg-bg-input px-3 py-2 font-mono text-[11px] leading-relaxed text-text-primary whitespace-pre">{text}</pre>
                ) : (
                    <code className="flex-1 min-w-0 truncate rounded-lg border border-border-subtle bg-bg-input px-3 py-2 font-mono text-xs text-text-primary" title={text}>{text}</code>
                )}
                <GlassPill
                    onClick={() => void copy()}
                    aria-label={`${t('Copy')} ${label || ''}`.trim()}
                    className="min-w-[92px]"
                    tone={copied ? 'ok' : undefined}
                    icon={copied ? <Check size={14} /> : <Copy size={14} />}
                >
                    {copied ? t('Copied') : t('Copy')}
                </GlassPill>
            </div>
        </div>
    );
};


export const BusyIcon: React.FC<{ busy: boolean; icon: React.ReactNode }> = ({ busy, icon }) => (busy ? <Loader2 size={14} className="animate-spin" /> : <>{icon}</>);
