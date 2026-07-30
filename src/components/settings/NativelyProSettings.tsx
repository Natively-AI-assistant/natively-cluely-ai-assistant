import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useT } from '../../i18n';
import { motion, useReducedMotion, type Variants, useMotionValue, useTransform, useSpring } from 'framer-motion';
import { CheckCircle, AlertCircle, X, ChevronDown } from 'lucide-react';
import { getMeetingInterfaceTheme, type MeetingInterfaceTheme } from '../../lib/meetingInterfaceTheme';
import { Disclosure } from '../ui/AccordionSection';

interface PricingProduct {
    formattedPrice: string | null;
    checkoutUrl: string;
}

// ─── Strong cubic-bezier easings (per emil-design-eng) ───────
// Never use the weak default `ease` / `ease-in` for UI motion.
const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];
const EASE_OUT_CSS = 'cubic-bezier(0.23, 1, 0.32, 1)';

// ─── Card wrapper ────────────────────────────────────────────
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    return (
        <div className={`bg-bg-item-surface rounded-2xl border border-border-subtle overflow-hidden ${className}`}>
            {children}
        </div>
    );
}

// ─── Interactive 3D Card (per emil-design-eng & ui-ux-designer) ────
interface InteractiveCardProps {
    children: React.ReactNode;
    className?: string;
    onClick?: () => void;
    onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
    role?: string;
    tabIndex?: number;
    'aria-pressed'?: boolean;
    'data-active'?: string;
    style?: React.CSSProperties;
    glowColor?: string;
}

function InteractiveCard({
    children,
    className = '',
    onClick,
    glowColor = 'rgba(59, 130, 246, 0.15)',
    style,
    ...props
}: InteractiveCardProps) {
    const cardRef = useRef<HTMLDivElement>(null);
    const prefersReducedMotion = useReducedMotion();

    // Mouse coordinates (0 to 1)
    const mouseX = useMotionValue(0.5);
    const mouseY = useMotionValue(0.5);

    // Spotlight positions (0% to 100%)
    const spotlightX = useSpring(useTransform(mouseX, [0, 1], [0, 100]), { stiffness: 200, damping: 20 });
    const spotlightY = useSpring(useTransform(mouseY, [0, 1], [0, 100]), { stiffness: 200, damping: 20 });

    // Buttery 3D rotation springs
    const rotateX = useSpring(useTransform(mouseY, [0, 1], [8, -8]), { stiffness: 120, damping: 20 });
    const rotateY = useSpring(useTransform(mouseX, [0, 1], [-8, 8]), { stiffness: 120, damping: 20 });

    // Tactile press scale spring (active state)
    const scale = useSpring(1, { stiffness: 450, damping: 14 });

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (prefersReducedMotion || !cardRef.current) return;
        const rect = cardRef.current.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        const mouseXVal = (e.clientX - rect.left) / width;
        const mouseYVal = (e.clientY - rect.top) / height;
        mouseX.set(mouseXVal);
        mouseY.set(mouseYVal);
    };

    const handleMouseLeave = () => {
        mouseX.set(0.5);
        mouseY.set(0.5);
        scale.set(1);
    };

    const handleMouseDown = () => {
        if (prefersReducedMotion) return;
        scale.set(0.97); // Emil's recommendation for press scale
    };

    const handleMouseUp = () => {
        scale.set(1);
    };

    const dynamicStyle = prefersReducedMotion
        ? {}
        : {
              scale,
          };

    const spotlightBg = useTransform(
        [spotlightX, spotlightY],
        ([x, y]) => `radial-gradient(circle 180px at ${x}% ${y}%, ${glowColor}, transparent 80%)`
    );

    return (
        <motion.div
            ref={cardRef}
            className={`${className} perspective-1000`}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onClick={onClick}
            style={{ ...style, ...dynamicStyle }}
            {...props}
        >
            {!prefersReducedMotion && (
                <motion.div
                    className="absolute inset-0 pointer-events-none z-10 transition-opacity duration-300 opacity-0 group-hover:opacity-100"
                    style={{ background: spotlightBg }}
                />
            )}
            {children}
        </motion.div>
    );
}

