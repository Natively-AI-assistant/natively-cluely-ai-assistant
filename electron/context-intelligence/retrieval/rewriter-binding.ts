// Where the low-confidence query rewrite is switched ON (owner decision, 2026-09-21).
//
// Live A/B in a real dev session, live-meeting surface, real PDFs:
//   · hosted embeddings (natively): 14/14 correct and the rewrite fired 0 of 14 times — retrieval
//     already finds the chunk, so the rewrite is pure risk and latency there;
//   · bundled embedder, 70k PDF, paraphrase-heavy: 10/12 with it, 9/12 without (fixed two, broke
//     one), ~+0.7 s on the 7 of 12 turns where it fired.
// So it is bound only for a turn that has NO hosted embedding provider answering: the bundled model,
// no embedder at all, or a hosted provider currently demoted to the fallback. Widen with
// NATIVELY_RETRIEVAL_QUERY_REWRITE_SCOPE=all; switch off with
// NATIVELY_RETRIEVAL_LOW_CONFIDENCE_QUERY_REWRITE=0 (checked by the orchestrator).
//
// NOT pure (it asks the modes manager), which is why it is not in llm-query-rewrite.ts. One short call
// per call site on purpose: a test slices a fixed 40,000 characters of the chat-stream handler.

import { createQueryRewriter, type QueryRewriter } from './llm-query-rewrite';

interface RewriteModel { generateQueryRewrite(prompt: string): Promise<string> }

export function queryRewriteScope(env: Record<string, string | undefined> = process.env): 'local' | 'all' {
  return String(env.NATIVELY_RETRIEVAL_QUERY_REWRITE_SCOPE ?? '').trim().toLowerCase() === 'all' ? 'all' : 'local';
}

export function bindQueryRewriter(
  llmHelper: RewriteModel | null | undefined,
  deps: { usesHostedEmbeddings?: () => boolean; env?: Record<string, string | undefined> } = {},
): QueryRewriter | undefined {
  if (!llmHelper || typeof llmHelper.generateQueryRewrite !== 'function') return undefined;
  if (queryRewriteScope(deps.env) !== 'all') {
    let hosted = false;
    try {
      hosted = deps.usesHostedEmbeddings
        ? deps.usesHostedEmbeddings()
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        : require('../../services/ModesManager').ModesManager.getInstance().usesHostedEmbeddings() === true;
    } catch { hosted = false; }          // cannot tell ⇒ treat as the user the rewrite exists for
    if (hosted) return undefined;
  }
  return createQueryRewriter((prompt: string) => llmHelper.generateQueryRewrite(prompt), { owner: llmHelper });
}
