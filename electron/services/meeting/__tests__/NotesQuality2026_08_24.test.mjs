import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const base = path.resolve(__dirname, '../../../../dist-electron/electron/services/meeting');
const { similar, MeetingSummaryReducer } = await import(pathToFileURL(path.join(base, 'MeetingSummaryReducer.js')).href);
const { TranscriptNormalizer } = await import(pathToFileURL(path.join(base, 'TranscriptNormalizer.js')).href);
const { newSignificantTokens } = await import(pathToFileURL(path.join(base, 'SummaryPolisher.js')).href);
const { buildChunkPrompt } = await import(pathToFileURL(path.join(base, 'ChunkSummaryGenerator.js')).href);
const { MeetingSummarySchemaValidator } = await import(pathToFileURL(path.join(base, 'MeetingSummarySchemaValidator.js')).href);

// The old rule was `shared / min(wordCount) >= 0.8` — pure subset containment — so a short
// vague bullet always matched a longer specific one, and mergeSimilar kept the FIRST-seen
// text. Every pair below was reproduced collapsing on 2026-08-24.
//
// The early/middle/late row below is NOT a vague/specific pair — it is three chunk-scoped
// decisions that differ by a single distinguishing word. It was added on fix round 1 because
// Dice 0.7 scored this pair 0.750 and merged them, destroying chunk coverage (regression
// caught by MeetingSummaryPipeline.test.mjs "long transcript chunker preserves early middle
// and late coverage"). It is the reason SIMILARITY_DICE_THRESHOLD must stay above 0.75 — see
// MeetingSummaryReducer.ts.
const MUST_STAY_DISTINCT = [
  ['Security review is required', 'Security review is required before the pilot can start, and legal must sign the DPA'],
  ['Pricing was discussed', 'Pricing was discussed and they pushed back hard on the per-seat model above 200 seats'],
  ['Ari will send the packet', 'Ari will send the SOC2 packet to procurement on Friday'],
  ['Team is blocked', 'Team is blocked on the vendor API keys until Thursday'],
  ['Candidate has React experience', 'Candidate has five years of React experience at a fintech scale-up'],
  ['Decision from early meeting segment', 'Decision from middle meeting segment'],
];

// Chunk overlap genuinely restates the same point; those must still collapse or the notes
// read duplicated. These are rewordings of equal weight, not a vague/specific pair.
//
// Deliberately NOT covered here: paraphrase-level restatements (e.g. "Ari will send the SOC2
// packet by Friday" vs "Ari sends the SOC2 packet on Friday", Dice 0.727) are NOT guaranteed
// to merge at threshold 0.8. That row was removed on fix round 1 — it conflicted with the
// early/middle/late constraint above (no single scalar threshold can keep 0.750 distinct and
// merge 0.727). Between under-merging a paraphrase (one extra near-duplicate bullet) and
// over-merging chunk-scoped decisions (destroyed coverage), under-merging is the correct
// failure direction for a fix whose purpose is "notes are too thin".
//
// IMPORTANT — the first two rows below are VACUOUS with respect to the Dice/length-ratio
// code this task changed: both pairs normalize to IDENTICAL strings (stopword/punctuation
// stripping erases the only difference), so both hit the `na === nb` fast path in similar()
// and never reach the Dice computation at all. They would still pass if the entire Dice
// branch were deleted, inverted, or set to an unreachable threshold. The third row is the
// table's ONLY real assertion about the Dice merge path: it is a genuine reworded
// restatement (differs by one non-stopword, "finish" vs "complete"), so normalize() leaves
// it non-identical and it must clear the Dice threshold (0.857 >= 0.8) to merge. Do not
// remove it when "simplifying" this table — that would silently restore the vacuum.
const MUST_MERGE = [
  ['Use PostHog for analytics', 'Use PostHog for analytics.'],
  ['Pilot scope moves forward with security review', 'Pilot scope moves forward with a security review'],
  ['Security review must finish before the pilot starts', 'Security review must complete before the pilot starts'],
];

test('similar() does not collapse a specific bullet into a vague one', () => {
  for (const [vague, specific] of MUST_STAY_DISTINCT) {
    assert.equal(similar(vague, specific), false,
      `these are different points and must both survive:\n  "${vague}"\n  "${specific}"`);
  }
});

