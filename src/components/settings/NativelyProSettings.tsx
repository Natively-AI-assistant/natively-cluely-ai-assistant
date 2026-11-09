import React, { useState, useEffect, useMemo, useRef, useId, useCallback } from 'react';
import { useT } from '../../i18n';
import { AnimatePresence, motion, useReducedMotion, type Variants, useMotionValue, useTransform, useSpring } from 'framer-motion';
import { CheckCircle, AlertCircle, X, ChevronDown, Check, ArrowUpRight } from 'lucide-react';
import { TierBand } from './NativelyApiSettings';
import './apiTier.css';
import { InteractiveCard } from '../ui/InteractiveCard';
import { getMeetingInterfaceTheme, type MeetingInterfaceTheme } from '../../lib/meetingInterfaceTheme';
import { AccordionPanel } from '../ui/AccordionSection';
import { getLicenseSnapshot, setLicenseSnapshot } from '../../lib/licenseCache';
import { BEAT, EASE_ENTER, EASE_LEAVE, INK, SETTLE } from '../../lib/plansMotion';
import { SwapLabel } from './SettingsRow';
import { LIFETIME_LIST, LIFETIME_SALE, YEARLY_LIST, YEARLY_SALE, lifetimeSaleLabel, yearlySaleLabel } from '../../lib/lifetimeSale.mjs';
import { CHECKOUT_URLS } from '../../config/urls';

// ─── Strong cubic-bezier easings (per emil-design-eng) ───────
// Never use the weak default `ease` / `ease-in` for UI motion.
const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];
const EASE_OUT_CSS = 'cubic-bezier(0.23, 1, 0.32, 1)';

// EASE_ENTER / EASE_LEAVE now live in ../../lib/plansMotion — NativelyApiSettings
// needs the same pair, and one settings component importing motion constants
// from a sibling settings component is the wrong dependency direction.

// ─── Card wrapper ────────────────────────────────────────────
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    return (
        <div className={`bg-bg-item-surface rounded-2xl border border-border-subtle overflow-hidden ${className}`}>
            {children}
        </div>
    );
}

// InteractiveCard now lives in ../ui/InteractiveCard so the Natively API
// tier card can share the exact same hover (cursor-tracked spotlight +
// press-scale), instead of a CSS-only imitation of it.

// ─── Pro poster: ONE overlay drawing, TWO scenes ───────────────────────────
//
// WHAT IS ON THE CARDS. Both cards draw the Natively overlay doing the only
// thing the app does: hearing a question and answering it live, on top of
// whatever is already on screen. A dim plate behind (the call or the doc you
// are actually in), the overlay panel in front of it, a level meter (it is
// listening), the question it picked up, the answer arriving, and a streaming
// caret. Yearly draws that scene alone. Lifetime draws the SAME scene, with
// the meter shifted right to open a gutter, and fills that gutter with a
// column of three source cards: the sources one answer is drawn from — your
// profile, the job description, the company.
//
// WHY TWO SCENES DO NOT ASSERT A FEATURE GAP, WHICH IS THE THING TO GET RIGHT
// HERE. Yearly and Lifetime ship the IDENTICAL feature set; they differ only
// in how you pay. A previous pair of drawings broke that badly — a persona
// node-graph on one card against a resume-vs-JD match diagram on the other,
// two different pictures of two different capabilities, side by side at the
// exact moment someone is choosing. This pair is built so that reading cannot
// happen:
//   * Every element of the base scene is present on both cards, in the same
//     place, from the same code path: same plate, same panel, same specular
//     crown, same four-bar meter with the same four value sets and durations,
//     same heard question at the same y, same two answer runs at the same y,
//     same caret. `SCENES` forks on exactly two numbers — where the meter
//     sits, and whether the source column is drawn — and everything else is
//     DERIVED from those, so there is no second set of coordinates that a
//     future edit could fork further.
//   * THE GROUNDED RUNS ARE SHORTER, AND THAT IS ARITHMETIC, NOT A DESIGN
//     DIFFERENCE. `meterX = 70` spends 48 units of the panel's width opening
//     the source gutter, and the panel's right edge is hard at 230, so the
//     bars that share those rows have to give the width back: question 76 vs
//     124, answer runs 144/87 vs 192/116. `CONTENT_RIGHT` and `QUESTION_RIGHT`
//     are fixed so both scenes END on the same two verticals, which is what
//     keeps the shortening reading as "the same panel with its sources shown"
//     rather than as a second layout. Do not "fix" this by letting the
//     grounded bars run past 230; they would clip on the panel's radius.
//   * The Lifetime scene is ADDITIVE, not different. It does not remove or
//     replace anything Yearly shows; it annotates the same answer with where
//     that answer came from. "Same product, seen from closer in" is the read,
//     not "a second product".
//   * The caption under the grid states the set applies to BOTH plans out
//     loud ("Both plans include the full Pro feature set: ..."). That is the
//     load-bearing sentence, and it is the one thing the older caption never
//     said. A picture cannot carry that claim; a sentence can, and the
//     pictures then only have to avoid contradicting it.
// If a future edit wants to differentiate the cards further, differentiate
// the BILLING (the BEST VALUE pill, the 3-year anchor, "Yours forever"), not
// the art. That is where the actual difference lives.
//
// WHY IT IS DRAWN THE WAY IT IS.
//   * NO TEXT ANYWHERE. Eight SVG labels were deleted from this surface for
//     rendering at ~3.5px. Zero `<text>` elements is the deliberate state:
//     at 1 unit = 1 pixel anything under ~10px is illegible, and every fact
//     worth naming is already named in the caption under the grid. So the
//     geometry has to carry itself — large shapes, not many small ones.
//     Nothing filled is under 5 units in its smallest dimension.
//   * NO FABRICATED NUMBERS. A "94% MATCH" badge was deleted from this
//     surface for quoting a figure the product does not compute. The source
//     column is deliberately three anonymous cards with a pip each: it says
//     "the answer is drawn from sources", which is true, and nothing more.
//   * THE SOURCE COLUMN IS VERTICAL WITH SMALL SQUARE PIPS, ON PURPOSE. A
//     first attempt used a horizontal ROW of chips carrying full-height
//     accent tags, and at 1:1 that band read as seven noisy accent ticks
//     rather than as sources — it competed with the meter, which is the one
//     thing on the card that has to read as a stack of accent verticals.
//     6x6 square pips down the left gutter do not.
//   * NO PERSPECTIVE GROUP. Both much older posters wrapped everything in
//     `perspective(600px) rotateX(16deg)`, which sheared the art and shrank
//     it a further ~6% on top of the viewBox scale. Flat and axis-aligned is
//     what survives at this size; the depth comes from the card's own
//     translateZ stack plus this panel's shadow and specular hairline, which
//     cost no legibility.
//   * 1:1 SCALE, AND THE SAME SCALE ON BOTH CARDS. Measured in a replica of
//     the real settings pane: 282px card, minus its 1px borders, minus
//     `px-6`, is 232px of inner width, magnified 1.0183 by the enclosing
//     `translateZ(18px)` under the card's perspective, giving 236.25px. A
//     `0 0 236 96` viewBox in an `h-[96px]` box therefore draws at 1.00 on
//     both cards, so a shape's number in this file IS its size in pixels on
//     screen. An older pair was rejected for looking like two unrelated
//     drawings precisely because it was built at two heights (100 vs 80) and
//     two scales; there is now one geometry, one box, one scale.
//
// `animate` gates every animation in here. It is fed `!prefersReducedMotion`
// from the component's `useReducedMotion()`, so under `reduce` this file
// emits zero `<animate>` elements — not a paused animation, none at all.
type PosterScene = 'live' | 'grounded';
type PosterVariant = 'yearly' | 'lifetime';

