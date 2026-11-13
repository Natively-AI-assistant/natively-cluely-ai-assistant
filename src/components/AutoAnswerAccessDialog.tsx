// src/components/AutoAnswerAccessDialog.tsx
//
// Auto Answer is Natively Pro, or free for a user who agrees to share the
// transcripts of meetings where it runs (electron/intelligence/autoAnswer/
// autoAnswerAccess.ts; Evin 2026-11-13). This is the one place that asks.
//
// The wording is the consent: it says what is sent (the whole transcript of a
// meeting where Auto Answer ran, other people's speech included), what is
// removed on the device, what is NOT sent, what it is for, and how to stop and
// delete. TRAINING_CONSENT_VERSION in autoAnswerAccess.ts goes up whenever this
// text changes in a way that matters, so earlier agreements stop counting.
//
// In-window Radix dialog, never a native confirm (see ui/ConfirmDialog.tsx), at
// the same layer as ConfirmDialog so it opens above Settings.
import React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Loader2 } from 'lucide-react';
import { useT } from '../i18n';

const LAYER = 400;

export interface AutoAnswerAccessDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** "Share and turn on": record consent, then switch Auto Answer on. */
    onShare: () => void;
    /** "See Pro plans". */
    onUpgrade: () => void;
    busy?: boolean;
    /** Pro/trial users opening the opt-in from Settings: no upgrade button, different title. */
    proOptIn?: boolean;
}

export const AutoAnswerAccessDialog: React.FC<AutoAnswerAccessDialogProps> = ({ open, onOpenChange, onShare, onUpgrade, busy = false, proOptIn = false }) => {
    const t = useT();
    return (
        <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="fixed inset-0 bg-black bg-opacity-50" style={{ zIndex: LAYER }} />
                <DialogPrimitive.Content
                    className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[440px] max-w-[92vw] max-h-[86vh] overflow-y-auto bg-bg-elevated border border-border-subtle rounded-2xl shadow-2xl p-5"
                    style={{ zIndex: LAYER }}
                >
                    <DialogPrimitive.Title className="settings-title text-text-primary">
                        {proOptIn ? t('Help improve Auto Answer') : t('Auto Answer is part of Natively Pro')}
                    </DialogPrimitive.Title>
                    <DialogPrimitive.Description className="text-xs text-text-secondary mt-1.5">
                        {proOptIn
                            ? t('Share the transcripts of meetings where Auto Answer runs, so it learns when to answer and when to wait.')
                            : t('You can use it for free if you share the transcripts of meetings where Auto Answer runs. We use them to teach Auto Answer when to answer and when to wait.')}
                    </DialogPrimitive.Description>

                    <ul className="mt-3 space-y-1.5 text-xs text-text-secondary list-disc pl-4">
                        <li>{t('What is sent: the full transcript of each meeting where Auto Answer was on, including what other people said, with the meeting mode and length.')}</li>
                        <li>{t('Removed on your computer first: e-mail addresses, phone numbers, links and long numbers. Names and other words stay, so do not share meetings you are not allowed to share.')}</li>
                        <li>{t('Never sent: audio, screenshots, your notes, AI answers, meeting titles and calendar events.')}</li>
                        <li>{t('Only used to train and test Natively\'s Auto Answer models, with the services we use for that (Anthropic to label, Modal to train). Not sold, not used for ads. Kept until you delete it, at most 2 years.')}</li>
                        <li>{t('You are responsible for telling the other people in the meeting, where the law requires it.')}</li>
                        <li>{t('Stop any time in Settings › General. You can also delete everything you shared there.')}</li>
                    </ul>
                    <button
                        type="button"
                        className="mt-2 text-xs text-text-tertiary hover:text-text-primary underline"
                        onClick={() => { void window.electronAPI?.openExternal?.('https://heynatively.com/privacy#3-7-auto-answer-training'); }}
                    >{t('Privacy Policy §3.7')}</button>

                    <div className="mt-5 flex flex-wrap justify-end gap-2">
                        <DialogPrimitive.Close asChild>
                            <button type="button" disabled={busy} className="px-3 py-1.5 rounded-lg text-xs text-text-secondary hover:text-text-primary disabled:opacity-50">
                                {t('Not now')}
                            </button>
                        </DialogPrimitive.Close>
                        {!proOptIn && (
                            <button type="button" disabled={busy} onClick={onUpgrade} className="px-3 py-1.5 rounded-lg text-xs border border-border-subtle text-text-primary hover:bg-bg-item-surface disabled:opacity-50">
                                {t('See Pro plans')}
                            </button>
                        )}
                        <button type="button" disabled={busy} onClick={onShare} className="px-3 py-1.5 rounded-lg text-xs bg-accent-primary text-white inline-flex items-center gap-1.5 disabled:opacity-60">
                            {busy && <Loader2 size={12} className="animate-spin" />}
                            {proOptIn ? t('Share transcripts') : t('Share and turn on')}
                        </button>
                    </div>
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
};
