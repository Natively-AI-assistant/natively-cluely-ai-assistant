// src/components/AutoAnswerAccessDialog.tsx
//
// Auto Answer is Natively Pro, or free for a user who agrees to share the
// transcripts of meetings where it runs (premium/electron/autoAnswer/
// autoAnswerAccess.ts; Evin 2026-11-13). This is the one place that asks.
//
// The wording is the consent: it says what is sent (the whole transcript of a
// meeting where Auto Answer ran, other people's speech included), what is
// removed on the device, what is NOT sent, what it is for, and how to stop and
// delete. TRAINING_CONSENT_VERSION in autoAnswerAccess.ts goes up whenever this
// text changes in a way that matters, so earlier agreements stop counting.
//
// Same two-pane family as the trial, support, review and upgrade cards
// (FreeTrialModal.tsx, SupportToaster.tsx hold the measured ink): the words on
// a flat ground on the left, the image in its own inset panel on the right — a
// flower, for something that grows from what it is given. It pours out of the
// bottom of the window like every other popup (GenieModal), one layer above
// Settings (300), where ConfirmDialog also sits (400).
import React, { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, ArrowUpRight, Loader2, X } from 'lucide-react';
import { GenieModal } from './ui/GenieModal';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import flowerArt from '../assets/cards/flower.jpg';
import { useT } from '../i18n';

