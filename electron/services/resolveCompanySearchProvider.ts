// electron/services/resolveCompanySearchProvider.ts
// Single source of truth for the company-research search provider cascade:
//   Tavily (user key) → Natively API proxy (Natively key / trial token) → null (LLM-only).
// Used by both the manual profile:research-company IPC handler and the automatic
// AOT pipeline (injected via KnowledgeOrchestrator.setSearchProviderResolver),
// so the two paths cannot drift. Resolve per invocation — never cache the
// result — because keys can be added, changed, or removed mid-session.

import { TRIAL_SENTINEL_KEY } from '../config/constants';
import { CredentialsManager } from './CredentialsManager';
// Routed through the resolver rather than required literally. esbuild runs with
// `bundle: true` (scripts/build-electron.js:47) and resolves literal specifiers
// at build time; unlike the premium requires elsewhere in this codebase, the two
// below were not inside a try/catch, so esbuild hard-failed on them instead of
// leaving them as runtime calls. Verified on a clean tree: they were the only
// thing stopping `npm run build:electron` from succeeding without premium/.
import { loadKnowledgeModule } from '../knowledgeModules';
// Repointed from premium/electron/knowledge/CompanyResearchEngine to the
// local contract for the same reason as IntelligenceEngine's — type-only,
// and the provider instances themselves are built through untyped require()
// below, so this annotation is documentation rather than a structural gate.
import type { SearchProvider } from '../localKnowledge/types';

export function resolveCompanySearchProvider(): SearchProvider | null {
  const cm = CredentialsManager.getInstance();

  const tavilyApiKey = cm.getTavilyApiKey();
  if (tavilyApiKey) {
    const mod = loadKnowledgeModule('TavilySearchProvider') as
      | { TavilySearchProvider?: new (key: string) => SearchProvider }
      | null;
    if (mod?.TavilySearchProvider) return new mod.TavilySearchProvider(tavilyApiKey);
    console.log('[CompanySearch] Tavily key present but no provider implementation — falling through');
  }

  const nativelyKey = cm.getNativelyApiKey();
  if (nativelyKey) {
    const mod = loadKnowledgeModule('NativelySearchProvider') as
      | { NativelySearchProvider?: new (key: string, trialToken?: string) => SearchProvider }
      | null;
    if (mod?.NativelySearchProvider) {
      // Pass the real trial token when the key is the __trial__ sentinel so the
      // server can authenticate via x-trial-token instead of the invalid key.
      const trialToken = nativelyKey === TRIAL_SENTINEL_KEY ? cm.getTrialToken() : undefined;
      console.log('[CompanySearch] Using Natively API search (no Tavily key configured)');
      return new mod.NativelySearchProvider(nativelyKey, trialToken ?? undefined);
    }
    console.log('[CompanySearch] Natively key present but no provider implementation — falling through');
  }

  return null;
}
