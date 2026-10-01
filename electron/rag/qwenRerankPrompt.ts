/**
 * The Qwen3-Reranker scoring protocol.
 *
 * Qwen3-Reranker is not a cross-encoder. It is a causal LM asked a yes/no
 * question, and its "score" is how much probability mass it puts on "yes"
 * versus "no" at the very next token. llama.cpp's ranking API refuses it for
 * exactly this reason — there is no ranking head to read.
 *
 * The template below is Qwen's own, copied from the model card rather than
 * reconstructed: a system turn fixing the answer to yes/no, a user turn
 * carrying instruction + query + document, and an assistant turn with an EMPTY
 * think block. All three matter. Drop the `<think>\n\n</think>` and the model
 * is answering a different question from the one it was tuned on.
 *
 * SCORING, and why the normalisation is not what it looks like:
 *
 *   reference:  softmax([logit_no, logit_yes])[1]
 *   here:       p_yes / (p_yes + p_no)   from FULL-VOCAB probabilities
 *
 * Those are the same number. Softmax over the two logits divides by
 * exp(l_yes)+exp(l_no); full-vocab probabilities divide by Z. Taking the ratio
 * cancels Z, so the vocabulary-wide normalisation drops out exactly. That is
 * what lets this run on a runtime that exposes probabilities rather than raw
 * logits.
 */

/** Qwen's default retrieval instruction, from the model card. */
export const QWEN_DEFAULT_INSTRUCTION =
  'Given a web search query, retrieve relevant passages that answer the query';

export const QWEN_RERANK_PREFIX =
  '<|im_start|>system\nJudge whether the Document meets the requirements based on the Query '
  + 'and the Instruct provided. Note that the answer can only be "yes" or "no".<|im_end|>\n'
  + '<|im_start|>user\n';

export const QWEN_RERANK_SUFFIX =
  '<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n';

export function buildQwenRerankPrompt(
  query: string,
  document: string,
  instruction: string = QWEN_DEFAULT_INSTRUCTION,
): string {
  return `${QWEN_RERANK_PREFIX}<Instruct>: ${instruction}\n<Query>: ${query}\n<Document>: ${document}${QWEN_RERANK_SUFFIX}`;
}

/**
 * P(yes) against P(no), from full-vocabulary probabilities.
 *
 * Returns null when neither token carries any mass — which means the prompt did
 * not reach the model in the shape it expects, and a fabricated 0.5 would be
 * indistinguishable from a genuine tie.
 */
export function yesNoScore(pYes: number | undefined, pNo: number | undefined): number | null {
  const yes = Number.isFinite(pYes) ? (pYes as number) : 0;
  const no = Number.isFinite(pNo) ? (pNo as number) : 0;
  const total = yes + no;
  if (!(total > 0)) return null;
  return yes / total;
}
