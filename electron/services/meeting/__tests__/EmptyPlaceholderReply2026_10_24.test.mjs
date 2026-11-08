// GitHub #662 (Windows 11, 2.9.2): after a meeting that only caught the user's own
// voice, the Summary tab read "empty summary array." The polish prompt says "If the
// notes contain no concrete outcome, return an empty "summary" array", and a model
// that writes that instruction back as a sentence passed every check: "Empty" opens
// the sentence (not read as a name), "summary" is a stopword and "array" is not a
// fact. The deterministic summary was replaced with the placeholder.
//
// Also: an empty reply (the answer the prompt asks for) failed validation and paid
// for a repair retry that sees neither the notes nor the rule, which pushes the
// model to write filler. Overview, titles and the V2 fallback notes had the same
// "return an empty ..." hole.
//
// Pure modules with a mocked helper; no Electron, no model calls. Nothing here
// branches on the platform, so the same assertions hold on macOS and Windows.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../../..');
const dist = (rel) => pathToFileURL(path.resolve(root, 'dist-electron/electron', rel)).href;

const { SummaryPolisher } = await import(dist('services/meeting/SummaryPolisher.js'));
const { isEmptyPlaceholder, isEmptyListPlaceholder, isEmptySessionTitle, sanitizeDecisions, sanitizeActions, sanitizeRisks, sanitizeQuestions, sanitizeStringArray, validateMeetingSummaryV3 } = await import(dist('services/meeting/MeetingSummaryV3.js'));
const { MeetingSummarySchemaValidator } = await import(dist('services/meeting/MeetingSummarySchemaValidator.js'));
const { parseV2SummaryResponse } = await import(dist('services/meeting/v2FallbackNotes.js'));
const { vetProposedTitle } = await import(dist('MeetingPersistence.js'));
const { MeetingSummaryReducer } = await import(dist('services/meeting/MeetingSummaryReducer.js'));
const { TranscriptNormalizer } = await import(dist('services/meeting/TranscriptNormalizer.js'));

const PARAMS = {
  deterministicSummary: ['I walked through my background in data engineering'],
  decisions: [], actionItems: [], risks: [], sections: [], mode: 'general',
  briefs: ['The user described their data engineering background.'], topics: ['data engineering'],
};

/** A helper that answers every call with `reply` and records the system prompts. */
const replying = (reply) => {
  const calls = [];
  return { calls, generateMeetingSummary: async (system) => { calls.push(system); return typeof reply === 'string' ? reply : JSON.stringify(reply); } };
};
const quiet = async (fn) => {
  const warn = console.warn;
  console.warn = () => {};
  try { return await fn(); } finally { console.warn = warn; }
};

const PLACEHOLDERS = [
  'empty summary array.', 'Empty summary array', '(empty)', 'An empty "summary" array.', 'Empty string', 'N/A', 'N.A.', 'None.', '[]', '—',
  'Empty — summary array', 'Empty summary array。', 'No summary available.', 'Nothing to summarize.', 'The summary is empty.',
  'No concrete outcome.', 'The notes contain no concrete outcome.', 'The notes contain no concrete outcomes to summarize.',
  'Tableau « summary » vide.', 'Resumen vacío', 'Пустой массив', '空数组', '摘要为空', 'なし',
  'Summary: N/A', 'Sin resumen', 'Keine Zusammenfassung', 'Overview: none',
  'सारांश खाली है।', 'कुछ नहीं', 'कोई नहीं', 'ഒന്നുമില്ല', 'സംഗ്രഹം ശൂന്യമാണ്.', 'ഇല്ല',
];

describe('a reply that restates the empty instruction is empty', () => {
  for (const line of PLACEHOLDERS) {
    test(`summary line ${JSON.stringify(line)} keeps the deterministic summary, with no repair call`, async () => {
      const llm = replying({ summary: [line] });
      const out = await new SummaryPolisher(llm).polish(PARAMS);
      assert.equal(out, null);
      assert.equal(llm.calls.length, 1, 'a repair retry would push the model into filler');
    });
  }

  test('an empty array, as the prompt asks, is accepted without a repair call', async () => {
    const llm = replying({ summary: [] });
    assert.equal(await new SummaryPolisher(llm).polish(PARAMS), null);
    assert.equal(llm.calls.length, 1);
  });

  test('a placeholder line next to a real one is dropped, the real one kept', async () => {
    const out = await new SummaryPolisher(replying({ summary: ['The user described their data engineering background.', 'Empty summary array.'] })).polish(PARAMS);
    assert.deepEqual(out, ['The user described their data engineering background.']);
  });

  test('an overview that restates the instruction is not saved, nor is its title, with no repair call', async () => {
    const llm = replying({ title: 'Empty title', overview: 'Empty overview string.' });
    const out = await new SummaryPolisher(llm).polishOverview(PARAMS);
    assert.deepEqual(out, { overview: null, title: null });
    assert.equal(llm.calls.length, 1);
  });

  test('an empty overview with a real title keeps the title', async () => {
    const out = await new SummaryPolisher(replying({ title: 'Data engineering background', overview: '' })).polishOverview(PARAMS);
    assert.deepEqual(out, { overview: null, title: 'Data engineering background' });
  });

  test('a placeholder title is not kept beside a real overview', async () => {
    const out = await new SummaryPolisher(replying({ title: 'empty "title"', overview: 'The user described their data engineering background.' })).polishOverview(PARAMS);
    assert.deepEqual(out, { overview: 'The user described their data engineering background.', title: null });
  });

  for (const title of ['Empty title.', 'None', '']) {
    test(`nameMeeting returns no title for ${JSON.stringify(title)}, with no repair call`, async () => {
      const llm = replying({ title });
      assert.equal(await new SummaryPolisher(llm).nameMeeting(PARAMS), null);
      assert.equal(llm.calls.length, 1, 'the repair call could invent a vague title such as "General Discussion"');
    });
  }

  test('a reply that is not the asked JSON still gets its one repair retry', async () => {
    const llm = replying('not json');
    assert.equal(await quiet(() => new SummaryPolisher(llm).polish(PARAMS)), null);
    assert.equal(llm.calls.length, 2);
  });
});