// One bar of the level meter. `values` must start and end on the same height
// so the loop is seamless; `y` is derived so the bar always grows about its
// own centre line rather than off the bottom.
const METER_CENTER_Y = 44;
const METER_KEY_TIMES = '0;0.33;0.66;1';
const METER_KEY_SPLINES = '0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1';
const METER_BAR_W = 4.5;
const METER_PITCH = 7.5;

// The four bars, shared by both scenes verbatim. Mutually prime-ish durations
// so the four never lock into one rhythm.
const METER_BARS: ReadonlyArray<{ values: [number, number, number, number]; dur: string }> = [
    { values: [11, 19, 9, 11], dur: '1.6s' },
    { values: [19, 10, 22, 19], dur: '1.9s' },
    { values: [14, 22, 11, 14], dur: '1.45s' },
    { values: [22, 13, 18, 22], dur: '2.1s' },
] as const;

// THE ONLY TWO NUMBERS THAT FORK. Everything else below is derived from
// `meterX`, so the two scenes cannot drift into two different drawings.
const SCENES: Record<PosterScene, { meterX: number; sources: boolean }> = {
    live: { meterX: 22, sources: false },
    grounded: { meterX: 70, sources: true },
};

// Fixed right edge for the panel's content. Both scenes end their answer runs
// on the SAME vertical, which is what makes the shifted meter read as "the
// same panel, seen with its sources shown" rather than as a different layout.
const CONTENT_RIGHT = 214;
const QUESTION_RIGHT = 184;
// Second answer run as a fraction of the first: short line + caret = mid-stream.
const ANSWER_SHORT_RATIO = 0.604;

function MeterBar({
    x,
    values,
    dur,
    animate,
    className,
}: {
    x: number;
    values: [number, number, number, number];
    dur: string;
    animate: boolean;
    className: string;
}) {
    const heights = values.join(';');
    const ys = values.map((v) => +(METER_CENTER_Y - v / 2).toFixed(2)).join(';');
    return (
        <rect
            x={x}
            y={METER_CENTER_Y - values[0] / 2}
            width={METER_BAR_W}
            height={values[0]}
            rx={METER_BAR_W / 2}
            className={className}
        >
            {animate && (
                <>
                    <animate
                        attributeName="height"
                        values={heights}
                        dur={dur}
                        repeatCount="indefinite"
                        calcMode="spline"
                        keyTimes={METER_KEY_TIMES}
                        keySplines={METER_KEY_SPLINES}
                    />
                    <animate
                        attributeName="y"
                        values={ys}
                        dur={dur}
                        repeatCount="indefinite"
                        calcMode="spline"
                        keyTimes={METER_KEY_TIMES}
                        keySplines={METER_KEY_SPLINES}
                    />
                </>
            )}
        </rect>
    );
}

// One source the answer is drawn from. Deliberately anonymous: a card, an
// accent pip, and one content line. Three of these stacked say "this answer
// has sources" — which is exactly what the Profile Engine, the JD read and
// company research do — without naming or counting anything the product does
// not actually produce.
const SOURCE_X = 20;
const SOURCE_W = 38;
const SOURCE_H = 13;
const SOURCE_GAP = 5.5;
// Centred on the panel's content band (y 36 -> 86), which clears the panel's
// 17-unit corner radius at both ends.
const SOURCE_TOP = 36;

function SourceCard({ y, accentClass }: { y: number; accentClass: string }) {
    return (
        <g>
            <rect
                x={SOURCE_X}
                y={y}
                width={SOURCE_W}
                height={SOURCE_H}
                rx={4}
                className="pricing-poster-source-fill pricing-poster-source-stroke"
                strokeWidth="1"
            />
            {/* 6x6, square and small: reads as a marker, not as another bar in
                a stack of accent verticals. See the header. */}
            <rect x={SOURCE_X + 4} y={y + 3.5} width={6} height={6} rx={1.75} className={accentClass} />
            <rect
                x={SOURCE_X + 14}
                y={y + 4}
                width={19}
                height={5}
                rx={2.5}
                className="pricing-poster-source-line"
            />
        </g>
    );
}

