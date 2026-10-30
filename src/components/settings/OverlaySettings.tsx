// Settings › Overlay: the meeting overlay itself (OverlayMockup) with its row
// of five buttons, a tray of the other buttons under it, the Meeting Interface
// Style picker (moved from General's advanced settings) and Interface Opacity
// (moved from General). Buttons are dragged to reorder the row or dropped on
// one in the other group to swap them; the result is saved through
// overlayButtonOrder.ts, which every window follows.
//
// A switcher at the top (2026-10-20) picks what every meeting opens
// (utils/meetingSurface.ts): the Natively overlay (all of the above) or the
// Natively notepad (the notes window, drawn here by NotesWindow itself with
// sample notes), and the page shows that one.
//
// The preview is scaled to fit the page (the overlay card is 600px, the page
// column narrower), so dragging is done by hand rather than with Framer's
// Reorder: the pointer is turned into the preview's own pixels by the scale,
// and buttons slide to their new places with a FLIP transform.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { AppWindow, ChevronDown, Layout, Monitor, NotebookPen, RotateCcw } from 'lucide-react';
import NotesWindow, { type NotesWindowPreview } from '../NotesWindow';
import { useT } from '../../i18n';
import type { MeetingInterfaceTheme } from '../../lib/meetingInterfaceTheme';
import type { OverlayAppearance } from '../../lib/overlayAppearance';
import {
    DEFAULT_OVERLAY_BUTTON_ORDER,
    OVERLAY_ROW_SIZE,
    moveOverlayButton,
    sameOverlayButtonOrder,
    setOverlayButtonOrder,
    swapOverlayButtons,
    useOverlayButtonOrder,
    type OverlayButtonId,
} from '../../lib/overlayButtonOrder';
import { OVERLAY_BUTTONS } from '../overlay/overlayButtons';
import { OverlayChipContent, OverlayMockup, overlayChipClass, useOverlayAppearance } from './OverlayMockup';
import { Presence, SETTINGS_CARD, SettingsMenu, SettingsRow, SettingsSectionHeading } from './SettingsRow';

/** The overlay card's width (OverlayMockup's w-[600px]); the preview scales it down to the page. */
const MOCKUP_WIDTH = 600;
const SLIDE = 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)';
const LIFT = 'scale(1.05)';

const THEMES: { mode: MeetingInterfaceTheme; label: string; description: string }[] = [
    { mode: 'default', label: 'Default', description: 'Default overlay appearance' },
    { mode: 'liquid-glass', label: 'Liquid Glass', description: 'Liquid glass — Apple-inspired transparent overlay' },
    { mode: 'modern', label: 'Modern', description: 'Modern — polished dark glass with cobalt accents' },
    { mode: 'lavender', label: 'Lavender', description: 'Lavender — white glass with lavender buttons, as on the website' },
];

type Drag = {
    id: OverlayButtonId;
    pointerId: number;
    /** Where the pointer went down, and is now (client pixels). */
    startX: number;
    startY: number;
    x: number;
    y: number;
    /** The chip's layout box at the start, unscaled pixels from its parent. */
    homeLeft: number;
};

/**
 * The row and the tray as one editor: the full order, the drag, the drop
 * target, and the FLIP slide. `scale` is the preview's.
 */
