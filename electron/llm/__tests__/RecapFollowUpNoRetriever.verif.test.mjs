// Context OS verification (M2 guard): Recap/Follow-up isolation is a SOFT prompt
// rule. It is only safe because RecapLLM/FollowUpLLM do not independently fetch
// profile/JD/persona/Hindsight/OKF. This static import guard FAILS if either LLM
// ever gains a retrieval dependency — at which point the soft rule would be the
// only guard and the isolation must be re-designed as hard capability scoping.
//
// Run: node --test electron/llm/__tests__/RecapFollowUpNoRetriever.verif.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const FORBIDDEN_RETRIEVER_PATTERNS = [
  /KnowledgeOrchestrator/,
  /processQuestion/,
  /retrieveProfileEvidence/,
  /OkfProfileRetriever/,
  /selectManualProfileEvidence|tryBuildManualProfileFastPathAnswer/,
  /recallRelevantMemory|LongTermMemoryService|Hindsight/,
  /buildRetrievedActiveModeContextBlock/,
  /RAGRetriever|queryMeeting|queryGlobal/,
];

for (const file of ['electron/llm/RecapLLM.ts', 'electron/llm/FollowUpLLM.ts']) {
  test(`${file} imports NO profile/memory/RAG retriever (M2 isolation premise)`, () => {
    const src = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    for (const pat of FORBIDDEN_RETRIEVER_PATTERNS) {
      assert.ok(!pat.test(src),
        `${file} references ${pat} — recap/follow-up source isolation is prompt-text-only and would now be BYPASSED by a real retriever. Re-design as hard capability scoping.`);
    }
  });
}

test('RecapLLM/FollowUpLLM DO append the Context OS contract rule (wiring present)', () => {
  const recap = fs.readFileSync(path.join(repoRoot, 'electron/llm/RecapLLM.ts'), 'utf8');
  const follow = fs.readFileSync(path.join(repoRoot, 'electron/llm/FollowUpLLM.ts'), 'utf8');
  assert.ok(/contractRule/.test(recap), 'RecapLLM must accept a contractRule');
  assert.ok(/contractRule/.test(follow), 'FollowUpLLM must accept a contractRule');
});
