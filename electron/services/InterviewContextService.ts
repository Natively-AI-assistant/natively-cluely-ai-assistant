import { app } from 'electron';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  INTERVIEW_CONTEXT_KINDS,
  isInterviewContextKind,
  type InterviewCompanyDocument,
  type InterviewContextEntry,
  type InterviewContextKind,
  type InterviewContextPromptBundle,
  type InterviewContextRendererState,
  type InterviewContextState,
} from '../../shared/interviewContext';
import {
  buildInterviewContextPrompt,
  DEFAULT_INTERVIEW_PROMPT_MAX_CHARS,
} from './interviewContextPrompt';

const STATE_VERSION = 2 as const;
const PERSISTED_FILE_NAME = 'interview-context.json';
const MAX_STORED_CHARS_PER_ENTRY = 1_000_000;
const MAX_MANUAL_TEXT_CHARS = 200_000;
const MAX_COMPANY_DOCUMENTS = 40;
const MAX_COMPANY_LABEL_CHARS = 120;
const TRUNCATION_NOTICE = '\n\n[Document truncated at the local storage limit]';

const TITLES: Record<InterviewContextKind, string> = {
  personal: 'Personal profile',
  professional: 'Professional profile',
  company: 'Company and role',
};

const emptyEntries = (): InterviewContextState['entries'] => ({
  personal: null,
  professional: null,
  company: null,
});

const defaultState = (): InterviewContextState => ({
  version: STATE_VERSION,
  enabled: true,
  entries: emptyEntries(),
  companyDocuments: [],
  activeCompanyDocumentId: null,
  updatedAt: new Date(0).toISOString(),
});

const normalizeStoredText = (value: string): string => value
  .replace(/\r\n?/g, '\n')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  .replace(/[ \t]+\n/g, '\n')
  .trim();

const cloneState = (state: InterviewContextState): InterviewContextState =>
  JSON.parse(JSON.stringify(state)) as InterviewContextState;

const safeTimestamp = (value: unknown, fallback = new Date().toISOString()): string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : fallback;

const defaultCompanyLabel = (fileName?: string, fallback = 'Company context'): string => {
  const base = fileName ? path.basename(fileName, path.extname(fileName)) : fallback;
  return base.trim().slice(0, MAX_COMPANY_LABEL_CHARS) || fallback;
};

const stableDocumentId = (content: string, fileName?: string, suffix = ''): string => {
  const digest = crypto.createHash('sha256').update(`${fileName || ''}\0${content}\0${suffix}`).digest('hex').slice(0, 16);
  return `company-${digest}`;
};

const sanitizeEntry = (
  kind: InterviewContextKind,
  value: unknown,
): InterviewContextEntry | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.content !== 'string') return null;
  let content = normalizeStoredText(raw.content).slice(0, MAX_STORED_CHARS_PER_ENTRY);
  if (!content) return null;
  const updatedAt = typeof raw.updatedAt === 'string' && !Number.isNaN(Date.parse(raw.updatedAt))
    ? raw.updatedAt
    : new Date().toISOString();
  const sourceType = raw.sourceType === 'file' ? 'file' : 'text';
  const fileName = sourceType === 'file' && typeof raw.fileName === 'string'
    ? path.basename(raw.fileName).slice(0, 240)
    : undefined;
  return {
    kind,
    title: TITLES[kind],
    sourceType,
    ...(fileName ? { fileName } : {}),
    content,
    charCount: content.length,
    truncated: raw.truncated === true || raw.content.length > MAX_STORED_CHARS_PER_ENTRY,
    updatedAt,
  };
};

const entryToCompanyDocument = (
  entry: InterviewContextEntry,
  options: { id?: string; label?: string; createdAt?: string } = {},
): InterviewCompanyDocument => ({
  id: options.id ?? `company-${crypto.randomUUID()}`,
  label: (options.label?.trim().slice(0, MAX_COMPANY_LABEL_CHARS)) || defaultCompanyLabel(entry.fileName),
  sourceType: entry.sourceType,
  ...(entry.fileName ? { fileName: entry.fileName } : {}),
  content: entry.content,
  charCount: entry.content.length,
  ...(entry.truncated ? { truncated: true } : {}),
  createdAt: options.createdAt ?? entry.updatedAt,
  updatedAt: entry.updatedAt,
});

