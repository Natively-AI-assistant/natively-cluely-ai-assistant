import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BriefcaseBusiness,
  Building2,
  Check,
  FileText,
  Library,
  Loader2,
  Pencil,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
} from 'lucide-react';
import { useT } from '../../i18n';
import {
  INTERVIEW_CONTEXT_KINDS,
  type InterviewContextKind,
  type InterviewContextRendererState,
} from '../../../shared/interviewContext';

type Drafts = Record<InterviewContextKind, string>;
type BusyState = Partial<Record<InterviewContextKind | 'global', 'save' | 'upload' | 'clear' | 'toggle' | 'select' | 'rename'>>;

const EMPTY_DRAFTS: Drafts = { personal: '', professional: '', company: '' };

const CATEGORY_CONFIG: Record<InterviewContextKind, {
  title: string;
  description: string;
  placeholder: string;
  icon: React.ReactNode;
  accent: string;
}> = {
  personal: {
    title: 'Personal profile',
    description: 'Your introduction, goals, values, communication style, strengths, and preferences.',
    placeholder: 'Add information about yourself, how you work, and how you would like to introduce yourself...',
    icon: <UserRound size={18} />,
    accent: 'text-sky-500 bg-sky-500/10 border-sky-500/20',
  },
  professional: {
    title: 'Professional profile',
    description: 'Resume, experience, projects, technologies, results, and real professional stories.',
    placeholder: 'Add your resume, projects, experience, and professional results...',
    icon: <BriefcaseBusiness size={18} />,
    accent: 'text-violet-500 bg-violet-500/10 border-violet-500/20',
  },
  company: {
    title: 'Company and role',
    description: 'Job description, product, culture, requirements, team, and relevant company information.',
    placeholder: 'Add the job description and company context, or upload a document...',
    icon: <Building2 size={18} />,
    accent: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20',
  },
};

const entryCount = (state: InterviewContextRendererState | null): number =>
  state ? INTERVIEW_CONTEXT_KINDS.filter((kind) => Boolean(state.entries[kind]?.content.trim())).length : 0;

const formatCount = (value: number): string => new Intl.NumberFormat().format(value);

