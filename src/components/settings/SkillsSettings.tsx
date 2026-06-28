import React, { useCallback, useEffect, useState } from 'react';
import {
    Check,
    CheckCircle,
    FileCode,
    FileUp,
    FolderOpen,
    RefreshCw,
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
    const [isDragging, setIsDragging] = useState(false);
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

    useEffect(() => {
        loadSkills();
    }, [loadSkills]);

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

    // Run validate-only (autoInstall: false). The result is either a
    // 'validated' stage (we show the preview card), an 'installed' stage
    // (shouldn't happen here — autoInstall: false — but treat it as
    // success), or 'failed' (we show the first error in the status banner).
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
    // us a complete FileList in one shot. This avoids the complexity of
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

    // Truncate the instructions preview to RENDER_PREVIEW_MAX chars + ellipsis.
    // Main process already does this at 280, but the renderer enforces a
    // tighter cap so the confirm card never wraps to 6+ lines.
    const truncate = (s: string, n: number) =>
        s.length <= n ? s : `${s.slice(0, n).trimEnd()}…`;

    return (
        <div className="space-y-5 animated fadeIn select-text pb-4">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h3 className="text-lg font-bold text-text-primary mb-1">Skills</h3>
                    <p className="text-xs text-text-secondary">
                        Local SKILL.md instructions. Invoke a skill in the overlay chat by typing /skill-name or $skill-name at the start of your message.
                    </p>
                </div>
                <button
                    onClick={loadSkills}
                    disabled={loading}
                    className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-border-subtle bg-bg-subtle/30 hover:bg-bg-subtle transition-all duration-200 text-xs font-medium text-text-secondary hover:text-text-primary active:scale-95 mt-1 disabled:opacity-60"
                >
                    <RefreshCw size={13} strokeWidth={2.5} className={loading ? 'animate-spin' : ''} />
                    Refresh
                </button>
            </div>

            {/* Upload card — drop target. Mirrors the Advanced "Skills Folder"
                card layout for visual consistency: icon + heading on the
                left, action button on the right, description below. */}
            <div
                onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
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
                            <h4 className="text-sm font-semibold text-text-primary">Upload skill</h4>
                        </div>
                        <p className="text-xs text-text-secondary">
                            Drop a SKILL.md file here, or click Upload to pick one. For folders, use the Advanced option below.
                        </p>
                        {uploading && (
                            <p className="text-[11px] text-text-tertiary animate-pulse mt-2">Uploading…</p>
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
                            Upload
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
                            <span className="text-text-secondary font-medium">{preview.preview.referenceCount}</span> reference
                        </span>
                        <span>
                            <span className="text-text-secondary font-medium">{preview.preview.assetCount}</span> asset
                        </span>
                        <span>
                            <span className="text-text-secondary font-medium">{preview.preview.scriptCount}</span> script
                        </span>
                        {preview.preview.otherCount > 0 && (
                            <span>
                                <span className="text-text-secondary font-medium">{preview.preview.otherCount}</span> other
                            </span>
                        )}
                        <span className="ml-auto font-mono">
                            {formatBytes(preview.preview.totalBytes)}
                        </span>
                    </div>

                    {preview.preview.fileTree.length > 0 && (
                        <details className="text-[11px] text-text-tertiary">
                            <summary className="cursor-pointer hover:text-text-secondary">
                                {preview.preview.fileTree.length} files
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
                            {installing ? 'Installing…' : 'Install'}
                        </button>
                        <button
                            onClick={handleCancel}
                            disabled={installing}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border-subtle bg-bg-input hover:bg-bg-elevated text-xs font-medium text-text-secondary transition-colors disabled:opacity-60"
                        >
                            <X size={13} strokeWidth={2.5} />
                            Cancel
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
                        Installed skills
                    </h4>
                    {!loading && skills.length > 0 && (
                        <span className="text-[11px] text-text-tertiary">
                            {skills.length} {skills.length === 1 ? 'skill' : 'skills'}
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
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-sm font-medium text-text-primary truncate">
                                        {skill.name}
                                    </span>
                                    <span className="text-[10px] font-mono text-text-tertiary shrink-0">
                                        /{skill.id}
                                    </span>
                                </div>
                                <span
                                    className={[
                                        'shrink-0 text-[11px] font-medium',
                                        skill.source === 'builtin'
                                            ? 'text-green-500'
                                            : 'text-blue-500',
                                    ].join(' ')}
                                >
                                    {skill.source === 'builtin' ? 'Built-in' : 'Local'}
                                </span>
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
                            <p className="text-xs font-medium text-text-primary">No skills installed</p>
                            <p className="text-[11px] text-text-secondary mt-0.5">
                                Upload a SKILL.md above, or use the Advanced option.
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
                    {showAdvanced ? '▾' : '▸'} Advanced: open skills folder
                </button>
                {showAdvanced && (
                    <div className="mt-2 bg-bg-card rounded-xl border border-border-subtle p-4">
                        <div className="flex items-center justify-between gap-4">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <FolderOpen size={15} className="text-text-secondary" />
                                    <h4 className="text-sm font-semibold text-text-primary">Skills Folder</h4>
                                </div>
                                <p className="text-xs text-text-secondary">
                                    Manually drop a folder containing SKILL.md here. Used as a fallback for non-upload workflows.
                                </p>
                                {skillsPath && (
                                    <p className="mt-2 text-[11px] text-text-tertiary font-mono truncate">{skillsPath}</p>
                                )}
                            </div>
                            <button
                                onClick={openFolder}
                                className="px-4 py-2 rounded-lg bg-accent-primary hover:bg-accent-primary/90 text-white text-xs font-semibold transition-colors shrink-0"
                            >
                                Open Folder
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SkillsSettings;
