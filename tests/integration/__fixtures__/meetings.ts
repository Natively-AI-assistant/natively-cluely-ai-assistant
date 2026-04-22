import type { Meeting } from '../../../electron/db/DatabaseManager'

export function createTestMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: `meeting-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Test Meeting',
    date: new Date().toISOString(),
    duration: '30:00',
    summary: 'A test meeting summary',
    transcript: [
      { speaker: 'Alice', text: 'Hello everyone', timestamp: 0 },
      { speaker: 'Bob', text: 'Hi Alice', timestamp: 5000 },
    ],
    ...overrides,
  }
}
