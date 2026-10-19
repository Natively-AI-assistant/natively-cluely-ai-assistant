import type { LLMProvider } from './types';

/**
 * Configured LLM providers by id. LLMHelper consults forModel() in its
 * registry lanes (text cascade, streaming selection, Direct Assist); anything
 * that owns the routed model id is used with no per-provider switch arm.
 * Registration replaces same-id entries, so a settings save rebuilds the set
 * from storage without stale instances lingering.
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, LLMProvider>();

  /** Register a provider, replacing any existing one with the same id. */
  register(p: LLMProvider): void {
    this.providers.set(p.id, p);
  }

  /** Drop every provider matching pred (e.g. all compat: instances before a re-register). */
  unregisterWhere(pred: (p: LLMProvider) => boolean): void {
    for (const [id, p] of this.providers) {
      if (pred(p)) this.providers.delete(id);
    }
  }

  /** First provider that owns modelId, or null. An empty modelId never matches. */
  forModel(modelId?: string | null): LLMProvider | null {
    if (!modelId) return null;
    for (const p of this.providers.values()) {
      if (p.ownsModel(modelId)) return p;
    }
    return null;
  }

  list(): LLMProvider[] {
    return [...this.providers.values()];
  }
}
