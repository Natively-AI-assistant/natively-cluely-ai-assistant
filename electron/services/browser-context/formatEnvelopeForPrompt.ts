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

import type {
  CodingProblemPayload,
  CodingProjectPayload,
  ContextEnvelope,
} from './types';

/** Categories that get the rich structured coding block. */
const CODING_CATEGORIES = new Set(['coding_problem', 'coding_editor', 'interview_assessment']);

function section(label: string, value: string | undefined): string {
  const v = (value || '').trim();
  if (!v) return '';
  return `\n${label}:\n${v}\n`;
}

/** Keep untrusted one-line metadata from forging another project section. */
function inline(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\r\n]+/g, ' ').trim() : '';
}

function finiteCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function formatCodingProject(envelope: ContextEnvelope): string {
  const p = (envelope.payload || {}) as Partial<CodingProjectPayload>;
  const lines: string[] = [
    'BROWSER_CONTEXT_KIND: coding_project',
    `CONFIDENCE: ${envelope.confidence}`,
  ];

  const provider = inline(p.provider);
  const workspaceId = inline(p.workspaceId);
  const workspaceName = inline(p.workspaceName);
  const baseContextId = inline(p.baseContextId);
  if (provider) lines.push(`PROVIDER: ${provider}`);
  if (workspaceId) lines.push(`WORKSPACE_ID: ${workspaceId}`);
  if (workspaceName) lines.push(`WORKSPACE_NAME: ${workspaceName}`);
  lines.push(`REFRESH_MODE: ${p.refreshMode === 'changed' ? 'changed' : 'full'}`);
  if (baseContextId) lines.push(`BASE_CONTEXT_ID: ${baseContextId}`);
  lines.push(`FILES_CAPTURED: ${finiteCount(p.capturedFileCount)} / ${finiteCount(p.totalFileCount)}`);
  lines.push(`CONTEXT_BUDGET: ${finiteCount(p.usedChars)} / ${finiteCount(p.budgetChars)} chars`);

  lines.push(`SELECTED_PATH_COUNT: ${Array.isArray(p.selectedPaths) ? p.selectedPaths.length : 0}`);
  lines.push(`OMITTED_FILE_COUNT: ${Array.isArray(p.omitted) ? p.omitted.length : 0}`);
  // The extension's legacy project block immediately follows this header. It
  // is already deterministically capped at 22k and only truncates at explicit
  // file boundaries. Do not duplicate file bodies here: IPC caps the combined
  // prompt at 25k, so a second copy could be sliced mid-file before the safe
  // block (and its omission manifest) is ever reached.
  lines.push('PROJECT_DETAILS: The following bounded project block contains the problem statement, exact file paths, file contents, manifest, and omission disclosures.');

  lines.push(
    'RULES: Analyze the problem statement and project files together. Return the solution or patch grouped by exact FILE paths. Preserve cross-file imports, shared types, interfaces, API contracts, and existing signatures. Explicitly disclose every missing or truncated input, including unreadable, ignored, removed, or omitted files, that limits the solution; do not invent missing file contents.',
  );
  return lines.join('\n').trim();
}

/**
 * Format an envelope into a structured header block. Returns '' when the envelope
 * is absent or not a coding category (non-coding captures keep using the legacy
 * plain-string dom only). The result is meant to be PREPENDED to the legacy
 * domContext string. Coding-project bodies intentionally remain in the
 * boundary-safe legacy block instead of being duplicated into this header.
 */
export function formatEnvelopeForPrompt(envelope: ContextEnvelope | null | undefined): string {
  if (!envelope || typeof envelope !== 'object') return '';
  if (envelope.category === 'coding_project') return formatCodingProject(envelope);
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
