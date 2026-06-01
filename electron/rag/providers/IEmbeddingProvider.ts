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
  /** Embed a document chunk (for storage) */
  embed(text: string, opts?: EmbedOptions): Promise<number[]>;
  /** Embed a search query (asymmetric models may prepend a search prefix) */
  embedQuery(text: string, opts?: EmbedOptions): Promise<number[]>;
  embedBatch(texts: string[], opts?: EmbedOptions): Promise<number[][]>;
}
