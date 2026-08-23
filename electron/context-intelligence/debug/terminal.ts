// electron/context-intelligence/debug/terminal.ts
//
// Human-readable terminal rendering for context-debug records.
// One consolidated block per turn — never one line per streamed token.

import type { ContextDebugIngest, ContextDebugTurnComplete } from './debug-types';

const oneLine = (s: string, max = 300): string => {
  const collapsed = String(s).replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
};

export function renderTurnSummary(r: ContextDebugTurnComplete): string {
  const lines: string[] = [];
  lines.push('[CONTEXT_DEBUG_TURN]');
  lines.push(`Turn: ${r.identity.turnId} (${r.identity.surface})`);
  lines.push(`Mode: ${r.mode.name ?? r.mode.canonicalId} [${r.mode.knowledgePolicy}]`);
  lines.push(`Question: ${oneLine(r.question.original)}`);
  if (r.question.resolved && r.question.resolved !== r.question.original) {
    lines.push(`Resolved: ${oneLine(r.question.resolved)}`);
  }
  lines.push(`Plan: ${r.sourcePlan.path}${r.sourcePlan.plannedRoles.length ? ` → ${r.sourcePlan.plannedRoles.join(', ')}` : ''}`);
  lines.push(`Evidence: ${r.retrieval.selectedEvidence.length} selected / ${r.retrieval.candidateCount} candidates`
    + (r.retrieval.rejectedCount ? ` (${r.retrieval.rejectedCount} rejected)` : ''));
  lines.push(`Answerability: ${r.evidenceCoverage.answerability}${r.evidenceCoverage.propertyMatched ? '' : ' (property unmatched)'}`);
  lines.push(`Fallback: ${r.generation.fallback}`);
  if (r.conversationState) {
    const cs = r.conversationState;
    lines.push(`Follow-up: referent ${cs.referentApplied ? `applied (${cs.referent ?? '?'} — ${cs.referentReason ?? ''})` : `not applied${cs.referentReason ? ` (${cs.referentReason})` : ''}`}`);
  }
  if (r.answer.final) lines.push(`Answer: ${oneLine(r.answer.final)}`);
  if (!r.generation.streamCommitted) {
    lines.push(`Commit: SUPPRESSED${r.generation.commitRejectedReason ? ` — ${r.generation.commitRejectedReason}` : ''}`);
  }
  const timing: string[] = [];
  if (typeof r.generation.tfftMs === 'number') timing.push(`TFFT ${r.generation.tfftMs}ms`);
  if (typeof r.generation.totalStreamMs === 'number') timing.push(`Stream ${r.generation.totalStreamMs}ms`);
  timing.push(`Total ${r.timestamp.durationMs}ms`);
  lines.push(`Timing: ${timing.join(' · ')}`);
  if (r.errors.length) lines.push(`Errors: ${r.errors.map((e) => `${e.stage}:${e.message}`).join(' | ')}`);
  return lines.join('\n');
}

export function renderIngestSummary(r: ContextDebugIngest): string {
  const lines: string[] = [];
  lines.push('[CONTEXT_DEBUG_INGEST]');
  lines.push(`Document: ${r.document.name} (${r.document.role ?? 'unclassified'})${r.document.status ? ` [${r.document.status}]` : ''}`);
  const p = r.parsing;
  const pages = p.expectedPages !== undefined || p.parsedPages !== undefined
    ? ` · pages ${p.parsedPages ?? '?'}/${p.expectedPages ?? '?'}` : '';
  lines.push(`Parsed: ${p.characters ?? '?'} chars → ${p.chunkCount} chunks${pages}`);
  lines.push(`Indexes: lexical=${r.indexes.lexicalReady ? 'ready' : 'NO'} vector=${r.indexes.vectorReady ? 'ready' : 'NO'}`
    + (r.indexes.embeddedChunkCount !== undefined ? ` (${r.indexes.embeddedChunkCount}/${r.parsing.chunkCount} embedded)` : ''));
  lines.push(`Status: ${r.status}`);
  if (r.errors.length) lines.push(`Errors: ${r.errors.map((e) => e.message).join(' | ')}`);
  return lines.join('\n');
}
