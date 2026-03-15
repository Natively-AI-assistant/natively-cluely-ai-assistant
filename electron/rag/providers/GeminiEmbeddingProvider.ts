import { IEmbeddingProvider } from './IEmbeddingProvider';

export class GeminiEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'gemini';
  readonly dimensions = 768; // Using output_dimensionality=768 to save storage

  constructor(private apiKey: string, private model = 'models/gemini-embedding-001') {}

  async isAvailable(): Promise<boolean> {
    try { await this.embed('test'); return true; } catch { return false; }
  }

  async embed(text: string): Promise<number[]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/${this.model}:embedContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        outputDimensionality: 768 // Request 768-dim embeddings to save storage
      })
    });
    if (!res.ok) throw new Error(`Gemini embedding failed: ${res.statusText}`);
    const data = await res.json();
    return data.embedding.values;
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.embed(text); // Gemini embedding is symmetric
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Gemini requires sequential calls — no native batch API
    return Promise.all(texts.map(t => this.embed(t)));
  }
}
