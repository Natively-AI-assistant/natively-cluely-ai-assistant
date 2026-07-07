#!/usr/bin/env node
/**
 * trace-aot-jit-bypasses.mjs — READ-ONLY static verifier.
 *
 * Re-checks, against the CURRENT source tree, the AOT->final-answer bypass sites
 * the investigation identified. It greps for the exact emit sites and prints
 * PASS/FAIL for the invariant "no user-visible final answer comes from AOT".
 *
 * No provider calls, no DB access. Pure source inspection so it stays true even
 * as line numbers drift.
 *
 * Usage: node tools/jd-resume-jit-investigation/trace-aot-jit-bypasses.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

function read(rel) { try { return fs.readFileSync(path.join(repoRoot, rel), 'utf8'); } catch { return null; } }
function findLine(src, needle) {
  if (!src) return null;
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(needle)) return { line: i + 1, text: lines[i].trim() };
  return null;
}

const CHECKS = [
  {
    id: 'AOT-1',
    file: 'premium/electron/knowledge/ContextAssembler.ts',
    needle: 'Serving precomputed (AOT) intro',
    desc: 'AOT-precomputed intro returned as introResponse (no LLM). FORBIDDEN final-answer bypass.',
    classification: 'FORBIDDEN final-answer bypass',
  },
  {
    id: 'AOT-2',
    file: 'electron/LLMHelper.ts',
    needle: 'returning generated intro response (mode-gate bypassed for identity recall)',
    desc: 'Streaming consumer yields knowledgeResult.introResponse and returns — emits the AOT string as the final answer.',
    classification: 'FORBIDDEN final-answer bypass (primary live path)',
  },
  {
    id: 'AOT-3',
    file: 'electron/LLMHelper.ts',
    needle: 'returning intro response (mode-gate bypassed for identity recall)',
    desc: 'Non-streaming consumer returns knowledgeResult.introResponse — same bypass, and lacks the streaming path route guard.',
    classification: 'FORBIDDEN final-answer bypass',
  },
  {
    id: 'AOT-4',
    file: 'premium/electron/knowledge/KnowledgeOrchestrator.ts',
    needle: 'Direct Identity Fact match. Returning instantly.',
    desc: 'Deterministic string-templated identity answer ("You are <name>.") returned as introResponse — the 4ms/6ms answers.',
    classification: 'FORBIDDEN final-answer bypass (identity fast-path)',
  },
  {
    id: 'AOT-5',
    file: 'premium/electron/knowledge/ContextAssembler.ts',
    needle: 'isBareGreeting',
    desc: 'Bare greeting handled by handleBareGreeting (random canned string) as introResponse.',
    classification: 'FORBIDDEN final-answer bypass (low severity)',
  },
];

console.log('═'.repeat(90));
console.log(' AOT -> FINAL-ANSWER BYPASS VERIFIER (static, current source)');
console.log(' Invariant: no user-visible final answer comes from AOT / a precomputed string.');
console.log('═'.repeat(90));

let live = 0;
for (const c of CHECKS) {
  const src = read(c.file);
  const hit = findLine(src, c.needle);
  const present = Boolean(hit);
  if (present) live++;
  console.log(`\n[${c.id}] ${present ? 'PRESENT (bypass live)' : 'not found (removed/renamed?)'} — ${c.classification}`);
  console.log(`   ${c.file}${hit ? ':' + hit.line : ''}`);
  console.log(`   ${c.desc}`);
  if (hit) console.log(`   > ${hit.text}`);
}

// Enforcement check: is FinalAnswerGenerationPolicy actually wired as a guard?
console.log('\n' + '-'.repeat(90));
console.log(' ENFORCEMENT: is FinalAnswerGenerationPolicy.assertNoForbiddenFinalAnswerPath called anywhere?');
const grepTargets = ['electron/LLMHelper.ts', 'electron/ipcHandlers.ts', 'electron/IntelligenceEngine.ts', 'premium/electron/knowledge/ContextAssembler.ts', 'premium/electron/knowledge/KnowledgeOrchestrator.ts'];
let enforced = false;
for (const f of grepTargets) {
  const src = read(f);
  if (src && (src.includes('assertNoForbiddenFinalAnswerPath') || src.includes('evaluateFinalAnswerPolicy') || src.includes('finalAnswerRequiresProvider'))) {
    enforced = true;
    console.log(`   CALL FOUND in ${f}`);
  }
}
if (!enforced) console.log('   NONE — the enforcement functions are exported + unit-tested but never called at the emit sites. Policy is advisory/dead.');

console.log('\n' + '═'.repeat(90));
console.log(` RESULT: ${live}/${CHECKS.length} bypass sites LIVE; FinalAnswerGenerationPolicy enforcement wired: ${enforced ? 'YES' : 'NO'}`);
console.log(` VERDICT: ${live > 0 && !enforced ? 'FAIL — AOT final-answer bypasses active and unenforced.' : live === 0 ? 'PASS' : 'PARTIAL'}`);
console.log('═'.repeat(90));
