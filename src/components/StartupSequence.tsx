import React from 'react';
import { motion } from 'framer-motion';
import logoAsset from '../assets/logo.png';
import celebFont from '../font/Masterfont - Celeb MF Medium.otf?url';
import celebLightFont from '../font/Masterfont - Celeb MF Light.otf?url';
import interFont from '../font/Inter-4.1/web/Inter-Medium.woff2?url';
import interLightFont from '../font/Inter-4.1/web/Inter-Light.woff2?url';

import heroVideo from '../assets/hero.webm';
import NativelyInterfaceCard from './NativelyInterfaceCard';

interface StartupSequenceProps {
    onComplete: () => void;
}

// ─── Design Tokens (Stitch Semantic System) ──────────────────────────────
const COLORS = {
    pureSurface: '#FFFFFF',
    charcoalInk: '#18181B',  // Primary Text
    mutedSteel: '#71717A',   // Secondary text
};

const FONTS = {
    display: "'Geist', ui-sans-serif, system-ui, sans-serif",
    celebMedium: "'Celeb MF Medium', 'Geist', ui-sans-serif, system-ui, sans-serif",
    celebLight: "'Celeb MF Light', 'Geist', ui-sans-serif, system-ui, sans-serif",
    interMedium: "'Inter Medium', 'Geist', ui-sans-serif, system-ui, sans-serif",
    interLight: "'Inter Light', 'Geist', ui-sans-serif, system-ui, sans-serif",
};

// Premium Spring Physics
const springEase = [0.23, 1, 0.32, 1] as [number, number, number, number];

const containerVariants = {
    hidden: {},
    visible: {
        transition: {
            staggerChildren: 0.1,
            delayChildren: 0.1,
        },
    },
};

const itemVariants = {
    hidden: { opacity: 0, y: 16 },
    visible: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.8, ease: springEase },
    },
};

// ─── Components ───────────────────────────────────────────────────────────

