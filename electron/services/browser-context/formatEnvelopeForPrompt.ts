/**
 * Smart Browser Context v2 — format a structured envelope into a prompt block.
 *
 * Produces the `BROWSER_CONTEXT_KIND: coding_problem ...` block the prompt
 * composer injects. This is prepended to the existing `domContext` string so it
 * flows through the SAME proven seam (PromptAssembler.buildDomContextBlock →
 * `<dom_context source="browser_dom">`) — no new prompt path, no WTA signature
 * change. When there is no envelope, behaviour is byte-identical to today.
 *
 * Pure + dependency-free so it unit-tests from dist-electron.
 */

import type { CodingProblemPayload, ContextEnvelope } from './types';

/** Categories that get the rich structured coding block. */
const CODING_CATEGORIES = new Set(['coding_problem', 'coding_editor', 'interview_assessment']);

function section(label: string, value: string | undefined): string {
  const v = (value || '').trim();
  if (!v) return '';
  return `\n${label}:\n${v}\n`;
}

/** Sections cut first, in this order, when the block is over its budget. */
const SHRINK_ORDER = ['PROBLEM_STATEMENT', 'EXAMPLES', 'INPUT_FORMAT', 'OUTPUT_FORMAT', 'SELECTED_TEXT', 'CONSTRAINTS'];
const CUT_MARKER = '\n…(cut to fit the capture budget)';

/**
 * Format an envelope into a structured header block. Returns '' when the envelope
 * is absent or not a coding category (non-coding captures keep using the legacy
 * plain-string dom only). The result is meant to be PREPENDED to the legacy
 * domContext string, and the two are cut to `maxChars` together from the end.
 *
 * The block itself is kept within `maxChars` (#646): prose sections are cut
 * first (SHRINK_ORDER), never the code or the RUN_RESULT, so a long statement
 * cannot push the result of the user's last run out of the prompt.
 */
export function formatEnvelopeForPrompt(
  envelope: ContextEnvelope | null | undefined,
  maxChars = Infinity,
): string {
  if (!envelope || typeof envelope !== 'object') return '';
  if (!CODING_CATEGORIES.has(envelope.category)) return '';

  const p = (envelope.payload || {}) as CodingProblemPayload;
  const lines: string[] = [];
  lines.push(`BROWSER_CONTEXT_KIND: ${envelope.category}`);
  if (envelope.meta?.platform || p.platform) lines.push(`PLATFORM: ${envelope.meta?.platform || p.platform}`);
  lines.push(`CONFIDENCE: ${envelope.confidence}`);
  const head = lines.join('\n');

  // The extension sends the editor code as both starter and visible code;
  // the same text twice only takes budget.
  const starter = (p.starterCode || '').trim() === (p.visibleCode || '').trim() && p.visibleCode ? '' : p.starterCode;
  const sections: Array<[string, string | undefined]> = [
    ['PROBLEM_TITLE', p.problemTitle],
    ['PROBLEM_STATEMENT', p.problemStatement],
    ['INPUT_FORMAT', p.inputFormat],
    ['OUTPUT_FORMAT', p.outputFormat],
    ['EXAMPLES', p.examples],
    ['CONSTRAINTS', p.constraints],
    ['VISIBLE_STARTER_CODE', starter],
    ['VISIBLE_CODE', p.visibleCode],
    ['RUN_RESULT', p.runResult],
    ['LANGUAGE', p.language],
    ['SELECTED_TEXT', p.selectedText],
  ];
  // Guidance the model should follow when using this structured context.
  const rules =
    '\nRULES: Preserve the exact starter code / function signature. Use the visible ' +
    'examples and constraints. Do not invent requirements not present above. If the ' +
    'context seems incomplete, say what is missing.' +
    (p.runResult
      ? ' RUN_RESULT is what the page showed for the last run of the code; use it to find the bug.'
      : '') +
    '\n';

  const build = () => (head + sections.map(([label, value]) => section(label, value)).join('') + rules).trim();
  let block = build();
  for (const label of SHRINK_ORDER) {
    const over = block.length - maxChars;
    if (over <= 0) break;
    const entry = sections.find(([l]) => l === label);
    const value = (entry?.[1] || '').trim();
    if (!entry || !value) continue;
    const keep = value.length - over - CUT_MARKER.length;
    entry[1] = keep > 0 ? value.slice(0, keep) + CUT_MARKER : '';
    block = build();
  }
  return block;
}