// ─── Interactive Feature Card (with custom spotlight and subtle 3D tilt) ─────
// ─── Modes Poster (jelly-clay × liquid-glass illustration) ──────
// Inline SVG: a central active mode node branching out to multiple expert
// persona nodes with glowing connection orbits in 3D perspective space.
//
// Deliberately WORDLESS. This renders inside a card that is ~234px of content
// width in the real settings pane (896px modal, minus the 256px sidebar,
// minus 32px pane padding each side, split in two with a 12px gutter, minus
// 24px card padding each side), so a 280-unit viewBox is drawn at ~0.84
// scale. The per-node text labels this used to carry were set at fontSize
// 4-4.2, i.e. ~3.5px on screen: unreadable smudges rather than information.
// The geometry is kept as texture; anything that had to be READ moved to the
// teaser row and the caption under the cards.
//
// `animateShimmer` gates EVERY animation in here, not just the shimmer
// sweep — the pulse and the orbit ring used to run unconditionally, which
// ignored prefers-reduced-motion.
function ModesPoster({ animateShimmer }: { animateShimmer: boolean }) {
    return (
        <div
            className="relative w-full h-[100px] select-none pointer-events-none overflow-hidden"
            aria-hidden="true"
        >
            {/* Cropped viewBox rather than the full 0 0 280 120: with the text
                gone the nodes were the only content left, and at the real card
                width they were drawn at ~0.84 scale, which read as a nearly
                empty panel next to the Lifetime card's two solid plates.
                Cropping to the occupied bounds draws the same geometry ~1.2x
                larger. Every node still clears the frame (left node 60-18=42 >
                25, right node 220+16=236 < 255, bottom nodes 90+16=106 < 108,
                centre 60±25 inside 12..108). */}
            <svg viewBox="25 12 230 96" className="w-full h-full">
                <defs>
                    {/* Soft background radial glows */}
                    <radialGradient id="blueGlowYearly" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="rgba(59, 130, 246, 0.35)" />
                        <stop offset="100%" stopColor="rgba(59, 130, 246, 0)" />
                    </radialGradient>
                    <radialGradient id="emeraldGlowYearly" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="rgba(16, 185, 129, 0.28)" />
                        <stop offset="100%" stopColor="rgba(16, 185, 129, 0)" />
                    </radialGradient>

                    {/* Gradient for Glass Nodes */}
                    <linearGradient id="nodeBg" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="rgba(255, 255, 255, 0.18)" />
                        <stop offset="100%" stopColor="rgba(255, 255, 255, 0.04)" />
                    </linearGradient>

                    {/* Shimmer gradient */}
                    <linearGradient id="yearlyShimmer" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="rgba(255, 255, 255, 0)" />
                        <stop offset="50%" stopColor="rgba(255, 255, 255, 0.18)" />
                        <stop offset="100%" stopColor="rgba(255, 255, 255, 0)" />
                        {animateShimmer && (
                            <animateTransform
                                attributeName="gradientTransform"
                                type="translate"
                                from="-1 0"
                                to="1 0"
                                dur="4s"
                                repeatCount="indefinite"
                            />
                        )}
                    </linearGradient>
                </defs>

                {/* Ambient Glows */}
                <circle cx="140" cy="60" r="70" fill="url(#blueGlowYearly)" />
                <circle cx="60" cy="40" r="50" fill="url(#emeraldGlowYearly)" />

                {/* 3D Group with perspective */}
                <g style={{ transform: 'perspective(600px) rotateX(16deg) rotateY(-10deg) rotateZ(1deg)', transformOrigin: 'center center' }}>
                    
                    {/* Connection lines from center to outer modes */}
                    <line x1="140" y1="60" x2="60" y2="35" className="pricing-poster-stroke-subtle-line" strokeWidth="1" strokeDasharray="3 2" />
                    <line x1="140" y1="60" x2="80" y2="90" className="pricing-poster-stroke-subtle-line" strokeWidth="1" strokeDasharray="3 2" />
                    <line x1="140" y1="60" x2="220" y2="35" className="pricing-poster-stroke-subtle-line" strokeWidth="1" strokeDasharray="3 2" />
                    <line x1="140" y1="60" x2="200" y2="90" className="pricing-poster-stroke-subtle-line" strokeWidth="1" strokeDasharray="3 2" />
                    
                    {/* Glowing highlight connection for the ACTIVE mode */}
                    <path d="M140 60 Q100 40 60 35" fill="none" stroke="rgba(16, 185, 129, 0.6)" strokeWidth="1.2" />

                    {/* NODE 1: TECHNICAL (Active / Highlighted) */}
                    <g transform="translate(60 35)">
                        <circle cx="0" cy="0" r="18" fill="rgba(16, 185, 129, 0.15)" stroke="rgba(16, 185, 129, 0.5)" strokeWidth="1" />
                        <circle cx="0" cy="0" r="15" className="pricing-poster-node-bg" stroke="rgba(255, 255, 255, 0.1)" strokeWidth="0.5" />
                        {/* Icon: Code </> representation */}
                        <path d="M-4 -3 L-7 0 L-4 3 M4 -3 L7 0 L4 3" fill="none" stroke="#10b981" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                        <line x1="1" y1="-4" x2="-1" y2="4" stroke="#10b981" strokeWidth="1.2" />
                        
                        {/* Active Dot */}
                        <circle cx="12" cy="-12" r="2.5" fill="#10b981" />
                        <circle cx="12" cy="-12" r="5" fill="none" stroke="#10b981" strokeWidth="0.8" opacity="0.5">
                            {animateShimmer && (
                                <animate attributeName="r" values="3;7;3" dur="2s" repeatCount="indefinite" />
                            )}
                        </circle>
                    </g>

                    {/* NODE 2: SALES (Briefcase representation) */}
                    <g transform="translate(220 35)">
                        <circle cx="0" cy="0" r="16" fill="url(#nodeBg)" className="pricing-poster-glass-node-border" strokeWidth="1" />
                        <rect x="-16" y="-16" width="32" height="32" rx="16" fill="url(#yearlyShimmer)" style={{ mixBlendMode: 'overlay' }} opacity="0.75" />
                        {/* Icon: Briefcase */}
                        <rect x="-4" y="-2" width="8" height="6" rx="1" fill="none" className="pricing-poster-stroke-bright" strokeWidth="1" />
                        <path d="M-2 -2 L-2 -4 L2 -4 L2 -2" fill="none" className="pricing-poster-stroke-bright" strokeWidth="1" />
                    </g>

                    {/* NODE 3: PRODUCT MANAGER */}
                    <g transform="translate(80 90)">
                        <circle cx="0" cy="0" r="16" fill="url(#nodeBg)" className="pricing-poster-glass-node-border" strokeWidth="1" />
                        {/* Icon: Layers */}
                        <path d="M-4 -2 L0 -4 L4 -2 L0 0 Z" fill="none" className="pricing-poster-stroke-bright" strokeWidth="0.8" />
                        <path d="M-4 1 L0 3 L4 1" fill="none" className="pricing-poster-stroke-bright" strokeWidth="0.8" />
                    </g>

                    {/* NODE 4: SYSTEM DESIGN */}
                    <g transform="translate(200 90)">
                        <circle cx="0" cy="0" r="16" fill="url(#nodeBg)" className="pricing-poster-glass-node-border" strokeWidth="1" />
                        {/* Icon: Flow Chart */}
                        <rect x="-4" y="-4" width="3" height="3" fill="none" className="pricing-poster-stroke-bright" strokeWidth="0.8" />
                        <rect x="1" y="-4" width="3" height="3" fill="none" className="pricing-poster-stroke-bright" strokeWidth="0.8" />
                        <rect x="-1.5" y="1" width="3" height="3" fill="none" className="pricing-poster-stroke-bright" strokeWidth="0.8" />
                        <path d="M-2.5 -1 L-2.5 0 L0 0 L0 1" fill="none" className="pricing-poster-stroke-bright" strokeWidth="0.8" />
                        <path d="M2.5 -1 L2.5 0 L0 0" fill="none" className="pricing-poster-stroke-bright" strokeWidth="0.8" />
                    </g>

                    {/* CENTRAL NODE: ACTIVE ENGINE */}
                    <g transform="translate(140 60)">
                        {/* Glass Body */}
                        <circle cx="0" cy="0" r="22" className="pricing-poster-node-bg" stroke="rgba(59, 130, 246, 0.6)" strokeWidth="1.2" />
                        
                        {/* AI Text Orb */}
                        <circle cx="0" cy="0" r="16" fill="rgba(59, 130, 246, 0.15)" />
                        <text x="0" y="3.5" textAnchor="middle" className="pricing-poster-central-ai-text" fontSize="9" fontWeight="900" fontFamily="Geist, Satoshi, sans-serif" letterSpacing="0.05em">AI</text>
                        
                        {/* Outer rotating/pulsing dashes */}
                        <circle cx="0" cy="0" r="25" fill="none" stroke="rgba(59, 130, 246, 0.3)" strokeWidth="0.8" strokeDasharray="4 6">
                            {animateShimmer && (
                                <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="15s" repeatCount="indefinite" />
                            )}
                        </circle>
                    </g>

                </g>
            </svg>
        </div>
    );
}

