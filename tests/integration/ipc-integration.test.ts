import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestMeeting } from './__fixtures__/meetings'
import {
  createTestEnv,
  destroyTestEnv,
  type TestEnv,
} from './__helpers__/test-env'
import './__helpers__/shared-mocks'

import { DatabaseManager } from '../../electron/db/DatabaseManager'
import { SettingsManager } from '../../electron/services/SettingsManager'
import { resetSingletons } from './__helpers__/cleanup'

describe('IPC Integration', () => {
  let env: TestEnv

  beforeEach(() => {
    env = createTestEnv()
    ;(global as any).__NATIVELY_TEST_USER_DATA__ = env.userDataPath
    resetSingletons(DatabaseManager, SettingsManager)
  })

  afterEach(() => {
    resetSingletons(DatabaseManager, SettingsManager)
    delete (global as any).__NATIVELY_TEST_USER_DATA__
    destroyTestEnv(env)
  })

  describe('Settings persistence', () => {
    it('saves and reads settings through the service layer', () => {
      const sm = SettingsManager.getInstance()

      sm.set('isUndetectable', true)
      sm.set('verboseLogging', true)
      sm.set('disguiseMode', 'terminal')

      expect(sm.get('isUndetectable')).toBe(true)
      expect(sm.get('verboseLogging')).toBe(true)
      expect(sm.get('disguiseMode')).toBe('terminal')

      const settingsPath = path.join(env.userDataPath, 'settings.json')
      expect(fs.existsSync(settingsPath)).toBe(true)

      const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
      expect(raw.isUndetectable).toBe(true)
      expect(raw.verboseLogging).toBe(true)
      expect(raw.disguiseMode).toBe('terminal')
    })

    it('persists settings across service reinitialization', () => {
      const sm1 = SettingsManager.getInstance()
      sm1.set('isUndetectable', true)
      sm1.set('actionButtonMode', 'brainstorm')

      resetSingletons(DatabaseManager, SettingsManager)

      const sm2 = SettingsManager.getInstance()
      expect(sm2.get('isUndetectable')).toBe(true)
      expect(sm2.get('actionButtonMode')).toBe('brainstorm')
    })
  })

  describe('Meeting data lifecycle', () => {
    it('creates and retrieves meetings through the DB layer', () => {
      const db = DatabaseManager.getInstance()

      const meeting = createTestMeeting({
        id: 'integration-meeting-1',
        title: 'Integration Test Meeting',
        detailedSummary: {
          overview: 'Test overview',
          actionItems: ['Do thing A', 'Do thing B'],
          keyPoints: ['Key point 1'],
        },
        transcript: [
          { speaker: 'Alice', text: 'Hello', timestamp: 0 },
          { speaker: 'Bob', text: 'Hi Alice', timestamp: 5000 },
        ],
        usage: [
          {
            type: 'assist',
            timestamp: Date.now(),
            question: 'What?',
            answer: 'This.',
          },
        ],
        isProcessed: true,
      })

      db.saveMeeting(meeting, Date.now(), 600000)

      const details = db.getMeetingDetails('integration-meeting-1')
      expect(details).not.toBeNull()
      expect(details?.title).toBe('Integration Test Meeting')
      expect(details?.transcript).toHaveLength(2)
      expect(details?.transcript?.[0].speaker).toBe('Alice')
      expect(details?.usage).toHaveLength(1)
      expect(details?.usage?.[0].type).toBe('assist')
      expect(details?.detailedSummary?.overview).toBe('Test overview')
      expect(details?.detailedSummary?.actionItems).toContain('Do thing A')
    })

    it('handles meeting deletion with cascade', () => {
      const db = DatabaseManager.getInstance()

      const meeting = createTestMeeting({
        id: 'to-delete-meeting',
        title: 'Will Be Deleted',
        transcript: [{ speaker: 'Speaker', text: 'Content', timestamp: 0 }],
      })

      db.saveMeeting(meeting, Date.now(), 300000)
      expect(db.getMeetingDetails('to-delete-meeting')).not.toBeNull()

      const deleted = db.deleteMeeting('to-delete-meeting')
      expect(deleted).toBe(true)
      expect(db.getMeetingDetails('to-delete-meeting')).toBeNull()

      const rawDb = db.getDb()!
      const transcripts = rawDb
        .prepare('SELECT * FROM transcripts WHERE meeting_id = ?')
        .all('to-delete-meeting')
      expect(transcripts).toHaveLength(0)
    })

    it('handles concurrent meeting operations', () => {
      const db = DatabaseManager.getInstance()

      const m1 = createTestMeeting({ id: 'meeting-a', title: 'Meeting A' })
      const m2 = createTestMeeting({ id: 'meeting-b', title: 'Meeting B' })

      db.saveMeeting(m1, Date.now(), 600000)
      db.saveMeeting(m2, Date.now(), 600000)

      expect(db.getMeetingDetails('meeting-a')?.title).toBe('Meeting A')
      expect(db.getMeetingDetails('meeting-b')?.title).toBe('Meeting B')

      db.deleteMeeting('meeting-a')
      expect(db.getMeetingDetails('meeting-a')).toBeNull()
      expect(db.getMeetingDetails('meeting-b')?.title).toBe('Meeting B')
    })
  })
})
