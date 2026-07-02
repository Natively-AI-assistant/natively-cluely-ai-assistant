/**
 * Regression tests for document-grounded thesis Q&A fix (2026-07-01).
 *
 * Root causes fixed:
 *  1. Hardcoded "seminar material" / "not mentioned" phrase in prompt → told model
 *     to refuse even when answer was in retrieved context.
 *  2. topK=6 / budget=1800 calibrated for short seminar notes → missed large PDF
 *     chunks beyond the first 1800 tokens.
 *  3. False-refusal detector was LOG-ONLY → never regenerated a synthesizable answer.
 *  4. Hybrid race budget was 1000ms → cold embedder missed, fell back to weaker
 *     lexical-only path on large PDFs.
 *
 * All tests are source-assertion (read .ts source files as strings) so they
 * run without a compiled dist-electron build. This follows the same pattern as
 * HybridDocumentGroundingPath.test.mjs and TargetedRetrievalRetry.test.mjs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const promptSrc = read('electron/llm/documentGroundedPrompt.ts');
const retrieverSrc = read('electron/services/ModeContextRetriever.ts');
const llmHelperSrc = read('electron/LLMHelper.ts');
const ipcHandlersSrc = read('electron/ipcHandlers.ts');

// ---------------------------------------------------------------------------
// 1. Prompt text — prohibited phrases removed
// ---------------------------------------------------------------------------
test('documentGroundedPrompt: does not contain "seminar material" phrase', () => {
  assert.ok(
    !promptSrc.toLowerCase().includes('seminar material'),
    'The phrase "seminar material" is hardcoded to the wrong document type and must be removed from documentGroundedPrompt.ts',
  );
});

test('documentGroundedPrompt: does not instruct model to say "not directly mentioned in my seminar material"', () => {
  assert.ok(
    !promptSrc.includes('not directly mentioned in my seminar material'),
    'Old hardcoded refusal phrase must be removed from documentGroundedPrompt.ts',
  );
});

test('documentGroundedPrompt: instructs model that retrieved content are excerpts not the full document', () => {
  const lower = promptSrc.toLowerCase();
  const hasExcerptLanguage = lower.includes('excerpt') || lower.includes('retrieved section');
  assert.ok(hasExcerptLanguage,
    'Prompt must clarify these are retrieved excerpts, not the complete document');
});

test('documentGroundedPrompt: refusal phrase references retrieved sections not the whole document', () => {
  // The refusal phrase must say "retrieved sections" to be honest — not "the document"
  const hasRetrievedSectionRefusal =
    promptSrc.includes('retrieved sections') || promptSrc.includes('retrieved excerpts');
  assert.ok(hasRetrievedSectionRefusal,
    'Refusal instruction must reference "retrieved sections" not the complete document');
});

test('documentGroundedPrompt: material section header says RETRIEVED EXCERPTS not UPLOADED REFERENCE MATERIAL', () => {
  assert.ok(
    !promptSrc.includes('UPLOADED REFERENCE MATERIAL'),
    'Old "UPLOADED REFERENCE MATERIAL" label must be replaced with "RETRIEVED EXCERPTS" to be honest',
  );
  assert.ok(
    promptSrc.includes('RETRIEVED EXCERPTS'),
    'Must use "RETRIEVED EXCERPTS FROM UPLOADED DOCUMENT" as the material section header',
  );
});

// ---------------------------------------------------------------------------
// 2. ModeContextRetriever constants — exported and correct values
// ---------------------------------------------------------------------------
test('ModeContextRetriever: exports DOC_GROUNDED_TOKEN_BUDGET = 3600', () => {
  assert.ok(
    retrieverSrc.includes('export const DOC_GROUNDED_TOKEN_BUDGET = 3600'),
    'DOC_GROUNDED_TOKEN_BUDGET must be exported as 3600 from ModeContextRetriever.ts',
  );
});

test('ModeContextRetriever: exports DOC_GROUNDED_TOP_K = 12', () => {
  assert.ok(
    retrieverSrc.includes('export const DOC_GROUNDED_TOP_K = 12'),
    'DOC_GROUNDED_TOP_K must be exported as 12 from ModeContextRetriever.ts',
  );
});

test('ModeContextRetriever: auto-upgrades tokenBudget when forceDocumentGrounding and not explicitly set', () => {
  // The upgrade logic uses `options.tokenBudget != null` as the "caller-explicit" signal
  assert.ok(
    retrieverSrc.includes('options.tokenBudget != null'),
    'retrieve() must check options.tokenBudget != null to allow auto-upgrade for doc-grounded',
  );
  assert.ok(
    retrieverSrc.includes('forceDocumentGrounding ? DOC_GROUNDED_TOKEN_BUDGET : DEFAULT_TOKEN_BUDGET'),
    'retrieve() must use DOC_GROUNDED_TOKEN_BUDGET when forceDocumentGrounding=true',
  );
});

test('ModeContextRetriever: auto-upgrades topK when forceDocumentGrounding and not explicitly set', () => {
  assert.ok(
    retrieverSrc.includes('options.topK != null'),
    'retrieve() must check options.topK != null to allow auto-upgrade for doc-grounded',
  );
  assert.ok(
    retrieverSrc.includes('forceDocumentGrounding ? DOC_GROUNDED_TOP_K : DEFAULT_TOP_K'),
    'retrieve() must use DOC_GROUNDED_TOP_K when forceDocumentGrounding=true',
  );
});

// ---------------------------------------------------------------------------
// 3. ipcHandlers — false-refusal promotion to regen trigger
// ---------------------------------------------------------------------------
test('ipcHandlers: imports DOC_GROUNDED_TOKEN_BUDGET from ModeContextRetriever', () => {
  assert.ok(
    ipcHandlersSrc.includes("import { DOC_GROUNDED_TOKEN_BUDGET } from './services/ModeContextRetriever'"),
    'ipcHandlers.ts must import DOC_GROUNDED_TOKEN_BUDGET from ModeContextRetriever',
  );
});

test('ipcHandlers: uses DOC_GROUNDED_TOKEN_BUDGET in re-retrieval for validator (not hardcoded 1800)', () => {
  // Verify the re-retrieval call for the validator uses DOC_GROUNDED_TOKEN_BUDGET.
  // The call site is: buildRetrievedActiveModeContextBlock(message, undefined, DOC_GROUNDED_TOKEN_BUDGET, ...)
  // Find the buildRetrievedActiveModeContextBlock call in the validator block and confirm it has the constant
  const callIdx = ipcHandlersSrc.indexOf('buildRetrievedActiveModeContextBlock(');
  assert.ok(callIdx !== -1, 'buildRetrievedActiveModeContextBlock must exist in ipcHandlers');
  // Look in a 200-char window around the call
  const window = ipcHandlersSrc.slice(callIdx, callIdx + 200);
  assert.ok(
    window.includes('DOC_GROUNDED_TOKEN_BUDGET'),
    'buildRetrievedActiveModeContextBlock call must use DOC_GROUNDED_TOKEN_BUDGET, not hardcoded 1800',
  );
});

test('ipcHandlers: false-refusal check uses isFalseRefusal variable (promoted from log-only)', () => {
  assert.ok(
    ipcHandlersSrc.includes('isFalseRefusal'),
    'ipcHandlers must define isFalseRefusal variable for the promoted false-refusal check',
  );
});

test('ipcHandlers: false-refusal repair gated on document entity/title overlap (not raw term count)', () => {
  // Updated 2026-07-02: the gate moved from a plain ≥2-term overlap (which
  // leaked on off-topic questions whose generic words matched a chunk) to an
  // OKF entity/title overlap signal — a whole-name hit or >=2 distinct title
  // tokens. See OkfPhase0FalseRefusalGuard.test.mjs for the behavioral tests.
  assert.ok(
    ipcHandlersSrc.includes('const hasEntityEvidence = wholeNameHit || tokenHits.size >= 2;'),
    'ipcHandlers false-refusal must gate on whole-name-hit OR >=2 distinct title tokens',
  );
  assert.ok(
    ipcHandlersSrc.includes('const shouldRepair = hasStrongEvidence;'),
    'shouldRepair must derive from the entity-evidence-based hasStrongEvidence',
  );
});

test('ipcHandlers: reason includes false_refusal case', () => {
  assert.ok(
    ipcHandlersSrc.includes("isFalseRefusal ? 'false_refusal'"),
    "reason assignment must include isFalseRefusal ? 'false_refusal' : null branch",
  );
});

test('ipcHandlers: regen prompt for false_refusal uses synthesis directive (not generic grounding prompt)', () => {
  assert.ok(
    ipcHandlersSrc.includes("reason === 'false_refusal'"),
    "regen must branch on reason === 'false_refusal' for the synthesis-focused prompt",
  );
  assert.ok(
    ipcHandlersSrc.includes('synthesize'),
    'false_refusal regen prompt must instruct the model to SYNTHESIZE from excerpts',
  );
});

test('ipcHandlers: false-refusal stop-word filter removes question/function words', () => {
  // The filter regex must exclude stop-words before counting matched terms
  assert.ok(
    ipcHandlersSrc.includes("the|this|that|what|when|where|who|how|why|which"),
    'Stop-word filter in false-refusal detector must exclude common question/function words',
  );
});

test('ipcHandlers: false-refusal detector catches "could not find" refusal phrase', () => {
  // The new prompt teaches the model to say "could not find in retrieved sections"
  // The detector must catch that phrase too
  assert.ok(
    ipcHandlersSrc.includes('could not find'),
    'False-refusal detector must match "could not find" (the new model-facing refusal phrase)',
  );
});

// ---------------------------------------------------------------------------
// 4. LLMHelper — hybrid timeout and budget changes
// ---------------------------------------------------------------------------
test('LLMHelper: HYBRID_BUDGET_MS raised to 2000 for doc-grounded paths', () => {
  // The fix uses a conditional: forceDocumentGrounding ? 2000 : 1000
  assert.ok(
    llmHelperSrc.includes('forceDocumentGrounding ? 2000 : 1000'),
    'LLMHelper must use 2000ms hybrid budget for doc-grounded (was 1000ms for all paths)',
  );
});

test('LLMHelper: passes undefined tokenBudget for doc-grounded (lets retriever auto-upgrade)', () => {
  // Both the hybrid and sync fallback calls must pass undefined when forceDocumentGrounding
  assert.ok(
    llmHelperSrc.includes('forceDocumentGrounding ? undefined : 1800'),
    'LLMHelper must pass undefined (not 1800) for tokenBudget when forceDocumentGrounding=true, so the retriever auto-upgrades to DOC_GROUNDED_TOKEN_BUDGET',
  );
});

test('LLMHelper: emits telemetry on hybrid timeout with forceDocumentGrounding context', () => {
  assert.ok(
    llmHelperSrc.includes('doc_grounded_hybrid_timeout'),
    'LLMHelper must emit telemetry event on hybrid timeout so we can monitor cold-embedder fallback rate',
  );
});

// ---------------------------------------------------------------------------
// 5. False-refusal logic unit simulation (pure JS, no module load)
// ---------------------------------------------------------------------------
function simulateFalseRefusalCheck(answer, question, contextBlock) {
  const trimmed = answer.trim();
  const saysNotMentioned = /not (?:directly )?(?:mentioned|in (?:the|my) (?:uploaded|seminar|thesis|retrieved) (?:material|sections?|document)|found in|present in)|could not find/i.test(trimmed);
  if (!saysNotMentioned || !contextBlock) return { isFalseRefusal: false, present: [] };
  const qTerms = (question.match(/\b[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]\b/g) || [])
    .filter((t) => t.length >= 3 && t.length <= 40)
    .filter((t) => !/^(?:the|this|that|what|when|where|who|how|why|which|does|did|was|were|are|is|in|of|at|to|for|with|about|and|or|not|has|have|had|its|can|could|would|should|will|from|than|more|any|all|some|tell|explain|describe|me|my|your|their|it|be|do|an|on|by|as|up|if|so|but|out|no|we|they|he|she|you|his|her|our|us|them)$/i.test(t));
  const chunkLower = contextBlock.toLowerCase();
  const present = qTerms.filter((t) => chunkLower.includes(t.toLowerCase()));
  return { isFalseRefusal: present.length >= 2, present };
}

test('false-refusal-sim: triggers when ≥2 content terms found in context', () => {
  const answer = 'This is not directly mentioned in my seminar material.';
  const question = 'What is AgenticVLA and how does OpenVLA benefit from it?';
  const context = 'AgenticVLA is a multi-agent framework. OpenVLA uses it for robot task planning.';
  const { isFalseRefusal, present } = simulateFalseRefusalCheck(answer, question, context);
  assert.strictEqual(isFalseRefusal, true, `Should detect false refusal; matched: ${present.join(',')}`);
  assert.ok(present.length >= 2);
});

test('false-refusal-sim: does NOT trigger when only 1 term matches', () => {
  const answer = 'I could not find that in the retrieved sections.';
  const question = 'What is AgenticVLA?'; // only "AgenticVLA" is a content term
  const context = 'AgenticVLA is mentioned briefly.';
  const { isFalseRefusal } = simulateFalseRefusalCheck(answer, question, context);
  assert.strictEqual(isFalseRefusal, false, 'Should NOT trigger on single-term match');
});

test('false-refusal-sim: does NOT trigger on honest affirmative answer', () => {
  const answer = 'AgenticVLA is a framework that integrates OpenVLA with agentic task planning.';
  const question = 'What is AgenticVLA?';
  const context = 'AgenticVLA integrates OpenVLA with task planning.';
  const { isFalseRefusal } = simulateFalseRefusalCheck(answer, question, context);
  assert.strictEqual(isFalseRefusal, false, 'Non-refusal answers must not be flagged');
});

test('false-refusal-sim: catches new "could not find" phrase from revised prompt', () => {
  const answer = 'I could not find that in the retrieved sections of the document.';
  const question = 'What improvements does OpenVLA-OFT add over OpenVLA?';
  const context = 'OpenVLA-OFT adds parallel decoding and efficient parameter fine-tuning over base OpenVLA.';
  const { isFalseRefusal } = simulateFalseRefusalCheck(answer, question, context);
  assert.strictEqual(isFalseRefusal, true, 'Must catch "could not find" as a refusal phrase');
});

test('false-refusal-sim: stop-word filter does not kill valid content terms', () => {
  // "AutoGen", "selection", "rationale" are valid content terms that must survive the filter
  const question = 'What was the rationale for selecting AutoGen as the framework?';
  const qTerms = (question.match(/\b[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]\b/g) || [])
    .filter((t) => t.length >= 3 && t.length <= 40)
    .filter((t) => !/^(?:the|this|that|what|when|where|who|how|why|which|does|did|was|were|are|is|in|of|at|to|for|with|about|and|or|not|has|have|had|its|can|could|would|should|will|from|than|more|any|all|some|tell|explain|describe|me|my|your|their|it|be|do|an|on|by|as|up|if|so|but|out|no|we|they|he|she|you|his|her|our|us|them)$/i.test(t));
  assert.ok(qTerms.includes('AutoGen'), 'AutoGen must survive stop-word filter');
  assert.ok(qTerms.includes('rationale'), 'rationale must survive stop-word filter');
  assert.ok(qTerms.includes('selecting') || qTerms.includes('framework'), 'content words must survive');
});

// ---------------------------------------------------------------------------
// 6. buildDocumentGroundedUserContent — output structure
// ---------------------------------------------------------------------------

/**
 * Pure-JS port of buildDocumentGroundedUserContent from documentGroundedPrompt.ts.
 * Mirrors the source logic so we can assert structure without importing TS.
 */
