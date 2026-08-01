import type { DefenceConfig } from './config';
import type { Evidence, StructuredAnswer } from './types';

function safeError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(message.replace(/(?:sk|gsk|tvly)-[A-Za-z0-9_-]{12,}/g, '[REDACTED]').replace(/[A-Za-z]:\\[^\s]+/g, '[LOCAL_PATH]'));
}

export class SttProvider {
  constructor(private config: DefenceConfig['stt']) {}
  available(): boolean { return this.config.provider !== 'none' && !!this.config.apiKey; }
  async transcribe(bytes: Buffer, mimeType = 'audio/webm'): Promise<string> {
    if (!this.available()) throw new Error('STT is unavailable: configure STT_PROVIDER and STT_API_KEY');
    const form = new FormData();
    const extension = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('wav') ? 'wav' : 'webm';
    form.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), `speech.${extension}`);
    form.append('model', this.config.model); form.append('response_format', 'json');
    if (this.config.language !== 'auto' && this.config.language !== 'mixed') form.append('language', this.config.language);
    try {
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${this.config.apiKey}` }, body: form });
      if (!response.ok) throw new Error(`STT request failed (${response.status})`);
      const json: any = await response.json(); return String(json.text || '').trim();
    } catch (error) { throw safeError(error); }
  }
}

export class SearchProvider {
  constructor(private config: DefenceConfig['search']) {}
  available(): boolean { return this.config.provider !== 'none' && !!this.config.apiKey; }
  async search(query: string): Promise<Evidence[]> {
    if (!this.available()) return [];
    try {
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/search`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: this.config.apiKey, query, max_results: 5, search_depth: 'basic' }),
      });
      if (!response.ok) throw new Error(`Search request failed (${response.status})`);
      const json: any = await response.json();
      return (Array.isArray(json.results) ? json.results : []).map((item: any) => ({
        sourceType: 'external', title: String(item.title || 'External source'), url: String(item.url || ''),
        excerpt: String(item.content || '').slice(0, 900), publishedAt: item.published_date ? String(item.published_date) : undefined,
        status: 'UNKNOWN', score: Number(item.score || 0),
      }));
    } catch (error) { throw safeError(error); }
  }
}

export class LlmProvider {
  constructor(private config: DefenceConfig['llm']) {}
  available(): boolean { return this.config.provider !== 'none' && (!!this.config.apiKey || this.config.provider === 'ollama'); }
  async answer(question: string, evidence: Evidence[], external: Evidence[], language: string, depth: string): Promise<Partial<StructuredAnswer>> {
    if (!this.available()) throw new Error('LLM unavailable');
    const evidencePayload = [...evidence, ...external].map((item, index) => ({ id: index + 1, ...item }));
    const prompt = `You are a project defence speaking copilot. Answer only from PROJECT_EVIDENCE for project facts. EXTERNAL_SOURCES may explain current outside facts but never prove project implementation. Never invent files, symbols, metrics, incidents, or status. If evidence is insufficient set noEvidence=true. Preserve framework and code names. Output strict JSON with keys: questionExplanation, keywords, spokenAnswer, alternateLanguageAnswer, followUps, noEvidence, missingInformation. Requested output=${language}, depth=${depth}.\nQUESTION:\n${question}\nPROJECT_EVIDENCE_AND_EXTERNAL:\n${JSON.stringify(evidencePayload)}`;
    const body: any = {
      model: this.config.model, messages: [{ role: 'system', content: 'Return valid JSON only.' }, { role: 'user', content: prompt }],
      temperature: 0.2, response_format: { type: 'json_object' },
    };
    try {
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}) }, body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`LLM request failed (${response.status})`);
      const json: any = await response.json();
      const content = json.choices?.[0]?.message?.content;
      return JSON.parse(String(content || '{}').replace(/^```json\s*|\s*```$/g, ''));
    } catch (error) { throw safeError(error); }
  }
}
