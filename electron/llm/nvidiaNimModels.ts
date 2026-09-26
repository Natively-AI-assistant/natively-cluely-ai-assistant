// electron/llm/nvidiaNimModels.ts
//
// The single place that names which NVIDIA NIM models Natively pins, which ones
// NVIDIA has shut down, and how to read a probe response.
//
// Why this exists (2026-08-28): Settings -> AI Providers -> "Test Connection"
// for NVIDIA NIM failed for every user. The probe pinned
// `meta/llama-3.1-8b-instruct`, which NVIDIA retired on 2026-08-26 in a batch
// EOL, so a perfectly valid key reported "Request failed with status code 410".
// Same failure mode as the Groq retirements (see groqModels.ts): a pinned id
// turns someone else's deprecation calendar into "your API key is broken".
//
// THE RESPONSE MATRIX, probed directly against integrate.api.nvidia.com and
// reproduced on 2026-08-28 (the 403 twice, back to back):
//
//   no Authorization header      401  "Header of type `authorization` was missing"
//   invalid key, live model      403  {"title":"Forbidden","detail":"Authorization failed"}
//   VALID key, unservable model  404  {"…":"Model not found"}
//   any key, retired model       410  {"title":"Gone","detail":"The model '…' has
//                                      reached its end of life on 2026-08-26…"}
//   unrouted id                  404  "404 page not found" (plain text, no JSON)
//
// Two consequences drive everything below.
//
// FIRST: 410 is returned BEFORE auth is checked, so it says nothing about the
// key. That is the only case worth retrying on another model.
//
// SECOND — and this is the one that cost a round trip to learn: 404 "Model not
// found" is returned AFTER auth. NVIDIA answers a bad key with 403 on every
// non-retired id. So a 404 is POSITIVE EVIDENCE THE KEY WAS ACCEPTED, and the
// probe must report success on it. The first fix here pinned a live-looking id
// and reported the 404 as a failure, which is just the original bug wearing a
// different status code: the probe was asking "did this model answer?" when the
// only question it exists to answer is "was the key accepted?".
//
// That distinction also means we do NOT need to know which ids NVIDIA actually
// serves — and we cannot find out from here. `GET /v1/models` returns 200 to an
// invalid key and lists ids that /chat/completions refuses (nvidia/nemotron-
// nano-3-30b-a3b is in the catalogue and 404s), and `GET /v1/models/<id>` 200s
// for all of them. There is no public signal. Under the rule above, we don't
// need one.
//
// Platform note: pure constants and HTTP status matching. Identical on macOS
// and Windows — there is no platform-conditional code in this module.

/** Strip the `nvidia_nim/` routing prefix Natively puts on picker ids. */
export function bareNvidiaNimModelId(modelId: string | null | undefined): string {
  const id = modelId || '';
  return id.startsWith('nvidia_nim/') ? id.slice('nvidia_nim/'.length) : id;
}

/**
 * Ordered ladder for the Settings connection probe.
 *
 * It is short on purpose. Under the rule above a single non-retired id settles
 * the question — 200, 400, 404 and 422 all mean the key was accepted — so extra
 * rungs buy nothing and each one costs a 15s timeout. The ladder exists ONLY
 * for the 410 case, where the id is retired and the response is pre-auth, so
 * a second, differently-owned id is needed to learn anything at all. Three
 * owners, so one vendor's EOL batch cannot take the whole ladder with it (the
 * 2026-08-26 batch retired every `meta/*` chat id at once).
 *
 * These are NOT claimed to be servable — see the header; that is unknowable
 * from outside an entitled account, and deliberately does not matter here.
 */
export const NVIDIA_NIM_TEST_MODEL_LADDER: readonly string[] = [
  'nvidia/llama-3.1-nemotron-70b-instruct',
  'openai/gpt-oss-20b',
  'mistralai/mistral-7b-instruct-v0.3',
];

