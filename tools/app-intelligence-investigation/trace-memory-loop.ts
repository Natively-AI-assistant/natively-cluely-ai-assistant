// tools/app-intelligence-investigation/trace-memory-loop.ts
//
// Read-only trace of the prior-assistant → prompt → SessionTracker loop.
//
// This script does NOT import stateful services. It walks the static
// structure of the pure session/memory modules and emits the loop the
// current production code actually executes:
//   1. assistant turn is streamed to the renderer
//   2. assistant turn is appended to SessionTracker.fullTranscript / contextItems
//   3. next turn reads from SessionTracker (autoContextSnapshot for manual,
//      rolling 100-180s window for WTA) → that text re-enters the prompt
//   4. validators may re-stamp the prior assistant turn into the prompt
//      during the doc-grounded greeting/empty/exact-repeat validator
//
// Run with:
//   npx tsx tools/app-intelligence-investigation/trace-memory-loop.ts

import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
function read(rel: string): string {
  const p = path.join(ROOT, rel);
  return fs.readFileSync(p, 'utf-8');
}

function summariseModule(label: string, rel: string): void {
  console.log('--------------------------------------------------------------------');
  console.log(`# ${label}  (${rel})`);
  console.log('--------------------------------------------------------------------');
  const t = read(rel);
  // Print just the function signatures + JSDoc summaries, ignoring internals.
  const re = /(\/\*\*[\s\S]*?\*\/\s*)?(export\s+(?:async\s+)?function\s+\w+|export\s+const\s+\w+\s*=\s*(?:async\s+)?\([^)]*\)\s*=>\s*\{)/g;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(t)) !== null && n < 14) {
    const jsdoc = m[1] || '';
    const decl = m[2];
    const firstLine = (jsdoc + decl).split('\n').filter((l) => l.trim()).slice(0, 5).join(' ');
    console.log('  ' + firstLine.replace(/\s+/g, ' ').slice(0, 240));
    n += 1;
  }
  console.log('');
}

function writeSite(label: string, rel: string, patterns: string[]): void {
  console.log(`# ${label}  (${rel})`);
  const t = read(rel);
  const lines = t.split('\n');
  for (const p of patterns) {
    const re = new RegExp(p, 'g');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (re.test(line)) {
        console.log(`  L${i + 1}: ${line.trim().slice(0, 240)}`);
      }
    }
  }
  console.log('');
}

function main(): void {
  console.log('# Prior-assistant → prompt → SessionTracker memory loop.');
  console.log('#');
  console.log('# Each step lists the file + function + line where the loop happens.');
  console.log('#');

  console.log('====================================================================');
  console.log('# Step 1 — assistant turn streamed');
  console.log('====================================================================');
  writeSite('gemini-chat-stream post-stream validators', 'electron/ipcHandlers.ts',
    ['gemini-stream-token', 'gemini-stream-done', 'finalText', 'sanitizeCandidateAnswer']);

  console.log('====================================================================');
  console.log('# Step 2 — assistant turn appended to SessionTracker');
  console.log('====================================================================');
  writeSite('SessionTracker.addAssistantMessage writes', 'electron/SessionTracker.ts',
    ['addAssistantMessage', 'contextItems.push', 'fullTranscript.push', 'assistantResponseHistory']);

  console.log('====================================================================');
  console.log('# Step 3 — next turn reads from SessionTracker (prior → prompt)');
  console.log('====================================================================');
  writeSite('autoContextSnapshot (manual chat)', 'electron/ipcHandlers.ts',
    ['autoContextSnapshot', 'getFormattedContext']);

  writeSite('WTA hot window', 'electron/IntelligenceEngine.ts',
    ['getContext', 'getFormattedContextWithInterim', 'liveSessionMemory']);

  writeSite('document-grounded strip of prior assistant', 'electron/ipcHandlers.ts',
    ['stripPriorAssistantTurns', '_stripFires']);

  console.log('====================================================================');
  console.log('# Step 4 — validators may RE-STAMP the prior turn into the prompt');
  console.log('====================================================================');
  writeSite('doc-grounded greeting / empty / exact-repeat validator',
    'electron/ipcHandlers.ts',
    ['greeting', 'exactRepeat', 'falseRefusal', 'detectIncompleteNumeric',
     'detectIncompleteList', 'completenessRegenFabricates', 'safeFailureLine']);

  console.log('====================================================================');
  console.log('# Memory modules — what they actually persist');
  console.log('====================================================================');
  summariseModule('SessionTracker', 'electron/SessionTracker.ts');
  summariseModule('ConversationMemoryService', 'electron/intelligence/ConversationMemoryService.ts');
  summariseModule('LiveSessionMemory (rolling)', 'electron/llm/liveSessionMemory.ts');
  summariseModule('LongTermMemoryService (Hindsight recall)', 'electron/intelligence/memory/LongTermMemoryService.ts');
  summariseModule('TemporalContextBuilder (WTA previous responses)', 'electron/llm/TemporalContextBuilder.ts');

  console.log('====================================================================');
  console.log('# Known contamination loops (static analysis)');
  console.log('====================================================================');
  console.log('  - autoContextSnapshot re-feeds prior assistant turn as bare text under');
  console.log('    CONTEXT: (manual chat). The v2.7.0 _stripFires widens the strip to');
  console.log('    all six doc-grounded shapes, but the strip is only active when the');
  console.log('    answer type is in DOC_GROUNDED_ANSWER_TYPES (lecture, definitional,');
  console.log('    list, exact_numeric, document_followup, document_absent_fact_refusal).');
  console.log('  - Topic collapse: a prior assistant turn anchors a weak model on one');
  console.log('    answer regardless of the new question.');
  console.log('  - assistantResponseHistory is capped at 10 and used for ANTI-REPETITION');
  console.log('    (AnswerDiversityGuard), but it also re-feeds ConversationMemory which');
  console.log('    can rehydrate a prior exchange into a bare follow-up.');
  console.log('  - Hindsight retain runs post-meeting and post-lecture; retained facts');
  console.log('    surface as bullets under "RELEVANT LONG-TERM MEMORY" with no per-fact');
  console.log('    source id. A poisonable prior meeting can re-enter prompts as a fact.');
  console.log('  - SessionTracker.fullTranscript is the durable substrate that survives');
  console.log('    120s eviction; fullTranscript feeds durableMemoryWindow (gated) and');
  console.log('    liveSessionMemory (gated). No source tagging is recorded.');
  console.log('');
  console.log('# End of trace-memory-loop.ts output.');
}

main();