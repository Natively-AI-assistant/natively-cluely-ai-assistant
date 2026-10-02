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

import { extractVisualBlocks, parseFencedBlocks } from './fencedBlocks.mjs';
import { checkDiagramSource, isPlaceholderDiagram } from './diagramPolicy.mjs';
import { designVocabulary, designLabels, viewFromDiagramType } from './diagramRequest.mjs';
import { checkVisualSource } from './visualArtifact.mjs';

export const ACTIVE_DESIGN_TTL_MS = 30 * 60 * 1000;
/** A new diagram sharing at least this much label vocabulary continues the same design. */
export const SAME_DESIGN_OVERLAP = 0.34;
const PENDING_QUESTION_TTL_MS = 3 * 60 * 1000;

function normaliseSource(source) {
  return String(source ?? '').replace(/\r\n?/g, '\n').trim();
}

/** The distinctive words of an artifact's source, whatever it is written in (see designVocabulary). */
export function artifactVocabulary(source) {
  return designVocabulary(source);
}

/**
 * Share of the smaller vocabulary that also appears in the other one. One
 * shared word is a coincidence, not a continuation: two unrelated two-box
 * diagrams that both have a "Gateway" are not versions of one design.
 */
export function designOverlap(sourceA, sourceB) {
  const a = artifactVocabulary(sourceA);
  const b = artifactVocabulary(sourceB);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  if (shared < 2 && Math.min(a.size, b.size) > 1) return 0;
  return shared / Math.min(a.size, b.size);
}

/** How long a touch waits for its answer. */
const TOUCH_TTL_MS = 3 * 60 * 1000;

/**
 * Does a prose answer talk about this artifact: two of its multi-word names
 * ("order service", "notification queue"), or one such name and two more of
 * its words, or four of its words? Deliberately demanding — an answer that
 * happens to say "payment" and "email" is not about the diagram.
 */
