// electron/intelligence/context-os/recapFollowUp.ts
//
// Context OS (Phase 11) — recap + follow-up mode integration.
//
// The baseline gap (current-state report §5.4): RecapLLM and FollowUpLLM were
// MODE-BLIND — a recap in a doc-grounded seminar mode or a "make it shorter"
// after a doc-grounded answer could introduce profile facts. This module
// builds the source-contract rule those prompts append, derived from the same
// TurnContextContract the other surfaces use.

import type { TurnContextContract } from './types';

/**
 * The system-prompt rule a recap prompt appends. Recap always SUMMARIZES the
 * transcript — the contract decides which OTHER universes must stay out.
 */
export function buildRecapContractRule(contract: Pick<TurnContextContract, 'sourceOwner' | 'forbiddenSources'>): string {
  const lines = [
    '## SOURCE CONTRACT (recap)',
    'Summarize ONLY what was actually said in the conversation transcript above.',
    'Do not add facts from any other source: no resume/profile facts, no uploaded-document facts that were not spoken, no prior-session memory.',
  ];
  if (contract.sourceOwner === 'reference_files') {
    lines.push('This session runs in a document-grounded mode; the recap still summarizes the CONVERSATION, not the document. Do not answer document questions inside the recap.');
  }
  return lines.join('\n');
}

/**
 * The rule a follow-up/refinement prompt appends. A refinement ("shorter",
 * "more confident") INHERITS the prior answer's source ownership: it may only
 * REUSE facts already in the previous answer, never introduce new ones from a
 * source the original turn forbade.
 */
export function buildFollowUpContractRule(contract: Pick<TurnContextContract, 'sourceOwner' | 'forbiddenSources'>): string {
  const lines = [
    '## SOURCE CONTRACT (refinement)',
    'You are EDITING the previous answer. Keep the same facts; change only what was requested.',
    'Do not introduce ANY new factual claim that is not already in the previous answer.',
  ];
  if (contract.sourceOwner === 'reference_files') {
    lines.push('The previous answer was grounded in uploaded material only. Do not add resume/profile facts, prior-session memory, or outside knowledge while editing it.');
  } else if (contract.sourceOwner === 'profile') {
    lines.push('The previous answer was grounded in the candidate profile. Do not add uploaded-document facts or outside knowledge while editing it.');
  }
  lines.push('If the request asks to switch to a different source ("answer from my resume instead"), do not comply inside this edit — say that switching sources needs a fresh question.');
  return lines.join('\n');
}

/**
 * Detect an explicit source-switch request inside a refinement ("answer from
 * my resume instead", "use the document"). The caller should route this to a
 * NEW contract (fresh question) instead of inheriting the old one.
 */
export function detectFollowUpSourceSwitch(refinementRequest: string): 'profile' | 'reference_files' | 'transcript' | null {
  const q = String(refinementRequest || '');
  if (/\b(?:from|use|using|answer from|based on)\b[^.?!]{0,30}\bmy\s+(?:resume|cv|profile|background|experience)\b/i.test(q)) return 'profile';
  if (/\b(?:from|use|using|answer from|based on)\b[^.?!]{0,30}\b(?:the\s+)?(?:document|uploaded|material|pdf|file|thesis)\b/i.test(q)) return 'reference_files';
  if (/\b(?:from|use|using|answer from|based on)\b[^.?!]{0,30}\b(?:the\s+)?(?:meeting|transcript|conversation|call)\b/i.test(q)) return 'transcript';
  return null;
}
