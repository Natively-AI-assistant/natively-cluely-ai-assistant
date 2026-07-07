export type ProviderKind = 'cloud' | 'external_local' | 'packaged_local';

export type ProviderHealth =
  | 'ready'
  | 'missing_optional_dependency'
  | 'missing_required_asset'
  | 'misconfigured'
  | 'degraded'
  | 'unavailable';

export interface ProviderStatus {
  id: string;
  kind: ProviderKind;
  health: ProviderHealth;
  requiredForStartup: boolean;
  requiredForCoreFallback: boolean;
  message: string;
  recoverable: boolean;
  details?: Record<string, unknown>;
  updatedAt?: string;
}

export function cloneProviderStatus(status: ProviderStatus): ProviderStatus {
  return {
    ...status,
    details: status.details ? { ...status.details } : undefined,
  };
}
