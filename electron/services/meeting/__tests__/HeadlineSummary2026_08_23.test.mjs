// electron/services/meeting/__tests__/HeadlineSummary2026_08_23.test.mjs
//
// User review (2026-08-23), confirmed against the code: the headline Summary
// (summary.tldr) was a POSITIONAL grab — chunk 1's brief, the first 2
// decisions chronologically, actionItems[0], a risk only as filler — so a
// critical minute-45 decision, the 3rd action item, or a high-severity
// mid-meeting risk never reached the headline even though the pipeline had
// computed confidence/severity for every item. And neither buildSummary nor
// buildOverview ever consulted modeTemplateType, so a technical interview and
// a lecture produced structurally identical headline blocks while their
// mode-specific sections sat differentiated below.
//
// Fixes under test:
//   - decisions ranked by confidence (chronology only breaks ties);
//   - the next step prefers explicit over inferred;
//   - a HIGH-severity risk is always in the headline;
//   - the Summary leads with the mode's defining section (technical-interview
//     -> Hiring signal, lecture -> Study summary, call-center -> Customer
//     issue), and the Overview closes on it;
//   - the new 9th built-in 'call-center' template is fully registered.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../../dist-electron/electron/', p)).href;
const { MeetingSummaryReducer } = await import(dist('services/meeting/MeetingSummaryReducer.js'));
const { TranscriptNormalizer } = await import(dist('services/meeting/TranscriptNormalizer.js'));

const normalized = new TranscriptNormalizer().normalize([
  { speaker: 'interviewer', text: 'Question about the system.', timestamp: 0 },
  { speaker: 'user', text: 'Answer about the system.', timestamp: 1000 },
]);

const ev = [{ speakerName: 'Ari', quote: 'said so' }];
const atom = (over = {}) => ({
  chunkIndex: 0, timeRange: { startMs: 0, endMs: 60000 },
  brief: 'Kickoff covered project scope.', decisions: [], actionItems: [],
  openQuestions: [], risks: [], topics: [], people: [], deadlines: [], modeSpecificFindings: {},
  sourceQualityWarnings: [], ...over,
});

const reduce = (atoms, modeTemplateType = 'general', modeNoteSections = []) =>
  new MeetingSummaryReducer().reduce({ title: 't', atoms, normalizedTranscript: normalized, modeTemplateType, modeNoteSections });

describe('headline selection quality', () => {
  test('a high-confidence minute-45 decision beats two earlier low-confidence ones', () => {
    const summary = reduce([
      atom({ chunkIndex: 0, decisions: [
        { text: 'Maybe we could revisit the logo palette.', confidence: 'low', evidence: ev },
        { text: 'Possibly reorder the agenda for next time.', confidence: 'low', evidence: ev },
      ] }),
      atom({ chunkIndex: 3, brief: '', decisions: [
        { text: 'We will migrate the billing system to Stripe by Q4.', confidence: 'high', evidence: ev },
      ] }),
    ]);
    assert.ok(summary.tldr.some(l => /migrate the billing system/.test(l)),
      `the late high-confidence decision must reach the headline: ${JSON.stringify(summary.tldr)}`);
  });

  test('an explicit later action item beats an inferred first one', () => {
    const summary = reduce([
      atom({ actionItems: [
        { text: 'Someone should probably look at the flaky test.', explicitness: 'inferred', confidence: 'low', evidence: ev },
        { text: 'Dana ships the hotfix tomorrow.', owner: 'Dana', explicitness: 'explicit', confidence: 'high', evidence: ev },
      ] }),
    ]);
    assert.ok(summary.tldr.some(l => /Dana.*hotfix/.test(l)),
      `the explicit action must be the headline next step: ${JSON.stringify(summary.tldr)}`);
  });

  test('a HIGH-severity mid-meeting risk always reaches the headline', () => {
    const summary = reduce([
      atom({
        decisions: [
          { text: 'Decision one stands.', confidence: 'high', evidence: ev },
          { text: 'Decision two stands.', confidence: 'high', evidence: ev },
        ],
        actionItems: [{ text: 'Do the thing.', explicitness: 'explicit', confidence: 'high', evidence: ev }],
        risks: [{ text: 'The vendor contract lapses Friday and blocks the launch.', severity: 'high', evidence: ev }],
      }),
    ]);
    assert.ok(summary.tldr.some(l => /vendor contract lapses/.test(l)),
      `high-severity risks must not be filler-only: ${JSON.stringify(summary.tldr)}`);
  });
});