test('similar() still collapses genuine restatements', () => {
  for (const [a, b] of MUST_MERGE) {
    assert.equal(similar(a, b), true, `these are the same point and must merge:\n  "${a}"\n  "${b}"`);
  }
});

test('when two items merge, the richer text wins', () => {
  const normalized = new TranscriptNormalizer().normalize([
    { speaker: 'Ari', text: 'We will send the packet.', timestamp: 0, final: true },
    { speaker: 'Bo', text: 'Agreed.', timestamp: 1000, final: true },
    { speaker: 'Ari', text: 'By Friday.', timestamp: 2000, final: true },
  ]);
  const evidence = [{ speakerName: 'Ari', timestampMs: 0, quote: 'we will send the packet' }];
  const atom = (chunkIndex, text) => ({
    chunkIndex,
    timeRange: { startMs: chunkIndex * 1000, endMs: chunkIndex * 1000 + 999 },
    brief: 'packet discussion',
    topics: ['packet'], decisions: [], openQuestions: [], risks: [], deadlines: [],
    people: [], importantQuotes: [], modeSpecificFindings: {},
    actionItems: [{ text, owner: 'Ari', explicitness: 'explicit', evidence, confidence: 'high' }],
  });

  // The terse phrasing arrives FIRST; the richer one must still be what survives.
  const summary = new MeetingSummaryReducer().reduce({
    title: 'packet',
    atoms: [atom(0, 'Ari will send the SOC2 packet'), atom(1, 'Ari will send the SOC2 packet by Friday')],
    normalizedTranscript: normalized,
    modeTemplateType: 'general',
    modeNoteSections: [],
  });

  assert.equal(summary.actionItems.length, 1, 'the restatement should still merge');
  assert.match(summary.actionItems[0].text, /by Friday/,
    `the richer text must win, got: "${summary.actionItems[0].text}"`);
});

test('when two mode-section findings merge, the richer text wins (buildSections, not just mergeSimilar)', () => {
  // mergeSimilar (decisions/actionItems/openQuestions/risks) was fixed to keep the longer
  // text on a merge. buildSections — the path that fills `summary.sections`, i.e. the actual
  // notes body — has its OWN similar-bullet merge logic and was not fixed: it used
  // `if (... || section.bullets.some(...)) continue`, which always keeps whichever finding
  // arrived first and silently drops the newcomer, richer or not. Chunk 0 always arrives
  // first, so this is live for exactly the bullets that make up the rendered notes.
  const normalized = new TranscriptNormalizer().normalize([
    { speaker: 'Ari', text: 'We will send the packet.', timestamp: 0, final: true },
  ]);
  const atom = (chunkIndex, text) => ({
    chunkIndex,
    timeRange: { startMs: chunkIndex * 1000, endMs: chunkIndex * 1000 + 999 },
    brief: 'packet discussion',
    topics: ['packet'], decisions: [], openQuestions: [], risks: [], deadlines: [],
    actionItems: [], people: [], importantQuotes: [],
    modeSpecificFindings: {
      'Pain points': [{ text, evidence: [], confidence: 'high' }],
    },
  });

  const summary = new MeetingSummaryReducer().reduce({
    title: 'packet',
    atoms: [
      atom(0, 'Ari will send the SOC2 packet'),
      atom(1, 'Ari will send the SOC2 packet by Friday'),
    ],
    normalizedTranscript: normalized,
    modeTemplateType: 'sales',
    modeNoteSections: [{ title: 'Pain points', description: 'customer pain' }],
  });

  const section = summary.sections.find(s => s.title === 'Pain points');
  assert.ok(section, 'the Pain points section should exist');
  assert.equal(section.bullets.length, 1, 'the restatement should still merge into one bullet');
  assert.match(section.bullets[0].text, /by Friday/,
    `the richer text must win in buildSections, got: "${section.bullets[0].text}"`);
});

