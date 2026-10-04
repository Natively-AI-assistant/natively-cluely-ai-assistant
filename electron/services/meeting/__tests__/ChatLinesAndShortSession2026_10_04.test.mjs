// A three-line session (2026-10-04) — "hi" and "what model are you ?" typed to
// the assistant, "Name." spoken — produced 6.5 KB of notes from four model
// calls, and the notes said the typed questions were "left unanswered" because
// the assistant's replies had been removed from the input.
//
// Owner decisions recorded here: typed chat stays in the notes input WITH the
// replies to it, and a session below the minimum gets one small call.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../../..');
const base = path.resolve(root, 'dist-electron/electron/services/meeting');
const load = (name) => import(pathToFileURL(path.join(base, name)).href);

const { TranscriptNormalizer, TYPED_SPEAKER, ASSISTANT_REPLY_SPEAKER } = await load('TranscriptNormalizer.js');
const { TranscriptChunker } = await load('TranscriptChunker.js');
const { buildChunkPrompt, chunkHasChatLines } = await load('ChunkSummaryGenerator.js');
const { dropAssistantSourcedAtoms } = await load('MeetingSummarySchemaValidator.js');
const short = await load('shortSessionNotes.js');

// The session as the tracker held it.
const SESSION = [
  { speaker: 'user', text: 'hi', timestamp: 1000, origin: 'manual_chat' },
  { speaker: 'assistant', text: 'Hi, how can I help?', timestamp: 1001, origin: 'assistant', chatReply: true },
  { speaker: 'user', text: 'what model are you ?', timestamp: 12000, origin: 'manual_chat' },
  { speaker: 'assistant', text: "I'm Natively, an AI assistant.", timestamp: 12001, origin: 'assistant', chatReply: true },
  { speaker: 'user', text: 'Name.', timestamp: 23000, origin: 'stt' },
];
const normalize = (segments) => new TranscriptNormalizer().normalize(segments);

describe('the notes input keeps typed chat with its replies', () => {
  test('typed lines and their replies are kept, labelled as what they are', () => {
    const n = normalize(SESSION);
    assert.deepEqual(n.segments.map(s => [s.speaker, s.chat ?? null, s.text]), [
      [TYPED_SPEAKER, 'typed', 'hi'],
      [ASSISTANT_REPLY_SPEAKER, 'assistant_reply', 'Hi, how can I help?'],
      [TYPED_SPEAKER, 'typed', 'what model are you?'],
      [ASSISTANT_REPLY_SPEAKER, 'assistant_reply', "I'm Natively, an AI assistant."],
      ['Me', null, 'Name.'],
    ]);
  });

  test('a live suggestion nobody asked for in writing is still excluded', () => {
    const n = normalize([
      { speaker: 'interviewer', text: 'Tell me about your last project in detail.', timestamp: 1, origin: 'stt' },
      { speaker: 'assistant', text: 'I led the billing migration over two quarters.', timestamp: 2, origin: 'assistant' },
      { speaker: 'user', text: 'I led a migration of our billing system.', timestamp: 3, origin: 'stt' },
    ]);
    assert.deepEqual(n.segments.map(s => s.speaker), ['Speaker 1', 'Me']);
    assert.ok(n.qualityWarnings.some(w => /Excluded 1 AI-assistant turn/.test(w)));
  });

  test('an assistant line with no provenance (an older meeting) is excluded as before', () => {
    const n = normalize([
      { speaker: 'user', text: 'We should ship on Friday.', timestamp: 1 },
      { speaker: 'assistant', text: 'Shipping Friday sounds reasonable.', timestamp: 2 },
    ]);
    assert.deepEqual(n.segments.map(s => s.speaker), ['Me']);
  });

  test('a meeting with no chat lines normalizes exactly as before', () => {
    const n = normalize([
      { speaker: 'interviewer', text: 'What is the budget for this quarter?', timestamp: 1000, origin: 'stt' },
      { speaker: 'user', text: 'About forty thousand for the quarter.', timestamp: 4000, origin: 'stt' },
    ]);
    assert.ok(n.segments.every(s => !('chat' in s)));
    // Times are seconds into the meeting, counted from its first line (2026-10-05).
    assert.equal(n.text, '[0s] Speaker 1: What is the budget for this quarter?\n[3s] Me: About forty thousand for the quarter.');
  });
});

