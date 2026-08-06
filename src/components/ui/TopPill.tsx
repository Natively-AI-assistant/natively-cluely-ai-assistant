import { ChevronUp, ChevronDown } from "lucide-react";
import icon from "../icon.png";
import type { OverlayAppearance } from "../../lib/overlayAppearance";

interface TopPillProps {
    expanded: boolean;
    onToggle: () => void;
    /** Red-square listen transport toggle (pause/resume). Does not end the meeting. */
    onToggleListen: () => void;
    /** Triangle end-meeting. */
    onEndMeeting: () => void;
    /** When true, red square shows as “listening” (armed). */
    listenArmed?: boolean;
    appearance: OverlayAppearance;
    onLogoClick?: () => void;
}

/** Filled red square — armed / listening (InterviewMan transport). */
function ListenSquareArmed() {
    return (
        <span className="relative flex h-[12px] w-[12px] items-center justify-center" aria-hidden>
            <span className="absolute inset-[-2px] rounded-[3px] bg-red-500/25 blur-[2.5px]" />
            <span className="relative h-[11px] w-[11px] rounded-[2px] bg-[#ef4444] shadow-[0_0_7px_rgba(239,68,68,0.55)]" />
        </span>
    );
}

/** Hollow square — paused / not listening (same control, resume affordance). */
function ListenSquarePaused() {
    return (
        <span
            className="box-border h-[11px] w-[11px] rounded-[2px] border-[1.5px] border-current opacity-90"
            aria-hidden
        />
    );
}

/** Down-pointing triangle — end meeting (not listen pause). */
function EndMeetingTriangle() {
    return (
        <svg width="12" height="10" viewBox="0 0 12 10" className="opacity-85" aria-hidden>
            <path d="M6 9.25 0.75 1.1h10.5L6 9.25Z" fill="currentColor" />
        </svg>
    );
}

export default function TopPill({
    expanded,
    onToggle,
    onToggleListen,
    onEndMeeting,
    listenArmed = false,
    appearance,
    onLogoClick,
}: TopPillProps) {
    const listenTitle = listenArmed ? "Pause listening" : "Resume listening";

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
                    {/* LOGO BUTTON */}
                    <button
                        onClick={onLogoClick}
                        className={`
              w-7 h-7
              rounded-full
              overlay-icon-surface
              overlay-icon-surface-hover
              flex items-center justify-center
              relative overflow-hidden
              interaction-base interaction-press
            `}
                        style={appearance.iconStyle}
                    >
                        <img
                            src={icon}
                            alt="Natively"
                            className="w-[24px] h-[24px] object-contain opacity-95 scale-105 force-black-icon"
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

                {/* TRANSPORT CLUSTER — InterviewMan control map (ADR 0014)
                    Red square = listen pause/resume. Triangle = end meeting.
                    Hairline divider + tight gap keep the pair visually distinct
                    from Show/Hide without implying either ends via the square. */}
                <div
                    className="flex items-center gap-0.5 pl-1.5 ml-0.5 border-l border-white/12"
                    data-testid="listen-transport-cluster"
                >
                    {/* RED SQUARE — listen transport pause/resume */}
                    <button
                        type="button"
                        data-testid="listen-transport-toggle"
                        onClick={onToggleListen}
                        title={listenTitle}
                        aria-label={listenTitle}
                        aria-pressed={listenArmed}
                        className={`
              w-7 h-7
              rounded-full
              overlay-icon-surface
              flex items-center justify-center
              interaction-base interaction-press
              transition-colors duration-200
              ${listenArmed
                ? 'text-red-400 bg-red-500/10 hover:bg-red-500/18'
                : 'overlay-text-primary hover:bg-red-500/10 hover:text-red-400 opacity-75'}
            `}
                        style={appearance.iconStyle}
                    >
                        {listenArmed ? <ListenSquareArmed /> : <ListenSquarePaused />}
                    </button>

                    {/* TRIANGLE — end meeting */}
                    <button
                        type="button"
                        data-testid="end-meeting"
                        onClick={onEndMeeting}
                        title="End meeting"
                        aria-label="End meeting"
                        className={`
              w-7 h-7
              rounded-full
              overlay-icon-surface
              overlay-text-primary
              flex items-center justify-center
              interaction-base interaction-press
              transition-colors duration-200
              hover:bg-white/10 hover:opacity-100 opacity-85
            `}
                        style={appearance.iconStyle}
                    >
                        <EndMeetingTriangle />
                    </button>
                </div>
            </div>
        </div>
    );
}
