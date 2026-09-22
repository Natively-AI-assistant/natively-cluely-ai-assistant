// electron/rag/ollamaEmbeddingModels.ts
//
// Discovery for locally-installed Ollama embedding models: which models can
// embed, and how wide their vectors actually are.
//
// This exists because OllamaEmbeddingProvider used to hard-code
// `dimensions = 768` (nomic-embed-text) while accepting any model name. Pointing
// it at qwen3-embedding:8b (4096d) would stamp an embedding_space key claiming
// 768 dimensions over 4096-dimensional vectors — an index that compares as
// nonsense with no error anywhere, which is precisely what embeddingSpace.ts was
// written to prevent.

const PROBE_TIMEOUT_MS = 15_000;
const LIST_TIMEOUT_MS = 5_000;

/** Text used to measure a model's output width. Content is irrelevant; only length of the result matters. */
const DIMENSION_PROBE_TEXT = 'natively embedding dimension probe';

export interface OllamaEmbeddingModel {
  name: string;
  /**
   * Width DECLARED by the model metadata (`model_info['<arch>.embedding_length']`).
   *
   * This is the model's HIDDEN SIZE. For most embedders it equals the output
   * width, but pooling, a projection head or Matryoshka truncation can make it
   * differ — so it is a display hint only. Never persist a space key from it;
   * use probeOllamaEmbeddingDimensions(), which measures the real thing.
   */
  dimensionsHint: number | null;
  /** Always false here: nothing in this list has been measured yet. */
  dimensionsVerified: boolean;
  /** Raw capabilities as reported by /api/show, when the daemon reports any. */
  capabilities: string[] | null;
}

const withTimeout = (ms: number) => AbortSignal.timeout(ms);

/** `general.architecture` + `<arch>.embedding_length` → declared width. */
function declaredWidth(modelInfo: Record<string, unknown> | undefined): number | null {
  if (!modelInfo) return null;
  const arch = modelInfo['general.architecture'];
  if (typeof arch === 'string') {
    const v = modelInfo[`${arch}.embedding_length`];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  }
  // Architecture key missing or mismatched — fall back to any *.embedding_length.
  for (const [k, v] of Object.entries(modelInfo)) {
    if (k.endsWith('.embedding_length') && typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

/**
 * Locally-installed models that can produce embeddings.
 *
 * Capability comes from /api/show's `capabilities` array — the data the daemon
 * actually exposes — NOT from guessing at names. Name heuristics are wrong in
 * both directions here: `qwen3:30b` and `qwen3-embedding:8b` share a prefix, and
 * plenty of embedders are not called "embed" anything.
 *
 * A model whose /api/show reports NO capabilities array at all is INCLUDED:
 * older Ollama builds omit the field entirely, and excluding them would hide
 * every working embedder on a slightly older daemon. The dimension probe is the
 * real gate — a model that cannot embed fails it and is rejected there.
 *
 * Never throws: a stopped daemon is "no models", not an error to handle at every
 * call site.
 */
export async function listOllamaEmbeddingModels(baseUrl: string): Promise<OllamaEmbeddingModel[]> {
  let names: string[];
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/tags`, { signal: withTimeout(LIST_TIMEOUT_MS) });
    if (!res.ok) return [];
    const data: any = await res.json();
    names = (data?.models || []).map((m: any) => m?.name).filter((n: any): n is string => typeof n === 'string');
  } catch { return []; }

  const base = baseUrl.replace(/\/+$/, '');
  // BOUNDED, not Promise.all over every installed model. `/api/tags` on a
  // developer machine can list 40+ models, and this runs on every panel open and
  // after every selection (which calls refresh()) — 40 concurrent POSTs are
  // enough to stall a daemon that is also serving generation.
  const inspectOne = async (name: string): Promise<OllamaEmbeddingModel | null> => {
    try {
      const res = await fetch(`${base}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: name }),
        signal: withTimeout(LIST_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const data: any = await res.json();
      const capabilities: string[] | null = Array.isArray(data?.capabilities) ? data.capabilities : null;
      // Reported capabilities are authoritative when present.
      if (capabilities && !capabilities.includes('embedding')) return null;
      return {
        name,
        dimensionsHint: declaredWidth(data?.model_info),
        dimensionsVerified: false,
        capabilities,
      };
    } catch { return null; }
  };

  const inspected: Array<OllamaEmbeddingModel | null> = new Array(names.length);
  {
    const LIMIT = 4;
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(LIMIT, names.length) }, async () => {
      for (let i = next++; i < names.length; i = next++) inspected[i] = await inspectOne(names[i]);
    }));
  }

  return inspected.filter((m): m is OllamaEmbeddingModel => m !== null);
}

/**
 * Measure a model's real output width by embedding one short string.
 *
 * Deliberately uses the SAME endpoint and request shape OllamaEmbeddingProvider
 * uses for real embeddings (`POST /api/embeddings` with `prompt`). Probing a
 * different call path could report a width the stored vectors never have, which
 * would be worse than not probing at all.
 *
 * Returns null when the model cannot embed or the daemon is unreachable — the
 * caller must then NOT construct a provider, rather than fall back to a default
 * width and stamp a wrong space.
 */
export async function probeOllamaEmbeddingDimensions(baseUrl: string, model: string): Promise<number | null> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: DIMENSION_PROBE_TEXT }),
      signal: withTimeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const values = data?.embedding;
    if (!Array.isArray(values) || values.length === 0) return null;
    return values.length;
  } catch { return null; }
}