function ProOverlayPoster({
    variant,
    scene,
    animate,
}: {
    variant: PosterVariant;
    scene: PosterScene;
    animate: boolean;
}) {
    // Per-instance gradient ids. Both cards mount this component into the SAME
    // document, and duplicate `id`s do not error — the second card silently
    // resolves `url(#...)` against the FIRST card's gradient and inherits its
    // hue. `useId` output carries colons, which are legal in a URL fragment but
    // not in a CSS selector, so it is stripped down to word characters.
    const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
    const glowId = `proPosterGlow${uid}`;
    const glassId = `proPosterGlass${uid}`;
    const accentClass =
        variant === 'yearly' ? 'pricing-poster-accent-yearly' : 'pricing-poster-accent-lifetime';
    const glowClass =
        variant === 'yearly' ? 'pricing-poster-glow-yearly' : 'pricing-poster-glow-lifetime';

    const { meterX, sources } = SCENES[scene];
    // Everything below is DERIVED. No second coordinate set exists.
    const answerLongW = CONTENT_RIGHT - meterX;
    const answerShortW = +(answerLongW * ANSWER_SHORT_RATIO).toFixed(1);
    const caretX = +(meterX + answerShortW + 6).toFixed(1);
    const questionX = meterX + 38;
    const questionW = QUESTION_RIGHT - questionX;

    return (
        <div
            className="relative w-full h-[96px] select-none pointer-events-none overflow-hidden"
            aria-hidden="true"
        >
            <svg viewBox="0 0 236 96" className="w-full h-full">
                <defs>
                    {/* Ambient bloom behind the panel, in the card's own hue. */}
                    <radialGradient id={glowId} cx="50%" cy="52%" r="58%">
                        <stop offset="0%" className={glowClass} />
                        <stop offset="100%" className={glowClass} stopOpacity="0" />
                    </radialGradient>

                    {/* The overlay panel's glass body. */}
                    <linearGradient id={glassId} x1="0" y1="0" x2="0.35" y2="1">
                        <stop offset="0%" className="pricing-poster-glass-top" />
                        <stop offset="100%" className="pricing-poster-glass-bottom" />
                    </linearGradient>
                </defs>

                <circle cx="118" cy="50" r="112" fill={`url(#${glowId})`} />

                {/* THE PLATE BEHIND — the call, the doc, the page you are
                    actually working in. Only its top 26px are ever visible;
                    that is the point, it is what the overlay is covering. */}
                <rect
                    x="32"
                    y="2"
                    width="172"
                    height="52"
                    rx="13"
                    className="pricing-poster-plate-fill pricing-poster-plate-stroke"
                    strokeWidth="1"
                />
                <rect x="46" y="12" width="76" height="7" rx="3.5" className="pricing-poster-plate-bar" />
                <rect x="128" y="12" width="42" height="7" rx="3.5" className="pricing-poster-plate-bar-dim" />

                {/* THE OVERLAY PANEL IN FRONT. */}
                <rect
                    x="6"
                    y="28"
                    width="224"
                    height="64"
                    rx="17"
                    fill={`url(#${glassId})`}
                    className="pricing-poster-panel-border pricing-poster-panel-shadow"
                    strokeWidth="1"
                />
                {/* Specular crown: the hairline that makes the panel read as a
                    lit surface rather than a flat cut-out. Inset from the
                    corners so it does not fight the 17px radius. */}
                <path
                    d="M26 28.9 H210"
                    fill="none"
                    className="pricing-poster-panel-specular"
                    strokeWidth="1"
                    strokeLinecap="round"
                />

                {/* WHERE THE ANSWER COMES FROM — only in the `grounded` scene,
                    in the gutter the shifted meter opens up. */}
                {sources &&
                    [0, 1, 2].map((i) => (
                        <SourceCard
                            key={i}
                            y={SOURCE_TOP + i * (SOURCE_H + SOURCE_GAP)}
                            accentClass={accentClass}
                        />
                    ))}

                {/* IT IS LISTENING — the same four-bar level meter in both
                    scenes, at the scene's own x. */}
                {METER_BARS.map((bar, i) => (
                    <MeterBar
                        key={i}
                        x={meterX + i * METER_PITCH}
                        values={bar.values}
                        dur={bar.dur}
                        animate={animate}
                        className={accentClass}
                    />
                ))}

                {/* THE QUESTION IT HEARD — dimmer than the answer, because the
                    answer is the thing you are buying. */}
                <rect x={questionX} y="38" width={questionW} height="12" rx="6" className="pricing-poster-bar-weak" />

                {/* THE ANSWER, ARRIVING. Second line short + caret = mid-stream. */}
                <rect x={meterX} y="59" width={answerLongW} height="10" rx="5" className="pricing-poster-bar-strong" />
                <rect x={meterX} y="75" width={answerShortW} height="10" rx="5" className="pricing-poster-bar-strong" />
                <rect x={caretX} y="73" width={METER_BAR_W} height="14" rx={METER_BAR_W / 2} className={accentClass} />
            </svg>
        </div>
    );
}

interface NativelyProSettingsProps {
    initialIsPremium?: boolean | null;
    /**
     * When true (the caller's user is not already Pro), the Yearly/Lifetime
     * pricing grid renders behind a compact always-visible teaser row rather
     * than inline. Keeps the tab from stacking two full pricing UIs while
     * still putting a price and a call to action on screen without a click.
     * Ignored once this component's own license fetch says the user IS Pro:
     * the Pro-active status card is not a pricing wall, so there is nothing
     * to collapse.
     */
    collapsePricing?: boolean;
    /**
     * True for one beat immediately after the licence is ACTIVATED, so the
     * status card can play its arrival. Owned by the parent because gaining Pro
     * relocates this section to a different DOM slot: this component is
     * destroyed and remounted with `isPremium` already true, and so cannot
     * detect the transition itself.
     */
    justActivated?: boolean;
    /**
     * Fired when the Pro-active card has finished animating OUT after a
     * deactivation. The parent must not commit `isPremium: false` before this:
     * doing so relocates this section between DOM slots, which destroys the tree
     * mid-animation. Driving the commit from the animation's own completion
     * removes the race a fixed timer would have — main emits
     * `license-status-changed` from inside the IPC handler, i.e. BEFORE the
     * promise this component awaits resolves, so a parent-side timer starts
     * running before the exit has even begun.
     */
    onExitComplete?: () => void;
    /**
     * The PARENT's copy of isPremium, which is what decides which DOM slot this
     * section renders in. Used to stop this component's own branch from leading
     * that slot — see onStatusChanged.
     */
    parentIsPremium?: boolean;
    /**
     * Reports the deactivation phase upward. The parent defers its (destructive)
     * slot swap only while an exit has actually been CLAIMED here; every other
     * cause of losing Pro has nothing on screen to animate out.
     */
    onDeactivatePhase?: (phase: 'idle' | 'pending' | 'exiting') => void;
}

