import { IEmbeddingProvider } from './IEmbeddingProvider';
import { embeddingSpaceKey } from '../embeddingSpace';

export class OllamaEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'ollama';
  readonly dimensions = 768; // nomic-embed-text outputs 768
  readonly model: string;
  readonly space: string;

  constructor(
    private baseUrl = 'http://localhost:11434',
    model = 'nomic-embed-text'
  ) {
    this.model = model;
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
    const prefixed = `search_document: ${text}`;
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: prefixed })
    });
    if (!res.ok) throw new Error(`Ollama embedding failed: ${res.statusText}`);
    const data = await res.json();
    return data.embedding;
  }

  async embedQuery(text: string): Promise<number[]> {
    // nomic-embed-text is asymmetric — queries get a different prefix
    const prefixed = `search_query: ${text}`;
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: prefixed })
    });
    if (!res.ok) throw new Error(`Ollama query embedding failed: ${res.statusText}`);
    const data = await res.json();
    return data.embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }
}
