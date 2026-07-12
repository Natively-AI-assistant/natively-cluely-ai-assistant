// Context OS sealed-holdout evaluator.
//
// The application runner receives only the corpus/questions manifest. This
// scorer is intentionally separate: it consumes a result JSONL plus a sealed
// evaluator manifest supplied at execution time, checks pack/trace governance
// deterministically, and emits a confidence-bounded release verdict. It does
// not contain document or entity-specific production rules.
//
// Usage:
//   node tests/e2e-modes/context-os-sealed-holdout-score.mjs \
//     --results /secure/results.jsonl --sealed /secure/holdout-gold.json

import fs from 'node:fs';
import crypto from 'node:crypto';

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const resultsPath = arg('--results');
const sealedPath = arg('--sealed');
if (!resultsPath || !sealedPath) throw new Error('usage requires --results and --sealed');

const readJsonl = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
const gold = JSON.parse(fs.readFileSync(sealedPath, 'utf8'));
const goldCases = new Map((gold.cases || []).map((item) => [item.id, item]));
const results = readJsonl(resultsPath);

const wilsonLowerBound = (passes, total, z = 1.6448536269514722) => {
  if (total <= 0) return 0;
  const proportion = passes / total;
  const denominator = 1 + (z * z) / total;
  const centre = proportion + (z * z) / (2 * total);
  const margin = z * Math.sqrt((proportion * (1 - proportion) + (z * z) / (4 * total)) / total);
  return (centre - margin) / denominator;
};

const resultIds = results.map((item) => item.caseId);
const duplicateResultIds = [...new Set(resultIds.filter((id, index) => resultIds.indexOf(id) !== index))];
const unknownResultIds = resultIds.filter((id) => !goldCases.has(id));
const missingResultIds = [...goldCases.keys()].filter((id) => !resultIds.includes(id));
const resultById = new Map(results.map((item) => [item.caseId, item]));
const scored = [];
for (const [id, expected] of goldCases) {
  const actual = resultById.get(id);
  const trace = actual?.trace || {};
  const pack = actual?.pack || {};
  const output = String(actual?.answer || '');
  const sourceOwnerOk = trace.sourceOwner === expected.sourceOwner;
  const policyOk = pack.answerPolicy === expected.answerPolicy;
  const noForbiddenSource = !(actual?.promptSources || []).some((kind) => (expected.forbiddenSources || []).includes(kind));
  const selection = pack?.selection;
  const selectedEvidenceIds = selection?.selectedEvidenceIds;
  const candidateEvidenceIds = selection?.candidateEvidenceIds;
  const excludedEvidenceIds = selection?.excludedEvidenceIds;
  const packItems = Array.isArray(pack?.items) ? pack.items : [];
  const itemsById = new Map(packItems.map((item) => [item.evidenceId, item]));
  const selectedEvidence = Array.isArray(selectedEvidenceIds)
    ? selectedEvidenceIds.map((evidenceId) => itemsById.get(evidenceId))
    : [];
  const isExpectedRefusal = expected.answerPolicy === 'refuse_insufficient_evidence';
  const evidenceScopeOk = isExpectedRefusal || (
    Array.isArray(selectedEvidenceIds)
    && selectedEvidenceIds.length > 0
    && selectedEvidence.length === selectedEvidenceIds.length
    && selectedEvidence.every((item) => item && (expected.allowedSourceIds || []).includes(item.sourceId))
  );
  const isUniqueKnown = (ids) => Array.isArray(ids)
    && ids.length === new Set(ids).size
    && ids.every((id) => itemsById.has(id));
  const packSelectionValid = isExpectedRefusal || (
    isUniqueKnown(candidateEvidenceIds)
    && isUniqueKnown(selectedEvidenceIds)
    && isUniqueKnown(excludedEvidenceIds)
    && selectedEvidenceIds.every((id) => !excludedEvidenceIds.includes(id))
    && new Set([...selectedEvidenceIds, ...excludedEvidenceIds]).size === candidateEvidenceIds.length
    && candidateEvidenceIds.every((id) => selectedEvidenceIds.includes(id) || excludedEvidenceIds.includes(id))
  );
  const deterministicRefusalOk = expected.answerPolicy !== 'refuse_insufficient_evidence'
    || actual?.providerDispatch === false;
  const criterionOk = expected.answerPolicy === 'refuse_insufficient_evidence'
    ? Boolean(output.trim())
    : Boolean(actual?.semanticVerdict?.pass);
  const pass = sourceOwnerOk && policyOk && noForbiddenSource && evidenceScopeOk && packSelectionValid && deterministicRefusalOk && criterionOk;
  scored.push({ id, pass, sourceOwnerOk, policyOk, noForbiddenSource, evidenceScopeOk, packSelectionValid, deterministicRefusalOk, criterionOk });
}

const passes = scored.filter((item) => item.pass).length;
const criticalIsolationFailures = scored.filter((item) => !item.sourceOwnerOk || !item.noForbiddenSource || !item.evidenceScopeOk);
const rate = scored.length ? passes / scored.length : 0;
const lower95 = wilsonLowerBound(passes, scored.length);
const verdict = {
  evaluatorManifestSha256: crypto.createHash('sha256').update(fs.readFileSync(sealedPath)).digest('hex'),
  total: scored.length,
  passes,
  pointEstimate: rate,
  oneSided95WilsonLowerBound: lower95,
  criticalIsolationFailures: criticalIsolationFailures.map((item) => item.id),
  duplicateResultIds,
  unknownResultIds,
  missingResultIds,
  releasePass: scored.length >= 400
    && rate >= 0.975
    && lower95 >= 0.95
    && criticalIsolationFailures.length === 0
    && duplicateResultIds.length === 0
    && unknownResultIds.length === 0
    && missingResultIds.length === 0,
  scored,
};
console.log(JSON.stringify(verdict, null, 2));
if (!verdict.releasePass) process.exitCode = 1;
