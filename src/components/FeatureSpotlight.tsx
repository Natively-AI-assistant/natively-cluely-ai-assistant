import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Check, Bell, Sparkles, Heart, Rocket } from 'lucide-react';
import mainui from "../UI_comp/mainui.png";

// --- Types ---
// ... (rest of imports and types unchanged)

interface FeatureSlide {
    id: string;
    headline: string;
    subtitle: string;
    type?: 'feature' | 'support' | 'premium';
    actionLabel?: string;
    url?: string;
    eyebrow?: string;
    bullets?: string[];
    footer?: string;
}

// --- Data ---

const FEATURES: FeatureSlide[] = [
    {
        id: 'tailored_answers',
        headline: 'Upcoming features',
        subtitle: 'Answers, tailored to you',
        bullets: ['Repo aware explanations', 'System design interview specialization'],
        footer: 'Designed to work silently during live interviews.',
        type: 'premium',
    },

    {
        id: 'support_natively',
        headline: 'Support development',
        subtitle: 'Built openly and sustained by users',
        bullets: [
            'Development driven by real users',
            'Faster iteration on features that matter',

        ],
        type: 'support',
        actionLabel: 'Contribute to development',
        url: 'https://buymeacoffee.com/evinjohnn'
    }
];

// --- Component ---