const PressLogos: React.FC = () => (
    <div className="flex items-center justify-center gap-5 text-[#9ea3ab] opacity-90 select-none mb-10 translate-y-2">
        {/* Hacker News */}
        <div className="flex items-center gap-1.5 transition-opacity hover:opacity-100">
            <div className="w-[18px] h-[18px] bg-current flex items-center justify-center rounded-[1.5px] transform -translate-y-[1px]">
                <span className="text-[13px] font-bold text-[#f3f3f4] leading-none pb-[1px]" style={{ fontFamily: 'Verdana, sans-serif' }}>Y</span>
            </div>
            <span className="text-[14px] font-bold tracking-tight text-current" style={{ fontFamily: 'Verdana, sans-serif' }}>Hacker News</span>
        </div>

        {/* AlternativeTo */}
        <div className="flex items-center gap-1.5 transition-opacity hover:opacity-100">
            <svg className="w-[20px] h-[20px] fill-current" viewBox="0 0 24 24">
                <path d="M12 .416C18.398.416 23.584 5.602 23.584 12S18.398 23.584 12 23.584.416 18.397.416 12 5.602.416 12 .416M12 0C5.383 0 0 5.383 0 12s5.383 12 12 12 12-5.383 12-12S18.616 0 12 0m6.509 18.136-.056.012q.051.177.094.345l.202.812q.688-.639 1.249-1.394c-.305.036-.618.074-.923.117-.188.026-.372.066-.567.108zm.931-4.295c-3.783-.612-7.762.613-10.989 2.561-.757.457-1.59.91-2.129 1.632-.368.494-.561 1.081-.679 1.68q.464.381.975.704l.002-.099c.013-.41.064-.827.229-1.206.182-.42.478-.679.843-.938.756-.538 1.598-.967 2.412-1.392.055-.03.134-.029.202-.043.015.062.048.125.043.185-.02.283-.014.567-.007.85.022 1.016.088 2.032.157 3.047q.035.525.072 1.049.693.096 1.391.097a9.94 9.94 0 0 0 6.093-2.074l-.425-1.471q-.009-.032-.02-.063l-.064.017c-1.237.343-2.495.826-3.845 1.476l-.036.018c-.059.031-.14.074-.237.074h-.002c-.118 0-.278-.065-.34-.189-.064-.128-.017-.305.064-.398.066-.075.152-.121.22-.158l.038-.02a18.3 18.3 0 0 1 3.913-1.63l-.07-.179c-.101-.26-.205-.53-.32-.789-.148-.333-.317-.666-.48-.988l-.084-.167c-.054-.107-.109-.248-.055-.388a.34.34 0 0 1 .205-.192c.175-.064.436.065.511.214.415.816.77 1.546 1.087 2.23l.029.056.047-.008a9 9 0 0 1 2.342-.229 10 10 0 0 0 .886-1.91c-.545-.699-1.194-1.231-1.98-1.358zm2.428-2.827a8 8 0 0 0-.098-.649q-.046-.24-.096-.478c-.036-.171-.066-.344-.109-.514a9.2 9.2 0 0 0-1.158-2.73 9 9 0 0 0-.867-1.165 10 10 0 0 0-1.026-1.015 10.2 10.2 0 0 0-5.943-2.409 10 10 0 0 0-1.47.013 9.8 9.8 0 0 0-2.922.716 9 9 0 0 0-.709.33q-.164.085-.325.175a10.1 10.1 0 0 0-5.017 7.83c-.05.942.017 1.886.194 2.813h-.001s.191 1.124.298 1.334c.526 1.989 1.443 3.744 2.648 3.419a.167.167 0 0 0 .111-.208q-.003-.011-.008-.021a.95.95 0 0 1-.523-.377c-.666-1.117 2.723-3.509 7.351-5.269 4.252-1.619 8.091-2.144 8.965-1.285.173.141.24.376.168.588a3.03 3.03 0 0 1-.934 1.43.19.19 0 0 0 0 .269.18.18 0 0 0 .244.011 3.54 3.54 0 0 0 1.17-1.682c.028-.085.034-.187.045-.276a3.8 3.8 0 0 0 .011-.851zM6.253 14.668c-.566.402-1.553 1.122-1.967 1.925-.161.31-.312.069-.406-.107a10 10 0 0 1-.541-1.518l-.001-.003c-.066-.241-.282-1.04-.303-1.277l.001-.001a10.8 10.8 0 0 1-.187-2.638 9.35 9.35 0 0 1 4.635-7.227 10 10 0 0 1 .715-.362c.236-.107 1.191-.463.246.375a8.4 8.4 0 0 0-2.727 5.482c-.092 1.076.221 3.091.773 4.57.173.463.031.592-.238.782zM17.46 9.7a.44.44 0 0 1-.296.193c-1.068.149-2.12.398-3.14.745a.45.45 0 0 1-.356-.044.44.44 0 0 1-.203-.295l-.08-.369a.2.2 0 0 1 .114-.227 12.6 12.6 0 0 1 3.736-.863.19.19 0 0 1 .198.157l.084.354c.03.119.01.246-.057.349m2.032-1.876a.166.166 0 0 1-.183.106c-2.948-.438-7.069 1.073-7.069 1.073a17.7 17.7 0 0 0-4.049 1.912.493.493 0 0 1-.754-.319 8 8 0 0 1-.131-1.14 5.8 5.8 0 0 1 .575-3.012q.04-.078.087-.154a.1.1 0 0 1 .018-.037l.015-.025.035-.06.017-.027c1.429-2.34 4.636-3.273 7.197-2.511a7.43 7.43 0 0 1 3.335 2.123c.141.165 1.09 1.485.907 2.071m-1.533-1.599-.002.005a4 4 0 0 0-1.907-1.67 5.84 5.84 0 0 0-2.824-.43 3.8 3.8 0 0 0-1 .22.14.14 0 0 0-.097.148.135.135 0 0 0 .132.117 8.3 8.3 0 0 1 2.177.058c2.651.53 3.5 1.806 3.593 1.856.027.013.058-.013.045-.039a3 3 0 0 0-.117-.265"/>
            </svg>
            <span className="text-[14px] font-bold tracking-tight text-current" style={{ fontFamily: FONTS.interMedium }}>AlternativeTo</span>
        </div>

        {/* Product Hunt */}
        <div className="flex items-center gap-1.5 transition-opacity hover:opacity-100">
            <svg className="w-[20px] h-[20px] fill-current transform -translate-y-[1px]" viewBox="0 0 24 24">
                <path d="M13.604 8.4h-3.405V12h3.405c.995 0 1.801-.806 1.801-1.801 0-.993-.805-1.799-1.801-1.799zM12 0C5.372 0 0 5.372 0 12s5.372 12 12 12 12-5.372 12-12S18.628 0 12 0zm1.604 14.4h-3.405V18H7.801V6h5.804c2.319 0 4.2 1.88 4.2 4.199 0 2.321-1.881 4.201-4.201 4.201z"/>
            </svg>
            <span className="text-[14.5px] font-black tracking-tight text-current" style={{ fontFamily: FONTS.interMedium, fontWeight: 900 }}>Product Hunt</span>
        </div>

        {/* reddit */}
        <div className="flex items-center gap-1.5 transition-opacity hover:opacity-100">
            <svg className="w-[22px] h-[22px] fill-current transform -translate-y-[1px]" viewBox="0 0 24 24">
                <path d="M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286C.775 23.225 1.097 24 1.738 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0Zm4.388 3.199c1.104 0 1.999.895 1.999 1.999 0 1.105-.895 2-1.999 2-.946 0-1.739-.657-1.947-1.539v.002c-1.147.162-2.032 1.15-2.032 2.341v.007c1.776.067 3.4.567 4.686 1.363.473-.363 1.064-.58 1.707-.58 1.547 0 2.802 1.254 2.802 2.802 0 1.117-.655 2.081-1.601 2.531-.088 3.256-3.637 5.876-7.997 5.876-4.361 0-7.905-2.617-7.998-5.87-.954-.447-1.614-1.415-1.614-2.538 0-1.548 1.255-2.802 2.803-2.802.645 0 1.239.218 1.712.585 1.275-.79 2.881-1.291 4.64-1.365v-.01c0-1.663 1.263-3.034 2.88-3.207.188-.911.993-1.595 1.959-1.595Zm-8.085 8.376c-.784 0-1.459.78-1.506 1.797-.047 1.016.64 1.429 1.426 1.429.786 0 1.371-.369 1.418-1.385.047-1.017-.553-1.841-1.338-1.841Zm7.406 0c-.786 0-1.385.824-1.338 1.841.047 1.017.634 1.385 1.418 1.385.785 0 1.473-.413 1.426-1.429-.046-1.017-.721-1.797-1.506-1.797Zm-3.703 4.013c-.974 0-1.907.048-2.77.135-.147.015-.241.168-.183.305.483 1.154 1.622 1.964 2.953 1.964 1.33 0 2.47-.81 2.953-1.964.057-.137-.037-.29-.184-.305-.863-.087-1.795-.135-2.769-.135Z"/>
            </svg>
            <span className="text-[16px] font-semibold tracking-tighter text-current" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>reddit</span>
        </div>
    </div>
);