test('a section that exceeds the bullet cap truncates AND warns loudly (not silently), through the real validated path', () => {
  // The old cap was 20 — written back when sections yielded 1-3 bullets per chunk. At the
  // new 5-12-findings-per-section-per-chunk density contract, a well-covered section across
  // 4-10 chunks legitimately produces 20-120 bullets, so the old cap bound on every dense
  // meeting and silently deleted the back half of that section with zero warning anywhere.
  // The cap must now sit far above realistic density (asserted here by exceeding it with
  // distinct findings), and firing it must leave a trace in sourceQuality.warnings.
  //
  // IMPORTANT (I2c, 2026-08-24 residual review): a prior version of this test asserted only
  // against `new MeetingSummaryReducer().reduce(...)`'s raw output. That is NOT the path that
  // ships — `MeetingContextAssembler.assembleSummary` always runs the reduced summary through
  // `MeetingSummarySchemaValidator.validateAndRepairSummary` before returning/persisting it,
  // and that validator's own `sanitizeSections` -> `sanitizeBullets` call applies ITS OWN
  // per-section bullet cap. A prior fix wave raised only the reducer's cap (to 500), leaving
  // the validator's cap at the old, unrelated value of 30 — the reducer-only test stayed green
  // while production still truncated every section at 30. This test now asserts on the
  // VALIDATED output (mirroring the real pipeline), so a cap mismatch between the two layers
  // fails here.
  const normalized = new TranscriptNormalizer().normalize([
    { speaker: 'Ari', text: 'Talking.', timestamp: 0, final: true },
  ]);
  const BULLET_COUNT = 505; // comfortably above any realistic per-section density
  const atoms = [];
  for (let i = 0; i < BULLET_COUNT; i++) {
    atoms.push({
      chunkIndex: i,
      timeRange: { startMs: i * 1000, endMs: i * 1000 + 999 },
      brief: `finding ${i}`,
      topics: [], decisions: [], openQuestions: [], risks: [], deadlines: [],
      actionItems: [], people: [], importantQuotes: [],
      modeSpecificFindings: {
        // Five shared non-stopword tokens ("customer raised concern about workstream") plus
        // FOUR per-item distinguishing tokens (case/phase/batch/code, each suffixed with i).
        // Word-set size is 9/9, shared is 5 -> Dice = 2*5/18 = 0.556 -- far below the 0.8
        // merge threshold with real margin. The PREVIOUS fixture used only two distinguishing
        // numbers appended to six shared words (8/8 words, 6 shared -> Dice 0.75 against a
        // 0.80 threshold): one extra shared word anywhere would have tipped it to 0.875 and
        // collapsed every finding into a single bullet, failing this test for an unrelated
        // reason. This fixture is robustly dissimilar instead of skimming the threshold.
        Notes: [{ text: `Customer raised concern about workstream case${i} phase${i} batch${i} code${i}`, evidence: [], confidence: 'high' }],
      },
    });
  }

  const reduced = new MeetingSummaryReducer().reduce({
    title: 'dense meeting',
    atoms,
    normalizedTranscript: normalized,
    modeTemplateType: 'general',
    modeNoteSections: [{ title: 'Notes', description: 'general notes' }],
  });

  // Sanity check on the reducer's own (non-binding-in-production) output first.
  const reducedSection = reduced.sections.find(s => s.title === 'Notes');
  assert.ok(reducedSection, 'the Notes section should exist in the reducer output');
  assert.ok(reducedSection.bullets.length > 30, 'the reducer output must exceed the old, wrong 30-bullet cap');
  assert.ok(reducedSection.bullets.length < BULLET_COUNT, 'the reducer-level cap must still bind on a pathological input');

  // The path that actually ships: run the reduced summary through the schema validator, exactly
  // as MeetingContextAssembler.assembleSummary does before persisting/rendering/feeding
  // FollowUpDraftGenerator.
  const validated = new MeetingSummarySchemaValidator().validateAndRepairSummary(reduced);
  assert.ok(validated, 'validateAndRepairSummary should accept this summary');
  const section = validated.sections.find(s => s.title === 'Notes');
  assert.ok(section, 'the Notes section should survive validation');
  assert.equal(section.bullets.length, reducedSection.bullets.length,
    `the validator must not re-truncate below the reducer's own cap; reducer kept ${reducedSection.bullets.length}, validator kept ${section.bullets.length}`);
  assert.ok(section.bullets.length > 30, 'the VALIDATED (shipped) output must exceed the old, wrong 30-bullet cap');

  const dropped = BULLET_COUNT - reducedSection.bullets.length;
  const warning = validated.sourceQuality.warnings.find(w => w.includes('Notes') && w.includes(String(dropped)));
  assert.ok(warning, `expected the truncation warning to survive validation and name the section + drop count (${dropped}), got: ${JSON.stringify(validated.sourceQuality.warnings)}`);
});

