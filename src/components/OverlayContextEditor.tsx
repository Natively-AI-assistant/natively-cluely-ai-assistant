import React, { useEffect, useState } from 'react';
import { StickyNote, X } from 'lucide-react';
import { useT } from '../i18n';
import { OVERLAY_CONTEXT_MAX_CHARS } from '../../electron/services/context/overlayUserContext';

interface OverlayContextEditorProps {
  /** Text currently saved (what every prompt gets as <user_context>). */
  savedContext: string;
  onClose: () => void;
  /** Called with the new text after the main process confirmed the save. */
  onSaved: (content: string) => void;
  chipClass: string;
  inputClass: string;
  surfaceClass: string;
  chipStyle?: React.CSSProperties;
  surfaceStyle?: React.CSSProperties;
  inputStyle?: React.CSSProperties;
}

/**
 * Overlay "Context" panel: view, edit or clear the background text that is
 * injected into every answer prompt (overlay:get-context / overlay:save-context).
 */
export function OverlayContextEditor({
  savedContext,
  onClose,
  onSaved,
  chipClass,
  inputClass,
  surfaceClass,
  chipStyle,
  surfaceStyle,
  inputStyle,
}: OverlayContextEditorProps) {
  const t = useT();
  const [draft, setDraft] = useState(savedContext);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setDraft(savedContext); }, [savedContext]);

  const save = async (content: string) => {
    setSaving(true);
    setError(null);
    try {
      const res = await window.electronAPI.overlaySaveContext(content);
      if (!res.success) throw new Error(res.error ?? 'Save failed');
      onSaved(content);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`no-drag mx-3 mb-2 rounded-xl border p-3 ${surfaceClass}`} style={surfaceStyle}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <StickyNote className="w-3.5 h-3.5 opacity-70" />
          <span className="text-[12px] font-semibold overlay-text-primary">{t('Context')}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive"
          aria-label={t('Close context editor')}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <p className="text-[10px] overlay-text-muted mb-2 leading-relaxed">
        {t('Notes, job descriptions or prep material. Saved context is included with every prompt, so clear it when it no longer applies.')}
      </p>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, OVERLAY_CONTEXT_MAX_CHARS))}
        placeholder={t('Paste background context here…')}
        rows={6}
        className={`w-full rounded-lg px-3 py-2 text-[12px] resize-none leading-relaxed ${inputClass}`}
        style={inputStyle}
        autoFocus
      />
      {error && <p className="mt-2 text-[11px] text-red-400">{t('Could not save context:')} {error}</p>}
      <div className="flex items-center justify-between mt-2">
        <span
          className={`text-[10px] tabular-nums ${draft.length > OVERLAY_CONTEXT_MAX_CHARS * 0.9 ? 'text-amber-400' : 'overlay-text-muted'}`}
        >
          {draft.length}/{OVERLAY_CONTEXT_MAX_CHARS}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void save('')}
            disabled={saving || savedContext.length === 0}
            className={`${chipClass} disabled:opacity-40 disabled:cursor-not-allowed`}
            style={chipStyle}
          >
            {t('Clear')}
          </button>
          <button type="button" onClick={onClose} className={chipClass} style={chipStyle}>
            {t('Cancel')}
          </button>
          <button
            type="button"
            onClick={() => void save(draft)}
            disabled={saving || draft === savedContext}
            className="px-3 py-1.5 rounded-full text-[11px] font-medium bg-[#007AFF] text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? t('Saving…') : t('Save')}
          </button>
        </div>
      </div>
    </div>
  );
}