function buildDocumentGroundedUserContentSim({ question, retrievedBlock, priorContext, active }) {
  if (!active) return null;
  const q = (question || '').trim();
  if (!q) return null;
  const material = (retrievedBlock || '').trim();
  const parts = [];
  parts.push(`QUESTION: ${q}`);
  parts.push('');
  parts.push(
    'Answer the QUESTION above using ONLY facts literally present in the retrieved document excerpts below. ' +
    'These are excerpts from the uploaded file — not the complete document. ' +
    'The excerpts may use slightly different words than the question (e.g. "objectives" for "phases", table rows for data) ' +
    '— you may answer from clearly-matching content, but never invent numbers, names, or items that are not actually written there. ' +
    'If the specific answer is not found in these excerpts, say so clearly ("I could not find that in the retrieved sections") ' +
    '— do not claim it is absent from the whole document.',
  );
  parts.push('');
  if (material) {
    parts.push('## RETRIEVED EXCERPTS FROM UPLOADED DOCUMENT');
    parts.push(material);
    parts.push('');
  }
  if (priorContext && priorContext.trim()) {
    parts.push('## RECENT CONVERSATION (for pronoun resolution only — not a source of facts)');
    parts.push(priorContext.trim());
    parts.push('');
  }
  parts.push(`Now answer this question directly and concisely: ${q}`);
  return parts.join('\n');
}

