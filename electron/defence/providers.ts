import type { DefenceConfig } from './config';
import type { Evidence, StructuredAnswer } from './types';
import { audioExtension } from './audioProtocol';

export type ProviderErrorCode = 'AUTHENTICATION_FAILED' | 'PAYMENT_OR_BALANCE_REQUIRED' | 'RATE_LIMITED' | 'NETWORK_UNREACHABLE' | 'TIMEOUT' | 'UNSUPPORTED_AUDIO_FORMAT' | 'INVALID_PROVIDER_RESPONSE' | 'INVALID_STRUCTURED_OUTPUT' | 'MODEL_NOT_FOUND' | 'PROVIDER_INTERNAL_ERROR';
export class ProviderError extends Error {
  constructor(public code: ProviderErrorCode, message: string, public status?: number, public retries = 0) { super(message); this.name = 'ProviderError'; }
}

export interface ProviderTiming { dnsConnectMs: number; totalMs: number; status: number; retries: number; requestId?: string }
export interface ProviderResult<T> { value: T; timing: ProviderTiming }

function redact(message: string): string {
  return message.replace(/(?:sk|gsk|tvly)[-_][A-Za-z0-9_-]{10,}/g, '[REDACTED]').replace(/[A-Za-z]:\\[^\s]+/g, '[LOCAL_PATH]').slice(0, 300);
}

function classify(error: unknown, status?: number, retries = 0): ProviderError {
  if (error instanceof ProviderError) return error;
  const message = redact(error instanceof Error ? error.message : String(error));
  if (status === 401 || status === 403) return new ProviderError('AUTHENTICATION_FAILED', 'Provider authentication failed. Check the configured API key.', status, retries);
  if (status === 402) return new ProviderError('PAYMENT_OR_BALANCE_REQUIRED', 'Provider payment or account balance is required.', status, retries);
  if (status === 404) return new ProviderError('MODEL_NOT_FOUND', 'The configured provider endpoint or model was not found.', status, retries);
  if (status === 415 || status === 422) return new ProviderError('UNSUPPORTED_AUDIO_FORMAT', 'The provider rejected the selected audio format.', status, retries);
  if (status === 429) return new ProviderError('RATE_LIMITED', 'The provider rate limit was reached. Try again later.', status, retries);
  if (error instanceof Error && (error.name === 'AbortError' || /timeout/i.test(message))) return new ProviderError('TIMEOUT', 'The provider request timed out.', status, retries);
  if (!status && /fetch failed|network|dns|connect|econn|enotfound/i.test(message)) return new ProviderError('NETWORK_UNREACHABLE', 'The provider network endpoint is unreachable.', status, retries);
  return new ProviderError('PROVIDER_INTERNAL_ERROR', status ? `Provider request failed (${status}).` : message, status, retries);
}

async function requestWithRetry(url: string, init: RequestInit, timeoutMs: number, maxRetries: number): Promise<ProviderResult<Response>> {
  const started = performance.now(); let retries = 0;
  while (true) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal }); const headersAt = performance.now(); clearTimeout(timer);
      if (response.ok) return { value: response, timing: { dnsConnectMs: Math.round(headersAt - started), totalMs: 0, status: response.status, retries, requestId: response.headers.get('x-request-id') || response.headers.get('x-groq-request-id') || undefined } };
      if ((response.status === 429 || response.status >= 500) && retries < maxRetries) { retries++; await new Promise(resolve => setTimeout(resolve, Math.min(1000, 150 * 2 ** retries))); continue; }
      throw classify(new Error('provider response rejected'), response.status, retries);
    } catch (error) {
      clearTimeout(timer); const classified = classify(error, undefined, retries);
      if ((classified.code === 'NETWORK_UNREACHABLE' || classified.code === 'TIMEOUT') && retries < maxRetries) { retries++; continue; }
      throw classified;
    }
  }
}

