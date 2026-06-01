import { IEmbeddingProvider } from './IEmbeddingProvider';
import { embeddingSpaceKey } from '../embeddingSpace';

export class OpenAIEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'openai';
  readonly dimensions = 1536;
  readonly model: string;
  readonly space: string;

  constructor(private apiKey: string, model = 'text-embedding-3-small') {
    this.model = model;
    this.space = embeddingSpaceKey({ name: this.name, model: this.model, dimensions: this.dimensions });
  }

  async isAvailable(): Promise<boolean> {
    // Fast check — just validate the key format and do a single test embed
    try {
      await this.embed('test');
      return true;
    } catch { return false; }
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: this.model, input: text })
    });
    if (!res.ok) throw new Error(`OpenAI embedding failed: ${res.statusText}`);
    const data = await res.json();
    return data.data[0].embedding;
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.embed(text); // text-embedding-3-small is symmetric
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: this.model, input: texts })
    });
    if (!res.ok) throw new Error(`OpenAI batch embedding failed: ${res.statusText}`);
    const data = await res.json();
    return data.data.map((d: any) => d.embedding);
  }
}
