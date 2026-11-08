import React, { useEffect, useState } from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';

/**
 * Thumbs up / down at the end of the generated notes (2026-10-15). A thumbs
 * down opens one short field, "What was wrong?". Stored on this machine only,
 * against the version of the notes shown (main: services/meeting/notesRatings.ts);
 * changing your mind replaces the rating.
 */
export const NotesRating: React.FC<{
    meetingId: string;
    /** The earlier version shown, or null for the current notes. */
    versionId: number | null;
    /** Changes with the notes' words: regenerated notes are unrated until rated. */
    contentKey?: string;
    isLight: boolean;
    /**
     * Asked above new notes for about one meeting in ten (notesFeedback.ts
     * shouldPromptRating); otherwise the quiet row at the end of the notes.
     */
    prompted?: boolean;
    t: (s: string) => string;
}> = ({ meetingId, versionId, contentKey, isLight, prompted = false, t }) => {
    const [rating, setRating] = useState<'up' | 'down' | null>(null);
    const [comment, setComment] = useState('');
    const [askWhy, setAskWhy] = useState(false);
    const [sent, setSent] = useState(false);

    useEffect(() => {
        let live = true;
        setRating(null); setComment(''); setAskWhy(false); setSent(false);
        window.electronAPI?.getMeetingNotesRating?.({ meetingId, versionId })
            .then((r) => {
                if (!live || !r) return;
                setRating(r.rating);
                setComment(r.comment ?? '');
            })
            .catch(() => { /* unrated */ });
        return () => { live = false; };
    }, [meetingId, versionId, contentKey]);

    const save = (next: 'up' | 'down', withComment?: string) => {
        setRating(next);
        void window.electronAPI?.rateMeetingNotes?.({ meetingId, versionId, rating: next, ...(withComment ? { comment: withComment } : {}) })
            .then((res) => { if (res?.success) setSent(true); })
            .catch(() => { /* the thumb stays; nothing to report on screen */ });
    };

    const thumb = (value: 'up' | 'down') => {
        const on = rating === value;
        const Icon = value === 'up' ? ThumbsUp : ThumbsDown;
        return (
            <button
                type="button"
                aria-label={value === 'up' ? t('Good notes') : t('Not good notes')}
                aria-pressed={on}
                onClick={() => {
                    if (value === 'up') { setAskWhy(false); save('up'); return; }
                    setAskWhy(true);
                    save('down', comment.trim() || undefined);
                }}
                className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${on ? 'text-text-primary' : 'text-text-tertiary hover:text-text-primary'} ${isLight ? 'hover:bg-black/[0.05]' : 'hover:bg-white/[0.06]'}`}
            >
                <Icon className="w-3.5 h-3.5" strokeWidth={2} />
            </button>
        );
    };

    return (
        <section className={prompted ? 'mb-6' : 'mb-8'}>
            <div className="flex items-center gap-1">
                <span className={`text-[12.5px] mr-1.5 ${prompted ? 'text-text-secondary' : 'text-text-tertiary'}`}>{prompted ? t('How were these notes?') : t('Rate these notes')}</span>
                {thumb('up')}
                {thumb('down')}
                {sent && !askWhy && <span className="text-[12px] text-text-tertiary ml-1.5">{t('Thanks')}</span>}
            </div>
            {askWhy && rating === 'down' && (
                <form
                    className="mt-2 flex items-center gap-2 max-w-md"
                    onSubmit={(e) => {
                        e.preventDefault();
                        save('down', comment.trim() || undefined);
                        setAskWhy(false);
                    }}
                >
                    <input
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        maxLength={500}
                        placeholder={t('What was wrong?')}
                        className={`flex-1 min-w-0 h-8 px-3 rounded-md text-[12.5px] bg-transparent border outline-none text-text-primary placeholder:text-text-tertiary ${isLight ? 'border-black/[0.1]' : 'border-white/[0.1]'}`}
                    />
                    <button
                        type="submit"
                        className={`h-8 shrink-0 inline-flex items-center text-[12px] font-medium px-3 rounded-md text-text-primary transition-colors ${isLight ? 'bg-black/[0.05] hover:bg-black/[0.09]' : 'bg-white/[0.06] hover:bg-white/[0.1]'}`}
                    >
                        {t('Send')}
                    </button>
                </form>
            )}
        </section>
    );
};
