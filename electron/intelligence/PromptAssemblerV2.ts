// electron/intelligence/PromptAssemblerV2.ts
//
// Spec Phase 9 — Prompt Assembler V2.
//
// PRESERVES the existing typed/trust/sanitization philosophy of
// electron/services/context/PromptAssembler.ts (which stays the live WTA assembler)
// and ADDS the V2 capabilities the spec asks for, on top of the Phase 8 fusion output:
//   • renders fused blocks into trust-tagged XML (<profile_tree trust="high" …>),
//   • a CONTEXT INCLUSION REPORT (what was included/dropped and why — source tracing),
//   • candidate-perspective guard + no-assistant-identity guard (reuses
//     ProfileTreeService.getCandidatePerspectiveGuard),
//   • mode-specific answer-contract instruction (incl. lecture_notes/revision/diagram),
//   • token-budget by context type (delegated to the fusion engine already).
//
// This is a PURE renderer over a PromptContextContract — no model, no IO, never throws.
// It does not replace the live PromptAssembler; it's the V2 surface the rollout (Phase
// 19) can switch to behind prompt_assembler_v2_enabled.

import type { PromptContextContract, FusedContextBlock, FusionSource } from './ContextFusionEngine';
import { TrustLevel } from '../services/context/TrustLevels';
import { ProfileTreeService } from './ProfileTreeService';
import type { AnswerContract } from './ContextRouter';

// Map TrustLevel → a short trust word for the XML attribute.
function trustWord(level: TrustLevel): 'high' | 'medium' | 'low' {
  switch (level) {
    case TrustLevel.SYSTEM_POLICY:
    case TrustLevel.MODE_POLICY:
    case TrustLevel.DEVELOPER_POLICY:
    case TrustLevel.USER_PREFERENCES:
    case TrustLevel.TRUSTED_PROFILE:
      return 'high';
    case TrustLevel.ASSISTANT_HISTORY:
      return 'medium';
    default:
      return 'low';
  }
}

// XML tag name per fusion source (the spec's block format).
const SOURCE_TAG: Record<FusionSource, string> = {
  system_rules: 'system_rules',
  mode_instructions: 'mode_instructions',
  user_explicit_context: 'user_context',
  profile_tree: 'profile_tree',
  active_jd: 'jd',
  live_transcript_current: 'live_transcript',
  conversation_history: 'conversation_history',
  rag_evidence: 'rag_evidence',
  meeting_memory: 'meeting_memory',
  hindsight_memory: 'hindsight_memory',
  lecture_memory: 'lecture_context',
  reference_files: 'reference_file',
  browser_dom: 'browser_dom',
  raw_transcript_overflow: 'transcript_overflow',
  diagram_spec: 'diagram_spec',
};

const SOURCE_PROVENANCE: Record<FusionSource, string> = {
  system_rules: 'system',
  mode_instructions: 'mode_template',
  user_explicit_context: 'user',
  profile_tree: 'structured_profile',
  active_jd: 'structured_jd',
  live_transcript_current: 'stt',
  conversation_history: 'assistant_history',
  rag_evidence: 'resume_jd_files',
  meeting_memory: 'meeting_memory',
  hindsight_memory: 'long_term_memory',
  lecture_memory: 'lecture_transcript',
  reference_files: 'reference_files',
  browser_dom: 'browser_dom',
  raw_transcript_overflow: 'stt',
  diagram_spec: 'diagram_intelligence',
};