const LAYER = 400;
const PRIVACY_URL = 'https://heynatively.com/privacy#3-7-auto-answer-training';

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif';
// Same measured ink sets as the rest of the family.
const INK_DARK = { strong: '#F2F2F4', body: 'rgba(255,255,255,0.66)', quiet: 'rgba(255,255,255,0.52)', faint: 'rgba(255,255,255,0.48)' };
const INK_LIGHT = { strong: '#0B1020', body: 'rgba(11,16,32,0.68)', quiet: 'rgba(11,16,32,0.66)', faint: 'rgba(11,16,32,0.58)' };
const EASE_CSS = 'cubic-bezier(0.23, 1, 0.32, 1)';
const PLATE_ZOOM = 0.05;
const PLATE_ZOOM_IN = 1100;
const PLATE_ZOOM_OUT = 700;
const CTA_IN = 420;
const CTA_OUT = 280;
const SHADOW_LIGHT = '0 30px 70px -28px rgba(16,24,40,0.40)';
const SHADOW_DARK = '0 40px 90px -30px rgba(0,0,0,0.85)';
// The genie is the entrance; under reduced motion the column fades in instead.
const STAGGER = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const ITEM = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.3 } } };

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
    const reduced = useReducedMotion() ?? false;
    const isLight = useResolvedTheme() === 'light';
    const INK = isLight ? INK_LIGHT : INK_DARK;
    const [ctaActive, setCtaActive] = useState(false);
    const [ctaPressed, setCtaPressed] = useState(false);
    const [plateHover, setPlateHover] = useState(false);
    const close = () => { if (!busy) onOpenChange(false); };

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [open, busy]); // eslint-disable-line react-hooks/exhaustive-deps

    const ctaDur = ctaActive ? CTA_IN : CTA_OUT;
    const outline = (active: boolean) => ({
        border: `1px solid ${isLight
            ? (active ? 'rgba(11,16,32,0.46)' : 'rgba(11,16,32,0.22)')
            : (active ? 'rgba(255,255,255,0.44)' : 'rgba(255,255,255,0.24)')}`,
        background: isLight
            ? (active ? 'rgba(11,16,32,0.04)' : 'rgba(11,16,32,0)')
            : (active ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0)'),
        color: active ? INK.strong : (isLight ? 'rgba(11,16,32,0.84)' : 'rgba(255,255,255,0.88)'),
    });
    const quiet: React.CSSProperties = {
        background: 'none', border: 0, padding: '9px 0', flex: 'none', whiteSpace: 'nowrap',
        cursor: busy ? 'default' : 'pointer', fontFamily: FONT, fontSize: '13px', fontWeight: 500,
        letterSpacing: '-0.008em', color: INK.faint, transition: `color 200ms ${EASE_CSS}`,
    };
    const hoverInk = {
        onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.color = INK.body; },
        onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.color = INK.faint; },
        onFocus: (e: React.FocusEvent<HTMLButtonElement>) => { e.currentTarget.style.color = INK.body; },
        onBlur: (e: React.FocusEvent<HTMLButtonElement>) => { e.currentTarget.style.color = INK.faint; },
    };

    // The consent, as labelled lines: the same facts the bullet list carried.
    const terms: { label: string; text: string }[] = [
        { label: t('Sent'), text: t('The full transcript of each meeting where Auto Answer was on, including what other people said, with the meeting mode and length.') },
        { label: t('Removed first'), text: t('On your computer: e-mail addresses, phone numbers, links, long numbers, and the names Natively knows (yours, your calendar invitees\', the call\'s). Other names said aloud stay, so do not share meetings you are not allowed to share.') },
        { label: t('Never sent'), text: t('Audio, screenshots, your notes, AI answers, meeting titles and calendar events.') },
        { label: t('Used for'), text: t('Only training and testing Natively\'s Auto Answer models, with the services we use for that (Anthropic to label, Modal to train). Not sold, not used for ads. Kept until you delete it, at most 2 years.') },
        { label: t('Your part'), text: t('Telling the other people in the meeting, where the law requires it.') },
    ];

    return (
        <GenieModal
            open={open}
            label="AutoAnswerAccessDialog"
            keepPictures={false}
            zIndex={LAYER}
            onBackdropClick={close}
            // Dims, never blurs (3a9901ae4).
            backdropStyle={{ background: isLight ? 'rgba(10,10,18,0.30)' : 'rgba(0,0,0,0.80)' }}
            padding={16}
            wrapStyle={{ width: '680px', maxWidth: '100%' }}
            cardStyle={{
                background: isLight ? '#F7F8FC' : '#1C1C1E',
                boxShadow: isLight
                    ? 'inset 0 0 0 1px rgba(11,16,32,0.10), inset 0 1px 0 rgba(255,255,255,0.80), ' + SHADOW_LIGHT
                    : 'inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.06), ' + SHADOW_DARK,
                fontFamily: FONT,
                WebkitFontSmoothing: 'antialiased',
            } as React.CSSProperties}
            cardProps={{
                role: 'dialog',
                'aria-modal': true,
                'aria-labelledby': 'auto-answer-access-title',
                'aria-describedby': 'auto-answer-access-desc',
                onPointerEnter: e => { if (!reduced && e.pointerType === 'mouse') setPlateHover(true); },
                onPointerLeave: () => setPlateHover(false),
            }}
            shadow={isLight ? SHADOW_LIGHT : SHADOW_DARK}
            radius={20}
        >
            <div style={{ display: 'flex', alignItems: 'stretch', minHeight: '520px', maxHeight: 'calc(100vh - 48px)' }}>
                <div style={{
                    position: 'relative', zIndex: 2,
                    flex: '1 1 62%', minWidth: 0,
                    padding: '36px 28px 28px 36px',
                    display: 'flex', flexDirection: 'column', overflowY: 'auto',
                }}>
                    <button
                        type="button"
                        onClick={close}
                        disabled={busy}
                        aria-label={t('Not now')}
                        style={{
                            position: 'absolute', top: '14px', right: '10px',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: '28px', height: '28px', borderRadius: '8px',
                            background: 'none', border: 0, padding: 0,
                            cursor: busy ? 'default' : 'pointer', color: INK.faint,
                            transition: `color 200ms ${EASE_CSS}`,
                        }}
                        {...hoverInk}
                    >
                        <X size={16} strokeWidth={1.9} aria-hidden />
                    </button>

                    <motion.div
                        variants={STAGGER} initial={reduced ? 'hidden' : false} animate="show"
                        style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
                    >
                        <motion.div variants={ITEM} style={{ fontSize: '12px', fontWeight: 500, letterSpacing: '-0.005em', color: INK.quiet, margin: '0 0 18px' }}>
                            {proOptIn ? t('Auto Answer · optional') : t('Auto Answer · Natively Pro')}
                        </motion.div>

                        <motion.h2 variants={ITEM} id="auto-answer-access-title" style={{
                            fontSize: '32px', fontWeight: 300, letterSpacing: '-0.032em', lineHeight: 1.08,
                            margin: '0 0 16px', color: INK.strong,
                        }}>
                            {proOptIn ? t('Help it learn.') : t('Free, if you share.')}
                        </motion.h2>

                        <motion.p variants={ITEM} id="auto-answer-access-desc" style={{
                            fontSize: '13px', lineHeight: 1.55, letterSpacing: '-0.008em',
                            color: INK.body, margin: 0, maxWidth: '360px', textWrap: 'pretty',
                        } as React.CSSProperties}>
                            {proOptIn
                                ? t('Share the transcripts of meetings where Auto Answer runs, so it learns when to answer and when to wait.')
                                : t('Auto Answer is part of Natively Pro. You can use it free by sharing the transcripts of meetings where it runs, so it learns when to answer and when to wait.')}
                        </motion.p>

                        <motion.dl variants={ITEM} style={{
                            margin: '20px 0 0', display: 'grid', gridTemplateColumns: '92px minmax(0, 1fr)',
                            columnGap: '12px', rowGap: '10px',
                        }}>
                            {terms.map(({ label, text }) => (
                                <React.Fragment key={label}>
                                    <dt style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '-0.005em', lineHeight: 1.45, color: INK.strong }}>{label}</dt>
                                    <dd style={{ margin: 0, fontSize: '12px', lineHeight: 1.45, letterSpacing: '-0.004em', color: INK.body, textWrap: 'pretty' } as React.CSSProperties}>{text}</dd>
                                </React.Fragment>
                            ))}
                        </motion.dl>

                        {/* marginTop: auto pins the action row to the bottom of the column. */}
                        <motion.div variants={ITEM} style={{ marginTop: 'auto', paddingTop: '24px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'nowrap' }}>
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={onShare}
                                    onPointerEnter={e => { if (e.pointerType === 'mouse') setCtaActive(true); }}
                                    onPointerLeave={() => { setCtaActive(false); setCtaPressed(false); }}
                                    onPointerDown={() => setCtaPressed(true)}
                                    onPointerUp={() => setCtaPressed(false)}
                                    onFocus={e => { if (e.currentTarget.matches(':focus-visible')) setCtaActive(true); }}
                                    onBlur={() => setCtaActive(false)}
                                    style={{
                                        display: 'inline-flex', alignItems: 'center', gap: '8px',
                                        flex: 'none', whiteSpace: 'nowrap', padding: '9px 14px', borderRadius: '9px',
                                        ...outline(ctaActive || busy), outline: 'none',
                                        cursor: busy ? 'default' : 'pointer', fontFamily: FONT,
                                        fontSize: '13px', fontWeight: 500, letterSpacing: '-0.01em',
                                        transform: ctaPressed && !reduced ? 'scale(0.97)' : 'none',
                                        transition: `border-color ${ctaDur}ms ${EASE_CSS}, background-color ${ctaDur}ms ${EASE_CSS}, color ${ctaDur}ms ${EASE_CSS}, transform 120ms ${EASE_CSS}`,
                                    }}
                                >
                                    <span>{proOptIn ? t('Share transcripts') : t('Share and turn on')}</span>
                                    {busy
                                        ? <Loader2 size={14} strokeWidth={1.9} className="animate-spin" aria-hidden />
                                        : <ArrowRight size={14} strokeWidth={1.9} aria-hidden style={{
                                            flex: 'none',
                                            transform: ctaActive && !reduced ? 'translateX(3px)' : 'translateX(0)',
                                            transition: `transform ${ctaDur}ms ${EASE_CSS}`,
                                        }} />}
                                </button>
                                {proOptIn ? (
                                    <button type="button" disabled={busy} onClick={close} style={quiet} {...hoverInk}>{t('Not now')}</button>
                                ) : (
                                    <button type="button" disabled={busy} onClick={onUpgrade} style={quiet} {...hoverInk}>{t('See Pro plans')}</button>
                                )}
                            </div>
                            <div style={{ marginTop: '14px', fontSize: '11.5px', fontWeight: 500, color: INK.faint, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: '8px', rowGap: '2px' }}>
                                <span>{t('Stop any time in Settings › General, and delete everything you shared there.')}</span>
                                <button
                                    type="button"
                                    onClick={() => { void window.electronAPI?.openExternal?.(PRIVACY_URL); }}
                                    style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', fontFamily: FONT, fontSize: '11.5px', fontWeight: 500, color: INK.body, display: 'inline-flex', alignItems: 'center', gap: '2px' }}
                                >
                                    {t('Privacy Policy §3.7')}<ArrowUpRight size={12} strokeWidth={2} aria-hidden />
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                </div>

                <div style={{ flex: '0 0 34%', padding: '8px 8px 8px 0', display: 'flex' }}>
                    <div style={{
                        position: 'relative', flex: 1, borderRadius: '14px', overflow: 'hidden',
                        background: '#EEF1F8',
                        boxShadow: isLight ? 'inset 0 0 0 1px rgba(11,16,32,0.07)' : 'none',
                    }}>
                        <div aria-hidden style={{
                            position: 'absolute', inset: 0,
                            backgroundImage: `url(${flowerArt})`,
                            backgroundSize: 'cover',
                            backgroundPosition: '85% 50%',
                            transform: plateHover ? `scale(${1 + PLATE_ZOOM})` : 'scale(1)',
                            transformOrigin: '70% 50%',
                            transition: reduced ? undefined : `transform ${plateHover ? PLATE_ZOOM_IN : PLATE_ZOOM_OUT}ms ${EASE_CSS}`,
                            willChange: reduced ? undefined : 'transform',
                            pointerEvents: 'none',
                        }} />
                    </div>
                </div>
            </div>
        </GenieModal>
    );
};
