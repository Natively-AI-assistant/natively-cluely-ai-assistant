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

export interface OpencodeModelMeta {
  /** Which wire protocol serves this id. */
  api: OpencodeApiFamily;
  /** From `api.<family>.base_url`; the family base when the catalogue omits it. */
  baseUrl: string;
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
