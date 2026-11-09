export interface PermissionsCardRecord {
  dismissals: number;
  lastDismissedAt: number | null;
}

export type PermissionsCardEvent = 'dismissed' | 'granted';

type PermissionCheck = { platform?: string; microphone?: string; screen?: string } | null | undefined;

export declare const PERMISSIONS_CARD_SNOOZE_MS: number;
export declare const PERMISSIONS_CARD_MAX_DISMISSALS: number;

export function emptyPermissionsCardRecord(): PermissionsCardRecord;
export function normalizePermissionsCardRecord(raw: unknown): PermissionsCardRecord;
export function applyPermissionsCardEvent(record: unknown, event: PermissionsCardEvent | string, now: number): PermissionsCardRecord;
export function permissionsCardSnoozed(record: unknown, now: number): boolean;
export function requiredPermissionsGranted(check: PermissionCheck): boolean;
export function startupPermissionsAttention(check: PermissionCheck, record: unknown, now: number): boolean;
