import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useT } from '../i18n';
import { Download, Trash2, HardDrive, Check, Loader2, AlertCircle, ChevronDown, X } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { isMac } from '../utils/platformUtils';
// This panel speaks the AI Providers design language. The sheet has to travel
// with it: Settings mounts one panel at a time, so on the Audio tab the
// AIProvidersSettings component — and therefore its <style> — is not in the DOM,
// and every .aip-* class would resolve to nothing.
import { AIP_CSS, AipBadge, AipSwitch } from './settings/AIProvidersSettings';
import { useResolvedTheme } from '../hooks/useResolvedTheme';

interface ModelInfo {
    id: string;
    name: string;
    sizeMb: number;
    speed: 'very-fast' | 'fast' | 'medium' | 'slow';
    accuracy: 'decent' | 'good' | 'high' | 'very-high';
    multilingual: boolean;
    // 'downloading'  — bytes arriving from the network
    // 'available'    — files verified on disk; ready to use
    // 'missing'      — not on disk
    // 'error'        — last attempt failed (network, disk, dtype mismatch)
    // 'cancelled'    — user explicitly cancelled; partial bytes cleared
    // 'interrupted'  — process quit mid-download; service rehydrated state
    status: 'available' | 'missing' | 'downloading' | 'error' | 'cancelled' | 'interrupted';
    errorMessage?: string;
    requiresAppleSilicon?: boolean;
}

interface HardwareInfo {
    arch: string;
    platform: string;
    isAppleSilicon: boolean;
    totalRamGb: number;
    tier: 'excellent' | 'good' | 'limited';
    recommendation: string;
    recommendedModel: string;
}

interface ChannelConfig {
    enabled: boolean;
    micModelId: string;
    systemModelId: string;
    globalModelId: string;
}

interface RecoveryNotice {
    recovered: true;
    badModelId: string;
    fallbackModelId: string;
    message: string;
}

interface OnnxRecoveryNotice {
    family: 'whisper' | 'intent' | 'embeddings' | 'reranker';
    badModelId: string;
    message: string;
}

const electronAPI = (window as any).electronAPI;

/* Strong ease-out. The built-in CSS easings are too weak to read as intentional
   at these durations; this is the curve the rest of the panel already uses. */
const EASE_OUT = [0.23, 1, 0.32, 1] as const;

function PremiumSelect({ label, value, options, onChange, placeholder }: any) {
    const t = useT();
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const reduceMotion = useReducedMotion();

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const selectedLabel = options.find((o: any) => o.id === value)?.name || placeholder;

    /* The panel's own select vocabulary — .aip-select-trigger / -chevron / -list /
       -option / -empty. Chevron rotation comes from the sheet's
       `[aria-expanded='true'] .aip-select-chevron` rule rather than a class of our
       own, and the float uses .aip-panel-fade because motion in this design system
       is deliberately CSS-only: it stays off the main thread, which matters in a
       renderer that also hosts the always-on-top overlay. */
    return (
        <div ref={containerRef} className="aip-select">
            {/* The label CHANGES on the persistent select — "Global Model" becomes
                "Mic Audio Model" the instant Split is flipped — so it cross-fades
                through a 3px blur rather than snapping. That is the same treatment
                AipBadge uses for its own label swaps, and the blur is what stops the
                two strings reading as two separate objects mid-transition.

                Absolutely positioned inside a fixed-height box: both strings are in
                the DOM together during the fade, and in normal flow the outgoing one
                would push the control down for the duration.

                truncate is load-bearing, not cosmetic. The split column animates its
                width to zero on close, and a label free to wrap turns "System Audio
                Model" into three or four stacked lines as the space runs out. A flex
                row is as tall as its tallest child, so the card grew downward for the
                length of the exit and snapped back on unmount. */}
            {label && (
                <div className="relative mb-1.5 h-4">
                    <AnimatePresence initial={false}>
                        <motion.div
                            key={label}
                            className="absolute inset-0 text-[11px] leading-4 font-medium uppercase tracking-wide truncate"
                            style={{ color: 'var(--aip-secondary)' }}
                            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, filter: 'blur(3px)' }}
                            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, filter: 'blur(0px)' }}
                            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, filter: 'blur(3px)' }}
                            // Paced to sit inside the column's spring rather than finish
                            // long before it — at 160ms against a 620ms settle the label
                            // had already resolved while the row was still moving.
                            transition={{ duration: 0.26, ease: EASE_OUT }}
                        >
                            {label}
                        </motion.div>
                    </AnimatePresence>
                </div>
            )}
            <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                className="aip-select-trigger"
                onClick={() => setIsOpen(!isOpen)}
            >
                <span className="truncate">{selectedLabel}</span>
                <ChevronDown size={13} className="aip-select-chevron" />
            </button>

            {isOpen && (
                <div
                    role="listbox"
                    className="aip-float aip-select-list aip-panel-fade aip-scroll-y absolute top-full left-0 w-full z-50"
                >
                    {options.map((option: any) => {
                        const isSelected = value === option.id;
                        return (
                            <button
                                key={option.id}
                                role="option"
                                aria-selected={isSelected}
                                onClick={() => { onChange(option.id); setIsOpen(false); }}
                                className="aip-select-option"
                            >
                                <span className="truncate">{option.name}</span>
                                {isSelected && <Check size={13} className="aip-model-check aip-check" strokeWidth={3} />}
                            </button>
                        );
                    })}
                    {options.length === 0 && (
                        <div className="aip-select-empty">{t('No models installed — install one below.')}</div>
                    )}
                </div>
            )}
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Model library presentation.

   The list is fifteen near-identical rows. `speed` and `accuracy` arrive as raw
   enum strings and used to print that way — "very-fast", and "very-high acc"
   with the noun abbreviated — so the values read as data, not English.

   These maps humanise them; the family rules group the flat list into the three
   model families it actually contains.
   ═════════════════════════════════════════════════════════════════════════ */

