import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CornerDownLeft, SpellCheck, X } from 'lucide-react';
import { useT } from '../../i18n';
import { isListPaste, mergeEntries, pasteIntoDraft } from '../../lib/dictionaryField.mjs';
import {
    Collapse,
    EASE_SMOOTH_OUT,
    Presence,
    SETTINGS_CARD,
    SettingsMotionReady,
    SettingsRow,
    useMotionReadyAfter,
} from './SettingsRow';

// Settings > Audio: the user's dictionary (electron/audio/userDictionary.ts).
// Names and words the transcript should spell right; the main process sends
// them to every speech provider that takes a word list. Built like the other
// Audio cards ("Follow the meeting app's mute", "Dictation"): one row with a
// tile, title and description, and under it a token field: the words sit in
// the field as chips, ahead of the text being typed. Same platform-neutral
// list on macOS and Windows.

const MAX_TERMS = 100;

/** Providers that take a word list (electron/audio/sttContextTerms.ts). */
const USES_LIST = new Set(['natively', 'deepgram', 'soniox', 'google', 'groq', 'openai', 'local-whisper']);

// A pill comes and goes with SettingsRow's "control" move: 250ms in from 0.96,
// 150ms out. No `layout`: layout projection broke scrolling in this scroller.
const PILL_IN = { opacity: 1, scale: 1, filter: 'blur(0px)', transition: { duration: 0.25, ease: EASE_SMOOTH_OUT } };
const PILL_OUT = (reduce: boolean) => ({ opacity: 0, scale: reduce ? 1 : 0.96, filter: 'blur(2px)', transition: { duration: 0.15, ease: EASE_SMOOTH_OUT } });

const ARMED_STYLE: React.CSSProperties = {
    backgroundColor: 'color-mix(in srgb, var(--accent-primary) 14%, transparent)',
    borderColor: 'color-mix(in srgb, var(--accent-primary) 45%, transparent)',
};

