// A screen line in the RING must not rewrite the absence narrative of an
// unrelated later turn (2026-09-04).
//
// Two defects, one seam. Both make a turn whose own evidence was never touched
// carry copy about material that was — and both are reachable with an ordinary
// screenshot two turns back.
//
//   1. engine-bridge folds a CONVERSATION-ring withholding into the EVIDENCE
//      withholding set (`withheldScopes.add('screenshots')`). That set means
//      "this turn's evidence was filtered", and three consumers read it that
//      way: absenceContract() returns '' on any withholding, the
//      privacy-withholding notice PRE-EMPTS noEvidenceNotice entirely, and the
//      PARTIAL notice fires about evidence that was never filtered. The turn is
//      told to say the answer cannot be given because the Screenshots setting
//      withheld the material — when nothing was withheld from it.
//
//   2. prompt-composer's `hasScreenObservation` branch REPLACES the tailored
//      absence copy instead of appending to it. The flag is true whenever ANY
//      ring turn carries a screen line, with no relation to the current
//      question, so a terminal screenshot from turn 1 costs turn 3 the guard
//      that stops "your resume does not mention that" being said to a user who
//      never uploaded one.
//
// (2) is the same defect the sibling suite already fixed for PLAIN history —
// PromptComposerAbsenceOrdering pins "the history block must not REPLACE the
// tailored notice" and "appended as a caveat, never a replacement". The screen
// branch was left replacing. This extends that established rule to it rather
// than introducing a new one.
//
// The two interact: while (1) stands, the privacy notice pre-empts the whole
// no-evidence path, so (2) is MASKED on exactly the turns where screenshots are
// denied. Fixing (1) alone makes (2) more reachable. They land together.
//
// Run: npm run build:electron && node --test electron/context-intelligence/__tests__/ScreenWithholdingAndAbsence2026_09_04.test.mjs

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

process.env.NATIVELY_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-screenwithhold-'));

const base = path.resolve(process.cwd(), 'dist-electron/electron/context-intelligence');
const store = await import(
  pathToFileURL(path.join(base, 'question/conversation-state-store.js')).href);
const { buildV3Prompt } = await import(
  pathToFileURL(path.join(base, 'orchestration/engine-bridge.js')).href);
const { CONTEXT_INTELLIGENCE_V3_ENV_KEY } = await import(
  pathToFileURL(path.join(base, 'contracts/flag.js')).href);
const { DENY_PROVIDER_SCOPES_ENV } = await import(
  pathToFileURL(path.join(base, 'policies/provider-scope-policy.js')).href);
const { chunkScreenDescription } = await import(
  pathToFileURL(path.join(base, 'retrieval/screen-retrieval-port.js')).href);

process.env[CONTEXT_INTELLIGENCE_V3_ENV_KEY] = '1';

const turn = (sessionId, question, n, extra = {}) => buildV3Prompt({
  surface: 'manual-chat', pathTag: 'ipc', question, modeTemplateType: 'general',
  requestId: `sw-${n}`, requestSequence: n,
  scope: { userId: 'local', sessionId }, ...extra,
});

/** Turn 1 attaches a terminal screenshot; turn 2 is unrelated to it. */
async function screenThenUnrelated(sid, finalQuestion) {
  store.clearConversationState(sid);
  await turn(sid, 'Why does this build fail?', 1, { hasScreenContext: true });
  store.recordAnswerSummary(sid, 'The linker cannot find libssl.',
    'iTerm running make; error ld: library not found for -lssl.');
  return turn(sid, finalQuestion, 2);
}

const evidenceBlockOf = (prompt) => /# Evidence[\s\S]*?(?=\n# |$)/.exec(prompt)?.[0] ?? '';

afterEach(() => { delete process.env[DENY_PROVIDER_SCOPES_ENV]; });

// ── 1. the ring's withholding is not this turn's evidence withholding ───────