const GROUNDED = `Summary points:
- Ari: send the SOC2 packet by Friday
- Pilot scope moves forward with security review

Decisions:
- Pilot scope moves forward with security review

Section notes:
- Manual QA reporting takes two days each week
- Security review is required before pilot`;

// The gate exempted sentence-initial capitalisation only for the FIRST token of the whole
// output, so any sentence after the first that opened with a capitalised non-stopword was
// scored as an invented proper noun and killed the entire rewrite. The prompt asks for 3-5
// sentences, so this fired constantly. Reproduced 2026-08-24.
test('polish gate accepts sentence-initial connectives', () => {
  const accepted = [
    'Pilot scope moves forward with security review. However, security review is required before pilot.',
    'Pilot scope moves forward with security review. Additionally, manual QA reporting takes two days each week.',
    'Manual QA reporting takes two days each week. Overall, pilot scope moves forward with security review.',
    'Ari will send the SOC2 packet by Friday. Meanwhile, security review is required before pilot.',
  ];
  for (const text of accepted) {
    assert.deepEqual(newSignificantTokens(text, GROUNDED), [],
      `an ordinary sentence opener was scored as a hallucinated proper noun: "${text}"`);
  }
});

test('polish gate still rejects genuinely invented facts', () => {
  const rejected = [
    ['Pilot scope moves forward with security review at Acme.', 'Acme'],
    ['Ari will send the SOC2 packet by Friday to 47 reviewers.', '47'],
    ['Security review is required before pilot, per Deloitte.', 'Deloitte'],
  ];
  for (const [text, offender] of rejected) {
    const found = newSignificantTokens(text, GROUNDED);
    assert.ok(found.includes(offender),
      `"${offender}" is not in the notes and must be rejected; got ${JSON.stringify(found)}`);
  }
});

// KNOWN, ACCEPTED LIMITATION (ruled 2026-08-24): the position-plus-capitalisation heuristic
// exempts capitalisation at the start of EVERY sentence, not just the very first token of the
// whole output. That means a hallucinated proper noun that opens a non-first sentence is
// structurally invisible to the gate: `isFirstWord` forces `isProperNoun` false, and the token
// is then dropped by the `!isNumberLike && !isCalendar && !isProperNoun` continue before it
// ever reaches the grounded-set check. The alternative — a closed list of discourse
// connectives — was rejected: it would silently re-reject legitimate sentence openers outside
// the list ("Both sides agreed…", "Discussion focused…", "Participants raised…"), reintroducing
// the exact RC-3 bug intermittently. This test documents the gap; it does NOT assert that
// fabrication is caught here. If this test starts failing, the heuristic has been tightened —
// that is a deliberate behaviour change to think about, not a break to paper over.
test('KNOWN LIMITATION: a hallucinated proper noun opening a non-first sentence is not flagged', () => {
  const sentenceInitial = 'Pilot scope moves forward with security review. Acme said the deal closes Friday.';
  assert.deepEqual(newSignificantTokens(sentenceInitial, GROUNDED), [],
    'documents the accepted gap: sentence-initial hallucinations are invisible to this heuristic');

  // Contrast: the same fabricated token IS caught once it is not sentence-initial — this is
  // what makes the assertion above meaningful rather than vacuous.
  const midSentence = 'Pilot scope moves forward with security review at Acme.';
  assert.ok(newSignificantTokens(midSentence, GROUNDED).includes('Acme'),
    'sanity check: Acme must still be caught when not sentence-initial, or the test above is vacuous');
});

