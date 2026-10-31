import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Languages } from 'lucide-react';
import { isInternalCaptureDevice } from '../../../electron/audio/audioDeviceSelection.mjs';
import { isRecognitionLanguageOffered } from '../../../electron/config/languages';
import { NpPop } from './NpPop';
import { languageButtonLabel, micButtonLabel, notepadLanguageChoices, type LanguageEntry } from './notepadView';

/**
 * The transcript panel's bottom row (2026-10-20), as Granola's: the mic the
 * meeting hears and the transcript's language. (The sound-settings button
 * was removed 2026-10-30; the language button still opens Settings › Audio
 * when the list depends on the provider.)
 *
 *  - Mic: the system's input devices (Natively's own capture devices left
 *    out, as Settings › Audio does). A pick is saved as Settings saves it
 *    (`preferredInputDeviceId`, read at the next Start) and switches the
 *    running meeting at once (main's reconfigureAudio, CoreAudio on macOS,
 *    WASAPI on Windows). A device main could not open shows what it used.
 *  - Language: applied to the running transcript at once. Speech providers
 *    whose languages depend on the model or machine (see
 *    LANGUAGE_RESTRICTED_PROVIDERS) open Settings › Audio instead, where the
 *    list is filtered for them.
 *
 * Enumerated only while the panel is open: on macOS listing the inputs talks
 * to the audio HAL, harmless during a meeting (the mic is already on).
 */

const ink = (v: string): React.CSSProperties => ({ color: `var(${v})` });
const SAVED_INPUT_KEY = 'preferredInputDeviceId';

function readSaved(): string | null {
    try { return localStorage.getItem(SAVED_INPUT_KEY); } catch { return null; }
}
function writeSaved(id: string): void {
    try { localStorage.setItem(SAVED_INPUT_KEY, id); } catch { /* the meeting still switches */ }
}

export const TranscriptControls: React.FC = () => {
    const [open, setOpen] = useState<'mic' | 'language' | null>(null);
    const [devices, setDevices] = useState<Array<{ id: string; name: string }>>([]);
    const [saved, setSaved] = useState<string | null>(() => readSaved());
    const [actual, setActual] = useState<string | null>(null);
    const [provider, setProvider] = useState('');
    const [languages, setLanguages] = useState<Record<string, LanguageEntry>>({});
    const [language, setLanguage] = useState('');
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const api = window.electronAPI;
        if (!api) return;
        api.getInputDevices?.()
            .then((list) => { if (Array.isArray(list)) setDevices(list.filter((d) => d && !isInternalCaptureDevice(d.id) && !isInternalCaptureDevice(d.name))); })
            .catch(() => {});
        api.getSttProvider?.().then((p) => setProvider(typeof p === 'string' ? p : '')).catch(() => {});
        api.getRecognitionLanguages?.().then((l) => { if (l && typeof l === 'object') setLanguages(l as Record<string, LanguageEntry>); }).catch(() => {});
        api.getSttLanguage?.().then((k) => setLanguage(typeof k === 'string' ? k : '')).catch(() => {});
        const off = api.onDeviceSelectionApplied?.((p) => {
            if (p?.kind === 'input') setActual(p.fellBack ? p.actual : null);
        });
        return () => { off?.(); };
    }, []);

    useEffect(() => {
        if (!open) return;
        const close = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(null); };
        document.addEventListener('mousedown', close, true);
        return () => document.removeEventListener('mousedown', close, true);
    }, [open]);

    const pickMic = (id: string) => {
        setOpen(null);
        setSaved(id);
        setActual(null);
        writeSaved(id);
        void window.electronAPI?.setMeetingInputDevice?.(id).catch(() => {});
    };
    const pickLanguage = (key: string) => {
        setOpen(null);
        setLanguage(key);
        void window.electronAPI?.setRecognitionLanguage?.(key).catch(() => {});
    };
    const openAudioSettings = () => { setOpen(null); void window.electronAPI?.openSettingsTab?.('audio'); };

    const choices = provider ? notepadLanguageChoices(provider, languages, (k) => isRecognitionLanguageOffered(k, null, null)) : null;
    const micLabel = actual ?? micButtonLabel(devices, saved);
    const current = (id: string) => (saved ? id === saved : id === 'default');
    const textBtn = 'h-8 inline-flex items-center gap-1.5 px-2.5 rounded-full text-[13px] transition-colors np-wash';
    const row = 'w-full h-8 flex items-center gap-2 px-2 rounded-lg text-[13px] text-left transition-colors np-wash';

    return (
        <div ref={rootRef} className="relative ml-auto flex items-center gap-1 min-w-0">
            <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={open === 'mic'}
                aria-label={`Microphone: ${micLabel}`}
                title="Microphone"
                onClick={() => setOpen((o) => (o === 'mic' ? null : 'mic'))}
                className={`${textBtn} min-w-0`}
                style={ink('--np-ink-secondary')}
            >
                <span className="truncate max-w-[150px]">{micLabel}</span>
                <ChevronDown className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
            </button>
            <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={open === 'language'}
                aria-label={`Transcript language: ${languageButtonLabel(language, languages)}`}
                title="Transcript language"
                onClick={() => (choices ? setOpen((o) => (o === 'language' ? null : 'language')) : openAudioSettings())}
                className={`${textBtn} shrink-0`}
                style={ink('--np-ink-secondary')}
            >
                <Languages className="w-4 h-4" strokeWidth={1.75} />
                {languageButtonLabel(language, languages)}
                <ChevronDown className="w-3.5 h-3.5" strokeWidth={2} />
            </button>

                <NpPop open={open === 'mic'} origin="bottom right" role="listbox" aria-label="Microphone" className="absolute right-0 bottom-full mb-2 z-40 w-[260px] max-h-[280px] overflow-y-auto p-1">
                    {devices.length === 0 ? (
                        <p className="px-2 py-2 text-[12px]" style={ink('--np-ink-tertiary')}>No microphones found.</p>
                    ) : devices.map((d) => (
                        <button key={d.id} type="button" role="option" aria-selected={current(d.id)} onClick={() => pickMic(d.id)} className={row} style={ink('--np-ink')}>
                            <span className="flex-1 min-w-0 truncate">{d.name}</span>
                            {current(d.id) && <Check className="w-4 h-4 shrink-0" strokeWidth={2} style={ink('--np-accent')} />}
                        </button>
                    ))}
                </NpPop>
                <NpPop open={open === 'language' && !!choices} origin="bottom right" role="listbox" aria-label="Transcript language" className="absolute right-0 bottom-full mb-2 z-40 w-[240px] max-h-[320px] overflow-y-auto p-1">
                    {(choices ?? []).map((c) => (
                        <button key={c.key} type="button" role="option" aria-selected={c.key === language} onClick={() => pickLanguage(c.key)} className={row} style={ink('--np-ink')}>
                            <span className="flex-1 min-w-0 truncate">{c.label}</span>
                            {c.key === language && <Check className="w-4 h-4 shrink-0" strokeWidth={2} style={ink('--np-accent')} />}
                        </button>
                    ))}
                </NpPop>
        </div>
    );
};
