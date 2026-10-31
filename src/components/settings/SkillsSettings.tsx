import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n';
import { AnimatePresence } from 'framer-motion';
import {
    AlertCircle,
    Check,
    FileCode,
    FileUp,
    FolderOpen,
    Loader2,
    ScrollText,
    Trash2,
    Upload,
} from 'lucide-react';
import type {
    SkillSummary,
    SkillUploadPayload,
    SkillUploadPreview,
    UploadSkillOutcome,
} from '../../types/electron';
import { LiquidGlassButton } from '../../ui-components/LiquidGlassButton';
import {
    Collapse,
    CollapseItem,
    Presence,
    SETTINGS_BTN,
    SETTINGS_BTN_BASE,
    SETTINGS_CARD,
    SettingsFootnote,
    SettingsMotionReady,
    SettingsNotice,
    SettingsRow,
    SettingsSectionHeading,
    SwapLabel,
    useMotionReadyAfter,
    useSettingsTones,
    useSettledFlag,
} from './SettingsRow';

// Cap on the instructions preview length shown in the confirm card. The main
// process may also truncate (DEFAULT_MAX_INSTRUCTIONS_PREVIEW=280), but the
// renderer enforces a softer visual cap so the card stays compact.
const RENDER_PREVIEW_MAX = 200;

// `Skills IPC bridge not detected` is the canonical bridge-missing error
// message — see SkillsIpcWiring.test.mjs for the regression that locked it in.
const BRIDGE_MISSING_MSG = 'Skills IPC bridge not detected on window.electronAPI — preload may be missing.';

const formatBytes = (n: number): string => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
};

// Convert a single File into the (path, contentBase64) tuple the validator
// expects. We always base64-encode (never raw text) so binary files
// (references, assets) round-trip safely.
const readFileAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
        reader.onload = () => {
            const result = reader.result as ArrayBuffer;
            // ArrayBuffer → base64 in chunks to avoid `btoa` blowing the call
            // stack on multi-MB inputs.
            const bytes = new Uint8Array(result);
            const chunk = 0x8000;
            let binary = '';
            for (let i = 0; i < bytes.length; i += chunk) {
                binary += String.fromCharCode.apply(
                    null,
                    Array.from(bytes.subarray(i, i + chunk)),
                );
            }
            resolve(btoa(binary));
        };
        reader.readAsArrayBuffer(file);
    });

const buildFilePayload = async (file: File): Promise<SkillUploadPayload> => ({
    kind: 'file',
    filename: file.name,
    contentBase64: await readFileAsBase64(file),
});