export class SttProvider {
  constructor(private config: DefenceConfig['stt']) {}
  available(): boolean { return this.config.provider !== 'none' && !!this.config.apiKey && !!this.config.baseUrl && !!this.config.model; }
  async transcribe(bytes: Buffer, mimeType = 'audio/webm'): Promise<string> { return (await this.transcribeWithMetrics(bytes, mimeType)).value; }
  async transcribeWithMetrics(bytes: Buffer, mimeType = 'audio/webm'): Promise<ProviderResult<string>> {
    if (!this.available()) throw new ProviderError('AUTHENTICATION_FAILED', 'STT configuration is incomplete.');
    const extension = audioExtension(mimeType); if (!extension) throw new ProviderError('UNSUPPORTED_AUDIO_FORMAT', 'The selected audio MIME type is unsupported.');
    const form = new FormData(); form.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), `speech.${extension}`);
    form.append('model', this.config.model); form.append('response_format', 'json');
    if (this.config.language !== 'auto' && this.config.language !== 'mixed') form.append('language', this.config.language);
    const started = performance.now(); const result = await requestWithRetry(`${this.config.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${this.config.apiKey}` }, body: form }, this.config.timeoutMs, this.config.maxRetries);
    let json: any; try { json = await result.value.json(); } catch { throw new ProviderError('INVALID_PROVIDER_RESPONSE', 'STT provider returned invalid JSON.', result.timing.status, result.timing.retries); }
    const text = String(json.text || '').trim(); if (!text) throw new ProviderError('INVALID_PROVIDER_RESPONSE', 'STT provider returned an empty transcript.', result.timing.status, result.timing.retries);
    result.timing.requestId ||= typeof json.x_groq?.id === 'string' ? json.x_groq.id : undefined;
    result.timing.totalMs = Math.round(performance.now() - started); return { value: text, timing: result.timing };
  }
}

export class SearchProvider {
  constructor(private config: DefenceConfig['search']) {}
  available(): boolean { return this.config.provider !== 'none' && !!this.config.apiKey; }
  async search(query: string): Promise<Evidence[]> {
    if (!this.available()) return [];
    const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: this.config.apiKey, query, max_results: 5, search_depth: 'basic' }) });
    if (!response.ok) throw classify(new Error('search failed'), response.status);
    const json: any = await response.json(); return (Array.isArray(json.results) ? json.results : []).map((item: any) => ({ sourceType: 'external', title: String(item.title || 'External source'), url: String(item.url || ''), excerpt: String(item.content || '').slice(0, 900), publishedAt: item.published_date ? String(item.published_date) : undefined, status: 'UNKNOWN', score: Number(item.score || 0) }));
  }
}

function englishDominant(value: string): boolean {
  const latin = (value.match(/[A-Za-z]/g) || []).length;
  const cjk = (value.match(/[\u3400-\u9fff]/g) || []).length;
  return latin >= 20 && latin >= cjk * 2;
}

function validateStructured(value: any, language: string): Partial<StructuredAnswer> {
  if (!value || typeof value !== 'object' || typeof value.spokenAnswer !== 'string' || typeof value.noEvidence !== 'boolean') throw new ProviderError('INVALID_STRUCTURED_OUTPUT', 'LLM output did not match the required structured schema.');
  if (value.keywords !== undefined && !Array.isArray(value.keywords)) throw new ProviderError('INVALID_STRUCTURED_OUTPUT', 'LLM keywords must be an array.');
  if (value.followUps !== undefined && !Array.isArray(value.followUps)) throw new ProviderError('INVALID_STRUCTURED_OUTPUT', 'LLM followUps must be an array.');
  if (language === 'bilingual' && (typeof value.alternateLanguageAnswer !== 'string' || !englishDominant(value.alternateLanguageAnswer))) throw new ProviderError('INVALID_STRUCTURED_OUTPUT', 'Bilingual output requires a genuinely English alternateLanguageAnswer.');
  return value;
}

