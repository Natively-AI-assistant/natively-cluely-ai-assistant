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

  private async errorFromResponse(res: Response, operation: string): Promise<Error> {
    const body = await res.text().catch(() => '');
    const message = `OpenAI ${operation} failed: ${res.status} ${res.statusText} ${body.slice(0, 500)}`;
    return Object.assign(new Error(message), {
      status: res.status,
      provider: this.name,
      permanentAuthFailure: res.status === 401 || res.status === 403,
    });
  }

  async isAvailable(): Promise<boolean> {
    // Fast check — just validate the key format and do a single test embed
    try {
      await this.embed('test');
      return true;
    } catch (error: any) {
      if (error?.permanentAuthFailure) throw error;
      return false;
    }
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
    if (!res.ok) throw await this.errorFromResponse(res, 'embedding');
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
    if (!res.ok) throw await this.errorFromResponse(res, 'batch embedding');
    const data = await res.json();
    return data.data.map((d: any) => d.embedding);
  }
}
