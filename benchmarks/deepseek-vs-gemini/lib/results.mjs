// A retried call for a (promptId, modelId) pair that previously ERRORED must
// replace the old errored record, not sit alongside it — otherwise Task 8's
// judging and Task 9's report aggregation see duplicate rows for the same
// pair. upsertResult keeps result arrays as plain arrays (the JSON file
// shape Task 8/9 expect) while enforcing at most one record per pair, with
// the newest record winning.
export function upsertResult(results, record) {
  const key = `${record.promptId}::${record.modelId}`;
  const withoutExisting = results.filter((r) => `${r.promptId}::${r.modelId}` !== key);
  withoutExisting.push(record);
  return withoutExisting;
}
