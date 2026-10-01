// The design currently "on the table" in a session.
//
// One instance lives on the shared SessionTracker, so typed chat, What to
// Answer, Auto Answer and follow-ups all read and write the same design —
// there is no per-route diagram memory to drift apart. It follows the
// tracker's own lifetime: cleared on a new meeting, a mode switch and a
// session reset, and it expires on its own after a quiet half hour.
//
// It keeps the minimum a follow-up needs: the latest valid Mermaid source, its
// view, and a parent/version identity. Earlier answers are never rewritten —
// an update is a NEW version attached to the answer that produced it.
//
// "Valid" here means it passed the static policy check (diagramPolicy). The
// main process cannot run Mermaid's parser; if the renderer later repairs a
// block, applyRepair() swaps the stored source for the working one.

import { extractMermaidBlocks, parseFencedBlocks } from './fencedBlocks.mjs';
import { checkDiagramSource } from './diagramPolicy.mjs';
import { designVocabulary, viewFromDiagramType } from './diagramRequest.mjs';

export const ACTIVE_DESIGN_TTL_MS = 30 * 60 * 1000;
/** A new diagram sharing at least this much label vocabulary continues the same design. */
export const SAME_DESIGN_OVERLAP = 0.34;
const PENDING_QUESTION_TTL_MS = 3 * 60 * 1000;

function normaliseSource(source) {
  return String(source ?? '').replace(/\r\n?/g, '\n').trim();
}

/** Share of the smaller vocabulary that also appears in the other one. */
export function designOverlap(sourceA, sourceB) {
  const a = designVocabulary(sourceA);
  const b = designVocabulary(sourceB);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

/** The last closed Mermaid block of an answer that passes the static policy. */
export function latestDiagramInAnswer(answer) {
  const blocks = extractMermaidBlocks(String(answer ?? ''), { final: true });
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    if (!block.closed) continue;
    const policy = checkDiagramSource(block.source);
    if (policy.ok) return { source: normaliseSource(block.source), type: policy.type, view: viewFromDiagramType(policy.type) };
  }
  return null;
}

/** Does the answer hold ordinary (non-Mermaid) fenced code? */
export function answerHasCodeBlock(answer) {
  const text = String(answer ?? '');
  if (text.indexOf('```') === -1 && text.indexOf('~~~') === -1) return false;
  return parseFencedBlocks(text, { final: true }).blocks.some((b) => b.kind === 'code' && b.source.trim().length > 0);
}

/**
 * @param {{ now?: () => number, ttlMs?: number }} [options]
 */
export function createActiveDesignState(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : ACTIVE_DESIGN_TTL_MS;

  /** @type {null | { artifactId: string, lineageId: string, parentArtifactId?: string, version: number, view: string, type: string, source: string, question?: string, foreground: boolean, updatedAt: number }} */
  let current = null;
  let lineageSeq = 0;
  /** @type {null | { question: string, at: number }} */
  let pendingQuestion = null;

  function live() {
    if (current && now() - current.updatedAt > ttlMs) current = null;
    return current;
  }

  return {
    /** The design on the table, or null. A copy — callers cannot mutate state. */
    get() {
      const d = live();
      return d ? { ...d } : null;
    },

    /**
     * Remember the question a fresh design turn asked, so the design can say
     * what it was drawn for. Only a hint; consumed by the next observed answer.
     */
    noteDesignQuestion(question) {
      const q = String(question ?? '').replace(/\s+/g, ' ').trim();
      pendingQuestion = q ? { question: q.slice(0, 300), at: now() } : null;
    },

    /**
     * Look at a final, accepted answer. An answer with no valid diagram leaves
     * the design untouched (an explanation or a code answer does not end it).
     * Returns the design that is active afterwards.
     */
    observeAnswer(answer) {
      const found = latestDiagramInAnswer(answer);
      const existing = live();
      if (!found) {
        // A code answer after the design moves the conversation's focus to the
        // code: the design stays on the table (it can still be named), but a
        // bare "this" no longer means it. A prose answer changes nothing.
        if (existing && answerHasCodeBlock(answer)) existing.foreground = false;
        return existing ? { ...existing } : null;
      }

      const question = pendingQuestion && now() - pendingQuestion.at <= PENDING_QUESTION_TTL_MS ? pendingQuestion.question : undefined;
      pendingQuestion = null;

      if (existing && existing.source === found.source) {
        // The same diagram came back (a refined answer kept it): no new version.
        existing.updatedAt = now();
        existing.foreground = true;
        return { ...existing };
      }

      // A turn that asked for a fresh design (noteDesignQuestion) starts a new
      // lineage even if it happens to reuse common component names.
      const continues = existing && !question && designOverlap(existing.source, found.source) >= SAME_DESIGN_OVERLAP;
      if (continues) {
        const version = existing.version + 1;
        current = {
          artifactId: `${existing.lineageId}.v${version}`,
          lineageId: existing.lineageId,
          parentArtifactId: existing.artifactId,
          version,
          view: found.view,
          type: found.type,
          source: found.source,
          question: existing.question,
          foreground: true,
          updatedAt: now(),
        };
      } else {
        lineageSeq += 1;
        const lineageId = `design-${lineageSeq}`;
        current = {
          artifactId: `${lineageId}.v1`,
          lineageId,
          version: 1,
          view: found.view,
          type: found.type,
          source: found.source,
          question,
          foreground: true,
          updatedAt: now(),
        };
      }
      return { ...current };
    },

    /**
     * The renderer repaired a block that did not parse. Swap the stored source
     * only when it is exactly the broken one — never merge into another design.
     */
    applyRepair(originalSource, repairedSource) {
      const d = live();
      if (!d) return false;
      if (d.source !== normaliseSource(originalSource)) return false;
      const policy = checkDiagramSource(repairedSource);
      if (!policy.ok) return false;
      d.source = normaliseSource(repairedSource);
      d.type = policy.type;
      d.view = viewFromDiagramType(policy.type);
      d.updatedAt = now();
      return true;
    },

    clear() {
      current = null;
      pendingQuestion = null;
    },
  };
}

/**
 * Derive the design on the table from a list of prior turns (newest last).
 * Used where there is no shared tracker — Direct Assist keeps its history in
 * the overlay and sends it with each request.
 *
 * @param {ReadonlyArray<{ role?: string, text?: string, content?: string, answer?: string }>} turns
 */
export function activeDesignFromHistory(turns) {
  if (!Array.isArray(turns)) return null;
  let version = 0;
  let latest = null;
  let foreground = true;
  for (const turn of turns) {
    if (!turn) continue;
    const role = String(turn.role ?? 'assistant').toLowerCase();
    if (role === 'user' || role === 'interviewer') continue;
    const text = turn.text ?? turn.content ?? turn.answer ?? '';
    const found = latestDiagramInAnswer(text);
    if (!found) {
      if (latest && answerHasCodeBlock(text)) foreground = false;
      continue;
    }
    if (latest && designOverlap(latest.source, found.source) < SAME_DESIGN_OVERLAP) version = 0;
    version += 1;
    latest = found;
    foreground = true;
  }
  if (!latest) return null;
  return { artifactId: `history.v${version}`, view: latest.view, type: latest.type, source: latest.source, version, foreground };
}
