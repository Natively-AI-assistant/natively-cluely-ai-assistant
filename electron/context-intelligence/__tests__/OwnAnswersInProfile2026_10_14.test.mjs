// The user's own answers are part of the profile a meeting reads (2026-10-14).
//
// A 2.9.2 user reported that Natively wrote a good answer and then replaced it with "let me come back to you on
// that". Asked "what is your biggest weakness?" with only a résumé loaded, an answer has to name a weakness the résumé
// does not state, so one pass either invents one or defers; four prompt wordings did not change that on two models.
// The only source for such an answer is the user, and PROFILE_FACT (the source type that is authoritative for claims
// about the user) had no store.
//
// "Cue Cards" in Profile Intelligence is that store. What the user wrote or approved arrives here as a `fact`
// document with `structured.ownAnswers`. On a turn that reads the profile whole it is one more whole item; on a
// profile read in passages each answer is a section. Both interview modes read it. Nothing derived by the app is
// served through this kind, as before.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const base = path.resolve(root, 'dist-electron/electron/context-intelligence');
const { createProfileRetrievalPort, profileWholeInfo, ownAnswersWholeText, renderProfileSections, PROFILE_WHOLE_SECTION, PROFILE_WHOLE_MAX_TOKENS } =
  await import(pathToFileURL(path.join(base, 'retrieval/profile-retrieval-port.js')).href);
const { MODE_POLICIES } = await import(pathToFileURL(path.join(base, 'policies/mode-policy-registry.js')).href);
const { decide, evaluateAnswerability, PROFILE_WHOLE_ITEM_OVERHEAD } = await import(pathToFileURL(path.join(base, 'orchestration/orchestrator.js')).href);
const { ownAnswersNotice } = await import(pathToFileURL(path.join(base, 'generation/prompt-composer.js')).href);

const RESUME_RAW = [
  '# Jordan Avery', 'Full-stack developer', '',
  '## Experience', '### FitPilot, Sole Developer (July 2025 to present)', '- Built the React Native app and the Supabase backend.',
  '### CampusCart, Contract Developer (January to May 2025)', '- Four-person team. Cut page load times by 40% and improved Core Web Vitals by 35%.', '',
  '## Education', 'BSc Computer Science, Northfield University, June 2025.',
].join('\n');
const JD_RAW = ['# Frontend Engineer, Brightwell', '## Requirements', '- React and TypeScript', '- Works in a six-engineer team'].join('\n');
const STRUCTURED_RESUME = {
  identity: { name: 'Jordan Avery' }, skills: { languages: ['TypeScript'] },
  experience: [{ role: 'Sole Developer', company: 'FitPilot', start_date: '2025', end_date: 'present', bullets: ['Built the app.'] }],
  education: [{ degree: 'BSc', field: 'Computer Science', institution: 'Northfield University' }],
};
const STRUCTURED_JD = { title: 'Frontend Engineer', company: 'Brightwell', requirements: ['React and TypeScript'], technologies: ['React'] };
const WEAKNESS = 'I hold on to a problem too long before asking for help. I now set a one-hour limit and then write up what I tried.';
const LEAVING = 'The contract ended in May and I wanted to own a product end to end.';
const OWN = { ownAnswers: [
  { key: 'weakness', label: 'Biggest weakness', text: WEAKNESS },
  { key: 'why_leaving', label: 'Why you left, or are leaving, your last job', text: LEAVING },
  { key: 'salary', label: 'Salary expectation', text: 'Between 55 and 62 thousand.' },
] };
const RESUME = { kind: 'resume', sourceId: 'psrc_res', versionId: 'v1', fileName: 'Resume (PI)', structured: STRUCTURED_RESUME, rawText: RESUME_RAW };
const JD = { kind: 'jd', sourceId: 'psrc_jd', versionId: 'v1', fileName: 'JD (PI)', structured: STRUCTURED_JD, rawText: JD_RAW };
const FACT = { kind: 'fact', sourceId: 'psrc_fact', versionId: 'a1', fileName: 'Your own answers (Profile Intelligence)', structured: OWN };
const DOCS = [RESUME, JD, FACT];

