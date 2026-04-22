import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTestEnv, destroyTestEnv, type TestEnv } from './__helpers__/test-env'
import { createTestMeeting } from './__fixtures__/meetings'
import './__helpers__/shared-mocks'

import { DatabaseManager } from '../../electron/db/DatabaseManager'
import { resetDatabaseManager } from './__helpers__/cleanup'

describe('Meeting Lifecycle Integration', () => {
  let env: TestEnv

  beforeEach(() => {
    env = createTestEnv()
    ;(global as any).__NATIVELY_TEST_USER_DATA__ = env.userDataPath
    resetDatabaseManager(DatabaseManager)
  })

  afterEach(() => {
    resetDatabaseManager(DatabaseManager)
    delete (global as any).__NATIVELY_TEST_USER_DATA__
    destroyTestEnv(env)
  })

  describe('Full meeting lifecycle: create → read → update → delete', () => {
    it('completes full lifecycle without data corruption', () => {
      const db = DatabaseManager.getInstance()

      const meeting = createTestMeeting({
        id: 'lifecycle-meeting',
        title: 'Lifecycle Test Meeting',
        transcript: [
          { speaker: 'Alice', text: 'Starting the meeting', timestamp: 0 },
          { speaker: 'Bob', text: 'Discussing agenda', timestamp: 10000 },
          { speaker: 'Alice', text: 'Moving to next topic', timestamp: 20000 },
        ],
      })

      db.saveMeeting(meeting, Date.now(), 600000)

      const retrieved = db.getMeetingDetails('lifecycle-meeting')
      expect(retrieved).not.toBeNull()
      expect(retrieved!.title).toBe('Lifecycle Test Meeting')
      expect(retrieved!.transcript).toHaveLength(3)

      expect(retrieved!.transcript![0].text).toBe('Starting the meeting')
      expect(retrieved!.transcript![1].text).toBe('Discussing agenda')
      expect(retrieved!.transcript![2].text).toBe('Moving to next topic')

      const deleted = db.deleteMeeting('lifecycle-meeting')
      expect(deleted).toBe(true)

      expect(db.getMeetingDetails('lifecycle-meeting')).toBeNull()
    })

    it('handles multiple meetings with independent lifecycles', () => {
      const db = DatabaseManager.getInstance()

      const meetings = [
        createTestMeeting({ id: 'm1', title: 'Meeting 1' }),
        createTestMeeting({ id: 'm2', title: 'Meeting 2' }),
        createTestMeeting({ id: 'm3', title: 'Meeting 3' }),
      ]

      for (const m of meetings) {
        db.saveMeeting(m, Date.now(), 600000)
      }

      db.deleteMeeting('m2')

      expect(db.getMeetingDetails('m1')).not.toBeNull()
      expect(db.getMeetingDetails('m2')).toBeNull()
      expect(db.getMeetingDetails('m3')).not.toBeNull()
    })
  })

  describe('Meeting with usage events', () => {
    it('stores and retrieves usage events correctly', () => {
      const db = DatabaseManager.getInstance()

      const meeting = createTestMeeting({
        id: 'usage-meeting',
        usage: [
          { type: 'assist', timestamp: 1000, question: 'What is X?', answer: 'X is...' },
          { type: 'assist', timestamp: 2000, question: 'How about Y?', answer: 'Y is...' },
          { type: 'followup', timestamp: 3000, question: '', answer: 'Summary...' },
        ],
      })

      db.saveMeeting(meeting, Date.now(), 600000)

      const retrieved = db.getMeetingDetails('usage-meeting')
      expect(retrieved!.usage).toHaveLength(3)
      expect(retrieved!.usage![0].type).toBe('assist')
      expect(retrieved!.usage![0].question).toBe('What is X?')
      expect(retrieved!.usage![2].type).toBe('followup')
    })
  })

  describe('Meeting with detailed summary', () => {
    it('stores and retrieves detailed summary correctly', () => {
      const db = DatabaseManager.getInstance()

      const meeting = createTestMeeting({
        id: 'summary-meeting',
        detailedSummary: {
          overview: 'This was a productive meeting about Q3 planning',
          actionItems: ['Prepare budget report', 'Schedule follow-up with engineering'],
          keyPoints: ['Budget approved', 'New hire starting next week'],
        },
      })

      db.saveMeeting(meeting, Date.now(), 600000)

      const retrieved = db.getMeetingDetails('summary-meeting')
      expect(retrieved!.detailedSummary).toBeDefined()
      expect(retrieved!.detailedSummary!.overview).toBe('This was a productive meeting about Q3 planning')
      expect(retrieved!.detailedSummary!.actionItems).toContain('Prepare budget report')
      expect(retrieved!.detailedSummary!.keyPoints).toContain('Budget approved')
    })
  })

  describe('Error scenarios', () => {
    it('handles deleting non-existent meeting gracefully', () => {
      const db = DatabaseManager.getInstance()
      const result = db.deleteMeeting('does-not-exist')
      expect(result).toBe(false)
    })

    it('handles retrieving non-existent meeting gracefully', () => {
      const db = DatabaseManager.getInstance()
      const result = db.getMeetingDetails('does-not-exist')
      expect(result).toBeNull()
    })

    it('handles empty transcript meeting', () => {
      const db = DatabaseManager.getInstance()

      const meeting = createTestMeeting({
        id: 'empty-meeting',
        title: 'Empty Meeting',
        transcript: [],
      })

      db.saveMeeting(meeting, Date.now(), 300000)

      const retrieved = db.getMeetingDetails('empty-meeting')
      expect(retrieved).not.toBeNull()
      expect(retrieved!.transcript).toHaveLength(0)
    })

    it('handles duplicate meeting id by overwriting', () => {
      const db = DatabaseManager.getInstance()

      const m1 = createTestMeeting({ id: 'dup-meeting', title: 'First Version' })
      db.saveMeeting(m1, Date.now(), 300000)

      const m2 = createTestMeeting({ id: 'dup-meeting', title: 'Second Version' })
      db.saveMeeting(m2, Date.now(), 600000)

      const retrieved = db.getMeetingDetails('dup-meeting')
      expect(retrieved!.title).toBe('Second Version')
    })

    it('handles meeting with very long transcript', () => {
      const db = DatabaseManager.getInstance()

      const longTranscript = Array.from({ length: 100 }, (_, i) => ({
        speaker: `Speaker ${i % 3}`,
        text: `Segment ${i} with some content to make it realistic enough for testing.`,
        timestamp: i * 5000,
      }))

      const meeting = createTestMeeting({
        id: 'long-meeting',
        title: 'Long Meeting',
        transcript: longTranscript,
      })

      db.saveMeeting(meeting, Date.now(), 600000)

      const retrieved = db.getMeetingDetails('long-meeting')
      expect(retrieved!.transcript).toHaveLength(100)
    })

    it('handles meeting with special characters in title', () => {
      const db = DatabaseManager.getInstance()

      const meeting = createTestMeeting({
        id: 'special-chars',
        title: 'Meeting with "quotes" & <special> chars: émojis 🎉',
        transcript: [{ speaker: 'Test', text: 'Content', timestamp: 0 }],
      })

      db.saveMeeting(meeting, Date.now(), 300000)

      const retrieved = db.getMeetingDetails('special-chars')
      expect(retrieved!.title).toBe('Meeting with "quotes" & <special> chars: émojis 🎉')
    })
  })
})