// ─── Main Subsystem ───────────────────────────────────────────────────────
const StartupSequence: React.FC<StartupSequenceProps> = ({ onComplete }) => {
    return (
        <div
            className="fixed inset-0 z-[100] flex overflow-hidden lg:grid lg:grid-cols-[1fr_1fr]"
            style={{ fontFamily: "'Inter', sans-serif", backgroundColor: '#f3f3f4', color: '#2f2f34' }}
        >
            <style>{`
                @font-face {
                    font-family: 'Celeb MF Medium';
                    src: url('${celebFont}') format('opentype');
                    font-weight: 500;
                    font-style: normal;
                }
                @font-face {
                    font-family: 'Celeb MF Light';
                    src: url('${celebLightFont}') format('opentype');
                    font-weight: 300;
                    font-style: normal;
                }
                @font-face {
                    font-family: 'Inter Medium';
                    src: url('${interFont}') format('woff2');
                    font-weight: 500;
                    font-style: normal;
                }
                @font-face {
                    font-family: 'Inter Light';
                    src: url('${interLightFont}') format('woff2');
                    font-weight: 300;
                    font-style: normal;
                }
                @import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=IBM+Plex+Sans:wght@500;600&display=swap');
                * { box-sizing: border-box; -webkit-font-smoothing: antialiased; }
            `}</style>

            {/* ── LEFT PANEL: Editorial Welcome Structure ── */}
            <motion.div
                className="relative flex flex-col items-center justify-center w-full h-full p-12 bg-white"
                initial="hidden"
                animate="visible"
                variants={containerVariants}
            >
                <div className="flex flex-col items-center w-full mt-auto wrap" style={{ transform: 'translateY(-4px)' }}>
                    {/* Typography Architecture (High-Fidelity) */}
                    <motion.h1
                        variants={itemVariants}
                        className="text-[44px] font-semibold tracking-[-0.5px] text-center mb-3"
                        style={{
                            background: 'linear-gradient(180deg, #2f2f34 0%, #50505a 100%)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            lineHeight: '1.2',
                            fontFamily: FONTS.interMedium,
                            fontWeight: 500
                        }}
                    >
                        Welcome to Natively
                    </motion.h1>

                    <motion.p
                        variants={itemVariants}
                        className="text-[25px] text-center mb-12 text-[#a7a7ad]"
                        style={{ fontFamily: FONTS.celebLight, fontWeight: 300 }}
                    >
                        The ultimate AI meeting assistant
                    </motion.p>

                    {/* High-Fidelity "Continue" Button */}
                    <motion.div variants={itemVariants} className="w-full flex justify-center">
                        <motion.button
                            onClick={onComplete}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            className="relative w-full max-w-[320px] h-[64px] rounded-[20px] text-[20px] font-medium text-[#eef3ff] flex items-center justify-center cursor-pointer outline-none overflow-hidden"
                            style={{
                                background: 'linear-gradient(100deg, #5f7ee8 0%, #6f97ee 50%, #88b6f7 100%)',
                                boxShadow: '0 10px 24px rgba(80,110,255,0.22)',
                            }}
                        >
                            {/* Gloss (Very Subtle) */}
                            <span className="absolute inset-0 rounded-[20px] pointer-events-none" style={{
                                background: 'linear-gradient(to bottom, rgba(255,255,255,0.22), rgba(255,255,255,0.06) 35%, transparent 60%)'
                            }} />

                            <span className="relative z-10 flex items-center">
                                Continue <span className="ml-[10px] text-[22px] opacity-90">›</span>
                            </span>
                        </motion.button>
                    </motion.div>
                </div>

                {/* Footer Component */}
                <motion.div variants={itemVariants} className="mt-auto flex flex-col items-center w-full">
                    <p className="text-[12px] opacity-40 mb-6 text-center" style={{ color: '#a7a7ad' }}>
                        By signing up, you agree to our <span className="font-semibold text-[#2f2f34]">Terms of Service</span> and <span className="font-semibold text-[#2f2f34]">Privacy Policy</span>.
                    </p>
                    <PressLogos />
                </motion.div>
            </motion.div>

            {/* ── RIGHT PANEL: Grid Background + Video Composition ── */}
            <div
                className="hidden lg:flex flex-col relative items-center justify-center overflow-hidden w-full h-full"
                style={{ backgroundColor: '#F0F2F6' }}
            >
                {/* 1. Subtle Grid Pattern */}
                <div
                    className="absolute inset-0 z-0 pointer-events-none"
                    style={{
                        backgroundImage: `
                            linear-gradient(to right, rgba(0,0,0,0.025) 1px, transparent 1px),
                            linear-gradient(to bottom, rgba(0,0,0,0.025) 1px, transparent 1px)
                        `,
                        backgroundSize: '48px 48px',
                        backgroundPosition: 'center center'
                    }}
                />

                {/* Optional radial fade on the grid to make center pop */}
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_50%,transparent_40%,#F0F2F6_100%)] z-0 pointer-events-none" />

                {/* 2. Content layers — stacked vertically, card overlaps video top */}
                <div className="relative z-10 w-full flex flex-col items-center justify-center px-8" style={{ paddingBottom: '80px' }}>

                    {/* A. NativelyInterfaceCard — slightly wider, on top */}
                    <motion.div
                        initial={{ opacity: 0, y: -12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3, duration: 1, ease: springEase }}
                        className="relative w-[95%] drop-shadow-[0_24px_48px_rgba(0,0,0,0.25)]"
                        style={{ zIndex: 2 }}
                    >
                        <NativelyInterfaceCard isStatic={true} isMobile={false} spreadHotkeys />
                    </motion.div>

                    {/* B. Hero Video — slightly narrower, below; negative margin to overlap under card */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.15, duration: 1, ease: springEase }}
                        className="w-[92%] rounded-[14px] overflow-hidden shadow-[0_16px_40px_rgba(0,0,0,0.18)] ring-1 ring-black/5 -mt-[160px]"
                        style={{ aspectRatio: '16/9', zIndex: 1 }}
                    >
                        <video
                            src={heroVideo}
                            autoPlay
                            muted
                            loop
                            playsInline
                            className="w-full h-full object-cover bg-black"
                        />
                    </motion.div>

                </div>

                {/* 3. Bottom Tagline */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.6, duration: 1, ease: springEase }}
                    className="absolute bottom-16 z-20 text-center px-12"
                >
                    <h2
                        className="text-[36px] font-medium leading-[1.25] tracking-tight"
                        style={{ color: COLORS.charcoalInk }}
                    >
                        Real-time meeting assistant,<br />
                        always ready to help
                    </h2>
                </motion.div>

            </div>
        </div>
    );
};

export default StartupSequence;
