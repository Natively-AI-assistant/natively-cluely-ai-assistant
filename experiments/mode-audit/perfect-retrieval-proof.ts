// PROOF: even with PERFECT retrieval, the V3 decision layer discards a reference
// chunk that literally contains the answer, for second-person questions.
//
// Uses the REAL production modules end to end: createModeRetrievalPort ->
// createLegacyRetrievalPort (scope/version/type/claim filtering) -> orchestrate().
// The injected retriever always returns the answer-bearing chunk, so anything
// that fails here failed in the DECISION layer, not in ranking or embeddings.
import { orchestrate } from '../../electron/context-intelligence/orchestration/orchestrator';
import { createModeRetrievalPort } from '../../electron/context-intelligence/retrieval/mode-retrieval-port';
import { resolveModePolicy, MODE_IDS } from '../../electron/context-intelligence/policies/mode-policy-registry';

const FILE = { id: 'file-1', fileName: 'projects.md', content:
  '# Projects\n\n## Project: Orbit Bridge\n\n### Retries\nThe retry policy is 6 attempts with a backoff multiplier of 2.5.\n' };
const ANSWER = '6 attempts with a backoff multiplier of 2.5';

// A retriever that ALWAYS returns the answer-bearing chunk — perfect recall.
const perfectRetriever = {
  retrieveHybridRaw: async () => ({ chunks: [{
    sourceId: FILE.id, fileName: FILE.fileName, chunkIndex: 0,
    text: `[context: Project: Orbit Bridge > Retries]\nThe retry policy is ${ANSWER}.`,
    score: 0.99, ftsScore: 0.9, vectorScore: 0.99,
  }] }),
};

const QS: Array<[string, string]> = [
  ['2nd-person', 'How did you handle retries on Orbit Bridge?'],
  ['2nd-person', 'What is your retry policy on Orbit Bridge?'],
  ['2nd-person', 'Do you have retries configured on Orbit Bridge?'],
  ['neutral   ', 'What is the retry policy on the Orbit Bridge project?'],
];

(async () => {
  for (const modeId of MODE_IDS) {
    const policy = resolveModePolicy(modeId);
    const port = createModeRetrievalPort({
      modesManager: perfectRetriever, modeInfo: { id: modeId }, files: [FILE],
      allowedSourceTypes: policy.allowedSourceTypes,
      tokenBudget: policy.contextBudget.evidenceTokens, userId: 'local',
    });
    const out: string[] = [];
    for (const [kind, q] of QS) {
      const r = await orchestrate({
        requestId: 'r', requestSequence: 1, surface: 'manual-chat' as any, modeId,
        scope: { userId: 'local' }, sessionId: `s-${modeId}-${q.length}`,
        manualQuestion: q, hasAttachedDocuments: true, attachedFileNames: [FILE.fileName],
      }, port);
      const got = r.evidence.some(e => e.content.includes(ANSWER));
      const rej = r.trace.retrievalAttempts.flatMap(a => a.rejections ?? []).map(x => x.reason);
      out.push(`   ${got ? 'REACHED ' : 'DISCARDED'} [${kind}] answerability=${String(r.answerability).padEnd(7)} fallback=${String(r.trace.fallbackUsed).padEnd(22)} ${rej.length ? 'rejected:' + [...new Set(rej)].join(',') : (r.evidence.length ? '' : 'no evidence returned')} | ${q}`);
    }
    console.log(`\n### ${modeId}`); out.forEach(l => console.log(l));
  }
})();
