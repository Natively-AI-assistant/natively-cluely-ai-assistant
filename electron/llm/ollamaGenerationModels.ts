// electron/llm/ollamaGenerationModels.ts
//
// Which locally-installed Ollama models can GENERATE text.
//
// `/api/tags` lists everything pulled, embedders included, and Natively pulls
// `nomic-embed-text` itself on first launch (electron/main.ts) for retrieval.
// Handed that raw list, the app offered an embedding model as a chat model in
// every model picker, and `initializeOllamaModel()` could auto-select it as THE
// local model — `availableModels[0]` — because /api/tags is ordered by modified
// time and a freshly bootstrapped embedder sorts first. The failure then landed
// at generation time as an opaque Ollama error, far from the setting that caused
// it.
//
// The mirror image of this question is already answered in
// electron/rag/ollamaEmbeddingModels.ts, and this file deliberately uses the
// same source of truth for the same documented reason: `/api/show`'s
// `capabilities` array. Name and family heuristics are wrong in BOTH directions
// here — `qwen3:30b` and `qwen3-embedding:8b` share a prefix, `all-minilm` says
// nothing about embedding, and `qwen3-embedding` reports the same `qwen3`
// family as the chat model it is not.

const SHOW_TIMEOUT_MS = 5_000;
/**
 * Whole-call budget for the probe fan-out. checkOllamaAvailable() runs this
 * DURING a turn, and per-request timeouts alone do not bound it: 40 installed
 * models against a hung daemon is 10 sequential batches of 5s. Past the budget
 * the remaining models are kept unprobed, which is the same fail-open direction
 * as an unreadable probe.
 */
const BUDGET_MS = 4_000;
/** Concurrent /api/show probes. Matches ollamaEmbeddingModels.ts. */
const PROBE_LIMIT = 4;
/**
 * Capabilities of a given tag are effectively immutable — a re-pull of a moving
 * tag like `:latest` is the only way they change — so this exists to keep a
 * panel that refreshes on every open from re-probing, not to track change.
 */
const CACHE_TTL_MS = 10 * 60_000;

type FetchLike = typeof fetch;

const capsCache = new Map<string, { at: number; capabilities: string[] | null }>();

/** Test seam. */
export function __resetOllamaCapabilityCache(): void {
  capsCache.clear();
}

/**
 * Can this model answer a generation request?
 *
 * Reported capabilities are authoritative when present. A model that reports
 * NOTHING is treated as capable: older daemons omit the field entirely, and
 * failing closed there would empty every model picker on a slightly older
 * Ollama — a far worse outcome than listing one model that errors when used.
 * Same fail-open direction as the embedding lister, for the same reason.
 */
export function isGenerationCapable(capabilities: string[] | null | undefined): boolean {
  if (!Array.isArray(capabilities) || capabilities.length === 0) return true;
  return capabilities.includes('completion');
}

/**
 * ONE key builder, used by both readers. They were written separately once and
 * silently disagreed about the separator, which made every cached answer
 * invisible to the budget check — a bug no type can catch and no assertion about
 * a single call can see. \u0000 is written as an escape, never as a literal
 * byte: a raw control character in a source file makes grep skip the whole file.
 */
function cacheKey(base: string, name: string): string {
  return `${base}\u0000${name}`;
}

function isCached(base: string, name: string): boolean {
  const hit = capsCache.get(cacheKey(base, name));
  return !!hit && Date.now() - hit.at < CACHE_TTL_MS;
}

/**
 * One model's capability, cached. Exported for callers that already know which
 * model they are about to use and must not pay for a whole fan-out.
 */
export async function isOllamaGenerationModel(
  baseUrl: string,
  name: string,
  doFetch: FetchLike = fetch,
): Promise<boolean> {
  return isGenerationCapable(await probeCapabilities(baseUrl.replace(/\/+$/, ''), name, doFetch));
}

async function probeCapabilities(base: string, name: string, doFetch: FetchLike): Promise<string[] | null> {
  const key = cacheKey(base, name);
  const hit = capsCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.capabilities;

  try {
    const res = await doFetch(`${base}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: name }),
      signal: AbortSignal.timeout(SHOW_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const capabilities: string[] | null = Array.isArray(data?.capabilities) ? data.capabilities : null;
    capsCache.set(key, { at: Date.now(), capabilities });
    return capabilities;
  } catch {
    // Unreachable or slow: NOT cached, and read as "unknown" so the caller keeps
    // the model. A transient daemon hiccup must not delete a working model from
    // the picker for the next ten minutes.
    return null;
  }
}

/**
 * Narrow an installed-model list to the models that can generate.
 *
 * Never throws and never returns more than it was given. Probes run bounded and
 * concurrently: `/api/tags` on a developer machine can list 40+ models, and this
 * sits behind a panel refresh, so an unbounded fan-out would be enough to stall
 * a daemon that is also serving generation.
 */
export async function filterOllamaGenerationModels(
  baseUrl: string,
  names: string[],
  doFetch: FetchLike = fetch,
  budgetMs: number = BUDGET_MS,
): Promise<string[]> {
  if (names.length === 0) return [];
  const base = baseUrl.replace(/\/+$/, '');
  const deadline = Date.now() + budgetMs;

  const keep: boolean[] = new Array(names.length).fill(true);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(PROBE_LIMIT, names.length) }, async () => {
    for (let i = next++; i < names.length; i = next++) {
      // A cached answer is free, so the budget only stops NEW probes.
      if (Date.now() >= deadline && !isCached(base, names[i])) continue;
      keep[i] = isGenerationCapable(await probeCapabilities(base, names[i], doFetch));
    }
  }));

  return names.filter((_, i) => keep[i]);
}