let seq = 0;
const turn = async (modeId, question, docs = DOCS, extra = {}) => {
  const P = MODE_POLICIES[modeId];
  const port = createProfileRetrievalPort({ docs, allowedSourceTypes: P.allowedSourceTypes, profileSources: P.profileSources ?? [], userId: 'u1' });
  const decision = decide({
    requestId: `oa${++seq}`, requestSequence: seq, surface: 'what-to-answer', modeId, scope: { userId: 'u1', modeId }, sessionId: 's',
    transcriptQuestion: question, hasAttachedDocuments: true, profileOnlyDocuments: true,
    profileWhole: profileWholeInfo(docs, P.allowedSourceTypes, P.profileSources ?? []), ...extra,
  });
  const evidence = port ? (await port.retrieve({ decision })).evidence : [];
  return { port, decision, evidence, own: evidence.filter((e) => e.sourceType === 'PROFILE_FACT') };
};

describe('what a fact document renders', () => {
  test('one section per answer, under its question, and never a complete inventory', () => {
    const sections = renderProfileSections('fact', OWN);
    assert.equal(sections.length, 3);
    assert.equal(sections[0].section, 'Own answer: Biggest weakness');
    assert.match(sections[0].text, /I hold on to a problem too long/);
    assert.ok(sections.every((s) => s.completeInventory === false));
  });
  test('an entry without a label or without text is left out; a fact document with nothing else renders nothing', () => {
    assert.equal(renderProfileSections('fact', { ownAnswers: [{ label: 'Biggest weakness', text: '  ' }, { label: '', text: 'x' }] }).length, 0);
    assert.equal(renderProfileSections('fact', {}).length, 0);
    assert.equal(renderProfileSections('fact', { estimate: { min: 100, max: 120 }, role: 'Engineer' }).length, 0, 'a derived salary estimate is still refused');
    assert.equal(ownAnswersWholeText({}), '');
  });
  test('the whole text says whose words these are and holds every answer', () => {
    const text = ownAnswersWholeText(OWN);
    assert.match(text, /in their own words/);
    assert.ok(text.includes(WEAKNESS) && text.includes(LEAVING));
    assert.match(text, /Biggest weakness:\n/);
  });
});

describe('how the question is asked rides with the answer (measured in the app, 2026-10-14)', () => {
  // With a salary range and a "why this role" answer both saved, heard "what are you looking for in base?" was answered
  // with the answer about the role, whose text said "looking for". The label "Salary expectation" shares no word with it.
  const ASKED = { ownAnswers: [{ key: 'salary', label: 'Salary expectation', askedAs: 'salary, pay, base, compensation expectations', text: 'Between 90 and 100 thousand.' }] };
  test('the heading the model reads names how it is asked, in the whole text and in the section', () => {
    assert.match(ownAnswersWholeText(ASKED), /Salary expectation \(asked as: salary, pay, base, compensation expectations\):\nBetween 90 and 100 thousand\./);
    const [section] = renderProfileSections('fact', ASKED);
    assert.equal(section.section, 'Own answer: Salary expectation', 'the section name stays the plain label');
    assert.match(section.text, /asked as: salary, pay, base/);
  });
  test('an entry without it is headed by its label alone', () => {
    assert.match(ownAnswersWholeText(OWN), /Biggest weakness:\n/);
  });
});

describe('the prompt line that says a saved answer settles the question', () => {
  test('only when such an item is in the evidence', () => {
    assert.equal(ownAnswersNotice('<evidence source_type="RESUME">x</evidence>'), '');
    assert.equal(ownAnswersNotice(''), '');
    const notice = ownAnswersNotice('<evidence evidence_id="e1" source_type="PROFILE_FACT">x</evidence>');
    assert.match(notice, /that entry is the answer/);
    assert.match(notice, /add no reason, detail, number, example or benefit of your own/);
    assert.match(notice, /their own range, not the posting's/);
    assert.match(notice, /never by words its text happens to share with the question/);
  });
  test('it sits with the evidence block', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(path.join(root, 'electron/context-intelligence/generation/prompt-composer.ts'), 'utf8');
    assert.match(src, /\$\{screenReferentNotice\(packed\.evidenceBlock\)\}\$\{ownAnswersNotice\(packed\.evidenceBlock\)\}\$\{packed\.evidenceBlock\}/);
  });
});