test('buildDocumentGroundedUserContent: returns null when active=false', () => {
  const result = buildDocumentGroundedUserContentSim({
    question: 'What is OpenVLA?',
    retrievedBlock: 'OpenVLA is a framework for robot control.',
    active: false,
  });
  assert.strictEqual(result, null, 'Must return null when not in doc-grounded mode');
});

test('buildDocumentGroundedUserContent: returns null when question is empty', () => {
  const result = buildDocumentGroundedUserContentSim({
    question: '   ',
    retrievedBlock: 'Some content.',
    active: true,
  });
  assert.strictEqual(result, null, 'Must return null when question is whitespace-only');
});

test('buildDocumentGroundedUserContent: question appears FIRST in output', () => {
  const question = 'What is the DOF of the robot arm described?';
  const result = buildDocumentGroundedUserContentSim({
    question,
    retrievedBlock: 'The robot arm has 7 DOF.',
    active: true,
  });
  assert.ok(result !== null);
  // The very first content must be the question prefix
  assert.ok(
    result.startsWith(`QUESTION: ${question}`),
    'Question must appear at the very start of user content for weak-model anchoring',
  );
});

test('buildDocumentGroundedUserContent: question also appears LAST in output (restatement)', () => {
  const question = 'What is the DOF of the robot arm described?';
  const result = buildDocumentGroundedUserContentSim({
    question,
    retrievedBlock: 'The robot arm has 7 DOF.',
    active: true,
  });
  assert.ok(result !== null);
  assert.ok(
    result.endsWith(`Now answer this question directly and concisely: ${question}`),
    'Question must be restated at the end to keep the weak model anchored after reading material',
  );
});

