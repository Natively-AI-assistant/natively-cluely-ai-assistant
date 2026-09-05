// electron/llm/routing/routerText.ts
//
// The string the router's encoder sees. One definition, importable anywhere.
//
// It lives here rather than in routerWorker.ts because that module throws on
// import outside a worker thread, by design, which made the format contract
// unreachable from a test. A contract that cannot be checked is the thing that
// drifts.
//
// FOUR PLACES BUILD THIS STRING AND ALL FOUR MUST AGREE:
//
//   scripts/intent-benchmark/tools/train_multihead.py   build_text
//   scripts/intent-benchmark/providers/embeddingPrototype.mjs   buildText
//   this file
//   anything that later feeds the model outside the worker
//
// If they drift, the model is trained on one format and predicts on another.
// Nothing throws. Accuracy drops and it reads as a bad model rather than a bad
// contract. The benchmark has a test that diffs the first two byte for byte
// over real corpus rows, and RouterModel.test.mjs pins this one to the same
// fixed shape.

export interface RouterTextInput {
  mode: string;
  channel: string;
  turn: string;
  history?: string[];
  modeHasReferenceFiles?: boolean;
}

/** Only the last two history turns, joined by a single space, as trained. */
export function buildRouterText(input: RouterTextInput): string {
  const hist = (input.history ?? []).slice(-2).join(' ');
  const files = input.modeHasReferenceFiles ? 'yes' : 'no';
  return `[mode] ${input.mode} [channel] ${input.channel} [files] ${files} [history] ${hist} [turn] ${input.turn}`;
}
