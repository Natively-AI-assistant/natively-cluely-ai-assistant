import React, { useState, useEffect } from 'react';
import { ArrowRight, Loader, Check } from 'lucide-react';
import { motion } from 'framer-motion';

interface ConnectCalendarButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onConnect'> {
    variant?: 'default' | 'dark';
    onConnect?: () => void;
}

const ConnectCalendarButton: React.FC<ConnectCalendarButtonProps> = ({ className = '', variant = 'default', onConnect, ...props }) => {
    const [loading, setLoading] = useState(false);
    const [connected, setConnected] = useState(false);

    useEffect(() => {
        if (window.electronAPI) {
            window.electronAPI.getCalendarStatus().then(status => {
                setConnected(status.connected);
                if (status.connected) {
                    onConnect?.();
                }
            });
        }
    }, []);

    const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
        if (props.onClick) props.onClick(e);
        if (connected) return; // For now no disconnect here

        setLoading(true);
        try {
            const res = await window.electronAPI.calendarConnect();
            if (res.success) {
                setConnected(true);
                onConnect?.();
                // Track calendar connection
                import('../../lib/analytics/analytics.service').then(({ analytics }) => {
                    analytics.trackCalendarConnected();
                });
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    if (connected) {
        return (
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 2 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className={`
                    relative
                    flex items-center gap-2.5
                    pl-4 pr-5 py-2
                    rounded-full
                    text-[13px] font-medium
                    overflow-hidden
                    select-none
                    ${className}
                `}
                style={{
                    // Ultra Premium "Gemstone Glass"
                    background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.05) 50%, rgba(255, 255, 255, 0.02) 100%)',
                    backdropFilter: 'blur(16px)',
                    WebkitBackdropFilter: 'blur(16px)',
                    boxShadow: `
                        0 8px 32px -4px rgba(139, 92, 246, 0.25),   // Deep soft violet dispersion
                        0 2px 8px -1px rgba(124, 58, 237, 0.3),     // Closer intense glow
                        inset 0 1px 0 0 rgba(255, 255, 255, 0.4),   // Sharp top rim reflection
                        inset 0 -2px 1px 0 rgba(109, 40, 217, 0.15) // Deep bottom refractions
                    `,
                }}
            >
                {/* 1. Iridescent Aurora Border (Animated) */}
                <motion.div
                    className="absolute inset-0 rounded-full opacity-60 pointer-events-none"
                    animate={{
                        background: [
                            'radial-gradient(circle at 0% 0%, rgba(216, 180, 254, 0.3), transparent 60%)',
                            'radial-gradient(circle at 100% 100%, rgba(216, 180, 254, 0.3), transparent 60%)',
                            'radial-gradient(circle at 0% 0%, rgba(216, 180, 254, 0.3), transparent 60%)',
                        ]
                    }}
                    transition={{
                        duration: 6,
                        repeat: Infinity,
                        ease: "linear"
                    }}
                />

                {/* 2. Crystalline Noise Texture (Subtle Grain for realism) */}
                <div
                    className="absolute inset-0 rounded-full opacity-10 pointer-events-none"
                    style={{
                        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
                        mixBlendMode: 'overlay',
                    }}
                />

                {/* 3. Slow Elegant Shimmer */}
                <div className="absolute inset-0 overflow-hidden rounded-full pointer-events-none">
                    <motion.div
                        animate={{
                            x: ['-200%', '200%'],
                        }}
                        transition={{
                            duration: 4,
                            repeat: Infinity,
                            repeatDelay: 3,
                            ease: "easeInOut"
                        }}
                        className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/10 to-transparent skew-x-12 blur-md"
                    />
                </div>

                <span className="relative z-10 flex items-center gap-3 pl-0.5">
                    {/* Icon: Simple Polished Circle */}
                    <div className="
                        relative flex items-center justify-center w-[20px] h-[20px] rounded-full 
                        bg-violet-600 shadow-sm ring-1 ring-white/20
                    ">
                        <Check size={12} className="text-white" strokeWidth={4} />
                    </div>

                    {/* Text: High-End Typography */}
                    <span className="text-[13px] font-medium tracking-wide text-white flex flex-col leading-none gap-0.5" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>
                        <span className="font-semibold text-white/95">Calendar Connected</span>
                    </span>
                </span>
            </motion.div>
        );
    }

    return (
        <button
            onClick={handleClick}
            disabled={loading}
            className={`
                group relative
                flex items-center gap-2.5
                pl-4 pr-5 py-2
                rounded-full
                text-[13px] font-medium
                transition-all duration-300 ease-out
                hover:brightness-125
                active:scale-[0.98]
                overflow-hidden
                ${loading ? 'opacity-80 cursor-wait' : ''}
                ${className}
            `}
            style={{
                // Base Fill: Dark Purple
                backgroundColor: 'rgba(60, 20, 80, 0.4)',
                // Blur: Backdrop filter 12-16px
                backdropFilter: 'blur(14px)',
                WebkitBackdropFilter: 'blur(14px)',
                // Text Color
                color: '#F4F6FA',
            }}
            {...props}
        >
            {/* Gradient Border */}
            <div
                className="absolute inset-0 rounded-full pointer-events-none transition-opacity duration-300 group-hover:opacity-80"
                style={{
                    padding: '1px',
                    background: 'linear-gradient(to right, #6EA8FF, #8B7CFF)',
                    WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                    WebkitMaskComposite: 'xor',
                    maskComposite: 'exclude',
                    opacity: 0.5, // 40-60% opacity
                }}
            />

            {/* Inner Highlight (Top Edge) */}
            <div
                className="absolute inset-0 rounded-full pointer-events-none"
                style={{
                    boxShadow: 'inset 0 1px 0 0 rgba(255, 255, 255, 0.08)',
                }}
            />

            {/* Content */}
            <span className="relative z-10 flex items-center gap-2.5 font-semibold">
                {loading ? (
                    <Loader size={14} className="animate-spin" />
                ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="opacity-90">
                        <path d="M23.52 12.212c0-.848-.076-1.654-.216-2.428H12v4.594h6.473c-.28 1.503-1.12 2.775-2.38 3.619v3.01h3.84c2.247-2.07 3.54-5.118 3.54-8.795z" fill="white" />
                        <path d="M12 24c3.24 0 5.957-1.074 7.942-2.906l-3.84-3.01c-1.078.722-2.454 1.15-4.102 1.15-3.124 0-5.77-2.112-6.72-4.954H1.322v3.106C3.38 21.442 7.378 24 12 24z" fill="white" />
                        <path d="M5.28 14.28A7.276 7.276 0 0 1 4.908 12c0-.8.14-1.57.387-2.28V6.613H1.322A11.968 11.968 0 0 0 0 12c0 1.943.468 3.774 1.322 5.387l3.96-3.107z" fill="white" />
                        <path d="M12 4.75c1.764 0 3.345.607 4.588 1.795l3.433-3.434C17.95 1.258 15.234 0 12 0 7.378 0 3.378 2.558 1.322 6.613l3.957 3.107c.95-2.842 3.595-4.97 6.72-4.97z" fill="white" />
                    </svg>
                )}

                {loading ? 'Connecting...' : 'Connect calendar'}

                {!loading && (
                    <ArrowRight
                        size={13}
                        className="transition-transform group-hover:translate-x-0.5"
                        style={{ color: 'rgba(244, 246, 250, 0.9)' }} // Slightly brighter/matching text
                    />
                )}
            </span>
        </button>
    );
};

export default ConnectCalendarButton;
