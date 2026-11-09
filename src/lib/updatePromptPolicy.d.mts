export interface UpdateDismissal {
  version: string;
  at: number;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'> | null | undefined;

export declare const UPDATE_DISMISSAL_KEY: 'natively_update_dismissed_v1';
export declare const UPDATE_DISMISS_SNOOZE_MS: number;

export function normalizeUpdateVersion(version: unknown): string;
export function readUpdateDismissal(storage: StorageLike): UpdateDismissal | null;
export function writeUpdateDismissal(storage: StorageLike, version: unknown, now: number): void;
export function isUpdateDismissed(dismissal: UpdateDismissal | null | undefined, version: unknown, now: number): boolean;
