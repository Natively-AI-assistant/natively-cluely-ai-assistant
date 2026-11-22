// Issue #777 (2026-11-21): What to Answer reversed whose team the interviewer asked about.
//
// The interviewer asked "how long is your sprint typically?"; the candidate said it back while thinking ("Like, how
// long is your sprint? We... Our our our sprint") and pressed What to Answer. The manual-press rule that prefers the
// user's own newer question took that echo, the prompt labelled it as said by the user, and "your sprint" was answered
// as the interviewer's: "I'd want to understand how your team runs them... the specific length you follow."

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractLatestQuestion, isEchoOfOtherPartyQuestion, otherPartyLinesBefore } from '../../../dist-electron/electron/llm/transcriptQuestionExtractor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The saved transcript from the issue, as the hotkey sees it (interviewer channel = 'interviewer', mic = 'user').
const ISSUE_TURNS = [
  { role: 'interviewer', text: 'Do you follow agile ceremonies?', timestamp: 1_509_000 - 4000 },
  { role: 'interviewer', text: 'you guys follow that? Like, like, how long is your sprint typically?', timestamp: 1_509_008 },
  { role: 'user', text: 'Like, how long is your sprint? We... Our our our sprint', timestamp: 1_512_808 },
];

describe('a repeated question is not the user\'s own question', () => {
  test('the issue\'s echo is recognised as the interviewer\'s question said back', () => {
    assert.equal(isEchoOfOtherPartyQuestion(ISSUE_TURNS[2].text, ISSUE_TURNS[1].text), true);
  });

  test('without STT punctuation too', () => {
    assert.equal(isEchoOfOtherPartyQuestion('like how long is your sprint we our our our sprint', 'you guys follow that like like how long is your sprint typically'), true);
  });

  test('a short question said back word for word', () => {
    assert.equal(isEchoOfOtherPartyQuestion("What's your timeline?", "And what's your timeline?"), true);
  });

  test('the user\'s own newer question is not an echo (the 2026-09-10 recruiting case)', () => {
    assert.equal(isEchoOfOtherPartyQuestion(
      'let me check the scorecard, what are we actually scoring on and what weights',
      'how many rounds are there in the process?',
    ), false);
  });

  test('a question that shares a few words but asks something else is not an echo', () => {
    assert.equal(isEchoOfOtherPartyQuestion('how long is the notice period on your side?', 'how long is your sprint typically?'), false);
    assert.equal(isEchoOfOtherPartyQuestion('did anyone mention the elasticsearch window', 'thanks, bye'), false);
  });

  test('said back in the speaker\'s own words: our for your, a plural, an expanded contraction', () => {
    assert.equal(isEchoOfOtherPartyQuestion('Like, how long is our sprint? We... our sprint', 'how long is your sprint typically?'), true);
    assert.equal(isEchoOfOtherPartyQuestion('how long are your sprints? um', 'how long is your sprint typically?'), true);
    assert.equal(isEchoOfOtherPartyQuestion('what is your timeline?', "what's your timeline?"), true);
  });

  test('a question that only opens the same way is the user\'s own (code review, 2026-11-21)', () => {
    assert.equal(isEchoOfOtherPartyQuestion('do you have any notes on the scorecard weights?', 'Do you have any questions for me?'), false);
    assert.equal(isEchoOfOtherPartyQuestion('what is the biggest risk in the migration plan?', 'what is the biggest challenge you faced?'), false);
  });

  test('an echo followed by a question of the user\'s own is not an echo', () => {
    assert.equal(isEchoOfOtherPartyQuestion(
      'how long is our sprint? two weeks. what is the team size there?',
      'how long is your sprint typically?',
    ), false);
  });

  test('the other party\'s question is found among several of their turns', () => {
    assert.equal(isEchoOfOtherPartyQuestion(ISSUE_TURNS[2].text, 'how long is your sprint typically?\ntake your time'), true);
  });

  test('the lines compared: every interviewer turn since the user last spoke, and the picked question', () => {
    const turns = [
      { role: 'interviewer', text: 'what did you work on last?' },
      { role: 'user', text: 'mostly the billing service' },
      { role: 'interviewer', text: 'how long is your sprint typically?' },
      { role: 'interviewer', text: 'take your time' },
      { role: 'user', text: 'how long is our sprint? hmm' },
    ];
    const lines = otherPartyLinesBefore(turns, 4, 'how long is your sprint typically?');
    assert.match(lines, /take your time/);
    assert.match(lines, /how long is your sprint typically/);
    assert.doesNotMatch(lines, /what did you work on last/, 'stops at the user\'s previous turn');
    assert.equal(isEchoOfOtherPartyQuestion(turns[4].text, lines), true);
  });

  test('a long line stays fast', () => {
    const long = Array.from({ length: 400 }, (_, i) => `word${i % 7} our our`).join(' ');
    const t0 = Date.now();
    isEchoOfOtherPartyQuestion(long, long);
    assert.ok(Date.now() - t0 < 50);
  });

  test('empty or one-word lines are never an echo', () => {
    assert.equal(isEchoOfOtherPartyQuestion('', 'how long is your sprint typically?'), false);
    assert.equal(isEchoOfOtherPartyQuestion('sprint?', 'how long is your sprint typically?'), false);
    assert.equal(isEchoOfOtherPartyQuestion('how long is your sprint', ''), false);
  });
});