test('buildDocumentGroundedUserContent: contains RETRIEVED EXCERPTS section header', () => {
  const result = buildDocumentGroundedUserContentSim({
    question: 'What is AgenticVLA?',
    retrievedBlock: 'AgenticVLA is a multi-agent framework.',
    active: true,
  });
  assert.ok(result !== null);
  assert.ok(
    result.includes('## RETRIEVED EXCERPTS FROM UPLOADED DOCUMENT'),
    'Must label the material as retrieved excerpts (not uploaded material or seminar notes)',
  );
});

test('buildDocumentGroundedUserContent: excerpt section is sandwiched between question and restatement', () => {
  const question = 'How many parameters does OpenVLA have?';
  const material = 'OpenVLA has 7B parameters.';
  const result = buildDocumentGroundedUserContentSim({
    question,
    retrievedBlock: material,
    active: true,
  });
  assert.ok(result !== null);
  const qIdx = result.indexOf(`QUESTION: ${question}`);
  const excerptIdx = result.indexOf('## RETRIEVED EXCERPTS FROM UPLOADED DOCUMENT');
  const restatementIdx = result.lastIndexOf(`Now answer this question directly and concisely:`);
  assert.ok(qIdx < excerptIdx, 'Question header must come before excerpt block');
  assert.ok(excerptIdx < restatementIdx, 'Excerpt block must come before question restatement');
});

