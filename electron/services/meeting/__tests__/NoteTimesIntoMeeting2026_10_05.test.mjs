// The notes model read every transcript line as "[1791118297s] Speaker: text"
// — the clock time in seconds — and its chunk as "TIME RANGE: 29851971:37 -
// 29851975:02" (2026-10-05). Lines are now labelled with seconds INTO THE
// MEETING, and the times the model cites back are put onto clock time in code,
// because that is what the meeting page subtracts the meeting start from and
// jumps the transcript to.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../../..');
const dist = (p) => pathToFileURL(path.resolve(root, 'dist-electron/electron/services/meeting', p)).href;

const { TranscriptNormalizer } = await import(dist('TranscriptNormalizer.js'));
const { TranscriptChunker } = await import(dist('TranscriptChunker.js'));
const { buildChunkPrompt, ChunkSummaryGenerator } = await import(dist('ChunkSummaryGenerator.js'));
const { anchorAtomTimes } = await import(dist('evidenceTimes.js'));

const T0 = 1791118297000; // clock time, the scale saved transcripts use
const meeting = () => new TranscriptNormalizer().normalize([
  { speaker: 'interviewer', text: 'Shall we move the launch to Friday then?', timestamp: T0, origin: 'stt' },
  { speaker: 'user', text: 'Yes, we agreed to ship on Friday behind a flag.', timestamp: T0 + 65_400, origin: 'stt' },
  { speaker: 'interviewer', text: 'Priya will send the rollout checklist by Thursday.', timestamp: T0 + 125_900, origin: 'stt' },
  { speaker: 'user', text: 'Yes, we agreed to ship on Friday behind a flag.', timestamp: T0 + 300_000, origin: 'stt' },
]);
const chunkOf = (normalized) => new TranscriptChunker().chunk(normalized)[0];
const atoms = (over = {}) => ({
  chunkIndex: 0, timeRange: {}, brief: 'b', topics: [], decisions: [], actionItems: [], openQuestions: [], risks: [],
  people: [], importantQuotes: [], modeSpecificFindings: {}, ...over,
});

describe('what the notes model reads', () => {
  test('each line carries seconds into the meeting, from 0', () => {
    const n = meeting();
    assert.deepEqual(n.text.split('\n').map(l => l.slice(0, l.indexOf(']') + 1)), ['[0s]', '[65s]', '[125s]', '[300s]']);
    assert.doesNotMatch(n.text, /\d{7,}/, 'no clock time anywhere in the notes input');
  });

  test('the absolute timestamp is kept on the segment beside the elapsed one', () => {
    const n = meeting();
    assert.deepEqual(n.segments.map(s => s.timestamp), [T0, T0 + 65_400, T0 + 125_900, T0 + 300_000]);
    assert.deepEqual(n.segments.map(s => s.elapsedMs), [0, 65_400, 125_900, 300_000]);
  });

  test('a line with no timestamp has no label and does not become the meeting start', () => {
    const n = new TranscriptNormalizer().normalize([
      { speaker: 'user', text: 'This line was saved without a timestamp at all.', origin: 'stt' },
      { speaker: 'interviewer', text: 'And this one arrived with a proper clock time.', timestamp: T0, origin: 'stt' },
    ]);
    assert.equal(n.text, 'Me: This line was saved without a timestamp at all.\n[0s] Speaker 1: And this one arrived with a proper clock time.');
  });

  test("the chunk's range is time into the meeting, and its first line is 0:00 rather than unknown", () => {
    const { systemPrompt, jsonShapeHint } = buildChunkPrompt({ chunk: chunkOf(meeting()), totalChunks: 1 });
    assert.match(systemPrompt, /TIME RANGE: 0:00 - 5:00\n/);
    assert.match(jsonShapeHint, /"timeRange": \{ "startMs": 0, "endMs": 300000 \}/);
    assert.match(systemPrompt, /time into the meeting in seconds, e\.g\. \[125s\]/);
    assert.doesNotMatch(systemPrompt + jsonShapeHint, /\d{9,}/);
  });

  test('a hand-built chunk with no stamped lines keeps its own range', () => {
    const { systemPrompt } = buildChunkPrompt({ chunk: { chunkIndex: 0, timeRange: { startMs: 0, endMs: 60000 }, text: 'x', charCount: 1 }, totalChunks: 1 });
    assert.match(systemPrompt, /TIME RANGE: unknown - 1:00\n/);
  });

  test("the chunk keeps its span in clock time for the timeline", () => {
    assert.deepEqual(chunkOf(meeting()).timeRange, { startMs: T0, endMs: T0 + 300_000 });
  });
});

