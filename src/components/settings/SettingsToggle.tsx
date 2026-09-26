import React from 'react';
import { useToggleInit } from './useToggleInit';

/**
 * The settings switch. Wraps the shared `.t-toggle` markup, which is a
 * literal copy of the reference 88x40/52x32 toggle shape at `zoom: 0.6`
 * (`.t-toggle-lg`) — a 52.8x24 track. `w-11 h-6 p-[3px]` below no longer do
 * anything (kept for layout compatibility rather than stripped from every
 * caller); the Apple-style palette and press/hover/focus behavior win
 * unconditionally over whatever track color a caller passes via `className`.
 *
 * `useToggleInit()` is currently inert (the CSS bounce it used to arm was
 * replaced by a plain transition, which needs no arming) but still wired per
 * instance; see that hook's docstring for the render-ordering bug it guarded.
 */
export interface SettingsToggleProps {
    checked: boolean;
    onChange: () => void;
    /** Required: these switches have no visible text of their own. */
    label: string;
    title?: string;
    /** Marks the control unavailable and blocks activation. */
    disabled?: boolean;
    /** Track/geometry classes. The `.t-toggle` base is applied for you. */
    className?: string;
}

export const SettingsToggle: React.FC<SettingsToggleProps> = ({
    checked,
    onChange,
    label,
    title,
    disabled = false,
    className = '',
}) => {
    const toggleInit = useToggleInit();
    return (
        <button
            type="button"
            role="switch"
            data-on={String(checked)}
            aria-checked={checked}
            aria-disabled={disabled ? true : undefined}
            aria-label={label}
            title={title}
            disabled={disabled}
            onClick={() => {
                if (disabled) return;
                toggleInit.arm();
                onChange();
            }}
            /* `t-toggle-bordered` no longer changes the geometry (it used to
               subtract a border from --toggle-travel); the shared .t-toggle
               rule forces border:none, so this class is now just a label —
               kept on the element rather than stripped from every caller. */
            className={`t-toggle t-toggle-lg t-toggle-bordered w-11 h-6 rounded-full p-[3px] flex items-center shrink-0 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'} ${className} ${toggleInit.className}`}
        >
            <span className="t-toggle-thumb" aria-hidden="true" />
        </button>
    );
};
