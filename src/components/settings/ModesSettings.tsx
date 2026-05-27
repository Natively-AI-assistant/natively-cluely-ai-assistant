import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, FileText, Lock, Paperclip, Plus, Trash2, X } from 'lucide-react';

const _premiumModes = import.meta.glob<{ default: React.FC<ModesSettingsProps> }>(
  '../../../premium/src/ModesSettings.tsx',
  { eager: true },
);
const PremiumModes = Object.values(_premiumModes)[0]?.default;

export interface ModesSettingsProps {
  onClose: () => void;
  isPremium: boolean;
  isLoaded: boolean;
  isTrialActive: boolean;
  onOpenNativelyAPI: () => void;
}

type ModeRow = {
  id: string;
  name: string;
  templateType: string;
  customContext: string;
  isActive: boolean;
  createdAt: string;
  referenceFileCount?: number;
};

type ReferenceFile = {
  id: string;
  modeId: string;
  fileName: string;
  content: string;
  createdAt: string;
};

const MODE_TEMPLATES: Array<{ type: string; label: string; description: string }> = [
  { type: 'general', label: 'General', description: 'Universal adaptive copilot for any meeting.' },
  { type: 'looking-for-work', label: 'Interview', description: 'Answer interview questions with confidence.' },
  { type: 'sales', label: 'Sales', description: 'Discovery, objection handling, and closing.' },
  { type: 'recruiting', label: 'Recruiting', description: 'Structured candidate evaluation.' },
  { type: 'team-meet', label: 'Team Meet', description: 'Action items and key decisions.' },
  { type: 'lecture', label: 'Lecture', description: 'Capture concepts from talks and classes.' },
  { type: 'technical-interview', label: 'Technical', description: 'Coding and system design support.' },
];

const templateLabel = (type: string) =>
  MODE_TEMPLATES.find((t) => t.type === type)?.label ?? type;

const hasProAccess = (isPremium: boolean, isTrialActive: boolean) => isPremium || isTrialActive;