const companyDocumentToEntry = (document: InterviewCompanyDocument): InterviewContextEntry => ({
  kind: 'company',
  title: TITLES.company,
  sourceType: document.sourceType,
  ...(document.fileName ? { fileName: document.fileName } : {}),
  content: document.content,
  charCount: document.content.length,
  ...(document.truncated ? { truncated: true } : {}),
  updatedAt: document.updatedAt,
});

const sanitizeCompanyDocument = (value: unknown, index: number): InterviewCompanyDocument | null => {
  const entry = sanitizeEntry('company', value);
  if (!entry || !value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const rawId = typeof raw.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(raw.id) ? raw.id : null;
  const label = typeof raw.label === 'string'
    ? raw.label.trim().slice(0, MAX_COMPANY_LABEL_CHARS)
    : '';
  return entryToCompanyDocument(entry, {
    id: rawId ?? stableDocumentId(entry.content, entry.fileName, String(index)),
    label: label || defaultCompanyLabel(entry.fileName, `Company ${index + 1}`),
    createdAt: safeTimestamp(raw.createdAt, entry.updatedAt),
  });
};

const syncActiveCompanyEntry = (state: InterviewContextState): void => {
  const active = state.activeCompanyDocumentId
    ? state.companyDocuments.find((document) => document.id === state.activeCompanyDocumentId)
    : null;
  state.entries.company = active ? companyDocumentToEntry(active) : null;
};

const sanitizeState = (value: unknown): InterviewContextState => {
  const fallback = defaultState();
  if (!value || typeof value !== 'object') return fallback;
  const raw = value as Record<string, unknown>;
  const rawEntries = raw.entries && typeof raw.entries === 'object'
    ? raw.entries as Record<string, unknown>
    : {};
  const entries = emptyEntries();
  entries.personal = sanitizeEntry('personal', rawEntries.personal);
  entries.professional = sanitizeEntry('professional', rawEntries.professional);

  const companyDocuments: InterviewCompanyDocument[] = [];
  const seenIds = new Set<string>();
  if (Array.isArray(raw.companyDocuments)) {
    for (const [index, candidate] of raw.companyDocuments.slice(0, MAX_COMPANY_DOCUMENTS).entries()) {
      const document = sanitizeCompanyDocument(candidate, index);
      if (!document) continue;
      if (seenIds.has(document.id)) document.id = stableDocumentId(document.content, document.fileName, `${index}-duplicate`);
      seenIds.add(document.id);
      companyDocuments.push(document);
    }
  }

  // Version 1 stored a single company entry. Promote it into the library without
  // losing content, then make it the active selection.
  const legacyCompany = sanitizeEntry('company', rawEntries.company);
  if (companyDocuments.length === 0 && legacyCompany) {
    const migrated = entryToCompanyDocument(legacyCompany, {
      id: stableDocumentId(legacyCompany.content, legacyCompany.fileName, 'v1-migration'),
      label: defaultCompanyLabel(legacyCompany.fileName),
      createdAt: legacyCompany.updatedAt,
    });
    companyDocuments.push(migrated);
  }

  const hasStoredActiveSelection = Object.prototype.hasOwnProperty.call(raw, 'activeCompanyDocumentId');
  const requestedActiveId = typeof raw.activeCompanyDocumentId === 'string'
    ? raw.activeCompanyDocumentId
    : null;
  const activeCompanyDocumentId = requestedActiveId && companyDocuments.some((document) => document.id === requestedActiveId)
    ? requestedActiveId
    : hasStoredActiveSelection && raw.activeCompanyDocumentId === null
      ? null
      : companyDocuments[0]?.id ?? null;

  const state: InterviewContextState = {
    version: STATE_VERSION,
    enabled: raw.enabled !== false,
    entries,
    companyDocuments,
    activeCompanyDocumentId,
    updatedAt: typeof raw.updatedAt === 'string' && !Number.isNaN(Date.parse(raw.updatedAt))
      ? raw.updatedAt
      : fallback.updatedAt,
  };
  syncActiveCompanyEntry(state);
  return state;
};

export class InterviewContextService {
  private static instance: InterviewContextService | null = null;
  private readonly statePath: string;
  private state: InterviewContextState;

  private constructor(statePath?: string) {
    this.statePath = statePath ?? path.join(app.getPath('userData'), PERSISTED_FILE_NAME);
    this.state = this.loadState();
  }

  public static getInstance(): InterviewContextService {
    if (!InterviewContextService.instance) {
      InterviewContextService.instance = new InterviewContextService();
    }
    return InterviewContextService.instance;
  }

  /** Isolated constructor for deterministic persistence tests. */
  public static createForTesting(statePath: string): InterviewContextService {
    return new InterviewContextService(statePath);
  }

  public getState(): InterviewContextState {
    return cloneState(this.state);
  }

  public getRendererState(): InterviewContextRendererState {
    const companyDocuments = this.state.companyDocuments.map(({ content: _content, ...summary }) => summary);
    return JSON.parse(JSON.stringify({
      ...this.state,
      companyDocuments,
    })) as InterviewContextRendererState;
  }

  public setEnabled(enabled: boolean): InterviewContextRendererState {
    if (typeof enabled !== 'boolean') throw new Error('enabled must be boolean');
    this.state.enabled = enabled;
    this.touchAndPersist();
    return this.getRendererState();
  }

  public updateText(kindValue: unknown, rawText: unknown): InterviewContextRendererState {
    const kind = this.requireKind(kindValue);
    if (typeof rawText !== 'string') throw new Error('text must be a string');
    if (rawText.length > MAX_MANUAL_TEXT_CHARS) {
      throw new Error(`text exceeds ${MAX_MANUAL_TEXT_CHARS.toLocaleString('en-US')} character limit`);
    }
    const content = normalizeStoredText(rawText);
    if (kind === 'company') {
      this.updateActiveCompanyText(content);
    } else if (!content) {
      this.state.entries[kind] = null;
    } else {
      const now = new Date().toISOString();
      this.state.entries[kind] = {
        kind,
        title: TITLES[kind],
        sourceType: 'text',
        content,
        charCount: content.length,
        updatedAt: now,
      };
    }
    this.touchAndPersist();
    return this.getRendererState();
  }

  public async importFile(kindValue: unknown, selectedPath: string): Promise<InterviewContextRendererState> {
    const kind = this.requireKind(kindValue);
    if (kind === 'company') this.assertCompanyDocumentCapacity();
    const { extractReferenceDocument } = await import('./ModeReferenceFileIngestion');
    const extracted = await extractReferenceDocument(selectedPath);
    const normalized = normalizeStoredText(extracted.content);
    const truncated = normalized.length > MAX_STORED_CHARS_PER_ENTRY;
    const content = truncated
      ? `${normalized.slice(0, MAX_STORED_CHARS_PER_ENTRY - TRUNCATION_NOTICE.length)}${TRUNCATION_NOTICE}`
      : normalized;
    const now = new Date().toISOString();
    const entry: InterviewContextEntry = {
      kind,
      title: TITLES[kind],
      sourceType: 'file',
      fileName: extracted.fileName,
      content,
      charCount: content.length,
      truncated,
      updatedAt: now,
    };
    if (kind === 'company') {
      const document = entryToCompanyDocument(entry);
      this.state.companyDocuments.push(document);
      this.state.activeCompanyDocumentId = document.id;
      syncActiveCompanyEntry(this.state);
    } else {
      this.state.entries[kind] = entry;
    }
    this.touchAndPersist();
    return this.getRendererState();
  }

  public clear(kindValue: unknown): InterviewContextRendererState {
    const kind = this.requireKind(kindValue);
    if (kind === 'company') {
      const activeId = this.state.activeCompanyDocumentId;
      if (activeId) this.state.companyDocuments = this.state.companyDocuments.filter((document) => document.id !== activeId);
      this.state.activeCompanyDocumentId = null;
      syncActiveCompanyEntry(this.state);
    } else {
      this.state.entries[kind] = null;
    }
    this.touchAndPersist();
    return this.getRendererState();
  }

  public selectCompanyDocument(idValue: unknown): InterviewContextRendererState {
    if (idValue === null || idValue === '') {
      this.state.activeCompanyDocumentId = null;
      syncActiveCompanyEntry(this.state);
      this.touchAndPersist();
      return this.getRendererState();
    }
    const id = this.requireCompanyDocumentId(idValue);
    if (!this.state.companyDocuments.some((document) => document.id === id)) {
      throw new Error('company document not found');
    }
    this.state.activeCompanyDocumentId = id;
    syncActiveCompanyEntry(this.state);
    this.touchAndPersist();
    return this.getRendererState();
  }

  public renameCompanyDocument(idValue: unknown, labelValue: unknown): InterviewContextRendererState {
    const id = this.requireCompanyDocumentId(idValue);
    if (typeof labelValue !== 'string') throw new Error('company document label must be a string');
    const label = labelValue.trim();
    if (!label || label.length > MAX_COMPANY_LABEL_CHARS) {
      throw new Error(`company document label must contain 1-${MAX_COMPANY_LABEL_CHARS} characters`);
    }
    const document = this.state.companyDocuments.find((candidate) => candidate.id === id);
    if (!document) throw new Error('company document not found');
    document.label = label;
    document.updatedAt = new Date().toISOString();
    syncActiveCompanyEntry(this.state);
    this.touchAndPersist();
    return this.getRendererState();
  }

  public buildPromptBundle(
    question: string,
    maxChars = DEFAULT_INTERVIEW_PROMPT_MAX_CHARS,
    options?: import('./interviewContextPrompt').InterviewContextPromptOptions,
  ): InterviewContextPromptBundle | null {
    return buildInterviewContextPrompt(this.state, question, maxChars, options);
  }

  private requireKind(value: unknown): InterviewContextKind {
    if (!isInterviewContextKind(value)) throw new Error('invalid interview context category');
    return value;
  }

  private requireCompanyDocumentId(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) {
      throw new Error('invalid company document id');
    }
    return value;
  }

  private updateActiveCompanyText(content: string): void {
    const activeId = this.state.activeCompanyDocumentId;
    const document = activeId
      ? this.state.companyDocuments.find((candidate) => candidate.id === activeId)
      : null;
    if (!content) {
      if (activeId) this.state.companyDocuments = this.state.companyDocuments.filter((candidate) => candidate.id !== activeId);
      this.state.activeCompanyDocumentId = null;
      syncActiveCompanyEntry(this.state);
      return;
    }
    const now = new Date().toISOString();
    if (document) {
      document.content = content;
      document.charCount = content.length;
      document.updatedAt = now;
    } else {
      this.assertCompanyDocumentCapacity();
      const entry: InterviewContextEntry = {
        kind: 'company',
        title: TITLES.company,
        sourceType: 'text',
        content,
        charCount: content.length,
        updatedAt: now,
      };
      const created = entryToCompanyDocument(entry, { label: 'Manual context' });
      this.state.companyDocuments.push(created);
      this.state.activeCompanyDocumentId = created.id;
    }
    syncActiveCompanyEntry(this.state);
  }

  private assertCompanyDocumentCapacity(): void {
    if (this.state.companyDocuments.length >= MAX_COMPANY_DOCUMENTS) {
      throw new Error(`company document limit reached (${MAX_COMPANY_DOCUMENTS})`);
    }
  }

  private loadState(): InterviewContextState {
    try {
      if (!fs.existsSync(this.statePath)) return defaultState();
      const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      return sanitizeState(parsed);
    } catch (error: any) {
      console.error('[InterviewContextService] Failed to read state; starting clean:', error?.message || error);
      try {
        const backupPath = `${this.statePath}.corrupt-${Date.now()}`;
        fs.renameSync(this.statePath, backupPath);
      } catch { /* best-effort corrupt-state preservation */ }
      return defaultState();
    }
  }

  private touchAndPersist(): void {
    this.state.updatedAt = new Date().toISOString();
    this.persist();
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    const tempPath = `${this.statePath}.tmp-${process.pid}-${Date.now()}`;
    try {
      fs.writeFileSync(tempPath, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tempPath, this.statePath);
      try { fs.chmodSync(this.statePath, 0o600); } catch { /* Windows / read-only ACLs */ }
    } catch (error) {
      try { fs.unlinkSync(tempPath); } catch { /* best-effort cleanup */ }
      throw error;
    }
  }
}
