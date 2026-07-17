import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTranscriptAnnouncementState,
  reduceTranscriptAnnouncement,
} from '../transcriptAnnouncementPolicy.mjs';

function createInput({
  resetKey = 0,
  finals = [],
  interviewer = { status: 'connected' },
  user = { status: 'connected' },
  activePartialSpeakers = [],
} = {}) {
  return {
    resetKey,
    finals,
    channels: { interviewer, user },
    activePartialSpeakers,
  };
}

test('initial channel problems announce while an all-connected baseline stays quiet', () => {
  const initial = createTranscriptAnnouncementState(0);
  const connected = reduceTranscriptAnnouncement(initial, createInput());

  assert.equal(connected.text, '');
  assert.equal(connected.revision, 0);
  assert.strictEqual(
    reduceTranscriptAnnouncement(connected, createInput()),
    connected,
  );

  const problem = reduceTranscriptAnnouncement(
    createTranscriptAnnouncementState(0),
    createInput({
      interviewer: { status: 'failed' },
      user: { status: 'awaiting-audio' },
    }),
  );

  assert.equal(
    problem.text,
    'Reunião: Falha na transcrição. Você: Aguardando áudio',
  );
  assert.equal(problem.revision, 1);
});

test('a channel failure after a prior final is still announced', () => {
  const latestFinal = {
    id: 'final-1',
    speaker: 'interviewer',
    text: 'Qual é a resposta?',
  };
  let state = reduceTranscriptAnnouncement(
    createTranscriptAnnouncementState(0),
    createInput(),
  );
  state = reduceTranscriptAnnouncement(
    state,
    createInput({ finals: [latestFinal] }),
  );

  assert.equal(state.text, 'Reunião: Qual é a resposta?');
  assert.equal(state.revision, 1);

  state = reduceTranscriptAnnouncement(
    state,
    createInput({
      finals: [latestFinal],
      user: { status: 'failed', error: 'microfone indisponível' },
    }),
  );

  assert.equal(
    state.text,
    'Você: Falha na transcrição · microfone indisponível',
  );
  assert.equal(state.revision, 2);
});

test('a connected recovery is announced after a channel problem', () => {
  let state = reduceTranscriptAnnouncement(
    createTranscriptAnnouncementState(0),
    createInput({ interviewer: { status: 'reconnecting' } }),
  );

  assert.equal(state.text, 'Reunião: Reconectando');

  state = reduceTranscriptAnnouncement(state, createInput());

  assert.equal(state.text, 'Reunião: Conectado');
  assert.equal(state.revision, 2);
});

test('a final and channel change in one update produce one combined announcement', () => {
  let state = reduceTranscriptAnnouncement(
    createTranscriptAnnouncementState(0),
    createInput(),
  );

  state = reduceTranscriptAnnouncement(
    state,
    createInput({
      finals: [
        {
          id: 'final-combined',
          speaker: 'interviewer',
          text: 'Pergunta final',
        },
      ],
      user: { status: 'reconnecting', provider: 'local' },
    }),
  );

  assert.equal(
    state.text,
    'Reunião: Pergunta final. Você: Reconectando · local',
  );
  assert.equal(state.revision, 1);
});

test('a new final ID with identical text advances revision and reset clears output', () => {
  const firstFinal = { id: 'final-a', speaker: 'user', text: 'Mesmo texto' };
  let state = reduceTranscriptAnnouncement(
    createTranscriptAnnouncementState(0),
    createInput(),
  );
  state = reduceTranscriptAnnouncement(
    state,
    createInput({ finals: [firstFinal] }),
  );
  const firstText = state.text;

  state = reduceTranscriptAnnouncement(
    state,
    createInput({
      finals: [
        firstFinal,
        { id: 'final-b', speaker: 'user', text: 'Mesmo texto' },
      ],
    }),
  );

  assert.equal(state.text, firstText);
  assert.equal(state.revision, 2);
  assert.deepEqual(state.knownFinalIds, ['final-a', 'final-b']);

  const reset = reduceTranscriptAnnouncement(
    state,
    createInput({
      resetKey: 1,
      finals: [
        { id: 'fresh-final', speaker: 'user', text: 'Nova sessão' },
      ],
      interviewer: { status: 'failed' },
      activePartialSpeakers: ['user'],
    }),
  );

  assert.equal(reset.resetKey, 1);
  assert.equal(reset.text, '');
  assert.equal(reset.revision, 0);
  assert.deepEqual(reset.knownFinalIds, ['fresh-final']);
  assert.equal(reset.initialized, true);
  assert.equal(reset.activePartialSpeakerSignature, 'user');
});

test('partial token changes stay silent while a newly active speaker announces once', () => {
  let state = reduceTranscriptAnnouncement(
    createTranscriptAnnouncementState(0),
    createInput(),
  );
  state = reduceTranscriptAnnouncement(
    state,
    createInput({ activePartialSpeakers: ['interviewer'] }),
  );

  assert.equal(state.text, 'Reunião: ouvindo');
  assert.equal(state.revision, 1);

  const tokenUpdate = reduceTranscriptAnnouncement(
    state,
    createInput({ activePartialSpeakers: ['interviewer'] }),
  );

  assert.strictEqual(tokenUpdate, state);

  const secondSpeaker = reduceTranscriptAnnouncement(
    tokenUpdate,
    createInput({ activePartialSpeakers: ['interviewer', 'user'] }),
  );

  assert.equal(secondSpeaker.text, 'Você: ouvindo');
  assert.equal(secondSpeaker.revision, 2);
  assert.equal(
    secondSpeaker.activePartialSpeakerSignature,
    'interviewer|user',
  );
});

test('first call silently baselines historical finals and active partials but still announces channel problems', () => {
  const historicalInput = {
    resetKey: 0,
    finals: [
      { id: 'historical-1', speaker: 'interviewer', text: 'Histórico' },
    ],
    channels: {
      interviewer: { status: 'connected' },
      user: { status: 'connected' },
    },
    activePartialSpeakers: ['user'],
  };
  const quiet = reduceTranscriptAnnouncement(
    createTranscriptAnnouncementState(0),
    historicalInput,
  );

  assert.equal(quiet.text, '');
  assert.equal(quiet.revision, 0);

  const problem = reduceTranscriptAnnouncement(
    createTranscriptAnnouncementState(0),
    {
      ...historicalInput,
      channels: {
        interviewer: { status: 'failed' },
        user: { status: 'connected' },
      },
    },
  );

  assert.equal(problem.text, 'Reunião: Falha na transcrição');
  assert.equal(problem.revision, 1);
});

test('one update announces every unseen final in finals-array order', () => {
  const historicalFinal = {
    id: 'historical',
    speaker: 'interviewer',
    text: 'Anterior',
  };
  const baselineInput = {
    resetKey: 0,
    finals: [historicalFinal],
    channels: {
      interviewer: { status: 'connected' },
      user: { status: 'connected' },
    },
    activePartialSpeakers: [],
  };
  const baseline = reduceTranscriptAnnouncement(
    createTranscriptAnnouncementState(0),
    baselineInput,
  );
  const batched = reduceTranscriptAnnouncement(baseline, {
    ...baselineInput,
    finals: [
      historicalFinal,
      { id: 'new-1', speaker: 'interviewer', text: 'Primeiro novo' },
      { id: 'new-2', speaker: 'user', text: 'Segundo novo' },
    ],
  });

  assert.equal(
    batched.text,
    'Reunião: Primeiro novo. Você: Segundo novo',
  );
  assert.equal(batched.revision, 1);
});
