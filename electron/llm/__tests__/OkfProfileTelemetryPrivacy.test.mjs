/**
 * OKF Profile Intelligence — telemetry privacy (2026-07-02). Proves the profile
 * OKF telemetry markers carry COUNTS + coarse reasons ONLY, and that a careless
 * caller passing raw profile content (a name, a salary, a card title/body) can
 * never leak it through piTelemetry.scrubTelemetry — the allowlist + value-shape
 * backstop drop it.
 *
 * Requires: npm run build:electron.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distRoot = path.join(repoRoot, 'dist-electron', 'electron');

async function load(rel) {
  return import(pathToFileURL(path.join(distRoot, rel)).href);
}

test('telemetry: profile OKF marker keys survive scrub (counts/reasons)', async () => {
  const { scrubTelemetry } = await load('llm/piTelemetry.js');
  const scrubbed = scrubTelemetry({
    docType: 'resume', cardCount: 6, entityCount: 12, relationCount: 0,
    rejectedCount: 1, packVersion: 2, generatedMs: 14, blockedReason: 'no_route',
    conformant: true, fileCount: 22,
  });
  assert.equal(scrubbed.cardCount, 6);
  assert.equal(scrubbed.docType, 'resume');
  assert.equal(scrubbed.blockedReason, 'no_route');
  assert.equal(scrubbed.conformant, true);
});

test('telemetry: raw profile content (name/company/body) is DROPPED by scrub', async () => {
  const { scrubTelemetry } = await load('llm/piTelemetry.js');
  const scrubbed = scrubTelemetry({
    // These keys are NOT allow-listed → dropped outright.
    candidateName: 'Alex Rivera',
    company: 'Nimbus Data',
    cardTitle: 'Senior Software Engineer at Nimbus Data',
    cardBody: 'Built a real-time ingestion pipeline that reduced event processing latency by 40%.',
    resumeText: 'full resume text',
    // Allowed key but sensitive VALUE (salary) → dropped by value-shape backstop.
    blockedReason: '$260,000 target',
    cardCount: 3, // legitimate marker survives
  });
  assert.equal(scrubbed.candidateName, undefined, 'name dropped');
  assert.equal(scrubbed.company, undefined, 'company dropped');
  assert.equal(scrubbed.cardTitle, undefined, 'card title dropped');
  assert.equal(scrubbed.cardBody, undefined, 'card body dropped');
  assert.equal(scrubbed.resumeText, undefined, 'resume text dropped');
  assert.equal(scrubbed.blockedReason, undefined, 'salary-shaped value dropped');
  assert.equal(scrubbed.cardCount, 3, 'legit count survives');
});

test('telemetry: emitting profile OKF events records only scrubbed markers', async () => {
  const { piTelemetry } = await load('llm/piTelemetry.js');
  piTelemetry.reset();
  piTelemetry.emit('pi_okf_profile_pack_generated', {
    docType: 'resume', cardCount: 6, generatedMs: 12,
    // careless leak attempt:
    candidateName: 'Alex Rivera', cardBody: 'reduced latency by 40%',
  });
  const recent = piTelemetry.recent(5);
  const rec = recent.find((r) => r.event === 'pi_okf_profile_pack_generated');
  assert.ok(rec, 'event recorded');
  assert.equal(rec.data.cardCount, 6);
  assert.equal(rec.data.candidateName, undefined, 'no raw name in recorded event');
  assert.equal(rec.data.cardBody, undefined, 'no raw body in recorded event');
  // Ensure no value in the recorded payload contains the leaked strings.
  const serialized = JSON.stringify(rec.data);
  assert.ok(!serialized.includes('Alex Rivera'), 'name never serialized');
  assert.ok(!serialized.includes('40%'), 'metric never serialized');
});
