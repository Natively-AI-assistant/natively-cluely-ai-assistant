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
    if (_premiumAvailable !== null) return _premiumAvailable;

    try {
        // Probe for the critical premium modules in the premium/ directory
        require('../../premium/electron/services/LicenseManager');
        require('../../premium/electron/knowledge/KnowledgeOrchestrator');
        _premiumAvailable = true;
    } catch {
        _premiumAvailable = false;
        console.log('[FeatureGate] Premium modules not available — running in source-available mode.');
    }

    return _premiumAvailable;
}

/**
 * Reset the cached premium availability check.
 * Useful for testing.
 */
export function resetFeatureGate(): void {
    _premiumAvailable = null;
}