function useButtonEditor(scale: number) {
    const reduce = useReducedMotion() ?? false;
    const saved = useOverlayButtonOrder();
    const [order, setOrder] = useState<OverlayButtonId[]>(saved);
    const [dragId, setDragId] = useState<OverlayButtonId | null>(null);
    const [targetId, setTargetId] = useState<OverlayButtonId | null>(null);
    const chips = useRef(new Map<OverlayButtonId, HTMLElement>());
    const drag = useRef<Drag | null>(null);
    // Every chip's on-screen box before an order change, for the FLIP slide.
    const before = useRef<Map<OverlayButtonId, DOMRect> | null>(null);
    const s = scale || 1;

    const inRow = (id: OverlayButtonId, o = order) => o.indexOf(id) < OVERLAY_ROW_SIZE;

    // Another window (or Reset) changed the order: follow it, unless a drag is on.
    useEffect(() => {
        if (!drag.current && !sameOverlayButtonOrder(saved, order)) {
            remember();
            setOrder(saved);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [saved]);

    const remember = () => {
        const map = new Map<OverlayButtonId, DOMRect>();
        chips.current.forEach((el, id) => map.set(id, el.getBoundingClientRect()));
        before.current = map;
    };

    // The dragged chip under the pointer, from wherever its place now is.
    const placeDragged = () => {
        const d = drag.current;
        const el = d ? chips.current.get(d.id) : undefined;
        if (!d || !el) return;
        const shift = el.offsetLeft - d.homeLeft;
        el.style.transition = 'none';
        el.style.transform = `translate(${(d.x - d.startX) / s - shift}px, ${(d.y - d.startY) / s}px) ${LIFT}`;
    };

    useLayoutEffect(() => {
        const prev = before.current;
        before.current = null;
        if (prev) {
            chips.current.forEach((el, id) => {
                if (id === drag.current?.id) return;
                const was = prev.get(id);
                if (!was || reduce) {
                    el.style.transform = '';
                    return;
                }
                const now = el.getBoundingClientRect();
                const dx = (was.left - now.left) / s;
                const dy = (was.top - now.top) / s;
                if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
                el.style.transition = 'none';
                el.style.transform = `translate(${dx}px, ${dy}px)`;
                void el.offsetWidth;
                el.style.transition = SLIDE;
                el.style.transform = '';
            });
        }
        placeDragged();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [order]);

    const commit = (next: OverlayButtonId[]) => {
        remember();
        setOrder(next);
        if (!sameOverlayButtonOrder(next, saved)) setOverlayButtonOrder(next);
    };

    // A chip of the other group under the pointer: the drop that swaps.
    const targetAt = (x: number, y: number, d: Drag): OverlayButtonId | null => {
        for (const el of document.elementsFromPoint(x, y)) {
            const id = (el as HTMLElement).closest?.('[data-overlay-button]')?.getAttribute('data-overlay-button') as OverlayButtonId | null;
            if (id && id !== d.id && chips.current.has(id)) return inRow(id) !== inRow(d.id) ? id : null;
        }
        return null;
    };

    const onPointerDown = (id: OverlayButtonId) => (e: React.PointerEvent<HTMLElement>) => {
        if (e.button !== 0 || drag.current) return;
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        drag.current = { id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, homeLeft: el.offsetLeft };
        setDragId(id);
        placeDragged();
    };

    const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
        const d = drag.current;
        if (!d || e.pointerId !== d.pointerId) return;
        d.x = e.clientX;
        d.y = e.clientY;
        const el = chips.current.get(d.id);
        if (!el) return;
        const target = targetAt(e.clientX, e.clientY, d);
        setTargetId(target);
        // Within the row, a chip whose middle passes a neighbour's swaps with
        // it as it goes. One swap a move; a fast drag catches up next move.
        if (!target && inRow(d.id)) {
            const middle = d.homeLeft + (d.x - d.startX) / s + el.offsetWidth / 2;
            const i = order.indexOf(d.id);
            const right = i + 1 < OVERLAY_ROW_SIZE ? chips.current.get(order[i + 1]) : undefined;
            const left = i > 0 ? chips.current.get(order[i - 1]) : undefined;
            const step = right && middle > right.offsetLeft + right.offsetWidth / 2 ? 1
                : left && middle < left.offsetLeft + left.offsetWidth / 2 ? -1
                    : 0;
            if (step) {
                remember();
                setOrder(moveOverlayButton(order, d.id, step));
                return;
            }
        }
        placeDragged();
    };

    const endDrag = (e: React.PointerEvent<HTMLElement>) => {
        const d = drag.current;
        if (!d || e.pointerId !== d.pointerId) return;
        const target = e.type === 'pointercancel' ? null : targetAt(e.clientX, e.clientY, d);
        drag.current = null;
        setDragId(null);
        setTargetId(null);
        if (target) {
            // Both chips change groups (and so elements): FLIP every chip from
            // where it is on screen now, the dragged one included.
            commit(swapOverlayButtons(order, d.id, target));
            return;
        }
        const el = chips.current.get(d.id);
        if (el) {
            el.style.transition = reduce ? 'none' : SLIDE;
            el.style.transform = '';
        }
        if (!sameOverlayButtonOrder(order, saved)) setOverlayButtonOrder(order);
    };

    // Arrows: left and right move a chip within its group; up and down trade it
    // with the chip in the same place in the other group.
    const onKeyDown = (id: OverlayButtonId) => (e: React.KeyboardEvent<HTMLElement>) => {
        const i = order.indexOf(id);
        let next: OverlayButtonId[] | null = null;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            next = moveOverlayButton(order, id, e.key === 'ArrowLeft' ? -1 : 1);
        } else if ((e.key === 'ArrowDown' && inRow(id)) || (e.key === 'ArrowUp' && !inRow(id))) {
            const trayCount = order.length - OVERLAY_ROW_SIZE;
            const other = inRow(id)
                ? order[OVERLAY_ROW_SIZE + Math.min(i, trayCount - 1)]
                : order[Math.min(i - OVERLAY_ROW_SIZE, OVERLAY_ROW_SIZE - 1)];
            if (other) next = swapOverlayButtons(order, id, other);
        }
        if (!next) return;
        e.preventDefault();
        if (!sameOverlayButtonOrder(next, order)) {
            commit(next);
            requestAnimationFrame(() => chips.current.get(id)?.focus());
        }
    };

    const chipProps = (id: OverlayButtonId, label: string) => ({
        ref: (el: HTMLElement | null) => { if (el) chips.current.set(id, el); else chips.current.delete(id); },
        'data-overlay-button': id,
        role: 'listitem',
        tabIndex: 0,
        'aria-label': label,
        onPointerDown: onPointerDown(id),
        onPointerMove,
        onPointerUp: endDrag,
        onPointerCancel: endDrag,
        onKeyDown: onKeyDown(id),
    });

    return { order, dragId, targetId, chipProps };
}

type Editor = ReturnType<typeof useButtonEditor>;

/** One draggable button, drawn as the overlay draws it. */
const EditorChip: React.FC<{ id: OverlayButtonId; editor: Editor; appearance: OverlayAppearance; label: string; theme: MeetingInterfaceTheme }> = ({ id, editor, appearance, label, theme }) => {
    const dragging = editor.dragId === id;
    const target = editor.targetId === id;
    return (
        <div
            {...editor.chipProps(id, label)}
            className={`${overlayChipClass(id, theme)} relative select-none touch-none ${dragging ? 'z-20 cursor-grabbing' : 'cursor-grab'}`}
            style={{
                ...appearance.chipStyle,
                ...(dragging ? { boxShadow: '0 8px 20px rgba(0,0,0,0.22)' } : null),
                // The chip a drop would swap with: faded under the dragged one
                // (chip surfaces are translucent, so its label would show
                // through) and ringed in the overlay's own text colour.
                ...(target ? { outline: '1.5px solid currentColor', outlineOffset: 2, opacity: 0.35 } : null),
            }}
        >
            <OverlayChipContent id={id} theme={theme} />
        </div>
    );
};

/** The overlay, scaled to the page's width and centred, with the tray under it. */
const Preview: React.FC<{ opacity: number; theme: MeetingInterfaceTheme }> = ({ opacity, theme }) => {
    const t = useT();
    const stageRef = useRef<HTMLDivElement>(null);
    const innerRef = useRef<HTMLDivElement>(null);
    const [fit, setFit] = useState({ scale: 1, height: 0 });
    const editor = useButtonEditor(fit.scale);
    const appearance = useOverlayAppearance(opacity, theme);
    const row = editor.order.slice(0, OVERLAY_ROW_SIZE);
    const tray = editor.order.slice(OVERLAY_ROW_SIZE);
    const isGlassTheme = theme === 'liquid-glass';
    const label = (id: OverlayButtonId, place: string) => `${t(OVERLAY_BUTTONS[id].label)}, ${place}`;

    useLayoutEffect(() => {
        const stage = stageRef.current;
        const inner = innerRef.current;
        if (!stage || !inner || typeof ResizeObserver === 'undefined') return;
        const measure = () => {
            const room = stage.clientWidth - 48;
            const scale = Math.min(1, room / MOCKUP_WIDTH);
            const height = inner.offsetHeight * scale;
            setFit((f) => (Math.abs(f.scale - scale) < 0.001 && Math.abs(f.height - height) < 0.5 ? f : { scale, height }));
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(stage);
        ro.observe(inner);
        return () => ro.disconnect();
    }, []);

    return (
        <div ref={stageRef} className="natively-key-card rounded-xl border border-border-subtle bg-bg-item-surface py-6 overflow-hidden">
            {/* items-start: a stretched inner box would be measured at the
                wrapper's (scaled) height and shrink itself every frame. */}
            <div style={{ height: fit.height || undefined }} className="flex items-start justify-center">
                <div ref={innerRef} style={{ width: MOCKUP_WIDTH, transform: `scale(${fit.scale})`, transformOrigin: 'top center' }} className="shrink-0">
                    <OverlayMockup
                        opacity={opacity}
                        theme={theme}
                        quickActions={() => (
                            <div role="list" aria-label={t('Overlay buttons')} className="relative flex flex-nowrap justify-center items-center gap-1.5 px-4 pb-3 pt-3">
                                {row.map((id, i) => (
                                    <EditorChip key={id} id={id} editor={editor} appearance={appearance} theme={theme} label={label(id, `${i + 1} / ${OVERLAY_ROW_SIZE}`)} />
                                ))}
                            </div>
                        )}
                    />
                    {/* The tray: the buttons the overlay is not showing, on a
                        small panel of the overlay's own surface. */}
                    <div
                        data-interface-theme={theme}
                        style={{ ['--overlay-opacity' as '--overlay-opacity']: String(opacity) } as React.CSSProperties}
                        className="mt-4 flex justify-center"
                    >
                        <div
                            role="list"
                            aria-label={t('More buttons')}
                            className="flex flex-wrap justify-center items-center gap-1.5 rounded-[18px] border px-3 py-2.5 overlay-shell-surface overlay-text-primary backdrop-blur-2xl"
                            style={appearance.shellStyle}
                        >
                            {tray.map((id) => (
                                <EditorChip key={id} id={id} editor={editor} appearance={appearance} theme={theme} label={label(id, t('in the tray'))} />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const StylePicker: React.FC<{ theme: MeetingInterfaceTheme; onChange: (theme: MeetingInterfaceTheme) => void }> = ({ theme, onChange }) => {
    const t = useT();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const current = THEMES.find((o) => o.mode === theme) ?? THEMES[0];

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        // Capture + stopPropagation, so Escape closes the menu and never reaches
        // the window-level Escape that closes all of Settings.
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            setOpen(false);
            ref.current?.querySelector('button')?.focus();
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey, true);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey, true);
        };
    }, [open]);

    return (
        <div className="relative" ref={ref}>
            {/* Centred like Language's picker: two spacers share the free
                space, and the right one holds the chevron. */}
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className="bg-bg-component hover:bg-bg-elevated border border-border-subtle text-text-primary px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center min-w-[105px]"
            >
                <span aria-hidden="true" className="flex-1 basis-0 min-w-0" />
                <span className="min-w-0 text-ellipsis overflow-hidden whitespace-nowrap">
                    <Presence kind="text" id={theme}>{t(current.label)}</Presence>
                </span>
                <span aria-hidden="true" className="flex-1 basis-0 min-w-[20px] flex justify-end">
                    <ChevronDown size={12} className={`shrink-0 transition-transform duration-[250ms] ease-sculpted motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
                </span>
            </button>
            <SettingsMenu open={open} origin="top right" className="absolute right-0 top-full mt-1 min-w-full w-max bg-bg-elevated border border-border-subtle rounded-lg shadow-xl overflow-hidden z-20 p-1 select-none">
                {THEMES.map((option) => (
                    <button
                        key={option.mode}
                        type="button"
                        onClick={() => {
                            onChange(option.mode);
                            setOpen(false);
                        }}
                        className={`w-full text-center px-2.5 py-1.5 rounded-md text-xs flex items-center justify-center transition-colors ${theme === option.mode ? 'text-text-primary bg-[color:color-mix(in_srgb,var(--bg-item-active)_50%,transparent)]' : 'text-text-secondary hover:bg-bg-input hover:text-text-primary'}`}
                    >
                        <span className="font-medium">{t(option.label)}</span>
                    </button>
                ))}
            </SettingsMenu>
        </div>
    );
};

type Surface = 'overlay' | 'notepad';
const SURFACES: { id: Surface; label: string; Icon: typeof AppWindow }[] = [
    { id: 'overlay', label: 'Natively overlay', Icon: AppWindow },
    { id: 'notepad', label: 'Natively notepad', Icon: NotebookPen },
];
/**
 * What meetings open, saved in main and read at every meeting start. Shown
 * first, then saved; a refused write puts the switch back.
 */
function useMeetingSurface(): [Surface | null, (next: Surface) => void] {
    const [surface, setSurface] = useState<Surface | null>(null);
    useEffect(() => {
        let live = true;
        window.electronAPI?.getMeetingSurface?.()
            .then((value) => { if (live) setSurface(value === 'notepad' ? 'notepad' : 'overlay'); })
            .catch(() => { if (live) setSurface('overlay'); });
        return () => { live = false; };
    }, []);
    const choose = (next: Surface) => {
        const was = surface;
        if (was === null || was === next) return;
        setSurface(next);
        window.electronAPI?.setMeetingSurface?.(next)
            .then((r) => { if (!r?.success) setSurface(was); })
            .catch(() => setSurface(was));
    };
    return [surface, choose];
}

/** Overlay | Notepad, centred at the top: a track with a pill that slides to the chosen side. */
const SurfaceSwitch: React.FC<{ value: Surface; onChange: (s: Surface) => void; disabled?: boolean }> = ({ value, onChange, disabled }) => {
    const t = useT();
    const reduceMotion = useReducedMotion();
    const index = Math.max(0, SURFACES.findIndex((o) => o.id === value));
    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const next = SURFACES[(index + (e.key === 'ArrowRight' ? 1 : SURFACES.length - 1)) % SURFACES.length].id;
        onChange(next);
        (e.currentTarget.querySelector(`[data-surface="${next}"]`) as HTMLElement | null)?.focus();
    };
    return (
        <div className="flex justify-center">
            <div
                role="radiogroup"
                aria-label={t('What meetings open')}
                onKeyDown={onKeyDown}
                className="relative grid grid-cols-2 p-1 rounded-full border border-border-subtle bg-bg-input"
            >
                <motion.div
                    aria-hidden="true"
                    className="absolute top-1 bottom-1 left-1 rounded-full bg-bg-elevated border border-border-subtle shadow-sm"
                    style={{ width: 'calc(50% - 4px)' }}
                    initial={false}
                    animate={{ x: `${index * 100}%` }}
                    transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 30 }}
                />
                {SURFACES.map(({ id, label, Icon }) => (
                    <button
                        key={id}
                        type="button"
                        role="radio"
                        data-surface={id}
                        aria-checked={value === id}
                        disabled={disabled}
                        tabIndex={value === id ? 0 : -1}
                        onClick={() => onChange(id)}
                        className={`relative z-10 flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors duration-200 ${value === id ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
                    >
                        <Icon size={13} strokeWidth={1.75} aria-hidden="true" /> {t(label)}
                    </button>
                ))}
            </div>
        </div>
    );
};

/** Sample notes for the notepad's preview. */
const NOTEPAD_SAMPLE: NotesWindowPreview = {
    title: 'Weekly product sync',
    people: 4,
    text: '# Launch\n- Beta goes out Thursday\n- Docs page still needs screenshots\n\n# Next steps\n- Maya drafts the release note\n- ',
};
/** The notes window's first-open width (notesWindowPolicy's NOTES_WINDOW_DEFAULT_SIZE) and a tall height, scaled down. */
const NOTEPAD_PREVIEW = { width: 460, height: 780, scale: 0.6 } as const;

/** The notepad as it opens: the real page, on its own window frame. */
const NotepadPreview: React.FC = () => (
    <div className="natively-key-card rounded-xl border border-border-subtle bg-bg-item-surface py-6 flex justify-center overflow-hidden">
        <div style={{ width: NOTEPAD_PREVIEW.width * NOTEPAD_PREVIEW.scale, height: NOTEPAD_PREVIEW.height * NOTEPAD_PREVIEW.scale }} className="shrink-0">
            <div
                style={{ width: NOTEPAD_PREVIEW.width, height: NOTEPAD_PREVIEW.height, transform: `scale(${NOTEPAD_PREVIEW.scale})`, transformOrigin: 'top left' }}
                className="rounded-[16px] overflow-hidden border border-border-subtle shadow-xl"
            >
                <NotesWindow preview={NOTEPAD_SAMPLE} />
            </div>
        </div>
    </div>
);

type ScreenshotDisplay = { id: number; number: number; name: string; width: number; height: number; primary: boolean };

/**
 * Which screen the screenshot shortcut captures (electron/screenshotDisplay.ts).
 * Shown only with more than one screen. The list is re-read when the menu
 * opens, so a monitor plugged in since Settings opened is there.
 */
const ScreenshotScreenRow: React.FC = () => {
    const t = useT();
    const [preference, setPreference] = useState('overlay');
    const [displays, setDisplays] = useState<ScreenshotDisplay[]>([]);
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    const load = () => {
        window.electronAPI?.getScreenshotDisplay?.()
            .then((res) => {
                if (!res) return;
                setPreference(res.preference);
                setDisplays(res.displays);
            })
            .catch(() => { /* keeps the last list */ });
    };
    useEffect(load, []);
    useEffect(() => { if (open) load(); }, [open]);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        // Escape closes the menu, never all of Settings (as in StylePicker).
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            setOpen(false);
            ref.current?.querySelector('button')?.focus();
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey, true);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey, true);
        };
    }, [open]);

    if (displays.length < 2) return null;

    const screenLabel = (d: ScreenshotDisplay) => {
        const detail = d.name || `${d.width}×${d.height}`;
        return `${t('Screen')} ${d.number} · ${detail}${d.primary ? ` (${t('main')})` : ''}`;
    };
    const options = [
        { value: 'overlay', label: t("The overlay's screen") },
        { value: 'cursor', label: t('The screen under the mouse') },
        ...displays.map((d) => ({ value: `display:${d.id}`, label: screenLabel(d) })),
    ];
    // A saved screen that is unplugged reads as the default, which is what a
    // screenshot then captures (resolveScreenshotDisplay).
    const current = options.find((o) => o.value === preference) ?? options[0];

    const choose = (value: string) => {
        setOpen(false);
        const previous = preference;
        setPreference(value);
        window.electronAPI?.setScreenshotDisplay?.(value)
            .then((res) => { if (!res?.success) setPreference(previous); })
            .catch(() => setPreference(previous));
    };

    return (
        <div className={SETTINGS_CARD}>
            <SettingsRow
                icon={<Monitor size={20} />}
                title={t('Screenshot screen')}
                description={t('Which screen the screenshot shortcut captures. In an area screenshot, a click captures the whole screen you click on.')}
                control={
                    <div className="relative" ref={ref}>
                        <button
                            type="button"
                            onClick={() => setOpen((o) => !o)}
                            aria-expanded={open}
                            className="bg-bg-component hover:bg-bg-elevated border border-border-subtle text-text-primary px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 max-w-[220px]"
                        >
                            <span className="min-w-0 text-ellipsis overflow-hidden whitespace-nowrap">
                                <Presence kind="text" id={current.value}>{current.label}</Presence>
                            </span>
                            <ChevronDown size={12} className={`shrink-0 transition-transform duration-[250ms] ease-sculpted motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
                        </button>
                        <SettingsMenu open={open} origin="top right" role="listbox" ariaLabel={t('Screenshot screen')} className="absolute right-0 top-full mt-1 min-w-full w-max max-w-[320px] bg-bg-elevated border border-border-subtle rounded-lg shadow-xl overflow-hidden z-20 p-1 select-none">
                            {options.map((option) => (
                                <button
                                    key={option.value}
                                    type="button"
                                    role="option"
                                    aria-selected={current.value === option.value}
                                    onClick={() => choose(option.value)}
                                    className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs flex items-center transition-colors ${current.value === option.value ? 'text-text-primary bg-[color:color-mix(in_srgb,var(--bg-item-active)_50%,transparent)]' : 'text-text-secondary hover:bg-bg-input hover:text-text-primary'}`}
                                >
                                    <span className="font-medium truncate">{option.label}</span>
                                </button>
                            ))}
                        </SettingsMenu>
                    </div>
                }
            />
        </div>
    );
};

