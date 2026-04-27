export interface MockMeeting {
  id: string
  title: string
  date: string
  duration: string
  summary: string
}

export function createMockMeeting(
  overrides: Partial<MockMeeting> = {},
): MockMeeting {
  return {
    id: 'meeting-1',
    title: 'Test Meeting',
    date: '2026-01-15T10:00:00Z',
    duration: '30m',
    summary: 'Test summary',
    ...overrides,
  }
}

export const mockMeetings: MockMeeting[] = [
  createMockMeeting(),
  createMockMeeting({
    id: 'meeting-2',
    title: 'Sprint Planning',
    date: '2026-01-16T14:00:00Z',
    duration: '1h',
    summary: 'Sprint planning discussion for Q1 goals',
  }),
  createMockMeeting({
    id: 'meeting-3',
    title: 'Design Review',
    date: '2026-01-17T09:30:00Z',
    duration: '45m',
    summary: 'Review new dashboard mockups and component library updates',
  }),
]