// XML-escape user content (mirrors PromptAssembler.escapeUserContent).
function escapeXml(text: string): string {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Neutralize override phrasings inside user content (mirrors escapePromptInjection).
function escapeInjection(text: string): string {
  return (text || '')
    .replace(/ignore\s+(all\s+|any\s+|the\s+)?(previous|prior|above)\s+(instructions?|prompts?)/gi, '[instruction-like text removed]')
    .replace(/system\s*prompt\s*:/gi, '[system-prompt-reference removed]')
    .replace(/\[INST\]/gi, '[inst]');
}

export interface ContextInclusionReportRow {
  source: FusionSource;
  tag: string;
  trust: 'high' | 'medium' | 'low';
  provenance: string;
  included: boolean;
  tokenEstimate: number;
  reason: string;
}

export interface AssembledPromptV2 {
  /** The trust-tagged XML context block string. */
  contextXml: string;
  /** The answer-contract instruction appended to the system prompt. */
  contractInstruction: string;
  /** The candidate-perspective guard line (empty when not applicable). */
  perspectiveGuard: string;
  /** The full inclusion report (source tracing — Phase 9/13). */
  inclusionReport: ContextInclusionReportRow[];
  totalTokenEstimate: number;
}

export interface AssemblePromptV2Input {
  contract: PromptContextContract;
  answerContract: AnswerContract;
  mode?: string;
  query: string;
}

// Mode-specific answer-contract instructions (the spec's output shapes).
const CONTRACT_INSTRUCTIONS: Record<AnswerContract, string> = {
  interview_short: 'Answer in first person AS the candidate. Concise (2–5 sentences). Ground in the candidate profile. Do not mention hidden context, retrieval, or internal systems.',
  interview_detailed: 'Answer in first person AS the candidate. Structured but natural; bullets only if asked. Ground every claim in the candidate profile/JD.',
  coding_answer: 'Pure technical answer. Sections: Approach, Data structures/techniques, Code, Dry run, Complexity, Edge cases. No profile, resume, or product mentions.',
  sales_reply: 'Answer from the seller/product perspective. Handle the objection. Do not use the candidate resume or JD unless explicitly asked.',
  lecture_notes: 'Produce clean student lecture notes: headings, key concepts, definitions, examples, and diagrams where useful. Student/learner perspective — no interview or sales framing.',
  lecture_revision: 'Produce revision material: concise concept recap, likely exam questions, and a revision checklist. Student perspective.',
  lecture_diagram: 'Produce a diagram for the concept. Prefer a valid Mermaid spec; label it AI-reconstructed if not copied from a source visual. Student perspective.',
  team_meeting_summary: 'Summarize from a neutral facilitator perspective: decisions, action items, owners, open questions. No candidate framing.',
  general_assistant: 'Answer helpfully and directly in a natural voice. Do not invent profile facts.',
};

/**
 * Assemble the V2 prompt context from a fusion contract. Pure + never throws.
 */
export function assemblePromptV2(input: AssemblePromptV2Input): AssembledPromptV2 {
  const report: ContextInclusionReportRow[] = [];
  const parts: string[] = [];
  let total = 0;

  try {
    for (const block of input.contract.blocks) {
      const tag = SOURCE_TAG[block.source];
      const trust = trustWord(block.trustLevel);
      const provenance = SOURCE_PROVENANCE[block.source];
      const isUntrusted = trust === 'low';
      // Untrusted content gets injection-escaped + XML-escaped; trusted structured
      // blocks (profile/JD/system/mode) are passed through (they're self-authored).
      const body = isUntrusted ? escapeXml(escapeInjection(block.content)) : block.content;
      const currentAttr = block.source === 'live_transcript_current' ? ' current="true"' : '';
      parts.push(`<${tag} trust="${trust}" source="${provenance}"${currentAttr}>\n${body}\n</${tag}>`);
      total += block.tokenEstimate;
      report.push({ source: block.source, tag, trust, provenance, included: true, tokenEstimate: block.tokenEstimate, reason: block.reasonIncluded });
    }

    // Record the dropped sources in the inclusion report too (source tracing).
    for (const d of input.contract.droppedSources || []) {
      const tag = SOURCE_TAG[d.source] || d.source;
      report.push({ source: d.source, tag, trust: 'low', provenance: SOURCE_PROVENANCE[d.source] || 'unknown', included: false, tokenEstimate: 0, reason: d.reason });
    }
  } catch {
    /* never throw — return whatever assembled */
  }

  const contractInstruction = CONTRACT_INSTRUCTIONS[input.answerContract] || CONTRACT_INSTRUCTIONS.general_assistant;

  // Candidate-perspective / no-assistant-identity guard.
  let perspectiveGuard = '';
  try {
    const v = ProfileTreeService.getCandidatePerspectiveGuard(input.mode, input.query);
    if (v.assistantIdentityWouldLeak) {
      perspectiveGuard = 'You are answering AS the candidate/user in first person. Never say "I am Natively", "I am an AI assistant", or otherwise self-identify as the assistant — the user expects their own identity. (Genuine questions about the app itself are exempt.)';
    }
  } catch { /* keep empty */ }

  return {
    contextXml: parts.join('\n\n'),
    contractInstruction,
    perspectiveGuard,
    inclusionReport: report,
    totalTokenEstimate: total,
  };
}

export { type FusedContextBlock };