export const InterviewContextSettings: React.FC = () => {
  const t = useT();
  const [state, setState] = useState<InterviewContextRendererState | null>(null);
  const [drafts, setDrafts] = useState<Drafts>(EMPTY_DRAFTS);
  const [dirty, setDirty] = useState<Partial<Record<InterviewContextKind, boolean>>>({});
  const dirtyRef = useRef(dirty);
  const [busy, setBusy] = useState<BusyState>({});
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [companyLabelDraft, setCompanyLabelDraft] = useState('');

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const applyState = useCallback((next: InterviewContextRendererState, preserveDirty = false) => {
    setState(next);
    setDrafts((current) => {
      const updated = { ...current };
      for (const kind of INTERVIEW_CONTEXT_KINDS) {
        if (!preserveDirty || !dirtyRef.current[kind]) updated[kind] = next.entries[kind]?.content ?? '';
      }
      return updated;
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    window.electronAPI.interviewContextGet()
      .then((result) => {
        if (!mounted) return;
        if (result.success && result.state) applyState(result.state);
        else setNotice({ type: 'error', text: result.error ? t(result.error) : t('Could not load the interview context.') });
      })
      .catch(() => mounted && setNotice({ type: 'error', text: t('Could not load the interview context.') }));

    return () => {
      mounted = false;
    };
  }, [applyState, t]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const loadedCount = useMemo(() => entryCount(state), [state]);
  const activeCompanyDocument = useMemo(() => {
    if (!state?.activeCompanyDocumentId) return null;
    return state.companyDocuments.find((document) => document.id === state.activeCompanyDocumentId) ?? null;
  }, [state]);
  const companyLabelDirty = Boolean(activeCompanyDocument)
    && companyLabelDraft.trim() !== activeCompanyDocument?.label;

  useEffect(() => {
    setCompanyLabelDraft(activeCompanyDocument?.label ?? '');
  }, [activeCompanyDocument?.id, activeCompanyDocument?.label]);

  const setKindBusy = (kind: InterviewContextKind | 'global', value?: BusyState[InterviewContextKind]) => {
    setBusy((current) => {
      const next = { ...current };
      if (value) next[kind] = value;
      else delete next[kind];
      return next;
    });
  };

  const handleToggle = async () => {
    if (!state || busy.global) return;
    setKindBusy('global', 'toggle');
    const result = await window.electronAPI.interviewContextSetEnabled(!state.enabled).catch(() => null);
    setKindBusy('global');
    if (result?.success && result.state) {
      applyState(result.state, true);
      setNotice({ type: 'success', text: result.state.enabled ? t('Context enabled for responses.') : t('Context paused.') });
    } else {
      setNotice({ type: 'error', text: result?.error ? t(result.error) : t('Could not update the interview context.') });
    }
  };

  const handleSave = async (kind: InterviewContextKind) => {
    if (busy[kind]) return;
    setKindBusy(kind, 'save');
    const result = await window.electronAPI.interviewContextUpdateText(kind, drafts[kind]).catch(() => null);
    setKindBusy(kind);
    if (result?.success && result.state) {
      setDirty((current) => ({ ...current, [kind]: false }));
      applyState(result.state);
      setNotice({ type: 'success', text: t(`${CATEGORY_CONFIG[kind].title} saved.`) });
    } else {
      setNotice({ type: 'error', text: result?.error ? t(result.error) : t('Could not save the text.') });
    }
  };

  const handleUpload = async (kind: InterviewContextKind) => {
    if (busy[kind]) return;
    if (dirty[kind]
        && !window.confirm(t('There are unsaved changes. Discard them and import a document?'))) return;
    setKindBusy(kind, 'upload');
    const result = await window.electronAPI.interviewContextImportFile(kind).catch(() => null);
    setKindBusy(kind);
    if (result?.cancelled) return;
    if (result?.success && result.state) {
      setDirty((current) => ({ ...current, [kind]: false }));
      applyState(result.state);
      setNotice({
        type: 'success',
        text: kind === 'company'
          ? t('Document added to the collection and selected for this interview.')
          : t(`${CATEGORY_CONFIG[kind].title} imported successfully.`),
      });
    } else {
      setNotice({ type: 'error', text: result?.error ? t(result.error) : t('Could not import the document.') });
    }
  };

  const handleClear = async (kind: InterviewContextKind) => {
    if (busy[kind] || !state?.entries[kind]) return;
    const confirmation = kind === 'company'
      ? t('Remove this document from the collection?')
      : t(`Remove the contents of “${CATEGORY_CONFIG[kind].title}”?`);
    if (!window.confirm(confirmation)) return;
    setKindBusy(kind, 'clear');
    const result = await window.electronAPI.interviewContextClear(kind).catch(() => null);
    setKindBusy(kind);
    if (result?.success && result.state) {
      setDirty((current) => ({ ...current, [kind]: false }));
      applyState(result.state);
      setNotice({ type: 'success', text: kind === 'company' ? t('Document removed from the collection.') : t('Context removed.') });
    } else {
      setNotice({ type: 'error', text: result?.error ? t(result.error) : t('Could not remove the context.') });
    }
  };

  const handleSelectCompanyDocument = async (id: string | null) => {
    if (busy.company || !state) return;
    if (dirty.company && !window.confirm(t('There are unsaved changes. Discard them and switch company context?'))) return;
    setKindBusy('company', 'select');
    const result = await window.electronAPI.interviewContextSelectCompanyDocument(id).catch(() => null);
    setKindBusy('company');
    if (result?.success && result.state) {
      setDirty((current) => ({ ...current, company: false }));
      applyState(result.state);
      const selected = id
        ? result.state.companyDocuments.find((document) => document.id === id)?.label
        : null;
      setNotice({
        type: 'success',
        text: selected ? `${selected} — ${t('used for responses')}` : t('Company context paused.'),
      });
    } else {
      setNotice({ type: 'error', text: result?.error ? t(result.error) : t('Could not switch the company context.') });
    }
  };

  const handleRenameCompanyDocument = async () => {
    if (!activeCompanyDocument || busy.company || !companyLabelDirty) return;
    setKindBusy('company', 'rename');
    const result = await window.electronAPI
      .interviewContextRenameCompanyDocument(activeCompanyDocument.id, companyLabelDraft)
      .catch(() => null);
    setKindBusy('company');
    if (result?.success && result.state) {
      applyState(result.state, true);
      setNotice({ type: 'success', text: t('Context name updated.') });
    } else {
      setNotice({ type: 'error', text: result?.error ? t(result.error) : t('Could not rename this context.') });
    }
  };

  if (!state) {
    return (
      <div className="h-full flex items-center justify-center text-text-secondary">
        <Loader2 size={20} className="animate-spin mr-2" /> {t('Loading interview context…')}
      </div>
    );
  }

  return (
    <div className="space-y-5 animated fadeIn pb-6">
      <div className="flex items-start justify-between gap-6">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <h3 className="text-lg font-bold text-text-primary">{t('Interview Context')}</h3>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${state.enabled && loadedCount > 0
              ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20'
              : 'text-text-tertiary bg-bg-subtle border-border-subtle'}`}>
              {state.enabled && loadedCount > 0
                ? `${loadedCount}/3 ${t('active')}`
                : state.enabled
                  ? t('Waiting for content')
                  : t('Paused')}
            </span>
          </div>
          <p className="text-xs text-text-secondary leading-relaxed max-w-xl">
            {t('Information used to personalize live answers and chat responses. The AI selects only the relevant excerpts for each question.')}
          </p>
        </div>

        <button
          type="button"
          onClick={handleToggle}
          disabled={Boolean(busy.global)}
          className="flex items-center gap-2 shrink-0"
          aria-label={state.enabled ? t('Disable interview context') : t('Enable interview context')}
        >
          <span className={`text-xs font-medium ${state.enabled ? 'text-emerald-500' : 'text-text-tertiary'}`}>
            {state.enabled ? t('Enabled') : t('Disabled')}
          </span>
          <span className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${state.enabled ? 'bg-emerald-500' : 'bg-bg-subtle border border-border-subtle'}`}>
            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${state.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </span>
        </button>
      </div>

      <div className="rounded-xl border border-blue-500/15 bg-blue-500/[0.06] p-3.5 flex items-start gap-3">
        <ShieldCheck size={17} className="text-blue-500 mt-0.5 shrink-0" />
        <div>
          <p className="text-xs font-semibold text-text-primary mb-0.5">{t('Local storage')}</p>
          <p className="text-[11px] text-text-secondary leading-relaxed">
            {t('Original documents are not copied. Only extracted text is stored on this device and sent to your chosen AI provider when you ask a question.')}
          </p>
        </div>
      </div>

      {notice && (
        <div className={`rounded-lg border px-3.5 py-2.5 flex items-center gap-2 text-xs ${notice.type === 'success'
          ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-500'
          : 'border-red-500/20 bg-red-500/10 text-red-500'}`}>
          {notice.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}
          {notice.text}
        </div>
      )}

      <div className="space-y-4">
        {INTERVIEW_CONTEXT_KINDS.filter((kind) => kind !== 'company').map((kind) => {
          const config = CATEGORY_CONFIG[kind];
          const entry = state.entries[kind];
          const isDirty = dirty[kind] === true;
          const operation = busy[kind];
          return (
            <section key={kind} className="rounded-xl border border-border-subtle bg-bg-card overflow-hidden">
              <div className="p-4 flex items-start justify-between gap-4 border-b border-border-subtle">
                <div className="flex items-start gap-3 min-w-0">
                  <div className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${config.accent}`}>
                    {config.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <h4 className="text-sm font-semibold text-text-primary">{t(config.title)}</h4>
                      {entry && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-text-tertiary min-w-0">
                          <FileText size={11} />
                          <span className="truncate max-w-[190px]">{entry.fileName || t('Entered text')}</span>
                          <span>· {formatCount(entry.charCount)} {t('characters')}</span>
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-text-secondary mt-1 leading-relaxed">{t(config.description)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleUpload(kind)}
                    disabled={Boolean(operation)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-subtle bg-bg-input text-[11px] font-medium text-text-secondary hover:text-text-primary hover:bg-bg-item-active transition-colors disabled:opacity-50"
                  >
                    {operation === 'upload' ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                    {t('Upload file')}
                  </button>
                  {entry && (
                    <button
                      type="button"
                      onClick={() => handleClear(kind)}
                      disabled={Boolean(operation)}
                      className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                      aria-label={`${t('Remove')} ${t(config.title)}`}
                    >
                      {operation === 'clear' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  )}
                </div>
              </div>

              <div className="p-4">
                <textarea
                  value={drafts[kind]}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDrafts((current) => ({ ...current, [kind]: value }));
                    setDirty((current) => ({ ...current, [kind]: value !== (state.entries[kind]?.content ?? '') }));
                  }}
                  placeholder={t(config.placeholder)}
                  spellCheck
                  className="w-full min-h-[116px] max-h-[260px] resize-y rounded-lg border border-border-subtle bg-bg-input px-3 py-2.5 text-xs leading-relaxed text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary/50 focus:ring-2 focus:ring-accent-primary/10 transition-all"
                />
                <div className="mt-2.5 flex items-center justify-between gap-3">
                  <p className="text-[10px] text-text-tertiary">
                    {t('PDF, DOCX, TXT, Markdown, JSON, or CSV · up to 50 MB')}
                  </p>
                  <button
                    type="button"
                    onClick={() => handleSave(kind)}
                    disabled={!isDirty || Boolean(operation)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-primary text-white text-[11px] font-semibold hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {operation === 'save' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                    {t('Save text')}
                  </button>
                </div>
              </div>
            </section>
          );
        })}

        <section className="rounded-xl border border-border-subtle bg-bg-card overflow-hidden">
          <div className="p-4 flex items-start justify-between gap-4 border-b border-border-subtle">
            <div className="flex items-start gap-3 min-w-0">
              <div className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${CATEGORY_CONFIG.company.accent}`}>
                {CATEGORY_CONFIG.company.icon}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-sm font-semibold text-text-primary">{t(CATEGORY_CONFIG.company.title)}</h4>
                  <span className="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-bg-input px-2 py-0.5 text-[10px] text-text-tertiary">
                    <Library size={10} /> {state.companyDocuments.length} {t('in the collection')}
                  </span>
                  {activeCompanyDocument && (
                    <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-500">
                      {t('Used for responses')}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-text-secondary mt-1 leading-relaxed">
                  {t('Keep one document per company or role and choose which context is active for this interview.')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => handleUpload('company')}
                disabled={Boolean(busy.company)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-subtle bg-bg-input text-[11px] font-medium text-text-secondary hover:text-text-primary hover:bg-bg-item-active transition-colors disabled:opacity-50"
              >
                {busy.company === 'upload' ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                {t('Add document')}
              </button>
              {activeCompanyDocument && (
                <button
                  type="button"
                  onClick={() => handleClear('company')}
                  disabled={Boolean(busy.company)}
                  className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                  aria-label={`${t('Remove')} ${activeCompanyDocument.label} ${t('from the collection')}`}
                >
                  {busy.company === 'clear' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                </button>
              )}
            </div>
          </div>

          <div className="p-4 space-y-4">
            <div>
              <label htmlFor="active-company-context" className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary mb-1.5">
                {t('Context active for this interview')}
              </label>
              <select
                id="active-company-context"
                value={state.activeCompanyDocumentId ?? ''}
                onChange={(event) => handleSelectCompanyDocument(event.target.value || null)}
                disabled={Boolean(busy.company)}
                className="w-full h-10 rounded-lg border border-border-subtle bg-bg-input px-3 text-xs font-medium text-text-primary focus:outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/10 transition-all disabled:opacity-50"
              >
                <option value="">{t('No company selected')}</option>
                {state.companyDocuments.map((document) => (
                  <option key={document.id} value={document.id}>{document.label}</option>
                ))}
              </select>
              <p className="mt-1.5 text-[10px] text-text-tertiary">
                {t('Only the selected item is sent to the AI provider with each question.')}
              </p>
            </div>

            {activeCompanyDocument && (
              <div className="rounded-lg border border-emerald-500/15 bg-emerald-500/[0.04] p-3">
                <div className="flex items-end gap-2">
                  <label className="flex-1 min-w-0">
                    <span className="block text-[10px] font-medium text-text-secondary mb-1.5">{t('Name in collection')}</span>
                    <input
                      value={companyLabelDraft}
                      onChange={(event) => setCompanyLabelDraft(event.target.value)}
                      maxLength={120}
                      className="w-full h-9 rounded-lg border border-border-subtle bg-bg-input px-3 text-xs text-text-primary focus:outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/10 transition-all"
                      aria-label={t('Company context name')}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleRenameCompanyDocument}
                    disabled={!companyLabelDirty || Boolean(busy.company)}
                    className="h-9 inline-flex items-center gap-1.5 px-3 rounded-lg border border-border-subtle bg-bg-input text-[11px] font-medium text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40"
                  >
                    {busy.company === 'rename' ? <Loader2 size={13} className="animate-spin" /> : <Pencil size={12} />}
                    {t('Rename')}
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-1.5 text-[10px] text-text-tertiary">
                  <FileText size={11} />
                  <span className="truncate">{activeCompanyDocument.fileName || t('Text entered manually')}</span>
                  <span>· {formatCount(activeCompanyDocument.charCount)} {t('characters')}</span>
                </div>
              </div>
            )}

            {!activeCompanyDocument && state.companyDocuments.length === 0 && (
              <div className="rounded-lg border border-dashed border-border-subtle bg-bg-input/40 px-4 py-4 text-center">
                <Library size={18} className="mx-auto text-text-tertiary mb-1.5" />
                <p className="text-xs font-medium text-text-secondary">{t('Your company context collection is empty')}</p>
                <p className="text-[10px] text-text-tertiary mt-1">{t('Add a document or enter the first context below.')}</p>
              </div>
            )}

            <div>
              <textarea
                value={drafts.company}
                onChange={(event) => {
                  const value = event.target.value;
                  setDrafts((current) => ({ ...current, company: value }));
                  setDirty((current) => ({ ...current, company: value !== (state.entries.company?.content ?? '') }));
                }}
                placeholder={activeCompanyDocument
                  ? t('Review or expand the context for this company and role...')
                  : t('Add context for a new company and role...')}
                spellCheck
                className="w-full min-h-[116px] max-h-[260px] resize-y rounded-lg border border-border-subtle bg-bg-input px-3 py-2.5 text-xs leading-relaxed text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/10 transition-all"
              />
              <div className="mt-2.5 flex items-center justify-between gap-3">
                <p className="text-[10px] text-text-tertiary">
                  {t('PDF, DOCX, TXT, Markdown, JSON, or CSV · up to 50 MB')}
                </p>
                <button
                  type="button"
                  onClick={() => handleSave('company')}
                  disabled={!dirty.company || Boolean(busy.company)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-[11px] font-semibold hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {busy.company === 'save' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  {activeCompanyDocument ? t('Save changes') : t('Create context manually')}
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