describe('mode-aware headline', () => {
  const tiSections = [{ title: 'Hiring signal' }, { title: 'Problem discussed' }];
  const tiAtom = atom({
    modeSpecificFindings: {
      'Hiring signal': [{ text: 'Strong hire signal: solid approach, clean complexity reasoning.', evidence: ev }],
      'Problem discussed': [{ text: 'Two-sum with a follow-up on streaming input.', evidence: ev }],
    },
    decisions: [{ text: 'Proceed to onsite.', confidence: 'medium', evidence: ev }],
  });

  test('technical-interview Summary LEADS with the hiring signal, not the generic brief', () => {
    const summary = reduce([tiAtom], 'technical-interview', tiSections);
    assert.match(summary.tldr[0] ?? '', /Strong hire signal/,
      `headline must open with the mode-defining section: ${JSON.stringify(summary.tldr)}`);
  });

  test('the same atoms under general mode do NOT lead with the interview section', () => {
    const summary = reduce([tiAtom], 'general', tiSections);
    assert.doesNotMatch(summary.tldr[0] ?? '', /Strong hire signal/);
  });

  test('the Overview closes on the mode-defining section', () => {
    const summary = reduce([tiAtom], 'technical-interview', tiSections);
    assert.match(summary.overview, /Hiring signal: Strong hire signal/);
  });

  test('an unknown/custom mode falls through to the generic shape without throwing', () => {
    const summary = reduce([tiAtom], 'my-custom-mode', tiSections);
    assert.ok(summary.tldr.length > 0);
  });
});

describe('call-center: the 9th built-in template is fully registered', () => {
  test('TEMPLATE_NOTE_SECTIONS carries the support sections', async () => {
    const { TEMPLATE_NOTE_SECTIONS, TEMPLATE_SYSTEM_PROMPTS } = await import(dist('services/ModesManager.js'));
    const titles = TEMPLATE_NOTE_SECTIONS['call-center'].map((s) => s.title);
    for (const t of ['Customer issue', 'Questions asked', 'Resolution', 'Escalation needed']) {
      assert.ok(titles.includes(t), `missing section: ${t}`);
    }
    assert.ok(TEMPLATE_SYSTEM_PROMPTS['call-center'].includes('SUPPORT AGENT'),
      'the mode system prompt must exist and be support-framed');
    assert.ok(!/buying signal/i.test(TEMPLATE_SYSTEM_PROMPTS['call-center']), 'support, not sales');
  });

  test('builtin seeding knows the label', async () => {
    const { BUILTIN_MODE_LABELS, builtinModeId } = await import(dist('services/builtinModes.js'));
    assert.equal(BUILTIN_MODE_LABELS['call-center'], 'Call Center');
    assert.equal(builtinModeId('call-center'), 'mode_builtin_call-center');
  });

  test('the V3 policy registry has a real call-center policy (no silent general fallback)', async () => {
    const { MODE_POLICIES, isModeId } = await import(dist('context-intelligence/policies/mode-policy-registry.js'));
    assert.ok(isModeId('call-center'));
    const p = MODE_POLICIES['call-center'];
    assert.equal(p.groundingPolicy, 'SOURCE_FIRST');
    assert.ok(p.allowedSourceTypes.includes('REFERENCE_FILE'));
    assert.equal(p.profileSources.length, 0, 'no profile hydration on support calls');
  });

  test('call-center headline leads with the customer issue', () => {
    const ccAtom = atom({
      modeSpecificFindings: {
        'Customer issue': [{ text: 'Exports fail with a timeout on workspaces over 10k rows.', evidence: ev }],
        Resolution: [{ text: 'Raised the export timeout and confirmed a successful run.', evidence: ev }],
      },
    });
    const summary = reduce([ccAtom], 'call-center', [{ title: 'Customer issue' }, { title: 'Resolution' }]);
    assert.match(summary.tldr[0] ?? '', /Exports fail with a timeout/);
  });
});
