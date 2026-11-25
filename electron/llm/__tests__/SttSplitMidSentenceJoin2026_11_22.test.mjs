// #773: the speech-to-text provider ended a final mid-sentence. The interviewer
// said "How will you arrange, like, what would be a pseudo code? Can you" and the
// next final, 1.5 s later, was "think of?". Recency picked "think of?" alone, so
// What to Answer lost the pseudocode ask: codingTask false, general answer, prose.
// A turn whose last word cannot end a sentence is joined to the next turn.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { extractLatestQuestion, planAnswer } = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/index.js')).href);

const at = (turns) => turns.map(([role, text, t]) => ({ role, text, timestamp: t }));

describe('a sentence split across two finals is joined back', () => {
  test('the #773 transcript: the pseudocode ask is kept', () => {
    const r = extractLatestQuestion(at([
      ['user', 'So I would loop over the balls once.', -20_000],
      ['interviewer', 'How will you arrange, like, what would be a pseudo code? Can you', 0],
      ['interviewer', 'think of?', 1_533],
    ]));
    assert.equal(r.latestQuestion, 'How will you arrange, like, what would be a pseudo code? Can you think of?');
    assert.ok(r.confidence >= 0.9, `confidence ${r.confidence}`);
    const plan = planAnswer({ question: r.latestQuestion, source: 'transcript', speakerPerspective: 'interviewer' });
    assert.notEqual(plan.answerType, 'general_meeting_answer');
  });

  test('the issue repro steps: two turns two seconds apart', () => {
    const r = extractLatestQuestion(at([
      ['interviewer', 'What would the pseudocode be? Can you', 0],
      ['interviewer', 'think of?', 2_000],
    ]));
    assert.equal(r.latestQuestion, 'What would the pseudocode be? Can you think of?');
    assert.ok(r.confidence >= 0.9, `confidence ${r.confidence}`);
  });

  for (const [first, second] of [
    ['Walk me through how you would', 'reverse a linked list.'],
    ['What is the time complexity of', 'your solution?'],
    ['Could you explain the difference between a process and a', 'thread?'],
    ['how would you handle the case where the input has a', 'null value'],
  ]) {
    test(`"${first}" + "${second}" is one question`, () => {
      const r = extractLatestQuestion(at([
        ['interviewer', first, 0],
        ['interviewer', second, 1_200],
      ]));
      assert.equal(r.latestQuestion, `${first} ${second}`);
    });
  }

  test('a first half that trails off with "..." is joined', () => {
    const r = extractLatestQuestion(at([
      ['interviewer', 'What would the pseudocode be? Can you...', 0],
      ['interviewer', 'think of?', 1_500],
    ]));
    assert.equal(r.latestQuestion, 'What would the pseudocode be? Can you... think of?');
  });

  test('the first half of the sentence is not a prior turn the question refers back to', () => {
    const r = extractLatestQuestion(at([
      ['interviewer', 'Going back to the cache you mentioned, how did you size the', 0],
      ['interviewer', 'eviction window?', 1_200],
    ]));
    assert.equal(r.latestQuestion, 'Going back to the cache you mentioned, how did you size the eviction window?');
    assert.equal(r.isFollowUp, false);
  });

  test('a sentence split over three finals is joined in full', () => {
    const r = extractLatestQuestion(at([
      ['interviewer', 'Can you write the', 0],
      ['interviewer', 'pseudocode for the', 1_000],
      ['interviewer', 'three pointer version?', 2_000],
    ]));
    assert.equal(r.latestQuestion, 'Can you write the pseudocode for the three pointer version?');
  });
});

describe('the #741 and #539 joins still apply to a split sentence', () => {
  test('a generic closer split in two still joins the stated ask', () => {
    const r = extractLatestQuestion(at([
      ['interviewer', 'Design a rate limiter for our public API.', 0],
      ['interviewer', 'It has to work across twenty regions.', 6_000],
      ['interviewer', 'So where would you', 9_000],
      ['interviewer', 'start?', 10_000],
    ]));
    assert.equal(r.latestQuestion, 'Design a rate limiter for our public API. It has to work across twenty regions. So where would you start?');
  });

  test('a constraint split in two still joins the ask before it', () => {
    const r = extractLatestQuestion(at([
      ['interviewer', 'Implement an LRU cache with get and put.', 0],
      ['interviewer', 'You can assume the', 5_000],
      ['interviewer', 'capacity is positive.', 6_000],
    ]));
    assert.equal(r.latestQuestion, 'Implement an LRU cache with get and put. You can assume the capacity is positive.');
  });
});

describe('nothing else is joined', () => {
  test('a turn that ends a sentence is not joined', () => {
    const r = extractLatestQuestion(at([
      ['interviewer', 'What would the pseudocode be?', 0],
      ['interviewer', 'How would you test it?', 1_500],
    ]));
    assert.equal(r.latestQuestion, 'How would you test it?');
  });

  test('a long pause between the finals is not joined', () => {
    const r = extractLatestQuestion(at([
      ['interviewer', 'Can you', 0],
      ['interviewer', 'tell me about your last project?', 12_000],
    ]));
    assert.equal(r.latestQuestion, 'tell me about your last project?');
  });

  test('a candidate answer in between ends the sentence', () => {
    const r = extractLatestQuestion(at([
      ['interviewer', 'What would the pseudocode be? Can you', 0],
      ['user', 'I would keep three pointers and swap as I scan.', 1_000],
      ['interviewer', 'think of?', 5_000],
    ]));
    assert.equal(r.latestQuestion, 'think of?');
  });

  test('a backchannel "Sure." the cleaner drops does not split the sentence', () => {
    const r = extractLatestQuestion(at([
      ['interviewer', 'What would the pseudocode be? Can you', 0],
      ['user', 'Sure.', 1_000],
      ['interviewer', 'think of?', 2_000],
    ]));
    assert.equal(r.latestQuestion, 'What would the pseudocode be? Can you think of?');
  });

  test('an earlier turn that ends on a full word is left out', () => {
    const r = extractLatestQuestion(at([
      ['interviewer', "We're building a scheduler", 0],
      ['interviewer', 'How would you size the worker pool?', 1_500],
    ]));
    assert.equal(r.latestQuestion, 'How would you size the worker pool?');
  });

  test('"how are you" without punctuation is a whole question, not half of the next one', () => {
    const turns = [['interviewer', 'hey how are you', 0], ['interviewer', 'so tell me about your last project', 3_000]]
      .map(([role, text, t]) => ({ role, text, timestamp: t, punctuationSource: 'unavailable' }));
    const r = extractLatestQuestion(turns);
    assert.equal(r.latestQuestion, 'so tell me about your last project');
    assert.ok(r.confidence >= 0.75, `confidence ${r.confidence}`);
  });

  test('a trailing word followed by a comma or dash still counts as cut off', () => {
    const r = extractLatestQuestion(at([
      ['interviewer', 'And what about the,', 0],
      ['interviewer', 'memory usage?', 1_000],
    ]));
    assert.equal(r.latestQuestion, 'And what about the, memory usage?');
  });
});
