import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Trash2, FileText, X, Check, Pencil, Save } from 'lucide-react';

interface Mode {
  id: string;
  name: string;
  templateType: string;
  customContext: string;
  isActive: boolean;
  createdAt: string;
  referenceFileCount?: number;
}

interface ReferenceFile {
  id: string;
  modeId: string;
  fileName: string;
  content: string;
  createdAt: string;
}

interface ModesSettingsProps {
  onClose: () => void;
  isPremium?: boolean;
  isLoaded?: boolean;
  isTrialActive?: boolean;
  onOpenNativelyAPI?: () => void;
}

const TEMPLATES: Array<{ type: string; label: string; description: string }> = [
  { type: 'general',            label: 'General',            description: 'A universal adaptive copilot for any conversation.' },
  { type: 'sales',              label: 'Sales',              description: 'Close deals with strategic discovery and objection handling.' },
  { type: 'recruiting',         label: 'Recruiting',         description: 'Evaluate candidates with structured interview insights.' },
  { type: 'team-meet',          label: 'Team Meet',          description: 'Track action items and key decisions from meetings.' },
  { type: 'looking-for-work',   label: 'Looking for Work',   description: 'Answer interview questions with confidence and clarity.' },
  { type: 'lecture',            label: 'Lecture',            description: 'Capture key concepts and content from lectures.' },
  { type: 'technical-interview', label: 'Technical Interview', description: 'Surface algorithms, data structures, and system design context.' },
];