export const SpeechDictionarySettings: React.FC<{ sttProvider: string }> = ({ sttProvider }) => {
    const t = useT();
    const reduce = !!useReducedMotion();
    const [terms, setTerms] = useState<string[]>([]);
    const [draft, setDraft] = useState('');
    const [notSaved, setNotSaved] = useState(false);
    /** How many entries the last add could not fit under the cap; they stay in the field. */
    const [overflow, setOverflow] = useState(0);
    const [loaded, setLoaded] = useState(false);
    const ready = useMotionReadyAfter(loaded);
    const saving = useRef(Promise.resolve());
    /** The list the main process last confirmed: what a failed save falls back to. */
    const confirmed = useRef<string[]>([]);
    /** Bumped per save; only the newest one decides what the list shows. */
    const latestSave = useRef(0);
    const inputRef = useRef<HTMLInputElement>(null);
    /** The word Backspace has marked; a second Backspace removes it. */
    const [armed, setArmed] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        window.electronAPI?.getUserDictionary?.()
            .then((list) => {
                if (alive && Array.isArray(list)) {
                    confirmed.current = list;
                    setTerms(list);
                }
            })
            .catch(() => { /* an empty list */ })
            .finally(() => { if (alive) setLoaded(true); });
        return () => { alive = false; };
    }, []);

    const save = (next: string[]) => {
        setTerms(next);
        setNotSaved(false);
        const seq = ++latestSave.current;
        // Saves in order, so a quick add then remove cannot land the other way round.
        // Each one sends the whole list, so a newer save carries every change before
        // it: an older save that fails is superseded, not rolled back. Only the newest
        // save's outcome reaches the screen, and a failure there falls back to the last
        // list the main process confirmed.
        saving.current = saving.current.then(async () => {
            let saved: string[] | null = null;
            try {
                const res = await window.electronAPI?.setUserDictionary?.(next);
                if (res?.success && Array.isArray(res.terms)) saved = res.terms;
            } catch { /* handled below as a failed save */ }
            if (saved) confirmed.current = saved;
            if (seq !== latestSave.current) return;
            if (saved) {
                setTerms(saved);
            } else {
                setTerms(confirmed.current);
                setNotSaved(true);
            }
        });
    };

    /** Saves the new entries of `text` and returns the ones past the cap. */
    const addEntries = (text: string): string[] => {
        const { next, leftover } = mergeEntries(terms, text, MAX_TERMS);
        if (next.length !== terms.length) save(next);
        return leftover;
    };

    /** Adds `text`; whatever did not fit stays in the field with a note, never lost. */
    const commit = (text: string) => {
        const leftover = addEntries(text);
        setDraft(leftover.join(', '));
        setOverflow(leftover.length);
    };

    const remove = (term: string) => {
        setArmed(null);
        setOverflow(0);
        save(terms.filter((x) => x !== term));
    };

    // Token-field keys, as in Mail's address field: Return or a comma turns the
    // text into a word; Backspace in an empty field first marks the last word,
    // then removes it; Escape clears.
    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        // An IME (Japanese, Chinese, Korean) uses Return to pick a candidate and
        // may turn a comma into 、 or ，: those keys belong to it until it is done.
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter' || (e.key === ',' && draft.trim())) {
            e.preventDefault();
            commit(draft);
            return;
        }
        if (e.key === 'Backspace' && draft === '' && terms.length) {
            e.preventDefault();
            const last = terms[terms.length - 1];
            if (armed === last) remove(last);
            else setArmed(last);
            return;
        }
        if (e.key === 'Escape') {
            // With something to clear, Escape clears it and goes no further:
            // Settings closes on an Escape that reaches the window.
            if (!draft && !armed) return;
            e.stopPropagation();
            setDraft('');
            setArmed(null);
            setOverflow(0);
            return;
        }
        if (armed) setArmed(null);
    };

    // A pasted list (one per line, or comma separated) lands as words at once.
    // It goes where an ordinary paste would: in place of the selection, at the caret.
    const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
        const text = e.clipboardData.getData('text');
        if (!isListPaste(text)) return;
        e.preventDefault();
        commit(pasteIntoDraft(draft, e.currentTarget.selectionStart, e.currentTarget.selectionEnd, text));
    };

    const full = terms.length >= MAX_TERMS;
    const usesList = USES_LIST.has(sttProvider);
    const typing = draft.trim().length > 0 && !full;

    return (
        <SettingsMotionReady.Provider value={ready}>
            <div className={SETTINGS_CARD}>
                <SettingsRow
                    icon={<SpellCheck size={20} />}
                    title={t('Dictionary')}
                    description={usesList
                        ? t('Names and words the transcript should spell right: people, companies, products.')
                        : t("Your current speech provider doesn't take a word list. Words you add are kept for one that does.")}
                    descriptionKey={usesList ? 'uses' : 'unused'}
                >
                    <div className="pb-4">
                        {/* One field holds the words and the text being typed, so the list
                            and the way to grow it are the same surface. A click anywhere in
                            it lands in the text. */}
                        <div
                            onMouseDown={(e) => {
                                if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === 'UL') {
                                    e.preventDefault();
                                    inputRef.current?.focus();
                                }
                            }}
                            className={`flex items-start gap-2 rounded-xl border border-border-subtle bg-bg-input pl-1.5 pr-1.5 py-1.5 cursor-text transition-colors duration-150 focus-within:border-accent-primary ${!loaded ? 'opacity-50' : ''}`}
                        >
                            <ul className="flex-1 min-w-0 flex flex-wrap items-center gap-1 max-h-40 overflow-y-auto" aria-label={t('Dictionary')}>
                                <AnimatePresence initial={false}>
                                    {terms.map((term) => (
                                        <motion.li
                                            key={term}
                                            initial={ready ? { opacity: 0, scale: reduce ? 1 : 0.96, filter: 'blur(2px)' } : false}
                                            animate={PILL_IN}
                                            exit={PILL_OUT(reduce)}
                                            className={`inline-flex items-center gap-0.5 max-w-full h-7 pl-2.5 pr-1 rounded-lg border text-xs text-text-primary transition-colors duration-150 ${armed === term ? '' : 'bg-bg-item-surface border-border-subtle'}`}
                                            // The marked word takes a wash of the accent. Inline: accent-primary
                                            // is a var() colour, which Tailwind 3 gives no opacity modifier.
                                            style={armed === term ? ARMED_STYLE : undefined}
                                        >
                                            <span className="truncate">{term}</span>
                                            <button
                                                type="button"
                                                onClick={() => remove(term)}
                                                aria-label={`${t('Remove')} ${term}`}
                                                title={t('Remove')}
                                                className="shrink-0 w-5 h-5 grid place-items-center rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-elevated transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.9] motion-reduce:active:scale-100"
                                            >
                                                <X size={12} strokeWidth={2} />
                                            </button>
                                        </motion.li>
                                    ))}
                                </AnimatePresence>
                                <li className="flex-1 min-w-[160px]">
                                    <input
                                        ref={inputRef}
                                        type="text"
                                        value={draft}
                                        onChange={(e) => { setDraft(e.target.value); setArmed(null); setOverflow(0); }}
                                        onKeyDown={onKeyDown}
                                        onPaste={onPaste}
                                        onBlur={() => setArmed(null)}
                                        placeholder={full ? t('The list is full') : t('Add a name or word')}
                                        aria-label={t('Add a name or word')}
                                        // Not disabled when full: disabling the focused field drops focus
                                        // to the page, and Backspace could no longer remove a word.
                                        disabled={!loaded}
                                        className="w-full h-7 px-1.5 bg-transparent text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none disabled:cursor-not-allowed"
                                    />
                                </li>
                            </ul>

                            {/* One slot on the right: the count at rest, Add while there is
                                text to add. Nothing at all for an empty list. */}
                            <div className="shrink-0 h-7 flex items-center">
                                <Presence kind="control" id={typing ? 'add' : terms.length ? 'count' : null}>
                                    {typing ? (
                                        <button
                                            type="button"
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={() => commit(draft)}
                                            className="h-6 pl-2 pr-1.5 rounded-md border border-border-subtle bg-bg-component hover:bg-bg-elevated text-[11px] font-medium text-text-primary flex items-center gap-1.5 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:active:scale-100"
                                        >
                                            {t('Add')}
                                            <CornerDownLeft size={11} className="text-text-tertiary" aria-hidden="true" />
                                        </button>
                                    ) : (
                                        <span className={`px-1.5 text-[11px] tabular-nums ${full ? 'text-text-secondary' : 'text-text-tertiary'}`}>
                                            {terms.length}/{MAX_TERMS}
                                        </span>
                                    )}
                                </Presence>
                            </div>
                        </div>

                        <Collapse open={overflow > 0}>
                            <p className="pt-2 text-xs text-text-secondary">
                                {(overflow === 1 ? t("1 didn't fit. The list holds {max} words.") : t("{count} didn't fit. The list holds {max} words."))
                                    .replace('{count}', String(overflow))
                                    .replace('{max}', String(MAX_TERMS))}
                            </p>
                        </Collapse>
                        <Collapse open={notSaved}>
                            <p className="pt-2 text-xs text-text-secondary">{t("That change wasn't saved. Try again.")}</p>
                        </Collapse>
                    </div>
                </SettingsRow>
            </div>
        </SettingsMotionReady.Provider>
    );
};
