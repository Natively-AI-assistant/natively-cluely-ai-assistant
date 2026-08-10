import React from 'react';
import { useToggleInit } from './useToggleInit';

/**
 * The 44x24 settings switch. Wraps the shared `.t-toggle` markup so every
 * instance owns its own `useToggleInit()` — see that hook for why a per-panel
 * flag makes the whole panel flicker on a single click.
 *
 * Callers keep supplying their own track colors via `className`, since the ON
 * fill is not uniform (accent for most, amber for Phone Mirror's LAN switch).
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
            /* Every caller paints a 1px border via `className`, which eats 2px
               of content box: 44 − 2*1 − 2*3 − 18 = 18px, not the 20px
               t-toggle-lg assumes for a borderless track. */
            className={`t-toggle t-toggle-lg t-toggle-bordered w-11 h-6 rounded-full p-[3px] flex items-center shrink-0 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'} ${className} ${toggleInit.className}`}
        >
            <span className="t-toggle-thumb" aria-hidden="true" />
        </button>
    );
};
