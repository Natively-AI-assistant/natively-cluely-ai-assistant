// A result "counts as done" only if it succeeded (no `error` field / error is
// falsy) — a prior errored attempt is retried on resume rather than treated
// as permanently skipped, matching the runner's retry-then-record-error policy.
export function pendingWork(promptIds, modelIds, existingResults) {
  const done = new Set(
    existingResults
      .filter((r) => !r.error)
      .map((r) => `${r.promptId}::${r.modelId}`),
  );
  const pending = [];
  for (const promptId of promptIds) {
    for (const modelId of modelIds) {
      if (!done.has(`${promptId}::${modelId}`)) {
        pending.push({ promptId, modelId });
      }
    }
  }
  return pending;
}
