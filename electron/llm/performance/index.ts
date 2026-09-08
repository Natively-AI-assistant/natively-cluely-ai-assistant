// electron/llm/performance/index.ts
//
// Provider Performance Profile — the shared evidence layer behind Natively's
// adaptive deadlines.
//
// READ docs/PROVIDER_PERFORMANCE_PROFILE_ARCHITECTURE.md before changing
// anything here. In particular: this layer sits ABOVE liveDeadlines.ts and
// imports it, never the reverse, and it may only move a deadline inside the
// bounds that file's route table already considers sane.

export * from './types';
export * from './estimators';
export * from './networkProfile';
export * from './priors';
export * from './deadlines';
export * from './runtimeSignals';
export * from './recorder';
export {
  ProviderPerformanceStore,
  getProviderPerformanceStore,
  __setProviderPerformanceStore,
  migrate as migrateProviderPerformanceProfiles,
  MAX_PROFILES,
  SAVE_DEBOUNCE_MS,
} from './ProviderPerformanceStore';
export * from './capabilityView';
export * from './wiring';
export * from './fixtures';
export * from './calibration';