export const FeatureSpotlight: React.FC = () => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isPaused, setIsPaused] = useState(false);

    // Interest state: map of feature ID -> boolean
    const [interestState, setInterestState] = useState<Record<string, boolean>>(() => {
        try {
            const saved = localStorage.getItem('natively_feature_interest');
            return saved ? JSON.parse(saved) : {};
        } catch (e) {
            return {};
        }
    });

    const currentFeature = FEATURES[currentIndex];
    const isInterested = interestState[currentFeature.id] || false;
    const isSupport = currentFeature.type === 'support';
    const isPremium = currentFeature.type === 'premium';

    // --- Auto-Advance Logic ---

    useEffect(() => {
        if (isPaused) return;

        // Support slide has longer duration (10s), others 6-8s
        const baseDuration = isSupport ? 10000 : 6000;
        const randomFactor = isSupport ? 0 : Math.random() * 2000;
        const intervalDuration = baseDuration + randomFactor;

        const timer = setTimeout(() => {
            setCurrentIndex((prev) => (prev + 1) % FEATURES.length);
        }, intervalDuration);

        return () => clearTimeout(timer);
    }, [currentIndex, isPaused, isSupport]);


    // --- Interaction Handlers ---

    const handleActionClick = (e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent parent clicks

        if (isSupport && currentFeature.url) {
            if (window.electronAPI && window.electronAPI.openExternal) {
                window.electronAPI.openExternal(currentFeature.url);
            } else {
                window.open(currentFeature.url, '_blank');
            }
            return;
        }

        const newState = { ...interestState, [currentFeature.id]: !isInterested };
        setInterestState(newState);
        localStorage.setItem('natively_feature_interest', JSON.stringify(newState));

        // Interaction triggers "Anonymous one-time ping"
        if (!isInterested) {
            console.log(`[FeatureSpotlight] User registered interest in: ${currentFeature.id}`);
        } else {
            console.log(`[FeatureSpotlight] User removed interest in: ${currentFeature.id}`);
        }
    };

    // --- Styles ---

    // Warmth tuning for support slide
    const subtitleColor = isSupport ? '#C8C8CC' : '#AEAEB2'; // Warmer gray vs Cool gray
    const buttonBg = isSupport
        ? (isInterested ? 'rgba(255, 100, 100, 0.15)' : 'rgba(255, 240, 240, 0.08)') // Warmer tint
        : (isInterested ? 'rgba(50, 200, 100, 0.15)' : 'rgba(255, 255, 255, 0.05)');

    const buttonBorder = isSupport
        ? (isInterested ? 'rgba(255, 150, 150, 0.3)' : 'rgba(255, 200, 200, 0.15)')
        : (isInterested ? 'rgba(52, 211, 153, 0.3)' : 'rgba(255, 255, 255, 0.1)');

    const buttonText = isSupport
        ? (isInterested ? '#FFD1D1' : '#F2F2F7')
        : (isInterested ? '#CDFAD1' : '#EBEBF5');

    return (
        <div
            className="relative h-full w-full overflow-hidden rounded-xl bg-gradient-to-br from-[#1C1C1E] to-[#151516] flex flex-col group select-none"
            onMouseEnter={() => setIsPaused(true)}
            onMouseLeave={() => setIsPaused(false)}
            // Ensure container doesn't layout shift
            style={{ isolation: 'isolate' }}
        >
            {/* 1. Background (Ambient) with 85% opacity as requested */}
            <div className="absolute inset-0 z-0 pointer-events-none">
                <img
                    src={mainui}
                    alt=""
                    className="w-full h-full object-cover opacity-85 scale-100 transition-transform duration-[700ms] ease-out group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-black/20" /> {/* Slight dim for text contrast */}
            </div>

            {/* 2. Content Area (Centered) */}
            <div className="relative z-10 w-full h-full text-center">

                {/* Ambient Glow for Premium Slide */}
                <AnimatePresence>
                    {currentFeature.type === 'premium' && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.8 }}
                            className="absolute inset-0 z-[-1] flex items-center justify-center pointer-events-none"
                        >
                            <div
                                className="w-[200px] h-[200px] rounded-full blur-[60px]"
                                style={{
                                    background: 'radial-gradient(circle, rgba(255, 215, 0, 0.15) 0%, rgba(255, 215, 0, 0) 70%)',
                                }}
                            />
                        </motion.div>
                    )}
                </AnimatePresence>

                <AnimatePresence initial={false}>
                    <motion.div
                        key={currentFeature.id}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 1.05 }}
                        transition={{
                            duration: 0.5,
                            ease: [0.16, 1, 0.3, 1] // Apple ease
                        }}
                        className="absolute inset-0 z-10 flex flex-col items-center justify-center w-full h-full px-7"
                    >
                        {/* Eyebrow / Label */}
                        {currentFeature.eyebrow && (
                            <div className="mb-2 text-[11px] font-semibold tracking-[0.15em] text-yellow-500/80 uppercase">
                                {currentFeature.eyebrow}
                            </div>
                        )}

                        {/* Content Stack: Dimensions Matched to Standard Slide */}
                        <div className="relative h-full w-full flex flex-col items-center justify-center">

                            {/* Main Content Group */}
                            <div
                                className={`flex flex-col items-center justify-center transition-all duration-300 -translate-y-2.5`}
                            >

                                {/* Title */}
                                <h2
                                    className={`text-white drop-shadow-sm tracking-tight mb-0 transition-all duration-300 group-hover:brightness-105 ${isSupport ? 'translate-y-1.5' : ''}`}
                                    style={{
                                        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text"',
                                        fontSize: (isPremium || isSupport) ? '30px' : '26px',
                                        fontWeight: 500,
                                        lineHeight: 1.1,
                                        color: (isPremium || isSupport) ? '#E6C46A' : '#ffffff', // Gold for Premium & Support
                                        textShadow: (isPremium || isSupport) ? '0px 1px 1px rgba(0, 0, 0, 0.25)' : 'none',
                                    }}
                                >
                                    {currentFeature.headline}
                                </h2>

                                {/* Subtitle */}
                                <p
                                    className={`antialiased mb-2 ${isSupport ? 'translate-y-1.5' : ''}`} // Standardized mb-2 for equal spacing
                                    style={{
                                        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text"',
                                        fontSize: (isPremium || isSupport) ? '16px' : '15px',
                                        fontWeight: 400,
                                        lineHeight: 1.4,
                                        color: '#F5F7FA', // Soft white
                                        opacity: 0.9,
                                        maxWidth: isSupport ? '380px' : '360px'
                                    }}
                                >
                                    {currentFeature.subtitle}
                                </p>

                                {currentFeature.bullets && (
                                    <div className={`flex flex-col w-full max-w-[340px] gap-1 items-center translate-y-2.5`}>
                                        {currentFeature.bullets.map((bullet, idx) => (
                                            <div key={idx} className={`flex items-center justify-center group/item transition-transform duration-200 px-2`}>
                                                <span
                                                    className={`${isSupport ? 'text-[12px] leading-relaxed font-medium opacity-100' : 'text-[12.5px] leading-snug font-medium'} text-[#E6C46A]`}
                                                    style={{ letterSpacing: isSupport ? '0.01em' : '-0.01em' }}
                                                >
                                                    {bullet}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Footer: In-flow for equal spacing */}
                                {currentFeature.footer && (
                                    <div className="w-full text-center pointer-events-none mt-2 translate-y-5">
                                        <p
                                            className="text-[#F5F7FA] opacity-65 font-medium tracking-wide"
                                            style={{
                                                fontSize: (isPremium || isSupport) ? '13px' : '15px'
                                            }}
                                        >
                                            {currentFeature.footer}
                                        </p>
                                    </div>
                                )}


                                {/* Primary Action Button - Moved inside structure for equal spacing */}
                                {!isPremium && (
                                    <motion.button
                                        onClick={handleActionClick}
                                        whileHover="hover"
                                        className={`
                                            group relative
                                            flex items-center justify-center gap-3
                                            rounded-full
                                            transition-all duration-200 ease-out
                                            hover:brightness-105
                                            active:scale-[0.98]
                                            overflow-hidden
                                            cursor-pointer
                                            ${isSupport
                                                ? 'mt-2 translate-y-5 px-6 py-2 text-[13px] font-medium text-[#1C1C1E]'
                                                : 'px-10 py-2.5 text-[13px] font-medium text-[#F5F7FA]'
                                            }
                                        `}
                                        style={isSupport ? {
                                            background: 'linear-gradient(180deg, #F1D88B 0%, #E6C87A 100%)',
                                            boxShadow: `
                                                0 6px 20px rgba(230, 200, 122, 0.35),
                                                inset 0 1px 0 rgba(255,255,255,0.35)
                                            `
                                        } : {
                                            minWidth: '220px',
                                            backgroundColor: isInterested ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.08)',
                                            backdropFilter: 'blur(14px)',
                                            WebkitBackdropFilter: 'blur(14px)',
                                        }}
                                    >
                                        {/* Gradient Border (Standard Connect Button Only) */}
                                        {!isSupport && (
                                            <div
                                                className="absolute inset-0 rounded-full pointer-events-none transition-opacity duration-300 group-hover:opacity-80"
                                                style={{
                                                    padding: '1px',
                                                    background: 'linear-gradient(to right, #FFFFFF, #A1A1AA)',
                                                    WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                                                    WebkitMaskComposite: 'xor',
                                                    maskComposite: 'exclude',
                                                    opacity: 0.6,
                                                }}
                                            />
                                        )}

                                        {/* Inner Highlight for Standard Button */}
                                        {!isSupport && (
                                            <div
                                                className="absolute inset-0 rounded-full pointer-events-none"
                                                style={{
                                                    boxShadow: 'inset 0 1px 0 0 rgba(255, 255, 255, 0.08)',
                                                }}
                                            />
                                        )}

                                        <AnimatePresence mode="wait" initial={false}>
                                            <motion.span
                                                key={isInterested ? 'interested' : 'cta'}
                                                initial={{ opacity: 0, y: isInterested ? 5 : -5 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, y: isInterested ? -5 : 5 }}
                                                className="flex items-center gap-2.5 relative z-10"
                                            >
                                                <span>
                                                    {isInterested && !isSupport
                                                        ? 'Interested'
                                                        : (isSupport ? (
                                                            <span className="flex items-center gap-2">
                                                                <Rocket size={14} className="text-[#1C1C1E]" strokeWidth={2.5} />
                                                                Fund development
                                                            </span>
                                                        ) : (currentFeature.actionLabel || 'Mark interest'))
                                                    }
                                                </span>

                                                {/* Icon: ArrowReference for Support, Bell for Features */}
                                                <motion.div
                                                    variants={{
                                                        hover: isInterested ? {
                                                            rotate: [0, -10, 10, -10, 10, 0],
                                                            transition: { duration: 0.5, repeat: Infinity, repeatDelay: 2 }
                                                        } : (isSupport ? {
                                                            x: [0, 4, 0],
                                                            transition: { duration: 1.5, repeat: Infinity, ease: "easeInOut" }
                                                        } : {})
                                                    }}
                                                >
                                                    {isSupport ? (
                                                        <ArrowRight
                                                            size={14}
                                                            className="text-[#1C1C1E] transition-colors duration-300"
                                                            strokeWidth={2}
                                                        />
                                                    ) : (
                                                        <Bell
                                                            size={14}
                                                            className={`${isInterested ? 'text-blue-400' : 'opacity-80'}`}
                                                            fill={isInterested ? "currentColor" : "none"}
                                                        />
                                                    )}
                                                </motion.div>
                                            </motion.span>
                                        </AnimatePresence>
                                    </motion.button>
                                )}
                            </div>
                        </div>


                    </motion.div>
                </AnimatePresence>

            </div>
        </div >
    );
};
