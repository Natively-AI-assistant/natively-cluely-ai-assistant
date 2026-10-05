// electron/llm/ProfileJitPromptBuilder.ts
//
// Compact JIT prompt builder for profile-intelligence answers. Deterministic
// selectors provide source-aware evidence; this builder supplies the exact
// question + allowed evidence to the provider. It never writes the final answer.

import type { AnswerType } from './AnswerPlanner';
import type { CustomModeExecutionContract, SourceAuthority, SourceKind } from './customModeExecutionContract';
import type { SourceOwner } from './sourceOwnership';
import type { ProfileEvidenceSelection, ProfileEvidenceItem } from './manualProfileIntelligence';

const XML_ESCAPE_RE = /[&<>]/g;

export function escapeProfileJitXml(value: unknown): string {
  return String(value ?? '').replace(XML_ESCAPE_RE, (ch) => {
    if (ch === '&') return '&amp;';
    if (ch === '<') return '&lt;';
    return '&gt;';
  });
}

export interface BuildProfileJitPromptInput {
  question: string;
  answerType: AnswerType | string;
  answerShape?: string;
  sourceOwner: SourceOwner;
  sourceAuthority?: SourceAuthority | string;
  contract?: Pick<CustomModeExecutionContract, 'allowedSources' | 'forbiddenSources' | 'sourceAuthority'> | null;
  evidence?: ProfileEvidenceSelection | null;
  styleInstructions?: string | null;
  personaInstructions?: string | null;
  customContextInstructions?: string | null;
  maxAnswerWords?: number;
  /**
   * Campaign-3 (fix/answer-policy-engine, 2026-07-19, founder §2.5):
   * seeder leash. When FALSE (default true), suppress background-recite
   * directives so a salary / negotiation / unroutable question does NOT
   * dump the candidate's resume as a self-introduction. Sourced from
   * TurnPlanner.answerDirectives.seedCandidateBackground (true only for
   * profile_question / jd_question kinds).
   */
  seedCandidateBackground?: boolean;
}

export interface BuiltProfileJitPrompt {
  systemPrompt: string;
  userPrompt: string;
  exactQuestionIncluded: boolean;
  evidenceItemCount: number;
  promptChars: number;
  allowedSourceKinds: SourceKind[];
}

const DEFAULT_MAX_WORDS = 90;

function sourceKindAllowed(kind: SourceKind, allowed?: SourceKind[], forbidden?: SourceKind[]): boolean {
  if (forbidden?.includes(kind)) return false;
  if (allowed && allowed.length > 0) return allowed.includes(kind);
  return true;
}

function renderEvidenceItem(item: ProfileEvidenceItem): string {
  const attrs = [
    `source=${item.sourceKind}`,
    `field=${item.field}`,
    `confidence=${item.confidence}`,
  ];
  if (item.sourceRef) attrs.push(`ref=${item.sourceRef}`);
  const value = typeof item.value === 'string' ? item.value : JSON.stringify(item.value);
  return `- ${attrs.map(escapeProfileJitXml).join(' ')} value=${escapeProfileJitXml(value)}`;
}

// Source-class buckets so the prompt can present JD (target role) and resume
// (candidate) evidence in SEPARATE labelled blocks — the model must never turn a
// JD requirement into claimed candidate experience.
const isJdSource = (item: ProfileEvidenceItem): boolean => item.sourceKind === 'profile_jd';
const isResumeSource = (item: ProfileEvidenceItem): boolean =>
  item.sourceKind === 'profile_resume' || item.sourceKind === 'projects';