describe('every title source drops a placeholder title', () => {
  test('vetProposedTitle falls back to the note-derived title', () => {
    const summary = { tldr: ['The user described their data engineering background.'], topics: ['data engineering'] };
    for (const t of ['Empty title', 'N/A', 'None', 'Titre vide']) {
      assert.equal(isEmptySessionTitle(t), true, t);
      const out = quietSync(() => vetProposedTitle(t, summary));
      assert.notEqual(out.title, t);
      assert.equal(out.source, 'fallback', t);
    }
  });
});

describe('the V2 fallback notes drop placeholder bullets and overviews', () => {
  test('actionItems ["empty array"] and an "empty" overview are nothing; a key point "Empty array" is a note', () => {
    const out = parseV2SummaryResponse(JSON.stringify({
      title: 'Data engineering background',
      overview: 'Empty overview string.',
      keyPoints: ['The user described their data engineering background.', 'None', 'Empty array'],
      actionItems: ['empty array'],
      decisions: ['N/A'],
    }), []);
    assert.equal(out.overview, '');
    assert.deepEqual(out.keyPoints, ['The user described their data engineering background.', 'Empty array']);
    assert.deepEqual(out.actionItems, []);
    assert.equal(out.decisions, undefined);
  });

  test('a placeholder overview falls through to a real summary field', () => {
    const out = parseV2SummaryResponse(JSON.stringify({ overview: 'None', summary: 'The user described their data engineering background.' }), []);
    assert.equal(out.overview, 'The user described their data engineering background.');
  });

  test('an empty template section keeps its heading, without the "None" bullet', () => {
    const out = parseV2SummaryResponse(JSON.stringify({ overview: 'The user described their background.', sections: { Risks: ['None'] } }), [{ title: 'Risks' }]);
    assert.deepEqual(out.sections, [{ title: 'Risks', bullets: [] }]);
  });
});

describe('the V3 sanitizers drop placeholder decisions, actions, risks, questions and bullets', () => {
  test('lists the prompts say to return empty', () => {
    assert.deepEqual(sanitizeDecisions(['None', 'Empty array', 'Ship on Friday'], 10).map((d) => d.text), ['Ship on Friday']);
    assert.deepEqual(sanitizeActions([{ text: 'N/A' }, { text: 'Send the deck' }], 10).map((a) => a.text), ['Send the deck']);
    assert.deepEqual(sanitizeRisks([{ text: 'None' }, { text: 'Budget may slip' }], 10).map((r) => r.text), ['Budget may slip']);
    assert.deepEqual(sanitizeQuestions(['Nothing', 'Who owns billing?'], 10).map((q) => q.text), ['Who owns billing?']);
  });
  test('free notes keep "Empty array" as a note', () => {
    assert.deepEqual(sanitizeStringArray(['None', 'Empty array', 'Value is null'], 10), ['Empty array', 'Value is null']);
  });
});

