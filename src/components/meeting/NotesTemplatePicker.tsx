import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { LiquidGlassButton } from '../../ui-components/LiquidGlassButton';
import type { TemplateOption } from './notesFeedback';

/** The dropdown snippet's --dropdown-close-dur (index.css). */
const MENU_CLOSE_MS = 150;

/**
 * "Regenerate as" on the meeting page (2026-10-15): the template that wrote
 * these notes, and every other one the user has, in one pull-down. Picking
 * another template regenerates the notes in it; the notes it replaces stay in
 * their version tab.
 *
 * The follow-up's tone pull-down (MeetingDetails ToneDropdown) is the model:
 * the same clear Liquid Glass pill, the same transitions.dev menu. Who may use
 * which template is main's decision (notesTemplateGate.ts); a template main
 * refused is listed with "Needs Natively Pro" and can still be picked (main
 * checks again, so it works once Pro or a trial is on).
 */
export const NotesTemplatePicker: React.FC<{
    options: TemplateOption[];
    /** The template that wrote the notes shown, by name. */
    currentName: string;
    disabled: boolean;
    /** Template ids main refused for want of Pro. */
    needsPro: ReadonlySet<string>;
    isLight: boolean;
    onPick: (option: TemplateOption) => void;
    t: (s: string) => string;
}> = ({ options, currentName, disabled, needsPro, isLight, onPick, t }) => {
    const [open, setOpen] = useState(false);
    const [closing, setClosing] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const menuId = useId();
    const trigger = () => rootRef.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]') ?? null;

    const openMenu = () => {
        clearTimeout(closeTimer.current);
        setClosing(false);
        setOpen(true);
    };
    const close = (refocus: boolean) => {
        setOpen(false);
        setClosing(true);
        clearTimeout(closeTimer.current);
        closeTimer.current = setTimeout(() => setClosing(false), MENU_CLOSE_MS);
        if (refocus) trigger()?.focus({ preventScroll: true });
    };
    useEffect(() => () => clearTimeout(closeTimer.current), []);
    useEffect(() => {
        if (!open) return;
        const at = options.findIndex((o) => o.current);
        itemRefs.current[Math.max(0, at)]?.focus({ preventScroll: true });
        const onDown = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) close(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const onMenuKeyDown = (e: React.KeyboardEvent) => {
        const items = itemRefs.current.filter(Boolean) as HTMLButtonElement[];
        const at = items.indexOf(document.activeElement as HTMLButtonElement);
        const go = (i: number) => { e.preventDefault(); items[(i + items.length) % items.length]?.focus(); };
        if (e.key === 'ArrowDown') go(at + 1);
        else if (e.key === 'ArrowUp') go(at - 1);
        else if (e.key === 'Home') go(0);
        else if (e.key === 'End') go(items.length - 1);
        else if (e.key === 'Escape') { e.preventDefault(); close(true); }
        else if (e.key === 'Tab') close(false);
    };

    if (options.length === 0) return null;
    return (
        <div ref={rootRef} className="relative">
            <LiquidGlassButton
                variant="clear"
                className="lg-sm mn-tone"
                disabled={disabled}
                onClick={() => (open ? close(false) : openMenu())}
                onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); openMenu(); } }}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={menuId}
                aria-label={`${t('Regenerate as')}. ${t('Template')}: ${currentName}`}
            >
                <span className="inline-flex items-center gap-1">
                    <span className="max-w-[180px] truncate">{`${t('Template')}: ${currentName}`}</span>
                    <ChevronDown
                        className="w-3 h-3 opacity-60"
                        strokeWidth={2.5}
                        style={{ transform: `scaleY(${open ? -1 : 1})`, transition: `transform ${open ? 'var(--dropdown-open-dur)' : 'var(--dropdown-close-dur)'} var(--dropdown-ease)` }}
                    />
                </span>
            </LiquidGlassButton>
            <div
                id={menuId}
                role="menu"
                data-origin="top-left"
                inert={!open}
                onKeyDown={onMenuKeyDown}
                className={`t-dropdown${open ? ' is-open' : closing ? ' is-closing' : ''} absolute left-0 top-full mt-1 z-50 min-w-full w-max max-w-[280px] p-[3px] rounded-lg border ${isLight
                    ? 'bg-white border-black/[0.08] shadow-[0_6px_20px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.06)]'
                    : 'bg-[#1C1C1F] border-white/[0.08] shadow-[0_6px_20px_rgba(0,0,0,0.5),0_1px_2px_rgba(0,0,0,0.3)]'}`}
            >
                <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-text-tertiary">{t('Regenerate as')}</p>
                {options.map((opt, i) => {
                    const gated = needsPro.has(opt.id);
                    return (
                        <button
                            key={opt.id}
                            ref={(el) => { itemRefs.current[i] = el; }}
                            type="button"
                            role="menuitemradio"
                            aria-checked={opt.current}
                            tabIndex={-1}
                            // A template marked "Needs Natively Pro" stays pickable: after
                            // buying Pro or starting a trial it simply works, and main
                            // checks again either way (notesTemplateGate.ts).
                            onClick={() => { close(true); if (!opt.current) onPick(opt); }}
                            className={`w-full min-h-[26px] flex items-center gap-2 pl-2.5 pr-2 py-1 rounded-[5px] text-left text-[12px] font-medium focus-visible:outline-none transition-colors ${opt.current
                                ? 'text-text-primary'
                                : 'text-text-secondary hover:text-text-primary focus-visible:text-text-primary'} ${isLight
                                ? 'hover:bg-black/[0.05] focus-visible:bg-black/[0.05]'
                                : 'hover:bg-white/[0.06] focus-visible:bg-white/[0.06]'}`}
                        >
                            <span className="flex-1 min-w-0 truncate">{opt.name}</span>
                            {gated && <span className="shrink-0 text-[11px] text-text-tertiary">{t('Needs Natively Pro')}</span>}
                            {opt.current && <Check className="w-3 h-3 shrink-0 opacity-70" strokeWidth={2.5} aria-hidden="true" />}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
