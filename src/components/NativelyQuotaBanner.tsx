// src/components/NativelyQuotaBanner.tsx
// Startup banner shown when any Natively quota bucket reaches ≥90% usage.
// Checks on every startup — no throttle.

import React, { useEffect, useState } from 'react';
import { AlertTriangle, X, ArrowUpRight } from 'lucide-react';
import { formatMeter, normalizeQuota, type UsageMeter } from '../types/nativelyUsage';
import { GenieModal } from './ui/GenieModal';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import '../ui-components/LiquidGlassButton.css';

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
const UPGRADE_URL      = 'https://checkout.dodopayments.com/buy/pdt_0NbFixGmD8CSeawb5qvVl';

export const NativelyQuotaBanner: React.FC = () => {
    const [nearLimitBuckets, setNearLimitBuckets] = useState<NearLimitBucket[]>([]);
    const [visible, setVisible] = useState(false);
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

                if (cancelled || !result?.ok || !result.quota) {
                    console.log('[NativelyQuotaBanner] no quota data — skipping');
                    return;
                }

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

                console.log('[NativelyQuotaBanner] near-limit:', near);

                if (near.length === 0) return;

                setNearLimitBuckets(near);
                setVisible(true);
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
            <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                    <AlertTriangle size={14} className={`${amber} shrink-0 mt-[1px]`} strokeWidth={2} />
                    <span className="text-[13px] font-semibold text-text-primary">Natively quota almost full</span>
                </div>
                <button
                    onClick={() => setVisible(false)}
                    aria-label="Dismiss"
                    className="text-text-tertiary hover:text-text-primary transition-colors shrink-0 cursor-pointer"
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
                <span className="text-[11px] text-text-secondary">Resets on your next billing date</span>
                <button
                    onClick={() => (window.electronAPI as any)?.openExternal?.(UPGRADE_URL)}
                    className={`flex items-center gap-1 text-[11px] font-semibold ${amber} ${isLight ? 'hover:text-amber-700' : 'hover:text-amber-300'} transition-colors cursor-pointer`}
                >
                    Upgrade <ArrowUpRight size={11} strokeWidth={2.5} />
                </button>
            </div>
        </GenieModal>
    );
};
