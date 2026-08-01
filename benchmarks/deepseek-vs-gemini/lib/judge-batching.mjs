// Deterministic PRNG (mulberry32) so shuffles are reproducible for a given seed.
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle(items, seed) {
  const rand = mulberry32(seed);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const LABELS = ['Response 1', 'Response 2', 'Response 3'];

export function buildJudgeBatches(answersByPrompt, batchSize, seed = 1) {
  const promptIds = Object.keys(answersByPrompt);
  const batches = [];
  for (let i = 0; i < promptIds.length; i += batchSize) {
    const chunk = promptIds.slice(i, i + batchSize);
    const anonymizedItems = [];
    for (const promptId of chunk) {
      const modelKeys = Object.keys(answersByPrompt[promptId]); // e.g. ['A','B','C']
      const shuffledLabels = seededShuffle(LABELS.slice(0, modelKeys.length), seed + i);
      modelKeys.forEach((key, idx) => {
        anonymizedItems.push({ promptId, label: shuffledLabels[idx], modelId: answersByPrompt[promptId][key] });
      });
    }
    batches.push({ promptIds: chunk, anonymizedItems });
  }
  return batches;
}

export function parseJudgeScores(rawJudgeOutput, batch) {
  // rawJudgeOutput: { [promptId]: { [label]: { correctness, completeness, actionability, rationale } } }
  const out = [];
  for (const item of batch.anonymizedItems) {
    const scored = rawJudgeOutput?.[item.promptId]?.[item.label];
    if (!scored) continue;
    out.push({ promptId: item.promptId, modelId: item.modelId, scores: scored, rationale: scored.rationale });
  }
  return out;
}

export function flagContested(allScored, n) {
  const withMargins = allScored.map((s) => {
    const totals = Object.values(s.totalsByModel).sort((a, b) => b - a);
    return { promptId: s.promptId, marginBetweenTop2: totals[0] - (totals[1] ?? totals[0]) };
  });
  return withMargins.sort((a, b) => a.marginBetweenTop2 - b.marginBetweenTop2).slice(0, n);
}