describe('profileWholeInfo: the answers are room on top, never part of "does the profile fit"', () => {
  const LFW = MODE_POLICIES['looking-for-work'];
  test('their size is reported apart; the résumé and JD count is unchanged', () => {
    const without = profileWholeInfo([RESUME, JD], LFW.allowedSourceTypes, LFW.profileSources);
    const withOwn = profileWholeInfo(DOCS, LFW.allowedSourceTypes, LFW.profileSources);
    assert.equal(withOwn.docs, without.docs);
    assert.equal(withOwn.tokens, without.tokens);
    assert.equal(withOwn.answersTokens, Math.ceil(ownAnswersWholeText(OWN).length / 4));
    assert.equal('answersTokens' in without, false);
  });
  test('a résumé at the size limit still fits with answers saved', () => {
    const atLimit = { ...RESUME, rawText: 'x'.repeat(PROFILE_WHOLE_MAX_TOKENS * 4) };
    const info = profileWholeInfo([atLimit, FACT], LFW.allowedSourceTypes, LFW.profileSources);
    assert.equal(info.docs, 1);
    assert.ok(info.answersTokens > 0);
  });
  test('answers alone are sized on their own; a mode that does not read the profile: nothing', () => {
    const alone = profileWholeInfo([FACT], LFW.allowedSourceTypes, LFW.profileSources);
    assert.equal(alone.docs, 0);
    assert.equal(alone.tokens, 0);
    assert.ok(alone.answersTokens > 0);
    assert.equal(profileWholeInfo(DOCS, MODE_POLICIES.sales.allowedSourceTypes, MODE_POLICIES.sales.profileSources ?? []), null);
  });
});

for (const modeId of ['looking-for-work', 'technical-interview']) {
  describe(`${modeId}: a turn that reads the profile reads the user's own answers`, () => {
    test('"biggest weakness": the saved answer is in the evidence, once, whole, as the user\'s own fact', async () => {
      const { decision, evidence, own } = await turn(modeId, 'What would you say is your biggest weakness?');
      assert.ok(decision.retrievalPlan.sourceTypes.includes('PROFILE_FACT'));
      assert.equal(own.length, 1, JSON.stringify(own.map((e) => e.section)));
      assert.equal(own[0].section, PROFILE_WHOLE_SECTION);
      assert.equal(own[0].provenance, 'PROFILE_FACT');
      assert.equal(own[0].documentTitle, 'Your own answers (Profile Intelligence)');
      assert.ok(own[0].content.includes(WEAKNESS));
      assert.equal(evidence.filter((e) => /^Own answer:/.test(e.section ?? '')).length, 0, 'no per-answer sections next to the whole item');
      assert.equal(evaluateAnswerability(decision, evidence), 'FULL');
    });
    test('a question that shares no word with the answer still has it in view', async () => {
      const { own } = await turn(modeId, 'What do you most need to get better at?');
      assert.equal(own.length, 1);
      assert.ok(own[0].content.includes(WEAKNESS));
    });
    test('"why did you leave": the reason the user gave is in view', async () => {
      const { own } = await turn(modeId, 'Why did you leave CampusCart?');
      assert.equal(own.length, 1);
      assert.ok(own[0].content.includes(LEAVING));
    });
    test('the plan makes room: one more item, and the answers\' size', async () => {
      const P = MODE_POLICIES[modeId];
      const Q = 'What would you say is your biggest weakness?';
      const { decision: without } = await turn(modeId, Q, [RESUME, JD]);
      const { decision: withOwn } = await turn(modeId, Q);
      const info = profileWholeInfo(DOCS, P.allowedSourceTypes, P.profileSources);
      assert.equal(withOwn.retrievalPlan.maximumAcceptedEvidence, without.retrievalPlan.maximumAcceptedEvidence + 1);
      assert.equal(withOwn.retrievalPlan.evidenceTokens, without.retrievalPlan.evidenceTokens + info.answersTokens + PROFILE_WHOLE_ITEM_OVERHEAD);
    });
    test('a coding task reads no profile, answers included', async () => {
      const { decision, evidence } = await turn(modeId, 'Reverse a linked list in Python.');
      assert.equal(decision.retrievalPlan.shouldRetrieve, false);
      assert.equal(evidence.length, 0);
    });
  });
}

describe('with no answers saved, nothing changes', () => {
  test('the plan and the evidence are those of a résumé and a job description', async () => {
    const { decision, own } = await turn('looking-for-work', 'What would you say is your biggest weakness?', [RESUME, JD]);
    assert.equal(own.length, 0);
    const again = await turn('looking-for-work', 'What would you say is your biggest weakness?', [RESUME, JD, { ...FACT, structured: { ownAnswers: [] } }]);
    assert.equal(again.own.length, 0);
    assert.equal(again.decision.retrievalPlan.maximumAcceptedEvidence, decision.retrievalPlan.maximumAcceptedEvidence);
    assert.equal(again.decision.retrievalPlan.evidenceTokens, decision.retrievalPlan.evidenceTokens);
  });
});

