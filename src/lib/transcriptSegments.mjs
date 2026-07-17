export const TRANSCRIPT_FINAL_LIMIT = 100;

const SPEAKERS = new Set(['interviewer', 'user']);

export function createInitialTranscriptState() {
  return {
    finals: [],
    partials: {
      interviewer: null,
      user: null,
    },
    nextSequence: 0,
    contentRevision: 0,
    commitRevision: 0,
    lastCommittedId: null,
  };
}

function normalizeText(text) {
  return text.trim().replace(/\s+/gu, ' ');
}

function readTranscriptEvent(action) {
  if (
    action === null ||
    typeof action !== 'object' ||
    action.type !== 'transcript-event' ||
    action.event === null ||
    typeof action.event !== 'object'
  ) {
    return null;
  }

  const { speaker, text, final, timestamp } = action.event;
  if (
    !SPEAKERS.has(speaker) ||
    typeof text !== 'string' ||
    typeof final !== 'boolean' ||
    !Number.isFinite(timestamp)
  ) {
    return null;
  }

  const normalizedText = normalizeText(text);
  if (normalizedText.length === 0) {
    return null;
  }

  return { speaker, text: normalizedText, final, timestamp };
}

function createSegmentId(arrivalSequence) {
  return `transcript-${arrivalSequence}`;
}

function reducePartial(state, event) {
  const currentPartial = state.partials[event.speaker];
  const arrivalSequence = currentPartial?.arrivalSequence ?? state.nextSequence;
  const partial = {
    id: currentPartial?.id ?? createSegmentId(arrivalSequence),
    speaker: event.speaker,
    text: event.text,
    status: 'partial',
    timestamp: currentPartial?.timestamp ?? event.timestamp,
    arrivalSequence,
  };

  return {
    ...state,
    partials: {
      ...state.partials,
      [event.speaker]: partial,
    },
    nextSequence:
      currentPartial === null ? state.nextSequence + 1 : state.nextSequence,
    contentRevision: state.contentRevision + 1,
  };
}

function sortFinals(left, right) {
  return (
    left.timestamp - right.timestamp ||
    left.arrivalSequence - right.arrivalSequence
  );
}

function reduceFinal(state, event) {
  const currentPartial = state.partials[event.speaker];
  const arrivalSequence = currentPartial?.arrivalSequence ?? state.nextSequence;
  const finalSegment = currentPartial
    ? {
        ...currentPartial,
        text: event.text,
        status: 'final',
      }
    : {
        id: createSegmentId(arrivalSequence),
        speaker: event.speaker,
        text: event.text,
        status: 'final',
        timestamp: event.timestamp,
        arrivalSequence,
      };

  const sortedFinals = [...state.finals, finalSegment].sort(sortFinals);
  const finals =
    sortedFinals.length > TRANSCRIPT_FINAL_LIMIT
      ? sortedFinals.slice(-TRANSCRIPT_FINAL_LIMIT)
      : sortedFinals;

  return {
    ...state,
    finals,
    partials:
      currentPartial === null
        ? state.partials
        : {
            ...state.partials,
            [event.speaker]: null,
          },
    nextSequence:
      currentPartial === null ? state.nextSequence + 1 : state.nextSequence,
    contentRevision: state.contentRevision + 1,
    commitRevision: state.commitRevision + 1,
    lastCommittedId: finalSegment.id,
  };
}

export function transcriptSegmentsReducer(state, action) {
  if (
    action !== null &&
    typeof action === 'object' &&
    action.type === 'reset'
  ) {
    return createInitialTranscriptState();
  }

  const event = readTranscriptEvent(action);
  if (event === null) {
    return state;
  }

  return event.final ? reduceFinal(state, event) : reducePartial(state, event);
}
