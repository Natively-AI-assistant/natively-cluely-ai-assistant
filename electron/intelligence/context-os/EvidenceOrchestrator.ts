// electron/intelligence/context-os/EvidenceOrchestrator.ts
//
// Context OS (Phase 4) — capability-scoped retrieval adapter + EvidencePack
// builder.
//
// This is a COMPATIBILITY BRIDGE, not a retrieval rewrite: it wraps the
// existing retrievers (ModesManager.buildRetrievedActiveModeContextBlockHybrid,
// the profile context builders, transcript snapshots, Hindsight recall) and
// converts their output into typed EvidenceItems. The legacy string block is
// preserved verbatim inside the items so prompt output can stay byte-stable
// while validators gain typed access.
//
// Retrieval invariants (retrieval-evidence-engineer contract):
//   1. A retriever runs ONLY when the TurnContextContract grants a capability
//      with permissions.retrieve — the wrong source is never even fetched.
//   2. Items from a referent-only capability carry authority='referent_only'
//      and are excluded from factual coverage.
//   3. Forbidden sources with a supplied retriever are recorded in `rejected`
//      (so traces show WHY nothing was fetched) but the retriever is NOT called.
//   4. Lexical/vector similarity alone is not proof: coverage.propertySatisfied
//      comes from the property-evidence vocabulary, not the retrieval score.

import {
  allowsEvidence,
  allowsRetrieval,
  capabilityFor,
  isReferentOnly,
  type SourceKind,
  type TurnContextContract,
} from './types';
import type {
  AnswerPolicy,
  EvidenceItem,
  EvidencePack,
  RejectedEvidenceItem,
} from './evidencePack';
import { previewText } from './evidencePack';
import { textCanProveProperty } from './requestedProperty';

// ── Input shape ──────────────────────────────────────────────────────────────

export interface EvidenceRetrievers {
  /** Legacy hybrid mode-context block (XML envelope from ModeHybridRetriever). */
  retrieveModeContext?: () => Promise<string | null> | string | null;
  /** Legacy profile context block (candidate profile / OKF profile cards). */
  retrieveProfileContext?: () => Promise<string | null> | string | null;
  /** Rolling live transcript snapshot. */
  retrieveTranscriptContext?: () => Promise<string | null> | string | null;
  /** Hindsight recall bullets (only consulted when contract grants it). */
  retrieveHindsight?: () => Promise<string | null> | string | null;
  /** Meeting RAG block (Phase 12 upgrades this to typed items). */
  retrieveMeetingRag?: () => Promise<string | null> | string | null;
}

export interface BuildEvidencePackInput {
  question: string;
  contract: TurnContextContract;
  retrievers: EvidenceRetrievers;
}

// Which retriever feeds which canonical source kind. The FIRST kind is the
// primary one used for item stamping; the whole list is checked for grants.
const RETRIEVER_KINDS: Record<keyof EvidenceRetrievers, SourceKind[]> = {
  retrieveModeContext: ['mode_reference_chunk', 'mode_reference_file', 'okf_document_card'],
  retrieveProfileContext: ['profile_resume', 'profile_project', 'okf_profile_card'],
  retrieveTranscriptContext: ['live_transcript'],
  retrieveHindsight: ['hindsight_memory'],
  retrieveMeetingRag: ['meeting_rag_chunk'],
};

// ── Snippet parsing (real chunk provenance from the legacy XML envelope) ─────

interface ParsedSnippet {
  text: string;
  sourceId?: string;
  fileName?: string;
  chunkIndex?: number;
  score?: number;
  ftsScore?: number;
  vectorScore?: number;
}

/**
 * ModeHybridRetriever.formatContext emits
 *   <snippet><source>{json}</source><text>…</text></snippet>
 * Parse those so EvidenceItems carry REAL chunk ids/scores instead of one
 * opaque block. Any parse failure falls back to the whole-block item.
 */
export function parseModeSnippets(block: string): ParsedSnippet[] {
  const out: ParsedSnippet[] = [];
  const re = /<snippet>\s*<source>([\s\S]*?)<\/source>\s*<text>([\s\S]*?)<\/text>\s*<\/snippet>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const text = unescapeXmlText(m[2]).trim();
    if (!text) continue;
    let meta: any = {};
    try {
      meta = JSON.parse(m[1].replace(/\\u003c/g, '<').replace(/\\u003e/g, '>'));
    } catch { /* citation JSON is best-effort */ }
    out.push({
      text,
      sourceId: typeof meta.sourceId === 'string' ? meta.sourceId : undefined,
      fileName: typeof meta.fileName === 'string' ? meta.fileName : undefined,
      chunkIndex: typeof meta.chunkIndex === 'number' ? meta.chunkIndex : undefined,
      score: typeof meta.score === 'number' ? meta.score : undefined,
      ftsScore: typeof meta.ftsScore === 'number' ? meta.ftsScore : undefined,
      vectorScore: typeof meta.vectorScore === 'number' ? meta.vectorScore : undefined,
    });
  }
  return out;
}

