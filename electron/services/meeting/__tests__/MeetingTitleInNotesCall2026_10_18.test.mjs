// Meeting title in the notes call (2026-10-18, owner request): titles are at most
// 50 characters including spaces, one line, and are written by the notes call that
// already reads the whole meeting, never by a model call of their own.
//
// Pure modules only; no Electron, no database, no model calls (mocked helpers).
// Nothing here branches on the platform, so the same assertions hold on macOS and
// Windows.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../../..');
const dist = (rel) => pathToFileURL(path.resolve(root, 'dist-electron/electron', rel)).href;

const { MEETING_TITLE_MAX_CHARS, MEETING_TITLE_RULE, cleanMeetingTitle, fitTitleLength, firstSentenceOf, isAnswerFragmentTitle, isEmptySessionTitle, isNarrationTitle } = await import(dist('services/meeting/MeetingSummaryV3.js'));
const { vetProposedTitle } = await import(dist('MeetingPersistence.js'));
const { SummaryPolisher } = await import(dist('services/meeting/SummaryPolisher.js'));
const { MeetingContextAssembler } = await import(dist('services/meeting/MeetingContextAssembler.js'));
const short = await import(dist('services/meeting/shortSessionNotes.js'));
const v2 = await import(dist('services/meeting/v2FallbackNotes.js'));
const prompts = await import(dist('llm/prompts.js'));

const POLISH_PARAMS = {
  deterministicSummary: ['Adopt PostHog for analytics'],
  decisions: [{ text: 'Adopt PostHog for analytics', confidence: 'high' }],
  actionItems: [], risks: [], sections: [], mode: 'general',
  briefs: ['The team compared analytics tools.', 'The team picked PostHog.'], topics: ['analytics'],
};

describe('the bound', () => {
  test('50 characters, stated in the prompt rule and enforced by the clamp', () => {
    assert.equal(MEETING_TITLE_MAX_CHARS, 50);
    assert.match(MEETING_TITLE_RULE, /At most 50 characters including spaces, on one line/);
    const out = cleanMeetingTitle('Quarterly analytics platform migration and vendor review');
    assert.ok(out.length <= 50, `${out.length}: ${out}`);
  });
});