describe('chat lines never become things that happened in the meeting', () => {
  const chunkOf = (segments) => new TranscriptChunker().chunk(normalize(segments))[0];

  test('the extraction prompt carries the chat rule only when the chunk has chat lines', () => {
    const withChat = buildChunkPrompt({ chunk: chunkOf(SESSION), totalChunks: 1 }).systemPrompt;
    assert.match(withChat, /were typed by the user to their AI assistant/);
    assert.match(withChat, /Never take a decision, action item, deadline, owner, risk, person or quote from an "Assistant" line/);

    const plain = chunkOf([
      { speaker: 'interviewer', text: 'What is the budget for this quarter?', timestamp: 1000, origin: 'stt' },
      { speaker: 'user', text: 'About forty thousand for the quarter.', timestamp: 4000, origin: 'stt' },
    ]);
    assert.equal(chunkHasChatLines(plain), false);
    assert.ok(!/AI assistant/.test(buildChunkPrompt({ chunk: plain, totalChunks: 1 }).systemPrompt),
      'the prompt for an ordinary meeting is unchanged');
  });

  test('atoms that rest only on the assistant are dropped in code, whatever the model returned', () => {
    const atoms = dropAssistantSourcedAtoms({
      chunkIndex: 0, timeRange: {}, brief: 'b', topics: [],
      decisions: [
        { text: 'Use Postgres', evidence: [{ speakerName: 'Assistant', quote: 'I recommend Postgres' }] },
        { text: 'Ship Friday', evidence: [{ speakerName: 'Me', quote: 'we ship friday' }] },
        { text: 'No evidence given' },
      ],
      actionItems: [
        { text: 'Send the checklist', owner: 'Assistant', evidence: [{ speakerName: 'Me', quote: 'send the checklist' }] },
        { text: 'Draft the email', evidence: [{ speakerName: 'assistant', quote: 'I can draft that' }] },
      ],
      deadlines: [], openQuestions: [{ text: 'What model is this?', evidence: [{ speakerName: 'Me (typed)', quote: 'what model are you' }] }],
      risks: [{ text: 'Vendor lock-in', evidence: [{ speakerName: 'Assistant', quote: 'lock-in is a risk' }] }],
      people: [{ name: 'Assistant' }, { name: 'Me (typed)' }, { name: 'Priya' }],
      importantQuotes: [{ speakerName: 'Assistant', quote: 'x' }, { speakerName: 'Priya', quote: 'y' }],
      modeSpecificFindings: { Summary: [{ text: 'Asked the assistant what model it is; it said Natively.' }] },
      sourceQualityWarnings: [],
    });
    assert.deepEqual(atoms.decisions.map(d => d.text), ['Ship Friday', 'No evidence given']);
    assert.deepEqual(atoms.actionItems.map(a => [a.text, a.owner ?? null]), [['Send the checklist', null]]);
    assert.deepEqual(atoms.risks, []);
    assert.deepEqual(atoms.people.map(p => p.name), ['Priya']);
    assert.deepEqual(atoms.importantQuotes.map(q => q.speakerName), ['Priya']);
    assert.equal(atoms.openQuestions.length, 1, 'what the user asked the assistant may stay as a question');
    assert.equal(atoms.modeSpecificFindings.Summary.length, 1, 'and the asked-and-answered note stays');
  });
});

describe('real people whose names start like the assistant keep their atoms', () => {
  test('"Ai Tanaka", "AI team" and "Natively team" are not the assistant', () => {
    const atoms = dropAssistantSourcedAtoms({
      chunkIndex: 0, timeRange: {}, brief: 'b', topics: [],
      decisions: [{ text: 'Move the launch to Friday', evidence: [{ speakerName: 'Ai Tanaka', quote: 'let us move it to Friday' }] }],
      actionItems: [
        { text: 'Review the model card', owner: 'AI team', evidence: [{ speakerName: 'Ai Tanaka', quote: 'the AI team will review it' }] },
        { text: 'Ship the build', owner: 'Natively team', evidence: [{ speakerName: 'Me', quote: 'we ship it' }] },
      ],
      deadlines: [], openQuestions: [], risks: [],
      people: [{ name: 'Ai Tanaka' }, { name: 'AI team' }],
      importantQuotes: [{ speakerName: 'Ai Tanaka', quote: 'let us move it to Friday' }],
      modeSpecificFindings: {}, sourceQualityWarnings: [],
    });
    assert.equal(atoms.decisions.length, 1);
    assert.deepEqual(atoms.actionItems.map(a => a.owner), ['AI team', 'Natively team']);
    assert.deepEqual(atoms.people.map(p => p.name), ['Ai Tanaka', 'AI team']);
    assert.equal(atoms.importantQuotes.length, 1);
  });
});

