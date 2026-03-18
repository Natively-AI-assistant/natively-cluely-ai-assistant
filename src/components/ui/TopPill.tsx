import { ChevronUp, ChevronDown } from "lucide-react";
import icon from "../icon.png";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";

interface TopPillProps {
    expanded: boolean;
    onToggle: () => void;
    onQuit: () => void;
}

export default function TopPill({
    expanded,
    onToggle,
    onQuit,
}: TopPillProps) {
    const isLightTheme = useResolvedTheme() === 'light';

    return (
        <div className="flex justify-center mt-2 select-none z-50">
            <div
                className="
          draggable-area
          flex items-center gap-2
          rounded-full
          backdrop-blur-md
          pl-1.5 pr-1.5 py-1.5
          transition-all duration-300 ease-sculpted
        "
                style={{
                    backgroundColor: isLightTheme ? 'rgba(243, 244, 246, 0.88)' : 'rgba(30, 30, 30, 0.8)',
                    border: `1px solid ${isLightTheme ? 'rgba(15, 23, 42, 0.08)' : 'rgba(255, 255, 255, 0.1)'}`,
                    boxShadow: isLightTheme
                        ? '0 12px 28px rgba(15, 23, 42, 0.10)'
                        : '0 12px 28px rgba(0, 0, 0, 0.2)'
                }}
            >
                {/* LOGO BUTTON */}
                <button
                    className={`
            w-8 h-8
            rounded-full
            flex items-center justify-center
            relative overflow-hidden
            interaction-base interaction-press
            ${isLightTheme ? 'bg-black/[0.04] hover:bg-black/[0.06]' : 'bg-white/5 hover:bg-white/5'}
          `}
                >
                    <img
                        src={icon}
                        alt="Natively"
                        className="w-[24px] h-[24px] object-contain opacity-90 scale-105"
                        draggable="false"
                        onDragStart={(e) => e.preventDefault()}
                    />
                </button>

                {/* CENTER SEGMENT */}
                <button
                    onClick={onToggle}
                    className={`
            flex items-center gap-2
            group
            px-4 py-1.5
            rounded-full
            backdrop-blur-md
            text-[12px]
            font-medium
            border
            interaction-base interaction-hover interaction-press
            ${isLightTheme
                    ? 'bg-black/[0.04] text-slate-700 border-black/0 hover:bg-black/[0.07] hover:border-black/5 hover:text-slate-950'
                    : 'bg-white/5 text-slate-200 border-white/0 hover:bg-white/10 hover:border-white/5 hover:text-white'}
          `}
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
            w-8 h-8
            rounded-full
            flex items-center justify-center
            interaction-base interaction-press
            ${isLightTheme
                    ? 'bg-black/[0.04] text-slate-800 hover:bg-red-500/10 hover:text-red-500'
                    : 'bg-white/5 text-white hover:bg-red-500/10 hover:text-red-400'}
          `}
                >
                    <div className="w-3.5 h-3.5 rounded-[3px] bg-current opacity-80" />
                </button>
            </div>
        </div>
    );
}