export class LlmProvider {
  constructor(private config: DefenceConfig['llm']) {}
  available(): boolean { return this.config.provider !== 'none' && !!this.config.baseUrl && !!this.config.model && (!!this.config.apiKey || this.config.provider === 'ollama'); }
  async answer(question: string, evidence: Evidence[], external: Evidence[], language: string, depth: string, groundingRules = ''): Promise<Partial<StructuredAnswer>> { return (await this.answerWithMetrics(question, evidence, external, language, depth, groundingRules)).value; }
  async answerWithMetrics(question: string, evidence: Evidence[], external: Evidence[], language: string, depth: string, groundingRules = ''): Promise<ProviderResult<Partial<StructuredAnswer>>> {
    if (!this.available()) throw new ProviderError('AUTHENTICATION_FAILED', 'LLM configuration is incomplete.');
    const evidencePayload = [...evidence, ...external].map((item, index) => ({ id: index + 1, ...item }));
    const languageRules = language === 'bilingual'
      ? 'Write spokenAnswer in natural spoken Chinese and alternateLanguageAnswer in natural spoken English only. The English field must be predominantly English, not a Chinese restatement. Give each version 3 to 5 concise spoken sentences, with no headings, bullet points, or filler. Both must answer the same question from the same evidence.'
      : language === 'en'
        ? 'Write spokenAnswer in English and questionExplanation in Chinese.'
        : 'Write spokenAnswer and questionExplanation in Chinese while preserving English technical terms.';
    const prompt = `You are a project defence speaking copilot. Answer only from PROJECT_EVIDENCE for project facts. EXTERNAL_SOURCES never prove project implementation. Never invent files, symbols, metrics, incidents, or status. Keep every cited evidence ID unchanged. If evidence is insufficient set noEvidence=true. Preserve code names. ${languageRules} Output a JSON object with keys: questionExplanation, keywords, spokenAnswer, alternateLanguageAnswer, followUps, noEvidence, missingInformation. Example JSON: {"spokenAnswer":"...","noEvidence":false,"keywords":[],"followUps":[]}. Requested output=${language}, depth=${depth}.\nGROUNDING_RULES:\n${groundingRules || 'Use only the supplied project evidence.'}\nQUESTION:\n${question}\nPROJECT_EVIDENCE:\n${JSON.stringify(evidencePayload)}`;
    const started = performance.now(); let lastInvalid: ProviderError | undefined;
    for (let structuredAttempt = 0; structuredAttempt < 2; structuredAttempt++) {
      const body = { model: this.config.model, messages: [{ role: 'system', content: structuredAttempt ? 'Repair the prior formatting failure. Return one valid JSON object only, using exactly the supplied PROJECT_EVIDENCE IDs.' : 'Return one valid JSON object only. JSON output is mandatory.' }, { role: 'user', content: prompt }], temperature: 0.2, response_format: { type: 'json_object' }, thinking: { type: this.config.thinking ? 'enabled' : 'disabled' } };
      const result = await requestWithRetry(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}) }, body: JSON.stringify(body) }, this.config.timeoutMs, this.config.maxRetries);
      let json: any; try { json = await result.value.json(); } catch { throw new ProviderError('INVALID_PROVIDER_RESPONSE', 'LLM provider returned invalid JSON.', result.timing.status, result.timing.retries); }
      result.timing.requestId ||= typeof json.id === 'string' ? json.id : undefined;
      try {
        const content = json.choices?.[0]?.message?.content;
        const parsed = JSON.parse(String(content || '').replace(/^```json\s*|\s*```$/g, ''));
        result.timing.retries += structuredAttempt; result.timing.totalMs = Math.round(performance.now() - started);
        return { value: validateStructured(parsed, language), timing: result.timing };
      } catch (error) {
        lastInvalid = error instanceof ProviderError ? error : new ProviderError('INVALID_STRUCTURED_OUTPUT', 'LLM response was not valid structured JSON.', result.timing.status, result.timing.retries + structuredAttempt);
      }
    }
    throw lastInvalid || new ProviderError('INVALID_STRUCTURED_OUTPUT', 'LLM response was not valid structured JSON.');
  }
}