// ─── Resume Match Poster (jelly-clay × liquid-glass illustration) ──────
// Inline SVG: two tilted 3D glass panels (resume on the left, job description
// on the right) with laser connection nodes drawn between matching rows, and
// a floating central badge marking the match.
//
// Wordless for the same reason as ModesPoster above (~3.5px rendered text at
// the real card width). The central badge also used to read "94% MATCH" — a
// figure nothing in the product computes, presented as if it were real
// output. It is now a check glyph: same meaning, no invented statistic.
function ResumeMatchPoster({ animateShimmer }: { animateShimmer: boolean }) {
    return (
        <div
            className="relative w-full h-[80px] select-none pointer-events-none overflow-hidden"
            aria-hidden="true"
        >
            <svg viewBox="0 0 280 96" className="w-full h-full">
                <defs>
                    {/* Soft background radial glows */}
                    <radialGradient id="purpleGlow" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="rgba(139, 92, 246, 0.38)" />
                        <stop offset="100%" stopColor="rgba(139, 92, 246, 0)" />
                    </radialGradient>
                    <radialGradient id="emeraldGlow" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="rgba(16, 185, 129, 0.28)" />
                        <stop offset="100%" stopColor="rgba(16, 185, 129, 0)" />
                    </radialGradient>
                    <radialGradient id="blueGlow" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="rgba(59, 130, 246, 0.32)" />
                        <stop offset="100%" stopColor="rgba(59, 130, 246, 0)" />
                    </radialGradient>

                    {/* Gradient for Glass Panels */}
                    <linearGradient id="panelBg" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="rgba(255, 255, 255, 0.18)" />
                        <stop offset="100%" stopColor="rgba(255, 255, 255, 0.04)" />
                    </linearGradient>

                    {/* Shimmer gradient */}
                    <linearGradient id="stealthShimmer" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="rgba(255, 255, 255, 0)" />
                        <stop offset="50%" stopColor="rgba(255, 255, 255, 0.20)" />
                        <stop offset="100%" stopColor="rgba(255, 255, 255, 0)" />
                        {animateShimmer && (
                            <animateTransform
                                attributeName="gradientTransform"
                                type="translate"
                                from="-1 0"
                                to="1 0"
                                dur="4s"
                                repeatCount="indefinite"
                            />
                        )}
                    </linearGradient>
                </defs>

                {/* Ambient Glows */}
                <circle cx="60" cy="60" r="70" fill="url(#purpleGlow)" />
                <circle cx="220" cy="60" r="70" fill="url(#blueGlow)" />
                <circle cx="140" cy="60" r="50" fill="url(#emeraldGlow)" />

                {/* 3D Group with perspective */}
                <g style={{ transform: 'perspective(600px) rotateX(16deg) rotateY(-10deg) rotateZ(1deg)', transformOrigin: 'center center' }}>
                    
                    {/* LEFT PANEL: RESUME */}
                    {/* Glass Body */}
                    <rect x="25" y="16" width="95" height="78" rx="8" fill="url(#panelBg)" className="pricing-poster-panel-border" strokeWidth="1" />
                    <rect x="25" y="16" width="95" height="78" rx="8" fill="url(#stealthShimmer)" style={{ mixBlendMode: 'overlay' }} opacity="0.75" />
                    
                    {/* Header line & avatar representation */}
                    <circle cx="38" cy="28" r="4.5" className="pricing-poster-avatar-bg" />
                    <rect x="47" y="24" width="35" height="3" rx="1.5" className="pricing-poster-rect-light" />
                    <rect x="47" y="30" width="20" height="2" rx="1" className="pricing-poster-rect-subtle" />
                    
                    {/* Skills Checklist inside Resume card */}
                    <g transform="translate(34 42)">
                        {/* Check 1 */}
                        <circle cx="4" cy="5" r="2.5" fill="rgba(16, 185, 129, 0.2)" stroke="rgba(16, 185, 129, 0.6)" strokeWidth="0.6" />
                        <rect x="11" y="3.5" width="48" height="3" rx="1.5" className="pricing-poster-rect-light" />

                        {/* Check 2 */}
                        <circle cx="4" cy="17" r="2.5" fill="rgba(16, 185, 129, 0.2)" stroke="rgba(16, 185, 129, 0.6)" strokeWidth="0.6" />
                        <rect x="11" y="15.5" width="55" height="3" rx="1.5" className="pricing-poster-rect-light" />

                        {/* Check 3 */}
                        <circle cx="4" cy="29" r="2.5" className="pricing-poster-check3-bg pricing-poster-check3-border" strokeWidth="0.6" />
                        <rect x="11" y="27.5" width="40" height="3" rx="1.5" className="pricing-poster-rect-subtle" />
                    </g>
                    {/* Small Resume Badge */}
                    <rect x="34" y="81" width="30" height="7" rx="2" fill="rgba(139, 92, 246, 0.2)" stroke="rgba(139, 92, 246, 0.3)" strokeWidth="0.5" />


                    {/* RIGHT PANEL: JOB DESCRIPTION */}
                    {/* Glass Body */}
                    <rect x="160" y="16" width="95" height="78" rx="8" fill="url(#panelBg)" className="pricing-poster-panel-border" strokeWidth="1" />
                    <rect x="160" y="16" width="95" height="78" rx="8" fill="url(#stealthShimmer)" style={{ mixBlendMode: 'overlay' }} opacity="0.75" />
                    
                    {/* Job requirements lines */}
                    <rect x="169" y="24" width="45" height="3.5" rx="1.5" className="pricing-poster-rect-light" />
                    <rect x="169" y="31" width="60" height="2" rx="1" className="pricing-poster-rect-subtle" />

                    {/* Requirements list */}
                    <g transform="translate(169 42)">
                        {/* Requirement 1 */}
                        <rect x="0" y="3.5" width="60" height="3" rx="1.5" className="pricing-poster-rect-light" />

                        {/* Requirement 2 */}
                        <rect x="0" y="15.5" width="65" height="3" rx="1.5" className="pricing-poster-rect-light" />

                        {/* Requirement 3 */}
                        <rect x="0" y="27.5" width="50" height="3" rx="1.5" className="pricing-poster-rect-light" />
                    </g>
                    {/* Small JD Badge */}
                    <rect x="169" y="81" width="30" height="7" rx="2" fill="rgba(59, 130, 246, 0.2)" stroke="rgba(59, 130, 246, 0.3)" strokeWidth="0.5" />


                    {/* CONNECTING AI LASER LINES */}
                    {/* Connection 1 (React Native) */}
                    <path d="M96 47 Q137 42 169 47" fill="none" stroke="rgba(16, 185, 129, 0.75)" strokeWidth="1" strokeDasharray="3 2" />
                    <circle cx="96" cy="47" r="1.5" fill="#10b981" />
                    <circle cx="169" cy="47" r="1.5" fill="#10b981" />

                    {/* Connection 2 (System Design) */}
                    <path d="M103 59 Q137 54 169 59" fill="none" stroke="rgba(16, 185, 129, 0.75)" strokeWidth="1" strokeDasharray="3 2" />
                    <circle cx="103" cy="59" r="1.5" fill="#10b981" />
                    <circle cx="169" cy="59" r="1.5" fill="#10b981" />


                    {/* CENTRAL ANALYSIS GLOWING BADGE */}
                    <g transform="translate(140 52)">
                        {/* Outer Glow */}
                        <rect x="-24" y="-8" width="48" height="16" rx="8" fill="rgba(16, 185, 129, 0.15)" stroke="rgba(16, 185, 129, 0.4)" strokeWidth="0.8" style={{ filter: 'drop-shadow(0 0 4px rgba(16,185,129,0.3))' }} />
                        {/* Solid Badge */}
                        <rect x="-22" y="-7" width="44" height="14" rx="7" fill="rgba(16, 185, 129, 0.95)" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.25))' }} />
                        {/* Match glyph (replaces the fabricated "94% MATCH" figure) */}
                        <path d="M-5 0.5 L-1.5 4 L5 -3" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </g>

                </g>
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
}

