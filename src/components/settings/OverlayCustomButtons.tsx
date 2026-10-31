// Settings › Overlay › Your buttons (2026-10-30): the user's own overlay
// buttons (lib/overlayCustomButtons.ts). Each has a name of at most ten
// characters, a description in plain sentences under the parts Natively's
// own buttons are written in (what it does, what to read, how the answer
// looks, what never to do, what to say when there is nothing), and a switch
// that takes a screenshot at every press. Saving has a model rewrite the
// description into the button's contract (electron/llm/customButtons.ts),
// shown under the description when the button is opened again. A new button
// joins the tray of the preview above; it is dragged into the row like any
// built-in one.
//
// Drawn like the Modes Manager's Real-time prompt (premium/src/ModesSettings):
// a 15px bold label over a 12px hairline box, the text borderless inside it,
// and a footer under a hairline with a quiet Save on the right that dims
// until there is something to save. The hairline is the Manager's own (10%
// of the text colour): Settings' --border-subtle is transparent in dark.
//
// Motion is Settings' own vocabulary (SettingsRow.tsx), so nothing here moves
// unlike the panes around it. The list, the empty box and the editor fold in
// and out by height (CollapseItem), so the Overlay card below glides instead
// of jumping; "How Natively runs it" folds the same way; the helper line and
// the Save label are text swaps in a box sized to their longest state; the
// "New" button is a control swap. Every change answers a click, so the whole
// section is motion-ready from the start (AnimatePresence initial={false}
// keeps the first paint still).
import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Camera, Plus, Trash2 } from 'lucide-react';
import { useT } from '../../i18n';
import {
    OVERLAY_CUSTOM_MAX,
    OVERLAY_CUSTOM_NAME_MAX,
    OVERLAY_CUSTOM_PROMPT_MAX,
    OVERLAY_CUSTOM_PROMPT_TEMPLATE,
    OVERLAY_CUSTOM_READ_MAX_MINUTES,
    cleanOverlayCustomName,
    getOverlayCustomButtons,
    overlayCustomDraftProblem as draftProblem,
    overlayCustomReadMinutes,
    overlayCustomSummary,
    nameLength,
    newOverlayCustomButtonId,
    setOverlayCustomButtons,
    useOverlayCustomButtons,
    type OverlayCustomButton,
    type OverlayCustomButtonId,
} from '../../lib/overlayCustomButtons';
import { OVERLAY_CUSTOM_BUTTON_ICON } from '../overlay/overlayButtons';
import { Collapse, CollapseItem, Presence, SettingsMotionReady, SettingsSectionHeading, SettingsSwitch, SwapLabel } from './SettingsRow';

/** `instruction` is the contract written from `savedPrompt`; it is shown while the description still reads that way. */
type Draft = { id: OverlayCustomButtonId | null; name: string; prompt: string; screenshot: boolean; instruction: string; savedPrompt: string };

const EMPTY_DRAFT: Draft = { id: null, name: '', prompt: OVERLAY_CUSTOM_PROMPT_TEMPLATE, screenshot: false, instruction: '', savedPrompt: '' };

const draftOf = (b: OverlayCustomButton): Draft => ({
    id: b.id, name: b.name, prompt: b.prompt, screenshot: b.screenshot, instruction: b.instruction, savedPrompt: b.prompt,
});

/** A name typed or pasted, cut to the limit by characters (an emoji is one). */
const capName = (value: string) => Array.from(value).slice(0, OVERLAY_CUSTOM_NAME_MAX).join('');

// The Modes Manager's surfaces, in Settings' tokens.
const HAIRLINE = 'border-[color:color-mix(in_srgb,var(--text-primary)_10%,transparent)]';
// The surface of the Overlay tab's other cards (SETTINGS_CARD): near-white in
// light, the lifted grey in dark, so this section reads as one of them.
const BOX = `rounded-xl border border-border-subtle bg-bg-card transition-[border-color,background-color] duration-200 ease-out`;
const BOX_FOCUS = 'focus-within:border-[color:color-mix(in_srgb,var(--accent-primary)_38%,transparent)]';
const LABEL = 'text-[15px] font-bold leading-[1.2] tracking-[-0.02em] text-text-primary mb-2.5';
/** Real-time prompt's Save: a small quiet rectangle that dims while disabled. */
const QUIET_BTN = `px-3 py-1 rounded-full border ${HAIRLINE} bg-[color:color-mix(in_srgb,var(--text-primary)_5%,transparent)] text-xs font-medium text-text-primary transition-[background-color,opacity,transform] duration-150 ease-out hover:bg-[color:color-mix(in_srgb,var(--text-primary)_10%,transparent)] active:scale-[0.97] disabled:opacity-35 disabled:hover:bg-[color:color-mix(in_srgb,var(--text-primary)_5%,transparent)] disabled:active:scale-100 disabled:cursor-default motion-reduce:active:scale-100`;
const TEXT_BTN = 'text-xs text-text-tertiary hover:text-text-primary transition-colors duration-150';
// "Writing…" shimmers while the model works (transitions.dev shimmer text,
// index.css .t-shimmer), in Settings' inks so it follows the theme.
const SHIMMER_VARS = {
    '--shimmer-dur': '2000ms',
    '--shimmer-base': 'var(--text-tertiary)',
    '--shimmer-highlight': 'var(--text-primary)',
    '--shimmer-band': '400%',
    '--shimmer-ease': 'linear',
} as React.CSSProperties;

