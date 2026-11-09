// src/components/NativelyQuotaBanner.tsx
// Startup banner shown when any Natively quota bucket reaches ≥90% usage.
// Checks on every startup — no throttle.

import React, { useEffect, useState } from 'react';
import { AlertTriangle, X, ArrowUpRight, ChevronRight } from 'lucide-react';
import { formatMeter, normalizeQuota, type UsageMeter } from '../types/nativelyUsage';
import { GenieModal } from './ui/GenieModal';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import '../ui-components/LiquidGlassButton.css';
import { CHECKOUT_URLS } from '../config/urls';
import { endedPackFromRefusal, isPackPlan, packMeetingBucket } from '../lib/apiPlans.mjs';

interface NearLimitBucket {
    label: string;
    /** Pre-formatted "4.1M / 6.5M" — the unit differs per resource, so the
     *  banner cannot render a raw pair and get minutes, tokens and dollars all
     *  right with one toLocaleString. */
    detail: string;
    pct: number;
}

const STARTUP_DELAY_MS = 3000;
const THRESHOLD_PCT    = 90;

// Who sees this, and what it offers them (2026-11-07).
//
// It needs a SAVED Natively key (getNativelyUsage answers ok:false without one)
// and returns early for a trial, so it is only ever shown to a key holder:
// a monthly or yearly subscriber, or someone on a one-time Pro pack.
//
//  - Subscriber: "Upgrade" opens Settings › Plans & Billing, where the tiers and
//    the Monthly / Yearly switch are. Never a pack: the server issues a pack
//    bought next to a subscription as a SEPARATE key, so a paying subscriber
//    would have to swap keys in the app to use it. (It used to open the
//    Standard monthly checkout, which is the plan most of them already have.)
//  - Pack: "Add hours" opens that pack's checkout. A pack bought on the same
//    email adds hours to the pack key already in the app; a pack does not reset,
//    so the footer says so instead of promising a billing date.
type Offer = { kind: 'plans' } | { kind: 'pack'; url: string };

export function quotaBannerOffer(plan: string | undefined, billingPeriod: string | undefined): Offer {
    if (billingPeriod === 'pack' || isPackPlan(plan)) {
        return { kind: 'pack', url: plan?.toLowerCase() === 'pack_heavy' ? CHECKOUT_URLS.packHeavy : CHECKOUT_URLS.packLight };
    }
    return { kind: 'plans' };
}

