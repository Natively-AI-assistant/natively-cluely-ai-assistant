// Campaign 2 longsession run-022/023/024 (2026-07-18): MiniMax-M3
// occasionally answers a NON-coding question using a coding-contract-
// flavored planning scaffold ("## Approach" / "## Technique..." / etc. —
// SHARED_CODING_RULES's headings are unconditionally present in every
// system prompt, regardless of question type) instead of a plain spoken
// answer. validateAnswerStructure deliberately no-ops for non-coding
// answerTypes (it only checks the opposite direction). This tests
// detectAndExtractScaffoldMisfire, the new counterpart that recovers the
// real answer when it's cleanly present after the scaffold.
import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { detectAndExtractScaffoldMisfire } from '../../../dist-electron/electron/llm/index.js';

describe('detectAndExtractScaffoldMisfire — live repros (run-024)', () => {
  test('A10 (salary-expectations): extracts the real answer after a trailing --- separator', () => {
    const raw = `## Approach
Surface the matching real signal from the candidate profile (years of Go, depth on the stack, scale of prior systems) and frame it as the candidate's own answer.

## Technique / Data Structure / Algorithm Used
Behavior-grounded answer assembly. No DSA needed for this prompt.

## Code
Not applicable. This is a live compensation answer, not a coding question.

## Dry Run
Input: Interviewer asks for salary expectations for a senior Go role. Output: a grounded range backed by the candidate's Go depth, system-design readiness, and platform-level ownership experience, with a collaborative close.

## Complexity
Time O(1). Space O(1).

## Interviewer Follow-up Points
- Anchor to band, not single number
- Bridge from seniority signal to comp

---

Polite opening: I'd love to throw out a range, but I want to make sure I'm doing it the right way for this role. Given the seniority signal and what I've shipped, my target sits around the upper band of what a strong senior Go engineer commands here.`;
    const extracted = detectAndExtractScaffoldMisfire('negotiation_answer', raw);
    assert.ok(extracted, 'should extract a real answer, not null');
    assert.match(extracted, /Polite opening/);
    assert.doesNotMatch(extracted, /## Approach/);
    assert.doesNotMatch(extracted, /Time O\(1\)/);
  });

  test('C12 (rollback-vs-fix-forward): returns null — no coding-scaffold fingerprint, must not guess', () => {
    // Code-review 2026-07-18 HIGH fix: C12's heading set (Approach/Key
    // Reasoning/Answer) has NO coding-scaffold-specific fingerprint
    // ("Technique / Data Structure / Algorithm Used", "Dry Run", or Big-O
    // notation) — the SAME generic heading shape a real, deliberately-
    // structured non-coding answer could legitimately use (see the
    // false-positive guards below). Extracting here would require
    // guessing which "Approach/X/Answer"-shaped text is a misfire and
    // which is real structure — deliberately conservative: this case is
    // now a documented, accepted gap (was extracted pre-fix; the fix
    // trades recovering this one shape for never wrongly truncating a
    // real answer with the same shape).
    const raw = `## Approach
- Short explanation of the rollback-vs-fix-forward decision logic in incident command. Tie it to the risk profile under time pressure.

## Key Reasoning
- The deciding factors were blast radius, time-to-known-good, and reversibility confidence.

## Answer (spoken, ~22s)
The call came down to reversibility and time to known-good. With an unknown root cause on a write path already failing across regions, fix-forward meant betting our hypothesis was right on the first try.`;
    const extracted = detectAndExtractScaffoldMisfire('general_meeting_answer', raw);
    assert.equal(extracted, null);
  });

  test('A17 (raft-vs-paxos alternatives): returns null — no clean split, must not guess', () => {
    const raw = `## Approach
- The interviewer is probing the decision rationale behind Raft/gRPC, not asking for a definition.

## Technique / Data Structure / Algorithm Used
- Consensus protocols: Raft vs Paxos vs Zab vs leader-election-only.

## Key Talking Points (speak naturally, not as bullets)

Alternatives considered:
- Multi-Paxos, more expressive but notoriously harder to implement correctly.

## Interviewer Follow-up Points
- How did you size the lease interval relative to election timeout?`;
    const extracted = detectAndExtractScaffoldMisfire('general_meeting_answer', raw);
    assert.equal(extracted, null, 'must not guess when there is no clean final-answer marker');
  });
});

describe('detectAndExtractScaffoldMisfire — false-positive guards', () => {
  test('a normal prose answer with no headings is never touched', () => {
    const raw = "I owned the payments orchestration platform at Stripe, which sat between our internal services and the card networks.";
    assert.equal(detectAndExtractScaffoldMisfire('experience_answer', raw), null);
  });

  test('an answer that mentions "approach" as a word, not a heading, is never touched', () => {
    const raw = 'My approach to system design has always been to start with the failure modes first, then work backward to the happy path.';
    assert.equal(detectAndExtractScaffoldMisfire('jd_fit_answer', raw), null);
  });

  test('a single markdown heading (not a scaffold pattern) is never touched', () => {
    const raw = '## Summary\nI led the migration project end to end.';
    assert.equal(detectAndExtractScaffoldMisfire('general_meeting_answer', raw), null);
  });

  test('a bulleted answer with no headings is never touched', () => {
    const raw = '- Led the incident response\n- Coordinated with 3 teams\n- Resolved in under 2 hours';
    assert.equal(detectAndExtractScaffoldMisfire('behavioral_interview_answer', raw), null);
  });

  test('a genuine coding-type answer is NEVER touched by this function (that is validateAnswerStructure\'s job)', () => {
    const raw = `## Approach
Use two pointers.

## Technique / Data Structure / Algorithm Used
Two pointer.

## Code
\`\`\`python
def f(): pass
\`\`\`

## Dry Run
walk through it

## Complexity
O(n)

## Interviewer Follow-up Points
none`;
    assert.equal(detectAndExtractScaffoldMisfire('dsa_question_answer', raw), null);
    assert.equal(detectAndExtractScaffoldMisfire('coding_question_answer', raw), null);
  });

  test('empty/whitespace-only input returns null, not a crash', () => {
    assert.equal(detectAndExtractScaffoldMisfire('general_meeting_answer', ''), null);
    assert.equal(detectAndExtractScaffoldMisfire('general_meeting_answer', '   \n  '), null);
  });

  test('a single heading followed by a trailing --- is not extracted (needs >=2 headings)', () => {
    const raw = '## Approach\nSome coaching text.\n\n---\n\nThe real answer goes here and is reasonably long.';
    assert.equal(detectAndExtractScaffoldMisfire('general_meeting_answer', raw), null);
  });

  test('a trailing --- with only a short/trivial tail is not extracted', () => {
    const raw = '## Approach\nSome text.\n\n## Technique\nMore text.\n\n---\n\nOK.';
    assert.equal(detectAndExtractScaffoldMisfire('general_meeting_answer', raw), null);
  });
});

// ── Code-review 2026-07-18 HIGH fix: the first draft's ≥2-generic-heading
//    trigger was NOT a strong enough signal — a skeptic pass constructed 4
//    plausible, real, substantive non-coding answers (negotiation framing,
//    experience narrative, behavioral narrative, document-grounded lecture
//    answer) that would have had real content silently and unrecoverably
//    discarded. Fixed by requiring a coding-scaffold-specific fingerprint
//    (a near-unique heading like "Technique / Data Structure / Algorithm
//    Used" or "Dry Run", or explicit Big-O/complexity notation) in the
//    discarded portion before extracting — a generic Approach/Code/
//    Complexity/Answer heading pair alone no longer triggers. These 4
//    repro strings are exactly what the reviewer constructed; all must
//    survive untouched. ───────────────────────────────────────────────────
describe('detectAndExtractScaffoldMisfire — code-review false-positive repros (must all survive)', () => {
  test('negotiation framing content is not discarded (generic Approach/Answer headings only)', () => {
    const raw = `## Approach
I like to negotiate collaboratively rather than adversarially — starting from shared goals before diving into numbers.

## Answer
Given my 6 years of backend experience and the scope of this senior role, I'd target the top of the band, around $185k base with standard equity refresh, open to adjusting based on total comp structure.`;
    assert.equal(detectAndExtractScaffoldMisfire('negotiation_answer', raw), null);
  });

  test('experience talking points are not discarded (generic heading only, no coding fingerprint)', () => {
    const raw = `## Key Talking Points (speak naturally, not as bullets)
I led the migration from a monolith to 12 services over 14 months, cut deploy time from 45 minutes to under 5, and mentored 2 juniors onto the platform team during the transition — that's the story I'd lead with here.

## Answer
So overall, yes, I have direct large-scale migration experience.`;
    assert.equal(detectAndExtractScaffoldMisfire('experience_answer', raw), null);
  });

  test('behavioral narrative before a stylistic --- is not discarded (Approach/Code headings, no coding fingerprint)', () => {
    const raw = `## Approach
When I inherited the on-call rotation, I first audited who was paged the most and why, before changing anything.

## Code
I also insisted every fix that came out of an incident got landed in code within 48 hours, not just documented in the postmortem.

---

That combination — data-driven audit plus a hard 48-hour code-fix SLA — cut our repeat-incident rate by more than half in two quarters.`;
    assert.equal(detectAndExtractScaffoldMisfire('behavioral_interview_answer', raw), null);
  });

  test('document-grounded lecture answer echoing a paper\'s own section names is not discarded', () => {
    const raw = `## Approach
The paper's Section 3 (titled 'Approach') describes a two-stage training pipeline...

## Code
Section 4 states the reference implementation is released at github.com/example/repo...

---

Those two sections directly answer what the paper describes as its core contribution.`;
    assert.equal(detectAndExtractScaffoldMisfire('lecture_answer', raw), null);
  });

  test('a genuine coding-scaffold-fingerprinted misfire (Dry Run + Big-O) still extracts correctly', () => {
    // Sanity check the fingerprint gate doesn't over-correct into never
    // firing — A10's real repro (full rigid contract) must still work.
    const raw = `## Approach
Some coaching text about framing the answer.

## Technique / Data Structure / Algorithm Used
Behavior-grounded answer assembly. No DSA needed for this prompt.

## Dry Run
Input: a compensation question. Output: a grounded range.

## Complexity
Time O(1). Space O(1).

---

This is the real spoken answer that should be recovered in full, since the discarded head clearly has coding-scaffold vocabulary.`;
    const extracted = detectAndExtractScaffoldMisfire('negotiation_answer', raw);
    assert.ok(extracted, 'should still extract when a real coding fingerprint is present');
    assert.match(extracted, /real spoken answer/);
  });
});

// ── run-026 finding: C15 has the exact same "fingerprinted scaffold, then a
//    clean final answer" shape Pattern A/B already recover, but the model
//    used a BOLD-TEXT marker ("**Direct Answer:**") for the final section
//    instead of another "## " heading, so neither Pattern A (no trailing
//    ---) nor Pattern B (no matching heading) fired. Pattern C recognizes
//    this markup variant while requiring the exact same fingerprint gate. ──
describe('detectAndExtractScaffoldMisfire — Pattern C: bold-text final-answer marker (run-026 C15)', () => {
  test('C15 (mentoring/closing question): extracts the real answer under a bold "**Direct Answer:**" marker', () => {
    const raw = `## Approach
- Walk through the replacement reconciliation system: streaming pipeline over Kafka + Flink replacing a Hadoop batch job.

## Technique / Data Structure / Algorithm Used
- Stream processing with exactly-once semantics, windowed aggregations, idempotent sinks keyed off ledger entry IDs.

## Code
\`\`\`python
class ReconciliationProcessor:
    def process(self, entries):
        pass
\`\`\`

## Dry Run
- Entry arrives, hash computed, lookup performed, discrepancy emitted if amounts differ.

## Complexity
- Time Complexity: O(n) over the entry stream.
- Space Complexity: O(u) where u is the count of unique entries.

## Interviewer Follow-up Points
- How do you bound memory across a multi-day window?

**Direct Answer:**
I owned the design and rollout of a streaming reconciliation pipeline on Kafka and Flink that processes 4.2 billion ledger entries a day, replacing a legacy Hadoop batch job. End-to-end p99 latency came down from 14 hours to about 38 minutes.`;
    const extracted = detectAndExtractScaffoldMisfire('experience_answer', raw);
    assert.ok(extracted, 'should extract the real answer, not null');
    assert.match(extracted, /streaming reconciliation pipeline on Kafka and Flink/);
    assert.doesNotMatch(extracted, /## Approach/);
    assert.doesNotMatch(extracted, /## Technique/);
    assert.doesNotMatch(extracted, /\*\*Direct Answer:\*\*/);
  });

  test('a bold marker without the coding fingerprint in the head is not extracted', () => {
    const raw = `**My Approach:**
I would negotiate collaboratively rather than adversarially.

**My Answer:**
I would target the top of the band given my experience and the scope of this role.`;
    assert.equal(detectAndExtractScaffoldMisfire('negotiation_answer', raw), null);
  });

  test('a legitimate answer that merely bolds the word "answer" for emphasis is never touched', () => {
    const raw = 'I think the **answer** here is that communication matters more than perfect code, and that is the lesson I carry into every incident review.';
    assert.equal(detectAndExtractScaffoldMisfire('behavioral_interview_answer', raw), null);
  });

  // ── Code-review 2026-07-18 HIGH fix: the first draft's bold-marker regex
  //    matched ANY bold text merely CONTAINING "answer" anywhere, no closed
  //    vocabulary (unlike Pattern B's heading match, which can only match
  //    SCAFFOLD_MISFIRE_HEADING_RE's short fixed word list). A skeptic pass
  //    proved a real answer's own internal bold rhetorical aside
  //    ("**So what was the answer that finally worked?**") would silently
  //    discard everything before it — genuine narrative content, not
  //    scaffold — since the true earlier scaffold still satisfies the
  //    fingerprint gate regardless of where the wrong split point lands.
  //    Fixed by restricting the marker to a closed set of short, label-
  //    shaped phrasings (mirroring Pattern B's own discipline exactly). ────
  test('a real answer containing its own internal bold rhetorical aside mentioning "answer" is never truncated', () => {
    const raw = `## Approach
Frame this around ownership and de-escalation.

## Dry Run
Input: conflict with a peer. Output: resolution timeline. O(1) extra steps needed.

When my teammate and I disagreed on the rollout strategy, I first made sure I understood their concern fully before pushing back, since I have found most conflicts are really about unstated risk tolerance.

**So what was the answer that finally worked?**
We agreed to a canary rollout with an automatic rollback trigger, which satisfied their risk concern and my speed concern at the same time.`;
    assert.equal(detectAndExtractScaffoldMisfire('behavioral_interview_answer', raw), null);
  });

  test('a bold marker matching only via a substring ("Unanswered", not "Answer") is never treated as a final-answer marker', () => {
    const raw = `## Approach
Some coaching text.

## Dry Run
step by step trace. O(1) time.

**Still Unanswered Questions:**
This part should never be treated as the real final answer.`;
    assert.equal(detectAndExtractScaffoldMisfire('behavioral_interview_answer', raw), null);
  });
});