// FIX regression guard: `atSentenceStart` must advance BEFORE the stopword / punctuation-only /
// non-fact-shaped `continue`s inside the loop, or a skipped token leaves it stale for the next
// real token and silently reintroduces the RC-3 bug for the sentence that follows. Both a
// stopword-terminated sentence and a sentence separated by a standalone punctuation-only token
// are covered, so a future reordering of the checks inside the loop is caught here instead of
// in production.
test('sentence-boundary flag survives a trailing stopword and a trailing punctuation-only token', () => {
  const trailingStopword =
    'Pilot scope moves forward with it. However, security review is required before pilot.';
  assert.deepEqual(newSignificantTokens(trailingStopword, GROUNDED), [],
    'a legitimate opener after a stopword-terminated sentence must stay exempt');

  const trailingPunctuationOnlyToken =
    'Pilot scope moves forward with security review. ... Additionally, manual QA reporting takes two days each week.';
  assert.deepEqual(newSignificantTokens(trailingPunctuationOnlyToken, GROUNDED), [],
    'a legitimate opener after a standalone punctuation-only token must stay exempt');
});

test('chunk prompt states a density target and keeps evidence where it matters', () => {
  const { systemPrompt, jsonShapeHint } = buildChunkPrompt({
    chunk: { chunkIndex: 0, timeRange: { startMs: 0, endMs: 60000 }, text: 'x', charCount: 1 },
    totalChunks: 3,
    modeTemplateType: 'sales',
    modeNoteSections: [{ title: 'Pain points', description: 'customer pain' }],
  });

  // Density is the whole point: an unstated target plus heavy suppression pressure is why
  // sections came back with 1-3 terse bullets for an hour of conversation.
  assert.match(systemPrompt, /5-12 findings per section/i, 'no explicit density target');
  // Pin the SUBSTANCE of the precision clause, not just the phrase "PRECISION rule" — a
  // softened rewrite like "PRECISION rule, so when in doubt, omit" would reinstate recall
  // suppression while still matching a bare /PRECISION rule/i check.
  assert.match(
    systemPrompt,
    /PRECISION rule about fabrication[\s\S]*?NOT a licence to omit material that was genuinely discussed/i,
    'the empty-is-better rule is not scoped to precision, or has been softened back into a recall ceiling'
  );

  // Evidence stays mandatory where it powers jump-to-timestamp, optional where its cost
  // suppresses bullet count -- and that policy must agree everywhere the prompt mentions
  // evidence for a section finding, not only in the "ALSO extract" line. Two other spots in
  // this same prompt (the primary-task preamble and the findingShape JSON template) used to
  // state or imply evidence was unconditional, out-voting the new best-effort line 2-to-1.
  assert.match(systemPrompt, /evidence is REQUIRED for decisions and actionItems/i);
  assert.match(systemPrompt, /best-effort for section findings/i);
  // Pin the SUBSTANCE (the preamble sentence describing a finding object must itself mark
  // evidence best-effort/optional), not one exact wrong phrasing — a prior version of this
  // check only forbade the literal string `object with "text" and "evidence"`, so a
  // reworded regression like `object with "text" plus "evidence"` (still unconditional)
  // would have slipped straight through it.
  const findingPreamble = systemPrompt.match(/Each finding is an object with[\s\S]*?\./i);
  assert.ok(findingPreamble, 'could not locate the primary-task preamble sentence describing a section finding object');
  assert.match(
    findingPreamble[0],
    /best-effort|optional/i,
    'the primary-task preamble still presents evidence as an unconditional part of a section finding'
  );
  // The optionality statement belongs in prose the model reads as an INSTRUCTION, not
  // inside jsonShapeHint — the model is told to "Return exactly this JSON shape", so any
  // sentence living in a shape VALUE risks being copied verbatim into a real bullet's
  // evidence.quote. Assert it lives in systemPrompt and NOT in jsonShapeHint.
  assert.match(
    systemPrompt,
    /OPTIONAL[:\s].*omit the entire ["']?evidence["']? key/i,
    'the optionality statement for the evidence key is missing from the prompt prose'
  );
  assert.doesNotMatch(
    jsonShapeHint,
    /OPTIONAL[:\s].*omit the entire/i,
    'the optionality statement leaked back into jsonShapeHint, where a model could copy it into a real quote'
  );
});
