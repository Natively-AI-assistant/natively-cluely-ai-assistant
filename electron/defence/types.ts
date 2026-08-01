export type InputLanguage = 'auto' | 'zh' | 'en' | 'mixed';
export type OutputLanguage = 'follow' | 'zh' | 'en' | 'bilingual';
export type AnswerDepth = 'brief' | 'standard' | 'deep';
export type SearchMode = 'off' | 'auto' | 'on';

export interface DefenceSettings {
  inputLanguage: InputLanguage;
  outputLanguage: OutputLanguage;
  answerDepth: AnswerDepth;
  searchMode: SearchMode;
}

export type ImplementationStatus = 'IMPLEMENTED' | 'TESTED_ONLY' | 'EXPERIMENTAL' | 'PLANNED' | 'DEPRECATED' | 'UNKNOWN';

export interface Evidence {
  sourceType: 'project' | 'external';
  path?: string;
  title?: string;
  symbol?: string;
  lineStart?: number;
  lineEnd?: number;
  page?: number;
  commit?: string;
  excerpt: string;
  status: ImplementationStatus;
  score: number;
  url?: string;
  publishedAt?: string;
}

export interface IndexedChunk extends Evidence {
  id: string;
  sourceType: 'project';
  fileHash: string;
  indexedAt: string;
  content: string;
  tokens: string[];
  vector: Record<string, number>;
}

export interface IndexManifest {
  version: 1;
  projectRoot: string;
  commit?: string;
  files: Record<string, { hash: string; chunkIds: string[]; indexedAt: string }>;
  chunks: IndexedChunk[];
}

export interface IndexProgress {
  running: boolean;
  discoveredTotal: number;
  excludedTotal: number;
  eligibleTotal: number;
  indexedNew: number;
  indexedUpdated: number;
  skippedUnchanged: number;
  deletedFromIndex: number;
  failedTotal: number;
  directoryCount: number;
  symlinkExcluded: number;
  oversizedExcluded: number;
  secretExcluded: number;
  ignoredByGit: number;
  unsupportedTypeExcluded: number;
  failed: Array<{ path: string; reason: string }>;
  startedAt?: string;
  completedAt?: string;
}

export interface StructuredAnswer {
  questionId?: string;
  revision?: number;
  generationId?: string;
  question: string;
  questionExplanation?: string;
  language: 'zh' | 'en' | 'mixed';
  keywords: string[];
  spokenAnswer: string;
  alternateLanguageAnswer?: string;
  followUps: string[];
  evidence: Evidence[];
  externalSources: Evidence[];
  noEvidence: boolean;
  missingInformation?: string[];
  searchedSourceTypes: string[];
  provider: string;
  diagnostics?: {
    retrievalMs: number;
    candidateCount: number;
    evidenceCount: number;
    llmFirstResponseMs?: number;
    llmTotalMs?: number;
    llmStatus?: number;
    llmRetries?: number;
    llmRequestId?: string;
    schemaValid: boolean;
  };
}
