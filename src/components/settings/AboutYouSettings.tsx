// Settings › Intelligence: "About you". A few lines in the user's own words
// (role, team, what they care about) that the meeting notes prompt reads as
// their bio, the way Granola adds the user's bio to every summary. Stored in
// SettingsManager.userBio (at most 600 characters); empty means not used.
// Saved on blur, never sent anywhere on its own.
//
// The field is Settings' input box (SETTINGS_INPUT's border, fill and accent
// edge on focus) around a textarea that grows with its text instead of a
// resize grip, with the save note and the count on one quiet line inside it.
// The count only shows while typing or near the limit; "Saved" answers the
// blur that saved.
import React, { useEffect, useRef, useState } from 'react';
import { Check, UserRound } from 'lucide-react';
import { useT } from '../../i18n';
import { Presence, SettingsRow } from './SettingsRow';

const MAX = 600;
// Past this the count stays up after the field loses focus.
const NEAR = MAX - 60;

export const AboutYouSettings: React.FC = () => {
    const t = useT();
    const [bio, setBio] = useState('');
    const [saved, setSaved] = useState('');
    const [focused, setFocused] = useState(false);
    const [justSaved, setJustSaved] = useState(false);
    const live = useRef(true);
    const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Esc blurs the field too; the blur must not save the text Esc just threw away
    // (its closure still holds it, the reset has not rendered yet).
    const discarding = useRef(false);

    useEffect(() => {
        live.current = true;
        void window.electronAPI?.userBioGet?.().then((r) => { if (live.current && r) { setBio(r.bio); setSaved(r.bio); } }).catch(() => {});
        return () => {
            live.current = false;
            if (savedTimer.current) clearTimeout(savedTimer.current);
        };
    }, []);

    const save = async () => {
        const next = bio.trim().slice(0, MAX);
        if (next === saved) { setBio(saved); return; }
        const res = await window.electronAPI?.userBioSet?.(next).catch(() => undefined);
        if (!live.current) return;
        if (res?.success) {
            setSaved(res.bio ?? next);
            setBio(res.bio ?? next);
            setJustSaved(true);
            if (savedTimer.current) clearTimeout(savedTimer.current);
            savedTimer.current = setTimeout(() => setJustSaved(false), 1800);
        } else setBio(saved);
    };

    const dirty = bio.trim() !== saved;
    // One slot for the left of the footer: what happens next while editing,
    // "Saved" once it has, nothing at rest.
    const note = focused && dirty ? 'pending' : justSaved ? 'saved' : null;
    const showCount = focused || bio.length >= NEAR;

    return (
        <SettingsRow
            icon={<UserRound size={20} />}
            title={t('About you')}
            description={saved ? t('Read by every meeting summary, in your words.') : t('A few lines on who you are. Every meeting summary reads them.')}
            descriptionKey={saved ? 'set' : 'empty'}
        >
            <div className="pb-3">
                <div className="rounded-lg border border-border-subtle bg-bg-input transition-colors duration-150 ease-out focus-within:border-accent-primary">
                    <textarea
                        aria-label={t('About you')}
                        className="block max-h-48 min-h-[4.5rem] w-full resize-none bg-transparent px-3 pt-2.5 text-xs leading-relaxed text-text-primary placeholder:text-text-tertiary focus:outline-none [field-sizing:content]"
                        value={bio}
                        maxLength={MAX}
                        spellCheck
                        placeholder={t('Head of Product at Acme. I run the weekly roadmap review and care most about customer commitments and dates.')}
                        onChange={(e) => setBio(e.target.value.slice(0, MAX))}
                        onFocus={() => setFocused(true)}
                        onBlur={() => {
                            setFocused(false);
                            if (discarding.current) { discarding.current = false; return; }
                            void save();
                        }}
                        onKeyDown={(e) => {
                            // Esc puts back what was saved; ⌘↵ / Ctrl+↵ saves, as a blur does.
                            if (e.key === 'Escape') { e.preventDefault(); discarding.current = true; setBio(saved); e.currentTarget.blur(); }
                            else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.blur(); }
                        }}
                    />
                    <div className="flex h-7 items-center justify-between gap-3 px-3 text-[11px] text-text-tertiary">
                        <Presence kind="text" id={note}>
                            {note === 'saved' ? (
                                <span className="inline-flex items-center gap-1 text-text-secondary"><Check size={12} />{t('Saved')}</span>
                            ) : (
                                t('Saves when you click away. Esc undoes.')
                            )}
                        </Presence>
                        <span
                            aria-hidden={!showCount}
                            className={`ml-auto tabular-nums transition-opacity duration-150 ease-out ${showCount ? 'opacity-100' : 'opacity-0'} ${bio.length >= MAX ? 'text-text-secondary' : ''}`}
                        >
                            {bio.length} / {MAX}
                        </span>
                    </div>
                </div>
            </div>
        </SettingsRow>
    );
};
