import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Heart, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { useResolvedTheme } from '../hooks/useResolvedTheme';

interface SupportToasterProps {
    isOpen: boolean;
    onDismiss: () => void;
    className?: string;
}

export const SupportToaster: React.FC<SupportToasterProps> = ({ isOpen, onDismiss, className }) => {
    const isLight = useResolvedTheme() === 'light';
    const reduced = useReducedMotion() ?? false;
    const [hasDonated, setHasDonated] = useState(false);
    const [isButtonHovered, setIsButtonHovered] = useState(false);

    // Fetch donation status once on mount — orchestrator already gates via
    // DonationManager.shouldShowToaster equivalent. We still fetch so the
    // hasDonated UI works correctly.
    useEffect(() => {
        if (!window.electronAPI?.getDonationStatus) return;
        window.electronAPI.getDonationStatus()
            .then(status => setHasDonated(status.hasDonated))
            .catch(e => console.error('Failed to check donation status:', e));
    }, []);



    const clickTimeRef = React.useRef<number | null>(null);

    useEffect(() => {
        const handleFocus = async () => {
            if (clickTimeRef.current) {
                const elapsed = Date.now() - clickTimeRef.current;
                if (elapsed > 20000) { // 20 seconds
                    console.log("User returned from support link after >20s. Presuming donation.");
                    await window.electronAPI?.setDonationComplete();
                    setHasDonated(true);
                    onDismiss();
                }
                clickTimeRef.current = null;
            }
        };
        window.addEventListener('focus', handleFocus);
        return () => window.removeEventListener('focus', handleFocus);
    }, [onDismiss]);

    const handleDismiss = () => {
        onDismiss();
    };

    const handleSupport = () => {
        clickTimeRef.current = Date.now();
        if (window.electronAPI?.openExternal) {
            window.electronAPI.openExternal('https://buymeacoffee.com/evinjohnn');
        } else {
            window.open('https://buymeacoffee.com/evinjohnn', '_blank');
        }
    };

    if (!isOpen) return null;

    const t1 = isLight ? '#1C1C1E' : '#FFFFFF';
    const t2 = isLight ? 'rgba(0,0,0,0.76)' : 'rgba(255,255,255,0.72)';
    const t3 = isLight ? 'rgba(0,0,0,0.56)' : 'rgba(255,255,255,0.44)';
    const t4 = isLight ? 'rgba(0,0,0,0.36)' : 'rgba(255,255,255,0.26)';
    const rule = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)';

    return (
        <AnimatePresence>
            {isOpen && (
                <div className={`fixed inset-0 z-[9999] flex items-center justify-center ${isLight ? 'bg-black/20 backdrop-blur-[4px]' : 'bg-black/60 backdrop-blur-[4px]'}`}>
                    <style>
                        {`
                            @keyframes support-border-flow {
                                0%, 100% { background-position: 0% 50%; }
                                50%       { background-position: 100% 50%; }
                            }
                            .support-border {
                                background: linear-gradient(145deg,
                                    rgba(255, 106, 92, 0.8),
                                    rgba(229, 91, 77, 0.6),
                                    rgba(244, 63, 94, 0.7),
                                    rgba(255, 106, 92, 0.8)
                                );
                                background-size: 300% 300%;
                                animation: support-border-flow 6s ease infinite;
                            }
                            .support-border-reduced {
                                background: linear-gradient(145deg, rgba(255, 106, 92, 0.6), rgba(244, 63, 94, 0.5));
                            }
                            @keyframes waveMove {
                                from { background-position-x: 0; }
                                to { background-position-x: -32px; }
                            }
                        `}
                    </style>

                    <motion.div
                        initial={{ opacity: 0, scale: 0.94, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15, ease: [0.32, 0, 0.67, 0] } }}
                        transition={{ type: "spring", stiffness: 450, damping: 35 }}
                        className={cn(
                            "relative w-[482px] overflow-hidden p-[1.5px]",
                            reduced ? "support-border-reduced" : "support-border",
                            "rounded-[24px]",
                            isLight
                                ? "shadow-[0_32px_64px_-16px_rgba(255,106,92,0.15),0_8px_32px_-8px_rgba(0,0,0,0.06)]"
                                : "shadow-[0_48px_120px_-20px_rgba(0,0,0,0.95),0_0_80px_rgba(255,106,92,0.05)]",
                            className
                        )}
                    >
                        {/* Main Container Panel */}
                        <div style={{
                            position: 'relative',
                            width: '100%',
                            borderRadius: '22px',
                            overflow: 'hidden',
                            background: isLight 
                                ? 'linear-gradient(155deg, rgba(254, 252, 255, 0.98) 0%, rgba(248, 244, 255, 0.99) 100%)'
                                : 'linear-gradient(155deg, rgba(16,10,12,0.99) 0%, rgba(8,5,6,1) 100%)',
                            paddingBottom: '28px',
                            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
                        }}>
                            {/* Catch-light */}
                            <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '1px', background: isLight ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.12)', pointerEvents: 'none', zIndex: 5 }} />

                            {/* Radial Glow */}
                            <div className={`absolute top-0 left-0 right-0 h-[300px] bg-gradient-to-b pointer-events-none ${isLight ? 'from-rose-500/[0.03] to-transparent' : 'from-rose-500/[0.06] to-transparent'}`} />

                            {/* SVG Noise Grain Overlay */}
                            <div aria-hidden style={{
                                position: 'absolute', inset: 0, borderRadius: '22px', pointerEvents: 'none', zIndex: 4, opacity: isLight ? 0.015 : 0.028, mixBlendMode: 'overlay',
                                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)'/%3E%3C/svg%3E")`,
                                backgroundSize: '180px 180px',
                            }} />

                            {/* Top header with dismiss button */}
                            <div className="relative z-10 w-full flex justify-between items-center px-6 pt-5 pb-3" style={{ borderBottom: `1px solid ${rule}` }}>
                                <span style={{ fontSize: '10.5px', fontWeight: 660, letterSpacing: '0.15em', textTransform: 'uppercase', color: t2 }}>
                                    Support Natively
                                </span>
                                <button onClick={handleDismiss} aria-label="Dismiss"
                                    className="w-7 h-7 flex items-center justify-center rounded-full opacity-45 transition-all animate-none"
                                    style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                                    onMouseEnter={e => { e.currentTarget.style.opacity = '0.8'; e.currentTarget.style.background = isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.opacity = '0.45'; e.currentTarget.style.background = 'transparent'; }}>
                                    <X size={13} strokeWidth={2.3} color={isLight ? '#000' : '#fff'} />
                                </button>
                            </div>

                            {/* Content Container */}
                            <div className="relative z-10 w-full flex flex-col items-center pt-[32px]">

                                {/* Icon - Liquid Fill Effect */}
                                <div className="relative mb-[24px] w-[32px] h-[32px]">
                                    <div className="absolute inset-0 bg-[#FF6A5C] blur-[32px] opacity-15 rounded-full" />

                                    {/* 1. The Liquid Container (Masked to Heart Shape) */}
                                    <div
                                        className="absolute inset-0 z-10"
                                        style={{
                                            maskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='black'%3E%3Cpath d='M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z'/%3E%3C/svg%3E")`,
                                            WebkitMaskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='black'%3E%3Cpath d='M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z'/%3E%3C/svg%3E")`,
                                            maskSize: 'contain',
                                            WebkitMaskSize: 'contain',
                                            maskRepeat: 'no-repeat',
                                            WebkitMaskRepeat: 'no-repeat',
                                            maskPosition: 'center',
                                            WebkitMaskPosition: 'center',
                                        }}
                                    >
                                        {/* The Water */}
                                        <motion.div
                                            initial={{ height: "0%" }}
                                            animate={{ height: isButtonHovered ? "100%" : "0%" }}
                                            transition={{ duration: 1.5, ease: "easeInOut" }}
                                            className="absolute bottom-0 left-0 right-0 w-full bg-[#FF6A5C]"
                                            style={{
                                                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='20' viewBox='0 0 100 20' preserveAspectRatio='none'%3E%3Cpath d='M0 20 V10 Q25 0 50 10 T100 10 V20 H0 Z' fill='%23FF6A5C' /%3E%3C/svg%3E")`,
                                                backgroundSize: '32px 100%',
                                                backgroundRepeat: 'repeat-x',
                                            }}
                                        >
                                            {/* Inner Wave Top - Sits at the top of the filling column */}
                                            <div
                                                className="absolute -top-[5px] left-0 right-0 h-[10px] w-full"
                                                style={{
                                                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='20' viewBox='0 0 100 20' preserveAspectRatio='none'%3E%3Cpath d='M0 20 V10 Q25 0 50 10 T100 10 V20 H0 Z' fill='%23FF6A5C' /%3E%3C/svg%3E")`,
                                                    backgroundSize: '32px 100%',
                                                    animation: 'waveMove 1s linear infinite',
                                                }}
                                            />
                                        </motion.div>
                                    </div>

                                    {/* 2. Outline Overlay (Sit on top) */}
                                    <Heart
                                        size={32}
                                        className="text-[#FF6A5C] drop-shadow-[0_0_12px_rgba(255,106,92,0.4)] relative z-20 pointer-events-none"
                                        strokeWidth={1.5}
                                    />
                                </div>

                                {/* Typography */}
                                <div className="text-center px-[40px] mb-[28px]">
                                    <h3 style={{ color: t1 }} className="text-[26px] font-[750] leading-[1.2] tracking-[-0.02em] mb-[12px] antialiased">
                                        Built by one.<br />
                                        Used by thousands.
                                    </h3>
                                    <p style={{ color: t3 }} className="text-[13.5px] leading-[1.6] max-w-[340px] mx-auto font-medium antialiased">
                                        Natively is built and maintained by one developer. If it's part of your daily workflow, your support keeps it moving forward.
                                    </p>
                                </div>

                                {/* Actions */}
                                <div className="w-full px-[46px] flex flex-col gap-4 relative">
                                    <motion.button
                                        onClick={handleSupport}
                                        onMouseEnter={() => setIsButtonHovered(true)}
                                        onMouseLeave={() => setIsButtonHovered(false)}
                                        whileHover={{ scale: 1.012, filter: 'brightness(1.04)' }}
                                        whileTap={{ scale: 0.985 }}
                                        className="relative w-full h-[52px] rounded-[15px] bg-gradient-to-r from-[#FF6A5C] to-[#E55B4D] text-white font-bold text-[15.5px] tracking-wide transition-all shadow-[0_8px_24px_rgba(255,106,92,0.25)] overflow-hidden flex items-center justify-center border-none cursor-pointer"
                                    >
                                        {/* 3D Jelly Gloss Highlight */}
                                        <span className="absolute top-[2px] left-[8px] right-[8px] h-[40%] rounded-full bg-gradient-to-b from-white/70 to-white/5 filter blur-[0.5px] pointer-events-none z-10" />

                                        {/* Shimmer */}
                                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/15 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]" />
                                        <span className="relative z-20">Support the Builder</span>
                                    </motion.button>

                                    {/* Social Proof & Dismiss */}
                                    <div className="flex flex-col items-center gap-2.5 mt-1">
                                        <button
                                            onClick={handleDismiss}
                                            className={`text-[11px] font-bold uppercase tracking-[0.2em] mt-1 transition-colors duration-200 border-none bg-none cursor-pointer ${isLight ? 'text-black/30 hover:text-black/50' : 'text-white/30 hover:text-white/50'}`}
                                        >
                                            Maybe later
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};
