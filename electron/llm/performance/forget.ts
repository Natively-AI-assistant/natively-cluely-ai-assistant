// electron/llm/performance/forget.ts
//
// "Forget all measurements" — everything this layer has learned, in one call.
//
// The store is only part of it. Three pieces of per-session state sit beside it,
// and the Settings button used to clear the store alone, so after a Forget:
//   • Run calibration still answered "already calibrated recently" (cooldown),
//   • rebuilt profiles never got their vision / context-window facts back,
//     because capability seeding is once per identity per session,
//   • the "Answer improvements" tallies survived.
// Each of those is cleared here, for one provider or for all of them.

import { getProviderPerformanceStore } from './ProviderPerformanceStore';
import { resetCapabilitySeeding } from './wiring';
import { resetCalibrationCooldowns } from './calibration';
import { __resetSecondaryStreamTallies } from './recorder';

export function forgetPerformanceEvidence(providerId?: string): void {
  const store = getProviderPerformanceStore();
  if (providerId) store.invalidateProvider(providerId); else store.clear();
  store.flush();
  resetCapabilitySeeding(providerId);
  resetCalibrationCooldowns(providerId);
  // The tallies are keyed by stream KIND, not by provider, so they are only
  // cleared by a full Forget.
  if (!providerId) __resetSecondaryStreamTallies();
}