describe('a short session gets one small call', () => {
  test('the session from the log is short: 3 human lines, 6 words', () => {
    const n = normalize(SESSION);
    assert.deepEqual(short.countHumanContent(n), { lines: 3, words: 6 });
    assert.equal(short.isShortSession(n), true);
  });

  test("the assistant's replies do not make a session look bigger", () => {
    const n = normalize([
      { speaker: 'user', text: 'explain', timestamp: 1, origin: 'manual_chat' },
      { speaker: 'assistant', text: Array.from({ length: 80 }, (_, i) => `word${i}`).join(' '), timestamp: 2, origin: 'assistant', chatReply: true },
      { speaker: 'user', text: 'ok thanks', timestamp: 3, origin: 'manual_chat' },
      { speaker: 'user', text: 'bye now', timestamp: 4, origin: 'stt' },
    ]);
    assert.equal(short.isShortSession(n), true);
  });

  test('a real conversation is not short', () => {
    const line = (i, speaker) => ({ speaker, text: `We went through item ${i} of the plan and agreed on the next concrete step for it.`, timestamp: i * 1000, origin: 'stt' });
    const n = normalize([line(1, 'user'), line(2, 'interviewer'), line(3, 'user'), line(4, 'interviewer')]);
    assert.equal(short.isShortSession(n), false);
  });

  test('few lines but many words is not short; many lines but few words is', () => {
    const long = 'word '.repeat(short.SHORT_SESSION_MIN_WORDS).trim();
    const lines = (texts) => normalize(texts.map((text, i) => ({ speaker: i % 2 ? 'interviewer' : 'user', text, timestamp: (i + 1) * 1000, origin: 'stt' })));
    assert.equal(short.isShortSession(lines([long, long])), true, 'two lines is below the line minimum');
    assert.equal(short.isShortSession(lines(['yes ok', 'fine then', 'sure thing', 'all good'])), true, 'eight words is below the word minimum');
  });

  test('a meeting in a language written without spaces is not short', () => {
    // Twelve Japanese lines, no spaces: a whitespace split counts 12 "words".
    const ja = 'このプロジェクトでは請求システムを新しいサービスに移行しました。';
    const zh = '我们在两个季度内把计费系统迁移到了新的服务上并且保持发票一致。';
    const lines = Array.from({ length: 12 }, (_, i) => ({ speaker: i % 2 ? 'interviewer' : 'user', text: (i % 3 ? ja : zh) + i, timestamp: (i + 1) * 1000, origin: 'stt' }));
    const n = normalize(lines);
    assert.ok(short.countHumanContent(n).words >= short.SHORT_SESSION_MIN_WORDS, `counted ${short.countHumanContent(n).words} words`);
    assert.equal(short.isShortSession(n), false);
    assert.equal(short.countWords('we agreed to ship on friday'), 6, 'spaced text counts as before');
  });

  test('the reply is parsed, bounded, and rejected when empty', () => {
    assert.deepEqual(short.parseShortSessionNotes('```json\n{"overview":"A greeting.","keyPoints":["a","b","c","d"],"actionItems":[]}\n```'),
      { overview: 'A greeting.', keyPoints: ['a', 'b', 'c'], actionItems: [] });
    assert.deepEqual(short.parseShortSessionNotes('Sure! {"overview":"Short chat.","keyPoints":[]} done'),
      { overview: 'Short chat.', keyPoints: [], actionItems: [] });
    assert.equal(short.parseShortSessionNotes('{"overview":"","keyPoints":[]}'), null);
    assert.equal(short.parseShortSessionNotes('not json'), null);
    assert.equal(short.parseShortSessionNotes(''), null);
  });

  test('the prompt tells the model what typed and assistant lines are', () => {
    assert.ok(short.SHORT_SESSION_PROMPT.includes(`"${TYPED_SPEAKER}"`));
    assert.ok(short.SHORT_SESSION_PROMPT.includes(`"${ASSISTANT_REPLY_SPEAKER}"`));
    assert.match(short.SHORT_SESSION_PROMPT, /never longer than what was actually said/);
  });
});

describe('wiring in meeting save', () => {
  const src = fs.readFileSync(path.resolve(root, 'electron/MeetingPersistence.ts'), 'utf8');

  test('a short session skips the full pipeline and the legacy one', () => {
    assert.match(src, /if \(!shortSession && data\.transcript\.length > 2 && isIntelligenceFlagEnabled\('meetingSummaryV3'\) && postCallSummaryAllowed\)/);
    assert.match(src, /if \(!shortSession && summaryData\.schemaVersion !== 3 && data\.transcript\.length > 2 && postCallSummaryAllowed\)/);
  });

  test('its title is derived from the notes, with no model call', () => {
    assert.match(src, /shortSessionNotesWritten\s*\/\/[^\n]*\n\s*\? deriveDeterministicTitle\(/);
    assert.match(src, /: shortSession\s*\? null\s*: await generateTitleFromSummary\(this\.llmHelper, summaryData\)/);
  });

  test('"too short" is logged only when it is true', () => {
    assert.match(src, /\} else if \(data\.transcript\.length <= 2\) \{[\s\S]{0,420}console\.log\("Transcript too short for summary generation\."\);/);
  });

  test('a chat-only session still gets no notes at all', () => {
    assert.match(src, /if \(\(data\.memoryEligibleCount \?\? data\.transcript\.length\) === 0\) \{/);
  });

  test('assistant replies are tagged where they are recorded', () => {
    const tracker = fs.readFileSync(path.resolve(root, 'electron/SessionTracker.ts'), 'utf8');
    assert.match(tracker, /\(surface === 'manual_chat' \|\| surface === 'phone_mirror'\) && writeDecision\?\.answersSpokenQuestion !== true \? \{ chatReply: true \} : \{\}/);
  });
});