export function answerIsAbout(answer, source) {
  const text = ` ${String(answer ?? '').slice(0, 6000).toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  let phrases = 0;
  for (const label of designLabels(source)) if (text.includes(` ${label} `) || text.includes(` ${label}s `)) phrases += 1;
  if (phrases >= 2) return true;
  let words = 0;
  for (const word of designVocabulary(source)) if (text.includes(` ${word} `) || text.includes(` ${word}s `)) words += 1;
  return phrases >= 1 ? words >= 3 : words >= 4;
}

/**
 * The visual block of an answer that becomes the artifact on the table: the
 * last closed one that is valid (see the note at the return for the one
 * exception) — a Mermaid block
 * that passes the static policy, or a chart / notation payload that passes its
 * own checks. `artifact` says which ('mermaid' | 'chart' | 'notation').
 */
export function latestDiagramInAnswer(answer) {
  const blocks = extractVisualBlocks(String(answer ?? ''), { final: true });
  let last = null;
  let architecture = null;
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    if (!block.closed) continue;
    let found = null;
    if (block.kind === 'mermaid') {
      const policy = checkDiagramSource(block.source);
      if (policy.ok && !isPlaceholderDiagram(block.source, policy.type)) found = { artifact: 'mermaid', source: normaliseSource(block.source), type: policy.type, view: viewFromDiagramType(policy.type, block.source) };
    } else {
      const checked = checkVisualSource(block.kind, block.source);
      if (checked.ok) found = { artifact: block.kind, source: normaliseSource(block.source), type: checked.type, view: checked.view };
    }
    if (!found) continue;
    if (!last) last = found;
    if (!architecture && found.view === 'architecture') architecture = found;
  }
  // An answer that draws the system AND a view of it (the architecture, then
  // the call order) is about the system: "add Redis" afterwards edits the
  // architecture, not the supplementary sequence. Otherwise, the last block.
  return last && architecture && last !== architecture && (last.view === 'sequence' || last.view === 'state' || last.view === 'flowchart') ? architecture : last;
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

  /** @type {null | { artifactId: string, lineageId: string, parentArtifactId?: string, version: number, artifact: string, view: string, type: string, source: string, question?: string, foreground: boolean, updatedAt: number }} */
  let current = null;
  let lineageSeq = 0;
  /** @type {null | { question: string, at: number }} */
  let pendingQuestion = null;
  /** When the turn now being answered was marked as a follow-up on the artifact (see touch); 0 when it was not. */
  let touchedAt = 0;

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
     * The turn being answered is about the artifact (an update, another view, a
     * question about it). Keeps it in focus through the answer that follows —
     * an explanation holds no drawing, and must not look like a change of
     * subject — and keeps it from expiring in the middle of a discussion.
     * A follow-up is not a fresh design: any question noted for one is dropped.
     */
    touch() {
      const d = live();
      if (!d) return;
      touchedAt = now();
      d.updatedAt = now();
      pendingQuestion = null;
    },

    /**
     * The turn being answered is NOT about the artifact. Without this, a
     * follow-up that was resolved and then cancelled left its mark for the
     * next answer, whatever that answer was to.
     */
    untouch() {
      touchedAt = 0;
    },

    /**
     * Look at a final, accepted answer. An answer with no valid diagram leaves
     * the design untouched (an explanation or a code answer does not end it).
     * Returns the design that is active afterwards.
     */
    observeAnswer(answer) {
      const found = latestDiagramInAnswer(answer);
      const existing = live();
      // A mark is for the answer that follows its turn, which is seconds away.
      const followedUp = touchedAt > 0 && now() - touchedAt <= TOUCH_TTL_MS;
      touchedAt = 0;
      if (!found) {
        // The conversation's focus stays on the artifact only through answers
        // to turns that were ABOUT it. A code answer, or an answer to anything
        // else, moves on: the artifact stays on the table (it can still be
        // named), but a bare "this", "add …" or "make it shorter" no longer
        // means it. Before this, one diagram stayed "in focus" for half an
        // hour and claimed most of what was said next.
        // The answer itself is evidence too: one that talks about the
        // artifact's own parts by name was about the artifact, whatever the
        // words of the question were ("walk me through it" → "the gateway
        // hands off to the order service, which …"). Without this, a follow-up
        // the rules did not recognise dropped the focus, and the NEXT follow-up
        // was refused as well.
        const aboutIt = Boolean(existing) && answerIsAbout(answer, existing.source);
        if (existing && (answerHasCodeBlock(answer) || !(followedUp || aboutIt))) existing.foreground = false;
        else if (existing && aboutIt) existing.updatedAt = now();
        // A design that was asked for and not drawn leaves no question behind.
        pendingQuestion = null;
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
      // A chart never "continues" a diagram (or the reverse): a different kind
      // of artifact is a different artifact, whatever words they share. The
      // exception is a new VIEW of the same design between Mermaid families.
      const sameKind = existing && (existing.artifact || 'mermaid') === found.artifact;
      const continues = existing && sameKind && !question && designOverlap(existing.source, found.source) >= SAME_DESIGN_OVERLAP;
      if (continues) {
        const version = existing.version + 1;
        current = {
          artifactId: `${existing.lineageId}.v${version}`,
          lineageId: existing.lineageId,
          parentArtifactId: existing.artifactId,
          version,
          artifact: found.artifact,
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
          artifact: found.artifact,
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
      if ((d.artifact || 'mermaid') !== 'mermaid') return false;
      if (d.source !== normaliseSource(originalSource)) return false;
      const policy = checkDiagramSource(repairedSource);
      if (!policy.ok) return false;
      d.source = normaliseSource(repairedSource);
      d.type = policy.type;
      d.view = viewFromDiagramType(policy.type, repairedSource);
      d.updatedAt = now();
      return true;
    },

    clear() {
      current = null;
      pendingQuestion = null;
      touchedAt = 0;
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
  // Answers since the drawing. There is no record here of which turns were
  // about it, so focus is given the benefit of the doubt for two answers.
  let since = 0;
  for (const turn of turns) {
    if (!turn) continue;
    const role = String(turn.role ?? 'assistant').toLowerCase();
    // Only what the assistant wrote can be the design on the table: a diagram
    // somebody pasted into the conversation is material, not the artifact.
    if (role !== 'assistant' && role !== 'system' && role !== 'model' && role !== 'ai') continue;
    const text = turn.text ?? turn.content ?? turn.answer ?? '';
    const found = latestDiagramInAnswer(text);
    if (!found) {
      // A prose answer that talks about the drawing's own parts kept the
      // conversation on it (same evidence the live state uses).
      if (latest && answerIsAbout(text, latest.source) && !answerHasCodeBlock(text)) {
        since = 0;
        continue;
      }
      since += 1;
      if (latest && (answerHasCodeBlock(text) || since > 2)) foreground = false;
      continue;
    }
    since = 0;
    if (latest && (latest.artifact !== found.artifact || designOverlap(latest.source, found.source) < SAME_DESIGN_OVERLAP)) version = 0;
    version += 1;
    latest = found;
    foreground = true;
  }
  if (!latest) return null;
  return { artifactId: `history.v${version}`, artifact: latest.artifact, view: latest.view, type: latest.type, source: latest.source, version, foreground };
}
