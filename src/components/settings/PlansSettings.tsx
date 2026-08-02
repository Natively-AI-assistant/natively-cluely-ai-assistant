import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n';
import { NativelyApiSettings } from './NativelyApiSettings';
import { NativelyProSettings } from './NativelyProSettings';
import { HowItWorksRefund } from './HowItWorksRefund';
import { getLicenseSnapshot, setLicenseSnapshot } from '../../lib/licenseCache';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { BEAT, EASE_ENTER, EASE_LEAVE, INK, SETTLE } from '../../lib/plansMotion';

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
    const reduceMotion = useReducedMotion();
    // NativelyProSettings independently re-derives isPremium (and provider,
    // for its own status-card copy) for its own rendering — this copy exists
    // only to decide whether to collapse the app-only-license section below.
    // Never a source of truth for the child's own render.
    // Seeded from the same process-level snapshot NativelyProSettings uses, so
    // the two cannot disagree on the first paint of a revisit. They previously
    // ran two independent async reads that both started from "unknown", which
    // is what made this section appear and then collapse on open.
    const [licenseDetails, setLicenseDetails] = useState<{ isPremium: boolean } | null>(
        () => { const s = getLicenseSnapshot(); return s ? { isPremium: s.isPremium } : null; },
    );

    // Mirror of the state above, so the async handler below can compare against
    // the CURRENT value instead of whatever its closure captured.
    const licenseDetailsRef = useRef(licenseDetails);
    licenseDetailsRef.current = licenseDetails;

    // Set for one beat when Pro is gained, so the child can tell a fresh
    // activation from an ordinary visit. It cannot work that out for itself:
    // gaining Pro moves the section to the other slot, so the child MOUNTS with
    // isPremium already true and has no way to see it was ever false.
    const [justActivated, setJustActivated] = useState(false);
    const holdRef = useRef<number | null>(null);
    const celebrateRef = useRef<number | null>(null);

    const applyPremium = useCallback((next: boolean) => {
        const wasPremium = !!licenseDetailsRef.current?.isPremium;
        if (wasPremium === next) { setLicenseDetails({ isPremium: next }); return; }

        if (!next) {
            // Losing Pro relocates this section between two DOM slots, which
            // DESTROYS the outgoing tree — so a card that wants to animate out
            // must be allowed to finish first.
            //
            // But only ONE cause of losing Pro has a card on screen to animate:
            // the user pressing Deactivate. Clearing the API key also revokes
            // the bundled licence (ipcHandlers.ts:6380), and in that case this
            // section was rendering `null`, so there is nothing to wait for.
            // Deferring anyway is what stranded the Pro purchase cards above the
            // API pricing until the backstop expired.
            //
            // The test is therefore a CLAIM from the child rather than an
            // inference from `provider` here. Only the component playing an exit
            // knows it is playing one, and this keeps `provider` out of the
            // parent (see the note further down about deliberately not checking
            // it). It also fails toward a cut rather than a freeze: no claim
            // means immediate commit, i.e. the old behaviour, never a stall.
            if (!exitClaimedRef.current) { setLicenseDetails({ isPremium: false }); return; }
            // The commit is driven by onExitComplete, with a backstop armed in
            // handleDeactivatePhase when the exit actually starts.
            return;
        }

        // GAINING Pro needs no hold — the incoming card owns its own entrance.
        setLicenseDetails({ isPremium: true });
        setJustActivated(true);
        if (celebrateRef.current) window.clearTimeout(celebrateRef.current);
        celebrateRef.current = window.setTimeout(() => setJustActivated(false), 1200);
    }, []);

    // True while the child has an exit in flight. Set from the child's phase
    // reports, which begin at the click — i.e. BEFORE the IPC round trip and
    // therefore before the `license-status-changed` event that main sends from
    // inside its handler. That ordering is what makes the gate reliable.
    const exitClaimedRef = useRef(false);

    // The per-flow arrival delay that used to live here is GONE. It existed
    // because the old height-based sequence gave each region its own slot, and
    // removal's slot (AT.license) stacked badly on top of the deactivate exit
    // that had already played. Under FLIP there is no per-region schedule to
    // stack: the leaver pops out of flow and the enterer claims its space in the
    // same commit, so every displaced element has exactly one net delta.

    const handleDeactivatePhase = useCallback((phase: 'idle' | 'pending' | 'exiting') => {
        exitClaimedRef.current = phase !== 'idle';
        if (phase === 'exiting') {
            // Armed HERE, not when the event arrived. Previously it had to cover
            // the IPC round trip as well as the animation, which is why it
            // needed 1200ms. Sized against the 380ms exit alone it can be much
            // tighter, and it is a pure backstop — onExitComplete normally beats
            // it by a wide margin.
            if (holdRef.current) window.clearTimeout(holdRef.current);
            holdRef.current = window.setTimeout(() => setLicenseDetails({ isPremium: false }), 900);
        }
        if (phase === 'idle' && holdRef.current) {
            // Deactivation failed and the card is staying. Release the hold, or
            // it would demote a licence that is still active.
            window.clearTimeout(holdRef.current);
            holdRef.current = null;
        }
    }, []);

    useEffect(() => () => {
        if (holdRef.current) window.clearTimeout(holdRef.current);
        if (celebrateRef.current) window.clearTimeout(celebrateRef.current);
    }, []);

    // Commit the demotion the moment the card reports its exit is done, and
    // cancel the backstop. Idempotent: the backstop firing first sets the same
    // state, and React bails on an identical value.
    const handleProExitComplete = useCallback(() => {
        if (holdRef.current) { window.clearTimeout(holdRef.current); holdRef.current = null; }
        exitClaimedRef.current = false;
        setLicenseDetails({ isPremium: false });
    }, []);

    const readLicense = useCallback(() => {
        window.electronAPI?.licenseGetDetails?.()
            .then((details) => {
                // Only reachable if the preload bridge is missing — the main
                // handler returns `{isPremium: false}` for a no-license user
                // and its own catch returns the same. Clear rather than keep
                // the persisted hint: a cold (flickering) next start is the
                // right failure mode, a permanently stale "you have Pro" is not.
                if (!details) { setLicenseDetails(null); setLicenseSnapshot(null); return; }
                applyPremium(!!details.isPremium);
                setLicenseSnapshot({ isPremium: !!details.isPremium, provider: (details as any).provider });
            })
            .catch(() => {});
    }, [applyPremium]);

    useEffect(() => { readLicense(); }, [initialHasNativelyKey, readLicense]);

    // `isPremium` now decides WHERE the Pro section renders, not just whether
    // it collapses, so a mount-time read alone is no longer enough: activating
    // a standalone licence happens inside NativelyApiSettings (the shared key
    // box routes a non-`natively_sk_` value to activation), which does not
    // change `initialHasNativelyKey` and so never re-ran the effect above. The
    // child re-derived its own state from this event and would flip to the
    // receipt card, but it would flip in the LOWER slot and stay there until
    // the tab was reopened. Same event, same source of truth, so the two
    // cannot disagree about position.
    useEffect(() => {
        return window.electronAPI?.onLicenseStatusChanged?.(() => readLicense());
    }, [readLicense]);

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
            justActivated={justActivated}
            onExitComplete={handleProExitComplete}
            parentIsPremium={isPremium}
            onDeactivatePhase={handleDeactivatePhase}
        />
    );

    return (
        // LayoutGroup so every `layout="position"` child below measures against
        // the SAME layout pass. Without it each region FLIPs independently and
        // they can disagree about where they are mid-transition.
        <LayoutGroup>
        {/* Deliberately NO `data-settings-stagger` here, or in NativelyApiSettings /
            NativelyProSettings. Every other Settings tab opts into the entrance
            cascade in src/index.css; this tab is the one exception and the omission
            is intentional:

              1. Its regions are `layout="position"` FLIP children under this
                 LayoutGroup. The cascade's translateY writes the same `transform`
                 the FLIP owns — and PlansMotionCompositing.test.mjs already forbids
                 compositing a y-offset on top of the FLIP.
              2. Its regions are `AnimatePresence mode="popLayout"` children, which
                 framer fades out via inline opacity. A CSS animation with
                 `animation-fill-mode: both` PINS opacity and silently swallows that
                 exit — the exact bug the comment below this one records as the
                 reason `animated fadeIn` was stripped from NativelyProSettings.

            This tab already animates; it does not need the generic cascade. */}
        <div className="space-y-6 animated fadeIn">
            <header>
                <h2 className="text-[17px] font-semibold text-text-primary tracking-[-0.015em]">{t('Plans & Billing')}</h2>
                <p className="text-[12px] text-text-secondary leading-relaxed mt-1.5">
                    {t('Natively API covers AI, transcription, and search. Pro, Max, and Ultra include the Pro app license at no extra cost. You can also buy Pro on its own if you prefer to use your own AI keys.')}
                </p>
            </header>

            {/* Position flips on entitlement. With no licence the app-only
                option is an alternative to subscribing, so it belongs after the
                plans as the "or" — it is competing for the same decision. Once
                owned it is no longer an offer but a receipt, and a receipt
                belongs next to the credential box it describes, not stranded
                below a wall of pricing that no longer applies to it.
                That target seam sits INSIDE NativelyApiSettings (between its
                key card and its plan chooser), which is why this goes through a
                slot prop rather than sibling ordering here.
                `isPremium` alone is the right test even though this only
                concerns STANDALONE Pro: a user who got Pro bundled with an API
                plan makes NativelyProSettings return null, so it renders
                nothing in either position and the choice is moot. Checking
                provider here would mean a second reason to care about it and
                two places to keep in sync. */}
            {/* Shifts rather than appears, so it needs `layout="position"` or it
                jumps when the Pro section changes size. Every element that should
                slide needs this prop; anything without it snaps. */}
            <motion.div layout="position" transition={{ layout: { duration: SETTLE.remove, ease: EASE_ENTER } }}>
                <NativelyApiSettings
                    initialIsSaved={initialHasNativelyKey}
                    afterKeySection={isPremium ? proSection : null}
                />
            </motion.div>

            {/* "Included with your Natively API plan" used to render as its own
                banner here, immediately above the Pro status card below, which
                says the same thing again ("Pro Active" + "no separate purchase")
                a few lines later — two ways of saying "you have Pro" back to
                back. That message now lives once, inside the status card itself
                (NativelyProSettings.tsx), which is also the more reliable place
                for it: this component and that one each fetch license details
                independently and asynchronously, so a banner rendered here could
                briefly disagree with the card rendered there mid-fetch. */}

            {/* Second in the arrival sequence when the API key is removed: the
                app-only licence becomes relevant again the moment the
                subscription that bundled it is gone. One BEAT after the plan
                chooser above, so the two read as a sequence rather than as one
                simultaneous reflow. */}
            <AnimatePresence mode="popLayout" initial={false}>
                {!isPremium && (
                    <motion.div
                        key="pro-section"
                        layout="position"
                        style={{ width: '100%', contain: 'layout' }}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0, scale: 0.985 }}
                        transition={
                            reduceMotion
                                ? { duration: INK.in, delay: BEAT }
                                : {
                                    layout: { duration: SETTLE.remove, ease: EASE_ENTER },
                                    opacity: { duration: INK.in, ease: EASE_ENTER, delay: BEAT },
                                    default: { duration: INK.out, ease: EASE_LEAVE },
                                }
                        }
                    >
                        {proSection}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Renders last, below the app-only-license section. It used to live
                at the tail of NativelyApiSettings, which pinned it *above* the
                Pro section (a sibling here), so it was extracted into its own
                component purely to make this ordering possible.
                Last in the sequence, and the only region animated with opacity
                and y but NO height: it is not appearing, it is being pushed down
                by what appeared above it. Animating a height it always had would
                misstate what changed. */}
            <motion.div
                // `layout="position"` and nothing else. This region never
                // appears or disappears — it only SHIFTS as things above it
                // change. FLIP translates it from its old box to its new one;
                // giving it an entrance would animate an arrival that isn't
                // happening. Without this prop it would simply jump.
                layout="position"
                transition={{ layout: { duration: SETTLE.remove, ease: EASE_ENTER } }}
            >
                <HowItWorksRefund />
            </motion.div>
        </div>
        </LayoutGroup>
    );
};