export const NativelyProSettings: React.FC<NativelyProSettingsProps> = ({
    initialIsPremium = null,
    // collapsePricing is still accepted but no longer used: the two Pro
    // cards always show (2026-11-09).
    justActivated = false,
    onExitComplete,
    parentIsPremium = false,
    onDeactivatePhase,
}) => {
    const t = useT();
    const prefersReducedMotion = useReducedMotion();
    const [interfaceTheme, setInterfaceTheme] = useState<MeetingInterfaceTheme>(() => {
        const theme = getMeetingInterfaceTheme();
        return theme === 'default' ? 'liquid-glass' : theme;
    });

    useEffect(() => {
        const handleStorage = () => {
            const theme = getMeetingInterfaceTheme();
            setInterfaceTheme(theme === 'default' ? 'liquid-glass' : theme);
        };
        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, []);

    // Surfaced under the Deactivate button — deactivation is the only action
    // this component still owns (license-key *entry* moved to the unified
    // "Natively key" card in NativelyApiSettings.tsx).
    const [errorMessage, setErrorMessage] = useState('');
    // Whether the Yearly/Lifetime grid is revealed. Only consulted when
    // `collapsePricing` is set; otherwise the grid is always shown.
    const [pricingOpen, setPricingOpen] = useState(false);
    // The teaser row: opening the grid scrolls it into view, never past this.
    const teaserRef = useRef<HTMLButtonElement>(null);


    // Seeded from the process-level snapshot so a revisit's first render already
    // knows whether this is a standalone licence or an API-bundled one. Without
    // it, `licenseProvider` was undefined on first paint, the component fell
    // through to the standalone branch, and the "Pro License Active" card
    // rendered for about a second before the details call resolved and hid it
    // again for API-plan users.
    const [isPremium, setIsPremium] = useState<boolean | null>(
        initialIsPremium ?? getLicenseSnapshot()?.isPremium ?? null,
    );
    // Distinguishes a Pro entitlement bundled with a Natively API plan
    // ('natively_api' — server-validated per request, stored with hwid: '',
    // not device-slot-limited) from a standalone device license
    // ('dodo'/'gumroad' — HWID-bound, where deactivating frees a real
    // activation slot). The deactivate caption below is only true for the
    // latter. Undefined (unknown / still loading) deliberately falls through
    // to the device-license wording rather than under-warning.
    const [licenseProvider, setLicenseProvider] = useState<string | undefined>(getLicenseSnapshot()?.provider);

    // 'pending' spans the licence-server round trip; 'exiting' spans the card's
    // departure animation, after which the parent unmounts this whole subtree.
    type DeactivatePhase = 'idle' | 'pending' | 'exiting';
    const [deactivatePhase, _setDeactivatePhase] = useState<DeactivatePhase>('idle');
    const onDeactivatePhaseRef = useRef(onDeactivatePhase);
    onDeactivatePhaseRef.current = onDeactivatePhase;
    // Single funnel so no call site can change the phase without telling the
    // parent — the parent's decision to defer its slot swap depends on it.
    const setDeactivatePhase = useCallback((phase: DeactivatePhase) => {
        _setDeactivatePhase(phase);
        onDeactivatePhaseRef.current?.(phase);
    }, []);
    // The license listener is registered once in a [] effect, so its closure
    // would otherwise read the phase from first render forever.
    const deactivatePhaseRef = useRef<DeactivatePhase>('idle');
    deactivatePhaseRef.current = deactivatePhase;
    const suppressRefreshRef = useRef(false);
    const parentIsPremiumRef = useRef(parentIsPremium);
    parentIsPremiumRef.current = parentIsPremium;

    // Gates the receipt card's entrance to a FRESH activation only — an
    // animation seen on every visit is one that should not exist.
    //
    // This HAS to come from the parent. The obvious local approach (remember
    // whether isPremium was false on mount) cannot work: gaining Pro moves this
    // section into the other DOM slot, so the component is destroyed and a new
    // one MOUNTS with isPremium already true — seeded true from the license
    // snapshot before its own fetch even resolves. It has no way to observe the
    // transition it is supposed to be reacting to. PlansSettings owns the flip,
    // so PlansSettings owns the signal.
    // LATCHED, never unlatched. `justActivated` is transient in the parent, and
    // reading it directly would make the root's `animate` prop go from an object
    // back to `undefined` when it expires — which framer treats as a NEW target
    // resolving toward `initial` — i.e. the card would animate itself back out
    // ~1.2s after arriving. Latching means the prop only ever has to be true for
    // a single render and the entrance is a genuine one-shot.
    const celebrateRef = useRef(false);
    if (justActivated) celebrateRef.current = true;
    const celebrate = celebrateRef.current;

    const refreshLicense = async () => {
        try {
            const details = await window.electronAPI?.licenseGetDetails?.();
            if (details) {
                setIsPremium(details.isPremium ?? false);
                setLicenseProvider((details as any).provider);
                setLicenseSnapshot({
                    isPremium: details.isPremium ?? false,
                    provider: (details as any).provider,
                });
            } else {
                setIsPremium(prev => prev ?? false);
                // Unreachable unless the preload bridge is missing. Drop the
                // persisted hint rather than let it outlive the state it
                // described — a cold next start beats a permanently wrong one.
                setLicenseSnapshot(null);
            }
        } catch {
            const check = window.electronAPI?.licenseCheckPremiumAsync ?? window.electronAPI?.licenseCheckPremium;
            if (check) {
                try {
                    const active = await check();
                    setIsPremium(active);
                    // Provider is unknowable on this path, and `undefined`
                    // already means "assume standalone" for the caption below.
                    setLicenseSnapshot({ isPremium: active });
                } catch {
                    setIsPremium(prev => prev ?? false);
                }
            } else {
                setIsPremium(prev => prev ?? false);
            }
        }
    };

    useEffect(() => {
        refreshLicense();
        // Listen to license status changes if the main process sends them.
        // Always re-fetch full details rather than trusting the event payload:
        // it only carries `isPremium`, not `provider`, so taking the fast path
        // would leave `licenseProvider` stale after an activate/deactivate.
        const onStatusChanged = (data?: { isPremium?: boolean }) => {
            // This event is the ONLY truthful signal that a deactivation really
            // happened. `license:deactivate` returns `{ success: true }`
            // unconditionally (ipcHandlers.ts:495 — the await is wrapped in an
            // empty catch), so the resolved promise says nothing; main sends
            // this event only on the path where LicenseManager.deactivate()
            // actually completed. Starting the exit here rather than off the
            // promise means a FAILED deactivation never plays it: the card stays
            // put, spinner running, until the guard surfaces the error.
            if (deactivatePhaseRef.current === 'pending' && data?.isPremium === false) {
                setDeactivatePhase('exiting');
                return;
            }
            // THE CHILD'S BRANCH MUST NEVER LEAD THE PARENT'S SLOT.
            // The parent positions this section from its own copy of isPremium.
            // Re-deriving ours first repaints us — still in the OLD slot — as
            // the branch the NEW slot is meant to show, and the relocation that
            // follows is the visible flicker. This is what made removing the
            // API key show the Pro purchase cards above the API pricing before
            // they jumped below it. Wait to be moved, then read; the effect
            // below performs the deferred read.
            if (data?.isPremium === false && parentIsPremiumRef.current) return;
            // While the exit is playing, the PARENT owns our removal — it swaps
            // this section between two DOM slots on `isPremium`, which destroys
            // this tree. Refreshing here would flip the ternary below in place
            // first, flashing the purchase cards into the receipt's slot for a
            // frame before the parent unmounts them.
            if (suppressRefreshRef.current) return;
            refreshLicense();
        };
        const removeLicenseListener = window.electronAPI?.onLicenseStatusChanged?.(onStatusChanged);

        return () => {
            removeLicenseListener?.();
        };
    }, []);

    // Backstop for a deactivation that reports success but never actually takes
    // effect. `license:deactivate` in the main process returns `{ success: true }`
    // unconditionally — the await around `LicenseManager.deactivate()` is wrapped
    // in a `catch {}` that swallows failures — so a network error looks identical
    // to success from here. Without this the card would fade out and then
    // reappear when the parent's flip never came, with nothing said. If we are
    // still mounted and still 'exiting' after this long, the flip is not coming.
    const exitGuardRef = useRef<number | null>(null);
    useEffect(() => () => { if (exitGuardRef.current) window.clearTimeout(exitGuardRef.current); }, []);

    // The deferred half of the "branch must not lead the slot" rule above: once
    // the parent has committed the new position, read the real state.
    useEffect(() => { refreshLicense(); }, [parentIsPremium]);

    const handleDeactivate = async () => {
        // Hard guard, and the reason no confirmation dialog is needed here: the
        // real hazard of a mis-click is not the deactivation (re-entering the key
        // restores it) but firing TWO round trips and burning two activation-slot
        // operations on the licence server.
        if (deactivatePhase !== 'idle') return;
        setDeactivatePhase('pending');
        suppressRefreshRef.current = true;
        try {
            await window.electronAPI?.licenseDeactivate?.();
            // Deliberately does NOT advance to 'exiting' here, and deliberately
            // no refreshLicense(). The resolved promise is not evidence — see
            // onStatusChanged above, which is what actually moves us on. This
            // only arms the failure guard.
            exitGuardRef.current = window.setTimeout(() => {
                if (deactivatePhaseRef.current !== 'pending') return;
                suppressRefreshRef.current = false;
                setErrorMessage('Deactivation did not complete. Please try again.');
                setDeactivatePhase('idle');
                refreshLicense();
            }, 2500);
        } catch (e: any) {
            suppressRefreshRef.current = false;
            setErrorMessage(e.message || 'Deactivation failed.');
            setDeactivatePhase('idle');
        }
    };

    const openExternal = (url: string) => { (window.electronAPI as any)?.openExternal?.(url, { surface: 'pro_settings' }); };
    // Literals, because they always were. These sat behind a
    // getNativelyPricing fetch whose /v1/pricing route exists in no version of
    // natively-api — added 2026-05-29 in a commit named "partial" and never
    // finished on the server — so the `||` right side won every render for
    // three months. Both links verified live on 2026-09-08. Changing a price
    // or a checkout link is an app release; that was already the case.
    // Shared with the paywalls' in-panel plans page (config/urls.ts).
    const lifetimeUrl = CHECKOUT_URLS.proLifetime;
    const yearlyUrl = CHECKOUT_URLS.proYearly;
    // Yearly $30 from 2026-11-06, lifetime $60 from 2026-11-01, each shown
    // against a struck list price ($39, $79) only during a named sale
    // (lib/lifetimeSale.mjs, same windows as the website's /pricing).
    const yearlyPriceText = `$${YEARLY_SALE}`;
    const yearlyListText = `$${YEARLY_LIST}`;
    const lifetimePriceText = `$${LIFETIME_SALE}`;
    const lifetimeListText = `$${LIFETIME_LIST}`;
    // Read once per mount: Settings is reopened far more often than a sale
    // window turns over.
    const lifetimeSale = useMemo(() => lifetimeSaleLabel(new Date()), []);
    const yearlySale = useMemo(() => yearlySaleLabel(new Date()), []);

    // Parse numeric prices once. Used both for the "Save N%" chip on the
    // toggle and for the live "Save $X over 3 years" copy under the
    // lifetime CTA — concrete anchoring is more persuasive than a percent.
    const { yearlyPrice, lifetimePrice, lifetimeSavingsPct, lifetimeSavingsAbs, yearlyDiscountAbs, yearlyOriginalText } = useMemo(() => {
        const parsePrice = (s?: string | null): number | null => {
            if (!s) return null;
            const m = s.match(/([0-9]+(?:\.[0-9]+)?)/);
            return m ? parseFloat(m[1]) : null;
        };
        const y = parsePrice(yearlyPriceText);
        const l = parsePrice(lifetimePriceText);
        const horizon = 3;
        let pct: number | null = null;
        let abs: number | null = null;
        if (y && l) {
            const totalYearly = y * horizon;
            if (totalYearly > 0 && l < totalYearly) {
                pct = Math.round(((totalYearly - l) / totalYearly) * 100);
                abs = Math.round(totalYearly - l);
            }
        }
        // INSIDER20 anchor: synthesize a "was" price for the Yearly card by
        // dividing by 0.8 (the post-coupon price is 80% of original). Render
        // strikethrough only if the math is clean.
        let yearlyOrig: string | null = null;
        let yearlyDiscount: number | null = null;
        if (y) {
            const original = Math.round(y / 0.8);
            // currency symbol detection — keep whatever the API returned
            const symbolMatch = yearlyPriceText.match(/^([^0-9]+)/);
            const symbol = symbolMatch ? symbolMatch[1] : '$';
            yearlyOrig = `${symbol}${original}`;
            yearlyDiscount = Math.round(((original - y) / original) * 100);
        }
        return {
            yearlyPrice: y,
            lifetimePrice: l,
            lifetimeSavingsPct: pct,
            lifetimeSavingsAbs: abs,
            yearlyDiscountAbs: yearlyDiscount,
            yearlyOriginalText: yearlyOrig,
        };
    }, [yearlyPriceText, lifetimePriceText]);

    // ─── Motion variants ─────────────────────────────────────
    // Parent stagger: header → toggle → cards → feature grid.
    // Reduced-motion: keep opacity fade, drop the y-offset stagger.
    const containerVariants: Variants = prefersReducedMotion
        ? {
            hidden: { opacity: 0 },
            visible: { opacity: 1, transition: { duration: 0.2 } },
        }
        : {
            hidden: { opacity: 0 },
            visible: {
                opacity: 1,
                transition: {
                    staggerChildren: 0.05,
                    // 0.08, not 0.02: this is the beat AFTER the receipt card's
                    // exit finishes and the parent swaps slots. The purchase
                    // cards appear in a different part of the page, so without a
                    // pause the two halves overlap and you get movement in two
                    // places at once instead of a legible sequence.
                    delayChildren: 0.08,
                    when: 'beforeChildren',
                },
            },
        };

    const itemVariants: Variants = prefersReducedMotion
        ? {
            hidden: { opacity: 0 },
            visible: { opacity: 1, transition: { duration: 0.18 } },
        }
        : {
            hidden: { opacity: 0, y: 10 },
            visible: {
                opacity: 1,
                y: 0,
                // EASE_ENTER, not EASE_OUT: with the old curve 83% of the travel
                // happened in the first 96ms, so the 50ms stagger between cards
                // was effectively invisible — every card looked like it arrived
                // at once. This is what makes the cascade actually read.
                transition: { duration: 0.30, ease: EASE_ENTER },
            },
        };

    const priceTickAnim = prefersReducedMotion
        ? undefined
        : { scale: [1, 1.04, 1] };
    const priceTickTransition = { duration: 0.22, ease: EASE_OUT, times: [0, 0.5, 1] };

    // Lifetime pulse one-shot — transient box-shadow override that CSS
    // releases back to its [data-active] steady state after 520ms.
    const lifetimePulseShadow =
        '0 0 0 2px rgba(171, 193, 251, 0.85), 0 0 64px -4px rgba(110, 140, 230, 0.70), 0 20px 50px rgba(78, 111, 226, 0.42), 0 4px 14px rgba(0, 0, 0, 0.30)';

    if (isPremium === null) {
        return <div className="p-8 flex justify-center"><div className="w-5 h-5 border-2 border-white/40 border-t-transparent rounded-full animate-spin" /></div>;
    }

    // Pro that came bundled with a Natively API plan: render nothing at all.
    //
    // This whole section is the APP-ONLY licence, i.e. the alternative to
    // subscribing. Someone already on an API plan has Pro through it, so the
    // section has nothing to offer them: the purchase cards would be selling
    // what they already have, and the "Pro License Active" card would offer a
    // Deactivate button for a licence they never bought. That button is also
    // mildly harmful here, since deactivating a bundled entitlement leaves Pro
    // off with no obvious way back (the only re-arm path is saving the API key
    // again). Nothing is lost by hiding it: that the plan includes Pro is
    // already stated in the API section, on the tier card's feature row and in
    // its note.
    //
    // `licenseProvider === undefined` deliberately does NOT hide. Provider is
    // only known on the licenseGetDetails success path; the fallback path sets
    // isPremium alone. Unknown provider therefore falls through to the
    // standalone-licence branch, which is the safe direction: showing a
    // deactivate control to someone who might need it beats hiding one from an
    // owner who does.
    if (isPremium && licenseProvider === 'natively_api') {
        return null;
    }

    return (
        // `animated fadeIn` was removed from this root. It is a CSS keyframe
        // animation on the very element framer now writes inline `opacity` to
        // during the exit; with `animation-fill-mode: forwards` it would pin
        // opacity and silently swallow the fade. Framer owns this element's
        // mount and departure now, so the class is redundant as well as unsafe.
        //
        // Ink leaves first (180ms), THEN the space closes (60-380ms). Collapsing
        // a still-visible card looks like it is being crushed; fading and then
        // collapsing reads as removal. `overflow: hidden` only while exiting —
        // the root has none of its own, and without it the content spills out of
        // the shrinking box.
        // THE SPACE (height + margin) IS ANIMATED HERE, ON THE ROOT, and the
        // card's own ink (opacity/y/scale) on a wrapper inside. That split is
        // forced, not stylistic: this root is the element that sits in the
        // parent's `space-y-6` flow, so it is the one carrying the 24px margin.
        // Animating height on the inner wrapper alone would leave that margin
        // applied from the first frame — a 24px hole opening instantly and
        // sitting empty for the 180ms before the card arrives.
        // '1.5rem' mirrors `space-y-6`; it is written only while celebrating or
        // exiting, so the class governs every other render.
        // FLIP, not resizing. This root used to animate `height` and `marginTop`
        // between 0 and auto on both the deactivate exit and the activation
        // entrance — layout and paint of this subtree and everything below it,
        // every frame, with `overflow: hidden` bounds changing so the layer
        // could never be cached. That is what made it choppy.
        // The parent now pops this out of flow on exit (mode="popLayout"), so
        // the space closes in ONE commit and this only has to fade over its own
        // box. `layout="position"` FLIPs its position with a transform when
        // things above it change size — translate only, never scale, so the
        // card's radii, borders and specular hairlines are not distorted.
        <motion.div
            className="space-y-6"
            layout="position"
            data-interface-theme={interfaceTheme}
            onAnimationComplete={() => {
                if (deactivatePhase !== 'exiting') return;
                if (exitGuardRef.current) { window.clearTimeout(exitGuardRef.current); exitGuardRef.current = null; }
                onExitComplete?.();
            }}
            style={{ contain: 'layout' }}
            initial={celebrate && !prefersReducedMotion ? { opacity: 0 } : false}
            animate={
                deactivatePhase === 'exiting'
                    ? (prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.985 })
                    : { opacity: 1, scale: 1 }
            }
            transition={
                prefersReducedMotion
                    ? { duration: INK.out, layout: { duration: 0 } }
                    : deactivatePhase === 'exiting'
                        ? { duration: INK.out, ease: EASE_LEAVE }
                        : {
                            layout: { duration: SETTLE.activate, ease: EASE_ENTER },
                            opacity: { duration: INK.in, ease: EASE_ENTER, delay: BEAT },
                            scale: { duration: INK.in, ease: EASE_ENTER, delay: BEAT },
                        }
            }
        >

            {isPremium ? (
                /* A settled state, not a destination: nothing here needs doing,
                   and the one action available is one the user rarely wants. It
                   used to be a centred hero — 64px badge, 18px headline, a
                   three-feature sentence and a full-width red button — roughly
                   the same visual weight as the two purchase cards it replaces,
                   for a card whose entire message is "you're set". Now a single
                   row: state on the left, exit on the right. */
                // The card's INK. The space it occupies is animated on the root
                // above; this only fades and settles the content into it, 120ms
                // later, so the box opens first and is then filled rather than
                // both happening at once.
                // `initial={false}` is the gate: an already-licensed user opening
                // the tab gets the card at rest with no animation at all.
                // `y: -8` rather than +8 — it descends FROM the credential box
                // that produced it, which sits directly above this slot.
                <motion.div
                    initial={
                        !celebrate ? false
                            : { opacity: 0, scale: 0.985 }
                    }
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: INK.in, ease: EASE_ENTER, delay: BEAT }}
                >
                <Card className="pro-active-card">
                    <div className="flex items-center gap-3.5 px-4 py-3.5">
                        {/* No frosted plate around the glyph. The old 36px
                            tinted-fill + hairline-border badge was the
                            liquid-glass vocabulary being dropped, and on a
                            saturated slab a boxed icon is redundant anyway —
                            the card already provides the container.
                            Wrapped in a span rather than making CheckCircle a
                            motion component: lucide's SVG components do not
                            reliably forward motion props. */}
                        <motion.span
                            className="shrink-0 inline-flex"
                            initial={celebrate && !prefersReducedMotion ? { scale: 0.6, opacity: 0 } : false}
                            animate={celebrate && !prefersReducedMotion ? { scale: [0.6, 1.12, 1], opacity: [0, 1, 1] } : undefined}
                            transition={{ duration: 0.42, delay: 0.30, times: [0, 0.62, 1], ease: EASE_ENTER }}
                        >
                            <CheckCircle size={18} className="pro-active-check" strokeWidth={2.2} />
                        </motion.span>
                        {/* min-w-0 so the label truncates instead of shoving the
                            button off the row at narrow modal widths. */}
                        <div className="min-w-0 flex-1">
                            <h2 className="pro-active-ink text-[13.5px] font-semibold tracking-[-0.01em]">Pro License Active</h2>
                            {/* Only the standalone, device-bound licence reaches this
                                card now (the API-bundled case returns null above), so
                                this no longer branches on provider. The consequence of
                                deactivating used to be a separate footnote below the
                                button; folded in here because it is the only thing the
                                user actually needs to know before pressing it, and it
                                reads better as context than as fine print. */}
                            <p className="pro-active-sub text-[11.5px] leading-snug mt-0.5">
                                Unlocked on this device. Deactivate to free it for another computer.
                            </p>
                        </div>
                        {/* Jelly clay, the same construction as the Activate CTA on
                            the Natively key plaque. Neutral at rest because a
                            destructive control should not outrank the state it is
                            attached to; the danger colour arrives as a full fill on
                            hover, once the pointer is committed. Paint lives in
                            `.pro-deactivate-cta` (index.css) — the transition and
                            press states are declared there, so no inline `style`
                            here to be outranked by it. */}
                        <button
                            onClick={handleDeactivate}
                            disabled={deactivatePhase !== 'idle'}
                            data-phase={deactivatePhase}
                            aria-busy={deactivatePhase === 'pending'}
                            className="pro-deactivate-cta shrink-0 px-3.5 py-1.5 text-[12px] font-medium flex items-center justify-center gap-1.5 cursor-pointer focus-visible:outline-none"
                        >
                            {/* No crossfade on the label swap. The change is
                                instantaneous and user-caused, the press already
                                acknowledged it, and a 12px label dissolving
                                inside a pill reads as a flicker rather than as
                                a transition. */}
                            {deactivatePhase === 'idle' ? (
                                <><X size={13} /> Deactivate</>
                            ) : (
                                <><span className="pro-deactivate-spinner" aria-hidden /> Deactivating…</>
                            )}
                        </button>
                    </div>
                    {/* Ink and edge are lifted off the slab rather than pulled
                        from the red-500 token, which is tuned for a neutral card
                        and goes muddy on saturated green.
                        The margins live on the INNER div: a wrapper that
                        collapses to height 0 must not carry margin of its own,
                        or it leaves the gap behind. */}
                    <AnimatePresence>
                        {errorMessage && (
                            /* The one deliberate height animation left in this
                               tab. Everything page-level is FLIP (see
                               ../../lib/plansMotion), but this is a ~40px row
                               INSIDE a card that already has `contain: layout`,
                               it only exists on a failed deactivation, and a row
                               sliding open is the correct read for an error
                               appearing in place. FLIP would be machinery for
                               nothing here. Do not use it as precedent for a
                               page region. */
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.26, ease: EASE_ENTER }}
                                style={{ overflow: 'hidden' }}
                                className="relative z-[3]"
                            >
                                <div className="mx-4 mb-3.5 flex items-center gap-2 px-3 py-2 bg-[rgba(60,6,6,0.42)] border border-[rgba(255,180,180,0.34)] rounded-lg text-[12px] text-[#FFD9D9] font-medium">
                                    <AlertCircle size={14} className="shrink-0" /> {errorMessage}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </Card>
                </motion.div>
            ) : (
                <motion.div
                    variants={containerVariants}
                    initial="hidden"
                    animate="visible"
                    className="space-y-4"
                >
                    {/* ── Natively Pro on its own: two cards ──────────────────
                        Drawn like the API plans and the Pro packs above (website
                        tier cards), so the whole tab reads as one set. The old
                        teaser plaque, its show/hide accordion and the card art
                        were removed at the owner's request (2026-11-09). The
                        struck list price still appears only while a named sale
                        runs (lib/lifetimeSale.mjs). */}
                    <div className="pt-3" id="natively-pro-pricing">
                        <div className="flex items-baseline justify-between gap-3 px-1 mb-2">
                            <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-[0.07em]">Natively Pro</p>
                            <span className="text-[11px] text-text-tertiary whitespace-nowrap">Use your own AI keys</span>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            {[
                                {
                                    id: 'yearly',
                                    name: 'Pro Yearly',
                                    mesh: 'pro' as const,
                                    pattern: 'rings' as const,
                                    badge: undefined as string | undefined,
                                    blurb: 'Billed annually. Cancels anytime.',
                                    list: yearlySale !== null ? yearlyListText : null,
                                    price: yearlyPriceText,
                                    per: '/ year',
                                    save: 'Renews yearly',
                                    saveOn: false,
                                    cta: 'Get Pro',
                                    url: yearlyUrl,
                                },
                                {
                                    id: 'lifetime',
                                    name: 'Pro Lifetime',
                                    mesh: 'ultra' as const,
                                    pattern: 'grid' as const,
                                    badge: lifetimeSale ?? 'Best value',
                                    blurb: 'One-time payment. Yours forever.',
                                    list: lifetimeSale !== null ? lifetimeListText : null,
                                    price: lifetimePriceText,
                                    per: 'once',
                                    save: lifetimeSavingsAbs !== null ? `Save $${lifetimeSavingsAbs} vs 3 years of yearly` : 'Pay once, never renew',
                                    saveOn: lifetimeSavingsAbs !== null,
                                    cta: 'Lock in lifetime',
                                    url: lifetimeUrl,
                                },
                            ].map((c) => (
                                <section key={c.id} data-pro={c.id} aria-label={c.name} className="api-tier api-tier-card" data-tier={c.id === 'yearly' ? 'pro' : undefined}>
                                    <TierBand mesh={c.mesh} pattern={c.pattern} name={c.name} badge={c.badge} />
                                    <div className="api-tier-well">
                                        <p className="api-tier-blurb">{c.blurb}</p>
                                        <p className="api-tier-price">
                                            {c.list && <s className="api-tier-was">{c.list}</s>}
                                            <span className="api-tier-amount">{c.price}</span>
                                            <span className="api-tier-per">{c.per}</span>
                                        </p>
                                        {/* One line on both cards, so the two wells and lists line up. */}
                                        <p className="api-tier-save" data-on={c.saveOn ? 'true' : 'false'}>{c.save}</p>
                                        <button
                                            type="button"
                                            onClick={() => openExternal(c.url)}
                                            aria-label={`${c.cta}, ${c.price} ${c.per === 'once' ? 'once' : 'per year'}. Opens checkout`}
                                            className="api-tier-cta"
                                        >
                                            {c.cta} <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden="true" />
                                        </button>
                                    </div>
                                    {/* Both plans ship the same Pro features, named as the app names them. */}
                                    <ul className="api-tier-tray">
                                        {['Persona Modes Manager', 'Connectors', 'Profile Intelligence'].map((f) => (
                                            <li key={f}><Check size={14} strokeWidth={2} aria-hidden="true" /><span>{t(f)}</span></li>
                                        ))}
                                    </ul>
                                </section>
                            ))}
                        </div>
                        <p className="text-[11px] text-text-tertiary px-1 mt-2 leading-snug">
                            {t('Pro runs on your own keys (BYOK) with any provider. Set up an AI model, speech-to-text and retrieval, and the whole app works as expected.')}
                        </p>
                    </div>

                    {/* "Already purchased? Enter your license key" card intentionally
                        removed — the Natively key card (NativelyApiSettings.tsx,
                        rendered above this component in PlansSettings.tsx) accepts
                        either credential type in one box and routes by prefix, so a
                        second license-key input here is a redundant entry point. */}
                </motion.div>
            )}

            {/* Refund Policy — intentionally NOT duplicated here. It lives once,
                covering both purchase types (24-hour API subscription window vs
                1-hour Pro pre-activation window), in NativelyApiSettings.tsx's
                "How it works & refund policy" accordion, which renders above this
                component in PlansSettings.tsx. */}

            {/* The Device ID row (hardware hash + "Copy ID") used to render here.
                Removed at the product owner's request — it was a 64-char hash
                shown to every user, and nothing in the current UI asks them to
                supply it (license activation happens through the unified
                "Natively key" box, which needs no device identifier). */}
        </motion.div>
    );
};