describe('a profile read in passages (too large to hand over whole)', () => {
  const filler = Array.from({ length: 1400 }, (_, i) => `- Item ${i + 1}: maintained the service, wrote the runbook and reviewed the rollout plan.`).join('\n');
  const BIG = { ...RESUME, rawText: `${RESUME_RAW}\n${filler}` };
  test('the résumé is read in passages and the answers still arrive whole, as one item', async () => {
    const P = MODE_POLICIES['looking-for-work'];
    const info = profileWholeInfo([BIG, JD, FACT], P.allowedSourceTypes, P.profileSources);
    assert.equal(info.docs, 0, 'the résumé and the job description are not handed over whole');
    assert.ok(info.answersTokens > 0);
    const { decision, own, evidence } = await turn('looking-for-work', 'What would you say is your biggest weakness?', [BIG, JD, FACT]);
    assert.equal(decision.retrievalPlan.wholeProfile, undefined);
    assert.equal(decision.retrievalPlan.wholeOwnAnswers, true);
    assert.equal(own.length, 1, JSON.stringify(own.map((e) => e.section)));
    assert.equal(own[0].section, PROFILE_WHOLE_SECTION);
    assert.ok(own[0].content.includes(WEAKNESS));
    assert.ok(evidence.some((e) => e.sourceType === 'RESUME' && e.section !== PROFILE_WHOLE_SECTION), 'the résumé still arrives in passages');
  });
});

// Measured 2026-10-14 against the built planner, with a résumé too large to hand over whole and with none: these six
// phrasings never reached the saved answer. The classifier sent three to general knowledge (nothing read) and planned
// the résumé alone for the other three. The answers now go whole on every turn that reads the profile.
const MISSED = [
  ['What is something you are working on improving?', WEAKNESS],
  ['Why are you looking for a new role?', LEAVING],
  ['What are you looking for in base?', 'Between 55 and 62 thousand.'],
  ['What are you best at?', 'STRENGTH-1'],
  ['Are you open to relocating?', 'RELOCATE-1'],
  ['Would you be fine coming into the office three days a week?', 'RELOCATE-1'],
];
const FACT_ALL = { ...FACT, structured: { ownAnswers: [
  ...OWN.ownAnswers,
  { key: 'strength', label: 'Biggest strength', askedAs: 'your biggest strength, what you are best at', text: 'I make slow pages fast. STRENGTH-1' },
  { key: 'relocation', label: 'Relocation, remote or office', askedAs: 'relocating, moving, remote, hybrid or in-office work', text: 'Remote or hybrid; I would not move. RELOCATE-1' },
] } };
for (const [setup, docs] of [['no résumé', [FACT_ALL]], ['a résumé too large to hand over whole', [{ ...RESUME, rawText: `${RESUME_RAW}\n${Array.from({ length: 1400 }, (_, i) => `- Item ${i + 1}: maintained the service.`).join('\n')}` }, FACT_ALL]]]) {
  describe(`${setup}: the saved answer is in view however the question is put`, () => {
    for (const modeId of ['looking-for-work', 'technical-interview']) {
      for (const [q, text] of MISSED) {
        test(`${modeId}: ${q}`, async () => {
          const { decision, own } = await turn(modeId, q, docs);
          assert.equal(decision.retrievalPlan.wholeOwnAnswers, true);
          assert.equal(own.length, 1);
          assert.ok(own[0].content.includes(text));
        });
      }
      test(`${modeId}: the plan makes room for them, and a coding task still reads nothing`, async () => {
        const P = MODE_POLICIES[modeId];
        const info = profileWholeInfo(docs, P.allowedSourceTypes, P.profileSources);
        const { decision } = await turn(modeId, 'Are you open to relocating?', docs);
        assert.ok(decision.retrievalPlan.evidenceTokens >= P.contextBudget.evidenceTokens + info.answersTokens);
        const coding = await turn(modeId, 'Reverse a linked list in Python.', docs);
        assert.equal(coding.decision.retrievalPlan.shouldRetrieve, false);
        assert.equal(coding.own.length, 0);
      });
    }
  });
}

describe('modes that do not read the user\'s profile never see the answers', () => {
  for (const modeId of ['sales', 'call-center', 'team-meet', 'recruiting', 'general', 'seminar', 'lecture']) {
    test(modeId, async () => {
      if (!MODE_POLICIES[modeId]) return;
      const { port, own } = await turn(modeId, 'What would you say is your biggest weakness?');
      assert.equal(own.length, 0);
      if ((MODE_POLICIES[modeId].profileSources ?? []).length === 0) assert.equal(port, null);
    });
  }
});
