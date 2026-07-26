// electron/llm/stripEmbeddedAnswerContract.ts
//
// Strip an embedded `<answer_contract>...</answer_contract>` block from a chat
// message. Defense-in-depth: as of 2026-07-18, no known code path injects the
// block into the IPC `message` parameter (the renderer submits raw text,
// `buildCodingContractPrompt` writes to the system / `context` channel, and
// `LLMHelper._streamChatInner` does not augment the user message). The strip
// is a one-line safety net for future regressions and is intentionally a
// no-op on the partial-open-tag shape (`<answe` truncated mid-block) — a
// previous broader regex over-matched inline literals like "How do I write
// an `<answer_contract>` tag?" and was tightened to balanced blocks only.
//
// Rules:
//   - Match ONLY a balanced block (open + close tag) — bare inline literals
//     pass through unchanged.
//   - If the message is ENTIRELY the contract block, drop the tags and keep
//     the body content (don't ship the raw XML to the model).
//   - Always returns a string; safe on non-strings (returned unchanged).
//
// Extracted from electron/ipcHandlers.ts so it can be imported by the LLM
// test suite (`test:llm`).
export function stripEmbeddedAnswerContract(input: unknown): string {
  if (typeof input !== 'string') return input as string;
  if (!/<answer_contract>[\s\S]*?<\/answer_contract>/i.test(input)) return input;
  // Strip the block; then trim only the whitespace IMMEDIATELY adjacent to
  // the removed span on each side, so unrelated paragraph breaks between the
  // user's prefix and suffix are preserved exactly.
  const stripped = input.replace(
    /(\s*)<answer_contract>[\s\S]*?<\/answer_contract>(\s*)/gi,
    (_match, lead: string, trail: string) => {
      // Both sides had whitespace: collapse to a single paragraph break.
      // One side had whitespace: drop it. Neither had whitespace: pass through.
      if (lead && trail) return '\n\n';
      if (lead || trail) return lead || trail;
      return '';
    },
  );
  // Trim leading/trailing whitespace from the whole string only — never the
  // internal newlines (those belong to the user's paragraph structure).
  const finalResult = stripped.replace(/^\s+|\s+$/g, '');
  if (finalResult !== input && finalResult.length > 0) {
    console.warn('[stripEmbeddedAnswerContract] stripped embedded <answer_contract> block', { beforeLen: input.length, afterLen: finalResult.length });
    return finalResult;
  }
  // Entire message was the block — at least drop the tags so the model gets
  // the body prose, not the literal XML.
  const bodyOnly = input.replace(/<\/?answer_contract>/gi, '').trim();
  if (bodyOnly.length > 0) {
    console.warn('[stripEmbeddedAnswerContract] stripped <answer_contract> tags, kept body', { beforeLen: input.length, afterLen: bodyOnly.length });
    return bodyOnly;
  }
  return stripped; // empty fallback
}
