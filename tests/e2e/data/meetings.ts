// tests/e2e/data/meetings.ts
export interface E2EMockMeeting {
  id: string
  title: string
  date: string
  participants: number
  duration?: string
  hasTranscript?: boolean
}

export function createMockMeeting(overrides: Partial<E2EMockMeeting> = {}): E2EMockMeeting {
  return {
    id: 'meeting-default',
    title: 'Untitled Meeting',
    date: '2026-01-15T10:00:00Z',
    participants: 1,
    hasTranscript: false,
    ...overrides,
  }
}

export const mockMeetings: E2EMockMeeting[] = [
  createMockMeeting({
    id: 'meeting-1',
    title: 'Sprint Planning',
    date: '2026-01-15T10:00:00Z',
    participants: 4,
    duration: '60:00',
    hasTranscript: true,
  }),
  createMockMeeting({
    id: 'meeting-2',
    title: 'Design Review',
    date: '2026-01-14T14:00:00Z',
    participants: 2,
    duration: '30:00',
    hasTranscript: true,
  }),
  createMockMeeting({
    id: 'meeting-3',
    title: 'Client Call',
    date: '2026-01-13T09:00:00Z',
    participants: 6,
    duration: '45:00',
    hasTranscript: false,
  }),
]

export const mockEmptyMeetings: E2EMockMeeting[] = []

export const mockSingleMeeting: E2EMockMeeting[] = [
  createMockMeeting({
    id: 'meeting-single',
    title: 'Quick Sync',
    date: '2026-01-15T16:00:00Z',
    participants: 1,
    duration: '15:00',
    hasTranscript: true,
  }),
]
