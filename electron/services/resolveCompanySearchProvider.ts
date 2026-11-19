// electron/services/resolveCompanySearchProvider.ts
// Single source of truth for the company-research search provider cascade:
//   a Natively plan or pack key → Natively API search, the user's Tavily key
//     taking over once the plan's research has run out (Evin, 2026-11-19:
//     with a Natively key, everything runs on Natively API);
//   otherwise Tavily (user key) → Natively API proxy (trial token) → null (LLM-only).
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
  const tavily = (): SearchProvider | null => {
    if (!tavilyApiKey) return null;
    const {
      TavilySearchProvider,
    } = require('../../premium/electron/knowledge/TavilySearchProvider');
    return new TavilySearchProvider(tavilyApiKey);
  };
  // No plan or pack key (none, or the trial): the user's Tavily key first, as before.
  const savedKey = cm.getNativelyApiKey();
  if (tavilyApiKey && (!savedKey || savedKey === TRIAL_SENTINEL_KEY)) return tavily();

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
    console.log(`[CompanySearch] Using Natively API search${tavilyApiKey ? ' (Tavily once research runs out)' : ''}`);
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
          // The plan's research has run out: the user's own Tavily key answers
          // this query instead of none at all.
          const fallback = tavily();
          if (fallback) return (fallback.search as (...a: Parameters<typeof search>) => ReturnType<typeof search>)(...args);
        }
        return results;
      };
    }
    return provider;
  }

  return null;
}
