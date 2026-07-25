const TRANSCRIPT_SPEAKERS = Object.freeze(['interviewer', 'user']);
const MAX_KNOWN_FINAL_IDS = 100;

export const TRANSCRIPT_SPEAKER_LABELS = Object.freeze({
  interviewer: 'Reunião',
  user: 'Você',
});

export const TRANSCRIPT_STATUS_LABELS = Object.freeze({
  connected: 'Conectado',
  reconnecting: 'Reconectando',
  failed: 'Falha na transcrição',
  'awaiting-audio': 'Aguardando áudio',
});

function createChannelSignature(channel) {
  return JSON.stringify([
    channel.status,
    channel.provider ?? '',
    channel.error ?? '',
  ]);
}

function createChannelSignatures(channels) {
  return {
    interviewer: createChannelSignature(channels.interviewer),
    user: createChannelSignature(channels.user),
  };
}

function createPartialSpeakerSignature(activePartialSpeakers) {
  const activeSpeakers = new Set(activePartialSpeakers);
  return TRANSCRIPT_SPEAKERS.filter((speaker) => activeSpeakers.has(speaker)).join(
    '|',
  );
}

function speakersFromSignature(signature) {
  return signature === '' ? new Set() : new Set(signature.split('|'));
}

function currentKnownFinalIds(finals) {
  return finals.map(({ id }) => id).slice(-MAX_KNOWN_FINAL_IDS);
}

function sameStringArray(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function describeChannel(channel) {
  const context = [channel.provider, channel.error].filter(
    (value) => typeof value === 'string' && value.length > 0,
  );
  const label = TRANSCRIPT_STATUS_LABELS[channel.status];

  return context.length > 0 ? `${label} · ${context.join(' · ')}` : label;
}

export function createTranscriptAnnouncementState(resetKey = 0) {
  return {
    resetKey,
    initialized: false,
    channelSignatures: {
      interviewer: '',
      user: '',
    },
    knownFinalIds: [],
    activePartialSpeakerSignature: '',
    text: '',
    revision: 0,
  };
}

export function reduceTranscriptAnnouncement(state, input) {
  const channelSignatures = createChannelSignatures(input.channels);
  const knownFinalIds = currentKnownFinalIds(input.finals);
  const activePartialSpeakerSignature = createPartialSpeakerSignature(
    input.activePartialSpeakers,
  );

  if (input.resetKey !== state.resetKey) {
    return {
      ...createTranscriptAnnouncementState(input.resetKey),
      initialized: true,
      channelSignatures,
      knownFinalIds,
      activePartialSpeakerSignature,
    };
  }

  if (!state.initialized) {
    const announcements = [];

    for (const speaker of TRANSCRIPT_SPEAKERS) {
      const channel = input.channels[speaker];
      if (channel.status === 'connected') continue;

      announcements.push(
        `${TRANSCRIPT_SPEAKER_LABELS[speaker]}: ${describeChannel(channel)}`,
      );
    }

    return {
      ...state,
      initialized: true,
      channelSignatures,
      knownFinalIds,
      activePartialSpeakerSignature,
      text: announcements.join('. '),
      revision: announcements.length > 0 ? state.revision + 1 : state.revision,
    };
  }

  const interviewerChannelChanged =
    channelSignatures.interviewer !== state.channelSignatures.interviewer;
  const userChannelChanged =
    channelSignatures.user !== state.channelSignatures.user;
  const finalsChanged = !sameStringArray(knownFinalIds, state.knownFinalIds);
  const partialSpeakersChanged =
    activePartialSpeakerSignature !== state.activePartialSpeakerSignature;

  if (
    !interviewerChannelChanged &&
    !userChannelChanged &&
    !finalsChanged &&
    !partialSpeakersChanged
  ) {
    return state;
  }

  const announcements = [];
  const previouslyKnownFinalIds = new Set(state.knownFinalIds);

  for (const final of input.finals) {
    if (previouslyKnownFinalIds.has(final.id)) continue;

    previouslyKnownFinalIds.add(final.id);
    announcements.push(
      `${TRANSCRIPT_SPEAKER_LABELS[final.speaker]}: ${final.text}`,
    );
  }

  for (const speaker of TRANSCRIPT_SPEAKERS) {
    const channelChanged =
      channelSignatures[speaker] !== state.channelSignatures[speaker];
    if (!channelChanged) continue;

    const channel = input.channels[speaker];
    announcements.push(
      `${TRANSCRIPT_SPEAKER_LABELS[speaker]}: ${describeChannel(channel)}`,
    );
  }

  if (partialSpeakersChanged) {
    const previousActiveSpeakers = speakersFromSignature(
      state.activePartialSpeakerSignature,
    );
    const nextActiveSpeakers = speakersFromSignature(
      activePartialSpeakerSignature,
    );

    for (const speaker of TRANSCRIPT_SPEAKERS) {
      if (
        nextActiveSpeakers.has(speaker) &&
        !previousActiveSpeakers.has(speaker)
      ) {
        announcements.push(`${TRANSCRIPT_SPEAKER_LABELS[speaker]}: ouvindo`);
      }
    }
  }

  const nextState = {
    ...state,
    channelSignatures,
    knownFinalIds,
    activePartialSpeakerSignature,
  };

  if (announcements.length === 0) return nextState;

  return {
    ...nextState,
    text: announcements.join('. '),
    revision: state.revision + 1,
  };
}
