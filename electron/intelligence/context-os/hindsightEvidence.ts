// electron/intelligence/context-os/hindsightEvidence.ts
//
// Context OS (Phase 10) — Hindsight provenance.
//
// The baseline problem (current-state report §14.6): recalled facts entered
// prompts as bare bullets under "RELEVANT LONG-TERM MEMORY" — the model could
// not distinguish a recalled fact from a generated one, and no per-fact
// source id existed.
//
// This module types every recalled memory as RecalledMemoryEvidence with
// provenance derived from the Hindsight tags the retain path already writes
// (`source:meeting_summary`, `meeting:<id>`, …). Authority rules:
//   • reference_files owner → Hindsight is FORBIDDEN (strict isolation; the
//     contract never grants it, so this module is never reached).
//   • validated=false (all of today's memories) → referent_only at most.
//   • validated=true AND the contract grants hindsight_memory evidence →
//     evidence (a future, explicit grant — no default contract does this).

import type { RecalledMemory } from '../memory/MemoryProvider';
import type { EvidenceItem } from './evidencePack';
import { allowsEvidence, type TurnContextContract } from './types';

export interface RecalledMemoryEvidence {
  memoryId: string;
  text: string;
  sourceId: string;
  sourceKind: 'meeting_transcript' | 'meeting_summary' | 'user_profile' | 'assistant_claim' | 'manual_note' | 'unknown';
  timestamp: string | null;
  confidence: number;
  validated: boolean;
  stale: boolean;
  trustLevel: 'memory_unverified' | 'memory_verified';
  authority: 'evidence' | 'referent_only' | 'forbidden';
  evidencePointers: Array<{
    meetingId?: string;
    transcriptTurnId?: string;
    claimId?: string;
    profileSourceId?: string;
  }>;
}

const TAG_SOURCE_MAP: Record<string, RecalledMemoryEvidence['sourceKind']> = {
  meeting_transcript: 'meeting_transcript',
  meeting_summary: 'meeting_summary',
  lecture_summary: 'meeting_summary',
  lecture_transcript: 'meeting_transcript',
  resume: 'user_profile',
  jd: 'user_profile',
  chat_history: 'assistant_claim',
  user_preference: 'manual_note',
  feedback: 'manual_note',
};

function parseTag(tags: string[] | undefined, prefix: string): string | null {
  for (const t of tags ?? []) {
    if (t.startsWith(`${prefix}:`)) return t.slice(prefix.length + 1);
  }
  return null;
}

/**
 * Type a raw Hindsight recall result with provenance. Everything recalled
 * today is validated=false (no validation pipeline exists yet), so authority
 * is at most referent_only unless the contract explicitly grants
 * hindsight_memory evidence AND the memory is validated.
 */
export function toRecalledMemoryEvidence(
  memories: RecalledMemory[],
  contract: Pick<TurnContextContract, 'allowedSources' | 'sourceOwner'>,
): RecalledMemoryEvidence[] {
  // Strict isolation: reference-file turns never see memory at all.
  if (contract.sourceOwner === 'reference_files') return [];

  const evidenceGranted = allowsEvidence(contract as any, 'hindsight_memory');

  return memories
    .filter((m) => m && typeof m.text === 'string' && m.text.trim().length > 0)
    .map((m, i) => {
      const sourceTag = parseTag(m.tags, 'source');
      const sourceKind = (sourceTag && TAG_SOURCE_MAP[sourceTag]) || 'unknown';
      const meetingId = parseTag(m.tags, 'meeting') ?? undefined;
      const dateTag = parseTag(m.tags, 'date');
      const validated = false; // no validation pipeline yet — always unverified
      return {
        memoryId: `hs:${i}:${(m.source ?? sourceTag ?? 'unknown')}`,
        text: m.text.trim(),
        sourceId: m.source ?? sourceTag ?? 'unknown',
        sourceKind,
        timestamp: dateTag,
        confidence: typeof m.score === 'number' ? m.score : 0.5,
        validated,
        stale: false,
        trustLevel: validated ? 'memory_verified' : 'memory_unverified',
        authority: validated && evidenceGranted ? 'evidence' : 'referent_only',
        evidencePointers: meetingId ? [{ meetingId }] : [],
      };
    });
}

/** Convert into standard EvidenceItems for pack/renderer integration. */
export function recalledMemoryToEvidenceItems(
  recalled: RecalledMemoryEvidence[],
  turnId: string,
): EvidenceItem[] {
  return recalled.map((r, i) => ({
    evidenceId: `${turnId}:hindsight:${i}`,
    sourceKind: 'hindsight_memory' as const,
    sourceId: r.sourceId,
    sourceOwner: 'long_term_memory' as const,
    authority: r.authority === 'forbidden' ? 'referent_only' as const : r.authority,
    trustLevel: r.trustLevel,
    text: r.text,
    pointer: r.evidencePointers[0]?.meetingId ? { meetingId: r.evidencePointers[0].meetingId } : undefined,
    supports: { property: 'unknown' as const },
    score: { final: r.confidence },
    reasonIncluded: r.validated
      ? 'validated hindsight memory under evidence grant'
      : 'unvalidated hindsight memory: referent-only',
  }));
}

/**
 * Render the provenance-tagged memory block for the manual-chat prompt —
 * replaces the bare-bullet "RELEVANT LONG-TERM MEMORY" list. Each fact
 * carries its source kind + id + confidence so the model (and any auditor)
 * can distinguish recalled facts from generated ones.
 */
export function renderHindsightRecallBlock(recalled: RecalledMemoryEvidence[]): string {
  if (recalled.length === 0) return '';
  const lines = [
    '<long_term_memory trust="low" authority="non_authoritative" purpose="referent_only">',
    'These memories are recalled from prior sessions. They are unvalidated, may be incomplete or stale, and MUST NOT override current sources. Use only to resolve references; never present one as a verified fact.',
  ];
  for (const r of recalled) {
    const meta = [
      `source_kind="${r.sourceKind}"`,
      `source_id="${escapeAttr(r.sourceId)}"`,
      r.timestamp ? `date="${escapeAttr(r.timestamp)}"` : null,
      `confidence="${r.confidence.toFixed(2)}"`,
      `validated="${r.validated}"`,
    ].filter(Boolean).join(' ');
    lines.push(`- <memory ${meta}>${escapeText(r.text)}</memory>`);
  }
  lines.push('</long_term_memory>');
  return lines.join('\n');
}

function escapeAttr(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeText(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
