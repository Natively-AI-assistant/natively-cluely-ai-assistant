import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyInterviewerSttTranscript } from '../overlaySttPersistence.mjs';

const mergeFns = {
  mergeRollingTranscriptPartial: (prev, text) => (prev ? `${prev} ${text}` : text),
  mergeRollingTranscriptFinal: (prev, text) => (prev ? `${prev}|${text}` : text),
};

test('STT partial does not clear messages', () => {
  const priorMessages = [
    { id: '1', role: 'system', text: 'Prior answer', intent: 'what_to_answer' },
    { id: '2', role: 'user', text: 'Hello' },
  ];
  const state = {
    messages: priorMessages,
    rollingTranscript: 'existing',
    isInterviewerSpeaking: false,
    pendingPartialText: null,
  };

  const next = applyInterviewerSttTranscript(
    state,
    { speaker: 'interviewer', final: false, text: 'partial utterance' },
    mergeFns,
  );

  assert.equal(next.messages, priorMessages);
  assert.equal(next.messages.length, 2);
  assert.equal(next.messages[0].text, 'Prior answer');
  assert.equal(next.rollingTranscript, 'existing partial utterance');
  assert.equal(next.isInterviewerSpeaking, true);
});

test('STT final does not clear messages', () => {
  const priorMessages = [{ id: '1', role: 'system', text: 'Answer', intent: 'clarify' }];
  const state = {
    messages: priorMessages,
    rollingTranscript: 'in progress',
    isInterviewerSpeaking: true,
    pendingPartialText: null,
  };

  const next = applyInterviewerSttTranscript(
    state,
    { speaker: 'interviewer', final: true, text: 'final line' },
    mergeFns,
  );

  assert.equal(next.messages, priorMessages);
  assert.equal(next.rollingTranscript, 'in progress|final line');
  assert.equal(next.isInterviewerSpeaking, false);
});