const SPEED_LABEL: Record<ModelInfo['speed'], string> = {
    slow: 'Slow', medium: 'Medium', fast: 'Fast', 'very-fast': 'Very fast',
};

const ACCURACY_LABEL: Record<ModelInfo['accuracy'], string> = {
    decent: 'Decent', good: 'Good', high: 'High', 'very-high': 'Very high',
};

/** 1031 MB reads as noise next to 60 MB; 1.0 GB reads as a different class of thing. */
function formatSize(mb: number): string {
    return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

/**
 * Ordered family rules, first match wins. Matched on the display name because
 * that is the only grouping signal ModelInfo carries — there is no `family`
 * field. The final rule is a catch-all, so an unrecognised model is grouped
 * rather than dropped: "Tiny English", "Base Multilingual" and friends are all
 * Whisper checkpoints that do not say "Whisper" in their names.
 */
const FAMILY_RULES: Array<{ id: string; label: string; note: string; test: (name: string) => boolean }> = [
    { id: 'moonshine', label: 'Moonshine', note: 'Smallest and quickest to start', test: (n) => /^moonshine/i.test(n) },
    { id: 'distil', label: 'Distil-Whisper', note: 'Compressed Whisper, near-equal accuracy', test: (n) => /^distil/i.test(n) },
    { id: 'whisper', label: 'Whisper', note: 'Original OpenAI checkpoints', test: () => true },
];

function familyOf(model: ModelInfo): string {
    return (FAMILY_RULES.find((r) => r.test(model.name)) ?? FAMILY_RULES[FAMILY_RULES.length - 1]).id;
}

export function LocalWhisperModelPanel() {
    const t = useT();
    const reduceMotion = useReducedMotion();
    const aipTheme = useResolvedTheme();
    const [models, setModels] = useState<ModelInfo[]>([]);
    const [hardware, setHardware] = useState<HardwareInfo | null>(null);
    const [config, setConfig] = useState<ChannelConfig>({
        enabled: false,
        micModelId: '',
        systemModelId: '',
        globalModelId: ''
    });
    
    const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
    const [downloadingSet, setDownloadingSet] = useState<Set<string>>(new Set());
    const [recoveryNotice, setRecoveryNotice] = useState<RecoveryNotice | null>(null);
    const [onnxNotices, setOnnxNotices] = useState<Partial<Record<OnnxRecoveryNotice['family'], OnnxRecoveryNotice>>>({});
    const [loading, setLoading] = useState(true);

    const loadData = useCallback(async () => {
        try {
            const [modelsRes, hwRes, cfgRes, stateRes, noticeRes, intentRes, embedRes, rerankRes] = await Promise.all([
                electronAPI?.localWhisperGetModels?.(),
                electronAPI?.localWhisperGetHardware?.(),
                electronAPI?.localWhisperGetChannelConfig?.(),
                // NEW (2026-06-23): read the service's live download state so
                // a re-mounted panel sees an in-flight download that started
                // before the overlay was closed. Without this the panel
                // would show 0% / "Install" even though the main process is
                // still downloading.
                electronAPI?.localWhisperGetDownloadState?.().catch(() => []),
                electronAPI?.localWhisperGetRecoveryNotice?.().catch(() => null),
                // Generalized ONNX load-sentinel notices for the other three
                // local-model families (intent classifier / local embeddings /
                // local reranker). Each is one-shot drained through AppState so
                // a renderer reload does not see the same notice twice.
                electronAPI?.onnxGetRecoveryNotice?.('intent').catch(() => null),
                electronAPI?.onnxGetRecoveryNotice?.('embeddings').catch(() => null),
                electronAPI?.onnxGetRecoveryNotice?.('reranker').catch(() => null),
            ]);

            if (modelsRes) setModels(modelsRes.models ?? []);
            if (hwRes) setHardware(hwRes);
            if (cfgRes) setConfig(cfgRes);
            if (noticeRes?.recovered) setRecoveryNotice(noticeRes);

            // Merge the three family-keyed notices into a single keyed object
            // so the chips render in a deterministic order. A `null` from the
            // IPC means "no notice this session" — leave the chip out.
            const nextOnnx: typeof onnxNotices = {};
            if (intentRes) nextOnnx.intent = intentRes as OnnxRecoveryNotice;
            if (embedRes) nextOnnx.embeddings = embedRes as OnnxRecoveryNotice;
            if (rerankRes) nextOnnx.reranker = rerankRes as OnnxRecoveryNotice;
            setOnnxNotices(nextOnnx);

            // Merge service state into UI state. We only mutate state for
            // entries the service knows about — a 'complete' entry triggers
            // a fresh `getModels` so the badge flips to "available" from
            // the actual filesystem check.
            if (Array.isArray(stateRes)) {
                const nextProgress: Record<string, number> = {};
                const nextDownloading = new Set<string>();
                const interruptedIds: string[] = [];
                const cancelledIds: string[] = [];
                const errorIds: string[] = [];
                for (const s of stateRes) {
                    if (!s || !s.modelId) continue;
                    if (s.status === 'downloading' || s.status === 'verifying') {
                        nextDownloading.add(s.modelId);
                        nextProgress[s.modelId] = typeof s.progress === 'number' ? s.progress : 0;
                    } else if (s.status === 'interrupted') {
                        interruptedIds.push(s.modelId);
                    } else if (s.status === 'cancelled') {
                        cancelledIds.push(s.modelId);
                    } else if (s.status === 'error') {
                        errorIds.push(s.modelId);
                    }
                    // 'complete' — handled below by re-fetching models so
                    // the disk-verified badge is shown.
                }
                setDownloadingSet(nextDownloading);
                setDownloadProgress(prev => ({ ...prev, ...nextProgress }));
                if (interruptedIds.length || cancelledIds.length || errorIds.length) {
                    setModels(prev => prev.map(m => {
                        if (interruptedIds.includes(m.id)) return { ...m, status: 'interrupted' as const };
                        if (cancelledIds.includes(m.id)) return { ...m, status: 'cancelled' as const };
                        if (errorIds.includes(m.id)) return { ...m, status: 'error' as const, errorMessage: 'Download was interrupted.' };
                        return m;
                    }));
                }
            }

            // Auto-select initial models if none are set
            if (cfgRes && modelsRes && modelsRes.models) {
                const list = modelsRes.models;
                const avail = list.filter((m: any) => m.status === 'available');
                if (avail.length > 0) {
                    let needsUpdate = false;
                    const newCfg = { ...cfgRes };

                    if (!cfgRes.globalModelId) {
                        newCfg.globalModelId = avail[0].id;
                        electronAPI?.localWhisperSetModel?.(avail[0].id);
                        needsUpdate = true;
                    }
                    if (!cfgRes.micModelId) {
                        newCfg.micModelId = avail[0].id;
                        needsUpdate = true;
                    }
                    if (!cfgRes.systemModelId) {
                        newCfg.systemModelId = avail[0].id;
                        needsUpdate = true;
                    }

                    if (needsUpdate) {
                        setConfig(newCfg);
                        electronAPI?.localWhisperSetChannelConfig?.(newCfg);
                    }
                }
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // Handle downloads
    useEffect(() => {
        const unsubProgress = electronAPI?.onLocalWhisperDownloadProgress?.((data: { modelId: string; progress: number }) => {
            setDownloadProgress(prev => ({ ...prev, [data.modelId]: data.progress }));
        });
        const unsubComplete = electronAPI?.onLocalWhisperDownloadComplete?.((data: { modelId: string }) => {
            setDownloadingSet(prev => { const s = new Set(prev); s.delete(data.modelId); return s; });
            setDownloadProgress(prev => { const d = { ...prev }; delete d[data.modelId]; return d; });
            loadData();
        });
        const unsubError = electronAPI?.onLocalWhisperDownloadError?.((data: { modelId: string; error: string }) => {
            setDownloadingSet(prev => { const s = new Set(prev); s.delete(data.modelId); return s; });
            setDownloadProgress(prev => { const d = { ...prev }; delete d[data.modelId]; return d; });
            setModels(prev => prev.map(m => m.id === data.modelId ? { ...m, status: 'error', errorMessage: data.error } : m));
        });
        
        return () => { unsubProgress?.(); unsubComplete?.(); unsubError?.(); };
    }, [loadData]);

    const handleDownload = async (modelId: string) => {
        if (downloadingSet.has(modelId)) return;
        setDownloadingSet(prev => new Set([...prev, modelId]));
        setModels(prev => prev.map(m => m.id === modelId ? { ...m, status: 'downloading' } : m));
        setDownloadProgress(prev => ({ ...prev, [modelId]: 0 }));

        const result = await electronAPI?.localWhisperStartDownload?.(modelId);
        if (!result?.success && result?.error !== 'already-downloading') {
            setDownloadingSet(prev => { const s = new Set(prev); s.delete(modelId); return s; });
            setDownloadProgress(prev => { const d = { ...prev }; delete d[modelId]; return d; });
            setModels(prev => prev.map(m => m.id === modelId
                ? { ...m, status: 'error', errorMessage: result?.error ?? 'Download failed' }
                : m
            ));
        }
    };

    // NEW (2026-06-23): explicit user cancel. Stops the worker, clears
    // partial bytes (the service calls provider.deletePartial on next
    // start), and flips the badge so the user can re-install.
    const handleCancel = async (modelId: string) => {
        await electronAPI?.localWhisperCancelDownload?.(modelId);
        // The service broadcasts 'cancelled' → onLocalWhisperDownloadError
        // does NOT fire on cancel, but the next state event arrives via
        // the loadData() rehydration on remount OR the next IPC. To keep
        // the UI responsive immediately, optimistically clear local state.
        setDownloadingSet(prev => { const s = new Set(prev); s.delete(modelId); return s; });
        setDownloadProgress(prev => { const d = { ...prev }; delete d[modelId]; return d; });
        setModels(prev => prev.map(m => m.id === modelId
            ? { ...m, status: 'cancelled' as const, errorMessage: undefined }
            : m
        ));
        // Re-fetch so the disk-truth badge (probably "missing" after
        // deletePartial) is shown.
        await loadData();
    };

    const handleDelete = async (modelId: string) => {
        await electronAPI?.localWhisperDeleteModel?.(modelId);
        await loadData();
    };

    const toggleDualChannel = async (enabled: boolean) => {
        const newCfg = { ...config, enabled };
        setConfig(newCfg);
        await electronAPI?.localWhisperSetChannelConfig?.({ enabled });
    };

    const setGlobalModel = async (modelId: string) => {
        setConfig(prev => ({ ...prev, globalModelId: modelId }));
        await electronAPI?.localWhisperSetModel?.(modelId);
    };

    const setMicModel = async (modelId: string) => {
        setConfig(prev => ({ ...prev, micModelId: modelId }));
        await electronAPI?.localWhisperSetChannelConfig?.({ micModelId: modelId });
    };

    const setSystemModel = async (modelId: string) => {
        setConfig(prev => ({ ...prev, systemModelId: modelId }));
        await electronAPI?.localWhisperSetChannelConfig?.({ systemModelId: modelId });
    };

    if (loading) {
        // Carries its own scope + sheet: this returns before the main tree, so
        // without them --aip-tertiary and .aip-spinner resolve to nothing.
        return (
            <div className="aip-root p-4 flex justify-center" data-theme={aipTheme} style={{ color: 'var(--aip-tertiary)' }}>
                <Loader2 className="aip-spinner w-5 h-5" />
                <style>{AIP_CSS}</style>
            </div>
        );
    }

    const availableModels = models.filter(m => m.status === 'available');

    /** Disk footprint of what is actually on disk — the number fifteen large models needs stated. */
    const installedBytesMb = availableModels.reduce((sum, m) => sum + m.sizeMb, 0);

    /**
     * The model(s) actually transcribing right now → the badge each one shows.
     *
     * Gated on being INSTALLED, which is the bug this replaced: the set was built
     * from the config ids alone, so a channel still pointing at a model that was
     * never installed (or has since been deleted) painted an accent row reading
     * "In use" for something not on disk. The Moonshine group showed 1/2 installed
     * with two "In use" rows — the config outlives the file.
     *
     * The value is the label, because in split mode two rows are legitimately in
     * use and "In use" twice does not say which is which. A model assigned to both
     * channels collapses to one row.
     */
    const installedIds = new Set(availableModels.map((m) => m.id));
    const inUseLabels = new Map<string, string>();
    if (config.enabled) {
        if (installedIds.has(config.micModelId)) inUseLabels.set(config.micModelId, t('Mic'));
        if (installedIds.has(config.systemModelId)) {
            inUseLabels.set(
                config.systemModelId,
                inUseLabels.has(config.systemModelId) ? t('Mic + system') : t('System'),
            );
        }
    } else if (installedIds.has(config.globalModelId)) {
        inUseLabels.set(config.globalModelId, t('In use'));
    }

    const recommendedName = hardware?.recommendedModel
        ? models.find(m => m.id === hardware.recommendedModel)?.name
        : undefined;


    return (
        // .aip-root is the token scope — every --aip-* custom property is declared
        // on it, and data-theme drives the light/dark split. Without both, the
        // .aip-* classes below inherit nothing and render as unstyled boxes.
        <div className="aip-root space-y-4" data-theme={aipTheme}>
            {recoveryNotice && (
                /* Hand-rolled amber becomes the panel's own warn tone, so the recovery
                   banners sit in the same palette as everything below them. */
                <div className="aip-card flex items-start gap-3 p-4" style={{ color: 'var(--aip-warn)', background: 'var(--aip-warn-bg)', borderColor: 'var(--aip-warn-border)' }}>
                    <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold" style={{ color: 'var(--aip-primary)' }}>{t('Recovered local transcription')}</div>
                        <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--aip-secondary)' }}>
                            {t('Natively recovered from a local transcription model crash. We reset')} <span className="font-mono" style={{ color: 'var(--aip-primary)' }}>{recoveryNotice.badModelId}</span> {t('to')} <span className="font-mono" style={{ color: 'var(--aip-primary)' }}>{recoveryNotice.fallbackModelId}</span> {t('so the app can start safely.')}
                        </p>
                    </div>
                    <button
                        onClick={() => setRecoveryNotice(null)}
                        className="aip-btn"
                        data-size="sm"
                        data-icon="true"
                        data-variant="ghost"
                        aria-label={t("Dismiss recovery notice")}
                    >
                        <X size={13} />
                    </button>
                </div>
            )}
            {onnxNotices.intent && (
                <OnnxRecoveryChip
                    title={t("Recovered intent classifier")}
                    family="intent"
                    notice={onnxNotices.intent}
                    onDismiss={() => setOnnxNotices((s) => ({ ...s, intent: undefined }))}
                />
            )}
            {onnxNotices.embeddings && (
                <OnnxRecoveryChip
                    title={t("Recovered local embeddings")}
                    family="embeddings"
                    notice={onnxNotices.embeddings}
                    onDismiss={() => setOnnxNotices((s) => ({ ...s, embeddings: undefined }))}
                />
            )}
            {onnxNotices.reranker && (
                <OnnxRecoveryChip
                    title={t("Recovered local reranker")}
                    family="reranker"
                    notice={onnxNotices.reranker}
                    onDismiss={() => setOnnxNotices((s) => ({ ...s, reranker: undefined }))}
                />
            )}
            {/* .aip-card + .aip-provider: the same container and internal rhythm every
                provider card in AI Providers uses. .aip-provider owns the padding and
                an 8px flex column, so no mb-* here — that stack is what produced the
                dead bands the AI Providers pass removed. */}
            <div className="aip-card aip-provider">
                <div className="aip-provider-head">
                    <h4 className="aip-card-title">{t('Speech Engine')}</h4>
                    {/* AipSwitch is the panel's own control: correct role/aria-checked,
                        the shared thumb transition, and the disabled grammar for free.
                        What it replaced was a <label> wrapping a `className="hidden"`
                        checkbox — display:none, which drops the input from the
                        accessibility tree AND the tab order, so Split could not be
                        reached or operated by keyboard at all. */}
                    <div className="ml-auto flex items-center gap-2 shrink-0">
                        <span className="text-[11px] font-medium" style={{ color: 'var(--aip-secondary)' }}>{t('Split channels')}</span>
                        <AipSwitch
                            checked={config.enabled}
                            onChange={(next) => toggleDualChannel(next)}
                            label={t('Split Audio Channels')}
                            title={t('Use different models for microphone and system audio')}
                        />
                    </div>
                </div>

                {/* Deliberately STATE-INDEPENDENT. This used to swap between "One model
                    transcribes both microphone and system audio." and "Separate models
                    for microphone and system audio." — two sentences of different length,
                    so at this panel's width one wrapped to two lines and the other did
                    not. The card gained and lost a line of height on every toggle, which
                    read as the container growing for no reason.

                    Nothing is lost by holding it still: the switch shows the mode, and
                    the select labels below already say Mic / System. */}
                <p className="text-xs leading-relaxed" style={{ color: 'var(--aip-secondary)' }}>
                    {t('Choose which installed model transcribes your audio.')}
                </p>

                {/* The first select PERSISTS across the toggle — it is the same physical
                    control either way, just addressing one channel instead of both — and
                    the system select expands out of its right edge.

                    The previous version crossfaded two whole blocks against each other,
                    so nothing survived the switch: the control you were looking at
                    vanished and a different one faded in where it had been, and with
                    popLayout the container collapsed between the two. Keeping the first
                    mounted means only the genuinely new thing animates.

                    flexGrow 0 → 1 is what makes it read as opening rather than appearing:
                    the persistent select gives up half its width as the new one takes it,
                    both driven by one interpolation, so there is no reflow step. */}
                <div className="flex relative z-10 items-stretch">
                    <div className="flex-1 min-w-0">
                        <PremiumSelect
                            label={config.enabled ? t('Mic Audio Model') : t('Global Model')}
                            value={config.enabled ? config.micModelId : config.globalModelId}
                            onChange={config.enabled ? setMicModel : setGlobalModel}
                            options={availableModels}
                            placeholder={config.enabled ? t('Select mic model') : t('Select global model')}
                        />
                    </div>

                    <AnimatePresence initial={false}>
                        {config.enabled && (
                            <motion.div
                                key="system"
                                className="min-w-0"
                                style={{
                                    overflow: 'hidden',
                                    // flexBasis 0 is what makes the split exactly 50/50. The
                                    // sibling is `flex-1` — i.e. `flex: 1 1 0%` — so it sizes
                                    // purely from grow. Leaving this one at the default
                                    // `flex-basis: auto` would size it from its CONTENT and
                                    // then add an equal share of the remainder on top, so the
                                    // system column came out wider than the mic column.
                                    flexBasis: 0,
                                    flexShrink: 1,
                                    // Resting state, and the ONLY state under reduced motion —
                                    // there `animate` carries opacity alone, so without these
                                    // the column would sit at flex-grow 0 against flex-basis 0
                                    // and collapse to nothing. Motion overrides both inline
                                    // while animating.
                                    flexGrow: 1,
                                    marginLeft: 16,
                                }}
                                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, flexGrow: 0.0001, marginLeft: 0 }}
                                // A spring, not a curve. The width is a physical thing making
                                // room, and a spring is also INTERRUPTIBLE: flip Split twice
                                // quickly and it reverses from wherever it actually is,
                                // carrying its velocity, where a tween would restart from
                                // zero and stutter.
                                //
                                // Asymmetric on purpose, in two ways. Opening bounces and
                                // the control fades in behind the edge (80ms) — you read "a
                                // space opened, and something is in it" rather than watching
                                // a control squash itself wider. Closing does NOT bounce and
                                // is quicker: an overshoot on the way out means the gap
                                // springs back OPEN after you asked it to close, which reads
                                // as a glitch rather than as elasticity. Slow where the user
                                // is deciding, fast where the system is responding.
                                //
                                // Opacity stays a tween throughout — a spring can overshoot
                                // past 1, and the clamp shows up as a flicker.
                                animate={reduceMotion
                                    ? { opacity: 1 }
                                    : {
                                        opacity: 1, flexGrow: 1, marginLeft: 16,
                                        transition: {
                                            type: 'spring', duration: 0.62, bounce: 0.3,
                                            opacity: { type: 'tween', duration: 0.22, delay: 0.08, ease: EASE_OUT },
                                        },
                                    }}
                                exit={reduceMotion
                                    ? { opacity: 0 }
                                    : {
                                        opacity: 0, flexGrow: 0.0001, marginLeft: 0,
                                        transition: {
                                            type: 'spring', duration: 0.42, bounce: 0,
                                            opacity: { type: 'tween', duration: 0.12, ease: EASE_OUT },
                                        },
                                    }}
                            >
                                <PremiumSelect
                                    label={t('System Audio Model')}
                                    value={config.systemModelId}
                                    onChange={setSystemModel}
                                    options={availableModels}
                                    placeholder={t('Select system model')}
                                />
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>

            <div className="aip-card aip-provider">
                <div>
                    <div className="aip-provider-head">
                        <h4 className="aip-card-title">{t('Model Library')}</h4>
                        {/* Replaces the old "Recommended for your Mac" chip, which repeated
                            what the per-row badge already says. Disk footprint is the thing
                            fifteen multi-hundred-megabyte models genuinely need stated and
                            that nothing else on the panel reports. */}
                        <span className="ml-auto text-[11px] font-medium tabular-nums shrink-0" style={{ color: 'var(--aip-tertiary)' }}>
                            {availableModels.length}/{models.length} {t('installed')}
                            {installedBytesMb > 0 && <> · {formatSize(installedBytesMb)}</>}
                        </span>
                    </div>
                    {/* A pointer, not a second badge — deliberately plain text. With fifteen
                        rows you should not have to scan for the one suited to this machine. */}
                    {recommendedName && (
                        <p className="text-[11px] mt-1" style={{ color: 'var(--aip-tertiary)' }}>
                            {t('Best for this')} {isMac ? 'Mac' : 'PC'}: <span className="font-medium" style={{ color: 'var(--aip-secondary)' }}>{recommendedName}</span>
                        </p>
                    )}
                </div>

                {/* .aip-well is the recessed layer BELOW a card — the same treatment the
                    model list uses in AI Providers. It is an alpha wash rather than a flat
                    token so it reads as recessed against a card, the page, or another well. */}
                <div className="aip-well aip-scroll-y p-3 space-y-4" style={{ maxHeight: 420 }}>
                    {FAMILY_RULES.map((family) => {
                        const rows = models.filter((m) => familyOf(m) === family.id);
                        if (rows.length === 0) return null;
                        const installedHere = rows.filter((m) => m.status === 'available').length;

                        return (
                            <section key={family.id} className="space-y-1.5">
                                {/* Fifteen flat rows became three scannable groups. The families
                                    differ in kind, not just size, so the note earns its line. */}
                                <header className="flex items-baseline justify-between gap-3 px-1">
                                    <div className="flex items-baseline gap-2 min-w-0">
                                        <h5 className="text-[10px] font-bold uppercase tracking-wider shrink-0" style={{ color: 'var(--aip-secondary)' }}>{family.label}</h5>
                                        <span className="text-[11px] truncate" style={{ color: 'var(--aip-tertiary)' }}>{t(family.note)}</span>
                                    </div>
                                    <span className="text-[10px] tabular-nums shrink-0" style={{ color: 'var(--aip-tertiary)' }}>{installedHere}/{rows.length}</span>
                                </header>

                                <div className="space-y-1.5">
                                    {rows.map(model => {
                                    const isDownloading = model.status === 'downloading' || downloadingSet.has(model.id);
                                    const progress = downloadProgress[model.id] || 0;
                                    const isAvailable = model.status === 'available';
                                    const isFailed = model.status === 'error' || model.status === 'interrupted' || model.status === 'cancelled';
                                    const isRecommended = hardware?.recommendedModel === model.id;
                                    const inUseLabel = inUseLabels.get(model.id);
                                    const isInUse = inUseLabel !== undefined;

                                    return (
                                        // Every row gets the same surface. The in-use row used to carry an
                                        // accent border and fill, which is a second status colour saying
                                        // exactly what its badge says — and this sheet is explicit that the
                                        // badge is the ONE status primitive ("Nothing else may carry a
                                        // status colour", above .aip-badge). Fifteen rows also need a
                                        // uniform surface to stay scannable; one tinted card pulls the eye
                                        // to a row that needs no action.
                                        <div
                                            key={model.id}
                                            className="aip-card flex items-center justify-between gap-3 p-3"
                                        >
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1">
                                                    {/* Installed vs not — the one thing no badge states, and which
                                                        was previously legible only as the ABSENCE of an Install
                                                        button. Deliberately NOT accent when in use: that is status,
                                                        and status belongs to the badge. */}
                                                    <span
                                                        aria-hidden="true"
                                                        className="w-1.5 h-1.5 rounded-full shrink-0"
                                                        style={{
                                                            background: isAvailable ? 'var(--aip-tertiary)' : 'transparent',
                                                            border: isAvailable ? undefined : '1px solid var(--aip-border-strong)',
                                                        }}
                                                    />
                                                    <span className="aip-model-name font-medium truncate" style={{ color: 'var(--aip-primary)' }}>{model.name}</span>
                                                    {/* AipBadge carries the panel's tone grammar — ok / info / warn /
                                                        danger / neutral — instead of five hand-rolled chip styles. */}
                                                    {inUseLabel && <AipBadge tone="info" label={inUseLabel} />}
                                                    {isRecommended && !isInUse && <AipBadge tone="ok" label={t('Recommended')} />}
                                                    {model.requiresAppleSilicon && <AipBadge tone="neutral" label="Apple Silicon" />}
                                                </div>
                                                {/* Size leads because it is the one hard number, and it is the
                                                    constraint people actually weigh. Speed and accuracy are plain
                                                    words — the enums are still humanised ("very-fast" → "Very
                                                    fast", and "acc" spelled out), but the value IS the label, so
                                                    it needs no graphic to be read. */}
                                                <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--aip-tertiary)' }}>
                                                    <span className="flex items-center gap-1.5 tabular-nums"><HardDrive size={12} className="opacity-70" /> {formatSize(model.sizeMb)}</span>
                                                    <span aria-hidden="true">·</span>
                                                    <span>{t(SPEED_LABEL[model.speed])}</span>
                                                    <span aria-hidden="true">·</span>
                                                    <span>{t(ACCURACY_LABEL[model.accuracy])} {t('accuracy')}</span>
                                                </div>

                                                {isDownloading && (
                                                    <div className="mt-2.5">
                                                        <div className="flex justify-between items-center text-[10px] mb-1.5 font-medium" style={{ color: 'var(--aip-secondary)' }}>
                                                            <span>{t('Downloading')} · <span className="tabular-nums" style={{ color: 'var(--aip-accent)' }}>{Math.round(progress)}%</span></span>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleCancel(model.id); }}
                                                                className="aip-btn"
                                                                data-size="sm"
                                                                data-variant="ghost"
                                                                title={t("Cancel download")}
                                                            >
                                                                {t('Cancel')}
                                                            </button>
                                                        </div>
                                                        {/* The progress track is the one place a raw colour is still
                                                            right: it is a data channel, not chrome. Tokens for the
                                                            surface, accent for the fill. */}
                                                        <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: 'var(--aip-well-bg)' }}>
                                                            <div
                                                                className="h-full transition-[width] duration-300 ease-out"
                                                                style={{ width: `${progress}%`, background: 'var(--aip-accent)' }}
                                                            />
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Plain text, no filled container. A boxed advisory is the weight
                                                    this panel reserves for something needing action NOW; a stalled
                                                    download already has its Retry button one column over, so the
                                                    box argued for attention the row had already earned — and at
                                                    six failed rows it tiled the list with red blocks. Colour and
                                                    the icon carry it.

                                                    One phrasing per cause, and none names a button: these read
                                                    "Download was interrupted. Click Install to retry." while the
                                                    button beside them said "Retry" — pointing at a control that
                                                    was not there. */}
                                                {isFailed && (
                                                    <div className="mt-1.5 flex items-start gap-1.5 text-[11px]" style={{ color: 'var(--aip-danger)' }}>
                                                        <AlertCircle size={12} className="shrink-0 mt-[1px]" />
                                                        <span>
                                                            {model.status === 'interrupted'
                                                                ? t('Download was interrupted.')
                                                                : model.status === 'cancelled'
                                                                  ? t('Download cancelled.')
                                                                  : (model.errorMessage || t('Download failed.'))}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="flex-shrink-0 flex items-center gap-2">
                                                {!isAvailable && !isDownloading && (
                                                    <button
                                                        onClick={() => handleDownload(model.id)}
                                                        // Default .aip-btn — no accent variant, no danger tone. Install
                                                        // is the ordinary action on almost every row here, so tinting
                                                        // it made thirteen buttons shout at once; and a red Retry was a
                                                        // second status colour beside the failure line that already
                                                        // says what went wrong. The label carries the difference.
                                                        className="aip-btn"
                                                        data-size="row"
                                                    >
                                                        <Download size={13} />
                                                        <span>{isFailed ? t('Retry') : t('Install')}</span>
                                                    </button>
                                                )}

                                                {isAvailable && (
                                                    <button
                                                        onClick={() => handleDelete(model.id)}
                                                        className="aip-btn"
                                                        data-size="row"
                                                        data-icon="true"
                                                        data-variant="danger-ghost"
                                                        // Deleting the model that is currently transcribing would
                                                        // silently break the engine, and nothing else on this panel
                                                        // would say why. The "In use" badge explains the disabled state.
                                                        disabled={isInUse}
                                                        title={isInUse ? t("This model is in use — select another first") : t("Delete model")}
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                    })}
                                </div>
                            </section>

                        );
                    })}
                </div>
            </div>
            
            {/* ── Footer note ── */}
            {hardware?.tier === 'limited' && (
                <div className="aip-inline-warn flex items-start gap-2">
                    <AlertCircle size={12} className="shrink-0 mt-[1px]" />
                    <p>
                        {t('Limited hardware — cloud STT recommended for long sessions')}
                    </p>
                </div>
            )}

            {/* LAST child, matching AI Providers: as a first child it would satisfy the
                `space-*` sibling selector and push margin onto the real first card.
                Mounted here because Settings renders one panel at a time — on this tab
                AIProvidersSettings is unmounted, so its copy of the sheet is not in the
                DOM and every .aip-* class above would resolve to nothing. */}
            <style>{AIP_CSS}</style>
        </div>
    );
}

/**
 * Compact status chip for the three "silent background" local models
 * (intent / embeddings / reranker). Smaller than the full Whisper banner
 * because the user doesn't otherwise notice these degraded paths.
 *
 * "Retry now" calls the `onnx-reset-family` IPC to clear the cold-start
 * poison flag in the main process. The user must reopen the panel to see
 * the actual retry attempt — the next `ensureLoaded()` will try a fresh
 * spawn; if it succeeds the chip will simply not reappear next launch
 * because the disk sentinel was cleared on `ready`.
 */
function OnnxRecoveryChip({
    title,
    family,
    notice,
    onDismiss,
}: {
    title: string;
    family: OnnxRecoveryNotice['family'];
    notice: OnnxRecoveryNotice;
    onDismiss: () => void;
}) {
    const t = useT();
    const [retrying, setRetrying] = useState(false);
    const handleRetry = useCallback(async () => {
        setRetrying(true);
        try {
            await electronAPI?.onnxResetFamily?.(family);
        } finally {
            setRetrying(false);
            onDismiss();
        }
    }, [family, onDismiss]);
    return (
        <div className="aip-card flex items-start gap-3 p-3" style={{ color: 'var(--aip-warn)', background: 'var(--aip-warn-bg)', borderColor: 'var(--aip-warn-border)' }}>
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0 opacity-80" />
            <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold" style={{ color: 'var(--aip-primary)' }}>{title}</div>
                <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--aip-secondary)' }}>
                    {notice.message}
                </p>
                <div className="mt-2 flex items-center gap-3">
                    <button
                        onClick={handleRetry}
                        disabled={retrying}
                        className="aip-btn"
                        data-size="sm"
                        data-variant="accent"
                    >
                        {retrying ? t('Retrying…') : t('Retry now')}
                    </button>
                    <span className="text-[10px]" style={{ color: 'var(--aip-tertiary)' }}>
                        {t('Skipped model:')} <span className="font-mono">{notice.badModelId}</span>
                    </span>
                </div>
            </div>
            <button
                onClick={onDismiss}
                className="aip-btn"
                data-size="sm"
                data-icon="true"
                data-variant="ghost"
                aria-label={t("Dismiss recovery notice")}
            >
                <X size={12} />
            </button>
        </div>
    );
}