describe('a "None" finding is no bullet in the V3 notes', () => {
  test('the chunk validator drops a "None" finding and its now-empty section', () => {
    const atoms = new MeetingSummarySchemaValidator().validateAndRepairAtoms({
      brief: 'Pricing talk', modeSpecificFindings: { Pricing: ['Price is 40 per seat', 'N/A'], Risks: ['None'] },
    }, 0, { allowedSectionTitles: ['Pricing', 'Risks'] });
    assert.deepEqual(atoms.modeSpecificFindings, { Pricing: [{ text: 'Price is 40 per seat' }] });
  });

  const atom = (findings, chunkIndex) => ({
    chunkIndex, timeRange: { startMs: 0, endMs: 60000 }, brief: 'chunk brief',
    topics: [], decisions: [], actionItems: [], openQuestions: [], risks: [], deadlines: [], people: [], importantQuotes: [],
    modeSpecificFindings: findings,
  });
  const reduce = (atoms) => validated(new MeetingSummaryReducer().reduce({
    title: 't',
    atoms,
    normalizedTranscript: new TranscriptNormalizer().normalize([{ speaker: 'user', text: 'pricing talk', timestamp: 0, final: true }]),
    modeTemplateType: 'sales',
    modeNoteSections: [{ title: 'Pricing' }, { title: 'Risks' }],
  }));
  // MeetingContextAssembler saves the reduced notes only through validateAndRepairSummary.
  const validated = (reduced) => {
    const res = validateMeetingSummaryV3(reduced);
    assert.ok(res.ok, res.errors?.join('; '));
    return res.data;
  };

  test('a section holding only "None" is left out, like a section the model returned empty', () => {
    const withNone = reduce([atom({ Pricing: [{ text: 'Price is 40 per seat', confidence: 'high' }], Risks: [{ text: 'None', confidence: 'high' }] }, 0)]);
    const empty = reduce([atom({ Pricing: [{ text: 'Price is 40 per seat', confidence: 'high' }], Risks: [] }, 0)]);
    assert.deepEqual(withNone.sections.map((s) => s.title), ['Pricing']);
    assert.deepEqual(withNone.sections.map((s) => s.title), empty.sections.map((s) => s.title));
  });

  test('a placeholder beside a real finding is dropped, the real one kept', () => {
    const out = reduce([atom({ Pricing: [{ text: 'N/A', confidence: 'high' }, { text: 'Price is 40 per seat', confidence: 'high' }] }, 0)]);
    assert.deepEqual(out.sections.find((s) => s.title === 'Pricing').bullets.map((b) => b.text), ['Price is 40 per seat']);
  });
});

describe('the prompts\' own "nothing" condition, written back, is a placeholder', () => {
  // Rewording a prompt's condition without updating isEmptyPlaceholder fails here.
  test('polish, overview and title prompts', async () => {
    const polishLlm = replying({ summary: [] });
    await new SummaryPolisher(polishLlm).polish(PARAMS);
    const overviewLlm = replying({ title: '', overview: '' });
    await new SummaryPolisher(overviewLlm).polishOverview(PARAMS);
    const nameLlm = replying({ title: '' });
    await new SummaryPolisher(nameLlm).nameMeeting(PARAMS);
    for (const prompt of [polishLlm.calls[0], overviewLlm.calls[0], nameLlm.calls[0]]) {
      const m = prompt.match(/If the notes contain (no [^,]+),/);
      assert.ok(m, 'the prompt states when to return empty');
      assert.equal(isEmptyPlaceholder(`The notes contain ${m[1]}.`), true, m[1]);
      assert.equal(isEmptyPlaceholder(`${m[1]}.`), true, m[1]);
    }
  });
});

describe('real text is not a placeholder', () => {
  for (const text of [
    // Edge cases and notes from a coding or hiring interview (prompts.ts lists "empty array" as an edge case).
    'Empty array',
    'Empty string',
    'Empty list',
    'Value is null',
    'Null pointer',
    'The response is empty',
    'Return null',
    'No resume provided',
    'Untitled document bug',
    '✅',
    '$',
    'No, this is the list',
    'No risks identified',
    'Kein Risiko',
    'Empty seats were discussed for the Q3 roadmap.',
    'The array of options was narrowed to two.',
    'The summary array export ships next week.',
    'None of the vendors met the latency target.',
    'Nothing was decided.',
    'No action items were assigned.',
    'Empty states review',
    'Q3 empty-container fees',
    'Blank-check approval',
    'Null hypothesis review',
    'NA rollout plan',
    'Data engineering background',
    'Rien de neuf sur le budget',
    'Lista de precios vacía para Q3',
    'Summary of the Acme renewal',
    'कोई निर्णय नहीं हुआ',
    'सारांश में कीमत पर चर्चा हुई',
    'വില ചർച്ച ചെയ്തു',
    'ഒന്നും തീരുമാനിച്ചില്ല, അടുത്ത ആഴ്ച വീണ്ടും',
  ]) {
    test(JSON.stringify(text), () => assert.equal(isEmptyPlaceholder(text), false));
  }

  test('"Empty array" and "Empty string" are placeholders only for a list the prompt said to return empty', () => {
    for (const t of ['Empty array', 'empty list', 'Empty string', 'Пустой массив', '空数组']) {
      assert.equal(isEmptyPlaceholder(t), false, t);
      assert.equal(isEmptyListPlaceholder(t), true, t);
    }
  });

  test('"Untitled" and "No title" are placeholders only as a title', () => {
    for (const t of ['Untitled', 'No title', 'Sans titre']) {
      assert.equal(isEmptyPlaceholder(t), false, t);
      assert.equal(isEmptySessionTitle(t), true, t);
    }
  });

  test('a real summary still goes through', async () => {
    const out = await new SummaryPolisher(replying({ summary: ['The user described their data engineering background.'] })).polish(PARAMS);
    assert.deepEqual(out, ['The user described their data engineering background.']);
  });
});

function quietSync(fn) {
  const warn = console.warn;
  console.warn = () => {};
  try { return fn(); } finally { console.warn = warn; }
}