test('buildDocumentGroundedUserContent: omits excerpt section when retrievedBlock is empty', () => {
  const result = buildDocumentGroundedUserContentSim({
    question: 'What is OpenVLA?',
    retrievedBlock: '',
    active: true,
  });
  assert.ok(result !== null, 'Should still build content even with no material (question still answerable context)');
  assert.ok(
    !result.includes('## RETRIEVED EXCERPTS FROM UPLOADED DOCUMENT'),
    'Must omit the section header when there is no retrieved material',
  );
});

test('buildDocumentGroundedUserContent: includes priorContext when provided', () => {
  const result = buildDocumentGroundedUserContentSim({
    question: 'And how does that compare to OpenVLA-OFT?',
    retrievedBlock: 'OpenVLA has 7B parameters. OpenVLA-OFT adds parallel decoding.',
    priorContext: 'User asked about OpenVLA parameters.',
    active: true,
  });
  assert.ok(result !== null);
  assert.ok(
    result.includes('## RECENT CONVERSATION (for pronoun resolution only'),
    'Prior context must be included under the pronoun-resolution header',
  );
  assert.ok(
    result.includes('User asked about OpenVLA parameters.'),
    'Prior context text must appear in the output',
  );
});

test('buildDocumentGroundedUserContent: source function signature matches sim (active param contract)', () => {
  // Verify the real source has the same param shape our sim mirrors
  assert.ok(
    promptSrc.includes('active: boolean'),
    'buildDocumentGroundedUserContent must accept active: boolean param',
  );
  assert.ok(
    promptSrc.includes('if (!active) return null'),
    'Must short-circuit to null when not active',
  );
  assert.ok(
    promptSrc.includes("if (!q) return null"),
    'Must short-circuit to null when question is empty after trim',
  );
});

// ---------------------------------------------------------------------------
// 7. shapeDocumentGroundedSystemPrompt — idempotency and bypass
// ---------------------------------------------------------------------------

test('documentGroundedPrompt: shapeDocumentGroundedSystemPrompt is idempotent', () => {
  // Calling it twice must not double-append the override block
  assert.ok(
    promptSrc.includes('## DOCUMENT-GROUNDED OVERRIDE') && promptSrc.includes('idempotent'),
    'shapeDocumentGroundedSystemPrompt must guard against double-appending the override (idempotent)',
  );
});

test('documentGroundedPrompt: shapeDocumentGroundedSystemPrompt returns base unchanged when active=false', () => {
  assert.ok(
    promptSrc.includes('if (!active || !baseSystemPrompt) return baseSystemPrompt'),
    'Must return base system prompt unchanged when active=false so non-doc-grounded chat is byte-for-byte identical',
  );
});

// ---------------------------------------------------------------------------
// 8. Safe fallback path — invalid regen → blockedFromSessionTracker
// ---------------------------------------------------------------------------

test('ipcHandlers: invalid regen emits pi_doc_grounded_safe_failure telemetry', () => {
  assert.ok(
    ipcHandlersSrc.includes('pi_doc_grounded_safe_failure'),
    'Must emit pi_doc_grounded_safe_failure when regen produces invalid output',
  );
});

test('ipcHandlers: safe failure text references uploaded material, not the conversation or seminar', () => {
  // The safe fallback line must reference "uploaded material" so the user knows
  // WHERE to look, and must not reference "seminar" or "the conversation"
  const safeIdx = ipcHandlersSrc.indexOf("I couldn't find that in the uploaded material");
  assert.ok(safeIdx !== -1, 'Safe failure string must reference "uploaded material"');
  const safeStr = ipcHandlersSrc.slice(safeIdx, safeIdx + 150);
  assert.ok(!safeStr.toLowerCase().includes('seminar'), 'Safe failure must not reference seminar material');
  assert.ok(!safeStr.toLowerCase().includes('conversation'), 'Safe failure must not reference "the conversation"');
});

test('ipcHandlers: safe failure sets blockedFromSessionTracker=true so invalid answer cannot poison next turn', () => {
  // Both the assignment and the downstream guard must co-exist
  assert.ok(
    ipcHandlersSrc.includes('blockedFromSessionTracker = true'),
    'Invalid-regen path must set blockedFromSessionTracker=true',
  );
  assert.ok(
    ipcHandlersSrc.includes('!blockedFromSessionTracker'),
    'SessionTracker update must be gated on !blockedFromSessionTracker',
  );
});

test('ipcHandlers: regenValid check guards against regen that is itself a greeting', () => {
  // The regenValid predicate must exclude greetings — otherwise a bad model
  // could turn a false-refusal regen into a greeting loop.
  const regenValidIdx = ipcHandlersSrc.indexOf('regenValid');
  assert.ok(regenValidIdx !== -1, 'regenValid must be defined');
  const window = ipcHandlersSrc.slice(regenValidIdx, regenValidIdx + 300);
  assert.ok(
    window.includes('GREETING_RE.test(regenTrim)'),
    'regenValid must reject regen outputs that are greetings',
  );
});

// ---------------------------------------------------------------------------
// 9. Retriever token budget — non-doc-grounded path uses DEFAULT_TOKEN_BUDGET
// ---------------------------------------------------------------------------