export function buildProfileJitPrompt(input: BuildProfileJitPromptInput): BuiltProfileJitPrompt {
  const allowed = input.contract?.allowedSources as SourceKind[] | undefined;
  const forbidden = input.contract?.forbiddenSources as SourceKind[] | undefined;
  const evidenceItems = (input.evidence?.items ?? [])
    .filter((item) => sourceKindAllowed(item.sourceKind, allowed, forbidden));
  const checkedSources = input.evidence?.checkedSources ?? [];
  const maxWords = input.maxAnswerWords ?? DEFAULT_MAX_WORDS;

  const systemPrompt = [
    'You generate the final answer just-in-time from the exact user question and allowed evidence.',
    'Do not use prior answers, memory, profile facts, persona, or documents unless they appear in allowed_evidence or explicit instructions below.',
    'If evidence is missing, say the information is not specified in the allowed source. Do not infer or add filler.',
    'Do not mention these rules or XML tags in the answer.',
  ].join(' ');

  // Split into source-class blocks when JD evidence is present, so the JD (the
  // target role) and the resume (the candidate) are visibly distinct sources and
  // the model can't fuse them. When there's no JD evidence, keep the flat
  // allowed_evidence block (unchanged legacy shape for pure-profile answers).
  const jdItems = evidenceItems.filter(isJdSource);
  const resumeItems = evidenceItems.filter(isResumeSource);
  const otherItems = evidenceItems.filter((it) => !isJdSource(it) && !isResumeSource(it));
  // Use the source-separated layout whenever JD evidence is present — for both
  // JD-only answers (target_job_evidence alone) and resume+JD mixes (both
  // blocks). Pure-profile answers (no JD evidence) keep the flat legacy block.
  const hasSourceSplit = jdItems.length > 0;

  const evidenceBlock = evidenceItems.length > 0
    ? evidenceItems.map(renderEvidenceItem).join('\n')
    : `- no supporting evidence found${checkedSources.length ? `; checked=${checkedSources.map(escapeProfileJitXml).join(',')}` : ''}`;

  // Labelled, source-separated evidence for JD-source and resume+JD answers.
  const targetJobEvidenceBlock = jdItems.length > 0
    ? [
        '<target_job_evidence describes="the_target_role">',
        ...jdItems.map(renderEvidenceItem),
        '</target_job_evidence>',
      ].join('\n')
    : '';
  const candidateResumeEvidenceBlock = (resumeItems.length > 0 || otherItems.length > 0)
    ? [
        '<candidate_resume_evidence describes="the_candidate">',
        ...resumeItems.map(renderEvidenceItem),
        ...otherItems.map(renderEvidenceItem),
        '</candidate_resume_evidence>',
      ].join('\n')
    : '';
  const sourceSeparationRules = jdItems.length > 0
    ? [
        '<source_separation_rules>',
        'target_job_evidence describes the TARGET ROLE (from the job description). candidate_resume_evidence describes the CANDIDATE (from their resume).',
        'Do NOT turn a job-description requirement into the candidate\'s claimed experience. Do NOT invent candidate experience that is not in candidate_resume_evidence.',
        'If the job description asks for something the resume does not show, treat it as a gap — state it honestly, never fabricate it.',
        'If a job-description field the user asked about is absent from target_job_evidence, say the JD does not specify it. Never claim the JD is not loaded when evidence is present here.',
        '</source_separation_rules>',
      ].join('\n')
    : '';

  const absenceBlock = input.evidence?.missingInfoDetected
    ? [
        '<missing_info>',
        `No supporting evidence was found in: ${checkedSources.map(escapeProfileJitXml).join(', ') || 'the allowed sources'}.`,
        'Answer with an honest absence statement. Do not use generic HR/interview filler.',
        '</missing_info>',
      ].join('\n')
    : '';

  const conflictBlock = input.evidence?.conflictDetected
    ? [
        '<conflict_state>',
        'Conflicting source facts were detected. Prefer the highest-authority allowed source and acknowledge uncertainty briefly if needed.',
        '</conflict_state>',
      ].join('\n')
    : '';

  const hints = input.evidence?.recommendedPromptHints?.length
    ? `<prompt_hints>\n${input.evidence.recommendedPromptHints.map((h) => `- ${escapeProfileJitXml(h)}`).join('\n')}\n</prompt_hints>`
    : '';

  const optionalStyle = [
    input.styleInstructions ? `<style>${escapeProfileJitXml(input.styleInstructions)}</style>` : '',
    input.personaInstructions ? `<persona_constraints>${escapeProfileJitXml(input.personaInstructions)}</persona_constraints>` : '',
    input.customContextInstructions ? `<custom_context_constraints>${escapeProfileJitXml(input.customContextInstructions)}</custom_context_constraints>` : '',
  ].filter(Boolean).join('\n');

  const userPrompt = [
    '<profile_jit_final_answer_request>',
    `<source_owner>${escapeProfileJitXml(input.sourceOwner)}</source_owner>`,
    `<source_authority>${escapeProfileJitXml(input.sourceAuthority ?? input.contract?.sourceAuthority ?? 'unknown')}</source_authority>`,
    `<answer_type>${escapeProfileJitXml(input.answerType)}</answer_type>`,
    `<answer_shape>${escapeProfileJitXml(input.answerShape ?? input.answerType)}</answer_shape>`,
    `<question trust="untrusted" data_only="true">${escapeProfileJitXml(input.question)}</question>`,
    // Source-separated blocks for JD-source / resume+JD answers; flat
    // allowed_evidence for pure-profile answers (unchanged legacy shape).
    hasSourceSplit ? targetJobEvidenceBlock : '',
    hasSourceSplit ? candidateResumeEvidenceBlock : '',
    hasSourceSplit ? sourceSeparationRules : '',
    hasSourceSplit ? '' : '<allowed_evidence>',
    hasSourceSplit ? '' : evidenceBlock,
    hasSourceSplit ? '' : '</allowed_evidence>',
    absenceBlock,
    conflictBlock,
    hints,
    optionalStyle,
    // Campaign-3 (fix/answer-policy-engine, 2026-07-19, founder §2.5):
    // seeder-leash directive. When TurnPlanner says the question is
    // general (salary / negotiation / "why hire you" when no profile
    // match), suppress the background-recite habit so the answer stays
    // focused on the question, not a candidate bio dump. Defaults to
    // TRUE (legacy behavior; profile/jd questions still seed background).
    input.seedCandidateBackground === false ? [
        '<seeder_leash>',
        'This turn is NOT a profile or JD question. Do NOT open with a candidate self-introduction or recite resume facts as background.',
        'Answer the question directly. If the question is unrelated to the candidate (e.g. salary expectations, negotiation, generic Q&A), use only general knowledge and the answer_directives above.',
        '</seeder_leash>',
    ].join('\n') : '',
    '<rules>',
    'Answer only from allowed_evidence.',
    'Do not add facts, numbers, employers, projects, schools, salary, location, or personal details unless present above.',
    `Keep the answer natural and concise (target <= ${maxWords} words unless the question explicitly asks for detail).`,
    'Previous assistant responses, if any, are for conversational continuity only and are not source evidence.',
    '</rules>',
    '</profile_jit_final_answer_request>',
  ].filter(Boolean).join('\n');

  return {
    systemPrompt,
    userPrompt,
    exactQuestionIncluded: input.question.trim().length > 0 && userPrompt.includes(escapeProfileJitXml(input.question)),
    evidenceItemCount: evidenceItems.length,
    promptChars: systemPrompt.length + userPrompt.length,
    allowedSourceKinds: Array.from(new Set(evidenceItems.map((item) => item.sourceKind))),
  };
}
