import type React from 'react';

export type OverlayTheme = 'light' | 'dark';

export interface OverlayAppearance {
    shellStyle: React.CSSProperties;
    pillStyle: React.CSSProperties;
    transcriptStyle: React.CSSProperties;
    subtleStyle: React.CSSProperties;
    chipStyle: React.CSSProperties;
    inputStyle: React.CSSProperties;
    controlStyle: React.CSSProperties;
    iconStyle: React.CSSProperties;
    codeBlockStyle: React.CSSProperties;
    codeHeaderStyle: React.CSSProperties;
    dividerStyle: React.CSSProperties;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const mix = (min: number, max: number, value: number) => min + ((max - min) * value);

export const OVERLAY_OPACITY_MIN = 0.35;
export const OVERLAY_OPACITY_MAX = 1;
export const OVERLAY_OPACITY_DEFAULT = 0.65;

export const clampOverlayOpacity = (opacity: number) => clamp(opacity, OVERLAY_OPACITY_MIN, OVERLAY_OPACITY_MAX);

const normalizeOpacity = (opacity: number) =>
    (clampOverlayOpacity(opacity) - OVERLAY_OPACITY_MIN) / (OVERLAY_OPACITY_MAX - OVERLAY_OPACITY_MIN);
const scale = (min: number, max: number, strength: number, ease = 1) =>
    mix(min, max, Math.pow(clamp(strength, 0, 1), ease));

export const getOverlayAppearance = (opacity: number, theme: OverlayTheme): OverlayAppearance => {
    const strength = normalizeOpacity(opacity);
    const surfaceStrength = Math.pow(strength, 1.02);
    const blurStrength = Math.pow(strength, 0.94);

    if (theme === 'light') {
        return {
            shellStyle: {
                backgroundColor: `rgba(214, 228, 247, ${scale(0.085, 1, surfaceStrength)})`,
                borderColor: `rgba(37, 99, 235, ${scale(0.08, 0.16, surfaceStrength)})`,
                boxShadow: `0 24px 48px rgba(37, 99, 235, ${scale(0.03, 0.12, surfaceStrength)})`,
                backdropFilter: `blur(${scale(4, 18, blurStrength)}px) saturate(145%)`,
                WebkitBackdropFilter: `blur(${scale(4, 18, blurStrength)}px) saturate(145%)`,
            },
            pillStyle: {
                backgroundColor: `rgba(221, 234, 250, ${scale(0.075, 0.98, surfaceStrength)})`,
                borderColor: `rgba(37, 99, 235, ${scale(0.08, 0.16, surfaceStrength)})`,
                boxShadow: `0 12px 28px rgba(37, 99, 235, ${scale(0.02, 0.09, surfaceStrength)})`,
                backdropFilter: `blur(${scale(3, 11, blurStrength)}px) saturate(140%)`,
                WebkitBackdropFilter: `blur(${scale(3, 11, blurStrength)}px) saturate(140%)`,
            },
            transcriptStyle: {
                backgroundColor: `rgba(219, 234, 254, ${scale(0.2, 0.96, surfaceStrength)})`,
                borderBottomColor: `rgba(30, 64, 175, ${scale(0.1, 0.2, surfaceStrength)})`,
                backdropFilter: `blur(${scale(1.5, 4.5, blurStrength)}px)`,
                WebkitBackdropFilter: `blur(${scale(1.5, 4.5, blurStrength)}px)`,
            },
            subtleStyle: {
                backgroundColor: `rgba(245, 249, 255, ${scale(0.05, 0.92, surfaceStrength)})`,
                borderColor: `rgba(30, 64, 175, ${scale(0.06, 0.13, surfaceStrength)})`,
            },
            chipStyle: {
                backgroundColor: `rgba(248, 251, 255, ${scale(0.055, 0.9, surfaceStrength)})`,
                borderColor: `rgba(30, 64, 175, ${scale(0.06, 0.13, surfaceStrength)})`,
            },
            inputStyle: {
                backgroundColor: `rgba(248, 251, 255, ${scale(0.065, 0.94, surfaceStrength)})`,
                borderColor: `rgba(30, 64, 175, ${scale(0.07, 0.14, surfaceStrength)})`,
            },
            controlStyle: {
                backgroundColor: `rgba(248, 251, 255, ${scale(0.06, 0.92, surfaceStrength)})`,
                borderColor: `rgba(30, 64, 175, ${scale(0.07, 0.14, surfaceStrength)})`,
            },
            iconStyle: {
                backgroundColor: `rgba(248, 251, 255, ${scale(0.055, 0.88, surfaceStrength)})`,
            },
            codeBlockStyle: {
                backgroundColor: `rgba(245, 249, 255, ${scale(0.06, 0.94, surfaceStrength)})`,
                borderColor: `rgba(30, 64, 175, ${scale(0.07, 0.15, surfaceStrength)})`,
            },
            codeHeaderStyle: {
                backgroundColor: `rgba(236, 244, 255, ${scale(0.08, 0.96, surfaceStrength)})`,
                borderBottomColor: `rgba(30, 64, 175, ${scale(0.08, 0.16, surfaceStrength)})`,
            },
            dividerStyle: {
                backgroundColor: `rgba(30, 64, 175, ${scale(0.08, 0.16, surfaceStrength)})`,
            },
        };
    }

    return {
        shellStyle: {
            backgroundColor: `rgba(24, 26, 32, ${scale(0.12, 1, surfaceStrength)})`,
            borderColor: `rgba(255, 255, 255, ${scale(0.08, 0.14, surfaceStrength)})`,
            boxShadow: `0 24px 48px rgba(0, 0, 0, ${scale(0.05, 0.24, surfaceStrength)})`,
            backdropFilter: `blur(${scale(6, 20, blurStrength)}px) saturate(140%)`,
            WebkitBackdropFilter: `blur(${scale(6, 20, blurStrength)}px) saturate(140%)`,
        },
        pillStyle: {
            backgroundColor: `rgba(24, 26, 32, ${scale(0.1, 0.98, surfaceStrength)})`,
            borderColor: `rgba(255, 255, 255, ${scale(0.08, 0.14, surfaceStrength)})`,
            boxShadow: `0 12px 28px rgba(0, 0, 0, ${scale(0.035, 0.16, surfaceStrength)})`,
            backdropFilter: `blur(${scale(4, 13, blurStrength)}px) saturate(136%)`,
            WebkitBackdropFilter: `blur(${scale(4, 13, blurStrength)}px) saturate(136%)`,
        },
        transcriptStyle: {
            backgroundColor: `rgba(17, 24, 39, ${scale(0.05, 0.9, surfaceStrength)})`,
            borderBottomColor: `rgba(255, 255, 255, ${scale(0.05, 0.1, surfaceStrength)})`,
            backdropFilter: `blur(${scale(2, 6, blurStrength)}px)`,
            WebkitBackdropFilter: `blur(${scale(2, 6, blurStrength)}px)`,
        },
        subtleStyle: {
            backgroundColor: `rgba(40, 45, 56, ${scale(0.18, 0.92, surfaceStrength)})`,
            borderColor: `rgba(255, 255, 255, ${scale(0.04, 0.085, surfaceStrength)})`,
        },
        chipStyle: {
            backgroundColor: `rgba(56, 61, 73, ${scale(0.2, 0.96, surfaceStrength)})`,
            borderColor: `rgba(255, 255, 255, ${scale(0.04, 0.08, surfaceStrength)})`,
        },
        inputStyle: {
            backgroundColor: `rgba(46, 51, 63, ${scale(0.24, 0.94, surfaceStrength)})`,
            borderColor: `rgba(255, 255, 255, ${scale(0.05, 0.095, surfaceStrength)})`,
        },
        controlStyle: {
            backgroundColor: `rgba(52, 57, 69, ${scale(0.22, 0.94, surfaceStrength)})`,
            borderColor: `rgba(255, 255, 255, ${scale(0.05, 0.095, surfaceStrength)})`,
        },
        iconStyle: {
            backgroundColor: `rgba(54, 59, 71, ${scale(0.2, 0.92, surfaceStrength)})`,
        },
        codeBlockStyle: {
            backgroundColor: `rgba(35, 40, 50, ${scale(0.24, 0.96, surfaceStrength)})`,
            borderColor: `rgba(255, 255, 255, ${scale(0.05, 0.1, surfaceStrength)})`,
        },
        codeHeaderStyle: {
            backgroundColor: `rgba(48, 53, 64, ${scale(0.22, 0.94, surfaceStrength)})`,
            borderBottomColor: `rgba(255, 255, 255, ${scale(0.05, 0.1, surfaceStrength)})`,
        },
        dividerStyle: {
            backgroundColor: `rgba(255, 255, 255, ${scale(0.06, 0.12, surfaceStrength)})`,
        },
    };
};
