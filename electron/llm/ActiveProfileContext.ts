// electron/llm/ActiveProfileContext.ts
//
// Canonical, per-turn read model of the ACTIVE profile sources (2026-07-07,
// JD/Resume JIT pipeline fix — Stage 1).
//
// This is a THIN, PURE projection over the knowledge orchestrator's already-
// loaded `activeResume` / `activeJD` documents — NOT a new store, cache, or
// ingestion path. It exists so routing → evidence selection → prompt build and
// telemetry all read ONE object with stable provenance (sourceId + documentHash
// + timestamp) instead of each re-reaching into the orchestrator and each
// deriving "is a JD present?" differently.
//
// Design rules:
//   - No I/O, no LLM, no DB writes. Duck-typed orchestrator (same shape the
//     profileAnswerBackend already consumes) so this file has no premium import.
//   - documentHash is a stable content hash of structured_data — for
//     staleness/telemetry only, never a security boundary.
//   - "JD present" is defined here ONCE: an activeJD entry exists. Whether its
//     EVIDENCE reached the prompt is a separate, stronger check
//     (jdEvidenceCount / hasProfileJDBlock) owned by manualProfileIntelligence.

import { createHash } from 'crypto';
import type { StructuredJobFacts, StructuredProfileFacts } from './manualProfileIntelligence';

type MaybeStructured<T> = T | null | undefined;

interface StructuredDocumentLike<T> {
  id?: number;
  source_uri?: string;
  created_at?: string;
  updated_at?: string;
  structured_data?: MaybeStructured<T>;
}

export interface ActiveProfileContextOrchestratorLike {
  activeResume?: StructuredDocumentLike<StructuredProfileFacts> | null;
  activeJD?: StructuredDocumentLike<StructuredJobFacts> | null;
  // Optional extra sources — read only if present, never required.
  customContext?: { text?: unknown } | string | null;
  persona?: { text?: unknown } | string | null;
}

export interface ActiveDocumentContext<T> {
  sourceId: number | string;
  documentHash: string;
  updatedAt?: string;
  createdAt?: string;
  sourceUri?: string;
  structured: T;
}

export interface ActiveTextContext {
  hash: string;
  text: string;
}

export interface ActiveProfileContext {
  activeResume?: ActiveDocumentContext<StructuredProfileFacts>;
  activeJD?: ActiveDocumentContext<StructuredJobFacts>;
  customContext?: ActiveTextContext;
  persona?: ActiveTextContext;
}

/** Stable content hash of any JSON-serializable value (telemetry/staleness). */
export function hashStructured(value: unknown): string {
  try {
    return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex').slice(0, 16);
  } catch {
    return 'unhashable';
  }
}

function readText(source: { text?: unknown } | string | null | undefined): string {
  if (!source) return '';
  if (typeof source === 'string') return source;
  const t = source.text;
  return typeof t === 'string' ? t : '';
}

function buildDocContext<T>(
  doc: StructuredDocumentLike<T> | null | undefined,
  fallbackId: string,
): ActiveDocumentContext<T> | undefined {
  const structured = doc?.structured_data;
  if (!doc || structured == null) return undefined;
  return {
    sourceId: doc.id ?? fallbackId,
    documentHash: hashStructured(structured),
    updatedAt: doc.updated_at,
    createdAt: doc.created_at,
    sourceUri: doc.source_uri,
    structured: structured as T,
  };
}

/**
 * Assemble the canonical ActiveProfileContext from whatever the orchestrator
 * currently has loaded. Pure and defensive — any missing source is simply
 * omitted; never throws.
 */
export function buildActiveProfileContext(
  orchestrator?: ActiveProfileContextOrchestratorLike | null,
): ActiveProfileContext {
  const ctx: ActiveProfileContext = {};
  if (!orchestrator) return ctx;

  const resume = buildDocContext<StructuredProfileFacts>(orchestrator.activeResume, 'active_resume');
  if (resume) ctx.activeResume = resume;

  const jd = buildDocContext<StructuredJobFacts>(orchestrator.activeJD, 'active_jd');
  if (jd) ctx.activeJD = jd;

  const customText = readText(orchestrator.customContext);
  if (customText.trim()) ctx.customContext = { hash: hashStructured(customText), text: customText };

  const personaText = readText(orchestrator.persona);
  if (personaText.trim()) ctx.persona = { hash: hashStructured(personaText), text: personaText };

  return ctx;
}

/**
 * Compact, PII-free provenance summary for telemetry/logs — IDs, hashes, and
 * presence flags only, never raw content.
 */
export function summarizeActiveProfileContext(ctx: ActiveProfileContext): Record<string, unknown> {
  return {
    activeResumeId: ctx.activeResume?.sourceId ?? null,
    activeResumeHash: ctx.activeResume?.documentHash ?? null,
    activeJDId: ctx.activeJD?.sourceId ?? null,
    activeJDHash: ctx.activeJD?.documentHash ?? null,
    hasCustomContext: Boolean(ctx.customContext),
    hasPersona: Boolean(ctx.persona),
  };
}
