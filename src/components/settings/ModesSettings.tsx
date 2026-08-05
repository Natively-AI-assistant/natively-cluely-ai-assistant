import { Check, Loader2, Plus, Trash2, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useT } from '../../i18n';

interface ModeRow {
  id: string;
  name: string;
  templateType: string;
  customContext: string;
  isActive: boolean;
  createdAt: string;
  referenceFileCount?: number;
}

interface ModesSettingsProps {
  onClose?: () => void;
}

const TEMPLATE_TYPES: Array<{ value: string; label: string }> = [
  { value: 'general', label: 'General' },
  { value: 'looking-for-work', label: 'Looking for work' },
  { value: 'sales', label: 'Sales' },
  { value: 'recruiting', label: 'Recruiting' },
  { value: 'team-meet', label: 'Team meeting' },
  { value: 'lecture', label: 'Lecture' },
  { value: 'technical-interview', label: 'Technical interview' },
];

const CUSTOM_CONTEXT_MAX = 8000;

const templateLabel = (value: string): string =>
  TEMPLATE_TYPES.find((tpl) => tpl.value === value)?.label ?? value;

export const ModesSettings: React.FC<ModesSettingsProps> = ({ onClose }) => {
  const t = useT();
  const [modes, setModes] = useState<ModeRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTemplate, setNewTemplate] = useState('general');
  const [draftName, setDraftName] = useState('');
  const [draftContext, setDraftContext] = useState('');
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(() => modes.find((m) => m.id === selectedId) ?? null, [modes, selectedId]);

  const refresh = useCallback(async () => {
    try {
      const rows = await window.electronAPI.modesGetAll?.();
      if (Array.isArray(rows)) {
        setModes(rows);
        setSelectedId((prev) => (prev && rows.some((r) => r.id === prev) ? prev : rows[0]?.id ?? null));
      }
    } catch { /* settings panel never throws */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (selected) {
      setDraftName(selected.name);
      setDraftContext(selected.customContext ?? '');
      setSavedAt(false);
      setError(null);
    }
  }, [selected]);

  const onCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true); setError(null);
    try {
      const res = await window.electronAPI.modesCreate?.({ name, templateType: newTemplate });
      if (res && res.success === false) { setError(res.error ?? t('Could not create mode.')); return; }
      setNewName(''); setNewTemplate('general'); setCreating(false);
      await refresh();
      if (res?.mode?.id) setSelectedId(res.mode.id);
    } catch (e: any) {
      setError(e?.message ?? t('Could not create mode.'));
    } finally { setBusy(false); }
  }, [newName, newTemplate, refresh, t]);

  const onSave = useCallback(async () => {
    if (!selected) return;
    const name = draftName.trim();
    if (!name) { setError(t('Name cannot be empty.')); return; }
    setBusy(true); setError(null); setSavedAt(false);
    try {
      const res = await window.electronAPI.modesUpdate?.(selected.id, {
        name,
        customContext: draftContext.slice(0, CUSTOM_CONTEXT_MAX),
      });
      if (res && res.success === false) { setError(res.error ?? t('Could not save changes.')); return; }
      setSavedAt(true);
      setTimeout(() => setSavedAt(false), 2000);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? t('Could not save changes.'));
    } finally { setBusy(false); }
  }, [selected, draftName, draftContext, refresh, t]);

  const onDelete = useCallback(async (mode: ModeRow) => {
    setBusy(true); setError(null);
    try {
      const res = await window.electronAPI.modesDelete?.(mode.id);
      if (res && res.success === false) { setError(res.error ?? t('Could not delete mode.')); return; }
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? t('Could not delete mode.'));
    } finally { setBusy(false); }
  }, [refresh, t]);

  const onSetActive = useCallback(async (id: string | null) => {
    setBusy(true); setError(null);
    try {
      const res = await window.electronAPI.modesSetActive?.(id);
      if (res && res.success === false) { setError(res.error ?? t('Could not switch mode.')); return; }
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? t('Could not switch mode.'));
    } finally { setBusy(false); }
  }, [refresh, t]);

  const dirty = selected != null && (draftName !== selected.name || (draftContext ?? '') !== (selected.customContext ?? ''));

  return (
    <div className="flex h-full flex-col bg-bg-main text-text-primary">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-6 py-4">
        <div className="min-w-0">
          <h3 className="text-lg font-bold text-text-primary">{t('Modes')}</h3>
          <p className="mt-0.5 text-xs text-text-secondary">
            {t('Tailor how Natively answers for sales calls, interviews, lectures, and more. All modes are available.')}
          </p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('Close')}
            className="inline-flex shrink-0 items-center justify-center rounded-lg border border-border-subtle p-1.5 text-text-secondary transition-colors hover:text-text-primary active:scale-[0.97] motion-reduce:active:scale-100"
          >
            <X size={15} />
          </button>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ── Mode list ─────────────────────────────────────────── */}
        <div className="flex w-64 shrink-0 flex-col border-r border-border-subtle">
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {modes.map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => setSelectedId(mode.id)}
                className={`flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition-colors ${mode.id === selectedId ? 'bg-bg-item-active' : 'hover:bg-bg-item-active/60'}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-medium text-text-primary">{mode.name}</span>
                    {mode.isActive ? (
                      <span className="inline-flex shrink-0 items-center rounded-full border border-green-500/30 bg-green-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-green-400">{t('Active')}</span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-text-tertiary">{templateLabel(mode.templateType)}</div>
                </div>
              </button>
            ))}
            {!modes.length ? (
              <div className="px-3 py-6 text-center text-[11px] text-text-tertiary">{t('No modes yet. Create one below.')}</div>
            ) : null}
          </div>

          <div className="shrink-0 border-t border-border-subtle p-3">
            {creating ? (
              <div className="space-y-2">
                <input
                  type="text"
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void onCreate(); if (e.key === 'Escape') setCreating(false); }}
                  placeholder={t('Mode name')}
                  className="w-full rounded-lg border border-border-subtle bg-bg-input px-3 py-2 text-xs text-text-primary transition-colors focus:border-accent-primary focus:outline-none"
                />
                <select
                  value={newTemplate}
                  onChange={(e) => setNewTemplate(e.target.value)}
                  className="w-full rounded-lg border border-border-subtle bg-bg-input px-3 py-2 text-xs text-text-primary transition-colors focus:border-accent-primary focus:outline-none"
                >
                  {TEMPLATE_TYPES.map((tpl) => (
                    <option key={tpl.value} value={tpl.value}>{t(tpl.label)}</option>
                  ))}
                </select>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onCreate}
                    disabled={busy || !newName.trim()}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent-primary px-3 py-1.5 text-xs font-medium text-white transition-[opacity,transform] active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100 motion-reduce:active:scale-100"
                  >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                    {t('Create')}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setCreating(false); setNewName(''); }}
                    className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary"
                  >
                    {t('Cancel')}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setCreating(true); setError(null); }}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary active:scale-[0.98] motion-reduce:active:scale-100"
              >
                <Plus size={14} /> {t('New Mode')}
              </button>
            )}
          </div>
        </div>

        {/* ── Editor ────────────────────────────────────────────── */}
        <div className="min-w-0 flex-1 overflow-y-auto p-6">
          {selected ? (
            <div className="max-w-xl space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold text-text-primary">{templateLabel(selected.templateType)}</h4>
                  <p className="mt-0.5 text-[11px] text-text-secondary">
                    {selected.isActive ? t('This mode is active.') : t('Set this mode active to steer answers toward it.')}
                  </p>
                </div>
                {selected.isActive ? (
                  <button
                    type="button"
                    onClick={() => onSetActive(null)}
                    disabled={busy}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100 motion-reduce:active:scale-100"
                  >
                    {t('Deactivate')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSetActive(selected.id)}
                    disabled={busy}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent-primary px-3 py-1.5 text-xs font-medium text-white transition-[opacity,transform] active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100 motion-reduce:active:scale-100"
                  >
                    {t('Set active')}
                  </button>
                )}
              </div>

              <label className="block space-y-1">
                <span className="text-[10px] font-medium uppercase tracking-wide text-text-secondary">{t('Name')}</span>
                <input
                  type="text"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  className="w-full rounded-lg border border-border-subtle bg-bg-input px-3 py-2 text-xs text-text-primary transition-colors focus:border-accent-primary focus:outline-none"
                />
              </label>

              <label className="block space-y-1">
                <span className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wide text-text-secondary">
                  <span>{t('Custom Context & Notes')}</span>
                  <span className="normal-case text-text-tertiary">{draftContext.length.toLocaleString()} / {CUSTOM_CONTEXT_MAX.toLocaleString()}</span>
                </span>
                <textarea
                  value={draftContext}
                  onChange={(e) => setDraftContext(e.target.value.slice(0, CUSTOM_CONTEXT_MAX))}
                  rows={10}
                  placeholder={t('Anything the AI should always know in this mode — product details, your background, tone, key facts.')}
                  className="w-full resize-y rounded-lg border border-border-subtle bg-bg-input px-3 py-2 text-xs leading-relaxed text-text-primary transition-colors focus:border-accent-primary focus:outline-none"
                />
                <span className="block text-[11px] leading-relaxed text-text-secondary">
                  {t('Injected into the prompt while this mode is active, so answers stay grounded in what matters to you.')}
                </span>
              </label>

              {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-400">{error}</div> : null}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onSave}
                  disabled={busy || !dirty}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent-primary px-3 py-1.5 text-xs font-medium text-white transition-[opacity,transform] active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100 motion-reduce:active:scale-100"
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : savedAt ? <Check size={14} /> : null}
                  {savedAt ? t('Saved') : t('Save changes')}
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(selected)}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-red-500/40 hover:text-red-400 active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100 motion-reduce:active:scale-100"
                >
                  <Trash2 size={14} /> {t('Delete')}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-center text-xs text-text-tertiary">
              {t('Select a mode to edit, or create a new one.')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ModesSettings;
