// The meeting overlay drawn for Settings: the top pill and the card, with a
// line of transcript, a suggestion, the five buttons and the input. It uses
// NativelyInterface's own theme resolution (data-interface-theme, the
// appearance styles, GlassEffectLayer) and surface classes, so it shows the
// Meeting Interface Style and opacity the user picked. General's opacity
// preview floats it over the app; Settings › Overlay shows it on the page,
// with its buttons draggable (`quickActions`).
import React, { useMemo } from 'react';
import { ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react';
import { useT } from '../../i18n';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { getGlassOverlayAppearance, getOverlayAppearance, type OverlayAppearance } from '../../lib/overlayAppearance';
import { isCssOwnedInterfaceTheme, type MeetingInterfaceTheme } from '../../lib/meetingInterfaceTheme';
import { overlayRowOf, useOverlayButtonOrder, type OverlayButtonId } from '../../lib/overlayButtonOrder';
import { useOverlayCustomButtons } from '../../lib/overlayCustomButtons';
import { overlayButtonFace } from '../overlay/overlayButtons';
import GlassEffectLayer from '../ui/GlassEffectLayer';
import { ModelSelectorLabel } from '../ui/ModelSelectorLabel';
import { MODEL_SELECTOR_WIDTH } from '../ui/modelSelectorLabelText';
import icon from '../icon.png';
import TopPill from '../ui/TopPill';
// The Lavender style's pills are the website hero's button classes.
import '../overlay/heroGlass/HeroGlassButton.css';

/** One overlay button as the overlay draws it (its classes, glyph and label). */
export const overlayChipClass = (id: OverlayButtonId, theme?: MeetingInterfaceTheme) =>
    theme === 'lavender'
        // The website hero's paper pill (overlay/heroGlass), as the overlay draws it.
        ? `hlg-button hlg-lavender hlg-sm hero-pill hero-hotkey shrink-0 whitespace-nowrap${id === 'answer' ? ' min-w-[74px]' : ''}`
        : `flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border shrink-0 whitespace-nowrap overlay-chip-surface overlay-text-interactive${id === 'answer' ? ' justify-center min-w-[74px]' : ''}`;

export const OverlayChipContent: React.FC<{ id: OverlayButtonId; theme?: MeetingInterfaceTheme }> = ({ id, theme }) => {
    const t = useT();
    const { Icon, label } = overlayButtonFace(id, t, useOverlayCustomButtons());
    if (theme === 'lavender') {
        return (
            <span className="hlg-content">
                <span className="hlg-icon"><Icon size={11} strokeWidth={2} /></span>
                <span className="hlg-label">{label}</span>
            </span>
        );
    }
    return (
        <>
            <Icon className="w-3 h-3 opacity-70" /> {label}
        </>
    );
};

/** The overlay's inline surface styles for a style and opacity, as NativelyInterface resolves them. */
export function useOverlayAppearance(opacity: number, theme: MeetingInterfaceTheme): OverlayAppearance {
    const resolvedTheme = useResolvedTheme();
    const cssOwned = isCssOwnedInterfaceTheme(theme);
    return useMemo(
        () => (cssOwned ? getGlassOverlayAppearance() : getOverlayAppearance(opacity, resolvedTheme)),
        [opacity, resolvedTheme, cssOwned]
    );
}

export const OverlayMockup: React.FC<{
    opacity: number;
    theme: MeetingInterfaceTheme;
    id?: string;
    className?: string;
    /** The button row's content; by default the user's five, still. */
    quickActions?: (appearance: OverlayAppearance) => React.ReactNode;
}> = ({ opacity, theme, id, className = '', quickActions }) => {
    const t = useT();
    const row = overlayRowOf(useOverlayButtonOrder());
    const isGlassTheme = theme === 'liquid-glass';
    const shellRef = React.useRef<HTMLDivElement>(null);
    const appearance = useOverlayAppearance(opacity, theme);

    return (
        <div
            id={id}
            data-interface-theme={theme}
            className={`flex flex-col items-center ${className}`}
            // The "modern" theme's CSS (index.css [data-interface-theme="modern"]
            // .overlay-shell-surface etc.) reads --overlay-opacity directly via
            // calc(), same as the real overlay window (see App.tsx's
            // '--overlay-opacity' inline style); it does NOT go through
            // appearance.shellStyle.
            style={{ ['--overlay-opacity' as '--overlay-opacity']: String(opacity) } as React.CSSProperties}
        >
            {/* TopPill Replica (Lavender draws the website hero's pill itself) */}
            {theme === 'lavender' ? (
                <div className="mb-2 pointer-events-none">
                    <TopPill expanded onToggle={() => {}} onQuit={() => {}} appearance={appearance} interfaceTheme="lavender" />
                </div>
            ) : (
            <div className="flex justify-center mb-2 select-none z-50 pointer-events-none">
                <div className="flex items-center gap-2 rounded-full overlay-pill-surface backdrop-blur-md pl-1.5 pr-1.5 py-1.5" style={appearance.pillStyle}>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center overflow-hidden">
                        <img
                            src={icon}
                            alt="Natively"
                            className="top-pill-logo w-8 h-8 object-contain opacity-95 force-black-icon"
                            draggable="false"
                        />
                    </div>
                    <div className="flex items-center gap-2 px-4 py-1.5 rounded-full text-[12px] font-medium border overlay-chip-surface overlay-text-interactive" style={appearance.chipStyle}>
                        <ChevronUp className="w-3.5 h-3.5 opacity-70" />
                        <span className="opacity-80 tracking-wide">{t('Hide')}</span>
                    </div>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center overlay-icon-surface overlay-text-primary" style={appearance.iconStyle}>
                        <div className="w-3.5 h-3.5 rounded-[3px] bg-red-400 opacity-80" />
                    </div>
                </div>
            </div>

            )}

            {/* Main Interface Window Replica */}
            <div ref={shellRef} className="relative w-[600px] max-w-full overlay-shell-surface overlay-text-primary backdrop-blur-2xl border rounded-[24px] overflow-hidden flex flex-col pt-2 pb-3" style={appearance.shellStyle}>
                {isGlassTheme && <GlassEffectLayer parentRef={shellRef} cornerRadius={24} />}

                {/* Rolling Transcript Bar */}
                <div className="w-full flex justify-center py-2 px-4 border-b mb-1 overlay-transcript-surface pointer-events-none" style={appearance.transcriptStyle}>
                    <p className="text-[13px] truncate max-w-[90%] font-medium overlay-text-primary">
                        <span className="overlay-text-muted mr-2 font-semibold">{t('Interviewer')}</span>
                        <span className="opacity-95">{t('So how would you optimize the current algorithm?')}</span>
                    </p>
                </div>

                {/* Chat History Mock */}
                <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3 pointer-events-none">
                    <div className="flex justify-start">
                        <div className="max-w-[85%] px-4 py-3 text-[14px] leading-relaxed font-normal overlay-text-primary">
                            <span className="font-semibold text-emerald-500 block mb-1">{t('Suggestion')}</span>
                            {t('A good approach would be to use a hash map to cache the intermediate results, which brings the time complexity down from O(n²) to O(n).')}
                        </div>
                    </div>
                </div>

                {/* Quick Actions */}
                {quickActions ? quickActions(appearance) : (
                    <div className="flex flex-nowrap justify-center items-center gap-1.5 px-4 pb-3 pt-3 pointer-events-none">
                        {row.map((buttonId) => (
                            <div key={buttonId} className={overlayChipClass(buttonId, theme)} style={appearance.chipStyle}>
                                <OverlayChipContent id={buttonId} theme={theme} />
                            </div>
                        ))}
                    </div>
                )}

                {/* Input Area */}
                <div className="px-3 pointer-events-none">
                    <div className="relative group">
                        <div className="w-full border rounded-xl pl-3 pr-10 py-2.5 h-[38px] flex items-center overlay-input-surface" style={appearance.inputStyle}>
                            <span className="text-[13px] overlay-text-muted">{t('Ask anything on screen or conversation')}</span>
                        </div>
                    </div>

                    {/* Bottom Row */}
                    <div className="flex items-center justify-between mt-3 px-0.5">
                        <div className="flex items-center gap-1.5">
                            {theme === 'lavender' ? (
                                <div className="hlg-button hlg-lavender hlg-sm hero-pill hero-mono shrink-0" style={{ width: MODEL_SELECTOR_WIDTH }}>
                                    <span className="hlg-content">
                                        <ModelSelectorLabel>Gemini 3 Flash</ModelSelectorLabel>
                                        <svg className="shrink-0" width="8" height="8" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M3 4l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                                    </span>
                                </div>
                            ) : (
                            <div className="flex items-center gap-1 pl-3 pr-1.5 h-7 border rounded-[9px] text-xs font-medium text-left shrink-0 overlay-control-surface overlay-text-interactive" style={{ ...appearance.controlStyle, width: MODEL_SELECTOR_WIDTH }}>
                                <ModelSelectorLabel>Gemini 3 Flash</ModelSelectorLabel>
                                <ChevronDown size={12} className="shrink-0" />
                            </div>
                            )}
                            <div className="w-7 h-7 rounded-[9px] flex items-center justify-center overlay-bare-icon">
                                <SlidersHorizontal className="w-3.5 h-3.5" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