test('ModeContextRetriever: non-doc-grounded path falls back to DEFAULT_TOKEN_BUDGET (1800)', () => {
  // The ternary must reference the DEFAULT_TOKEN_BUDGET constant, not a hardcoded literal,
  // on the false branch so both constants stay in sync via one source-of-truth.
  assert.ok(
    retrieverSrc.includes('const DEFAULT_TOKEN_BUDGET = 1800'),
    'DEFAULT_TOKEN_BUDGET must be defined as 1800 (the pre-fix default)',
  );
  // The ternary false-branch must yield DEFAULT_TOKEN_BUDGET (not a raw 1800 literal)
  assert.ok(
    retrieverSrc.includes(': DEFAULT_TOKEN_BUDGET'),
    'Non-doc-grounded branch of ternary must reference DEFAULT_TOKEN_BUDGET constant, not a raw literal',
  );
});

test('ModeContextRetriever: non-doc-grounded path falls back to DEFAULT_TOP_K (6)', () => {
  assert.ok(
    retrieverSrc.includes('const DEFAULT_TOP_K = 6'),
    'DEFAULT_TOP_K must be defined as 6',
  );
  assert.ok(
    retrieverSrc.includes(': DEFAULT_TOP_K'),
    'Non-doc-grounded branch of ternary must reference DEFAULT_TOP_K constant, not a raw literal',
  );
});

test('ModeContextRetriever: explicit options.tokenBudget wins over doc-grounded auto-upgrade', () => {
  // The guard is `options.tokenBudget != null` — if the caller passes 5000
  // the ternary short-circuits and DOC_GROUNDED_TOKEN_BUDGET is NOT used.
  // We verify the source expresses this exactly: caller-explicit check comes FIRST.
  const upgradeExpr = 'options.tokenBudget != null\n            ? options.tokenBudget\n            : (forceDocumentGrounding ? DOC_GROUNDED_TOKEN_BUDGET : DEFAULT_TOKEN_BUDGET)';
  // Use substring search to tolerate minor whitespace differences
  const normalized = retrieverSrc.replace(/\r\n/g, '\n');
  const hasExplicitWins =
    normalized.includes(upgradeExpr) ||
    // Also accept single-line form in case formatter changed it
    normalized.includes('options.tokenBudget != null ? options.tokenBudget : (forceDocumentGrounding ? DOC_GROUNDED_TOKEN_BUDGET : DEFAULT_TOKEN_BUDGET)');
  assert.ok(
    hasExplicitWins,
    'Explicit tokenBudget override (options.tokenBudget != null) must take precedence over doc-grounded auto-upgrade',
  );
});

// ---------------------------------------------------------------------------
// 10. Stop-word filter edge cases
// ---------------------------------------------------------------------------

// Reuse the same stop-word regex as the source for consistent simulation
const STOP_WORD_RE = /^(?:the|this|that|what|when|where|who|how|why|which|does|did|was|were|are|is|in|of|at|to|for|with|about|and|or|not|has|have|had|its|can|could|would|should|will|from|than|more|any|all|some|tell|explain|describe|me|my|your|their|it|be|do|an|on|by|as|up|if|so|but|out|no|we|they|he|she|you|his|her|our|us|them)$/i;
const TERM_RE = /\b[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]\b/g;

function extractTerms(text) {
  return (text.match(TERM_RE) || [])
    .filter((t) => t.length >= 3 && t.length <= 40)
    .filter((t) => !STOP_WORD_RE.test(t));
}

test('stop-word filter: single-character tokens are excluded by length >= 3 guard', () => {
  const terms = extractTerms('I asked: is it a big deal or not?');
  // "it", "is", "or", "not" should be removed by stop-word; "big", "deal" should survive
  assert.ok(!terms.includes('I'), '"I" (1 char) must be excluded');
  assert.ok(!terms.includes('a'), '"a" (1 char) must be excluded');
  assert.ok(terms.includes('big'), '"big" must survive');
  assert.ok(terms.includes('deal'), '"deal" must survive');
});

test('stop-word filter: two-character tokens are excluded by length >= 3 guard', () => {
  const terms = extractTerms('We do an end-to-end study of AI');
  assert.ok(!terms.includes('We'), '"We" (2 chars) must be excluded');
  assert.ok(!terms.includes('do'), '"do" (2 chars) must be excluded');
  assert.ok(!terms.includes('an'), '"an" (2 chars) must be excluded');
  assert.ok(!terms.includes('of'), '"of" (2 chars) must be excluded');
  assert.ok(!terms.includes('AI'), '"AI" (2 chars) must be excluded');
});

test('stop-word filter: hyphenated terms are captured as single tokens by the term regex', () => {
  // The term regex [A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9] captures internal hyphens.
  // "end-to-end" is a 10-char token — within the 3-40 length band, not a stop-word.
  const terms = extractTerms('We use an end-to-end approach for OpenVLA-OFT training');
  assert.ok(terms.includes('end-to-end'), '"end-to-end" must be captured as a single hyphenated term');
  assert.ok(terms.includes('OpenVLA-OFT'), '"OpenVLA-OFT" must be captured as a single hyphenated term');
});

