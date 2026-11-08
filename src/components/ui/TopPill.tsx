import { ChevronUp, ChevronDown } from "lucide-react";
import icon from "../icon.png";
import nativelyMark from "../overlay/heroGlass/natively-mark-black.svg";
import type { OverlayAppearance } from "../../lib/overlayAppearance";

interface TopPillProps {
    expanded: boolean;
    onToggle: () => void;
    onQuit: () => void;
    appearance: OverlayAppearance;
    onLogoClick?: () => void;
    /** Lavender draws the website hero's pill (NativelyInterfaceCard) instead. */
    interfaceTheme?: string;
}

const MARK_MASK = {
    maskImage: `url("${nativelyMark}")`,
    WebkitMaskImage: `url("${nativelyMark}")`,
    maskSize: "contain",
    WebkitMaskSize: "contain",
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
    maskPosition: "center",
    WebkitMaskPosition: "center",
} as const;

export default function TopPill({
    expanded,
    onToggle,
    onQuit,
    appearance,
    onLogoClick,
    interfaceTheme,
}: TopPillProps) {
    if (interfaceTheme === "lavender") {
        // The hero card's pill markup, as the website draws it, with the
        // app's three actions wired to it.
        return (
            <div className="flex justify-center select-none z-50">
                <div className="draggable-area overlay-resize-toggle-surface flex items-center gap-1 rounded-full p-1">
                    <div className="draggable-area">
                        <button
                            onClick={onLogoClick}
                            aria-label="Natively"
                            className="interaction-base interaction-press w-8 h-8 rounded-full flex items-center justify-center"
                        >
                            {/* The mark fills the button: its own ring is the
                                edge, with no chip showing around it. */}
                            <span aria-hidden="true" className="relative block h-8 w-8 bg-[#B0ABBB]" style={MARK_MASK} />
                        </button>
                    </div>
                    <button
                        onClick={onToggle}
                        className="overlay-chip-surface overlay-text-secondary interaction-base interaction-press flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium tracking-[0.02em] relative overflow-hidden"
                    >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="opacity-70 relative" aria-hidden="true">
                            <path d={expanded ? "M3 7.5L6 4.5L9 7.5" : "M3 4.5L6 7.5L9 4.5"} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span className="relative">{expanded ? "Hide" : "Show"}</span>
                    </button>
                    <button
                        onClick={onQuit}
                        aria-label="Stop"
                        className="overlay-icon-surface overlay-icon-surface-hover interaction-base interaction-press overlay-text-muted w-8 h-8 rounded-full flex items-center justify-center"
                    >
                        <div className="w-3 h-3 rounded-[2px] bg-current opacity-90 relative" />
                    </button>
                </div>
            </div>
        );
    }
    return (
        <div className="flex justify-center select-none z-50">
            <div
                className="
          draggable-area
          flex items-center gap-2
          rounded-full
          border
          overlay-pill-surface
          backdrop-blur-md
          px-1.5 py-1.5
          transition-all duration-300 ease-sculpted
        "
                style={appearance.pillStyle}
            >
                <div className="draggable-area">
                    {/* LOGO BUTTON: the mark fills the button, its own ring
                        is the edge, with no chip showing around it. */}
                    <button
                        onClick={onLogoClick}
                        className={`
              w-7 h-7
              rounded-full
              flex items-center justify-center
              relative overflow-hidden
              interaction-base interaction-press
            `}
                    >
                        <img
                            src={icon}
                            alt="Natively"
                            className="top-pill-logo w-7 h-7 object-contain opacity-95 force-black-icon"
                            draggable="false"
                            onDragStart={(e) => e.preventDefault()}
                        />
                    </button>
                </div>

                {/* CENTER SEGMENT */}
                <button
                    onClick={onToggle}
                    className={`
            flex items-center gap-2
            group
            px-3 py-1
            rounded-full
            backdrop-blur-md
            overlay-chip-surface
            overlay-text-interactive
            text-[12px]
            font-medium
            border
            interaction-base interaction-hover interaction-press
          `}
                    style={appearance.chipStyle}
                >
                    <span className="opacity-70 group-hover:opacity-100 transition-opacity duration-200">
                        {expanded ? (
                            <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                        )}
                    </span>
                    <span className="tracking-wide opacity-80 group-hover:opacity-100">{expanded ? "Hide" : "Show"}</span>
                </button>

                {/* STOP / QUIT BUTTON */}
                <button
                    onClick={onQuit}
                    className={`
            w-7 h-7
            rounded-full
            overlay-icon-surface
            overlay-text-primary
            flex items-center justify-center
            interaction-base interaction-press
            hover:bg-red-500/10 hover:text-red-400
          `}
                    style={appearance.iconStyle}
                >
                    <div className="w-3.5 h-3.5 rounded-[3px] bg-current opacity-80" />
                </button>
            </div>
        </div>
    );
}
