export type CredentialStoreId = 'keyring' | 'fallback';
export type CredentialStoreChoice = CredentialStoreId | 'merge';
export interface CredentialStoreSummary {
  keys: { name: string; last4: string }[];
  mtimeIso: string | null;
}
export interface CredentialStoresRow {
  name: string;
  label: string;
  keyring: string | null;
  fallback: string | null;
  differs: boolean;
}
export interface CredentialStoresComparison {
  rows: CredentialStoresRow[];
  keyring: { count: number; others: number; savedAt: number | null };
  fallback: { count: number; others: number; savedAt: number | null };
  newer: CredentialStoreId | null;
}
export type ResolveFailure =
  | { gone: true; headline?: undefined; detail?: undefined }
  | { gone?: undefined; headline: string; detail: string };

export declare const CREDENTIAL_KEY_LABELS: Record<string, string>;
export declare const CREDENTIAL_STORES_PHRASES: string[];
export declare function credentialKeyLabel(name: string, t?: (text: string) => string): string;
export declare function credentialStoreName(which: CredentialStoreId, platform: string, t?: (text: string) => string): string;
export declare function compareCredentialStores(
  stores: { keyring: CredentialStoreSummary; fallback: CredentialStoreSummary } | null | undefined,
  t?: (text: string) => string,
): CredentialStoresComparison;
export declare function formatSavedAt(
  ms: number | null | undefined,
  options?: { locale?: string; timeZone?: string; now?: number },
): string | null;
export declare function describeResolveFailure(
  code: string | undefined,
  choice: CredentialStoreChoice,
  platform: string,
  t?: (text: string) => string,
): ResolveFailure;