/**
 * What one probe response settles.
 *
 *   'key-ok'        the key was accepted — 200, or a per-model rejection that
 *                   only happens post-auth. STOP, report success.
 *   'key-bad'       the key is the problem (401/403). STOP, report it.
 *   'try-next'      410: pre-auth, tells us nothing. Advance the ladder.
 *   'inconclusive'  rate limit, server error, network failure. STOP, report it
 *                   verbatim rather than guessing at a remedy.
 */
export type NvidiaNimProbeVerdict = 'key-ok' | 'key-bad' | 'try-next' | 'inconclusive';

export function classifyNvidiaNimProbeError(err: any): NvidiaNimProbeVerdict {
  const status = Number(err?.response?.status ?? err?.status ?? err?.statusCode ?? 0) || 0;
  if (status === 410) return 'try-next';
  if (status === 401 || status === 403 || status === 407) return 'key-bad';
  // 429 is NOT 'key-ok'. A rate limit does prove the key reached an account,
  // but reporting "connected" while the account is throttled tells the user the
  // opposite of what they need to know.
  if (status === 429 || status === 408) return 'inconclusive';
  // Post-auth per-model rejections. 404 is the load-bearing one — see header.
  // Guarded on a JSON body so NVIDIA's plain-text routing 404 ("404 page not
  // found"), which an unrouted id produces and which does NOT imply auth
  // succeeded, is not mistaken for a working key.
  if ((status === 400 || status === 404 || status === 422) && isJsonBody(err)) return 'key-ok';
  return 'inconclusive';
}

function isJsonBody(err: any): boolean {
  const body = err?.response?.data;
  return !!body && typeof body === 'object';
}

/**
 * True when `err` says the MODEL is retired, as opposed to anything about the
 * key. 410 only: NVIDIA returns it before auth, so it is the one status that
 * justifies re-probing on a different model.
 */
export function isNvidiaNimModelGone(err: any): boolean {
  return classifyNvidiaNimProbeError(err) === 'try-next';
}

/**
 * Ids NVIDIA has SHUT DOWN — compare by id, not by version: a retirement is not
 * a version bump. Each was confirmed 410 against integrate.api.nvidia.com on
 * 2026-08-28. The two marked SHIPPED are the ones that matter operationally:
 * the picker offered them, so a user can have either persisted as their default
 * and needs the repair path, not just a corrected list.
 *
 * Accepts the prefixed and bare forms; callers hold both.
 */
export const NVIDIA_NIM_RETIRED_MODEL_IDS: ReadonlySet<string> = new Set<string>([
  'meta/llama-3.1-8b-instruct', // SHIPPED (probe pin + picker). EOL 2026-08-26T09:00:00Z
  'z-ai/glm4.7', // SHIPPED (picker). EOL 2026-05-14T00:00:00Z
  'meta/llama-3.3-70b-instruct', // EOL 2026-08-26T09:00:00Z
  'nvidia/llama-3.3-nemotron-super-49b-v1.5', // EOL 2026-08-26T09:00:00Z
]);

export function isNvidiaNimRetiredModelId(modelId: string | null | undefined): boolean {
  return NVIDIA_NIM_RETIRED_MODEL_IDS.has(bareNvidiaNimModelId(modelId));
}

/**
 * NVIDIA answers in RFC-7807 shape — `{type,title,status,detail}` — with no
 * `error.message` and no top-level `message`. The generic extractor in
 * ipcHandlers reads only those two, which is exactly why the failure logged
 * `responseError: undefined` and the user got the bare axios string instead of
 * "The model '…' has reached its end of life on 2026-08-26".
 */
export function nvidiaNimErrorDetail(err: any): string | null {
  const body = err?.response?.data;
  if (!body || typeof body !== 'object') return null;
  const detail = typeof body.detail === 'string' ? body.detail.trim() : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (detail && title && detail.toLowerCase() !== title.toLowerCase()) {
    return `${title}: ${detail}`;
  }
  return detail || title || null;
}
