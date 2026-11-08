// src/components/MeetingOfferToast.tsx
//
// "Meeting detected": the launcher's own corner notice for a call main's
// detector found (electron/services/meetingDetection/meetingOffer.ts). The
// update card's corner toast, row for row (UpdateModal.tsx: same tokens, same
// bottom-right slide, same Start / Not now pair as its "Restart and update"):
// a tile on the left, the meeting on the right. With Start automatically on
// (Settings › Calendar) the tile counts the seconds down to the start.
//
// Main owns the offer and the countdown; this only shows it and sends Start
// or Not now back. The OS notification for the same call is closed with it.
import React, { useEffect, useState } from 'react';
import { ArrowRight, Video } from 'lucide-react';
import { GenieModal } from './ui/GenieModal';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { useT } from '../i18n';
import { FONT, INK_DARK, INK_LIGHT, PANEL, PANEL_INK, QuietButton, TOAST_SHADOW } from './UpdateModal';
import { offerHeadline, offerSecondsLeft, type MeetingOfferLike } from '../lib/meetingOfferView.mjs';

export const MeetingOfferToast: React.FC = () => {
    const t = useT();
    const isLight = useResolvedTheme() === 'light';
    const ink = isLight ? INK_LIGHT : INK_DARK;
    const [offer, setOffer] = useState<MeetingOfferLike | null>(null);
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        let live = true;
        // One may already be up when this window (re)loads.
        window.electronAPI?.getMeetingOffer?.().then((o) => { if (live && o) setOffer(o); }).catch(() => {});
        const off = window.electronAPI?.onMeetingOffer?.((o) => setOffer(o));
        return () => { live = false; off?.(); };
    }, []);

    // The countdown's own clock, only while one runs.
    const counting = offer?.autoStartAt != null;
    useEffect(() => {
        if (!counting) return;
        setNow(Date.now());
        const timer = window.setInterval(() => setNow(Date.now()), 250);
        return () => window.clearInterval(timer);
    }, [counting, offer?.id]);

    const secondsLeft = offerSecondsLeft(offer, now);
    const headline = offer ? offerHeadline(offer) : '';

    const start = () => {
        if (!offer) return;
        const id = offer.id;
        setOffer(null);
        void window.electronAPI?.startMeetingOffer?.(id);
    };
    const notNow = () => {
        if (!offer) return;
        const id = offer.id;
        setOffer(null);
        void window.electronAPI?.dismissMeetingOffer?.(id);
    };

    return (
        <GenieModal
            open={!!offer}
            label="MeetingOfferToast"
            modal={false}
            placement="bottom-right"
            keepPictures={false}
            zIndex={9999}
            padding={20}
            wrapStyle={{ width: '340px', maxWidth: 'calc(100vw - 40px)' }}
            cardStyle={{
                background: isLight ? '#F7F8FC' : '#1C1C1E',
                boxShadow: isLight
                    ? 'inset 0 0 0 1px rgba(11,16,32,0.10), inset 0 1px 0 rgba(255,255,255,0.80), ' + TOAST_SHADOW.light
                    : 'inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.06), ' + TOAST_SHADOW.dark,
                fontFamily: FONT,
                WebkitFontSmoothing: 'antialiased',
            } as React.CSSProperties}
            cardProps={{ role: 'region', 'aria-label': t('Meeting detected') }}
            shadow={isLight ? TOAST_SHADOW.light : TOAST_SHADOW.dark}
            radius={16}
        >
            <div
                style={{
                    display: 'grid', gridTemplateColumns: '52px minmax(0, 1fr)', columnGap: '14px', alignItems: 'center',
                    width: '100%', boxSizing: 'border-box', minHeight: '93px', padding: '14px', textAlign: 'left',
                    fontFamily: FONT,
                }}
            >
                <span aria-hidden style={{
                    width: '52px', height: '52px', borderRadius: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: PANEL, color: PANEL_INK.strong, boxShadow: isLight ? 'inset 0 0 0 1px rgba(11,16,32,0.07)' : 'none',
                    fontSize: '17px', fontWeight: 300, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums',
                }}>
                    {secondsLeft !== null ? secondsLeft : <Video size={20} strokeWidth={1.8} />}
                </span>
                <div style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: ink.quiet }}>
                        {secondsLeft !== null ? t('Starting automatically') : t('Meeting detected')}
                    </span>
                    <span style={{
                        display: 'block', marginTop: '3px', fontSize: '15px', fontWeight: 500, letterSpacing: '-0.015em', color: ink.strong,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                        {headline}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '16px', marginTop: '2px' }}>
                        <button
                            type="button"
                            onClick={start}
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '9px 0', background: 'none', border: 0,
                                cursor: 'pointer', fontFamily: FONT, fontSize: '13px', fontWeight: 500, letterSpacing: '-0.008em',
                                color: ink.strong, whiteSpace: 'nowrap', outline: 'none',
                            }}
                        >
                            {secondsLeft !== null ? t('Start now') : t('Start Natively')}<ArrowRight size={13} strokeWidth={2} aria-hidden />
                        </button>
                        <QuietButton ink={ink} onClick={notNow}>{t('Not now')}</QuietButton>
                    </div>
                </div>
            </div>
        </GenieModal>
    );
};

export default MeetingOfferToast;
