/**
 * Premium Skip Helper — conditionally skips tests when premium submodule is unavailable.
 *
 * Usage:
 *   import { describeIfPremium, itIfPremium } from './premiumSkip'
 *
 *   describeIfPremium('LicenseManager integration', () => {
 *     itIfPremium('should validate license key', () => { ... })
 *   })
 */

import { describe, it } from 'vitest'
import { isPremiumAvailable } from '../../electron/premium/featureGate'

// Cached result — isPremiumAvailable() already caches internally, but we cache here
// so we only call it once at module load (avoids repeated try/catch overhead in test suites)
const premium = isPremiumAvailable()

/**
 * Run the describe block if premium is available, otherwise skip it.
 * Use for premium-only feature tests.
 */
export const describeIfPremium = premium ? describe : describe.skip

/**
 * Run the test if premium is available, otherwise skip it.
 * Use for premium-only test cases.
 */
export const itIfPremium = premium ? it : it.skip

/**
 * Inverse helper: skip when premium IS available, run when not.
 * Useful for tests that exist in both open-source and premium versions
 * but need different behavior based on availability.
 */
export const itOnlyPremium = premium ? it.skip : it
