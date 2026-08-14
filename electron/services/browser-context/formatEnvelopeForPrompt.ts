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

/**
 * Format an envelope into a structured header block. Returns '' when the envelope
 * is absent or not a coding category (non-coding captures keep using the legacy
 * plain-string dom only). The result is meant to be PREPENDED to the legacy
 * domContext string.
 */
export function formatEnvelopeForPrompt(envelope: ContextEnvelope | null | undefined): string {
  if (!envelope || typeof envelope !== 'object') return '';
  if (!CODING_CATEGORIES.has(envelope.category)) return '';

  const p = (envelope.payload || {}) as CodingProblemPayload;
  const lines: string[] = [];
  lines.push(`BROWSER_CONTEXT_KIND: ${envelope.category}`);
  if (envelope.meta?.platform || p.platform) lines.push(`PLATFORM: ${envelope.meta?.platform || p.platform}`);
  lines.push(`CONFIDENCE: ${envelope.confidence}`);

  let block = lines.join('\n');
  block += section('PROBLEM_TITLE', p.problemTitle);
  block += section('PROBLEM_STATEMENT', p.problemStatement);
  block += section('INPUT_FORMAT', p.inputFormat);
  block += section('OUTPUT_FORMAT', p.outputFormat);
  block += section('EXAMPLES', p.examples);
  block += section('CONSTRAINTS', p.constraints);
  block += section('VISIBLE_STARTER_CODE', p.starterCode);
  block += section('VISIBLE_CODE', p.visibleCode);
  if (p.language) block += section('LANGUAGE', p.language);
  if (p.selectedText) block += section('SELECTED_TEXT', p.selectedText);

  // Guidance the model should follow when using this structured context.
  block +=
    '\nRULES: Preserve the exact starter code / function signature. Use the visible ' +
    'examples and constraints. Do not invent requirements not present above. If the ' +
    'context seems incomplete, say what is missing.\n';

  return block.trim();
}