describe('a withheld screen line does not rewrite an unrelated turn', () => {
  test('the turn is not told its own material was withheld', async () => {
    process.env[DENY_PROVIDER_SCOPES_ENV] = 'screenshots';
    const t2 = await screenThenUnrelated('sw-privacy', 'What is my strongest skill?');

    // Nothing about turn 2 involved a screenshot, and no evidence of its own
    // was filtered — the ring's screen line simply was not rendered.
    assert.ok(!/ALL of it was withheld/i.test(t2.user),
      'the full-withholding refusal describes evidence this turn never had');
    assert.ok(!/Screenshots privacy setting is withholding/i.test(t2.user),
      'the turn is told to refuse over a setting that filtered nothing of its own');
  });

  test('but the denial is still REPORTED in the audit', async () => {
    // The sibling suite pins this: a withheld scope must be observable, never
    // an invisible drop. Splitting the audit set from the composer input has to
    // keep that true — the screen line really was withheld from the prompt.
    process.env[DENY_PROVIDER_SCOPES_ENV] = 'screenshots';
    const t2 = await screenThenUnrelated('sw-audit', 'What is my strongest skill?');
    const withheld = [...(t2.withheldDataScopes ?? [])];
    assert.ok(withheld.includes('screenshots'),
      `the drop must stay observable — got ${JSON.stringify(withheld)}`);
  });

  test('and the tailored anti-fabrication guard survives', async () => {
    process.env[DENY_PROVIDER_SCOPES_ENV] = 'screenshots';
    const t2 = await screenThenUnrelated('sw-guard', 'What is my strongest skill?');
    assert.match(t2.user, /not established by any available source|no such file exists here/i,
      'suppressing the absence copy is what lets the model answer a private claim from '
      + 'general knowledge — the fabrication this contract exists to prevent');
  });
});

// ── 2. a screen observation is a caveat, not a replacement ─────────────────

describe('a stale screen line does not replace the tailored absence copy', () => {
  test('an unrelated later turn keeps its own guard', async () => {
    // Screenshots ALLOWED here, so defect (1) cannot mask this one.
    const t2 = await screenThenUnrelated('sw-replace', 'What is my strongest skill?');

    assert.match(t2.user, /not established by any available source|no such file exists here/i,
      'a terminal screenshot from an earlier turn is not a source for this question, '
      + 'and must not cost the turn the guard that stops "your resume does not mention that"');
  });

  test('the screen caveat is appended, not substituted', async () => {
    const t2 = await screenThenUnrelated('sw-append', 'What is my strongest skill?');
    const block = evidenceBlockOf(t2.user);
    assert.ok(block.length > 0, 'expected an evidence block');
    // The useful half of the replacing copy is kept: do not blame a document,
    // and the observation may be answered from. It just no longer arrives by
    // deleting the tailored sentence.
    assert.match(block, /do not blame an uploaded document|screen attached that turn/i,
      'the screen correction should still reach the model');
  });

  test('a ring with NO screen line is unaffected — the control', async () => {
    const sid = 'sw-control';
    store.clearConversationState(sid);
    await turn(sid, 'What are you able to help with?', 1);
    store.recordAnswerSummary(sid, 'Plenty — ask me anything.');
    const t2 = await turn(sid, 'What is my strongest skill?', 2);
    assert.match(t2.user, /not established by any available source|no such file exists here/i);
    assert.match(t2.user, /check the conversation above/i,
      'plain history keeps appending its caveat, exactly as before');
  });
});

// ── 3. an OCR blob is chunked, not carried whole ───────────────────────────

describe('the screen port splits a paragraph that is itself over the cap', () => {
  const MAX = 1200;   // MAX_CHUNK_CHARS
  const portChunks = (description) => chunkScreenDescription(description);

  test('one long unbroken blob becomes several chunks, all within the cap', () => {
    // OCR extractedText is routinely a single blob with no blank line in it.
    const blob = Array.from({ length: 120 },
      (_, i) => `line ${i} of terminal output showing a failing assertion`).join('\n');
    assert.ok(blob.length > MAX * 3, 'fixture must actually exceed the cap');

    const chunks = portChunks(blob);
    assert.ok(chunks.length > 1, 'an oversized paragraph was carried whole as one chunk');
    for (const c of chunks) {
      assert.ok(c.length <= MAX,
        `every chunk must fit the cap — context-packer DROPS an over-budget item rather than `
        + `truncating it, so one oversized chunk means the screenshot contributes nothing (got ${c.length})`);
    }
  });

  test('no content is lost across the split', () => {
    const blob = Array.from({ length: 80 }, (_, i) => `sentinel${i} some padding text here`).join('\n');
    const joined = portChunks(blob).join('\n');
    for (const i of [0, 40, 79]) {
      assert.match(joined, new RegExp(`sentinel${i}\\b`), `sentinel${i} was dropped by the splitter`);
    }
  });

  test('a short description is still a single chunk — the control', () => {
    const chunks = portChunks('VS Code is open on graph.py; the sidebar shows 12 files.');
    assert.equal(chunks.length, 1, 'small screens must not be fragmented');
  });
});

