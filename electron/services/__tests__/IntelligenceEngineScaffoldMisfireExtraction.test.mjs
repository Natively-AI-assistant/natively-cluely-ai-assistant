// Campaign 2 longsession run-024 (2026-07-18): a live-path integration test
// for detectAndExtractScaffoldMisfire, wired into IntelligenceEngine.ts
// right after validateAnswerStructure. Confirms the extraction actually
// reaches the user on the live WTA path, not just the pure function.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enginePath = path.resolve(__dirname, '../../../dist-electron/electron/IntelligenceEngine.js');
const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
const require = createRequire(import.meta.url);

function makeHelper() {
  return {
    setNegotiationCoachingHandler() {},
  };
}

async function makeEngineWithAnswer(chunks, { question } = {}) {
  const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
  const { SessionTracker } = require(sessionPath);
  const session = new SessionTracker();

  session.addTranscript({
    speaker: 'system',
    text: question || "Good, now let's discuss compensation — what are your salary expectations for this role?",
    timestamp: Date.now(),
    final: true,
  });

  const engine = new IntelligenceEngine(makeHelper(), session);
  engine.whatToAnswerLLM = {
    async *generateStream() {
      for (const chunk of chunks) yield chunk;
    },
  };

  return { engine, session };
}

const A10_RAW_SCAFFOLD = `## Approach
Surface the matching real signal from the candidate profile and frame it as the candidate's own answer.

## Technique / Data Structure / Algorithm Used
Behavior-grounded answer assembly. No DSA needed for this prompt.

## Code
Not applicable. This is a live compensation answer, not a coding question.

## Dry Run
Input: Interviewer asks for salary expectations. Output: a grounded range.

## Complexity
Time O(1). Space O(1).

## Interviewer Follow-up Points
- Anchor to band, not single number

---

Polite opening: I'd love to throw out a range, but I want to make sure I'm doing it the right way for this role.`;

test('a scaffold-misfired negotiation answer ships the extracted real answer, not the raw scaffold', async () => {
  const { engine, session } = await makeEngineWithAnswer([A10_RAW_SCAFFOLD]);
  const finals = [];
  engine.on('suggested_answer', answer => finals.push(answer));

  const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

  // A downstream cleanup pass (unrelated to this fix, e.g. answerPolish.ts's
  // stripMetaPreamble) strips a generic leading phrase like "Polite opening:
  // " between the emitted event and the returned value — assert on the
  // substantive content and the ABSENCE of scaffold headings in both, not
  // exact string equality between `finals` and `answer`.
  assert.match(answer, /love to throw out a range/);
  assert.doesNotMatch(answer, /## Approach/);
  assert.doesNotMatch(answer, /Time O\(1\)/);
  assert.equal(finals.length, 1);
  assert.match(finals[0], /love to throw out a range/);
  assert.doesNotMatch(finals[0], /## Approach/);
  assert.doesNotMatch(finals[0], /Time O\(1\)/);
  assert.equal(
    session.getFullTranscript().some(segment => segment.text.includes('## Approach')),
    false,
    'the raw scaffold headings must never reach session history',
  );
});

test('a real, unscaffolded answer is never touched by the extraction guard', async () => {
  const realAnswer = "I owned the payments orchestration platform at Stripe, which sat between our internal services and the card networks.";
  const { engine } = await makeEngineWithAnswer([realAnswer]);
  const finals = [];
  engine.on('suggested_answer', answer => finals.push(answer));

  const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

  assert.equal(answer, realAnswer);
  assert.deepEqual(finals, [realAnswer]);
});

// ── Code-review 2026-07-18 MEDIUM fix: technical_concept_answer,
//    system_design_answer, and debugging_question_answer are excluded from
//    scaffold-misfire extraction entirely (a call-site Set, in addition to
//    isCodingAnswerType's own exclusion) — the "coding-scaffold fingerprint"
//    (Big-O notation, "Dry Run") is native, legitimate vocabulary for these
//    three types (a real answer to "explain Big-O" genuinely discusses
//    complexity as its subject, not as a scaffold leak), so extraction must
//    never run on them regardless of how confident detectAndExtractScaffold
//    Misfire's own heuristic is. ─────────────────────────────────────────
test('a real technical_concept_answer discussing genuine Big-O content is NEVER touched, even with scaffold-shaped headings', async () => {
  const raw = `## Approach
The idea is to talk through Big-O informally first, then get precise.

## Complexity
Big-O describes the upper bound on how an algorithm's runtime or space grows as input size increases. O(1) is constant, O(log n) is logarithmic, O(n) is linear, O(n log n) is typical for good sorts, and O(n^2) usually means nested loops over the same input.

---

That's the mental model I use when I'm sizing up a new algorithm at a glance.`;
  const { engine } = await makeEngineWithAnswer([raw], { question: 'Can you explain Big-O notation to me?' });
  const finals = [];
  engine.on('suggested_answer', answer => finals.push(answer));

  const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

  // The full explanation must survive — NOT be truncated down to the
  // closing sentence, which is what scaffold extraction would otherwise do.
  // (An unrelated downstream cosmetic pass may strip a bare trailing `---`
  // line — assert on substantive content surviving, not exact string
  // equality, matching this file's other tests.)
  assert.match(answer, /upper bound on how an algorithm/);
  assert.match(answer, /mental model I use/);
  assert.equal(finals.length, 1);
  assert.match(finals[0], /upper bound on how an algorithm/);
});
