export type TrialStartKind = 'started' | 'unavailable' | 'rate_limited' | 'failed';
export interface TrialStartReply {
  ok?: boolean; hasToken?: boolean; persisted?: boolean; expired?: boolean;
  already_used?: boolean; error?: string; status?: number;
}
export function classifyTrialStart(res: TrialStartReply | null | undefined): TrialStartKind;
export const TRIAL_RETRY_DELAY_MS: number;
export function startTrialWithRetry(start: () => Promise<unknown>, wait?: (ms: number) => Promise<void>): Promise<TrialStartKind>;
export function startTrialWithRetry<T extends string>(start: () => Promise<unknown>, wait: ((ms: number) => Promise<void>) | undefined, classify: (res: any) => T): Promise<T>;
export function trialRefusal(error: unknown): { message: string; deviceUsed: boolean };
