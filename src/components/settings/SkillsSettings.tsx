import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n';
import {
    Check,
    CheckCircle,
    FileCode,
    FileUp,
    FolderOpen,
    RefreshCw,
    Trash2,
    X,
} from 'lucide-react';
import type {
    SkillSummary,
    SkillUploadPayload,
    SkillUploadPreview,
    UploadSkillOutcome,
} from '../../types/electron';

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
    const [skillsPath, setSkillsPath] = useState<string>('');
    const [loading, setLoading] = useState(false);
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
    // Counter for dragenter/dragleave. A simple boolean flag would flicker
    // every time the cursor crossed a child boundary inside the card (icon,
    // heading, button) — those boundaries DO fire dragleave. Tracking the
    // depth via a counter means we only clear the highlight when the cursor
    // has fully exited the entire card.
    const dragDepthRef = useRef(0);
    const [showAdvanced, setShowAdvanced] = useState(false);

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
            if (result?.path) setSkillsPath(result.path);
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
                        first?.message
                            ? `Upload failed (${first.field}/${first.code}): ${first.message}`
                            : 'Upload failed for an unknown reason.',
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

    // Drag-and-drop handler. v1: only FILE drops are accepted via drag-drop.
    // Folder drops (which would need a recursive FileSystemDirectoryEntry walk)
    // are NOT supported here — users wanting to install a folder of files
    // should use the Advanced "open skills folder" escape hatch and drop files
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
                'Folder drag-and-drop is not supported — use the Advanced "open skills folder" option to drop a folder manually.',
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

    return (
        <div className="space-y-5 animated fadeIn select-text pb-4">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h3 className="text-lg font-bold text-text-primary mb-1">{t('Skills')}</h3>
                    <p className="text-xs text-text-secondary">
                        {t('Local SKILL.md instructions. Invoke a skill in the overlay chat by typing /skill-name or $skill-name at the start of your message.')}
                    </p>
                </div>
                <button
                    onClick={loadSkills}
                    disabled={loading}
                    className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-border-subtle bg-bg-subtle/30 hover:bg-bg-subtle transition-all duration-200 text-xs font-medium text-text-secondary hover:text-text-primary active:scale-95 mt-1 disabled:opacity-60"
                >
                    <RefreshCw size={13} strokeWidth={2.5} className={loading ? 'animate-spin' : ''} />
                    {t('Refresh')}
                </button>
            </div>

            {/* Upload card — drop target. Mirrors the Advanced "Skills Folder"
                card layout for visual consistency: icon + heading on the
                left, action button on the right, description below. */}
            <div
                onDragOver={(e) => {
                    e.preventDefault();
                    if (dragDepthRef.current === 0) setIsDragging(true);
                    dragDepthRef.current += 1;
                }}
                onDragLeave={() => {
                    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
                    if (dragDepthRef.current === 0) setIsDragging(false);
                }}
                onDrop={(e) => {
                    dragDepthRef.current = 0;
                    setIsDragging(false);
                    handleDrop(e);
                }}
                className={[
                    'rounded-xl border transition-colors p-4 bg-bg-card',
                    isDragging
                        ? 'border-accent-primary bg-accent-primary/5'
                        : 'border-dashed border-border-subtle hover:border-accent-primary/40',
                ].join(' ')}
            >
                <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                            <FileUp size={15} className="text-text-secondary" />
                            <h4 className="text-sm font-semibold text-text-primary">{t('Upload skill')}</h4>
                        </div>
                        <p className="text-xs text-text-secondary">
                            {t('Drop a SKILL.md file here, or click Upload to pick one. For folders, use the Advanced option below.')}
                        </p>
                        {uploading && (
                            <p className="text-[11px] text-text-tertiary animate-pulse mt-2">{t('Uploading…')}</p>
                        )}
                    </div>
                    <label className="cursor-pointer shrink-0">
                        <input
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
                        <span
                            className={[
                                'inline-flex items-center px-4 py-2 rounded-lg text-xs font-semibold transition-colors shrink-0',
                                'bg-accent-primary hover:bg-accent-primary/90 text-white',
                                uploading ? 'opacity-60 pointer-events-none' : '',
                            ].join(' ')}
                        >
                            {t('Upload')}
                        </span>
                    </label>
                </div>
            </div>

            {/* Preview card — shown when validate-only succeeded. */}
            {preview && (
                <div className="bg-bg-card rounded-xl border border-border-subtle p-4 space-y-3">
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                                <CheckCircle size={14} className="text-green-500 shrink-0" />
                                <h4 className="text-sm font-semibold text-text-primary truncate">
                                    {preview.preview.name}
                                </h4>
                                <span className="px-1.5 py-0.5 rounded-md border border-border-subtle bg-bg-input text-[10px] text-text-tertiary shrink-0">
                                    {preview.preview.id}
                                </span>
                            </div>
                            <p className="text-xs text-text-secondary leading-relaxed">
                                {preview.preview.description}
                            </p>
                        </div>
                    </div>

                    {preview.preview.instructionsPreview && (
                        <pre className="rounded-lg bg-bg-input border border-border-subtle px-3 py-2 text-[11px] font-mono text-text-secondary whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                            {truncate(preview.preview.instructionsPreview, RENDER_PREVIEW_MAX)}
                        </pre>
                    )}

                    <div className="flex items-center gap-3 flex-wrap text-[11px] text-text-tertiary">
                        <span>
                            <span className="text-text-secondary font-medium">{preview.preview.referenceCount}</span> {t('reference')}
                        </span>
                        <span>
                            <span className="text-text-secondary font-medium">{preview.preview.assetCount}</span> {t('asset')}
                        </span>
                        <span>
                            <span className="text-text-secondary font-medium">{preview.preview.scriptCount}</span> {t('script')}
                        </span>
                        {preview.preview.otherCount > 0 && (
                            <span>
                                <span className="text-text-secondary font-medium">{preview.preview.otherCount}</span> {t('other')}
                            </span>
                        )}
                        <span className="ml-auto font-mono">
                            {formatBytes(preview.preview.totalBytes)}
                        </span>
                    </div>

                    {preview.preview.fileTree.length > 0 && (
                        <details className="text-[11px] text-text-tertiary">
                            <summary className="cursor-pointer hover:text-text-secondary">
                                {preview.preview.fileTree.length} {t('files')}
                            </summary>
                            <ul className="mt-2 font-mono space-y-0.5 max-h-32 overflow-y-auto">
                                {preview.preview.fileTree.map((p) => (
                                    <li key={p} className="truncate">
                                        {p}
                                    </li>
                                ))}
                            </ul>
                        </details>
                    )}

                    <div className="flex items-center gap-2 pt-1">
                        <button
                            onClick={handleInstall}
                            disabled={installing}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary hover:bg-accent-primary/90 text-white text-xs font-semibold transition-colors disabled:opacity-60"
                        >
                            <Check size={13} strokeWidth={2.5} />
                            {installing ? t('Installing…') : t('Install')}
                        </button>
                        <button
                            onClick={handleCancel}
                            disabled={installing}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border-subtle bg-bg-input hover:bg-bg-elevated text-xs font-medium text-text-secondary transition-colors disabled:opacity-60"
                        >
                            <X size={13} strokeWidth={2.5} />
                            {t('Cancel')}
                        </button>
                    </div>
                </div>
            )}

            {success && (
                <div className="rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs text-green-400">
                    {success}
                </div>
            )}

            {status && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                    {status}
                </div>
            )}

            <div>
                <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                        {t('Installed skills')}
                    </h4>
                    {!loading && skills.length > 0 && (
                        <span className="text-[11px] text-text-tertiary">
                            {skills.length} {skills.length === 1 ? t('skill') : t('skills')}
                        </span>
                    )}
                </div>
                <div className="space-y-1.5">
                    {skills.map((skill) => (
                        <div
                            key={skill.id}
                            className="group bg-bg-card rounded-lg border border-border-subtle px-3 py-2.5 hover:border-border-muted transition-colors"
                        >
                            <div className="flex items-center justify-between gap-3">
                                {/* Left side: [Name] [/id] — name + slug only.
                                    Built-in vs Local is no longer distinguished
                                    visually per-row (user requested removal of
                                    the badge). Source classification still
                                    drives whether the delete affordance
                                    renders — built-ins have no delete button
                                    because SkillsManager would refuse the call. */}
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-sm font-medium text-text-primary truncate">
                                        {skill.name}
                                    </span>
                                    <span className="text-[10px] font-mono text-text-tertiary shrink-0">
                                        /{skill.id}
                                    </span>
                                </div>
                                {/* Right side: delete affordance only (no badge).
                                    Built-ins render nothing here; user-installed
                                    skills render the trash icon (hover-reveal
                                    via the MeetingDetails.tsx:696 idiom) or the
                                    inline 2-step confirm after first click. The
                                    delete affordance itself does NOT need a
                                    fixed-width wrapper anymore — the natural
                                    button width is stable and there's no badge
                                    to anchor to. */}
                                <div className="flex items-center gap-1 shrink-0">
                                    {skill.source !== 'builtin' && (
                                        confirmingId === skill.id ? (
                                            <div
                                                role="group"
                                                aria-live="polite"
                                                aria-label={`Confirm delete ${skill.name}`}
                                                className="flex items-center gap-2 select-none"
                                            >
                                                <span className="text-[11px] text-text-secondary hidden sm:inline">
                                                    {t('Delete')} <span className="font-medium text-text-primary">{skill.name}</span>?
                                                </span>
                                                <button
                                                    onClick={() => setConfirmingId(null)}
                                                    className="px-2.5 py-1 rounded-md border border-border-subtle bg-bg-input text-text-secondary text-[11px] font-medium hover:bg-bg-elevated hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-border-muted transition-colors"
                                                    title={t("Cancel (Escape)")}
                                                >
                                                    {t('Cancel')}
                                                </button>
                                                <button
                                                    onClick={() => commitDeleteSkill(skill.id, skill.name)}
                                                    disabled={deletingIds.has(skill.id)}
                                                    className="px-2.5 py-1 rounded-md bg-red-500 text-white text-[11px] font-semibold hover:bg-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                                                    title={t("Delete this skill")}
                                                >
                                                    {deletingIds.has(skill.id) ? t('Deleting…') : t('Delete')}
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-1 opacity-0 translate-y-1 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-hover:translate-y-0 group-focus-within:opacity-100 group-focus-within:translate-y-0 [@media(hover:none)]:opacity-100 transition-all duration-[160ms] ease-out select-none">
                                                <button
                                                    onClick={() => requestDeleteSkill(skill.id)}
                                                    disabled={deletingIds.has(skill.id)}
                                                    className="p-1.5 rounded-lg text-text-secondary hover:text-red-400 hover:bg-red-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                                                    title={t("Delete skill")}
                                                    aria-label={`Delete ${skill.name}`}
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        )
                                    )}
                                </div>
                            </div>
                            {skill.description && (
                                <p className="text-[11px] text-text-secondary mt-1 ml-5 leading-snug line-clamp-2">
                                    {skill.description}
                                </p>
                            )}
                        </div>
                    ))}

                    {!loading && skills.length === 0 && (
                        <div className="bg-bg-card rounded-lg border border-dashed border-border-subtle p-5 text-center">
                            <FileCode size={18} className="mx-auto mb-1.5 text-text-tertiary" />
                            <p className="text-xs font-medium text-text-primary">{t('No skills installed')}</p>
                            <p className="text-[11px] text-text-secondary mt-0.5">
                                {t('Upload a SKILL.md above, or use the Advanced option.')}
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Advanced escape hatch — preserved from the pre-upload UI so
                power users can still drop files directly into the folder. */}
            <div className="pt-1">
                <button
                    onClick={() => setShowAdvanced((s) => !s)}
                    className="text-xs font-semibold uppercase tracking-wider text-text-tertiary hover:text-text-secondary transition-colors"
                >
                    {showAdvanced ? '▾' : '▸'} {t('Advanced: open skills folder')}
                </button>
                {showAdvanced && (
                    <div className="mt-2 bg-bg-card rounded-xl border border-border-subtle p-4">
                        <div className="flex items-center justify-between gap-4">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <FolderOpen size={15} className="text-text-secondary" />
                                    <h4 className="text-sm font-semibold text-text-primary">{t('Skills Folder')}</h4>
                                </div>
                                <p className="text-xs text-text-secondary">
                                    {t('Manually drop a folder containing SKILL.md here. Used as a fallback for non-upload workflows.')}
                                </p>
                                {skillsPath && (
                                    <p className="mt-2 text-[11px] text-text-tertiary font-mono truncate">{skillsPath}</p>
                                )}
                            </div>
                            <button
                                onClick={openFolder}
                                className="px-4 py-2 rounded-lg bg-accent-primary hover:bg-accent-primary/90 text-white text-xs font-semibold transition-colors shrink-0"
                            >
                                {t('Open Folder')}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SkillsSettings;
