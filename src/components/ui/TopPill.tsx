import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import icon from "../icon.png";
import type { OverlayAppearance } from "../../lib/overlayAppearance";

interface TopPillProps {
    expanded: boolean;
    onToggle: () => void;
    onQuit: () => void;
    appearance: OverlayAppearance;
    onLogoClick?: () => void;
    /** Optional — when true the user channel pulse glows phosphor */
    micActive?: boolean;
    /** Optional — when true the system-audio channel pulse glows ivory */
    sysActive?: boolean;
    /** Optional — STT health for the right-side dot */
    sttHealth?: 'connected' | 'reconnecting' | 'failed';
}

/**
 * Editorial Console — top stripe.
 *
 * A rounded glass capsule that carries:
 *   logo  ‖  NATIVELY · meeting timer · channel dots ‖  hide  ‖  ⏹
 *
 * The center is a typographic stripe (small-caps mono) with two channel
 * pulse dots — phosphor for "you", ivory for "them" — that light up while
 * audio flows on each side. The far right is the toggle/hide chevron and a
 * stop button that ends the meeting.
 *
 * The whole capsule is the drag handle; only the explicit interactive
 * surfaces opt out via `no-drag`.
 */
export default function TopPill({
    expanded,
    onToggle,
    onQuit,
    appearance,
    onLogoClick,
    micActive = false,
    sysActive = false,
    sttHealth = 'connected',
}: TopPillProps) {
    const startedAt = useRef<number>(Date.now());
    const [, force] = useState(0);

    // Tick once a second so the timer mono digits update. The tick is local
    // to the pill and uses tabular numerals so the width never jitters.
    useEffect(() => {
        const id = setInterval(() => force((n) => (n + 1) & 0xff), 1000);
        return () => clearInterval(id);
    }, []);

    const elapsed = (() => {
        const sec = Math.max(0, Math.floor((Date.now() - startedAt.current) / 1000));
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        const pad = (n: number) => String(n).padStart(2, '0');
        return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    })();

    const sttDotClass =
        sttHealth === 'failed'
            ? 'is-error'
            : sttHealth === 'reconnecting'
                ? 'is-warn is-pulsing'
                : 'is-pulsing';

    return (
        <div className="flex justify-center mt-2 select-none z-50 console-enter">
            <div
                className="
                    draggable-area
                    flex items-center gap-1
                    rounded-full
                    overlay-pill-surface
                    backdrop-blur-md
                    pl-1.5 pr-1.5 py-1.5
                    transition-all duration-300 ease-sculpted
                "
                style={appearance.pillStyle}
            >
                {/* LOGO — clickable to return to launcher */}
                <button
                    onClick={onLogoClick}
                    className="
                        no-drag
                        w-7 h-7 rounded-full
                        overlay-icon-surface overlay-icon-surface-hover
                        flex items-center justify-center
                        relative overflow-hidden
                        interaction-base interaction-press
                    "
                    style={appearance.iconStyle}
                    title="Back to launcher"
                >
                    <img
                        src={icon}
                        alt="Natively"
                        className="w-[20px] h-[20px] object-contain opacity-95 force-black-icon"
                        draggable="false"
                        onDragStart={(e) => e.preventDefault()}
                    />
                </button>

                {/* TYPOGRAPHIC STRIPE — wordmark · timer · channel dots */}
                <div className="flex items-center gap-2.5 px-3 py-0.5 select-text">
                    <span className="console-stripe console-stripe-mark">Natively</span>

                    <span className="w-px h-3 bg-[var(--console-rule)]" aria-hidden />

                    <span className="console-mono-tight text-[10.5px] console-ink-soft tabular-nums">
                        {elapsed}
                    </span>

                    <span className="w-px h-3 bg-[var(--console-rule)]" aria-hidden />

                    {/* Channel pulse pair — left=Them (ivory), right=You (phosphor) */}
                    <span className="flex items-center gap-1.5" aria-label="Audio channels">
                        <span
                            className="inline-block rounded-full"
                            style={{
                                width: 5,
                                height: 5,
                                background: sysActive ? 'var(--console-them)' : 'var(--console-rule-strong)',
                                boxShadow: sysActive ? '0 0 6px var(--console-them-dim)' : 'none',
                                transition: 'background 200ms ease, box-shadow 200ms ease',
                            }}
                        />
                        <span
                            className="inline-block rounded-full"
                            style={{
                                width: 5,
                                height: 5,
                                background: micActive ? 'var(--console-accent)' : 'var(--console-rule-strong)',
                                boxShadow: micActive ? '0 0 6px var(--console-accent-dim)' : 'none',
                                transition: 'background 200ms ease, box-shadow 200ms ease',
                            }}
                        />
                    </span>

                    {sttHealth !== 'connected' && (
                        <>
                            <span className="w-px h-3 bg-[var(--console-rule)]" aria-hidden />
                            <span className={`console-pulse-dot ${sttDotClass}`} aria-label="STT status" />
                        </>
                    )}
                </div>

                {/* HIDE / SHOW */}
                <button
                    onClick={onToggle}
                    className="
                        no-drag
                        flex items-center gap-1
                        px-2.5 py-1 rounded-full
                        text-[10px] font-medium
                        console-mono
                        overlay-text-interactive
                        interaction-base interaction-press
                        hover:bg-[var(--console-key-bg-hover)]
                        tracking-[0.16em] uppercase
                    "
                    title={expanded ? 'Hide overlay' : 'Show overlay'}
                >
                    {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    <span>{expanded ? 'Hide' : 'Show'}</span>
                </button>

                {/* STOP — ends the meeting */}
                <button
                    onClick={onQuit}
                    className="
                        no-drag
                        w-7 h-7 rounded-full
                        overlay-icon-surface
                        flex items-center justify-center
                        interaction-base interaction-press
                        hover:bg-red-500/15
                        group/stop
                    "
                    style={appearance.iconStyle}
                    title="End meeting"
                >
                    <span
                        className="block w-2.5 h-2.5 rounded-[2px] bg-current opacity-70 group-hover/stop:bg-red-400 group-hover/stop:opacity-100 transition-all"
                    />
                </button>
            </div>
        </div>
    );
}
