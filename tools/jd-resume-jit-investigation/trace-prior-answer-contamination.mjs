#!/usr/bin/env node
/**
 * trace-prior-answer-contamination.mjs — READ-ONLY static verifier for the
 * prior-assistant-answer strip gate in the manual gemini-chat-stream path.
 *
 * No provider/DB calls. It inspects ipcHandlers.ts to confirm whether the
 * prior-assistant-turn strip (stripPriorAssistantTurns) is gated ONLY to
 * document-grounded custom modes — meaning a normal JD/interview session's
 * prior "data analyst" answer survives in the rolling snapshot and re-enters
 * the next prompt as unlabelled CONTEXT.
 *
 * Usage: node tools/jd-resume-jit-investigation/trace-prior-answer-contamination.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const src = fs.readFileSync(path.join(repoRoot, 'electron/ipcHandlers.ts'), 'utf8');
const lines = src.split('\n');
const findAll = (needle) => lines.map((t, i) => ({ line: i + 1, text: t })).filter(o => o.text.includes(needle));

console.log('═'.repeat(90));
console.log(' PRIOR-ANSWER CONTAMINATION VERIFIER (static) — manual gemini-chat-stream path');
console.log('═'.repeat(90));

const gate = findAll('_stripFires')[0] || null;
const gateExpr = findAll('documentGroundedCustomModeActive && isDocGroundedAnswerType')[0]
  || findAll('.documentGroundedCustomModeActive && isDocGroundedAnswerType(')[0]
  || null;
const stripCall = findAll('stripPriorAssistantTurns(autoContextSnapshot)')[0] || null;
const bareContext = findAll("Auto-injected 100s context for gemini-chat-stream")[0] || null;

console.log('\n Strip gate (_stripFires):');
if (gateExpr) console.log(`   ipcHandlers.ts:${gateExpr.line}  > ${gateExpr.text.trim()}`);
else if (gate) console.log(`   ipcHandlers.ts:${gate.line}  > ${gate.text.trim()}`);
else console.log('   NOT FOUND — gate may have changed.');

console.log('\n Strip application:');
if (stripCall) console.log(`   ipcHandlers.ts:${stripCall.line}  > ${stripCall.text.trim()}`);

console.log('\n Snapshot injection (becomes prompt CONTEXT):');
if (bareContext) console.log(`   ipcHandlers.ts:${bareContext.line}  > ${bareContext.text.trim()}`);

// Verdict logic: the strip fires only when documentGroundedCustomModeActive && isDocGroundedAnswerType.
const gatedToDocGrounded = Boolean(gateExpr) || (gate && /documentGroundedCustomModeActive/.test(gate.text));

console.log('\n' + '-'.repeat(90));
console.log(' FINDING:');
if (gatedToDocGrounded) {
  console.log('   FAIL (contamination possible): the prior-assistant-turn strip fires ONLY for');
  console.log('   document-grounded CUSTOM modes AND doc-grounded answer types. A normal JD/interview');
  console.log('   session is neither, so [ASSISTANT (PREVIOUS SUGGESTION)] turns — including an earlier');
  console.log('   "data analyst / Python / SQL / ETL / R gap" answer — are NOT stripped. They are injected');
  console.log('   as bare CONTEXT (no trust label, no "avoid repeating" wrapper) into the next prompt.');
  console.log('   jd_fit_answer / gap_analysis_answer are NOT in DOC_GROUNDED_ANSWER_TYPES.');
} else {
  console.log('   Strip gate is broader than doc-grounded — re-read to confirm coverage.');
}

console.log('\n NOTE: contamination here is a SECONDARY amplifier. Primary "analyst framing" source is the');
console.log(' JD itself (Data Analyst JD) + the AOT intro string — see trace-resume-jd-evidence.mjs.');
console.log(' Contamination explains persistence of analyst framing across turns even when the current');
console.log(' question does not route the JD, because the prior answer lingers in the snapshot.');
console.log('═'.repeat(90));
