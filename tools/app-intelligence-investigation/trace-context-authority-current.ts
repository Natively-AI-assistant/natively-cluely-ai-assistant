// tools/app-intelligence-investigation/trace-context-authority-current.ts
//
// Read-only trace of the CURRENT source-ownership decision per turn.
//
// Wires through `resolveSourceOwnership` (the new, GENERAL resolver
// introduced 2026-07-06 in electron/llm/sourceOwnership.ts) for a fixed
// matrix of:
//   - active mode source-authority
//   - answer-type profile policy
//   - explicit-profile-ask question shape
//   - presence/absence of structured profile facts
//
// It does NOT import any stateful service. It does NOT touch the database.
// It does NOT call any provider.
//
// IMPORTANT: `electron/llm/sourceOwnership.ts` is part of the 2026-07-06
// hardening and may not exist in your checkout. If the import fails, copy
// the file from the rest of the report (Phase 7 transcribes it verbatim).
//
// Run with:
//   npx tsx tools/app-intelligence-investigation/trace-context-authority-current.ts

import {
  resolveSourceOwnership,
  buildSourceSwitchClarification,
  isExplicitProfileAsk,
  type SourceOwner,
  type SourceOwnershipDecision,
} from '../../electron/llm/sourceOwnership';


const QUESTION_BANK: Array<{ name: string; q: string }> = [
  { name: 'generic_profile_possessive', q: 'Tell me about my resume and projects.' },
  { name: 'generic_prepositional', q: 'Walk me through what is in my profile.' },
  { name: 'document_property', q: 'What are the four main phases of the project?' },
  { name: 'document_methodology', q: 'Which methodology does the paper use?' },
  { name: 'document_role', q: 'What is the role of perception in this architecture?' },
  { name: 'transcript_quote', q: 'What did the interviewer just ask about?' },
  { name: 'meeting_followup', q: 'How should I respond to their last question?' },
  { name: 'jd_fit', q: 'How well do I fit this job description?' },
  { name: 'salary_negotiation', q: 'What salary should I ask for?' },
  { name: 'identity_intro', q: 'Tell me about yourself' },
  { name: 'coding_technical', q: 'How do you reverse a linked list?' },
];

const PROFILE_FACTS_PRESENT = true;

const MATRIX: Array<{
  authority:
    | 'reference_files_only'
    | 'reference_files_plus_transcript'
    | 'profile_only'
    | 'profile_plus_transcript'
    | 'transcript_only'
    | 'general_mixed'
    | 'ask_if_ambiguous';
  profileContextPolicy: 'required' | 'allowed' | 'forbidden';
  label: string;
}> = [
  { authority: 'reference_files_only',            profileContextPolicy: 'forbidden', label: 'reference_files_only / forbidden (doc-grounded custom mode)' },
  { authority: 'reference_files_plus_transcript', profileContextPolicy: 'forbidden', label: 'reference_files_plus_transcript / forbidden (doc-grounded + meeting)' },
  { authority: 'profile_only',                    profileContextPolicy: 'required',  label: 'profile_only / required (interview/prep mode)' },
  { authority: 'profile_plus_transcript',         profileContextPolicy: 'required',  label: 'profile_plus_transcript / required (interview+meeting)' },
  { authority: 'transcript_only',                 profileContextPolicy: 'forbidden', label: 'transcript_only / forbidden (live-only)' },
  { authority: 'general_mixed',                   profileContextPolicy: 'allowed',   label: 'general_mixed / allowed (general fallback)' },
  { authority: 'ask_if_ambiguous',                profileContextPolicy: 'allowed',   label: 'ask_if_ambiguous / allowed (built-in default)' },
];

function renderDecision(d: SourceOwnershipDecision): string {
  const tags: string[] = [];
  if (d.profileAllowed) tags.push('PROFILE_OK');
  else tags.push('PROFILE_BLOCKED');
  if (d.explicitProfileAsk) tags.push('EXPLICIT_PROFILE_ASK');
  if (d.shouldClarifyInsteadOfProfile) tags.push('CLARIFY_DONT_PROFILE');
  return [
    `    owner                          = ${d.owner}`,
    `    profileAllowed                 = ${d.profileAllowed}`,
    `    explicitProfileAsk             = ${d.explicitProfileAsk}`,
    `    shouldClarifyInsteadOfProfile  = ${d.shouldClarifyInsteadOfProfile}`,
    `    reason                         = ${d.reason}`,
    `    tags                           = [${tags.join(', ')}]`,
  ].join('\n');
}

function main(): void {
  console.log('# Current source-ownership decision matrix');
  console.log('# Source: electron/llm/sourceOwnership.ts (resolveSourceOwnership)');
  console.log('# hasProfileFacts =', PROFILE_FACTS_PRESENT);
  console.log('');

  for (const cell of MATRIX) {
    console.log('=============================================================================');
    console.log(`# Authority mode: ${cell.label}`);
    console.log('=============================================================================');
    for (const q of QUESTION_BANK) {
      const contract = { sourceAuthority: cell.authority } as const;
      const decision = resolveSourceOwnership({
        question: q.q,
        contract,
        profileContextPolicy: cell.profileContextPolicy,
        answerType: 'unknown_answer',
        hasProfileFacts: PROFILE_FACTS_PRESENT,
      });
      console.log('');
      console.log(`  Q [${q.name}]: "${q.q}"  | isExplicitProfileAsk=${isExplicitProfileAsk(q.q)}`);
      console.log(renderDecision(decision));
    }
    console.log('');
  }

  console.log('=============================================================================');
  console.log('# Source-honest clarification line (per owner)');
  console.log('=============================================================================');
  const owners: SourceOwner[] = ['reference_files', 'profile', 'transcript', 'prior_assistant', 'unknown'];
  for (const o of owners) {
    console.log(`  ${o}:`);
    console.log(`    "${buildSourceSwitchClarification(o)}"`);
  }
}

main();