const OpenSourceModesSettings: React.FC<ModesSettingsProps> = ({
  onClose,
  isPremium,
  isTrialActive,
  onOpenNativelyAPI,
}) => {
  const proAccess = hasProAccess(isPremium, isTrialActive);
  const [modes, setModes] = useState<ModeRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [contextDraft, setContextDraft] = useState('');
  const [referenceFiles, setReferenceFiles] = useState<ReferenceFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedMode = useMemo(
    () => modes.find((m) => m.id === selectedId) ?? null,
    [modes, selectedId],
  );

  const refreshModes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = (await window.electronAPI?.modesGetAll?.()) ?? [];
      setModes(rows);
      setSelectedId((prev) => {
        if (prev && rows.some((m) => m.id === prev)) return prev;
        const active = rows.find((m) => m.isActive);
        return active?.id ?? rows[0]?.id ?? null;
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshReferenceFiles = useCallback(async (modeId: string) => {
    const files = (await window.electronAPI?.modesGetReferenceFiles?.(modeId)) ?? [];
    setReferenceFiles(files);
  }, []);

  useEffect(() => {
    refreshModes();
  }, [refreshModes]);

  useEffect(() => {
    if (!selectedMode) {
      setContextDraft('');
      setReferenceFiles([]);
      return;
    }
    setContextDraft(selectedMode.customContext ?? '');
    refreshReferenceFiles(selectedMode.id);
  }, [selectedMode, refreshReferenceFiles]);

  useEffect(() => {
    const unsubMode = window.electronAPI?.onModeChanged?.(() => {
      refreshModes();
    });
    const unsubClear = window.electronAPI?.onModesActiveCleared?.(() => {
      refreshModes();
    });
    return () => {
      unsubMode?.();
      unsubClear?.();
    };
  }, [refreshModes]);

  const handleSetActive = async (mode: ModeRow) => {
    if (!proAccess && mode.templateType !== 'general') {
      onOpenNativelyAPI();
      return;
    }
    const result = await window.electronAPI?.modesSetActive?.(mode.id);
    if (result && !result.success) {
      setError(result.error ?? 'Could not activate mode');
      return;
    }
    await refreshModes();
  };

  const handleDeactivate = async () => {
    await window.electronAPI?.modesSetActive?.(null);
    await refreshModes();
  };

  const handleSaveContext = async () => {
    if (!selectedMode) return;
    setSaving(true);
    setError(null);
    try {
      const result = await window.electronAPI?.modesUpdate?.(selectedMode.id, {
        customContext: contextDraft,
      });
      if (result && !result.success) {
        setError(result.error ?? 'Could not save context');
        return;
      }
      await refreshModes();
    } finally {
      setSaving(false);
    }
  };

  const handleCreateMode = async (templateType: string) => {
    if (!proAccess) {
      onOpenNativelyAPI();
      return;
    }
    const template = MODE_TEMPLATES.find((t) => t.type === templateType);
    const result = await window.electronAPI?.modesCreate?.({
      name: template?.label ?? 'Untitled Mode',
      templateType,
    });
    if (result && !result.success) {
      setError(result.error ?? 'Could not create mode');
      return;
    }
    setShowTemplates(false);
    await refreshModes();
    if (result?.mode?.id) setSelectedId(result.mode.id);
  };

  const handleDeleteMode = async (mode: ModeRow) => {
    if (mode.templateType === 'general') return;
    if (!proAccess) {
      onOpenNativelyAPI();
      return;
    }
    const result = await window.electronAPI?.modesDelete?.(mode.id);
    if (result && !result.success) {
      setError(result.error ?? 'Could not delete mode');
      return;
    }
    await refreshModes();
  };

  const handleUploadReference = async () => {
    if (!selectedMode) return;
    if (!proAccess) {
      onOpenNativelyAPI();
      return;
    }
    const result = await window.electronAPI?.modesUploadReferenceFile?.(selectedMode.id);
    if (result && !result.success && !result.cancelled) {
      setError(result.error ?? 'Could not upload file');
      return;
    }
    await refreshReferenceFiles(selectedMode.id);
    await refreshModes();
  };

  const handleDeleteReference = async (fileId: string) => {
    if (!proAccess) {
      onOpenNativelyAPI();
      return;
    }
    await window.electronAPI?.modesDeleteReferenceFile?.(fileId);
    if (selectedMode) await refreshReferenceFiles(selectedMode.id);
    await refreshModes();
  };

  return (
    <div className="flex h-full bg-[#0e0e0e] text-white">
      <aside className="flex w-[240px] shrink-0 flex-col border-r border-white/10 bg-[#0a0a0a]">
        <div className="flex items-center justify-between px-4 py-4">
          <h2 className="text-sm font-semibold tracking-tight">Modes</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-white/45 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-3 pb-2">
          <button
            type="button"
            disabled={!proAccess}
            onClick={() => (proAccess ? setShowTemplates(true) : onOpenNativelyAPI())}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-white/10 px-3 py-2 text-xs font-medium text-white/80 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            New Mode
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {loading ? (
            <p className="px-3 py-2 text-xs text-white/40">Loading modes…</p>
          ) : (
            modes.map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => setSelectedId(mode.id)}
                className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                  selectedId === mode.id ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5'
                }`}
              >
                <FileText className="h-4 w-4 shrink-0 text-white/45" />
                <span className="min-w-0 flex-1 truncate">{mode.name}</span>
                {mode.isActive && <Check className="h-3.5 w-3.5 shrink-0 text-blue-400" />}
                {!proAccess && mode.templateType !== 'general' && (
                  <Lock className="h-3.5 w-3.5 shrink-0 text-white/30" />
                )}
              </button>
            ))
          )}
        </div>
        <div className="border-t border-white/10 px-3 py-3">
          <button
            type="button"
            onClick={() => setShowTemplates(true)}
            className="w-full rounded-lg px-3 py-2 text-left text-xs text-white/45 hover:bg-white/5 hover:text-white/70"
          >
            Natively Templates
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {showTemplates ? (
          <div className="flex h-full flex-col p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Choose a template</h3>
              <button type="button" onClick={() => setShowTemplates(false)} className="text-sm text-white/50">
                Back
              </button>
            </div>
            <div className="grid flex-1 grid-cols-2 gap-3 overflow-y-auto">
              {MODE_TEMPLATES.map((template) => {
                const locked = !proAccess && template.type !== 'general';
                return (
                  <button
                    key={template.type}
                    type="button"
                    disabled={locked}
                    onClick={() => handleCreateMode(template.type)}
                    className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <div className="mb-1 flex items-center gap-2 font-medium">
                      {locked && <Lock className="h-3.5 w-3.5 text-white/35" />}
                      {template.label}
                    </div>
                    <p className="text-xs leading-relaxed text-white/45">{template.description}</p>
                  </button>
                );
              })}
            </div>
          </div>
        ) : selectedMode ? (
          <div className="flex h-full flex-col overflow-y-auto p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-white/35">
                  {templateLabel(selectedMode.templateType)}
                </p>
                <h3 className="text-2xl font-semibold tracking-tight">{selectedMode.name}</h3>
              </div>
              <div className="flex items-center gap-2">
                {selectedMode.isActive ? (
                  <button
                    type="button"
                    onClick={handleDeactivate}
                    className="rounded-full border border-red-500/30 px-4 py-2 text-xs font-medium text-red-300"
                  >
                    Deactivate
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSetActive(selectedMode)}
                    className="rounded-full border border-white/15 px-4 py-2 text-xs font-medium"
                  >
                    Set active
                  </button>
                )}
                {selectedMode.templateType !== 'general' && proAccess && (
                  <button
                    type="button"
                    onClick={() => handleDeleteMode(selectedMode)}
                    className="rounded-full border border-white/10 p-2 text-white/45 hover:text-red-300"
                    title="Delete mode"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {error && (
              <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {error}
              </div>
            )}

            <section className="mb-6">
              <label className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-white/40">
                Real-time prompt
              </label>
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <textarea
                  value={contextDraft}
                  onChange={(e) => setContextDraft(e.target.value)}
                  maxLength={8000}
                  placeholder="Tell Natively how to respond during the conversation."
                  className="min-h-[120px] w-full resize-y bg-transparent text-sm leading-relaxed text-white outline-none placeholder:text-white/30"
                />
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[11px] text-white/35">{contextDraft.length}/8000</span>
                  <button
                    type="button"
                    disabled={saving || contextDraft === (selectedMode.customContext ?? '')}
                    onClick={handleSaveContext}
                    className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black disabled:opacity-40"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-medium uppercase tracking-[0.14em] text-white/40">
                  Reference files
                </label>
                <button
                  type="button"
                  onClick={handleUploadReference}
                  className="inline-flex items-center gap-1 rounded-full border border-white/10 px-3 py-1 text-xs text-white/70"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  Upload file
                </button>
              </div>
              {referenceFiles.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/40">
                  Add files as real-time context.
                </div>
              ) : (
                <div className="space-y-2">
                  {referenceFiles.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2"
                    >
                      <span className="truncate text-sm">{file.fileName}</span>
                      <button
                        type="button"
                        onClick={() => handleDeleteReference(file.id)}
                        className="text-white/40 hover:text-red-300"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-white/40">
            {loading ? 'Loading modes…' : 'Select a mode to edit'}
          </div>
        )}
      </main>
    </div>
  );
};

const ModesSettings: React.FC<ModesSettingsProps> = (props) => {
  if (PremiumModes) return <PremiumModes {...props} />;
  return <OpenSourceModesSettings {...props} />;
};

export default ModesSettings;