export const NativelyProSettings: React.FC<NativelyProSettingsProps> = ({
    initialIsPremium = null,
    collapsePricing = false,
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
    const [pricingProducts, setPricingProducts] = useState<Record<string, PricingProduct>>({});
    // Whether the Yearly/Lifetime grid is revealed. Only consulted when
    // `collapsePricing` is set; otherwise the grid is always shown.
    const [pricingOpen, setPricingOpen] = useState(false);


    const [isPremium, setIsPremium] = useState<boolean | null>(initialIsPremium);
    // Distinguishes a Pro entitlement bundled with a Natively API plan
    // ('natively_api' — server-validated per request, stored with hwid: '',
    // not device-slot-limited) from a standalone device license
    // ('dodo'/'gumroad' — HWID-bound, where deactivating frees a real
    // activation slot). The deactivate caption below is only true for the
    // latter. Undefined (unknown / still loading) deliberately falls through
    // to the device-license wording rather than under-warning.
    const [licenseProvider, setLicenseProvider] = useState<string | undefined>(undefined);

    const refreshLicense = async () => {
        try {
            const details = await window.electronAPI?.licenseGetDetails?.();
            if (details) {
                setIsPremium(details.isPremium ?? false);
                setLicenseProvider((details as any).provider);
            } else {
                setIsPremium(prev => prev ?? false);
            }
        } catch {
            const check = window.electronAPI?.licenseCheckPremiumAsync ?? window.electronAPI?.licenseCheckPremium;
            if (check) {
                try {
                    const active = await check();
                    setIsPremium(active);
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
        window.electronAPI?.getNativelyPricing?.()
            .then((res) => {
                if (res?.ok && res.products) setPricingProducts(res.products);
            })
            .catch(() => {});

        // Listen to license status changes if the main process sends them.
        // Always re-fetch full details rather than trusting the event payload:
        // it only carries `isPremium`, not `provider`, so taking the fast path
        // would leave `licenseProvider` stale after an activate/deactivate.
        const onStatusChanged = () => {
            refreshLicense();
        };
        const removeLicenseListener = window.electronAPI?.onLicenseStatusChanged?.(onStatusChanged);

        return () => {
            removeLicenseListener?.();
        };
    }, []);

    const handleDeactivate = async () => {
        try {
            await window.electronAPI?.licenseDeactivate?.();
            refreshLicense();
        } catch (e: any) {
            setErrorMessage(e.message || 'Deactivation failed.');
        }
    };

    const openExternal = (url: string) => { (window.electronAPI as any)?.openExternal?.(url); };
    const lifetimeProduct = pricingProducts.natively_pro_lifetime;
    const yearlyProduct = pricingProducts.natively_pro_yearly;
    const lifetimeUrl = lifetimeProduct?.checkoutUrl || 'https://checkout.dodopayments.com/buy/pdt_0NbHo6EnXlNPqNcZ14OTi';
    const yearlyUrl = yearlyProduct?.checkoutUrl || 'https://checkout.dodopayments.com/buy/pdt_0NcM4QBwy0CDcPV9CXaNP';
    const yearlyPriceText = yearlyProduct?.formattedPrice || '$30';
    const lifetimePriceText = lifetimeProduct?.formattedPrice || '$50';

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
                    delayChildren: 0.02,
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
            hidden: { opacity: 0, y: 8 },
            visible: {
                opacity: 1,
                y: 0,
                transition: { duration: 0.32, ease: EASE_OUT },
            },
        };

    const priceTickAnim = prefersReducedMotion
        ? undefined
        : { scale: [1, 1.04, 1] };
    const priceTickTransition = { duration: 0.22, ease: EASE_OUT, times: [0, 0.5, 1] };

    // Lifetime pulse one-shot — transient box-shadow override that CSS
    // releases back to its [data-active] steady state after 520ms.
    const lifetimePulseShadow =
        '0 0 0 2px rgba(190, 185, 255, 0.85), 0 0 64px -4px rgba(140, 130, 240, 0.70), 0 20px 50px rgba(99, 102, 241, 0.42), 0 4px 14px rgba(0, 0, 0, 0.30)';

    if (isPremium === null) {
        return <div className="p-8 flex justify-center"><div className="w-5 h-5 border-2 border-white/40 border-t-transparent rounded-full animate-spin" /></div>;
    }

    return (
        <div className="space-y-6 animated fadeIn" data-interface-theme={interfaceTheme}>

            {isPremium ? (
                <Card>
                    <div className="flex flex-col items-center text-center py-8 px-6">
                        <div className="w-16 h-16 rounded-[16px] bg-emerald-500/10 border border-emerald-500/20 flex flex-col items-center justify-center mb-6 shadow-inner relative group">
                            <CheckCircle size={28} className="text-emerald-400" strokeWidth={2} />
                        </div>
                        <h2 className="text-[18px] font-semibold tracking-tight text-text-primary">Pro License Active</h2>
                        <p className="text-[13px] mt-2 max-w-[280px] mx-auto leading-relaxed mb-8 text-text-secondary">
                            {licenseProvider === 'natively_api'
                                ? "Included with your Natively API plan. Premium features are unlocked: Profile Engine, Job Description Intelligence, and Company Research."
                                : "Your device is fully authorized for Natively's premium features including the Profile Engine, Job Description Intelligence, and Company Research."}
                        </p>

                        <button
                            onClick={handleDeactivate}
                            className="w-full max-w-[280px] py-3 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 text-[13px] font-medium hover:bg-red-500/20 flex items-center justify-center gap-2 shadow-inner cursor-pointer active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary"
                            style={{ transition: `transform 140ms ${EASE_OUT_CSS}, background-color 180ms ${EASE_OUT_CSS}` }}
                        >
                            <X size={15} /> Deactivate License
                        </button>
                        {/* Copy differs by provider because the mechanics differ: an
                            API-plan-bundled entitlement isn't device-bound, so the
                            "use it on another computer" framing is simply false for it. */}
                        <p className="text-[11px] text-center px-4 mt-4 leading-relaxed text-text-tertiary max-w-[300px]">
                            {licenseProvider === 'natively_api'
                                ? 'Turns Pro off on this device only. Your Natively API plan is unaffected. To turn it back on, save your Natively API key again.'
                                : 'Deactivating will remove the license from this device, allowing you to use it on another computer.'}
                        </p>
                        {errorMessage && (
                            <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-[12px] text-red-500 font-medium">
                                <AlertCircle size={14} className="shrink-0" /> {errorMessage}
                            </div>
                        )}
                    </div>
                </Card>
            ) : (
                <motion.div
                    variants={containerVariants}
                    initial="hidden"
                    animate="visible"
                    className="space-y-4"
                >
                    {/* ── Teaser row ───────────────────────────────────────────
                        The only part of this section a non-Pro visitor sees
                        before interacting, so it has to carry the whole offer:
                        what it is, what it costs, and one thing to press. The
                        generic accordion header it replaces carried a title, a
                        60-word grey paragraph and a chevron, which rendered
                        identically to the "How it works & refund policy" row
                        beneath it. A purchase path that looks like an FAQ entry
                        does not get opened.

                        It is one <button>, not a button containing a button:
                        the CTA-looking pill is a <span>, because nesting
                        interactive elements is invalid and because the pill and
                        the row do the same thing. Pressing it reveals pricing,
                        it never navigates. Checkout stays where the owner put
                        it, on the two card CTAs only. */}
                    {collapsePricing && (
                        <button
                            type="button"
                            onClick={() => setPricingOpen((o) => !o)}
                            aria-expanded={pricingOpen}
                            aria-controls="natively-pro-pricing"
                            className="pro-teaser group relative w-full overflow-hidden text-left flex items-center gap-4 px-5 py-4 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                        >
                            <span className="relative z-[3] min-w-0 flex-1 block">
                                <span className="pro-teaser-eyebrow inline-flex items-center px-2 py-0.5 rounded-full text-[9.5px] font-bold" style={{ letterSpacing: '0.09em' }}>
                                    NATIVELY PRO
                                </span>
                                <span className="pro-teaser-title block mt-2 text-[14.5px] font-semibold tracking-[-0.012em]">
                                    Own the app. Use your own AI keys.
                                </span>
                                {/* The live prices are the hook. This is the number
                                    the old collapsed header never showed. */}
                                <span className="pro-teaser-sub block mt-1 text-[11.5px] leading-snug">
                                    {yearlyPriceText} per year, or {lifetimePriceText} once. No monthly API plan, no usage quota.
                                </span>
                            </span>
                            <span className="pro-teaser-cta relative z-[3] shrink-0 inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-[12.5px] font-semibold" style={{ letterSpacing: '-0.005em' }}>
                                {pricingOpen ? 'Hide' : 'See pricing'}
                                <ChevronDown
                                    size={14}
                                    className={`shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${pricingOpen ? 'rotate-0' : '-rotate-90'}`}
                                />
                            </span>
                        </button>
                    )}

                    {/* ── Choose-your-plan hero ────────────────────────────── */}
                    <Disclosure open={collapsePricing ? pricingOpen : true}>
                    {/* No top padding here: the parent's `space-y-4` already
                        supplies the gap, and it only exists while the disclosure
                        is mounted, so a collapsed teaser has no dead space
                        hanging off its bottom edge. */}
                    <div className="space-y-3" id="natively-pro-pricing">

                        {/* Two-card pricing grid. Lifetime is the recommended
                            option: it carries the "Best value" pill, the price
                            anchor, and the concrete savings line. */}
                        <div className="grid grid-cols-2 gap-3 items-stretch">
                            {/* ── Left: Pro · Yearly (pale ice-blue jelly) ───── */}
                            <InteractiveCard
                                className="pricing-card-yearly group relative overflow-hidden px-6 py-5 flex flex-col"
                                data-active="false"
                                style={{ minHeight: 200, transformStyle: 'preserve-3d' }}
                                glowColor="rgba(59, 130, 246, 0.28)"
                            >
                                <div className="relative flex items-center justify-between" style={{ transformStyle: 'preserve-3d', transform: 'translateZ(12px)' }}>
                                    <span className="badge-tier-label inline-flex items-center px-2 py-0.5 rounded-full text-text-primary text-[10px] font-semibold" style={{ letterSpacing: '0.02em' }}>
                                        Pro · Yearly
                                    </span>
                                </div>

                                {/* Price block. No strikethrough anchor here on
                                    purpose. `yearlyOriginalText` is synthesized by
                                    dividing the real price by 0.8, which only ever
                                    meant anything while the INSIDER20 coupon chip
                                    was on screen; that chip was removed at the
                                    owner's request, so the crossed-out figure was
                                    left standing with nothing to explain it, and the
                                    percentage it produced (round(30/0.8) = 38, so
                                    21%) did not even match the 20% coupon it came
                                    from. The computation is left in the useMemo
                                    untouched, it is simply not rendered. The one
                                    surviving anchor is Lifetime's, where 3 x yearly
                                    is honest arithmetic and the line under the CTA
                                    says so. */}
                                <div className="relative mt-4 flex items-baseline gap-2 flex-wrap" style={{ transformStyle: 'preserve-3d', transform: 'translateZ(20px)' }}>
                                    <span
                                        className="pricing-card-price text-[44px] font-bold leading-none text-text-primary"
                                        style={{
                                            display: 'inline-block',
                                            fontVariantNumeric: 'tabular-nums',
                                            fontFeatureSettings: '"tnum"',
                                            letterSpacing: '-0.035em',
                                        }}
                                    >
                                        {yearlyPriceText}
                                    </span>
                                </div>
                                <p className="relative mt-1 text-[11px] font-medium text-text-secondary" style={{ transform: 'translateZ(10px)' }}>
                                    per year · billed annually
                                </p>

                                {/* Crisp gradient hairline divider */}
                                <div className="relative h-px my-2 pricing-card-divider" style={{ transform: 'translateZ(8px)' }} />

                                {/* Modes poster — flex-1 pushes it to bottom */}
                                <div className="relative flex-1 min-h-0 flex items-center" style={{ transformStyle: 'preserve-3d', transform: 'translateZ(18px)' }}>
                                    <ModesPoster animateShimmer={!prefersReducedMotion} />
                                </div>

                                {/* CTA — neutral-bright jelly, dark text */}
                                <button
                                    onClick={() => openExternal(yearlyUrl)}
                                    className="pricing-cta-yearly relative mt-4 h-11 rounded-full text-[13px] font-semibold flex items-center justify-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                                    style={{ letterSpacing: '-0.005em', transform: 'translateZ(28px)' }}
                                >
                                    Get Pro
                                </button>
                                <p className="relative mt-2 text-center text-[10px] leading-snug text-text-secondary" style={{ transform: 'translateZ(6px)' }}>
                                    Cancels anytime. Renews at {yearlyPriceText}/yr.
                                </p>
                            </InteractiveCard>

                            {/* ── Right: Pro · Lifetime (deeper indigo-violet jelly) ── */}
                            <InteractiveCard
                                className="pricing-card-lifetime group relative overflow-hidden px-6 py-5 flex flex-col"
                                data-active="true"
                                style={{ minHeight: 200, transformStyle: 'preserve-3d' }}
                                glowColor="rgba(139, 92, 246, 0.32)"
                            >
                                {/* Label row: Pro · Lifetime + the recommendation.
                                    Without this the two cards read as equally
                                    weighted alternatives, which pushes the choice
                                    back onto the visitor. `.badge-best-value` was
                                    already defined in index.css and unused. */}
                                <div className="relative flex items-center justify-between gap-2" style={{ transformStyle: 'preserve-3d', transform: 'translateZ(12px)' }}>
                                    <span className="badge-tier-label inline-flex items-center px-2 py-0.5 rounded-full text-text-primary text-[10px] font-semibold" style={{ letterSpacing: '0.02em' }}>
                                        Pro · Lifetime
                                    </span>
                                    <span className="badge-best-value inline-flex items-center px-2 py-0.5 rounded-full text-[9.5px] font-bold shrink-0" style={{ letterSpacing: '0.06em' }}>
                                        BEST VALUE
                                    </span>
                                </div>

                                {/* Price block: anchor (3y) + current */}
                                <div className="relative mt-4 flex items-baseline gap-2 flex-wrap" style={{ transformStyle: 'preserve-3d', transform: 'translateZ(20px)' }}>
                                    {yearlyPrice !== null && lifetimePrice !== null && (
                                        <span
                                            className="pricing-card-original-price text-[17px] font-normal"
                                            style={{
                                                textDecoration: 'line-through',
                                                textDecorationThickness: '1px',
                                                fontVariantNumeric: 'tabular-nums',
                                                fontFeatureSettings: '"tnum"',
                                                letterSpacing: '-0.02em',
                                            }}
                                        >
                                            ${yearlyPrice * 3}
                                        </span>
                                    )}
                                    <span
                                        className="pricing-card-price text-[44px] font-bold leading-none text-text-primary"
                                        style={{
                                            display: 'inline-block',
                                            fontVariantNumeric: 'tabular-nums',
                                            fontFeatureSettings: '"tnum"',
                                            letterSpacing: '-0.035em',
                                        }}
                                    >
                                        {lifetimePriceText}
                                    </span>
                                    {/* No "Save N%" chip alongside. The strikethrough
                                        anchor, the chip and the line under the CTA
                                        were three renderings of one fact. The
                                        anchor plus the concrete dollar line survive,
                                        because dollars anchor harder than a percent
                                        and the line is what explains where the
                                        crossed-out figure comes from. */}
                                </div>
                                <p className="relative mt-1 text-[11px] font-medium text-text-secondary" style={{ transform: 'translateZ(10px)' }}>
                                    One-time payment. Yours forever.
                                </p>

                                {/* Crisp divider */}
                                <div className="relative h-px my-2 pricing-card-divider" style={{ transform: 'translateZ(8px)' }} />

                                {/* Match poster — flex-1 pushes it to bottom */}
                                <div className="relative flex-1 min-h-0 flex items-center" style={{ transformStyle: 'preserve-3d', transform: 'translateZ(18px)' }}>
                                    <ResumeMatchPoster animateShimmer={!prefersReducedMotion} />
                                </div>

                                {/* CTA — tinted jelly, light text, brighter specular crown */}
                                <button
                                    onClick={() => openExternal(lifetimeUrl)}
                                    className="pricing-cta-lifetime relative mt-4 h-11 rounded-full text-[13px] font-semibold flex items-center justify-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                                    style={{ letterSpacing: '-0.005em', transform: 'translateZ(28px)' }}
                                >
                                    Lock in lifetime
                                </button>
                                {lifetimeSavingsAbs !== null ? (
                                    <p className="relative mt-2 text-center text-[10px] leading-snug text-text-secondary" style={{ transform: 'translateZ(6px)' }}>
                                        Save ${lifetimeSavingsAbs} vs 3 years of yearly.
                                    </p>
                                ) : (
                                    <p className="relative mt-2 text-center text-[10px] leading-snug text-text-secondary" style={{ transform: 'translateZ(6px)' }}>
                                        Pay once. Never renew.
                                    </p>
                                )}
                            </InteractiveCard>
                        </div>

                        {/* The detail that used to sit in the collapsed accordion
                            header, where it was unreadable weight above the fold.
                            It belongs here: past the point where someone has
                            already asked to see pricing, and reading as a caption
                            to the cards rather than a wall in front of them.

                            Feature bento grid, coupon/demo footer row and the
                            upgrade T&C line were removed at the product owner's
                            request. The two pricing cards plus these two lines are
                            the whole purchase surface for the app-only license. */}
                        <div className="px-1 pt-1 space-y-1">
                            <p className="text-[11px] leading-relaxed text-text-tertiary">
                                {t('Works with OpenAI, Gemini, Claude, Groq, DeepSeek, or a local model.')}
                            </p>
                            <p className="text-[11px] leading-relaxed text-text-tertiary">
                                {t('Full Pro feature set: expert persona modes, the Profile Engine, job description intelligence, and company research.')}
                            </p>
                        </div>
                    </div>
                    </Disclosure>

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
        </div>
    );
};