const ModesSettings: React.FC<ModesSettingsProps> = ({ onClose }) => {
  const [modes, setModes] = useState<Mode[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [files, setFiles] = useState<ReferenceFile[]>([]);
  const [draftName, setDraftName] = useState('');
  const [draftContext, setDraftContext] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTemplate, setNewTemplate] = useState<string>('general');
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(() => modes.find(m => m.id === selectedId) ?? null, [modes, selectedId]);

  const reload = async () => {
    try {
      const all = await window.electronAPI?.modesGetAll?.() ?? [];
      const active = await window.electronAPI?.modesGetActive?.() ?? null;
      setModes(all);
      setActiveId(active?.id ?? null);
      if (!selectedId && all.length > 0) {
        setSelectedId(active?.id ?? all[0].id);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load modes');
    }
  };

  useEffect(() => { reload(); }, []);

  useEffect(() => {
    if (!selected) { setFiles([]); setDraftName(''); setDraftContext(''); return; }
    setDraftName(selected.name);
    setDraftContext(selected.customContext ?? '');
    setIsEditingName(false);
    window.electronAPI?.modesGetReferenceFiles?.(selected.id)
      .then(setFiles)
      .catch(() => setFiles([]));
  }, [selectedId]);

  const handleActivate = async (id: string | null) => {
    setError(null);
    const res = await window.electronAPI?.modesSetActive?.(id);
    if (res?.success) {
      setActiveId(id);
    } else {
      setError(res?.error ?? 'Could not activate mode');
    }
  };

  const handleCreate = async () => {
    setError(null);
    const name = newName.trim();
    if (!name) { setError('Name required'); return; }
    const res = await window.electronAPI?.modesCreate?.({ name, templateType: newTemplate });
    if (res?.success && res.mode) {
      setIsCreating(false);
      setNewName('');
      setNewTemplate('general');
      await reload();
      setSelectedId(res.mode.id);
    } else {
      setError(res?.error ?? 'Could not create mode');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this mode? This cannot be undone.')) return;
    const res = await window.electronAPI?.modesDelete?.(id);
    if (res?.success) {
      if (selectedId === id) setSelectedId(null);
      await reload();
    } else {
      setError(res?.error ?? 'Could not delete mode');
    }
  };

  const handleSaveContext = async () => {
    if (!selected) return;
    const res = await window.electronAPI?.modesUpdate?.(selected.id, {
      name: draftName.trim() || selected.name,
      customContext: draftContext,
    });
    if (res?.success) {
      setIsEditingName(false);
      await reload();
    } else {
      setError(res?.error ?? 'Could not save changes');
    }
  };

  const handleUploadFile = async () => {
    if (!selected) return;
    const res = await window.electronAPI?.modesUploadReferenceFile?.(selected.id);
    if (res?.cancelled) return;
    if (res?.success) {
      const updated = await window.electronAPI?.modesGetReferenceFiles?.(selected.id) ?? [];
      setFiles(updated);
      await reload();
    } else {
      setError(res?.error ?? 'Could not upload file');
    }
  };

  const handleDeleteFile = async (id: string) => {
    const res = await window.electronAPI?.modesDeleteReferenceFile?.(id);
    if (res?.success && selected) {
      const updated = await window.electronAPI?.modesGetReferenceFiles?.(selected.id) ?? [];
      setFiles(updated);
      await reload();
    }
  };

  return (
    <div className="flex h-full w-full flex-col bg-[#141414] text-white">
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold tracking-tight">Modes</h2>
          <span className="text-[10px] font-medium uppercase tracking-wider text-white/40">
            {modes.length} configured
          </span>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition">
          <X className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="px-5 py-2 text-[12px] text-red-300 bg-red-500/10 border-b border-red-500/20">
          {error}
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        <aside className="w-[260px] border-r border-white/10 flex flex-col">
          <div className="p-3 border-b border-white/10">
            <button
              onClick={() => { setIsCreating(true); setError(null); }}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-[12px] font-medium rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition"
            >
              <Plus className="w-3.5 h-3.5" />
              New Mode
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {modes.map(mode => {
              const isSel = mode.id === selectedId;
              const isAct = mode.id === activeId;
              return (
                <button
                  key={mode.id}
                  onClick={() => setSelectedId(mode.id)}
                  className={`w-full text-left px-3 py-2.5 flex items-center gap-2 transition border-l-2 ${
                    isSel ? 'bg-white/5 border-white' : 'border-transparent hover:bg-white/5'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-medium truncate">{mode.name}</span>
                      {isAct && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-white/40 mt-0.5">
                      {TEMPLATES.find(t => t.type === mode.templateType)?.label ?? mode.templateType}
                    </div>
                  </div>
                </button>
              );
            })}
            {modes.length === 0 && (
              <div className="px-3 py-6 text-center text-[12px] text-white/40">
                No modes yet.
              </div>
            )}
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto">
          {isCreating ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-6 max-w-2xl"
            >
              <h3 className="text-sm font-semibold mb-1">Create a mode</h3>
              <p className="text-[12px] text-white/50 mb-5">
                Pick a template — it controls the system prompt, default note sections, and behavior of the copilot.
              </p>

              <label className="block text-[11px] uppercase tracking-wider text-white/50 mb-1.5">Name</label>
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Customer Discovery Q2"
                className="w-full px-3 py-2 mb-5 text-[13px] bg-black/30 border border-white/10 rounded-lg outline-none focus:border-white/30 transition"
              />

              <label className="block text-[11px] uppercase tracking-wider text-white/50 mb-2">Template</label>
              <div className="grid grid-cols-2 gap-2 mb-6">
                {TEMPLATES.map(t => (
                  <button
                    key={t.type}
                    onClick={() => setNewTemplate(t.type)}
                    className={`text-left p-3 rounded-lg border transition ${
                      newTemplate === t.type
                        ? 'border-white/40 bg-white/5'
                        : 'border-white/10 hover:border-white/20 hover:bg-white/[0.03]'
                    }`}
                  >
                    <div className="text-[12px] font-semibold">{t.label}</div>
                    <div className="text-[11px] text-white/50 mt-1 leading-snug">{t.description}</div>
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleCreate}
                  className="px-4 py-2 text-[12px] font-medium rounded-lg bg-white text-black hover:bg-white/90 transition"
                >
                  Create
                </button>
                <button
                  onClick={() => { setIsCreating(false); setNewName(''); setError(null); }}
                  className="px-4 py-2 text-[12px] font-medium rounded-lg border border-white/10 hover:bg-white/5 transition"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          ) : selected ? (
            <div className="p-6">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  {isEditingName ? (
                    <input
                      autoFocus
                      value={draftName}
                      onChange={e => setDraftName(e.target.value)}
                      onBlur={() => setIsEditingName(false)}
                      onKeyDown={e => { if (e.key === 'Enter') setIsEditingName(false); }}
                      className="text-base font-semibold bg-black/30 border border-white/20 rounded px-2 py-0.5 outline-none"
                    />
                  ) : (
                    <h3 className="text-base font-semibold">{draftName || selected.name}</h3>
                  )}
                  <button
                    onClick={() => setIsEditingName(v => !v)}
                    className="p-1 rounded text-white/40 hover:text-white hover:bg-white/10 transition"
                    title="Rename"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-[10px] uppercase tracking-wider text-white/40 px-1.5 py-0.5 rounded bg-white/5">
                    {TEMPLATES.find(t => t.type === selected.templateType)?.label ?? selected.templateType}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {activeId === selected.id ? (
                    <button
                      onClick={() => handleActivate(null)}
                      className="px-3 py-1.5 text-[12px] font-medium rounded-lg border border-emerald-400/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 transition flex items-center gap-1.5"
                    >
                      <Check className="w-3.5 h-3.5" /> Active — Deactivate
                    </button>
                  ) : (
                    <button
                      onClick={() => handleActivate(selected.id)}
                      className="px-3 py-1.5 text-[12px] font-medium rounded-lg bg-white text-black hover:bg-white/90 transition"
                    >
                      Activate
                    </button>
                  )}
                  {selected.templateType !== 'general' && (
                    <button
                      onClick={() => handleDelete(selected.id)}
                      className="p-1.5 rounded-lg text-white/40 hover:text-red-400 hover:bg-red-500/10 transition"
                      title="Delete mode"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <p className="text-[12px] text-white/50 mb-6">
                {TEMPLATES.find(t => t.type === selected.templateType)?.description}
              </p>

              <section className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] uppercase tracking-wider text-white/50">Custom context</label>
                  <button
                    onClick={handleSaveContext}
                    className="px-2.5 py-1 text-[11px] font-medium rounded-md border border-white/10 hover:bg-white/5 flex items-center gap-1.5"
                  >
                    <Save className="w-3 h-3" /> Save
                  </button>
                </div>
                <textarea
                  value={draftContext}
                  onChange={e => setDraftContext(e.target.value)}
                  rows={6}
                  placeholder="Add any context the copilot should always know about — your role, your team, products, customers, etc."
                  className="w-full px-3 py-2.5 text-[12.5px] leading-relaxed bg-black/30 border border-white/10 rounded-lg outline-none focus:border-white/30 transition resize-none font-mono"
                />
              </section>

              <section>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] uppercase tracking-wider text-white/50">Reference files</label>
                  <button
                    onClick={handleUploadFile}
                    className="px-2.5 py-1 text-[11px] font-medium rounded-md border border-white/10 hover:bg-white/5 flex items-center gap-1.5"
                  >
                    <Plus className="w-3 h-3" /> Upload
                  </button>
                </div>
                <div className="space-y-1.5">
                  {files.map(f => (
                    <div key={f.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-white/[0.02]">
                      <FileText className="w-3.5 h-3.5 text-white/50 shrink-0" />
                      <span className="text-[12px] flex-1 truncate">{f.fileName}</span>
                      <span className="text-[10px] text-white/40">{(f.content?.length ?? 0).toLocaleString()} chars</span>
                      <button
                        onClick={() => handleDeleteFile(f.id)}
                        className="p-1 rounded text-white/40 hover:text-red-400 hover:bg-red-500/10 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  {files.length === 0 && (
                    <div className="text-[12px] text-white/40 px-3 py-2">No reference files uploaded.</div>
                  )}
                </div>
              </section>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-[13px] text-white/40">
              Select a mode to configure it.
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default ModesSettings;
