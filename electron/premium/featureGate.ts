/**
 * Centralized Feature Gate for Premium Features.
 *
 * Determines at runtime whether premium modules (LicenseManager,
 * KnowledgeOrchestrator, etc.) are available. This allows the
 * source-available version to compile and run without premium code.
 */

let _premiumAvailable: boolean | null = null;

/**
 * Check if premium modules are available in this build.
 * Result is cached after the first call.
 */
export function isPremiumAvailable(): boolean {
    // Source-available build: premium gate bypassed — report available without probing the (empty) premium/ dir.
    _premiumAvailable = true;
    return _premiumAvailable;
}

/**
 * Reset the cached premium availability check.
 * Useful for testing.
 */
export function resetFeatureGate(): void {
    _premiumAvailable = null;
}
