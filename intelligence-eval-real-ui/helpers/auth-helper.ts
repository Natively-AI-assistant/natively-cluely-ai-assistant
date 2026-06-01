// intelligence-eval-real-ui/helpers/auth-helper.ts
// Activates Natively Pro through the REAL path: the test API key is set via the
// preload bridge `setNativelyApiKey`, which the app routes to
// LicenseManager.activateWithApiKey → POST /v1/pro/verify. No license forging —
// if the key's plan lacks Pro, activation fails and the suite reports it (the
// Profile Intelligence UI is genuinely Pro-gated).

import type { Page } from 'playwright-core';

export interface ActivationResult { success: boolean; isPremium: boolean; error?: string }

export async function activateProWithKey(win: Page, key: string): Promise<ActivationResult> {
  // Drive the real preload IPC the settings UI uses. (We call the bridge the UI
  // calls; this is the production activation path, not a backend shortcut.)
  const res = await win.evaluate(async (k: string) => {
    const api: any = (window as any).electronAPI;
    if (!api?.setNativelyApiKey) return { success: false, error: 'setNativelyApiKey bridge unavailable' };
    const set = await api.setNativelyApiKey(k).catch((e: any) => ({ success: false, error: String(e?.message || e) }));
    // Re-check premium via the REAL license bridge (getPremiumStatus does not
    // exist; license:check-premium / license:get-details do).
    let isPremium = false;
    try {
      if (api.licenseCheckPremiumAsync) isPremium = !!(await api.licenseCheckPremiumAsync());
      else if (api.licenseCheckPremium) isPremium = !!(await api.licenseCheckPremium());
      else if (api.licenseGetDetails) isPremium = !!(await api.licenseGetDetails())?.isPremium;
      else { const s = await api.profileGetStatus?.(); isPremium = !!s?.profileMode; }
    } catch { /* */ }
    return { success: !!set?.success, isPremium, error: set?.error };
  }, key);
  return { success: !!res.success, isPremium: !!res.isPremium, error: res.error };
}

/** Verify the app reports premium (so Profile Intelligence UI is enabled). */
export async function isPremium(win: Page): Promise<boolean> {
  return win.evaluate(async () => {
    const api: any = (window as any).electronAPI;
    try {
      if (api?.licenseCheckPremiumAsync) return !!(await api.licenseCheckPremiumAsync());
      if (api?.licenseCheckPremium) return !!(await api.licenseCheckPremium());
      if (api?.licenseGetDetails) return !!(await api.licenseGetDetails())?.isPremium;
      const s = await api?.profileGetStatus?.();
      return !!(s?.profileMode || s?.hasProfile);
    } catch { return false; }
  });
}
