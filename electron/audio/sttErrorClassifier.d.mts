export type SttErrorKind = 'idle' | 'local_unavailable' | 'auth' | 'quota' | 'retry';

export interface SttErrorDescription {
  /** What the overlay maps (src/lib/sttErrorMapper.ts). */
  errorMessage: string;
  /** HTTP status behind the failure, 0 when unknown. */
  httpStatus: number;
}

export interface SttErrorClassification extends SttErrorDescription {
  kind: SttErrorKind;
}

export function describeSttError(err: unknown): SttErrorDescription;
export function classifySttError(err: unknown): SttErrorClassification;
export function restAccountVerdict(err: unknown): 'credits' | 'refused' | null;
