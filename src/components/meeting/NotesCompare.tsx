import React, { useState } from 'react';
import { X } from 'lucide-react';

type Side = { version: 'current' | number; label: string; provider: string | null; model: string | null };
export type CompareReveal = { choice: 'A' | 'B' | 'same'; saved: boolean; a: Side; b: Side; removed?: 'current' | number | null };

const texts = (v: unknown): string[] => (Array.isArray(v) ? v : [])
    .map((x: any) => (typeof x === 'string' ? x : String(x?.text ?? x?.item?.text ?? '')).trim())
    .filter(Boolean);

/**
 * One version's notes, plainly: the overview, the summary, the template's
 * sections, the action items. Everything that can differ between two versions
 * is shown, so two that differ only in their overview do not look the same.
 */
const NotesColumn: React.FC<{ notes: any; t: (s: string) => string }> = ({ notes, t }) => {
    const overview = typeof notes?.overview === 'string' ? notes.overview.trim() : '';
    const tldr = texts(notes?.tldr);
    const sections = (Array.isArray(notes?.sectionsV3) ? notes.sectionsV3 : Array.isArray(notes?.sections) ? notes.sections : [])
        .map((s: any) => ({ title: String(s?.title ?? '').trim(), bullets: texts(s?.bullets) }))
        .filter((s: { title: string; bullets: string[] }) => s.bullets.length > 0);
    const actions = texts(notes?.actionItemsV3 ?? notes?.actionItems);
    const list = (items: string[]) => (
        <ul className="space-y-1.5">
            {items.map((line, i) => (
                <li key={i} className="flex items-start gap-2.5 text-[12.5px] text-text-secondary leading-snug">
                    <span className="mt-[7px] w-[3px] h-[3px] rounded-full bg-text-tertiary shrink-0" />
                    <span className="min-w-0">{line}</span>
                </li>
            ))}
        </ul>
    );
    const heading = (s: string) => <p className="text-[12.5px] font-semibold text-text-primary mt-4 mb-2 first:mt-0">{s}</p>;
    return (
        <div className="min-w-0">
            {overview && <p className="text-[12.5px] text-text-secondary leading-relaxed mb-4 last:mb-0">{overview}</p>}
            {tldr.length > 0 && <>{heading(t('Summary'))}{list(tldr)}</>}
            {sections.map((s: { title: string; bullets: string[] }, i: number) => (
                <React.Fragment key={i}>{heading(s.title || t('Notes'))}{list(s.bullets)}</React.Fragment>
            ))}
            {actions.length > 0 && <>{heading(t('Action items'))}{list(actions)}</>}
        </div>
    );
};

/**
 * Compare two versions of the notes blind (2026-10-15): side by side as A and
 * B, in an order main picked at random, with no template or model named until
 * the user says which is better (or about the same, and optionally why). Then
 * each side says what it was. Stored on this machine only
 * (main: services/meeting/notesCompare.ts).
 */
export const NotesCompare: React.FC<{
    a: any;
    b: any;
    reveal: CompareReveal | null;
    busy: boolean;
    isLight: boolean;
    onPick: (choice: 'A' | 'B' | 'same', reason: string) => void;
    onClose: () => void;
    t: (s: string) => string;
}> = ({ a, b, reveal, busy, isLight, onPick, onClose, t }) => {
    const [reason, setReason] = useState('');
    const box = `rounded-[10px] border px-4 py-3.5 ${isLight ? 'border-black/[0.08] bg-black/[0.015]' : 'border-white/10 bg-white/[0.02]'}`;
    const quietBtn = `h-8 shrink-0 inline-flex items-center text-[12px] font-medium px-3 rounded-md text-text-primary disabled:opacity-50 transition-colors ${isLight ? 'bg-black/[0.05] hover:bg-black/[0.09]' : 'bg-white/[0.06] hover:bg-white/[0.1]'}`;
    const describe = (s: Side) => [s.label, s.model].filter(Boolean).join(', ');
    const sideTitle = (letter: 'A' | 'B', side: Side | null) => (
        <div className="flex items-baseline gap-2 mb-3 min-w-0">
            <span className="text-[13px] font-semibold text-text-primary">{letter}</span>
            {side && <span className="text-[12px] text-text-tertiary truncate">{describe(side)}</span>}
            {reveal && reveal.choice === letter && <span className="ml-auto shrink-0 text-[11.5px] text-text-secondary">{t('Your pick')}</span>}
        </div>
    );
    return (
        <section className="mb-8" aria-label={t('Compare notes')}>
            <div className="flex items-center gap-2 mb-3">
                <p className="text-[13px] font-semibold text-text-primary">{reveal ? t('Here is which was which') : t('Which notes are better?')}</p>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label={t('Close compare')}
                    className={`ml-auto w-7 h-7 rounded-md flex items-center justify-center text-text-tertiary hover:text-text-primary transition-colors ${isLight ? 'hover:bg-black/[0.05]' : 'hover:bg-white/[0.06]'}`}
                >
                    <X className="w-3.5 h-3.5" strokeWidth={2} />
                </button>
            </div>
            {!reveal && (
                <p className="text-[12.5px] text-text-tertiary mb-3">{t('The two versions are shown in a random order, without their template or model. Pick one and you will see which was which.')}</p>
            )}
            <div className="grid grid-cols-2 gap-3">
                <div className={box}>{sideTitle('A', reveal?.a ?? null)}<NotesColumn notes={a} t={t} /></div>
                <div className={box}>{sideTitle('B', reveal?.b ?? null)}<NotesColumn notes={b} t={t} /></div>
            </div>
            {!reveal ? (
                <form
                    className="mt-3 flex flex-wrap items-center gap-2"
                    onSubmit={(e) => { e.preventDefault(); }}
                >
                    <button type="button" disabled={busy} className={quietBtn} onClick={() => onPick('A', reason)}>{t('A is better')}</button>
                    <button type="button" disabled={busy} className={quietBtn} onClick={() => onPick('B', reason)}>{t('B is better')}</button>
                    <button type="button" disabled={busy} className={quietBtn} onClick={() => onPick('same', reason)}>{t('About the same')}</button>
                    <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        maxLength={500}
                        placeholder={t('Why? (optional)')}
                        className={`flex-1 min-w-[160px] h-8 px-3 rounded-md text-[12.5px] bg-transparent border outline-none text-text-primary placeholder:text-text-tertiary ${isLight ? 'border-black/[0.1]' : 'border-white/[0.1]'}`}
                    />
                </form>
            ) : (
                <p className="mt-3 text-[12.5px] text-text-tertiary">
                    {reveal.removed != null
                        ? t('Thanks. The other version was removed.')
                        : t('Thanks. Your pick is kept on this computer.')}
                </p>
            )}
        </section>
    );
};
