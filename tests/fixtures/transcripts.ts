export interface MockTranscript {
  speaker: string
  text: string
  timestamp: number
  final: boolean
}

export function createMockTranscript(
  overrides: Partial<MockTranscript> = {},
): MockTranscript {
  return {
    speaker: 'Speaker 1',
    text: 'This is a test transcript entry.',
    timestamp: 1234567890,
    final: true,
    ...overrides,
  }
}

export const mockTranscripts: MockTranscript[] = [
  createMockTranscript(),
  createMockTranscript({
    speaker: 'Speaker 2',
    text: 'Thanks for joining everyone. Let us get started.',
    timestamp: 1234567895,
  }),
  createMockTranscript({
    speaker: 'Speaker 1',
    text: 'Sure, I will walk through the agenda items first.',
    timestamp: 1234567900,
  }),
  createMockTranscript({
    speaker: 'Speaker 3',
    text: 'Sounds good. I have a few questions about the roadmap.',
    timestamp: 1234567910,
  }),
  createMockTranscript({
    speaker: 'Speaker 2',
    text: 'Go ahead, we saved time for discussion.',
    timestamp: 1234567920,
  }),
  createMockTranscript({
    speaker: 'Speaker 1',
    text: 'The first milestone is the authentication module.',
    timestamp: 1234567930,
  }),
  createMockTranscript({
    speaker: 'Speaker 3',
    text: 'What is the expected timeline for that?',
    timestamp: 1234567945,
  }),
  createMockTranscript({
    speaker: 'Speaker 1',
    text: 'Roughly two sprints, so about four weeks.',
    timestamp: 1234567960,
  }),
  createMockTranscript({
    speaker: 'Speaker 2',
    text: 'Let us move on to the next topic.',
    timestamp: 1234567975,
  }),
  createMockTranscript({
    speaker: 'Speaker 3',
    text: 'I will share my screen with the updated designs.',
    timestamp: 1234567990,
    final: false,
  }),
]
