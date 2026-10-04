// Keeping a diagram intact while its answer is reworded.
//
// "Make it shorter", "rephrase that", "more casual": the user is asking for
// different WORDS. The follow-up model receives the whole previous answer,
// Mermaid block included, and is told to copy the block unchanged — but a
// model asked to shorten will often shorten the diagram too, or drop it. So the
// instruction is backed by a deterministic check on the finished text: every
// diagram of the previous answer must come back byte-identical, in order.
//
// Pure. The caller decides whether the request was about the design itself
// (refinementTouchesDesign) — in that case nothing is enforced.

import { parseFencedBlocks, isVisualBlock, VISUAL_FENCE_TAG } from './fencedBlocks.mjs';

// Words that are about the drawing or its numbers. ("At any rate" is not about
// a rate: only a rate that is named as one counts.)
const DESIGN_WORDS_RE = /\b(?:diagram|design|architecture|flow ?chart|chart|graph|plot|forecast|projection|mermaid|sequence|state machine|component|node|arrow|box|axis|series|entity|relationship|cardinality|schema|baseline|(?:the|growth|churn|interest|discount) rate)\b/i;
// A percentage is a change to a chart — unless it says how much shorter the
// WORDS should be ("50% shorter", "cut it by 30%").
const PERCENT_RE = /\d+(?:\.\d+)?\s?%(?!\s*(?:shorter|longer|less|more|smaller|bigger|briefer|tighter|of (?:the|its) (?:length|size|words)))/;
const WORDING_VERB_RE = /\b(?:cut|shorten|trim|condense|shrink|tighten|abbreviate|compress|reduce (?:it|this|that|the (?:length|text|answer|wording)))\b/i;
// An edit to the prose, whatever it mentions: "remove the last sentence about
// the database", "drop the jargon", "add an example".
const PROSE_UNIT_RE = /\b(?:add|remove|drop|delete|insert|move|merge|split|cut|skip)\b[^.?!]{0,40}\b(?:sentences?|paragraphs?|words?|phrases?|lines?|bullets?|bullet points?|points?|sections?|intro(?:duction)?|ending|opening|conclusion|summary|examples?|details?|jargon|filler|caveats?|disclaimers?)\b/i;

/** Does the refinement request ask to change the design, not just the wording? */
export function refinementTouchesDesign(request) {
  const text = String(request ?? '');
  if (DESIGN_WORDS_RE.test(text)) return true;
  if (PERCENT_RE.test(text) && !WORDING_VERB_RE.test(text)) return true;
  if (PROSE_UNIT_RE.test(text)) return false;
  return STRUCTURAL_EDIT_RE.test(text) || PROPER_SWAP_RE.test(text);
}

