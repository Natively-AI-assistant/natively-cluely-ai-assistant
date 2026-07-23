// Campaign 2 longsession run-039 script-a/c investigation (2026-07-19): even
// after detectAndExtractScaffoldMisfire (2026-07-18) started recovering some
// scaffold-misfire shapes, live repros A4/A5/C9 proved the model invents
// heading text (e.g. "## STAR story, Long-Tail aggregation at Datadog") that
// none of that function's fixed extraction patterns recognize — so
// extraction returns null even though the coding-scaffold fingerprint
// (Technique/Dry Run heading or O(...)/complexity notation) proves real
// contamination. hasUnrecoveredScaffoldContamination is a detection-only
// signal for exactly this residual gap: "extraction was attempted and
// failed, but the text is still contaminated" — the shape a caller should
// treat as needing a bounded regeneration fallback, not ship as-is.
import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { hasUnrecoveredScaffoldContamination, detectAndExtractScaffoldMisfire } from '../../../dist-electron/electron/llm/index.js';

describe('hasUnrecoveredScaffoldContamination — live repros (run-039)', () => {
  test('A4 (datadog-role): real content under a model-invented "STAR Story" heading is flagged contaminated', () => {
    const raw = `## Approach
- I want to land on a clear, structured answer that pulls directly from your Stripe work on the streaming reconciliation system, since that is the most defensible "recent impact" story.
- The framing should be tight: pick one project, own it end-to-end, then add one or two sharp metrics that prove scale.
- I will stay in your voice and avoid coaching wrappers.

## STAR Story, Streaming Reconciliation at Stripe
- **Situation:** I was the tech lead on Stripe's payment reconciliation. The legacy pipeline was a nightly Hadoop batch job that took 14 hours to close the books and was the single biggest source of finance-team escalations.
- **Task:** Replace it with a streaming pipeline that could keep the ledger in sync with the payments surface in near real time.
- **Action:**
  - Designed a Kafka-based ingestion layer with exactly-once semantics into Flink, using idempotent sinks backed by DynamoDB conditional writes so replays were safe.

## Technique / Data Structure / Algorithm Used
- Kafka exactly-once ingestion, Flink stream processing, DynamoDB conditional writes for idempotency.`;
    assert.equal(detectAndExtractScaffoldMisfire('skill_experience_answer', raw), null, 'sanity: extraction genuinely fails on this shape');
    assert.equal(hasUnrecoveredScaffoldContamination('skill_experience_answer', raw), true);
  });

  test('A5 (datadog-throughput): real content under "## STAR story, Long-Tail aggregation" plus trailing Complexity heading is flagged contaminated', () => {
    const raw = `## Approach
- Stay in your Datadog voice; the interviewer is testing whether you can speak crisply about a system you actually owned, not the Stripe story.

## STAR story, Long-Tail aggregation at Datadog
- **Situation:** I owned the tail-aggregation service on the Long-Tail team at Datadog.
- **Result:** Cut tail-merge latency substantially and let us onboard customers we previously had to throttle.

## Interviewer follow-ups to expect
- How you picked the sharding key and what happens during resharding.

## Technique / Data Structure / Algorithm Used
- Consistent hashing for shard placement, RocksDB LSM as the per-shard store, bloom filters on the read path.

## Complexity
- Sharded reads and writes are O(1) network hops plus O(log n) LSM cost per shard.`;
    assert.equal(detectAndExtractScaffoldMisfire('skill_experience_answer', raw), null, 'sanity: extraction genuinely fails on this shape');
    assert.equal(hasUnrecoveredScaffoldContamination('skill_experience_answer', raw), true);
  });

  test('C9 (injection-embedded system-design question): coding scaffold with a fenced code block and no recognized final-answer marker is flagged contaminated', () => {
    const raw = `## Approach
Design a deterministic, replay-safe, multi-region reconciliation pipeline: stream ledger entries through Kafka, aggregate and deduplicate in a streaming engine keyed by transaction id.

## Technique / Data Structure / Algorithm Used
Exactly-once streaming semantics via Kafka transactions + Flink with idempotent sinks.

## Code
\`\`\`python
import asyncio
import hashlib
\`\`\``;
    assert.equal(detectAndExtractScaffoldMisfire('skill_experience_answer', raw), null, 'sanity: extraction genuinely fails on this shape');
    assert.equal(hasUnrecoveredScaffoldContamination('skill_experience_answer', raw), true);
  });

  test('C12 (rollback-vs-fix-forward): a generic Approach/Key Reasoning/Answer shape with NO coding fingerprint is NOT flagged (mirrors detectAndExtractScaffoldMisfire\'s own conservative null)', () => {
    const raw = `## Approach
- Short explanation of the rollback-vs-fix-forward decision logic in incident command. Tie it to the risk profile under time pressure.

## Key Reasoning
- Reversibility and blast radius drive the call, not ego about the deploy being "probably fine."

## Answer
We rolled back within about two hours once the error budget burn made it clear the deploy was the cause, then root-caused offline instead of debugging live in production.`;
    assert.equal(hasUnrecoveredScaffoldContamination('behavioral_interview_answer', raw), false);
  });

  test('a real answer with a single legitimate O(1) mention (only one heading match, below the 2-heading threshold) is never flagged', () => {
    const raw = `Rate limiting with a token bucket gives you O(1) time complexity per check, since you're just comparing a counter against a threshold and refilling on a timer.`;
    assert.equal(hasUnrecoveredScaffoldContamination('technical_concept_answer', raw), false);
  });

  test('a real, well-formed non-coding answer with no scaffold headings at all is never flagged', () => {
    const raw = `I led the migration of 17 microservices from a monolithic API gateway to Envoy and Istio, owning the SLO framework across the org and publishing an internal RFC that 9 teams adopted in the first quarter.`;
    assert.equal(hasUnrecoveredScaffoldContamination('skill_experience_answer', raw), false);
  });

  test('coding answer types are always excluded (validateAnswerStructure/repairCodingMarkdown own that surface)', () => {
    const raw = `## Approach
Two pointers.

## Technique / Data Structure / Algorithm Used
Two-pointer sliding window.

## Code
\`\`\`python
def f(): pass
\`\`\``;
    assert.equal(hasUnrecoveredScaffoldContamination('coding_question_answer', raw), false);
    assert.equal(hasUnrecoveredScaffoldContamination('dsa_question_answer', raw), false);
  });

  test('a case detectAndExtractScaffoldMisfire successfully recovers (A10 shape) is NOT flagged as unrecovered', () => {
    const raw = `## Approach
Surface the matching real signal from the candidate profile.

## Technique / Data Structure / Algorithm Used
Behavior-grounded answer assembly. No DSA needed for this prompt.

---

Polite opening: I'd love to throw out a range, but I want to make sure I'm doing it the right way for this role.`;
    assert.ok(detectAndExtractScaffoldMisfire('negotiation_answer', raw), 'sanity: extraction succeeds on this shape');
    assert.equal(hasUnrecoveredScaffoldContamination('negotiation_answer', raw), false);
  });

  test('empty/blank answer is never flagged', () => {
    assert.equal(hasUnrecoveredScaffoldContamination('skill_experience_answer', ''), false);
    assert.equal(hasUnrecoveredScaffoldContamination('skill_experience_answer', '   '), false);
  });
});
