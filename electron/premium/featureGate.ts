/**
 * Centralized Feature Gate for Premium Features.
 *
 * Whether this build ships the premium modules (KnowledgeOrchestrator,
 * LicenseManager, ...). The source-available build compiles and runs without
 * them.
 *
 * Rewritten 2026-11-13 (F-ACC-14). The old version PROBED by requiring the
 * premium files relative to its own location, which esbuild bundling breaks
 * (the bundle's location is not this file's), and it had no callers. main.ts
 * is the one place that knows: its guarded premium require either succeeds or
 * lands in a catch, and that catch marks the build. The flag lives on
 * globalThis because main and the answer path may be separate bundles, each
 * with its own copy of this module. Unmarked = available, so tests and a
 * premium build are unaffected.
 */

const PREMIUM_ABSENT_KEY = '__nativelyPremiumAbsentV1__';

/** main.ts: the premium modules failed to load; this is the source-available build. */
export function markPremiumAbsent(): void {
    (globalThis as Record<string, unknown>)[PREMIUM_ABSENT_KEY] = true;
}

/** True unless main.ts marked the premium modules absent. Never throws. */
export function isPremiumAvailable(): boolean {
    return (globalThis as Record<string, unknown>)[PREMIUM_ABSENT_KEY] !== true;
}

/** Clear the mark (tests). */
export function resetFeatureGate(): void {
    delete (globalThis as Record<string, unknown>)[PREMIUM_ABSENT_KEY];
}
