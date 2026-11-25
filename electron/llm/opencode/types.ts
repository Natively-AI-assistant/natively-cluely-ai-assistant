/**
 * OpenCode model metadata.
 *
 * The catalogue is authoritative for WHICH protocol serves a model
 * (`recommended_api` / the single key of `api`), whether it reads images
 * (`modalities.input`), its context window and its output ceiling
 * (`limit.*`). Persisting this at fetch time is what lets a later turn route
 * without a network round-trip and without guessing from the model's name.
 */

export type OpencodeApiFamily =
  | 'chat-completions'
  | 'responses'
  | 'messages'
  | 'generate-content';

export const OPENCODE_API_FAMILIES: readonly OpencodeApiFamily[] = [
  'chat-completions',
  'responses',
  'messages',
  'generate-content',
];

/** One way to reach a model: the protocol and the base it is served on. */
export interface OpencodeRoute {
  api: OpencodeApiFamily;
  baseUrl: string;
  /**
   * The route's own reasoning capability, when it differs from the model's
   * pay-as-you-go entry (kimi-k3 lists low/high/max paid but only max on Go,
   * so sending the paid route's `low` to Go is a parameter Go never offered).
   */
  reasoning?: boolean;
  reasoningEffort?: string[];
}

/**
 * Whether the saved key has an OpenCode Go subscription.
 *
 * Neither catalogue can tell: `/go/v1/models` answers 200 to anyone, key or
 * not (checked live 2026-11-25). It is read from Go's usage endpoint
 * (probeOpencodeGoAccess) with every catalogue fetch, and re-read when a
 * route refusal suggests the stored answer went stale. `unknown` = that
 * endpoint could not be read.
 */
export type OpencodeGoAccess = 'unknown' | 'yes' | 'no';

export interface OpencodeModelMeta {
  /** Which wire protocol serves this id on `baseUrl`. */
  api: OpencodeApiFamily;
  /**
   * The pay-as-you-go base when the paid catalogue lists the model, else its
   * Go base (`goOnly`). From `api.<family>.base_url`; the family base when the
   * catalogue omits it.
   */
  baseUrl: string;
  /**
   * The Go route, when the Go catalogue lists the model. Kept separate rather
   * than overwriting `api`/`baseUrl`, because the Go list is public: holding it
   * says nothing about whether THIS key may use it. It can also name a
   * different protocol (minimax-m3 is Messages on Go, Chat Completions paid).
   */
  goRoute?: OpencodeRoute;
  /** True when only the Go catalogue lists the model (no pay-as-you-go route). */
  goOnly?: boolean;
  /** True when `modalities.input` contains any image/* entry. */
  vision: boolean;
  /** `limit.context`, absent when the catalogue omitted it. */
  contextTokens?: number;
  /** `limit.output`, absent when the catalogue omitted it. */
  outputTokens?: number;
  /** `capabilities.reasoning.effort`, verbatim. */
  reasoningEffort?: string[];
  /** `capabilities.reasoning.supported`. */
  reasoning?: boolean;
  /** Display name, so a fetched-only id can be labelled without a preset. */
  name?: string;
  /** True for a Go-catalogue entry. */
  go?: boolean;
}
