/** Optional hints passed to embed calls. Providers that don't support a hint ignore it. */
export interface EmbedOptions {
  /** Document title (for asymmetric models that format `title: {title} | text: {content}`). */
  title?: string;
  /** Task hint for query embedding on models that bake the task into the prompt. */
  taskHint?: 'retrieval' | 'code';
}

export interface IEmbeddingProvider {
  readonly name: string;
  /** Bare model id (no `models/` prefix), e.g. 'gemini-embedding-2'. */
  readonly model: string;
  readonly dimensions: number;
  /** Canonical embedding-space identity: `${name}:${normalizedModel}:${dimensions}`. */
  readonly space: string;
  isAvailable(): Promise<boolean>;
  /**
   * Synchronous, non-blocking, non-triggering check: "would the NEXT embed()
   * call return quickly, or would it first have to do a slow one-time cold
   * load?" Optional — cloud HTTP providers (Gemini/OpenAI/Ollama) have no
   * warm-up cost and can omit this (every embed() call is already just a
   * network round-trip, so there's no meaningfully different "loaded" state).
   * Only a provider with an actual local model/worker load (LocalEmbeddingProvider)
   * needs to implement it, returning false until that one-time load finishes.
   * Distinct from isAvailable(): isAvailable() is async and MAY TRIGGER a load
   * (used once during provider resolution); isLoaded() never triggers anything
   * and answers instantly (used as a per-query fast-path gate).
   */
  isLoaded?(): boolean;
  /** Embed a document chunk (for storage) */
  embed(text: string, opts?: EmbedOptions): Promise<number[]>;
  /** Embed a search query (asymmetric models may prepend a search prefix) */
  embedQuery(text: string, opts?: EmbedOptions): Promise<number[]>;
  embedBatch(texts: string[], opts?: EmbedOptions): Promise<number[][]>;
}
