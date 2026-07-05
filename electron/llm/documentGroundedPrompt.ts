// electron/llm/documentGroundedPrompt.ts
//
// Shared prompt-shaping for document-grounded custom modes (audit 2026-06-28,
// weak-model real-path fix). Extracted so BOTH the gemini-chat-stream IPC
// handler AND the real-path E2E harness apply the SAME shaping — the earlier
// E2E drove streamChat with the raw CHAT_MODE_PROMPT and so never exercised the
// greeting override / question-first restructuring that the handler applies,
// which is exactly why the live run collapsed to greetings.
//
// Two transforms, both gated on the caller having already determined that the
// active mode is document-grounded AND the answer type is lecture_answer:
//
//  1. shapeDocumentGroundedSystemPrompt(base): append a hard override so the
//     weak production model (gemini-3.1-flash-lite) never falls back to the
//     CHAT_MODE_PROMPT greeting ("Hey! What would you like help with?") for a
//     real document question. Source-level suppression is far more robust on a
//     weak model than a post-hoc regex.
//
//  2. buildDocumentGroundedUserContent(question, retrievedBlock, history?):
//     put the QUESTION FIRST and LAST around the retrieved material, with a
//     tight "answer only this question from the material" directive. The old
//     shape buried the question after ~11.8K chars of context + identity block,
//     so the weak model lost track of what was asked. Question-first + a short
//     restatement at the end keeps the model anchored on the actual ask.

export const DOCUMENT_GROUNDED_SYSTEM_OVERRIDE = [
  '',
  '## DOCUMENT-GROUNDED OVERRIDE (highest priority)',
  'Every user turn in this mode is a question about the uploaded reference material below.',
  'NEVER reply with a greeting such as "Hey! What would you like help with?" or "What would you like to know?".',
  'NEVER ask the user what they want — they have already asked. Answer their question directly from the uploaded material.',
  // ANTI-INVENTION is the dominant rule (audit 2026-06-28): the production
  // model is weak (gemini-3.1-flash-lite). A directive aggressive enough to make
  // it map "phases"→"objectives" also makes it INVENT plausible-but-wrong
  // content when the answer isn't obvious. The user explicitly forbade
  // hallucination, so we prefer failing closed over inventing.
  //
  // IMPORTANT: the retrieved snippets are EXCERPTS from the document, not the
  // full document. If the answer is not in the current excerpts the model should
  // say so clearly — NOT pretend the document lacks the information entirely.
  'CRITICAL: Use ONLY facts that are actually present in the retrieved excerpts below. NEVER invent, guess, or add numbers, names, phases, steps, methods, or results that are not literally written in the excerpts — not even plausible-sounding ones.',
  'The excerpts may use slightly different words than the question (e.g. it may say "objectives" where the question says "phases", or give data as table rows). You MAY answer from clearly-matching content, but ONLY when the specific items are literally present in the excerpts.',
  'If the specific answer does not appear in these retrieved excerpts, say: "I could not find that in the retrieved sections of the document." Do NOT say it is not in the document — only the retrieved sections were checked, not the full document.',
  'Keep the answer natural and speakable. For a normal question, 2-4 sentences. Do not restate the question back to the user.',
].join('\n');

/**
 * Append the document-grounded override to a base system prompt. Returns the
 * base unchanged when `active` is false so non-document-grounded chat is
 * byte-for-byte identical.
 */
export function shapeDocumentGroundedSystemPrompt(baseSystemPrompt: string, active: boolean): string {
  if (!active || !baseSystemPrompt) return baseSystemPrompt;
  if (baseSystemPrompt.includes('## DOCUMENT-GROUNDED OVERRIDE')) return baseSystemPrompt; // idempotent
  return `${baseSystemPrompt}\n${DOCUMENT_GROUNDED_SYSTEM_OVERRIDE}`;
}

/**
 * Build the user-content payload for a document-grounded question with the
 * question FIRST (and a short restatement LAST), wrapping the retrieved
 * material in between. `priorContext` (already stripped of prior-assistant
 * turns by the caller) is appended after the material as low-priority
 * conversational context for pronoun resolution only.
 *
 * Returns null when not active or when there is no retrieved material — the
 * caller should fall back to its normal assembly in that case.
 */
export function buildDocumentGroundedUserContent(params: {
  question: string;
  retrievedBlock: string;
  priorContext?: string;
  active: boolean;
}): string | null {
  const { question, retrievedBlock, priorContext, active } = params;
  if (!active) return null;
  const q = (question || '').trim();
  if (!q) return null;
  const material = (retrievedBlock || '').trim();
  const parts: string[] = [];
  parts.push(`QUESTION: ${q}`);
  parts.push('');
  parts.push('Answer the QUESTION above using ONLY facts literally present in the retrieved document excerpts below. These are excerpts from the uploaded file — not the complete document. The excerpts may use slightly different words than the question (e.g. "objectives" for "phases", table rows for data) — you may answer from clearly-matching content, but never invent numbers, names, or items that are not actually written there. If the specific answer is not found in these excerpts, say so clearly ("I could not find that in the retrieved sections") — do not claim it is absent from the whole document.');
  parts.push('');
  if (material) {
    parts.push('## RETRIEVED EXCERPTS FROM UPLOADED DOCUMENT');
    parts.push(material);
    parts.push('');
  }
  if (priorContext && priorContext.trim()) {
    parts.push('## RECENT CONVERSATION (for pronoun resolution only — not a source of facts)');
    parts.push(priorContext.trim());
    parts.push('');
  }
  // Restate the question last so the weak model stays anchored on the ask after
  // reading the material.
  parts.push(`Now answer this question directly and concisely: ${q}`);
  return parts.join('\n');
}