describe('times the model cites are put onto clock time', () => {
  const chunk = chunkOf(meeting());
  const first = (a) => a.decisions[0];

  test('a quote found in a line takes that line\'s own time, whatever number came with it', () => {
    const out = anchorAtomTimes(atoms({
      decisions: [{ text: 'Checklist by Thursday', confidence: 'high', timestampMs: 0,
        evidence: [{ speakerName: 'Speaker 1', timestampMs: 999, quote: 'Priya will send the rollout checklist' }] }],
    }), chunk);
    assert.equal(first(out).evidence[0].timestampMs, T0 + 125_900);
    assert.equal(first(out).timestampMs, T0 + 125_900, 'the item follows its evidence');
  });

  test('a quote said twice is settled by the cited time', () => {
    const cite = (timestampMs) => anchorAtomTimes(atoms({
      importantQuotes: [{ speakerName: 'Me', timestampMs, quote: 'we agreed to ship on Friday' }],
    }), chunk).importantQuotes[0].timestampMs;
    assert.equal(cite(65_000), T0 + 65_400);
    assert.equal(cite(300_000), T0 + 300_000);
  });

  test('with no usable quote, milliseconds are taken as asked for', () => {
    const out = anchorAtomTimes(atoms({ actionItems: [{ text: 'Send checklist', explicitness: 'explicit', confidence: 'high', sourceTimestampMs: 125_000 }] }), chunk);
    assert.equal(out.actionItems[0].sourceTimestampMs, T0 + 125_000);
  });

  test('a model that left the label in seconds is still understood', () => {
    const out = anchorAtomTimes(atoms({ decisions: [{ text: 'Ship Friday', confidence: 'high', timestampMs: 125 }] }), chunk);
    assert.equal(first(out).timestampMs, T0 + 125_000);
  });

  test('seconds that match no label are still read as seconds, even in the first chunk', () => {
    // 95 fits the first chunk as 95 ms too; that put a 1:35 citation on 0:00.
    const out = anchorAtomTimes(atoms({ decisions: [{ text: 'Ship Friday', confidence: 'high', timestampMs: 95 }] }), chunk);
    assert.equal(first(out).timestampMs, T0 + 95_000);
    // A whole number of seconds in milliseconds that matches no label stays milliseconds.
    const ms = anchorAtomTimes(atoms({ decisions: [{ text: 'Ship Friday', confidence: 'high', timestampMs: 200_000 }] }), chunk);
    assert.equal(first(ms).timestampMs, T0 + 200_000);
  });

  test('clock time from a model that kept the old habit is left as it is', () => {
    const out = anchorAtomTimes(atoms({ decisions: [{ text: 'Ship Friday', confidence: 'high', timestampMs: T0 + 65_000 }] }), chunk);
    assert.equal(first(out).timestampMs, T0 + 65_000);
  });

  test('a time that fits no line of the chunk is dropped, not shown', () => {
    const out = anchorAtomTimes(atoms({
      decisions: [{ text: 'Ship Friday', confidence: 'high', timestampMs: 9_999_999,
        evidence: [{ speakerName: 'Me', timestampMs: T0 + 86_400_000, quote: 'nobody said this' }] }],
    }), chunk);
    assert.equal('timestampMs' in first(out), false);
    assert.equal('timestampMs' in first(out).evidence[0], false);
    assert.equal(first(out).evidence[0].quote, 'nobody said this', 'the evidence itself is kept');
  });

  test('the 0 copied from the JSON shape is not a time; the first line is still found by its quote', () => {
    const out = anchorAtomTimes(atoms({
      decisions: [
        { text: 'Unplaced', confidence: 'high', timestampMs: 0, evidence: [{ speakerName: 'Me', timestampMs: 0, quote: 'a paraphrase nobody said' }] },
        { text: 'Opening', confidence: 'high', timestampMs: 0, evidence: [{ speakerName: 'Speaker 1', timestampMs: 0, quote: 'Shall we move the launch to Friday then' }] },
      ],
    }), chunk);
    assert.equal('timestampMs' in out.decisions[0], false);
    assert.equal('timestampMs' in out.decisions[0].evidence[0], false);
    assert.equal(out.decisions[1].timestampMs, T0);
  });

  test('section findings, questions and risks are anchored too', () => {
    const ev = [{ speakerName: 'Speaker 1', quote: 'Shall we move the launch to Friday' }];
    const out = anchorAtomTimes(atoms({
      openQuestions: [{ text: 'q', status: 'open', evidence: ev }],
      risks: [{ text: 'r', severity: 'low', evidence: ev }],
      modeSpecificFindings: { Plan: [{ text: 'f', evidence: ev }, { text: 'no evidence' }] },
    }), chunk);
    assert.equal(out.openQuestions[0].evidence[0].timestampMs, T0);
    assert.equal(out.risks[0].evidence[0].timestampMs, T0);
    assert.equal(out.modeSpecificFindings.Plan[0].evidence[0].timestampMs, T0);
    assert.deepEqual(out.modeSpecificFindings.Plan[1], { text: 'no evidence' });
  });

  test('a short quote is not trusted to find a line', () => {
    const out = anchorAtomTimes(atoms({ importantQuotes: [{ speakerName: 'Me', quote: 'Yes' }] }), chunk);
    assert.equal('timestampMs' in out.importantQuotes[0], false);
  });

  test('a chunk with no stamped lines returns the atoms untouched', () => {
    const input = atoms({ decisions: [{ text: 'd', confidence: 'high', timestampMs: 4000 }] });
    assert.equal(anchorAtomTimes(input, { chunkIndex: 0, timeRange: {}, text: 'x', segments: [] }), input);
    assert.equal(anchorAtomTimes(input, { chunkIndex: 0, timeRange: {}, text: 'x' }), input);
  });
});