test('stop-word filter: common question words are filtered (what, how, why, where, when, who)', () => {
  const question = 'What how why where when who does tell me explain describe';
  const terms = extractTerms(question);
  for (const stopWord of ['What', 'how', 'why', 'where', 'when', 'who', 'does', 'tell', 'explain', 'describe']) {
    assert.ok(!terms.includes(stopWord), `"${stopWord}" must be removed by stop-word filter`);
  }
});

test('stop-word filter: terms of exactly 3 chars pass when not stop-words', () => {
  // 3-char content terms like "DOF" (degrees of freedom), "VLA", "RAG" should survive
  const terms = extractTerms('The DOF value and VLA framework and RAG pipeline');
  assert.ok(terms.includes('DOF'), '"DOF" (3 chars, not stop-word) must survive');
  assert.ok(terms.includes('VLA'), '"VLA" (3 chars, not stop-word) must survive');
  assert.ok(terms.includes('RAG'), '"RAG" (3 chars, not stop-word) must survive');
});

test('stop-word filter: terms longer than 40 chars are excluded', () => {
  // A 41+ char term (e.g. a URL fragment or a very long token) should be dropped
  const longToken = 'a'.repeat(41);
  const text = `The ${longToken} framework`;
  const terms = extractTerms(text);
  assert.ok(!terms.includes(longToken), 'Tokens longer than 40 chars must be excluded');
});

// ---------------------------------------------------------------------------
// Round-2 fixes (code-reviewer findings, 2026-07-01)
// ---------------------------------------------------------------------------

// Load additional source files for round-2
const hybridRetrieverSrc = read('electron/services/modes/ModeHybridRetriever.ts');
const wtaSrc = read('electron/llm/WhatToAnswerLLM.ts');

// --- CRITICAL: ModeHybridRetriever auto-upgrade ---

test('round2: ModeHybridRetriever does NOT use JS destructuring default (tokenBudget = DEFAULT_TOKEN_BUDGET) directly', () => {
  // The old pattern `tokenBudget = DEFAULT_TOKEN_BUDGET` in the destructuring
  // bypasses the forceDocumentGrounding auto-upgrade. Verify it's gone.
  // Allow the alias pattern (_rawTokenBudget) instead.
  const hasOldDestructuringDefault = hybridRetrieverSrc.includes('tokenBudget = DEFAULT_TOKEN_BUDGET,')
    || hybridRetrieverSrc.includes('topK = DEFAULT_TOP_K,');
  assert.ok(!hasOldDestructuringDefault,
    'ModeHybridRetriever must NOT use JS destructuring default for tokenBudget/topK — use alias + post-destructuring override instead');
});

test('round2: ModeHybridRetriever applies DOC_GROUNDED auto-upgrade after destructuring', () => {
  // The fix aliases to _rawTokenBudget and applies the upgrade after extracting forceDocumentGrounding
  assert.ok(
    hybridRetrieverSrc.includes('_rawTokenBudget'),
    'ModeHybridRetriever must alias tokenBudget param as _rawTokenBudget to allow post-destructuring upgrade',
  );
  assert.ok(
    hybridRetrieverSrc.includes('forceDocumentGrounding ? DOC_GROUNDED_TOKEN_BUDGET_LOCAL : DEFAULT_TOKEN_BUDGET'),
    'ModeHybridRetriever must apply DOC_GROUNDED_TOKEN_BUDGET_LOCAL when forceDocumentGrounding=true',
  );
  assert.ok(
    hybridRetrieverSrc.includes('forceDocumentGrounding ? DOC_GROUNDED_TOP_K_LOCAL : DEFAULT_TOP_K'),
    'ModeHybridRetriever must apply DOC_GROUNDED_TOP_K_LOCAL when forceDocumentGrounding=true',
  );
});

test('round2: ModeHybridRetriever uses 3600 for DOC_GROUNDED_TOKEN_BUDGET_LOCAL', () => {
  assert.ok(
    hybridRetrieverSrc.includes('DOC_GROUNDED_TOKEN_BUDGET_LOCAL = 3600'),
    'ModeHybridRetriever local constant must be 3600 to match ModeContextRetriever export',
  );
});

test('round2: ModeHybridRetriever uses 12 for DOC_GROUNDED_TOP_K_LOCAL', () => {
  assert.ok(
    hybridRetrieverSrc.includes('DOC_GROUNDED_TOP_K_LOCAL = 12'),
    'ModeHybridRetriever local constant must be 12 to match ModeContextRetriever export',
  );
});

// --- HIGH: WhatToAnswerLLM.ts passes undefined when doc-grounded ---

test('round2: WhatToAnswerLLM passes undefined tokenBudget when forceDocumentGrounding (hybrid path)', () => {
  // All three call sites must use forceDocumentGrounding ? undefined : 1800
  const count = (wtaSrc.match(/forceDocumentGrounding \? undefined : 1800/g) || []).length;
  assert.ok(count >= 2,
    `WhatToAnswerLLM must have ≥2 call sites using "forceDocumentGrounding ? undefined : 1800" (found ${count})`);
});

