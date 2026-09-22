// electron/utils/curlPlaceholderPolicy.ts
//
// The placeholder rules for a custom cURL provider template: which spellings
// count, and what to tell the user when a placeholder survives the raw string
// but not the parse.
//
// WHY THIS IS ITS OWN MODULE (2026-09-04)
// The regexes and the diagnostic copy had been written out three times —
// electron/utils/curlUtils.ts (main), src/lib/curl-validator.ts (renderer), and
// a closure inside ipcHandlers.ts (the IPC boundary). That triplication is what
// let the strict and spacing-tolerant forms drift apart in the first place: the
// engine's deepVariableReplacer accepted `{{ TEXT }}` while the IPC boundary
// rejected it, so a template that would have worked could not be saved. The next
// tolerance change has to land in one place, not four.
//
// Deliberately dependency-free — no node builtins, no Electron — so the renderer
// can take it too. (curlUtils itself cannot be the home: it imports node:fs for
// validateImagePath, which would drag fs into the renderer bundle.)
//
// WHY IT LIVES UNDER electron/ AND NOT src/lib (2026-09-04): this is
// main-process policy that the renderer happens to consume, and the renderer
// already reaches the other way for exactly that reason — see
// NativelyInterface importing '../../electron/utils/rollingTranscriptState.ts'.
//
// The first cut put it in src/lib, which broke a test nothing else catches:
// EvidenceResolverWiringIdentity emits an UNBUNDLED tree with tsc
// (electron/tsconfig.emit.json, which covers electron/** only) and requires
// LLMHelper from it. esbuild inlines a cross-tree import so the shipped bundle
// is fine, but tsc emits a real require() to a file that is not in the emit
// tree — MODULE_NOT_FOUND. src/lib/micPermissionPolicy.mjs carries the same
// latent flaw; it survives only because that test never loads ipcHandlers.
// Keeping main-process policy inside electron/ keeps the emit tree closed.
//
// Platform: pure string and object inspection. No paths, no separators, no
// platform branch — identical on darwin and win32.

/** The parsed shape curl2Json produces, narrowed to what the rules read. */
export interface ParsedCurlSurface {
  url?: unknown;
  header?: unknown;
  data?: unknown;
  form?: unknown;
  params?: unknown;
}

/** The prompt placeholder, spacing tolerated: `{{TEXT}}`, `{{ TEXT }}`. */
export const TEXT_PLACEHOLDER_RE = /\{\{\s*TEXT\s*\}\}/;

/** Any `{{NAME}}` placeholder, spacing tolerated. */
export const ANY_PLACEHOLDER_RE = /\{\{\s*[A-Z_0-9]+\s*\}\}/;

/**
 * `decodeURIComponent` that yields the input back instead of throwing.
 *
 * curl2Json URL-encodes `params`, so the placement probe below has to decode
 * them to see a placeholder. But the query string is arbitrary user text: a lone
 * `%` (`?discount=100%`) makes decodeURIComponent throw URIError, which the
 * callers' enclosing try/catch swallowed and reported as "Invalid cURL syntax."
 * — the least informative of the three messages, and a wrong diagnosis that
 * sends the user hunting for a syntax typo instead of the quoting problem this
 * check exists to name (code review, 2026-09-04).
 *
 * Falling back to the raw string is right rather than merely safe: an
 * undecodable query string still contains `%7B%7BTEXT%7D%7D` verbatim if the
 * placeholder is in it, and the raw form is also tested below.
 */
export function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Whether a placeholder survived into the surface the executors actually send.
 *
 * Executors send url + header + data + method only. A body that isn't valid JSON
 * does not fail loudly — curl2Json returns `data: {}` for it — so the
 * placeholders vanish and the request goes out as an empty POST with the prompt
 * silently dropped.
 */
export function placeholderReachesTheWire(json: ParsedCurlSurface): boolean {
  return ANY_PLACEHOLDER_RE.test(
    JSON.stringify([json.url ?? '', json.header ?? {}, json.data ?? {}]),
  );
}

/**
 * Why a placeholder that was present in the raw template is missing from the
 * parsed surface. Two distinct causes, and naming the wrong one sends the user
 * to fix something that isn't there.
 *
 *  (a) it landed in `form` (-F) or `params` (a ?query=), neither of which any
 *      executor sends, so such a template never reached the wire even before
 *      this check existed. curl2Json also URL-encodes params, so the placeholder
 *      arrives mangled as %7B%7BTEXT%7D%7D — hence the decode.
 *  (b) the -d body is not valid JSON, so curl2Json returned `{}`. The usual
 *      cause is an unquoted placeholder: `{"prompt": {{TEXT}}}` instead of
 *      `{"prompt": "{{TEXT}}"}`.
 */
export function explainMissingPlaceholder(json: ParsedCurlSurface): string {
  const inForm = ANY_PLACEHOLDER_RE.test(JSON.stringify(json.form ?? []));
  const rawParams = JSON.stringify(json.params ?? {});
  const inParams =
    ANY_PLACEHOLDER_RE.test(rawParams) ||
    ANY_PLACEHOLDER_RE.test(safeDecodeURIComponent(rawParams));

  return inForm || inParams
    ? 'Put the prompt in a JSON body. Custom providers send the URL, headers and -d body — '
      + 'a placeholder in a -F form field or a ?query= parameter is never sent.'
    : "Your request body isn't valid JSON, so the prompt placeholder was dropped. "
      + 'Check the quoting in -d — placeholders must sit inside quotes, e.g. "{{TEXT}}".';
}