// "Add a cache layer", "remove the queue", "replace Postgres with DynamoDB",
// "use Kafka instead": an edit to what is drawn, said without the word
// "diagram". The fixed refinement intents (shorten, rephrase, more formal…)
// never look like this — and neither do "use simpler words instead" or
// "replace 'utilize' with 'use'", which swap WORDS.
const PART_WORDS = String.raw`cache|queue|database|db|store|service|layer|server|worker|gateway|balancer|proxy|broker|topic|shard|replica|index|table|column|field|step|stage|state|transition|actor|participant|api|cdn|bucket|cluster|region|pipeline|consumer|producer|scheduler`;
const TECH_WORDS = String.raw`kafka|rabbitmq|sqs|sns|kinesis|pub ?sub|redis|memcached|postgres(?:ql)?|mysql|mongo(?:db)?|dynamo(?:db)?|cassandra|elasticsearch|s3|grpc|rest|graphql|websockets?|webhooks?|polling|nginx|kubernetes|k8s|lambda|cloudfront|oauth|jwt|sso`;
// A thing that can be swapped in a design: a part, a known technology, or a
// proper name ("Stripe", "DynamoDB"). Not a quoted word and not a way of writing.
const SWAPPABLE = String.raw`(?:(?:the|a|an|our) )?(?:(?:[a-z-]+ )?(?:${PART_WORDS})s?\b|(?:${TECH_WORDS})\b)`;
const STRUCTURAL_EDIT_RE = new RegExp(
  [
    String.raw`\b(?:add|remove|drop|delete|insert|rename|move|split|merge|connect)\b[^.?!]{0,40}\b(?:${PART_WORDS})\b`,
    String.raw`\b(?:replace|swap)\s+${SWAPPABLE}[^.?!]{0,40}\b(?:with|for)\b`,
    String.raw`\b(?:replace|swap)\b[^.?!'"]{0,40}\b(?:with|for)\s+${SWAPPABLE}`,
    String.raw`\buse\s+${SWAPPABLE}[^.?!]{0,30}\binstead\b`,
  ].join('|'),
  'i',
);
// Proper names are told by their capital, which a case-insensitive pattern cannot see.
const PROPER_SWAP_RE = /\b(?:[Rr]eplace|[Ss]wap)\s+(?:the\s+)?[A-Z][\w.+-]*\s+(?:with|for)\s+[A-Z][\w.+-]*|\b[Uu]se\s+[A-Z][\w.+-]*\s+instead\b/;

/** The line appended to the follow-up system prompt when the previous answer holds a diagram. */
export const REFINE_DIAGRAM_RULE =
  'The answer being revised contains a diagram: a fenced `mermaid` block. The request is about the WORDING. Apply it to the prose only, and reproduce the mermaid block exactly as it is, character for character, in the same place. Do not shorten, simplify, rename or reorder anything inside it, and do not drop it.';

/**
 * The same rule for an answer whose visual is a chart or a notation model. The
 * numbers and the notation are exactly what a rewording must not touch.
 */
export const REFINE_VISUAL_RULE =
  'The answer being revised contains a chart or diagram: a fenced `natively-chart`, `natively-diagram` or `mermaid` block. The request is about the WORDING. Apply it to the prose only, and reproduce every such block exactly as it is, character for character, in the same place. Do not change, round, rename, reorder or drop anything inside it.';

/** The refine rule for a previous answer: the Mermaid wording when that is all it holds. */
export function refineRuleFor(previousAnswer) {
  const blocks = parseFencedBlocks(String(previousAnswer ?? ''), { final: true }).blocks.filter(isVisualBlock);
  if (blocks.length === 0) return '';
  return blocks.every((b) => b.kind === 'mermaid') ? REFINE_DIAGRAM_RULE : REFINE_VISUAL_RULE;
}

const norm = (v) => String(v ?? '').replace(/\r\n?/g, '\n').trim();

function closedDiagrams(text) {
  return parseFencedBlocks(text, { final: true }).blocks.filter((b) => isVisualBlock(b) && b.closed);
}

const MERMAID_HEADER_RE = /^\s*(?:flowchart|graph|sequenceDiagram|stateDiagram(?:-v2)?|erDiagram|classDiagram|mindmap|timeline|gantt|quadrantChart)\b/;

/**
 * An untagged block that is this diagram, a little edited: same notation, and
 * most of its lines are lines of the original.
 */
