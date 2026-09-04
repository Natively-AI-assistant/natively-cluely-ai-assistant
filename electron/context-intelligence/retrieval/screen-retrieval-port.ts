// electron/context-intelligence/retrieval/screen-retrieval-port.ts
//
// A RetrievalPort over the CURRENT turn's screenshot.
//
// WHY THIS EXISTS
// `SCREEN_CONTEXT` was a source type with ZERO producers. It is declared
// (contracts/types.ts), allowed by five mode policies (mode-policy-registry),
// mapped to the `screenshots` privacy scope (provider-scope-policy) and is the
// authoritative source for SCREEN_FACT claims (source-authority-policy) — but
// nothing in this directory ever emitted one.
//
// The measured consequence: attaching a screenshot set `hasScreenContext`, the
// classifier planned [SCREEN_CONTEXT], nothing supplied it, and the turn came
// back `evidence: 0 / answerability: NONE / DOCUMENT_FACT_NOT_FOUND`. The
// composer then handed the model "No supporting evidence was retrieved — the
// uploaded material does not cover this" ON THE VERY TURN the screenshot was
// attached, while the image bytes sat in the same provider payload. The prompt
// and the payload contradicted each other, and the model hedged.
//
// No test pinned that behaviour (PromptComposition.test.mjs has no screen
// assertions at all), so it was an unnoticed gap rather than a chosen contract.
//
// WHY A DESCRIPTION AND NOT THE BYTES
// The image already reaches the provider as bytes. What retrieval needs is
// something a LATER turn can still read, and something the evidence contract
// can filter and attribute. A textual description — produced once by
// ScreenUnderstandingService at attach time — is both. It also means a
// follow-up never re-sends the image, which would reopen the per-turn
// `private_vision` / `screenshots` gate (visionPolicy.ts) for a screenshot the
// user has already cleared from the composer.

import type { EvidenceScope, SourceType } from '../contracts/types';
import type { RetrievalPort } from '../orchestration/orchestrator';
import { createLegacyRetrievalPort } from './legacy-retrieval-port';

export interface ScreenPortInput {
  /** The vision/OCR description of what is on screen for THIS turn. */
  description: string;
  userId: string;
  /** Scopes the evidence to this session, so it cannot leak across sessions. */
  sessionId: string;
  /** Stable id for the screenshot, when one is available (image hash). */
  screenshotId?: string;
}

/** One source per turn's screen. Chunked only if the description is long. */
const MAX_CHUNK_CHARS = 1200;

/**
 * A fail-closed RetrievalPort over the current turn's screen description.
 *
 * Returns `null` when there is nothing to describe, so callers can omit it from
 * the port list entirely rather than wiring an empty producer — an empty port
 * would still declare a source and make `attachedSourceCount` lie.
 *
 * Type and scope filtering are NOT re-implemented here: the source is declared
 * `SCREEN_CONTEXT` scoped to this session, and `createLegacyRetrievalPort`'s
 * existing registry applies the mode's `retrievalPlan.sourceTypes` allowlist
 * and scope containment. A mode that does not authorize SCREEN_CONTEXT
 * therefore admits nothing, with no second copy of that rule living here.
 */
/**
 * Break a paragraph that is itself over the chunk cap into pieces at or under
 * it, preferring a natural boundary — a line break, then a sentence end, then a
 * space — so a chunk still reads as an observation rather than a mid-word slice.
 *
 * The `> max / 2` test stops a boundary near the very start from producing a
 * sliver chunk and pushing the bulk of the text into the next iteration; when no
 * boundary sits in the back half, a hard cut at `max` is the better trade.
 */
function splitOversizedParagraph(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const boundary = Math.max(
      window.lastIndexOf('\n'),
      window.lastIndexOf('. '),
      window.lastIndexOf(' '),
    );
    const cut = boundary > max / 2 ? boundary + 1 : max;
    const piece = rest.slice(0, cut).trim();
    if (piece) out.push(piece);
    rest = rest.slice(cut);
  }
  const tail = rest.trim();
  if (tail) out.push(tail);
  return out;
}

/**
 * Split a screen description into retrievable chunks.
 *
 * EXPORTED so the splitting can be tested directly. Reaching it through the
 * port means constructing a full TurnDecision for the legacy adapter, which
 * tests the adapter rather than this, and the defect fixed here lived in the
 * LOOP — a paragraph over the cap never entered the split branch at all — not
 * in the helper below it. A unit test of the helper alone would not have caught
 * it.
 */
export function chunkScreenDescription(description: string, max = MAX_CHUNK_CHARS): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const para of description.split(/\n{2,}/)) {
    // A single paragraph over the cap has to be BROKEN UP, not carried whole.
    // The split below only fires when `current` is already non-empty, so an
    // oversized paragraph fell straight through to `current` and was pushed as
    // one over-cap chunk. That is not a rare shape: v3ScreenDescription joins
    // visibleSummary + extractedText + codeBlocks + tables with blank lines, and
    // OCR extractedText is routinely ONE blob containing none. context-packer
    // DROPS an item whose cost exceeds the remaining evidence budget rather
    // than truncating it, so a dense screenshot contributed zero evidence —
    // exactly the failure this port exists to fix.
    if (para.length > max) {
      if (current) { chunks.push(current); current = ''; }
      for (const piece of splitOversizedParagraph(para, max)) chunks.push(piece);
      continue;
    }
    if (current && current.length + para.length + 2 > max) {
      chunks.push(current);
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function createScreenRetrievalPort(input: ScreenPortInput): RetrievalPort | null {
  const description = String(input.description ?? '').trim();
  if (!description) return null;

  const sourceId = input.screenshotId ? `screen:${input.screenshotId}` : 'screen:current';
  const scope: EvidenceScope = { userId: input.userId, sessionId: input.sessionId };

  const sourceTypes = new Map<string, SourceType>([[sourceId, 'SCREEN_CONTEXT']]);
  const activeVersions = new Map<string, string>([[sourceId, 'current']]);
  const chunkVersions = new Map<string, string>([[sourceId, 'current']]);
  const sourceScopes = new Map<string, EvidenceScope>([[sourceId, scope]]);

  // Split on paragraph boundaries so a chunk is a coherent observation ("the
  // terminal shows 3 failing tests") rather than a fixed-width slice through
  // the middle of one.
  const chunks = chunkScreenDescription(description);

  return createLegacyRetrievalPort({
    registry: { sourceTypes, activeVersions, chunkVersions, sourceScopes },
    // The screen is a single small in-memory artifact, so there is nothing to
    // rank: every chunk of what is on screen is relevant to a question ABOUT
    // what is on screen. Scoring uniformly at 1 keeps it above any floor
    // without pretending to a similarity it never computed.
    retrieve: async () => chunks.map((text, chunkIndex) => ({
      sourceId,
      fileName: 'screen',
      text,
      chunkIndex,
      score: 1,
      vectorScore: 1,
      provenance: 'SCREEN_CAPTURE' as const,
    })),
  });
}