describe('the overview call names the meeting', () => {
  test('one call, asking for the title in the same JSON, which comes back unvetted', async () => {
    const calls = [];
    const llm = {
      generateMeetingSummary: async (system) => {
        calls.push(system);
        return JSON.stringify({ title: 'PostHog analytics decision', overview: 'The team compared analytics tools and picked PostHog.' });
      },
    };
    const out = await new SummaryPolisher(llm).polishOverview(POLISH_PARAMS);
    assert.equal(calls.length, 1, 'naming the meeting must not cost a request');
    assert.match(calls[0], /- "title": the meeting's name, the way a well-named calendar event reads/);
    assert.match(calls[0], /\{ "title": "[^"]+", "overview": "/);
    assert.deepEqual(out, { overview: 'The team compared analytics tools and picked PostHog.', title: 'PostHog analytics decision' });
  });

  test('the title survives an overview the gate rejects', async () => {
    const llm = {
      generateMeetingSummary: async () => JSON.stringify({ title: 'PostHog analytics decision', overview: 'Zelda from Contoso signed a $90,000 contract.' }),
    };
    const out = await new SummaryPolisher(llm).polishOverview(POLISH_PARAMS);
    assert.equal(out.overview, null);
    assert.equal(out.title, 'PostHog analytics decision');
  });

  test('no title in the reply, or no notes, gives a null title', async () => {
    const llm = { generateMeetingSummary: async () => JSON.stringify({ overview: 'The team compared analytics tools and picked PostHog.' }) };
    assert.equal((await new SummaryPolisher(llm).polishOverview(POLISH_PARAMS)).title, null);
    const empty = { ...POLISH_PARAMS, deterministicSummary: [], decisions: [], briefs: [], topics: [] };
    assert.deepEqual(await new SummaryPolisher(llm).polishOverview(empty), { overview: null, title: null });
  });

  test('the assembler hands the proposed title back next to the notes', async () => {
    const llm = {
      generateMeetingSummary: async (system) => {
        if (/Write an overview of the ENTIRE meeting/.test(system)) {
          return JSON.stringify({ title: 'Security questionnaire for Acme', overview: 'Dana asked for the security questionnaire.' });
        }
        if (/Rewrite the meeting summary/.test(system)) return JSON.stringify({ summary: ['Dana asked for the security questionnaire.'] });
        if (/^Name this meeting/.test(system)) return JSON.stringify({ title: 'Acme security questionnaire' });
        return JSON.stringify({ chunkIndex: 0, timeRange: {}, brief: 'Dana asked for the security questionnaire.', topics: ['security'], decisions: [], actionItems: [], openQuestions: [], risks: [], people: [], importantQuotes: [], modeSpecificFindings: {} });
      },
    };
    const transcript = Array.from({ length: 6 }, (_, i) => ({ speaker: i % 2 ? 'interviewer' : 'user', text: `Line ${i} about the security questionnaire for Acme`, timestamp: 1000 + i * 10000, origin: 'stt' }));
    const res = await new MeetingContextAssembler(llm).assembleSummary({ transcript, polishSummary: true });
    assert.ok(res.summary);
    assert.equal(res.proposedTitle, 'Security questionnaire for Acme');

    // Review fix 2026-10-18: with the polish off there is no overview call to carry
    // the name, so a title-only call names the meeting instead of leaving it unnamed.
    const off = await new MeetingContextAssembler(llm).assembleSummary({ transcript, polishSummary: false });
    assert.equal(off.proposedTitle, 'Acme security questionnaire');
  });
});

describe('the short-session call and the V2 fallback name the meeting too', () => {
  test('short session: the prompt asks for a title, the parser keeps it', () => {
    assert.match(short.SHORT_SESSION_PROMPT, /- "title": the meeting's name[^\n]*At most 50 characters/);
    assert.match(short.SHORT_SESSION_PROMPT, /"title": "the meeting's name",/);
    assert.deepEqual(short.parseShortSessionNotes('{"title":"  Greeting  and model question ","overview":"A greeting.","keyPoints":[]}'),
      { title: 'Greeting and model question', overview: 'A greeting.', keyPoints: [], actionItems: [] });
  });

  test('V2: both prompt shapes and the Groq prompt ask for a title, the parser keeps it', () => {
    const free = v2.buildV2FallbackPrompts({ modeNoteSections: [], groqGenericPrompt: prompts.GROQ_SUMMARY_JSON_PROMPT });
    const mode = v2.buildV2FallbackPrompts({ modeNoteSections: [{ title: 'Risks', description: '' }], groqGenericPrompt: prompts.GROQ_SUMMARY_JSON_PROMPT });
    for (const p of [free.summaryPrompt, mode.summaryPrompt, prompts.GROQ_SUMMARY_JSON_PROMPT]) {
      assert.match(p, /- "title": the meeting's name[^\n]*At most 50 characters/);
      assert.match(p, /"title": "the meeting's name"/);
    }
    assert.equal(v2.parseV2SummaryResponse('{"title":"Pilot plan","overview":"o","keyPoints":["k"]}', []).title, 'Pilot plan');
    assert.equal(v2.parseV2SummaryResponse('{"title":"Pilot plan","overview":"o","sections":{"Risks":["r"]}}', [{ title: 'Risks', description: '' }]).title, 'Pilot plan');
    assert.equal('title' in v2.parseV2SummaryResponse('{"overview":"o","keyPoints":["k"]}', []), false);
  });
});

// Real titles saved before this change (2026-10-18), and what each becomes now.
describe('titles read as names, within 50 characters, on one line', () => {
  test('narration, empty-session and cut-sentence proposals are rejected as names', () => {
    for (const t of [
      'User asked the assistant to resume; the assistant answered',
      'User mentions 40 days',
      'A very short session in which Evin asked what an API is',
      'No Source Text Provided',
      'Session with no substantive content',
      'Evin said circular tide was not',
      'Evin: HackerRank was not flagging anything',
      'Autofocus/manual focus was mentioned',
      'A very short session',
    ]) assert.equal(isAnswerFragmentTitle(cleanMeetingTitle(t)), true, `accepted as a name: ${t}`);
  });

  test('good names pass untouched', () => {
    for (const t of ['API Basics and REST vs GraphQL Questions', 'Competitiveness of a 7 LPA Offer', 'UI Redesign: Removing Hover Feature', 'Natively Demo & Guide', 'Quick greeting']) {
      assert.equal(cleanMeetingTitle(t), t);
      assert.equal(isAnswerFragmentTitle(t), false, t);
    }
  });

  test('an over-long name is cut at a phrase break, never mid-thought', () => {
    // The longer whole-phrase cut wins over the colon (review fix 2026-10-18).
    assert.equal(cleanMeetingTitle('Q3 roadmap planning: billing migration deferral and hiring'), 'Q3 roadmap planning: billing migration deferral');
    assert.equal(cleanMeetingTitle('Acme renewal pricing with Dana Fox and the procurement team'), 'Acme renewal pricing with Dana Fox');
    assert.equal(cleanMeetingTitle('Discussion of the backend engineer interview loop'), 'Backend engineer interview loop');
    // The clamp can cut a description of the session into a harmless-looking
    // shape; the reply is judged as written as well.
    assert.deepEqual(vetProposedTitle('A very short session in which Evin asked what an API is and', { overview: 'Evin asked what an API is.', topics: ['API basics'] }), { title: 'API basics', source: 'fallback' });
    for (const t of ['Evin said circular tide was not', 'Evin asked what his name is and what the other person’s name is']) {
      const out = cleanMeetingTitle(t + ' going to be a problem for the release next week at all');
      assert.ok(out.length <= MEETING_TITLE_MAX_CHARS, out);
      assert.doesNotMatch(out, /\b(?:was|not|the|what|and)$/i, `ends mid-thought: ${out}`);
    }
  });

  test('the note-derived title drops speaker labels and session preambles and ends on a phrase', () => {
    const fallback = (summary) => vetProposedTitle(undefined, summary).title;
    assert.equal(fallback({ keyPoints: ['Evin: HackerRank was not flagging anything during the test'] }), 'HackerRank was not flagging anything');
    // Narration once the preamble is gone ("Evin asked…") is not a name either
    // (review fix 2026-10-18): with nothing else in the notes the default stays.
    assert.equal(fallback({ overview: 'A very short session in which Evin asked what an API is and what the other person thought.' }), null);
    assert.equal(fallback({ topics: ['onboarding', 'pilot', 'security review'] }), 'Onboarding, pilot and security review');
    assert.equal(fallback({ overview: 'The team reviewed the onboarding funnel, agreed to cut the second step, and asked Priya to rerun the numbers by Friday.' }), 'The team reviewed the onboarding funnel');
    assert.equal(fallback({ keyPoints: ['Evin asked what his name is and what the other person’s name is, then asked about the weather'] }), null,
      'reported speech is narration, not a name');
    for (const summary of [
      { keyPoints: ['Evin asked what his name is and what the other person’s name is, then asked about the weather', 'Weather small talk before the interview'] },
      { overview: 'The team reviewed the onboarding funnel, agreed to cut the second step, and asked Priya to rerun the numbers by Friday.' },
    ]) {
      const t = fallback(summary);
      assert.ok(t.length <= 50, `${t.length}: ${t}`);
      assert.doesNotMatch(t, /\b(?:was|not|the|what|and|to)$/i, `ends mid-thought: ${t}`);
    }
  });
});

// "Session très courte sans contenu substantiel" and "Which Number Is Odd Or Even"
// were real saved titles. Both shapes are judged in every language the notes come in.
describe('empty-session descriptions and questions are not names, in any notes language', () => {
  const rejected = (t) => isAnswerFragmentTitle(cleanMeetingTitle(t)) || isAnswerFragmentTitle(t);

  test('a description of an empty or very short session is rejected', () => {
    for (const t of [
      'Session très courte sans contenu substantiel', 'Réunion vide', 'Sesión muy corta sin contenido',
      'Sessão curta sem conteúdo', 'Sehr kurze Sitzung ohne Inhalt', 'Sessione breve senza contenuto',
      'Очень короткая встреча без содержания', '内容なしの短いセッション', '没有实质内容的简短会话',
      'बहुत छोटा सत्र, कोई सामग्री नहीं', 'ചെറിയ സെഷൻ, ഉള്ളടക്കമില്ല', 'Empty transcript', 'No Source Text Provided',
    ]) assert.equal(rejected(t), true, `accepted as a name: ${t}`);
  });

  test('a question is rejected', () => {
    for (const t of [
      'Which Number Is Odd Or Even', 'What Is An API Explained', 'Is It Worth Migrating to Kafka', 'Kafka or RabbitMQ?',
      '¿Qué es una API', 'Pourquoi le build échoue', "Qu'est-ce qu'une API", 'Was ist eine API', 'Почему падает сборка',
      'APIとは何ですか', '什么是API', 'क्या यह काम करेगा',
    ]) assert.equal(rejected(t), true, `accepted as a name: ${t}`);
  });

  test('names that only look close are kept: how-tos, "short" and "content" as subjects', () => {
    for (const t of [
      'How to Scale Postgres', 'How We Ship Releases', 'Who Owns the Roadmap', 'What We Ship In Q3', 'Comment faire un CV',
      '如何部署服务', 'Как мы выпускаем релизы', 'Quick greeting', 'Short-term pricing plan', 'Content strategy review',
      'Session planning with Acme', 'Revue du contenu marketing', 'Kurze Einführung in Kafka', 'Data contract with no breaking changes',
    ]) assert.equal(isAnswerFragmentTitle(cleanMeetingTitle(t)), false, `rejected a real name: ${t}`);
  });

  test('the note-derived title skips the same shapes, and an empty session keeps its default', () => {
    assert.equal(vetProposedTitle('Which Number Is Odd Or Even', { keyPoints: ['Which number is odd or even?', 'Checked parity with the modulo operator'] }).title,
      'Checked parity with the modulo operator');
    // Nothing in the notes names anything: no title, so the meeting keeps its
    // default rather than a description of its emptiness.
    assert.deepEqual(vetProposedTitle('Session très courte sans contenu substantiel', { overview: 'Session très courte sans contenu substantiel.' }),
      { title: null, source: 'none' });
  });
});

// ── Code-review fixes (2026-10-18) ───────────────────────────────────────────
describe('review fixes', () => {
  test('a short session keeps the name the rule asks for, though its notes never use the word', () => {
    assert.deepEqual(vetProposedTitle('Quick greeting', { overview: 'Evin said hello and the call ended.', keyPoints: [] }),
      { title: 'Quick greeting', source: 'model' });
    // Word forms ground a title too: "greeted" grounds "greeting".
    const longer = {
      overview: 'Evin greeted the candidate, confirmed the audio worked, explained the interview format, and agreed to reschedule the technical round because the candidate had a conflicting appointment tomorrow afternoon.',
      keyPoints: [],
    };
    assert.equal(vetProposedTitle('Candidate greeting', longer).source, 'model');
    // The RC-9 hallucination check still runs on a meeting with real notes.
    assert.equal(vetProposedTitle('Penetration testing review', longer).source, 'fallback');
  });

  test('subjects that start like narration are names; narration is not', () => {
    for (const t of ['User research synthesis', 'User onboarding flow review', 'Assistant manager interview', 'Release notes review',
      'Lecture notes on photosynthesis', 'Study notes for biology', 'Board asks for budget cut', 'Team shares Q3 results', 'Frequently asked questions', 'Kubernetes explained', 'Google shared drive cleanup']) {
      assert.equal(isAnswerFragmentTitle(t), false, t);
    }
    for (const t of ['User asked the assistant to resume', 'The assistant answered the question', 'User mentions the deadline',
      'Evin said circular tide was not', 'Evin asked what an API is', 'Priya wants to cancel', 'Evin explained the plan']) {
      assert.equal(isNarrationTitle(t), true, t);
      assert.equal(isAnswerFragmentTitle(t), true, t);
    }
  });

  test('an abbreviation or a version number never ends the first sentence', () => {
    assert.equal(firstSentenceOf('Sync with Dr. Patel about the Q3 budget. Then hiring.'), 'Sync with Dr. Patel about the Q3 budget.');
    assert.equal(firstSentenceOf('Q3 vs. Q4 roadmap planning. More text.'), 'Q3 vs. Q4 roadmap planning.');
    assert.equal(firstSentenceOf('Upgrade to Node 22.5 planned. Done.'), 'Upgrade to Node 22.5 planned.');
    const cut = cleanMeetingTitle('Kickoff with St. Jude Hospital on the patient intake redesign and scheduling');
    assert.match(cut, /^Kickoff with St\. Jude Hospital/);
    assert.ok(cut.length <= 50, cut);
    const backup = vetProposedTitle(undefined, { tldr: ['Met with Dr. Patel about the Q3 budget.'], topics: [] }).title;
    assert.equal(backup, 'Met with Dr. Patel about the Q3 budget');
  });

  test('the note-built backup skips narration and emptiness and keeps the default when nothing else is left', () => {
    assert.equal(vetProposedTitle(undefined, { overview: 'Nothing of substance was discussed in this brief session.', keyPoints: [] }).title, null);
    assert.equal(vetProposedTitle(undefined, { overview: 'The user asked the assistant what an API is, and it answered with a definition.', keyPoints: [] }).title, null);
    assert.equal(vetProposedTitle(undefined, { tldr: ['Evin said hello.', 'Pricing for the Acme renewal was agreed at list price.'], overview: '' }).title,
      'Pricing for the Acme renewal was agreed');
  });

  test('"without data" is a subject, and one empty topic does not throw away the others', () => {
    for (const t of ['Launch without data migration', 'No data loss strategy', 'Data without context problem', 'Shipping without data loss']) {
      assert.equal(isEmptySessionTitle(t), false, t);
    }
    for (const t of ['No Source Text Provided', 'Session without any content', 'Brief call with no discussion', 'No context provided', 'Nothing of substance was discussed']) {
      assert.equal(isEmptySessionTitle(t), true, t);
    }
    assert.equal(vetProposedTitle(undefined, { topics: ['No substantive content', 'Hiring', 'Budget'] }).title, 'Hiring and Budget');
  });

  test('a cut never ends on a negation, and a list keeps its items', () => {
    const neg = fitTitleLength('Evin said circular tide was not about the moon at all here');
    assert.doesNotMatch(neg, /\bnot$/, neg);
    assert.equal(fitTitleLength('Kickoff: scope, timeline, owners and risks for Acme Corp rollout'), 'Kickoff: scope, timeline, owners and risks');
    // A joining word that leaves only a verb after the comma still cuts at the comma.
    assert.equal(cleanMeetingTitle('Discussion of the onboarding funnel, agreed to cut steps for new users'), 'Onboarding funnel');
  });

  test('a complexity inside a full name is a name', () => {
    assert.equal(isAnswerFragmentTitle('Two Sum in O(n) with a hash map'), false);
    assert.equal(isAnswerFragmentTitle('O(n log n)'), true);
    assert.equal(isAnswerFragmentTitle('The two-pointer approach solves this in O(n) time'), true);
  });

  test('a title that invents a fact is dropped with its overview; a clean one survives a rejected overview', async () => {
    const invented = { generateMeetingSummary: async () => JSON.stringify({ title: 'Contoso contract signing', overview: 'Zelda from Contoso signed a $90,000 contract.' }) };
    assert.deepEqual(await new SummaryPolisher(invented).polishOverview(POLISH_PARAMS), { overview: null, title: null });
    const numbers = { generateMeetingSummary: async () => JSON.stringify({ title: 'Q4 analytics decision', overview: 'The team compared analytics tools and picked PostHog.' }) };
    assert.equal((await new SummaryPolisher(numbers).polishOverview(POLISH_PARAMS)).title, null, 'Q4 is not in the notes');
    const clean = { generateMeetingSummary: async () => JSON.stringify({ title: 'PostHog Analytics Decision', overview: 'The team compared analytics tools and picked PostHog.' }) };
    assert.equal((await new SummaryPolisher(clean).polishOverview(POLISH_PARAMS)).title, 'PostHog Analytics Decision', 'Title Case is not an invented name');
  });

  test('with the polish off, one small call writes only the title', async () => {
    const calls = [];
    const llm = { generateMeetingSummary: async (system) => { calls.push(system); return JSON.stringify({ title: 'PostHog analytics decision' }); } };
    assert.equal(await new SummaryPolisher(llm).nameMeeting(POLISH_PARAMS), 'PostHog analytics decision');
    assert.equal(calls.length, 1);
    assert.match(calls[0], /^Name this meeting/);
    assert.match(calls[0], /At most 50 characters including spaces/);
    assert.doesNotMatch(calls[0], /overview/i, 'the title-only call writes no overview');
  });
});
