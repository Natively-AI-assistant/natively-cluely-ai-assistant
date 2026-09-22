// electron/rag/ninerouterEmbeddingModels.ts
//
// Model discovery for 9Router embeddings.
//
//   GET {base}/models/embedding
//
// 9Router types its catalogue by kind, so the embedding list is a dedicated
// route rather than a filter — no guessing from model names, and no risk of a
// chat model landing in an embedding picker. Verified live (2026-09-21): 6
// models on the reference instance.
//
// Like every GET on a 9Router instance this answers WITHOUT a key, so the
// catalogue renders before the user has pasted one. That is convenient and it
// is also a trap: /v1/embeddings does require a key, so "the list loaded" says
// nothing about whether embedding will work. The dimension probe below is the
// part that actually proves it.

import type { EmbeddingCatalogModel } from './embeddingCatalog';

const LIST_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 20_000;
const DEFAULT_BASE_URL = 'http://localhost:20128/v1';
const DIMENSION_PROBE_TEXT = 'natively embedding dimension probe';

export interface NinerouterListOptions {
  baseUrl?: string;
  /** Optional: listing works unauthenticated on a stock instance. */
  apiKey?: string;
}

function headers(apiKey?: string): Record<string, string> {
  const h: Record<string, string> = {};
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

/** Accept a root or a `/v1` base, the same two forms users paste elsewhere. */
function v1(baseUrl: string): string {
  const root = (baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  return /\/v1$/.test(root) ? root : `${root}/v1`;
}

/**
 * Widths a model can be asked for, derived ONLY from families this repo has
 * already verified against the vendor's own documentation:
 *   gemini/gemini-embedding-*   768/1536/3072   (ai.google.dev)
 *   openai/text-embedding-3-small 512/1536      (developers.openai.com)
 *   openai/text-embedding-3-large 256/1024/3072
 *
 * Everything else gets NO width choice. 9Router forwards `dimensions` upstream
 * and most models ignore it, so offering options for an unknown model would be
 * inventing a capability. The probe is the arbiter either way.
 */
function supportedWidthsFor(id: string): number[] | undefined {
  if (/^gemini\/gemini-embedding-/.test(id)) return [768, 1536, 3072];
  if (id === 'openai/text-embedding-3-small') return [512, 1536];
  if (id === 'openai/text-embedding-3-large') return [256, 1024, 3072];
  return undefined;
}

/**
 * The embedding models this 9Router instance offers.
 *
 * Never throws — an unreachable instance is "no models", which the panel
 * already renders, rather than an error every call site must handle.
 */
export async function listNinerouterEmbeddingModels(
  opts: NinerouterListOptions = {},
): Promise<EmbeddingCatalogModel[]> {
  const base = v1(opts.baseUrl || DEFAULT_BASE_URL);
  try {
    const res = await fetch(`${base}/models/embedding`, {
      headers: headers(opts.apiKey),
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    const rows: any[] = Array.isArray(data?.data) ? data.data : [];
    return rows
      .filter(m => typeof m?.id === 'string')
      .map(m => ({
        id: m.id,
        // 9Router's ids are `{upstreamAlias}/{model}` and that whole string is
        // the identity, so it is also the label — prettifying would hide which
        // upstream is being billed.
        label: m.id,
        // UNKNOWN here, deliberately. /v1/models/info reports no width for 5 of
        // the 6 models a stock instance serves, so it is measured on selection.
        dimensions: 0,
        dimensionsVerified: false,
        supportedDimensions: supportedWidthsFor(m.id),
        note: typeof m?.owned_by === 'string' ? `via ${m.owned_by}` : undefined,
      })) as EmbeddingCatalogModel[];
  } catch { return []; }
}

/**
 * Measure a model's real output width, through the SAME endpoint embeddings
 * use — probing anything else could report a width the stored vectors never
 * have.
 *
 * Returns null when the model cannot embed, when the instance is unreachable,
 * or when the upstream behind that model is broken. The caller must then NOT
 * configure it rather than assume a width.
 *
 * That last case is real and common on 9Router, because it relays the
 * upstream's status: on the reference instance `gemini/text-embedding-004`
 * answers 401 ("the bound service account is deleted or disabled") while
 * `gemini/gemini-embedding-001` embeds fine at 3072d on the same key. A model
 * appearing in the catalogue is not a promise that it works, so nothing here
 * treats a listed model as configurable until it has produced a vector.
 */
export async function probeNinerouterEmbeddingDimensions(
  model: string,
  apiKey?: string,
  baseUrl?: string,
  /** Ask for a specific width. The RETURNED length is still the truth. */
  requestedDimensions?: number,
): Promise<number | null> {
  if (!model) return null;
  const base = v1(baseUrl || DEFAULT_BASE_URL);
  try {
    const res = await fetch(`${base}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers((apiKey || '').trim()) },
      body: JSON.stringify({
        model,
        input: DIMENSION_PROBE_TEXT,
        ...(requestedDimensions ? { dimensions: requestedDimensions } : {}),
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const values = data?.data?.[0]?.embedding;
    if (!Array.isArray(values) || values.length === 0) return null;
    return values.length;
  } catch { return null; }
}