describe('the press answers the interviewer\'s question as heard', () => {
  test('the extractor picks the interviewer\'s sprint question from the issue transcript', () => {
    const q = extractLatestQuestion(ISSUE_TURNS);
    assert.match(String(q.latestQuestion), /how long is your sprint/i);
    assert.doesNotMatch(String(q.latestQuestion), /Our our our sprint/, 'not the candidate\'s echo');
  });

  test('IntelligenceEngine skips the user-utterance switch when the line repeats what the other party said', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'IntelligenceEngine.ts'), 'utf8');
    const i = src.indexOf("trace.mark('repair_used', { reason: 'question_from_user_utterance' })");
    assert.ok(i > 0);
    const block = src.slice(Math.max(0, i - 3600), i);
    assert.match(block, /const userAskedLast = [\s\S]*&& !\(ii >= 0 && isEchoOfOtherPartyQuestion\(userText, otherPartyLinesBefore\(transcriptTurns, ui, extractedQuestion\.latestQuestion\)\)\);/);
    // The switch is what marks the question as spoken by the user; the echo must not reach it.
    assert.match(src.slice(i, i + 400), /questionSpokenByUser = true;/);
  });
});

describe('a heard question about the user\'s side is answered for it, not asked back', async () => {
  const composer = await import('../../../dist-electron/electron/context-intelligence/generation/prompt-composer.js');
  const RULE = /do not ask about the speaker's side or defer to it/;

  test('the existing pronoun notes are unchanged and do not carry the sentence', () => {
    assert.equal(composer.heardQuestionPerspective('general'), composer.HEARD_QUESTION_PERSPECTIVE);
    assert.ok(composer.HEARD_QUESTION_PERSPECTIVE.endsWith('"you" and "your" mean the user you are answering for.)'));
    for (const mode of ['recruiting', 'sales', 'call-center', 'looking-for-work', 'technical-interview', 'seminar', 'team-meet', 'lecture']) {
      assert.doesNotMatch(composer.heardQuestionPerspective(mode), RULE, mode);
    }
  });

  test('a heard question put to the user gets it', () => {
    assert.match(composer.heardQuestionAnswerSide('how long is your sprint typically?', true, ''), RULE);
    assert.match(composer.heardQuestionAnswerSide('What CI tool do you use?', true, ''), RULE);
  });

  test('with nothing about the user in the prompt it names what not to invent, strictly', () => {
    const note = composer.heardQuestionAnswerSide('What CI tool does your team use?', true, '', false);
    assert.equal(note, composer.HEARD_QUESTION_ANSWER_SIDE);
    assert.match(note, /nothing above describes that side/);
    assert.match(note, /state nothing about it as certain fact: no named tool, language or framework they use, no exact headcount, sprint length or schedule, no manager or anyone they report to/);
    assert.match(note, /You may say what is typical, framed as typical and hedged/);
    assert.match(note, /Typical means what is common in the field, never the user's own record \("where I work"/);
    assert.match(note, /do not ask about the speaker's side or defer to it/);
  });

  test('with a document or the user\'s own words it keeps a stated fact usable', () => {
    const note = composer.heardQuestionAnswerSide('What CI tool does your team use?', true, '', true);
    assert.equal(note, composer.HEARD_QUESTION_ANSWER_SIDE_GROUNDED);
    assert.match(note, /Where something above states it, use it\. Otherwise state nothing about that side as certain fact/);
    assert.match(note, /You may say what is typical, framed as typical and hedged/);
    assert.doesNotMatch(note, /nothing above describes that side/);
  });

  test('its worked example stays off the measured topics', () => {
    for (const note of [composer.HEARD_QUESTION_ANSWER_SIDE, composer.HEARD_QUESTION_ANSWER_SIDE_GROUNDED]) {
      const example = note.slice(note.indexOf('WRONG:'));
      assert.doesNotMatch(example, /sprint|on.call|CI|deploy|report to|stack|review|team size|headcount/i);
    }
  });

  test('not for a question about the speaker\'s side or general knowledge (code review, 2026-11-21)', () => {
    assert.equal(composer.heardQuestionAnswerSide('How many engineers did I say are on our team?', true, ''), '');
    assert.equal(composer.heardQuestionAnswerSide('What port does HTTPS use?', true, ''), '');
    assert.equal(composer.heardQuestionAnswerSide("What's the time complexity of that?", true, ''), '');
  });

  test('not beside the personal-life notice, which turns the question back on purpose', () => {
    assert.equal(composer.heardQuestionAnswerSide('How was your weekend?', true, composer.PERSONAL_LIFE_NOTICE), '');
  });

  test('not for a question the user said themselves', () => {
    assert.equal(composer.heardQuestionAnswerSide('how long is your sprint?', false, ''), '');
    assert.doesNotMatch(composer.USER_SPOKEN_QUESTION_PERSPECTIVE, RULE);
  });
});

describe('the claim verifier in the interview modes runs only without documents (issue #777, owner 2026-11-21)', async () => {
  const cv = await import('../../../dist-electron/electron/llm/claimVerifier.js');
  const saved = { i: process.env.NATIVELY_CLAIM_VERIFIER_INTERVIEW, d: process.env.NATIVELY_CLAIM_VERIFIER_NO_DOCS };
  delete process.env.NATIVELY_CLAIM_VERIFIER_INTERVIEW; delete process.env.NATIVELY_CLAIM_VERIFIER_NO_DOCS;

  test('Looking for work: spoken with no document runs; with a document, or typed, it stays off', () => {
    const base = { modeId: 'looking-for-work', question: 'Who do you report to at the moment?', draft: 'I report to my engineering lead.' };
    assert.equal(cv.claimVerifierKind({ ...base, surface: 'spoken', noDocuments: true }), 'personal');
    assert.equal(cv.claimVerifierKind({ ...base, surface: 'spoken', noDocuments: false }), null);
    assert.equal(cv.claimVerifierKind({ ...base, surface: 'spoken' }), null);
    assert.equal(cv.claimVerifierKind({ ...base, surface: 'typed', noDocuments: true }), null);
  });

  test('Technical Interview with no document: a draft stating the user\'s own setup runs, a technical answer does not', () => {
    assert.equal(cv.claimVerifierKind({ modeId: 'technical-interview', question: 'What CI tool does your team use?', draft: "We're on GitLab CI for everything.", surface: 'spoken', noDocuments: true }), 'personal');
    assert.equal(cv.claimVerifierKind({ modeId: 'technical-interview', question: 'Who do you report to?', draft: 'I report to my engineering lead.', surface: 'spoken', noDocuments: true }), 'personal');
    for (const draft of ['Two weeks is the pattern I\'m used to.', 'I work mostly around Python and JavaScript.', 'Two weeks is the usual cadence where I work.', 'Two weeks is the standard we\'ve worked with.'])
      assert.equal(cv.claimVerifierKind({ modeId: 'technical-interview', question: 'How long is your sprint typically?', draft, surface: 'spoken', noDocuments: true }), 'personal', draft);
    assert.equal(cv.claimVerifierKind({ modeId: 'technical-interview', question: 'How would you find a cycle in a linked list?', draft: 'Two pointers, one fast and one slow; if they meet there is a cycle.', surface: 'spoken', noDocuments: true }), null);
    assert.equal(cv.claimVerifierKind({ modeId: 'technical-interview', question: 'What CI tool does your team use?', draft: "We're on GitLab CI.", surface: 'spoken', noDocuments: false }), null);
  });

  test('the no-documents gate opens for those two modes only', () => {
    assert.equal(cv.claimVerifierRunsWithoutDocuments('looking-for-work'), true);
    assert.equal(cv.claimVerifierRunsWithoutDocuments('technical-interview'), true);
    for (const m of ['general', 'sales', 'team-meet', undefined]) assert.equal(cv.claimVerifierRunsWithoutDocuments(m), false, String(m));
  });

  test('its prompt keeps a hedged typical answer and rewrites a flat specific, in those modes with no document only', () => {
    const clause = /A typical answer framed as typical and hedged .* is not a claim: keep it\. A specific stated as their own fact .* change only that phrase into its typical, hedged form/;
    assert.match(cv.claimVerifierSystemPrompt('looking-for-work', 'spoken', { noDocuments: true }), clause);
    assert.match(cv.claimVerifierSystemPrompt('technical-interview', 'spoken', { noDocuments: true }), clause);
    assert.match(cv.claimVerifierSystemPrompt('looking-for-work', 'spoken', { noDocuments: true }), /not the interviewer's: never turn the reply toward theirs .* and never ask them about it\./);
    assert.doesNotMatch(cv.claimVerifierSystemPrompt('looking-for-work', 'spoken', { noDocuments: false }), clause);
    assert.doesNotMatch(cv.claimVerifierSystemPrompt('looking-for-work', 'typed', { noDocuments: true }), clause);
    // General gets its own wording (no candidate, no interviewer), tested with its gate below.
    assert.doesNotMatch(cv.claimVerifierSystemPrompt('general', 'spoken', { noDocuments: true }), /candidate/);
    assert.doesNotMatch(cv.claimVerifierSystemPrompt('team-meet', 'spoken', { noDocuments: true }), clause);
  });

  test('IntelligenceEngine passes "no documents" to the kind, the gate and the instructions', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'IntelligenceEngine.ts'), 'utf8');
    assert.match(src, /const noDocuments = cv\.materialHasNoDocuments\(opts\.material\);/);
    assert.match(src, /cv\.claimVerifierKind\(\{ modeId: opts\.modeId, question: opts\.question, draft: opts\.answer, surface: 'spoken', noDocuments \}\)/);
    assert.match(src, /if \(noDocuments && !cv\.claimVerifierRunsWithoutDocuments\(opts\.modeId, opts\.answer\)\) \{/);
    assert.match(src, /cv\.claimVerifierSystemPrompt\(opts\.modeId, 'spoken', \{ noDocuments \}\)/);
  });

  // A started meeting packs the live transcript as evidence on every press (seen live 2026-11-22: General ran the
  // pass on 15 of 15 meeting presses, the interview modes on 0 of 30). The tag shape is context-packer.ts's.
  const ev = (type, id = 'x') => `<evidence evidence_id="ev-${id}" source_type="${type}" source_id="${id}" version_id="live">text</evidence>`;
  const TRANSCRIPT = `# Evidence\n${ev('MEETING_TRANSCRIPT', 'transcript:live')}`;
  const WITH_RESUME = `${TRANSCRIPT}\n${ev('PROFILE_RESUME', 'resume')}`;

  test('the live transcript alone is not a document', () => {
    assert.equal(cv.materialHasNoDocuments(''), true);
    assert.equal(cv.materialHasNoDocuments('Nothing was searched for this turn.'), true);
    assert.equal(cv.materialHasNoDocuments(TRANSCRIPT), true);
    assert.equal(cv.materialHasNoDocuments(`${TRANSCRIPT}\n${ev('MEETING_TRANSCRIPT', 'transcript:live-1')}`), true);
    assert.equal(cv.materialHasNoDocuments(WITH_RESUME), false);
    for (const t of ['REFERENCE_FILE', 'MODE_REFERENCE_FILE', 'CANDIDATE_FILE', 'PROJECT_FILE', 'MEETING_NOTE', 'PROFILE_FACT'])
      assert.equal(cv.materialHasNoDocuments(`${TRANSCRIPT}\n${ev(t, 'f')}`), false, t);
    assert.equal(cv.materialHasNoDocuments('<evidence evidence_id="ev-1">no type</evidence>'), false, 'no source_type counts as a document');
  });

  test('in a meeting with no file: interview modes get the pass and the hedging rule, the rest skip it', () => {
    const noDocuments = cv.materialHasNoDocuments(TRANSCRIPT);
    const draft = 'We use GitHub Actions for CI.';
    for (const m of ['looking-for-work', 'technical-interview']) {
      assert.equal(cv.claimVerifierKind({ modeId: m, question: 'What CI tool does your team use?', draft, surface: 'spoken', noDocuments }), 'personal', m);
      assert.equal(cv.claimVerifierRunsWithoutDocuments(m), true, m);
      assert.match(cv.claimVerifierSystemPrompt(m, 'spoken', { noDocuments }), /change only that phrase into its typical, hedged form/, m);
      // With a résumé they stay off, as decided for documents.
      assert.equal(cv.claimVerifierKind({ modeId: m, question: 'What CI tool does your team use?', draft: 'Sure.', surface: 'spoken', noDocuments: cv.materialHasNoDocuments(WITH_RESUME) }), null, m);
    }
    // F-LAT-04: every other mode runs the pass only with documents, so the gate skips it on a transcript-only turn.
    for (const m of ['general', 'team-meet', 'recruiting', 'seminar', 'sales', 'call-center']) assert.equal(cv.claimVerifierRunsWithoutDocuments(m, 'Usually two weeks, I can check.'), false, m);
  });

  test('General without a file runs the pass only when the draft states the user\'s own setup as fact (2026-11-22)', () => {
    const noDocuments = cv.materialHasNoDocuments(TRANSCRIPT);
    // The two flat answers from the meeting re-test.
    for (const draft of ['I report to an engineering manager on the delivery side.', 'We use CI for every merge, so builds run on each pull request.', 'Our sprints run two weeks.', 'Yeah, we do. Sprints run **two weeks** on our side, with the usual standups.']) {
      assert.equal(cv.claimVerifierRunsWithoutDocuments('general', draft), true, draft);
      assert.equal(cv.claimVerifierKind({ modeId: 'general', question: 'Who do you report to?', draft, surface: 'spoken', noDocuments }), 'life', draft);
    }
    // Hedged or not about the user's setup: no pass, so the press keeps the F-LAT-04 latency.
    for (const draft of ['Usually that\'s an engineering manager, I can confirm the exact line.', 'Merge sort is O(n log n) in every case.', 'Sounds good, let\'s pick it up Thursday.'])
      assert.equal(cv.claimVerifierRunsWithoutDocuments('general', draft), false, draft);
    // Its prompt gets General's wording of the hedging rule; with a file, or typed, it does not.
    const p = cv.claimVerifierSystemPrompt('general', 'spoken', { noDocuments });
    assert.match(p, /Nothing about the speaker's own setup is loaded/);
    assert.match(p, /change only that phrase into its typical, hedged form/);
    assert.doesNotMatch(p, /candidate|interviewer/);
    assert.doesNotMatch(cv.claimVerifierSystemPrompt('general', 'spoken', { noDocuments: false }), /typical, hedged form/);
    assert.doesNotMatch(cv.claimVerifierSystemPrompt('general', 'typed', { noDocuments }), /typical, hedged form/);
    // The other no-documents modes are unchanged.
    for (const m of ['team-meet', 'recruiting', 'seminar']) assert.doesNotMatch(cv.claimVerifierSystemPrompt(m, 'spoken', { noDocuments }), /typical, hedged form/, m);
  });

  test('the hotkey gate passes the draft, so General\'s own-side rule reaches it', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../IntelligenceEngine.ts'), 'utf8');
    assert.match(src, /if \(noDocuments && !cv\.claimVerifierRunsWithoutDocuments\(opts\.modeId, opts\.answer\)\)/);
  });

  test('restore env', () => {
    if (saved.i !== undefined) process.env.NATIVELY_CLAIM_VERIFIER_INTERVIEW = saved.i;
    if (saved.d !== undefined) process.env.NATIVELY_CLAIM_VERIFIER_NO_DOCS = saved.d;
  });
});

describe('an edited answer keeps the answer\'s shape: gist line and spoken format (2026-11-21)', async () => {
  const cv = await import('../../../dist-electron/electron/llm/claimVerifier.js');
  const MATERIAL = '# Question\nHow long is your sprint typically?\n# Evidence\nNo reference material is attached.';
  const ORIGINAL = 'We run two-week sprints with planning, a daily standup and a retro, and it has worked well for the team so far.\n[[GIST]] two-week sprints, standard ceremonies';

  test('the spoken prompt carries the answer\'s format rules and asks for a fresh gist line; the typed one does not', () => {
    const spoken = cv.claimVerifierSystemPrompt('team-meet', 'spoken');
    assert.match(spoken, /no em dashes, en dashes, semicolons, hyphen bullets, headings, brackets or placeholders, and at most three short \*\*marks\*\*/);
    assert.match(spoken, /its very last line is \[\[GIST\]\] followed on that same line by the five-to-eight-word essence of the revised reply/);
    assert.doesNotMatch(cv.claimVerifierSystemPrompt('team-meet', 'typed'), /\[\[GIST\]\]/);
  });
  test('the interview hedging rule changes only the flagged phrase', () => {
    assert.match(cv.claimVerifierSystemPrompt('looking-for-work', 'spoken', { noDocuments: true }), /change only that phrase into its typical, hedged form .* every other sentence stays word for word/);
  });
  test('an edit with its own gist line keeps it', () => {
    const v = cv.acceptVerifiedAnswer({ original: ORIGINAL, material: MATERIAL,
      edited: 'Sprints usually run two weeks, with planning, a daily standup and a retro, and I can confirm the exact cadence after this.\n[[GIST]] usually two weeks, confirming after' });
    assert.equal(v.changed, true);
    assert.match(v.text, /\n\[\[GIST\]\] usually two weeks, confirming after$/);
  });
  test('an edit gist with a new number or a source word is dropped, and the stale gist does not come back', () => {
    for (const g of ['usually three weeks, 3 sprints', 'the material says two weeks']) {
      const v = cv.acceptVerifiedAnswer({ original: ORIGINAL, material: MATERIAL,
        edited: `Sprints usually run around two weeks, and I can confirm the exact cadence after this call today.\n[[GIST]] ${g}` });
      assert.equal(v.changed, true, g);
      assert.doesNotMatch(v.text, /GIST/, g);
    }
  });
  test('with no gist from the edit, the old gist stays only when its words survived', () => {
    const kept = cv.acceptVerifiedAnswer({ original: 'Our sprints run two weeks with standard ceremonies, planning and a retro, and it works.\n[[GIST]] sprints, standard ceremonies',
      material: MATERIAL, edited: 'Sprints usually run two weeks with standard ceremonies, planning and a retro, and I can confirm it after this.' });
    assert.match(kept.text, /\n\[\[GIST\]\] sprints, standard ceremonies$/);
    const dropped = cv.acceptVerifiedAnswer({ original: ORIGINAL, material: MATERIAL,
      edited: 'Sprints usually run two weeks, with planning, a daily standup and a retro, and I can confirm the cadence after this.' });
    assert.doesNotMatch(dropped.text, /GIST/);
  });
  test('an edit that only removes dashes or semicolons keeps the original answer', () => {
    const orig = 'Usually two weeks; I would confirm the exact cadence — after this call.\n[[GIST]] usually two weeks';
    const v = cv.acceptVerifiedAnswer({ original: orig, material: MATERIAL, edited: 'Usually two weeks, I would confirm the exact cadence, after this call.' });
    assert.equal(v.changed, false);
    assert.equal(v.text, orig);
  });
});

describe('a bold pair that faces the wrong way loses its marks (2026-11-21)', async () => {
  const ap = await import('../../../dist-electron/electron/llm/answerPolish.js');
  test('the live case', () => {
    assert.equal(ap.dropInvertedBoldPairs('We work in sprints, and a two-week** cycle is the **typical rhythm.'), 'We work in sprints, and a two-week cycle is the typical rhythm.');
    assert.equal(ap.cleanAnswerArtifacts('We work in sprints, and a two-week** cycle is the **typical rhythm.'), 'We work in sprints, and a two-week cycle is the typical rhythm.');
  });
  test('valid bold, neighbouring pairs, math, inline code and an odd mark are untouched', () => {
    for (const t of ['Typically **GitHub Actions** or **GitLab CI**, tied to the repo.', 'Use **one** tool.', '2**8 is 256.', 'a ** b ** c', 'Call `f(**kwargs)` then **ship** it.', 'A stray ** mark.', 'Line one**\n**line two']) assert.equal(ap.dropInvertedBoldPairs(t), t, t);
  });
  test('the interview hedging example names the report-to slip', async () => {
    const cv = await import('../../../dist-electron/electron/llm/claimVerifier.js');
    assert.match(cv.claimVerifierSystemPrompt('technical-interview', 'spoken', { noDocuments: true }), /"I report to the engineering manager" becomes "usually that's an engineering manager, I can confirm the exact line"/);
  });
});

describe('planning text that narrates the exchange is not shown (2026-11-22)', async () => {
  const pp = await import('../../../dist-electron/electron/llm/planningPreamble.js');
  const LEAK = "how the user handles on-call,  that's a question back at the interviewer, so answer it as a genuine question about their setup:\n\nOn-call is one I'd rather ask about than assume, since I want to understand how your team actually runs it. How is it structured on your side?";
  const ANSWER = "On-call is one I'd rather ask about than assume, since I want to understand how your team actually runs it. How is it structured on your side?";

  test('the live leak is removed', () => {
    const r = pp.stripPlanningPreamble(LEAK);
    assert.equal(r.repaired, true);
    assert.equal(r.text, ANSWER);
  });

  test('each frame on its own', () => {
    for (const lead of [
      'The user wants their own setup described, not the interviewer\'s.',
      'That is a question back to the interviewer.',
      'So answer it as a genuine question about their setup:',
    ]) assert.equal(pp.stripPlanningPreamble(`${lead}\n\n${ANSWER}`).text, ANSWER, lead);
  });

  test('spoken answers that only look close stay whole', () => {
    for (const a of [
      'The user clicks checkout and the cart is locked for ten minutes, so two tabs cannot double-buy.',
      'I would answer the pager within five minutes, then hand off after the incident review.',
      'So we treat it as a cache miss and fall back to the database.',
      'iOS builds go through the same pipeline, just on a mac runner.',
      'useEffect runs after paint, so the measurement happens one frame late.',
    ]) assert.equal(pp.stripPlanningPreamble(a).text, a, a);
  });

  test('streamed in small chunks, the gate shows exactly what the final strip keeps', () => {
    for (const full of [LEAK, ANSWER, 'useEffect runs after paint, so the measurement happens one frame late.', 'iOS builds go through the same pipeline.']) {
      for (const size of [1, 3, 7, 40]) {
        const g = new pp.PreambleStreamGate();
        let shown = '';
        for (let i = 0; i < full.length; i += size) shown += g.push(full.slice(i, i + size));
        shown += g.flush();
        assert.equal(shown.trim(), pp.stripPlanningPreamble(full).text.trim(), `${size}: ${full.slice(0, 30)}`);
      }
    }
  });

  test('a lowercase opening is held only until its first sentence ends', () => {
    const g = new pp.PreambleStreamGate();
    assert.equal(g.push('useEffect runs after paint'), '');
    assert.equal(g.push('. Then'), 'useEffect runs after paint. Then');
    assert.equal(g.isReleased, true);
  });
});
