import { IEmbeddingProvider } from './IEmbeddingProvider';
import { embeddingSpaceKey } from '../embeddingSpace';

/** The model this provider shipped with, and the width it outputs. */
const DEFAULT_MODEL = 'nomic-embed-text';
const DEFAULT_DIMENSIONS = 768;

export class OllamaEmbeddingProvider implements IEmbeddingProvider {
  /**
   * Which Ollama models take nomic's `search_document:` / `search_query:` task
   * prefixes. This is a property of the nomic-embed family's TRAINING, not of
   * Ollama, so it must be keyed off the model rather than applied to everything
   * the daemon happens to serve.
   */
  /**
   * Reject a vector whose width is not the one this provider's space key claims.
   * The cached `ollamaEmbeddingDims` can go stale — the user re-pulls a model at
   * a different width, or a settings write lands without it — and persisting a
   * 4096-d vector under a space key that says 768 is exactly the corruption the
   * measured-width design exists to prevent. Every sibling provider validates;
   * this one did not.
   */
  private validate(values: unknown): number[] {
    if (!Array.isArray(values) || values.length !== this.dimensions) {
      const err: any = new Error(
        `Ollama embedding dimension mismatch for '${this.model}': expected ${this.dimensions}, got `
        + `${Array.isArray(values) ? values.length : typeof values}. `
        + 'Re-select the model so its size is measured again.'
      );
      err.retryable = true;
      throw err;
    }
    return values as number[];
  }

  static usesTaskPrefixes(model: string): boolean {
    return /^nomic-embed/i.test((model || '').trim());
  }

  readonly name = 'ollama';
  readonly dimensions: number;
  readonly model: string;
  readonly space: string;

  /**
   * `dimensions` used to be hard-coded to 768 while `model` was already a
   * parameter, so pointing this at a 4096-d model (qwen3-embedding:8b) produced
   * a space key claiming 768 dimensions over 4096-d vectors — silently
   * incomparable, and invisible to every downstream check.
   *
   * Callers must therefore pass the MEASURED width alongside a non-default
   * model (see probeOllamaEmbeddingDimensions in ../ollamaEmbeddingModels.ts).
   * The defaults are kept exactly as they shipped: changing either would
   * re-space every existing Ollama user and force a full re-index.
   */
  constructor(
    private baseUrl = 'http://localhost:11434',
    model = DEFAULT_MODEL,
    dimensions = DEFAULT_DIMENSIONS,
  ) {
    this.model = model;
    this.dimensions = dimensions;
    this.space = embeddingSpaceKey({ name: this.name, model: this.model, dimensions: this.dimensions });
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Check if Ollama is running AND the model is pulled
      const res = await fetch(`${this.baseUrl}/api/tags`);
      if (!res.ok) return false;
      const data = await res.json();
      return data.models?.some((m: any) => m.name.startsWith(this.model)) ?? false;
    } catch { return false; }
  }

  async embed(text: string): Promise<number[]> {
    // nomic-embed-text is asymmetric — documents get a prefix
    // nomic-embed-text is trained with these task prefixes; nothing else is.
    // Prepending them to qwen3-embedding, bge-m3, mxbai or snowflake-arctic puts
    // literal instruction text in the strongest position of an input the model
    // never saw in training — retrieval quality drops with no error to show for it.
    const prefixed = OllamaEmbeddingProvider.usesTaskPrefixes(this.model)
      ? `search_document: ${text}`
      : text;
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: prefixed })
    });
    if (!res.ok) throw new Error(`Ollama embedding failed: ${res.statusText}`);
    const data = await res.json();
    return this.validate(data.embedding);
  }

  async embedQuery(text: string): Promise<number[]> {
    // nomic-embed-text is asymmetric — queries get a different prefix
    const prefixed = OllamaEmbeddingProvider.usesTaskPrefixes(this.model)
      ? `search_query: ${text}`
      : text;
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: prefixed })
    });
    if (!res.ok) throw new Error(`Ollama query embedding failed: ${res.statusText}`);
    const data = await res.json();
    return this.validate(data.embedding);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return (async () => {
      // Bounded, not Promise.all over every chunk. This used to be safe only
      // because Ollama meant nomic-embed-text; any installed embedder is
      // selectable now, so a 300-chunk document fired 300 concurrent requests at
      // an 8B model and either OOMed the daemon or timed the whole batch out.
      const LIMIT = 4;
      const out: number[][] = new Array(texts.length);
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(LIMIT, texts.length) }, async () => {
        for (let i = next++; i < texts.length; i = next++) out[i] = await this.embed(texts[i]);
      }));
      return out;
    })();
  }
}