export const OverlaySettings: React.FC<{
    opacity: number;
    theme: MeetingInterfaceTheme;
    onThemeChange: (theme: MeetingInterfaceTheme) => void;
    /** Interface Opacity, built by SettingsOverlay (its hold-to-preview is Settings' own state). */
    opacityControl?: React.ReactNode;
}> = ({ opacity, theme, onThemeChange, opacityControl }) => {
    const t = useT();
    const saved = useOverlayButtonOrder();
    const isDefaultOrder = sameOverlayButtonOrder(saved, DEFAULT_OVERLAY_BUTTON_ORDER);
    const style = THEMES.find((o) => o.mode === theme) ?? THEMES[0];
    const [surface, setSurface] = useMeetingSurface();
    const switcher = <SurfaceSwitch value={surface ?? 'overlay'} onChange={setSurface} disabled={surface === null} />;

    if (surface === 'notepad') {
        return (
            <div className="space-y-6 animated fadeIn" data-settings-stagger>
                {switcher}
                <section>
                    <SettingsSectionHeading
                        title={t('Meeting notepad')}
                        subtitle={t('Your meetings open this notepad on the right of the screen, without the overlay. Write notes, see the transcript, or ask anything. It follows Undetectable, like the overlay.')}
                    />
                    <NotepadPreview />
                </section>
                <ScreenshotScreenRow />
            </div>
        );
    }

    return (
        <div className="space-y-6 animated fadeIn" data-settings-stagger>
            {switcher}
            <section>
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <SettingsSectionHeading
                            title={t('Meeting overlay')}
                            subtitle={t('Your meetings show the top row. Drag to reorder, or swap one in from the tray.')}
                        />
                    </div>
                    {!isDefaultOrder && (
                        <button
                            type="button"
                            onClick={() => setOverlayButtonOrder(DEFAULT_OVERLAY_BUTTON_ORDER)}
                            className="mt-1 flex shrink-0 items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
                        >
                            <RotateCcw size={12} /> {t('Reset order')}
                        </button>
                    )}
                </div>
                <Preview opacity={opacity} theme={theme} />
            </section>

            <div className={SETTINGS_CARD}>
                <SettingsRow
                    icon={<Layout size={20} />}
                    title={t('Meeting Interface Style')}
                    description={t(style.description)}
                    descriptionKey={theme}
                    control={<StylePicker theme={theme} onChange={onThemeChange} />}
                />
            </div>

            {opacityControl}

            <ScreenshotScreenRow />
        </div>
    );
};
