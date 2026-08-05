// electron/services/resolveCompanySearchProvider.ts
// Company-research search provider cascade for the OSS build.
//
// The private premium submodule used to supply TavilySearchProvider /
// NativelySearchProvider. With skip-premium those classes are absent, and the
// OSS KnowledgeOrchestrator stubs getCompanyResearchEngine() to null anyway —
// so this resolver always returns null (LLM-only / feature inert). Kept as the
// single injection seam so main.ts + IPC cannot drift if search is reintroduced.

/** Minimal search-provider surface used by company research / JD URL extract. */
export interface SearchProvider {
  search?: (...args: any[]) => Promise<any>;
  extractUrl?: (url: string, ...args: any[]) => Promise<any>;
  quotaExhausted?: boolean;
}

export function resolveCompanySearchProvider(): SearchProvider | null {
  // Premium search providers are not available in this build.
  return null;
}
