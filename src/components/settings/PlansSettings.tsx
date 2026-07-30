import React, { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { NativelyApiSettings } from './NativelyApiSettings';
import { NativelyProSettings } from './NativelyProSettings';
import { HowItWorksRefund } from './HowItWorksRefund';

// ─── Thin container ─────────────────────────────────────────
// Natively API (managed AI/STT/search usage) and Natively Pro (a device
// license unlocking local-only features like Modes Manager and Resume/JD
// grounding) used to live as two separate, identically-branded settings
// tabs. That read as two competing products even though buying an API
// Pro/Max/Ultra plan already bundles — and auto-activates — a Pro license
// server-side (ipcHandlers.ts `set-natively-api-key` handler).
//
// This wraps both existing components UNCHANGED under one tab and adds a
// single explanatory line so the relationship is visible instead of
// implicit. It deliberately does not merge their internals — the API
// settings component owns a live free-trial polling/state machine that
// isn't worth entangling with the license-activation UI for a nav-level
// fix.
interface PlansSettingsProps {
    initialIsPremium?: boolean | null;
    initialHasNativelyKey?: boolean;
}

export const PlansSettings: React.FC<PlansSettingsProps> = ({
    initialIsPremium = null,
    initialHasNativelyKey = false,
}) => {
    const t = useT();
    // NativelyProSettings independently re-derives isPremium (and provider,
    // for its own status-card copy) for its own rendering — this copy exists
    // only to decide whether to collapse the app-only-license section below.
    // Never a source of truth for the child's own render.
    const [licenseDetails, setLicenseDetails] = useState<{ isPremium: boolean } | null>(null);

    useEffect(() => {
        window.electronAPI?.licenseGetDetails?.()
            .then((details) => setLicenseDetails(details ? { isPremium: !!details.isPremium } : null))
            .catch(() => {});
    }, [initialHasNativelyKey]);

    const isPremium = !!licenseDetails?.isPremium;
    // Natively API is the primary/default-visible path (it's the managed
    // subscription this product sells). The app-only license is always the
    // secondary option UNLESS it's the user's actual active entitlement —
    // once isPremium is true it renders as a compact status card (not a
    // pricing wall), so there's nothing left to declutter and it stays
    // fully expanded.
    //
    // For a non-Pro visitor the two side-by-side Yearly/Lifetime cards still
    // stay behind a disclosure: two full "choose a plan" pricing UIs stacked
    // at once was the actual clutter. What changed is WHAT that disclosure
    // looks like. It used to be a generic AccordionSection, which rendered a
    // grey title plus a grey paragraph and a chevron — visually identical to
    // the "How it works & refund policy" row directly beneath it, i.e. a
    // purchase path dressed as an FAQ entry, carrying no price and no call to
    // action. NativelyProSettings now owns a compact always-visible teaser
    // plaque instead (one row, live price, one high-contrast CTA) that
    // expands to the cards.
    //
    // It has to live in the child, not here, for two hard reasons: every
    // `.pricing-*` rule in index.css is scoped under
    // [data-interface-theme="…"], an attribute NativelyProSettings sets on
    // its own root and this component never sets; and the live prices come
    // from the `getNativelyPricing` fetch that only NativelyProSettings
    // makes, so summarising them here would mean either a second IPC call
    // site or a second copy of the hardcoded price fallbacks.
    const collapseProSection = !isPremium;

    const proSection = (
        <NativelyProSettings
            initialIsPremium={initialIsPremium}
            collapsePricing={collapseProSection}
        />
    );

    return (
        <div className="space-y-6 animated fadeIn">
            <header>
                <h2 className="text-[17px] font-semibold text-text-primary tracking-[-0.015em]">{t('Plans & Billing')}</h2>
                <p className="text-[12px] text-text-secondary leading-relaxed mt-1.5">
                    {t('Natively API covers AI, transcription, and search. Pro, Max, and Ultra include the Pro app license at no extra cost. You can also buy Pro on its own if you prefer to use your own AI keys.')}
                </p>
            </header>

            <NativelyApiSettings initialIsSaved={initialHasNativelyKey} />

            {/* "Included with your Natively API plan" used to render as its own
                banner here, immediately above the Pro status card below, which
                says the same thing again ("Pro Active" + "no separate purchase")
                a few lines later — two ways of saying "you have Pro" back to
                back. That message now lives once, inside the status card itself
                (NativelyProSettings.tsx), which is also the more reliable place
                for it: this component and that one each fetch license details
                independently and asynchronously, so a banner rendered here could
                briefly disagree with the card rendered there mid-fetch. */}

            {proSection}

            {/* Renders last, below the app-only-license section. It used to live
                at the tail of NativelyApiSettings, which pinned it *above* the
                Pro section (a sibling here), so it was extracted into its own
                component purely to make this ordering possible. */}
            <HowItWorksRefund />
        </div>
    );
};
