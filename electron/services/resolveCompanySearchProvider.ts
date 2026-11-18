// electron/services/resolveCompanySearchProvider.ts
// Single source of truth for the company-research search provider cascade:
//   Tavily (user key) → Natively API proxy (Natively key / trial token) → null (LLM-only).
// Used by both the manual profile:research-company IPC handler and the automatic
// AOT pipeline (injected via KnowledgeOrchestrator.setSearchProviderResolver),
// so the two paths cannot drift. Resolve per invocation — never cache the
// result — because keys can be added, changed, or removed mid-session.

import { TRIAL_SENTINEL_KEY } from '../config/constants';
import { CredentialsManager } from './CredentialsManager';
import type { SearchProvider } from '../premium/contracts';

export function resolveCompanySearchProvider(): SearchProvider | null {
  const cm = CredentialsManager.getInstance();

  const tavilyApiKey = cm.getTavilyApiKey();
  if (tavilyApiKey) {
    const {
      TavilySearchProvider,
    } = require('../../premium/electron/knowledge/TavilySearchProvider');
    return new TavilySearchProvider(tavilyApiKey);
  }

  // The key in use, except company research once a pack in use has spent its
  // research runs: then the plan's research (services/packs/nativelyPackFallback.ts).
  let researchKey: string | null = null;
  try {
    const { currentNativelyPackFallback } = require('./packs/nativelyPackFallback') as typeof import('./packs/nativelyPackFallback');
    researchKey = currentNativelyPackFallback()?.researchKey() ?? null;
  } catch { /* not wired */ }
  const nativelyKey = researchKey ?? cm.getNativelyApiKey();
  if (nativelyKey) {
    const {
      NativelySearchProvider,
    } = require('../../premium/electron/knowledge/NativelySearchProvider');
    // Pass the real trial token when the key is the __trial__ sentinel so the
    // server can authenticate via x-trial-token instead of the invalid key.
    const trialToken = nativelyKey === TRIAL_SENTINEL_KEY ? cm.getTrialToken() : undefined;
    console.log('[CompanySearch] Using Natively API search (no Tavily key configured)');
    const provider = new NativelySearchProvider(nativelyKey, trialToken ?? undefined);
    // A research refusal on any path (company research, chat web search):
    // the pack switch looks again, so research moves to the key that has runs
    // (services/packs/nativelyPackFallback.ts). Never on a trial.
    if (nativelyKey !== TRIAL_SENTINEL_KEY && typeof provider.search === 'function') {
      const search = provider.search.bind(provider);
      provider.search = async (...args: Parameters<typeof search>) => {
        const results = await search(...args);
        if (provider.quotaExhausted) {
          try {
            (require('./packs/nativelyPackFallback') as typeof import('./packs/nativelyPackFallback'))
              .nudgeNativelyPackFallback('search_quota_exceeded');
          } catch { /* not wired */ }
        }
        return results;
      };
    }
    return provider;
  }

  return null;
}
