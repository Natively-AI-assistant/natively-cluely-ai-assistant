// A retried call for a (idField, modelId) pair that previously ERRORED must
// replace the old errored record, not sit alongside it — otherwise Task 8's
// judging and Task 9's report aggregation see duplicate rows for the same
// pair. upsertResult keeps result arrays as plain arrays (the JSON file
// shape Task 8/9 expect) while enforcing at most one record per pair, with
// the newest record winning.
//
// keyField defaults to 'promptId' (run-raw-comparison.mjs's shape); the
// coding harness uses 'problemId' records instead, so it passes
// keyField: 'problemId' rather than duplicating this function.
export function upsertResult(results, record, keyField = 'promptId') {
  const key = `${record[keyField]}::${record.modelId}`;
  const withoutExisting = results.filter((r) => `${r[keyField]}::${r.modelId}` !== key);
  withoutExisting.push(record);
  return withoutExisting;
}