function looksLikeTheSameDiagram(source, want) {
  const lines = (v) => norm(v).split('\n').map((l) => l.trim()).filter(Boolean);
  const mine = lines(source);
  if (mine.length === 0) return false;
  if (want.kind === 'mermaid') {
    if (!MERMAID_HEADER_RE.test(mine[0]) || mine[0].split(/\s+/)[0] !== lines(want.source)[0]?.split(/\s+/)[0]) return false;
  } else if (!/^\{/.test(mine[0])) {
    return false;
  }
  const theirs = new Set(lines(want.source));
  const shared = mine.filter((l) => theirs.has(l)).length;
  return shared >= Math.ceil(mine.length / 2);
}

function renderBlock(block) {
  const fence = block.fenceChar.repeat(block.fenceLength);
  const info = block.info || VISUAL_FENCE_TAG[block.kind] || 'mermaid';
  return `${fence}${info}\n${norm(block.source)}\n${fence}`;
}

/**
 * Make `refined` carry the same diagrams as `previous`.
 *
 * - a diagram the refinement changed is put back as it was;
 * - a diagram the refinement dropped is re-inserted (the first after the
 *   opening paragraph, later ones at the end);
 * - an extra diagram the refinement invented is left alone (harmless, and the
 *   caller did not ask us to delete model output).
 *
 * @returns {{ text: string, changed: boolean, restored: number }}
 */
export function preserveDiagramsInRefinement(previous, refined) {
  const original = closedDiagrams(String(previous ?? ''));
  const text = String(refined ?? '');
  if (original.length === 0 || !text.trim()) return { text, changed: false, restored: 0 };

  const parse = parseFencedBlocks(text, { final: true });

  // Which block of the refinement stands for which original diagram.
  //
  // By CONTENT first: a diagram that came back unchanged is itself, wherever it
  // now sits. (Pairing by position put the old diagram on top of a NEW chart
  // the model had added above it, and then appended a copy.) What is left is
  // paired in order within the same kind — that is "the model edited it" — and
  // a diagram returned in a fence with no tag is recognised by its text, so it
  // is retagged in place instead of the original being added beside it.
  const sameSource = (block, want) => norm(block.source) === norm(want.source);
  /** @type {Map<number, number>} index in parse.blocks → index in original */
  const standsFor = new Map();
  const taken = new Set();
  const claim = (matches) => {
    parse.blocks.forEach((block, at) => {
      if (standsFor.has(at)) return;
      const k = original.findIndex((want, idx) => !taken.has(idx) && matches(block, want));
      if (k === -1) return;
      standsFor.set(at, k);
      taken.add(k);
    });
  };
  claim((block, want) => isVisualBlock(block) && block.kind === want.kind && sameSource(block, want));
  claim((block, want) => block.kind === 'code' && sameSource(block, want));
  claim((block, want) => isVisualBlock(block) && block.kind === want.kind);
  claim((block, want) => block.kind === 'code' && !block.info && looksLikeTheSameDiagram(block.source, want));

  let out = '';
  let restored = 0;
  for (let at = 0; at < parse.blocks.length; at += 1) {
    const block = parse.blocks[at];
    const raw = text.slice(block.start, block.end);
    const want = standsFor.has(at) ? original[standsFor.get(at)] : null;
    if (want && (!isVisualBlock(block) || !sameSource(block, want))) {
      const tail = text.slice(block.end);
      out += renderBlock(want) + (tail && !tail.startsWith('\n') ? '\n' : block.closed && /\n$/.test(raw) ? '\n' : '');
      restored += 1;
    } else {
      out += raw;
    }
  }
  const current = { length: standsFor.size };

  // Diagrams that did not come back at all.
  const missing = original.filter((_want, idx) => !taken.has(idx));
  if (missing.length > 0) {
    const [first, ...rest] = missing;
    if (current.length === 0) {
      // Original shape: lead sentence(s) → diagram → explanation.
      const breakAt = out.search(/\r?\n[ \t]*\r?\n/);
      if (breakAt === -1) {
        out = `${out.replace(/\s+$/, '')}\n\n${renderBlock(first)}`;
      } else {
        out = `${out.slice(0, breakAt).replace(/\s+$/, '')}\n\n${renderBlock(first)}\n\n${out.slice(breakAt).replace(/^\s+/, '')}`;
      }
    } else {
      out = `${out.replace(/\s+$/, '')}\n\n${renderBlock(first)}`;
    }
    for (const block of rest) out = `${out.replace(/\s+$/, '')}\n\n${renderBlock(block)}`;
    restored += missing.length;
  }

  return { text: out, changed: restored > 0, restored };
}