function unescapeXmlText(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export class EvidenceOrchestrator {
  async buildEvidencePack(input: BuildEvidencePackInput): Promise<EvidencePack> {
    const { contract, retrievers } = input;
    const items: EvidenceItem[] = [];
    const rejected: RejectedEvidenceItem[] = [];

    // Clarify turns never retrieve — the answer is a deterministic question.
    if (contract.sourceOwner === 'clarify') {
      return this.finalize(contract, items, rejected);
    }

    for (const key of Object.keys(RETRIEVER_KINDS) as Array<keyof EvidenceRetrievers>) {
      const retriever = retrievers[key];
      if (!retriever) continue;
      const kinds = RETRIEVER_KINDS[key];
      const primaryKind = kinds[0];

      const retrievable = kinds.some((k) => allowsRetrieval(contract, k));
      if (!retrievable) {
        // Invariant 3: record the block WITHOUT calling the retriever — the
        // forbidden source is never fetched, and the trace shows why.
        rejected.push({ sourceKind: primaryKind, reason: 'forbidden_source' });
        continue;
      }

      let block: string | null = null;
      try {
        block = (await retriever()) ?? null;
      } catch {
        // Retrieval failures never break the turn; the pack just lacks items.
        continue;
      }
      if (!block || !block.trim()) continue;

      const evidenceGranted = kinds.some((k) => allowsEvidence(contract, k));
      const referentGranted = kinds.some((k) => isReferentOnly(contract, k));

      if (!evidenceGranted && referentGranted) {
        // Referent-only material: keep it typed so the prompt renderer can
        // place it in the referent block, but it never counts as evidence.
        items.push(this.blockToItem(block, primaryKind, contract, 'referent_only',
          'referent-only capability: pronoun resolution, never fact source'));
        continue;
      }
      if (!evidenceGranted) {
        rejected.push({
          sourceKind: primaryKind,
          reason: 'referent_only',
          textPreview: previewText(block),
        });
        continue;
      }

      if (key === 'retrieveModeContext') {
        items.push(...this.convertModeBlockToEvidence(block, contract));
      } else if (key === 'retrieveProfileContext') {
        items.push(this.blockToItem(block, primaryKind, contract, 'evidence',
          'legacy profile context block converted into EvidenceItem'));
      } else if (key === 'retrieveMeetingRag') {
        items.push(this.blockToItem(block, 'meeting_rag_chunk', contract, 'evidence',
          'legacy meeting RAG block converted into EvidenceItem'));
      } else if (key === 'retrieveTranscriptContext') {
        items.push(this.blockToItem(block, 'live_transcript', contract, 'evidence',
          'transcript granted as evidence by the mode contract'));
      } else if (key === 'retrieveHindsight') {
        // Hindsight without validated provenance is at most referent material
        // even under an evidence grant (Phase 10 upgrades this).
        items.push(this.blockToItem(block, 'hindsight_memory', contract, 'referent_only',
          'hindsight lacks per-fact provenance: demoted to referent-only until Phase 10'));
      }
    }

    return this.finalize(contract, items, rejected);
  }

  // ── Conversion ─────────────────────────────────────────────────────────────

  private convertModeBlockToEvidence(block: string, contract: TurnContextContract): EvidenceItem[] {
    const cap = capabilityFor(contract, 'mode_reference_chunk');
    const scopeId = cap?.scopeId ?? contract.activeModeId ?? 'active-mode';
    const snippets = parseModeSnippets(block);

    if (snippets.length === 0) {
      // Lexical-path or non-snippet block: single whole-block item (bridge).
      return [this.blockToItem(block, 'mode_reference_chunk', contract, 'evidence',
        'legacy mode context block converted into EvidenceItem')];
    }

    return snippets.map((s, i) => ({
      evidenceId: `${contract.turnId}:mode:${i}`,
      sourceKind: 'mode_reference_chunk' as const,
      sourceId: s.sourceId ?? scopeId,
      sourceOwner: 'reference_files' as const,
      authority: 'evidence' as const,
      trustLevel: cap?.trustLevel ?? 'user_uploaded',
      text: s.text,
      pointer: {
        fileId: s.sourceId,
        chunkId: s.sourceId != null && s.chunkIndex != null ? `${s.sourceId}:${s.chunkIndex}` : undefined,
        section: s.fileName,
      },
      supports: {
        property: textCanProveProperty(s.text, contract.requestedProperty)
          ? contract.requestedProperty
          : 'unknown' as const,
      },
      score: {
        lexical: s.ftsScore,
        vector: s.vectorScore,
        propertyMatch: textCanProveProperty(s.text, contract.requestedProperty) ? 1 : 0,
        final: s.score ?? 0.5,
      },
      reasonIncluded: 'hybrid retrieval snippet under mode_reference_chunk capability',
    }));
  }

  private blockToItem(
    block: string,
    sourceKind: SourceKind,
    contract: TurnContextContract,
    authority: EvidenceItem['authority'],
    reason: string,
  ): EvidenceItem {
    const cap = capabilityFor(contract, sourceKind);
    const canProve = textCanProveProperty(block, contract.requestedProperty);
    return {
      evidenceId: `${contract.turnId}:${sourceKind}:0`,
      sourceKind,
      sourceId: cap?.scopeId ?? contract.activeModeId ?? `active-${sourceKind}`,
      sourceOwner: sourceOwnerForKind(sourceKind),
      authority,
      trustLevel: cap?.trustLevel ?? 'memory_unverified',
      text: block,
      supports: {
        property: authority === 'evidence' && canProve ? contract.requestedProperty : 'unknown',
      },
      score: {
        propertyMatch: canProve ? 1 : 0,
        final: 0.5,
      },
      reasonIncluded: reason,
    };
  }

  // ── Coverage + policy ──────────────────────────────────────────────────────

  private finalize(
    contract: TurnContextContract,
    items: EvidenceItem[],
    rejected: RejectedEvidenceItem[],
  ): EvidencePack {
    const factual = items.filter((i) => i.authority === 'evidence');

    // Property satisfaction comes from evidence VOCABULARY, never from the
    // retrieval score alone (invariant 4). 'unknown' property → any direct
    // evidence satisfies (legacy behavior preserved).
    const propertySatisfied = contract.requestedProperty === 'unknown'
      ? factual.length > 0
      : factual.some((i) => i.supports.property === contract.requestedProperty);

    const expectedOwner = contract.sourceOwner;
    // Peer families: an item satisfies the owner when it IS the owner or when
    // it belongs to a family the contract itself granted as peer evidence
    // (e.g. transcript in reference_files_plus_transcript; meeting_rag under
    // transcript ownership). Items only ever carry authority='evidence' when
    // a capability granted it, so this can never widen beyond the contract.
    const peerOwnersFor = (owner: typeof expectedOwner): ReadonlySet<string> => {
      switch (owner) {
        case 'reference_files': return new Set(['reference_files', 'transcript']);
        case 'transcript': return new Set(['transcript', 'meeting_rag']);
        case 'profile': return new Set(['profile']);
        default: return new Set(); // mixed/unknown accept anything below
      }
    };
    const peers = peerOwnersFor(expectedOwner);
    const sourceOwnerSatisfied = factual.length > 0
      && factual.every((i) =>
        peers.size === 0 // mixed/unknown
        || peers.has(i.sourceOwner));

    const confidence = factual.length > 0
      ? Math.max(...factual.map((i) => i.score.final))
      : 0;

    const answerPolicy: AnswerPolicy = contract.sourceOwner === 'clarify'
      ? 'ask_clarification'
      : factual.length === 0
        ? 'refuse_insufficient_evidence'
        : propertySatisfied
          ? 'answer'
          : 'refuse_insufficient_evidence';

    return {
      // Stable pack identity (Phase 6/M4): derived from the turnId + a version so
      // the exact pack that governs generation can be matched at validation.
      packId: `${contract.turnId}:pack:1`,
      version: 1,
      turnId: contract.turnId,
      sourceOwner: contract.sourceOwner,
      requestedProperty: contract.requestedProperty,
      items,
      rejected,
      coverage: {
        hasDirectEvidence: factual.length > 0,
        propertySatisfied,
        entityMatched: factual.length > 0,
        sourceOwnerSatisfied,
        confidence,
      },
      conflicts: [],
      answerPolicy,
    };
  }
}

function sourceOwnerForKind(kind: SourceKind): EvidenceItem['sourceOwner'] {
  switch (kind) {
    case 'mode_reference_file':
    case 'mode_reference_chunk':
    case 'okf_document_card':
      return 'reference_files';
    case 'profile_resume':
    case 'profile_project':
    case 'profile_jd':
    case 'profile_persona':
    case 'custom_profile_notes':
    case 'okf_profile_card':
      return 'profile';
    case 'live_transcript':
      return 'transcript';
    case 'meeting_rag_chunk':
      return 'meeting_rag';
    case 'hindsight_memory':
      return 'long_term_memory';
    case 'screen_context':
      return 'screen_context';
    case 'browser_dom':
      return 'browser_dom';
    default:
      return 'unknown';
  }
}