const Editor: React.FC<{
    draft: Draft;
    saving: boolean;
    onChange: (draft: Draft) => void;
    onSave: () => void;
    onCancel: () => void;
}> = ({ draft, saving, onChange, onSave, onCancel }) => {
    const t = useT();
    const nameRef = useRef<HTMLInputElement>(null);
    const used = nameLength(draft.name);
    const problem = draftProblem(draft);
    const isNew = draft.id === null;
    const contract = draft.instruction && draft.prompt.trim() === draft.savedPrompt ? draft.instruction : '';
    // The fold keeps showing the contract it had while it closes.
    const lastContract = useRef(contract);
    if (contract) lastContract.current = contract;
    // How far back a press reads, from the "What to read" line (the press sends
    // the same number). In the footer, so it follows the line as it is typed.
    const readMinutes = overlayCustomReadMinutes(draft.prompt);
    const readSpan = readMinutes === 1
        ? t('Reads the last minute')
        : readMinutes === OVERLAY_CUSTOM_READ_MAX_MINUTES
            ? t('Reads the last hour')
            : t('Reads the last {{n}} minutes').replace('{{n}}', String(readMinutes));
    const saveLabel = isNew ? t('Add') : t('Save');
    const hintSaving = t('Natively is turning your lines into a button, the way its own buttons are written.');
    const hintTask = t('Say what the button gives you after "What it does:".');
    const hintIdle = t('Answer each line in a plain sentence. Natively turns it into a button when you save.');
    const hintId = saving ? 'saving' : problem === 'task' ? 'task' : 'idle';

    // preventScroll: the editor is still folding open from zero height, and a
    // plain focus() would scroll Settings to the field mid-fold.
    useEffect(() => {
        nameRef.current?.focus({ preventScroll: true });
    }, []);

    // Escape cancels the editor and never reaches the window-level Escape
    // that closes all of Settings; Cmd/Ctrl+Enter saves.
    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            e.preventDefault();
            onCancel();
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !problem && !saving) {
            e.preventDefault();
            onSave();
        }
    };

    return (
        <div onKeyDown={onKeyDown}>
            <h4 className={LABEL}>{t('Name')}</h4>
            <div className={`${BOX} ${BOX_FOCUS} flex items-center`}>
                <input
                    ref={nameRef}
                    type="text"
                    spellCheck={false}
                    autoComplete="off"
                    aria-describedby="custom-button-name-count"
                    className="flex-1 min-w-0 bg-transparent border-none outline-none px-4 py-3 text-xs text-text-primary placeholder:text-text-tertiary"
                    placeholder={t('What the button says, like Rephrase')}
                    value={draft.name}
                    onChange={(e) => onChange({ ...draft, name: capName(e.target.value) })}
                />
                <span
                    id="custom-button-name-count"
                    className={`pr-4 text-[11px] tabular-nums transition-colors ${used >= OVERLAY_CUSTOM_NAME_MAX ? 'text-text-secondary' : 'text-text-tertiary'}`}
                >
                    {used}/{OVERLAY_CUSTOM_NAME_MAX}
                </span>
            </div>

            <h4 className={`${LABEL} mt-6`}>{t('Describe it')}</h4>
            <div className={`${BOX} ${BOX_FOCUS} flex flex-col overflow-hidden`}>
                <textarea
                    spellCheck={false}
                    maxLength={OVERLAY_CUSTOM_PROMPT_MAX}
                    readOnly={saving}
                    aria-label={t('Describe it')}
                    className={`w-full min-h-[150px] flex-1 resize-none bg-transparent border-none outline-none px-4 py-3.5 text-xs leading-[1.6] text-text-primary placeholder:text-text-tertiary transition-opacity duration-150 ease-out ${saving ? 'opacity-60' : ''}`}
                    value={draft.prompt}
                    onChange={(e) => onChange({ ...draft, prompt: e.target.value })}
                />
                <div className={`flex items-center gap-3 px-3 py-2.5 border-t ${HAIRLINE}`}>
                    <div className="flex items-center gap-2 pl-1 min-w-0 flex-1">
                        <SettingsSwitch
                            checked={draft.screenshot}
                            onChange={() => onChange({ ...draft, screenshot: !draft.screenshot })}
                            label={t('Screenshot every press')}
                        />
                        <span className="text-xs text-text-secondary truncate">{t('Screenshot every press')}</span>
                    </div>
                    <span className="shrink-0 text-xs text-text-tertiary tabular-nums" aria-live="polite">
                        <Presence kind="text" id={String(readMinutes)}>{readSpan}</Presence>
                    </span>
                    <button type="button" onClick={onCancel} className={`${TEXT_BTN} px-1`}>
                        {t('Cancel')}
                    </button>
                    {/* disabled:opacity-35 would dim "Writing…" into the shimmer's
                        base ink; while saving the button stays at full strength. */}
                    <button type="button" onClick={onSave} disabled={!!problem || saving} aria-busy={saving} className={`${QUIET_BTN} ${saving ? 'disabled:opacity-100' : ''}`}>
                        <SwapLabel id={saving ? 'writing' : 'save'} sizers={[saveLabel, t('Writing…')]}>
                            {saving ? (
                                <span className="t-shimmer" data-text={t('Writing…')} style={SHIMMER_VARS}>{t('Writing…')}</span>
                            ) : saveLabel}
                        </SwapLabel>
                    </button>
                </div>
            </div>
            {/* Every line it can show sits invisibly in one cell, so the box
                keeps the tallest one's height and the swap never moves what is
                under it. */}
            <div className="mt-2 px-1 grid text-xs leading-relaxed text-text-tertiary">
                {[hintSaving, hintTask, hintIdle].map((line) => (
                    <span key={line} aria-hidden="true" className="invisible col-start-1 row-start-1">{line}</span>
                ))}
                <span className="col-start-1 row-start-1" aria-live="polite">
                    <Presence kind="text" id={hintId} block>
                        {hintId === 'saving' ? hintSaving : hintId === 'task' ? hintTask : hintIdle}
                    </Presence>
                </span>
            </div>
            {/* Leaves as soon as a line changes (it no longer describes what
                will run) and comes back after the save writes a new one. The gap
                is padding inside the fold, so it goes with it. */}
            <Collapse open={!!contract}>
                <div className="pt-6">
                    <h4 className={LABEL}>{t('How Natively runs it')}</h4>
                    <p className={`${BOX} px-4 py-3.5 text-xs leading-[1.6] text-text-secondary select-text`}>{contract || lastContract.current}</p>
                    <p className="mt-2 px-1 text-xs leading-relaxed text-text-tertiary">
                        {t('Written from your lines. Change one and it is written again when you save.')}
                    </p>
                </div>
            </Collapse>
        </div>
    );
};