describe('through the generator', () => {
  test('what the model returns on the elapsed scale reaches the reducer in clock time', async () => {
    const chunk = chunkOf(meeting());
    const reply = JSON.stringify({
      chunkIndex: 0,
      timeRange: { startMs: 0, endMs: 300000 },
      brief: 'The launch moves to Friday.',
      topics: ['launch'],
      decisions: [{ text: 'Ship on Friday behind a flag', timestampMs: 65000, confidence: 'high',
        evidence: [{ speakerName: 'Me', timestampMs: 65000, quote: 'we agreed to ship on Friday behind a flag' }] }],
      actionItems: [{ text: 'Send the rollout checklist', owner: 'Priya', sourceTimestampMs: 125000, explicitness: 'explicit', confidence: 'high',
        evidence: [{ speakerName: 'Speaker 1', timestampMs: 125000, quote: 'Priya will send the rollout checklist by Thursday' }] }],
      openQuestions: [], risks: [], deadlines: [], people: [], importantQuotes: [], modeSpecificFindings: {},
    });
    let userContent = '';
    const llmHelper = {
      generateMeetingSummary: async (_system, content) => { userContent = content; return reply; },
    };
    const log = console.log, warn = console.warn;
    console.log = () => {}; console.warn = () => {};
    let out;
    try { out = await new ChunkSummaryGenerator(llmHelper).generateAtoms({ chunk, totalChunks: 1 }); }
    finally { console.log = log; console.warn = warn; }

    assert.ok(out, 'the stubbed reply is valid atoms');
    assert.match(userContent, /^\[0s\] Speaker 1:/);
    assert.deepEqual(out.timeRange, { startMs: T0, endMs: T0 + 300_000 }, "the chunk's own span, not the model's echo");
    assert.equal(out.decisions[0].timestampMs, T0 + 65_400);
    assert.equal(out.actionItems[0].sourceTimestampMs, T0 + 125_900);
    assert.equal(out.actionItems[0].evidence[0].timestampMs, T0 + 125_900);
  });

  test('anchoring runs before the assistant-line filter and the range comes from the chunk', () => {
    const src = fs.readFileSync(path.resolve(root, 'electron/services/meeting/ChunkSummaryGenerator.ts'), 'utf8');
    assert.match(src, /const anchored = anchorAtomTimes\(result\.data, params\.chunk\);/);
    assert.match(src, /timeRange: params\.chunk\.timeRange\?\.startMs \|\| params\.chunk\.timeRange\?\.endMs \? params\.chunk\.timeRange : atoms\.timeRange,/);
  });
});
