export const INTERVIEW_CONTEXT_KINDS = ['personal', 'professional', 'company'] as const;

export type InterviewContextKind = typeof INTERVIEW_CONTEXT_KINDS[number];

export type InterviewContextSourceType = 'text' | 'file';

export interface InterviewContextEntry {
  kind: InterviewContextKind;
  title: string;
  sourceType: InterviewContextSourceType;
  fileName?: string;
  content: string;
  charCount: number;
  truncated?: boolean;
  updatedAt: string;
}

export interface InterviewCompanyDocument {
  id: string;
  label: string;
  sourceType: InterviewContextSourceType;
  fileName?: string;
  content: string;
  charCount: number;
  truncated?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InterviewContextState {
  version: 2;
  enabled: boolean;
  entries: Record<InterviewContextKind, InterviewContextEntry | null>;
  companyDocuments: InterviewCompanyDocument[];
  activeCompanyDocumentId: string | null;
  updatedAt: string;
}

/**
 * Renderer-safe snapshot. Inactive company document contents stay in the main
 * process; the settings UI only needs collection metadata plus the currently
 * selected document exposed through `entries.company`.
 */
export type InterviewCompanyDocumentSummary = Omit<InterviewCompanyDocument, 'content'>;

export interface InterviewContextRendererState extends Omit<InterviewContextState, 'companyDocuments'> {
  companyDocuments: InterviewCompanyDocumentSummary[];
}

export interface InterviewContextPromptBundle {
  contextBlock: string;
  systemInstruction: string;
  includedKinds: InterviewContextKind[];
  sourceChars: number;
  promptChars: number;
}

export const isInterviewContextKind = (value: unknown): value is InterviewContextKind =>
  typeof value === 'string' && (INTERVIEW_CONTEXT_KINDS as readonly string[]).includes(value);