const ButtonRow: React.FC<{ button: OverlayCustomButton; onEdit: () => void; onDelete: () => void }> = ({ button, onEdit, onDelete }) => {
    const t = useT();
    const Icon = OVERLAY_CUSTOM_BUTTON_ICON;
    const task = overlayCustomSummary(button.prompt);
    return (
        <div className="group flex items-center gap-3 pr-2 transition-colors duration-150 ease-out hover:bg-[color:color-mix(in_srgb,var(--text-primary)_2%,transparent)]">
            {/* The whole row opens the editor; Delete sits outside it. */}
            <button
                type="button"
                onClick={onEdit}
                aria-label={`${t('Edit')} ${button.name}`}
                className="flex flex-1 min-w-0 items-center gap-3 pl-4 py-3 text-left transition-opacity duration-150 ease-out active:opacity-70"
            >
                <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${HAIRLINE} text-[11px] font-medium text-text-primary whitespace-nowrap shrink-0`}>
                    <Icon className="w-3 h-3 opacity-70" aria-hidden="true" /> {button.name}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">{task}</span>
                {button.screenshot && (
                    <Camera size={13} className="shrink-0 text-text-tertiary" aria-label={t('Screenshot every press')} />
                )}
            </button>
            <button
                type="button"
                onClick={onDelete}
                aria-label={`${t('Delete')} ${button.name}`}
                className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-text-tertiary hover:text-[color:var(--text-danger)] hover:bg-[color:color-mix(in_srgb,var(--text-primary)_6%,transparent)] transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.94] motion-reduce:active:scale-100"
            >
                <Trash2 size={13} />
            </button>
        </div>
    );
};

export const CustomButtonsSection: React.FC = () => {
    const t = useT();
    const buttons = useOverlayCustomButtons();
    const [draft, setDraft] = useState<Draft | null>(null);
    const [saving, setSaving] = useState(false);
    // Bumped by Cancel and by every save, so a rewrite that comes back late is dropped.
    const saveRun = useRef(0);
    const full = buttons.length >= OVERLAY_CUSTOM_MAX;

    // The button being edited was deleted in another window: close the editor.
    useEffect(() => {
        if (draft?.id && !buttons.some((b) => b.id === draft.id)) setDraft(null);
    }, [buttons, draft?.id]);

    const cancel = () => {
        saveRun.current += 1;
        setSaving(false);
        setDraft(null);
    };

    const save = async () => {
        if (!draft || draftProblem(draft) || saving) return;
        const run = ++saveRun.current;
        const name = cleanOverlayCustomName(draft.name);
        const prompt = draft.prompt.trim();
        // Unchanged lines keep the contract already written from them.
        let instruction = draft.instruction && prompt === draft.savedPrompt ? draft.instruction : '';
        if (!instruction) {
            setSaving(true);
            try {
                const result = await window.electronAPI?.compileCustomButton?.({ name, description: prompt });
                instruction = result?.instruction ?? '';
            } catch (err) {
                // Saved without one: a press then runs the lines as written.
                console.warn('[custom-button] could not write the button; saving the lines as they are:', err);
            }
            if (run !== saveRun.current) return;
            setSaving(false);
        }
        // Read again: another window may have changed the list while the rewrite ran.
        const latest = getOverlayCustomButtons();
        if (draft.id && !latest.some((b) => b.id === draft.id)) { setDraft(null); return; }
        if (!draft.id && latest.length >= OVERLAY_CUSTOM_MAX) { setDraft(null); return; }
        const next: OverlayCustomButton = {
            id: draft.id ?? newOverlayCustomButtonId(),
            name,
            prompt,
            instruction,
            screenshot: draft.screenshot,
        };
        setOverlayCustomButtons(draft.id ? latest.map((b) => (b.id === draft.id ? next : b)) : [...latest, next]);
        setDraft(null);
    };

    const startNew = () => { if (!full) setDraft({ ...EMPTY_DRAFT }); };

    return (
        <SettingsMotionReady.Provider value={true}>
        <section>
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <SettingsSectionHeading
                        title={t('Your buttons')}
                        subtitle={t('Up to 4. New ones wait in the tray above; drag them into the row.')}
                    />
                </div>
                <Presence kind="control" id={!draft && buttons.length > 0 ? 'new' : null} className="shrink-0">
                    <button type="button" onClick={startNew} disabled={full} className={`mt-1 flex items-center gap-1 ${QUIET_BTN}`}>
                        <Plus size={12} aria-hidden="true" /> {full ? t('4 of 4') : t('New')}
                    </button>
                </Presence>
            </div>

            {/* No wait mode: the outgoing state folds shut while the incoming
                one folds open, so the height moves in one stroke from the old
                to the new and the Overlay card below glides with it. Gaps are
                padding inside each fold, never margin outside it. */}
            <AnimatePresence initial={false}>
                {draft ? (
                    <CollapseItem key={`edit-${draft.id ?? 'new'}`}>
                        <div className="pt-2">
                            <Editor draft={draft} saving={saving} onChange={setDraft} onSave={() => void save()} onCancel={cancel} />
                        </div>
                    </CollapseItem>
                ) : buttons.length === 0 ? (
                    <CollapseItem key="empty">
                        <div className="pt-2">
                            {/* Empty: the Manager's empty box, which is itself the way in. */}
                            <button
                                type="button"
                                onClick={startNew}
                                className={`${BOX} w-full min-h-[76px] flex items-center justify-center gap-1.5 text-xs text-text-tertiary hover:text-text-secondary hover:bg-[color:color-mix(in_srgb,var(--text-primary)_3%,var(--bg-card))]`}
                            >
                                <Plus size={12} aria-hidden="true" /> {t('Make a button')}
                            </button>
                        </div>
                    </CollapseItem>
                ) : (
                    <CollapseItem key="list">
                        <div className="pt-2">
                            <div className={`${BOX} overflow-hidden divide-y divide-[color:color-mix(in_srgb,var(--text-primary)_8%,transparent)]`}>
                                {/* A deleted row folds away instead of vanishing. */}
                                <AnimatePresence initial={false}>
                                    {buttons.map((button) => (
                                        <CollapseItem key={button.id}>
                                            <ButtonRow
                                                button={button}
                                                onEdit={() => setDraft(draftOf(button))}
                                                onDelete={() => setOverlayCustomButtons(buttons.filter((b) => b.id !== button.id))}
                                            />
                                        </CollapseItem>
                                    ))}
                                </AnimatePresence>
                            </div>
                        </div>
                    </CollapseItem>
                )}
            </AnimatePresence>
        </section>
        </SettingsMotionReady.Provider>
    );
};
