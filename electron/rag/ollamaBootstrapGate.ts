// electron/rag/ollamaBootstrapGate.ts
//
// Whether startup should skip the Ollama embeddings bootstrap (main.ts
// bootstrapOllamaEmbeddings), which spawns `ollama serve` and pulls
// nomic-embed-text (~274 MB) when it is missing.
//
// The bootstrap's own guard skipped only when an OpenAI or Gemini key existed.
// A user on the Natively API alone (embeddings run on the Natively key) still
// got `ollama serve` started on every launch when Ollama was installed, and the
// model pulled when it was not there yet (seen 2026-11-21 in a dev launch with
// only a Natively key).
//
// Decided from settings alone, never by waiting for the pipeline: a wait reads
// a brief offline start, or a trial token refreshed mid-wait, as "fell back,
// start Ollama" (code review 2026-11-21). A Natively key now skips the
// bootstrap the way an OpenAI or Gemini key always has, so a key that fails at
// runtime lands on the bundled model, as those keys do.

import type { AppAPIConfig } from './EmbeddingProviderResolver';
import type { IEmbeddingProvider } from './providers/IEmbeddingProvider';

type BuildCandidates = (config: AppAPIConfig, opts?: { quiet?: boolean }) => IEmbeddingProvider[];

/**
 * Why startup can leave Ollama alone, or undefined to bootstrap it.
 *
 *  - A provider chosen in Settings decides: Ollama bootstraps, anything else
 *    skips (the resolver narrows to that one provider, so Ollama is never
 *    used). This comes before the key check, so a user with an OpenAI key who
 *    chose Ollama still gets it started.
 *  - An OpenAI or Gemini key skips (the existing rule).
 *  - Otherwise the resolver's own order decides: the Natively key or a usable
 *    trial, a measured custom/Voyage/OpenRouter/9Router provider, after the
 *    privacy scope. Ollama first, or nothing at all, bootstraps.
 */
export function ollamaBootstrapSkipReason(deps: {
  config: AppAPIConfig;
  buildCandidates: BuildCandidates;
  hasCloudEmbeddingKey: boolean;
}): string | undefined {
  const { config } = deps;
  const pinned = config.embeddingMode === 'manual' ? (config.embeddingProvider || '').trim() : '';
  if (pinned) return pinned === 'ollama' ? undefined : `${pinned} embeddings are chosen in Settings`;
  if (deps.hasCloudEmbeddingKey) return 'a cloud embedding provider is configured';
  const first = deps.buildCandidates(config, { quiet: true })[0];
  return first && first.name !== 'ollama' ? `${first.name} embeddings come before Ollama` : undefined;
}