// ── 4. a raw transcript window is not a completed exchange ─────────────────

describe('conversationHasContent requires an answered turn, not any prose', () => {
  // The live spoken surfaces pass IntelligenceEngine's conversationWindow(90),
  // which is SessionTracker.getFormattedContext — "[ME]: …", "[INTERVIEWER]: …"
  // lines, a rolling speech window with no completed exchange in it. The
  // contract for ComposeInput.conversationHasContent says TRUE only when the
  // summary holds at least one completed exchange, and the composer relaxes its
  // absence notice on the strength of it. On the FIRST spoken question of a
  // session with any transcript, that produced "earlier turns may already
  // contain what is being asked" about turns that do not exist.
  const transcriptWindow = [
    '[INTERVIEWER]: so tell me about the caching layer you built',
    '[ME]: sure, it was a read-through cache in front of postgres',
  ].join('\n');

  const renderedExchange = 'User: what is my strongest skill?\nAssistant: based on the résumé, distributed systems.';

  test('a rolling transcript window does not claim prior turns exist', async () => {
    const t = await turn('sw-tw', 'What is my strongest skill?', 1, {
      conversationSummary: transcriptWindow,
    });
    assert.ok(!/earlier turns may already contain what is being asked/i.test(t.user),
      'a speech window is not a completed exchange — claiming otherwise tells the model to '
      + 'look for an answer in turns that never happened');
  });

  test('a real rendered exchange still does', async () => {
    const t = await turn('sw-ex', 'What is my strongest skill?', 1, {
      conversationSummary: renderedExchange,
    });
    assert.match(t.user, /earlier turns may already contain what is being asked/i,
      'the feature must survive: a genuine prior exchange is still a place to have read something');
  });

  test('a question-only fallback does not count as an exchange', async () => {
    const t = await turn('sw-qonly', 'What is my strongest skill?', 1, {
      conversationSummary: 'Previous question: what did we just discuss?',
    });
    assert.ok(!/earlier turns may already contain what is being asked/i.test(t.user),
      'rendered for continuity, but with no answer it is not something to answer FROM');
  });
});

// ── 5. the declared context budgets stay proportionate ─────────────────────

describe('a strict document-grounded mode does not weight chat like evidence', () => {
  // The 2026-08-28 sweep raised conversationTokens 400-800 → 2400 for EVERY
  // mode at once, with a rationale ("~6-8 completed exchanges") that assumes the
  // conversation is a place to answer from. In a STRICT_DOC_CAPS mode it is not:
  // general knowledge is off and document claims require evidence, so the ring
  // serves referent resolution only. Pinning the invariant rather than the
  // number, so the next blanket sweep is caught but retuning stays free.
  test('conversation is budgeted below evidence where claims require evidence', async () => {
    const mod = await import(
      pathToFileURL(path.join(base, 'policies/mode-policy-registry.js')).href);
    const policies = Object.values(mod.MODE_POLICIES).filter(
      (m) => m && typeof m === 'object' && m.contextBudget && m.capabilityPolicy);

    assert.ok(policies.length > 0, 'expected to find mode policies to check');
    const strict = policies.filter((m) => m.capabilityPolicy.useGeneralIndustryKnowledge === false);
    assert.ok(strict.length > 0, 'expected at least one strict document-grounded mode');

    for (const m of strict) {
      assert.ok(m.contextBudget.conversationTokens < m.contextBudget.evidenceTokens,
        `${m.id}: conversation (${m.contextBudget.conversationTokens}) must stay below evidence `
        + `(${m.contextBudget.evidenceTokens}) in a mode where the conversation is not an answer source`);
    }
  });
});
