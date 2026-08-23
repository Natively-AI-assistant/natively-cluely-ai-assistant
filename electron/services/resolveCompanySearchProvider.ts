// electron/services/resolveCompanySearchProvider.ts
// Single source of truth for the company-research search provider cascade:
//   Tavily (user key) → Natively API proxy (Natively key / trial token) → null (LLM-only).
// Used by both the manual profile:research-company IPC handler and the automatic
// AOT pipeline (injected via KnowledgeOrchestrator.setSearchProviderResolver),
// so the two paths cannot drift. Resolve per invocation — never cache the
// result — because keys can be added, changed, or removed mid-session.

import { TRIAL_SENTINEL_KEY } from '../config/constants';
import { CredentialsManager } from './CredentialsManager';
import type { SearchProvider } from '../../premium/electron/knowledge/CompanyResearchEngine';

export function resolveCompanySearchProvider(): SearchProvider | null {
  const cm = CredentialsManager.getInstance();

  const tavilyApiKey = cm.getTavilyApiKey();
  if (tavilyApiKey) {
    const {
      TavilySearchProvider,
    } = require('../../premium/electron/knowledge/TavilySearchProvider');
    return new TavilySearchProvider(tavilyApiKey);
  }

  const nativelyKey = cm.getNativelyApiKey();
  if (nativelyKey) {
    const {
      NativelySearchProvider,
    } = require('../../premium/electron/knowledge/NativelySearchProvider');
    // Pass the real trial token when the key is the __trial__ sentinel so the
    // server can authenticate via x-trial-token instead of the invalid key.
    const trialToken = nativelyKey === TRIAL_SENTINEL_KEY ? cm.getTrialToken() : undefined;
    console.log('[CompanySearch] Using Natively API search (no Tavily key configured)');
    return new NativelySearchProvider(nativelyKey, trialToken ?? undefined);
  }

  return null;
}