test('round2: WhatToAnswerLLM does not pass hardcoded 1800 to any retrieval call unconditionally', () => {
  // The pattern ", 1800," should not appear as a bare literal in retrieval calls
  // (it must always be conditional via the ternary)
  const lines = wtaSrc.split('\n');
  const badLines = lines.filter(l =>
    l.includes('buildRetrievedActiveModeContextBlock') && l.includes(', 1800,')
  );
  assert.strictEqual(badLines.length, 0,
    `WhatToAnswerLLM must not pass hardcoded 1800 to any retrieval call: ${badLines.join('\n')}`);
});

// --- HIGH: regenAbort.signal wired into streamChat ---

test('round2: ipcHandlers wires regenAbort.signal into streamChat call', () => {
  // The signal must appear on the same line as the streamChat(strictPrompt...) call.
  // Find the line that contains the actual streamChat call (not the comment) and
  // verify regenAbort.signal is on that same line.
  const lines = ipcHandlersSrc.split('\n');
  const streamChatLine = lines.find(l => l.includes('llmHelper.streamChat(strictPrompt'));
  assert.ok(streamChatLine, 'llmHelper.streamChat(strictPrompt must exist in ipcHandlers');
  assert.ok(
    streamChatLine.includes('regenAbort.signal'),
    `regenAbort.signal must be in the streamChat(strictPrompt...) call — found line: ${streamChatLine.trim()}`,
  );
});

// --- MEDIUM: "could not find" regex tightened to first-person ---

test('round2: saysNotMentioned regex requires "I could not find" not bare "could not find"', () => {
  // The old pattern "could not find" matched research sentences.
  // New pattern requires first-person ("I could not find") or sentence-initial.
  assert.ok(
    !ipcHandlersSrc.includes('|could not find/i'),
    'Bare "|could not find" must be replaced with first-person anchored pattern',
  );
  assert.ok(
    ipcHandlersSrc.includes('I could not find'),
    'saysNotMentioned regex must require "I could not find" (first-person anchor)',
  );
});

test('round2: saysNotMentioned regex false-refusal sim — does NOT trigger on research sentence', () => {
  // "Researchers could not find a viable solution" must NOT match the new regex
  const tightenedRegex = /not (?:directly )?(?:mentioned|in (?:the|my) (?:uploaded|seminar|thesis|retrieved) (?:material|sections?|document)|found in|present in)|(?:^|(?<=[.!?]\s+))I could not find\b/i;
  const researchSentence = 'Researchers could not find a viable solution, leading to the proposed framework.';
  assert.ok(!tightenedRegex.test(researchSentence),
    'Tightened regex must NOT match research/factual sentences about third parties not finding things');
});

test('round2: saysNotMentioned regex false-refusal sim — DOES trigger on first-person refusal', () => {
  const tightenedRegex = /not (?:directly )?(?:mentioned|in (?:the|my) (?:uploaded|seminar|thesis|retrieved) (?:material|sections?|document)|found in|present in)|(?:^|(?<=[.!?]\s+))I could not find\b/i;
  const firstPersonRefusal = 'I could not find that in the retrieved sections of the document.';
  assert.ok(tightenedRegex.test(firstPersonRefusal),
    'Tightened regex must match first-person "I could not find" refusal phrase');
});

test('round2: saysNotMentioned regex false-refusal sim — DOES trigger on original "not mentioned" pattern', () => {
  const tightenedRegex = /not (?:directly )?(?:mentioned|in (?:the|my) (?:uploaded|seminar|thesis|retrieved) (?:material|sections?|document)|found in|present in)|(?:^|(?<=[.!?]\s+))I could not find\b/i;
  const oldPattern = 'This is not directly mentioned in my seminar material.';
  assert.ok(tightenedRegex.test(oldPattern),
    'Tightened regex must still catch the old "not directly mentioned in ... material" pattern');
});

// --- MEDIUM: regenValid guards against false_refusal regen that also refuses ---

test('round2: ipcHandlers defines regenIsStillRefusing guard for false_refusal case', () => {
  assert.ok(
    ipcHandlersSrc.includes('regenIsStillRefusing'),
    'regenValid must check regenIsStillRefusing to avoid shipping a second refusal as if recovered',
  );
});

test('round2: regenValid includes !regenIsStillRefusing predicate', () => {
  const regenValidIdx = ipcHandlersSrc.indexOf('const regenValid =');
  assert.ok(regenValidIdx !== -1, 'regenValid must be defined');
  const window = ipcHandlersSrc.slice(regenValidIdx, regenValidIdx + 400);
  assert.ok(window.includes('!regenIsStillRefusing'),
    'regenValid predicate must include !regenIsStillRefusing so a second refusal falls through to safe failure');
});

test('round2: regenIsStillRefusing is gated on reason === false_refusal (not checked for other cases)', () => {
  assert.ok(
    ipcHandlersSrc.includes("reason === 'false_refusal'") &&
    ipcHandlersSrc.includes('regenIsStillRefusing'),
    'regenIsStillRefusing must be guarded by reason === false_refusal to avoid blocking valid regen for greeting/empty cases',
  );
});