export const NativelyQuotaBanner: React.FC = () => {
    const [nearLimitBuckets, setNearLimitBuckets] = useState<NearLimitBucket[]>([]);
    const [visible, setVisible] = useState(false);
    const [offer, setOffer] = useState<Offer>({ kind: 'plans' });
    // A pack whose hours or days are gone: the card says so instead of "almost full".
    const [packEnded, setPackEnded] = useState(false);
    // The card is the Liquid Glass kit's clear pane (.lg-notice), shared with
    // the provider-change notice, so its text follows the theme: amber and red
    // step down a shade on light glass to stay legible.
    const isLight = useResolvedTheme() === 'light';
    const amber = isLight ? 'text-amber-600' : 'text-amber-400';

    useEffect(() => {
        let cancelled = false;

        const check = async () => {
            await new Promise(r => setTimeout(r, STARTUP_DELAY_MS));
            if (cancelled) return;

            try {
                const result = await window.electronAPI?.getNativelyUsage?.();
                console.log('[NativelyQuotaBanner] usage:', JSON.stringify(result));

                if (cancelled) return;

                // A pack that has run out is refused (403 subscription_inactive,
                // reason 'pack_ended'), so it has no quota to read. It is the one
                // refusal this card speaks to: the fix is more hours.
                const ended = endedPackFromRefusal(result, null);
                if (ended) {
                    const bucket = packMeetingBucket(ended.pack, THRESHOLD_PCT);
                    if (!bucket) return;
                    setOffer(quotaBannerOffer(ended.plan ?? undefined, 'pack'));
                    setPackEnded(true);
                    setNearLimitBuckets([bucket]);
                    setVisible(true);
                    window.electronAPI?.funnelTrack?.('upgrade_prompt', { surface: 'quota_banner', action: 'shown' })?.catch?.(() => {});
                    return;
                }

                if (!result?.ok || !result.quota) {
                    console.log('[NativelyQuotaBanner] no quota data — skipping');
                    return;
                }

                // A trial has a card of its own, with these numbers beside its
                // clock (TrialMeterToaster). This one would also promise a
                // reset on a billing date a trial does not have.
                if (result.plan === 'trial') return;

                const quota = normalizeQuota(result.quota);
                if (!quota) {
                    console.log('[NativelyQuotaBanner] unrecognised quota shape — skipping');
                    return;
                }

                // The FIVE metered resources, named the way the product names
                // them. Knowledge is split here rather than shown as one line:
                // a warning exists to tell someone what to do next, and
                // "Knowledge Usage 94%" does not distinguish "stop indexing"
                // from "stop retrieving".
                //
                // The server already computed each percentage — including ones
                // above 100 — so this does not recompute them. Recomputing is
                // how the banner and the settings panel end up disagreeing by a
                // rounding step about whether someone is at their limit.
                const candidates: Array<{ label: string; meter: UsageMeter | undefined }> = [
                    { label: 'AI Usage',   meter: quota.ai },
                    { label: 'Embeddings', meter: quota.knowledge?.embedding },
                    { label: 'Reranking',  meter: quota.knowledge?.reranker },
                    { label: 'Voice Usage', meter: quota.voice },
                    { label: 'Research',   meter: quota.research },
                ];

                // A pack is sold in meeting hours, so those usually run out first.
                const meeting = result.billing_period === 'pack' || isPackPlan(result.plan)
                    ? packMeetingBucket(result.pack, THRESHOLD_PCT)
                    : null;

                const near: NearLimitBucket[] = candidates
                    // `limit == null` is UNMETERED, not exhausted — warning on
                    // it would nag every customer whose plan does not yet meter
                    // a resource.
                    .filter((c): c is { label: string; meter: UsageMeter } =>
                        !!c.meter && c.meter.limit != null && c.meter.percent >= THRESHOLD_PCT)
                    .map(({ label, meter }) => ({
                        label,
                        detail: formatMeter(meter),
                        pct: Math.round(meter.percent),
                    }));
                if (meeting) near.unshift(meeting);

                console.log('[NativelyQuotaBanner] near-limit:', near);

                if (near.length === 0) return;

                setOffer(quotaBannerOffer(result.plan, result.billing_period));
                setNearLimitBuckets(near);
                setVisible(true);
                window.electronAPI?.funnelTrack?.('upgrade_prompt', { surface: 'quota_banner', action: 'shown' })?.catch?.(() => {});
            } catch (e: any) {
                console.log('[NativelyQuotaBanner] error:', e?.message);
            }
        };

        check();
        return () => { cancelled = true; };
    }, []);

    // A notice, not a modal: the launcher stays usable around it. Its numbers
    // are new every start-up, so no picture of it is kept (a kept one would
    // pour out last time's readings); it stays mounted so the close can play.
    return (
        <GenieModal
            open={visible}
            label="NativelyQuotaBanner"
            modal={false}
            placement="bottom-right"
            keepPictures={false}
            zIndex={9999}
            padding={24}
            wrapClassName="w-[320px]"
            cardClassName="lg-notice lg-notice-warn p-4 flex flex-col gap-3"
            // The stand-in for .lg-notice's lift while the genie runs.
            shadow={isLight ? '0 16px 36px -14px rgba(0,0,0,0.22)' : '0 22px 44px -18px rgba(0,0,0,0.7)'}
            radius={18}
        >
            {/* Header */}
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <AlertTriangle size={14} className={`${amber} shrink-0`} strokeWidth={2} />
                    <span className="text-[13px] font-semibold text-text-primary">{packEnded ? 'Your pack has ended' : 'Natively quota almost full'}</span>
                </div>
                <button
                    onClick={() => setVisible(false)}
                    aria-label="Dismiss"
                    className="flex text-text-tertiary hover:text-text-primary transition-colors shrink-0 cursor-pointer"
                >
                    <X size={14} strokeWidth={2} />
                </button>
            </div>

            {/* Bucket list */}
            <div className="flex flex-col gap-1.5">
                {nearLimitBuckets.map(({ label, detail, pct }) => (
                    <div key={label} className="flex items-center justify-between gap-2">
                        <span className="text-[12px] text-text-secondary shrink-0">{label}</span>
                        <span className={`text-[12px] font-medium tabular-nums text-right ${pct >= 100 ? (isLight ? 'text-red-600' : 'text-red-400') : amber}`}>
                            {detail} ({pct}%)
                        </span>
                    </div>
                ))}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-0.5">
                <span className="text-[11px] text-text-secondary">
                    {offer.kind === 'pack' ? 'Packs do not reset' : 'Resets on your next billing date'}
                </span>
                <button
                    onClick={() => {
                        window.electronAPI?.funnelTrack?.('upgrade_prompt', { surface: 'quota_banner', action: 'clicked' })?.catch?.(() => {});
                        if (offer.kind === 'pack') {
                            (window.electronAPI as any)?.openExternal?.(offer.url, { surface: 'quota_banner' });
                        } else {
                            void window.electronAPI?.openSettingsTab?.('plans');
                        }
                        setVisible(false);
                    }}
                    className={`flex items-center gap-1 text-[11px] font-semibold ${amber} ${isLight ? 'hover:text-amber-700' : 'hover:text-amber-300'} transition-colors cursor-pointer`}
                >
                    {/* An arrow out for a checkout in the browser; a chevron for Settings, which opens in the app. */}
                    {offer.kind === 'pack'
                        ? <>Add hours <ArrowUpRight size={11} strokeWidth={2.5} /></>
                        : <>Upgrade <ChevronRight size={11} strokeWidth={2.5} /></>}
                </button>
            </div>
        </GenieModal>
    );
};