export const SkillsSettings: React.FC = () => {
    const t = useT();
    const [skills, setSkills] = useState<SkillSummary[]>([]);
    const [, setLoading] = useState(false);
    // First list landed. Until then nothing moves (rows that arrive over IPC
    // must not grow in as the pane opens), and the count / empty state stay
    // up through every later Refresh instead of blinking out with `loading`.
    const [loadedOnce, setLoadedOnce] = useState(false);
    const motionReady = useMotionReadyAfter(loadedOnce);
    const tones = useSettingsTones();
    const [status, setStatus] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [preview, setPreview] = useState<{
        payload: SkillUploadPayload;
        preview: SkillUploadPreview;
    } | null>(null);
    const [installing, setInstalling] = useState(false);
    const [uploading, setUploading] = useState(false);
    // Per-skill in-flight tracking for delete. A Set (not boolean) so each
    // row can independently be "currently mutating" — without this,
    // double-clicking Delete fires two concurrent rmSyncs.
    const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
    // Inline two-step confirmation state. Track the single row currently
    // waiting for a confirm/cancel rather than a per-row boolean — only one
    // row can ever be in confirm-mode at once (clicking another row's trash
    // moves the focus, doesn't stack). null = no row awaiting confirmation.
    const [confirmingId, setConfirmingId] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    // Only an upload that runs long enough to notice swaps the icon for a spinner.
    const uploadingShown = useSettledFlag(uploading);
    // Counter for dragenter/dragleave. A simple boolean flag would flicker
    // every time the cursor crossed a child boundary inside the card (icon,
    // heading, button) — those boundaries DO fire dragleave. Tracking the
    // depth via a counter means we only clear the highlight when the cursor
    // has fully exited the entire card.
    const dragDepthRef = useRef(0);
    // Upload is a real <button>, so it cannot rely on a wrapping <label> to
    // open the picker — an interactive descendant suppresses the label's
    // activation behaviour. It drives the input directly instead.
    const uploadInputRef = useRef<HTMLInputElement | null>(null);
    // Set once Open folder has shown the folder. There is no Refresh button:
    // the list re-reads the folder when the window gets focus back, which is
    // when a skill dropped in from Finder or Explorer can have arrived.
    const folderOpenedRef = useRef(false);

    const loadSkills = useCallback(async () => {
        setLoading(true);
        try {
            if (typeof window.electronAPI?.skillsRefresh !== 'function') {
                setStatus(BRIDGE_MISSING_MSG);
                setSkills([]);
                return;
            }
            const list = await window.electronAPI.skillsRefresh();
            setSkills(Array.isArray(list) ? list : []);
            setStatus(null);
        } catch (error: any) {
            setStatus(error?.message || 'Could not load skills.');
        } finally {
            setLoading(false);
            setLoadedOnce(true);
        }
    }, []);

    // Tiny helper for set-(Set<string>) with one new value — used by the
    // delete handler to flip the in-flight bit. Functional update so
    // concurrent setter calls don't clobber each other.
    const markInFlight = (
        setter: React.Dispatch<React.SetStateAction<Set<string>>>,
        id: string,
        inFlight: boolean,
    ) => setter(prev => {
        const next = new Set(prev);
        if (inFlight) next.add(id);
        else next.delete(id);
        return next;
    });

    useEffect(() => {
        loadSkills();
    }, [loadSkills]);

    useEffect(() => {
        const onFocus = () => {
            if (folderOpenedRef.current) void loadSkills();
        };
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [loadSkills]);

    // Auto-cancel the inline confirm state after 6s of inactivity so a stale
    // "Delete / Cancel" affordance never lingers if the user gets distracted
    // mid-click. The cleanup function cancels the timer if the user clicks
    // again (or commits the delete) before the timeout fires, so a fast user
    // never sees the row snap out of confirm-mode unexpectedly.
    useEffect(() => {
        if (confirmingId === null) return;
        const timer = window.setTimeout(() => setConfirmingId(null), 6000);
        return () => window.clearTimeout(timer);
    }, [confirmingId]);

    // Escape dismisses the inline confirm — mirrors the keyboard convention
    // every other modal/popover in this app follows. Listener is attached
    // only while a row is in confirm-mode so we don't add a global keydown
    // when nothing else needs it.
    useEffect(() => {
        if (confirmingId === null) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                setConfirmingId(null);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [confirmingId]);
    const openFolder = async () => {
        try {
            if (typeof window.electronAPI?.skillsOpenFolder !== 'function') {
                setStatus(BRIDGE_MISSING_MSG);
                return;
            }
            const result = await window.electronAPI.skillsOpenFolder();
            if (result?.success) folderOpenedRef.current = true;
            if (!result?.success && result?.error) setStatus(result.error);
        } catch (error: any) {
            setStatus(error?.message || 'Could not open skills folder.');
        }
    };

    // Shared upload runner used by both stages of the upload flow:
    //   - handleFilePicked → runUpload(payload, false) for the preview
    //     card (autoInstall:false → uploader returns stage:'validated')
    //   - handleInstall → runUpload(preview.payload, true) to commit
    //     (autoInstall:true → uploader returns stage:'installed')
    //
    // On any outcome other than 'failed', the status banner is cleared.
    // On 'failed', the first error is surfaced in the status banner AND
    // the preview card is preserved (if present) so the user can see
    // "what they tried" alongside "why it failed". On unexpected stages
    // (anything other than validated/installed/failed) we log + surface
    // a generic error rather than failing silently — see handleInstall
    // for the defensive always-refresh list behavior.
    const runUpload = useCallback(
        async (payload: SkillUploadPayload, autoInstall: boolean): Promise<UploadSkillOutcome | null> => {
            if (typeof window.electronAPI?.skillsUpload !== 'function') {
                setStatus(BRIDGE_MISSING_MSG);
                return null;
            }
            try {
                const outcome = await window.electronAPI.skillsUpload(payload, { autoInstall });
                if (outcome?.stage === 'failed') {
                    const first = outcome.errors?.[0];
                    setStatus(
                        // The validator's own sentence, without its field and
                        // code in brackets in front ("description/missing_description").
                        first?.message
                            ? `Couldn't add this skill. ${first.message}`
                            : "Couldn't add this skill.",
                    );
                    // The validator may still return a preview even on failure
                    // (e.g. install-time error after a successful validate) —
                    // keep the preview card visible so the user can see
                    // "what they tried" alongside "why it failed".
                    if (outcome.preview) {
                        setPreview({ payload, preview: outcome.preview });
                    }
                } else {
                    setStatus(null);
                }
                return outcome ?? null;
            } catch (error: any) {
                setStatus(error?.message || 'Upload failed.');
                return null;
            }
        },
        [],
    );

    const handleFilePicked = async (file: File) => {
        setUploading(true);
        setSuccess(null);
        try {
            const payload = await buildFilePayload(file);
            const outcome = await runUpload(payload, false);
            if (outcome?.stage === 'validated') {
                setPreview({ payload, preview: outcome.preview });
            }
        } finally {
            setUploading(false);
        }
    };

    // Upload asks main for the file. A picker opened from this page's
    // <input type="file"> bypasses the dialog wrapper that keeps pickers out of
    // screen capture in Undetectable mode; main's goes through it. The hidden
    // input stays only for an older main process without skills:pick-file.
    const pickingRef = useRef(false);
    const pickAndUpload = async () => {
        const pick = window.electronAPI?.skillsPickFile;
        if (typeof pick !== 'function') {
            uploadInputRef.current?.click();
            return;
        }
        // One picker at a time: `uploading` only covers the upload, not the
        // time the picker is open, so a second click would open a second one.
        if (pickingRef.current) return;
        pickingRef.current = true;
        let picked: Awaited<ReturnType<typeof pick>>;
        try {
            picked = await pick();
        } catch (e: any) {
            picked = { canceled: false, error: e?.message };
        } finally {
            pickingRef.current = false;
        }
        if (picked.canceled) return;
        if (!picked.payload) {
            setSuccess(null);
            setPreview(null);
            setStatus(picked.error || t('Could not read that file.'));
            return;
        }
        setUploading(true);
        setSuccess(null);
        try {
            const outcome = await runUpload(picked.payload, false);
            if (outcome?.stage === 'validated') {
                setPreview({ payload: picked.payload, preview: outcome.preview });
            }
        } finally {
            setUploading(false);
        }
    };

    // Drag-and-drop handler. v1: only FILE drops are accepted via drag-drop.
    // Folder drops (which would need a recursive FileSystemDirectoryEntry walk)
    // are NOT supported here — users wanting to install a folder of files
    // should use Open folder and drop the folder in with the OS file manager
    // manually into the OS file explorer. This avoids the complexity of
    // async-recursive DataTransferItem traversal in the renderer.
    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (typeof window.electronAPI?.skillsUpload !== 'function') {
            setStatus(BRIDGE_MISSING_MSG);
            return;
        }
        const items = e.dataTransfer?.items;
        if (!items || items.length === 0) return;

        const fileItems: File[] = [];
        let sawDirectory = false;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind !== 'file') continue;
            const entry = item.webkitGetAsEntry?.();
            if (entry?.isDirectory) {
                sawDirectory = true;
                continue; // skip directories in v1
            }
            const file = item.getAsFile();
            if (file) fileItems.push(file);
        }
        if (sawDirectory) {
            setStatus(
                'A folder can’t be dropped here. Use Open folder and put the skill folder in it.',
            );
        }
        if (fileItems.length === 0) return;

        if (fileItems.length > 1) {
            setStatus(
                `Only one .md file can be uploaded at a time (got ${fileItems.length}). Pick a single SKILL.md file.`,
            );
            return;
        }

        setUploading(true);
        setSuccess(null);
        try {
            await handleFilePicked(fileItems[0]);
        } finally {
            setUploading(false);
        }
    };

    const handleInstall = async () => {
        if (!preview) return;
        setInstalling(true);
        setSuccess(null);
        try {
            const outcome = await runUpload(preview.payload, true);
            if (outcome?.stage === 'installed') {
                setSuccess(`Installed "${outcome.preview.name}" to ${outcome.installedPath}`);
            } else if (outcome?.stage === 'failed') {
                // runUpload already surfaced the error via setStatus; we just
                // refresh the list in case the install partially landed.
            } else {
                // Defensive: log unexpected stages so a future regression
                // (e.g. opts being dropped on the IPC boundary) is visible.
                // Also surface a banner so the user is never silently stuck.
                setStatus(
                    `Install returned unexpected stage '${outcome?.stage ?? 'undefined'}'. ` +
                    `Check the console for details.`,
                );
                // eslint-disable-next-line no-console
                console.warn('[SkillsSettings] unexpected upload outcome:', outcome);
            }
            // ALWAYS refresh the skills list after an install attempt — even
            // on failure or unexpected stages — so a partial install on disk
            // shows up in the UI, and so the user can see the new state
            // immediately after clicking Install.
            setPreview(null);
            await loadSkills();
        } finally {
            setInstalling(false);
        }
    };

    const handleCancel = () => {
        setPreview(null);
        setStatus(null);
    };

    // Two-step delete flow. First click on the trash icon enters confirm-mode
    // for that row (no destructive call yet) — `requestDeleteSkill`. Second
    // click on the inline "Delete" button (the red one) actually invokes
    // `skillsDelete` — `commitDeleteSkill`. Built-ins don't render a trash
    // icon at all (gated in the row JSX below) so this handler only runs
    // for user-installed skills. The previous version raised a native browser
    // dialog — that modal froze the renderer, broke the panel's visual
    // language, and made the destructive action feel larger than it actually
    // is (the original SKILL.md file is still on disk and can be re-uploaded,
    // so this is reversible — the phrasing "cannot be undone" was misleading).
    const requestDeleteSkill = (id: string) => {
        if (deletingIds.has(id)) return; // already deleting — ignore
        setSuccess(null);
        setStatus(null);
        // Move the confirm focus to the row that was clicked. If the user
        // clicks a different row's trash, that row becomes the active one
        // instead of stacking — there is at most one confirm-mode row at a
        // time, which matches the user's mental model ("I am confirming ONE
        // thing") and avoids the `Multiple confirms on screen` confusion that
        // per-row booleans invite.
        setConfirmingId((prev) => (prev === id ? null : id));
    };

    const commitDeleteSkill = async (id: string, name: string) => {
        if (typeof window.electronAPI?.skillsDelete !== 'function') {
            setStatus(BRIDGE_MISSING_MSG);
            setConfirmingId(null);
            return;
        }
        if (deletingIds.has(id)) return;
        // Clear the confirm-mode immediately — the row is now deleting and
        // we want to show the spinner / restoring muted state, not the
        // confirm UI. If the delete fails, the row will already be reloaded
        // and the user can re-click trash to retry.
        setConfirmingId(null);
        // Banner hygiene: clear BOTH success and status so a stale red banner
        // from a prior action doesn't linger above a fresh green one.
        setSuccess(null);
        setStatus(null);
        markInFlight(setDeletingIds, id, true);
        try {
            const result = await window.electronAPI.skillsDelete(id);
            if (result?.success) {
                setSuccess(`Deleted "${name}".`);
                await loadSkills();
            } else {
                setStatus(result?.error || 'Could not delete skill.');
            }
        } catch (error: any) {
            setStatus(error?.message || 'Could not delete skill.');
        } finally {
            markInFlight(setDeletingIds, id, false);
        }
    };

    // Truncate the instructions preview to RENDER_PREVIEW_MAX chars + ellipsis.
    // Main process already does this at 280, but the renderer enforces a
    // tighter cap so the confirm card never wraps to 6+ lines.
    const truncate = (s: string, n: number) =>
        s.length <= n ? s : `${s.slice(0, n).trimEnd()}…`;

    // The drop handlers, on the whole section: all of Skills is the target.
    const dropTarget = {
        onDragEnter: (e: React.DragEvent) => {
            e.preventDefault();
            if (dragDepthRef.current === 0) setIsDragging(true);
            dragDepthRef.current += 1;
        },
        onDragOver: (e: React.DragEvent) => e.preventDefault(),
        onDragLeave: () => {
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
            if (dragDepthRef.current === 0) setIsDragging(false);
        },
        onDrop: (e: React.DragEvent) => {
            dragDepthRef.current = 0;
            setIsDragging(false);
            handleDrop(e);
        },
    };

    return (
        <SettingsMotionReady.Provider value={motionReady}>
        {/* A section of Settings › Intelligence, laid out as the other tabs lay out
            a section: the heading, with Open folder and Upload beside it (they act
            on the whole list, as Overlay's Reset sits beside its heading), then
            the rows. The whole section is the drop target, and a frosted veil
            says so while a file is over it. The preview and the notices open
            between the heading and the list. The page owns the entrance fade
            and the stagger, so this root carries neither. */}
        <div className="relative select-text" {...dropTarget}>
            <div aria-hidden={!isDragging} data-open={isDragging} className="settings-drop-veil text-sm font-semibold">
                <FileUp size={18} />
                {t('Drop to add this skill')}
            </div>

            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <SettingsSectionHeading
                        title={t('Skills')}
                        subtitle={t('Instructions the chat follows. Start a message with /name or $name to use one.')}
                    />
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <button type="button" className={SETTINGS_BTN} onClick={() => { void openFolder(); }}>
                        <FolderOpen size={14} />
                        {t('Open folder')}
                    </button>
                    <button
                        type="button"
                        className={SETTINGS_BTN}
                        disabled={uploading}
                        onClick={() => { void pickAndUpload(); }}
                    >
                        <Presence kind="icon" id={uploadingShown ? 'busy' : 'idle'}>
                            {uploadingShown ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                        </Presence>
                        {t('Upload')}
                    </button>
                </div>
            </div>

            <input
                ref={uploadInputRef}
                type="file"
                accept=".md,text/markdown"
                className="hidden"
                onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) await handleFilePicked(f);
                    e.currentTarget.value = ''; // allow re-pick of same file
                }}
                disabled={uploading}
            />

            {/* What the file holds, before anything is written to disk. */}
            <Collapse open={!!preview}>
                <div className="pt-1.5 pb-2">
                    {preview && (
                        <div className={`${SETTINGS_CARD} p-4 space-y-3`}>
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 min-w-0">
                                    <h4 className="text-sm font-bold text-text-primary truncate">{preview.preview.name}</h4>
                                    <span className="text-[11px] font-mono text-text-tertiary shrink-0">/{preview.preview.id}</span>
                                </div>
                                {preview.preview.description && (
                                    <p className="text-xs text-text-secondary mt-0.5">{preview.preview.description}</p>
                                )}
                            </div>

                            {preview.preview.instructionsPreview && (
                                <pre className="rounded-lg bg-bg-input border border-border-subtle px-3 py-2 text-[11px] font-mono text-text-secondary whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                                    {truncate(preview.preview.instructionsPreview, RENDER_PREVIEW_MAX)}
                                </pre>
                            )}

                            {/* One quiet line of what else came with it; a kind it has none of is left out. */}
                            <p className="text-[11px] text-text-tertiary">
                                {[
                                    ...([
                                        [preview.preview.referenceCount, t('reference'), t('references')],
                                        [preview.preview.assetCount, t('asset'), t('assets')],
                                        [preview.preview.scriptCount, t('script'), t('scripts')],
                                        [preview.preview.otherCount, t('other file'), t('other files')],
                                    ] as const)
                                        .filter(([n]) => n > 0)
                                        .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`),
                                    formatBytes(preview.preview.totalBytes),
                                ].join(' · ')}
                            </p>

                            {preview.preview.fileTree.length > 0 && (
                                <details className="text-[11px] text-text-tertiary">
                                    <summary className="cursor-pointer hover:text-text-secondary transition-colors">
                                        {preview.preview.fileTree.length} {t('files')}
                                    </summary>
                                    <ul className="mt-2 font-mono space-y-0.5 max-h-32 overflow-y-auto">
                                        {preview.preview.fileTree.map((p) => (
                                            <li key={p} className="truncate">{p}</li>
                                        ))}
                                    </ul>
                                </details>
                            )}

                            <div className="flex items-center justify-end gap-2">
                                <button type="button" className={SETTINGS_BTN} onClick={handleCancel} disabled={installing}>
                                    {t('Cancel')}
                                </button>
                                <LiquidGlassButton
                                    variant="action"
                                    className="lg-sm"
                                    onClick={() => { void handleInstall(); }}
                                    disabled={installing}
                                >
                                    <SwapLabel id={installing ? 'installing' : 'install'} sizers={[t('Install'), t('Installing…')]}>
                                        {installing ? t('Installing…') : t('Install')}
                                    </SwapLabel>
                                </LiquidGlassButton>
                            </div>
                        </div>
                    )}
                </div>
            </Collapse>

            <Collapse open={!!success}>
                <div className="pt-1.5 pb-2">
                    <SettingsNotice tone={tones.ok} icon={<Check size={14} />} className="">
                        {success}
                    </SettingsNotice>
                </div>
            </Collapse>

            <Collapse open={!!status}>
                <div className="pt-1.5 pb-2">
                    <SettingsNotice tone={tones.danger} icon={<AlertCircle size={14} />} alert shakeKey={status ?? ''} className="">
                        {status}
                    </SettingsNotice>
                </div>
            </Collapse>

            <AnimatePresence initial={false}>
                {skills.map((skill) => {
                    const deleting = deletingIds.has(skill.id);
                    const confirming = confirmingId === skill.id;
                    return (
                        <CollapseItem key={skill.id}>
                            <div
                                className={`transition-opacity duration-150 ease-out ${deleting ? 'opacity-60' : ''}`}
                                aria-busy={deleting || undefined}
                            >
                                <SettingsRow
                                    icon={<ScrollText size={20} />}
                                    title={skill.name}
                                    truncateTitle
                                    badge={<span className="text-[11px] font-mono text-text-tertiary">/{skill.id}</span>}
                                    description={skill.description ? <span className="line-clamp-2">{skill.description}</span> : undefined}
                                    // Built-ins have no delete: SkillsManager would refuse it.
                                    control={skill.source !== 'builtin' ? (
                                        // The delete button and its confirm are one slot that changes identity.
                                        <Presence kind="control" id={confirming ? 'confirm' : 'idle'}>
                                            {confirming ? (
                                                <div
                                                    role="group"
                                                    aria-live="polite"
                                                    aria-label={`Confirm delete ${skill.name}`}
                                                    className="flex items-center gap-2"
                                                >
                                                    <button
                                                        autoFocus
                                                        type="button"
                                                        className={SETTINGS_BTN}
                                                        onClick={() => setConfirmingId(null)}
                                                        title={t('Cancel (Escape)')}
                                                    >
                                                        {t('Cancel')}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={`${SETTINGS_BTN_BASE} hover:bg-red-500/15 ${tones.danger}`}
                                                        onClick={() => { void commitDeleteSkill(skill.id, skill.name); }}
                                                        disabled={deleting}
                                                        title={t('Delete this skill')}
                                                    >
                                                        <Trash2 size={14} />
                                                        {t('Delete')}
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    type="button"
                                                    className={`${SETTINGS_BTN} !px-2`}
                                                    onClick={() => requestDeleteSkill(skill.id)}
                                                    disabled={deleting}
                                                    title={t('Delete skill')}
                                                    aria-label={`Delete ${skill.name}`}
                                                >
                                                    <Presence kind="icon" id={deleting ? 'busy' : 'idle'}>
                                                        {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                                    </Presence>
                                                </button>
                                            )}
                                        </Presence>
                                    ) : undefined}
                                />
                            </div>
                        </CollapseItem>
                    );
                })}
            </AnimatePresence>

            {loadedOnce && skills.length === 0 && (
                <SettingsRow
                    icon={<FileCode size={20} />}
                    title={t('No skills yet')}
                    description={t('Upload a SKILL.md, or drop one here.')}
                />
            )}

            <SettingsFootnote icon={<FileUp size={14} />}>
                {t('Drop a SKILL.md on this section to add it. Built-in skills can’t be deleted.')}
            </SettingsFootnote>
        </div>
        </SettingsMotionReady.Provider>
    );
};

export default SkillsSettings;
