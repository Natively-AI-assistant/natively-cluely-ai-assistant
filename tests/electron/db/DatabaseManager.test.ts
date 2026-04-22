import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElectronMock } from '../../mocks/electron.mock'

const { RealDatabase, databases } = vi.hoisted(() => {
    const RealDatabase = require('better-sqlite3')
    const databases: any[] = []
    return { RealDatabase, databases }
})

vi.mock('better-sqlite3', () => ({
    default: vi.fn(function (path: string) {
        const db = new RealDatabase(':memory:')
        databases.push(db)
        return db
    }),
}))

vi.mock('electron', () => createElectronMock({
    app: {
        getPath: vi.fn(() => '/tmp/userdata'),
        isReady: vi.fn(() => true),
    },
}))

vi.mock('fs', () => ({
    default: {
        existsSync: vi.fn(() => false),
        readFileSync: vi.fn(),
        writeFileSync: vi.fn(),
        mkdirSync: vi.fn(),
        unlinkSync: vi.fn(),
    },
}))

vi.mock('path', () => ({
    default: {
        join: (...args: string[]) => args.join('/'),
        dirname: (p: string) => p.split('/').slice(0, -1).join('/'),
    },
}))

vi.mock('sqlite-vec', () => ({
    getLoadablePath: vi.fn(() => '/tmp/vec0.dylib'),
}))

import Database from 'better-sqlite3'
import { DatabaseManager, Meeting } from '../../../electron/db/DatabaseManager'

describe('DatabaseManager', () => {
    let manager: DatabaseManager

    beforeEach(() => {
        vi.clearAllMocks()
        ;(DatabaseManager as any).instance = undefined
        manager = DatabaseManager.getInstance()
    })

    afterEach(() => {
        for (const db of databases) {
            try { db.close() } catch {}
        }
        databases.length = 0
        ;(DatabaseManager as any).instance = undefined
        vi.clearAllMocks()
    })

    describe('schema initialization', () => {
        it('should create meetings table', () => {
            const db = manager.getDb()!
            const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='meetings'").get()
            expect(result).toBeDefined()
        })

        it('should create transcripts table', () => {
            const db = manager.getDb()!
            const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='transcripts'").get()
            expect(result).toBeDefined()
        })

        it('should create ai_interactions table', () => {
            const db = manager.getDb()!
            const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_interactions'").get()
            expect(result).toBeDefined()
        })

        it('should create chunks table', () => {
            const db = manager.getDb()!
            const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks'").get()
            expect(result).toBeDefined()
        })

        it('should create chunk_summaries table', () => {
            const db = manager.getDb()!
            const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunk_summaries'").get()
            expect(result).toBeDefined()
        })

        it('should create embedding_queue table', () => {
            const db = manager.getDb()!
            const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='embedding_queue'").get()
            expect(result).toBeDefined()
        })

        it('should create app_state table', () => {
            const db = manager.getDb()!
            const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_state'").get()
            expect(result).toBeDefined()
        })
    })

    describe('saveMeeting', () => {
        it('should save a meeting with transcript', () => {
            const meeting: Meeting = {
                id: 'test-meeting-1',
                title: 'Test Meeting',
                date: new Date().toISOString(),
                duration: '1:00',
                summary: 'Test summary',
                detailedSummary: {
                    overview: 'Overview',
                    actionItems: ['Action 1'],
                    keyPoints: ['Key point 1'],
                },
                transcript: [
                    { speaker: 'Speaker 1', text: 'Hello', timestamp: 0 },
                    { speaker: 'Speaker 2', text: 'Hi there', timestamp: 5000 },
                ],
                isProcessed: true,
            }

            manager.saveMeeting(meeting, Date.now(), 60000)

            const db = manager.getDb()!
            const savedMeeting = db.prepare('SELECT * FROM meetings WHERE id = ?').get('test-meeting-1')
            expect(savedMeeting).toBeDefined()
            expect((savedMeeting as any).title).toBe('Test Meeting')

            const transcripts = db.prepare('SELECT * FROM transcripts WHERE meeting_id = ?').all('test-meeting-1')
            expect(transcripts).toHaveLength(2)
        })

        it('should save a meeting with usage interactions', () => {
            const meeting: Meeting = {
                id: 'meeting-with-usage',
                title: 'Usage Meeting',
                date: new Date().toISOString(),
                duration: '2:00',
                summary: 'Summary',
                usage: [
                    { type: 'assist', timestamp: 1000, question: 'Q1', answer: 'A1' },
                    { type: 'followup', timestamp: 2000, question: 'Q2', answer: 'A2' },
                ],
            }

            manager.saveMeeting(meeting, Date.now(), 120000)

            const db = manager.getDb()!
            const interactions = db.prepare('SELECT * FROM ai_interactions WHERE meeting_id = ?').all('meeting-with-usage')
            expect(interactions).toHaveLength(2)
        })
    })

    describe('updateMeetingTitle', () => {
        it('should update meeting title', () => {
            const meeting: Meeting = {
                id: 'test-meeting-1',
                title: 'Original Title',
                date: new Date().toISOString(),
                duration: '1:00',
                summary: 'Summary',
            }

            manager.saveMeeting(meeting, Date.now(), 60000)

            const result = manager.updateMeetingTitle('test-meeting-1', 'Updated Title')
            expect(result).toBe(true)

            const details = manager.getMeetingDetails('test-meeting-1')
            expect(details!.title).toBe('Updated Title')
        })

        it('should return false for non-existent meeting', () => {
            const result = manager.updateMeetingTitle('non-existent', 'Title')
            expect(result).toBe(false)
        })
    })

    describe('updateMeetingSummary', () => {
        it('should update meeting summary JSON', () => {
            const meeting: Meeting = {
                id: 'test-meeting-1',
                title: 'Test',
                date: new Date().toISOString(),
                duration: '1:00',
                summary: 'Original',
                detailedSummary: {
                    overview: 'Original overview',
                    actionItems: [],
                    keyPoints: [],
                },
            }

            manager.saveMeeting(meeting, Date.now(), 60000)

            const result = manager.updateMeetingSummary('test-meeting-1', {
                overview: 'Updated overview',
                actionItems: ['New action'],
            })
            expect(result).toBe(true)

            const details = manager.getMeetingDetails('test-meeting-1')
            expect(details!.detailedSummary?.overview).toBe('Updated overview')
            expect(details!.detailedSummary?.actionItems).toContain('New action')
        })

        it('should return false for non-existent meeting', () => {
            const result = manager.updateMeetingSummary('non-existent', { overview: 'x' })
            expect(result).toBe(false)
        })
    })

    describe('getRecentMeetings', () => {
        it('should return recent meetings in descending order', () => {
            const now = Date.now()

            manager.saveMeeting(
                { id: 'meeting-1', title: 'Meeting 1', date: new Date(now - 3000).toISOString(), duration: '1:00', summary: '' },
                now - 3000, 60000
            )
            manager.saveMeeting(
                { id: 'meeting-2', title: 'Meeting 2', date: new Date(now - 2000).toISOString(), duration: '1:00', summary: '' },
                now - 2000, 60000
            )
            manager.saveMeeting(
                { id: 'meeting-3', title: 'Meeting 3', date: new Date(now - 1000).toISOString(), duration: '1:00', summary: '' },
                now - 1000, 60000
            )

            const recentMeetings = manager.getRecentMeetings(10)
            expect(recentMeetings).toHaveLength(3)
            expect(recentMeetings[0].title).toBe('Meeting 3')
            expect(recentMeetings[1].title).toBe('Meeting 2')
            expect(recentMeetings[2].title).toBe('Meeting 1')
        })

        it('should respect the limit parameter', () => {
            manager.saveMeeting({ id: 'm1', title: 'M1', date: new Date().toISOString(), duration: '1:00', summary: '' }, Date.now(), 60000)
            manager.saveMeeting({ id: 'm2', title: 'M2', date: new Date().toISOString(), duration: '1:00', summary: '' }, Date.now(), 60000)

            const result = manager.getRecentMeetings(1)
            expect(result).toHaveLength(1)
        })
    })

    describe('getMeetingDetails', () => {
        it('should return meeting with full transcript and interactions', () => {
            const meeting: Meeting = {
                id: 'meeting-1',
                title: 'Test Meeting',
                date: new Date().toISOString(),
                duration: '1:00',
                summary: 'Test',
                transcript: [
                    { speaker: 'Speaker 1', text: 'Hello world', timestamp: 0 },
                ],
                usage: [
                    { type: 'assist', timestamp: Date.now(), question: 'What is this?', answer: 'This is a test response.' },
                ],
            }

            manager.saveMeeting(meeting, Date.now(), 60000)

            const details = manager.getMeetingDetails('meeting-1')
            expect(details).toBeDefined()
            expect(details!.title).toBe('Test Meeting')
            expect(details!.transcript).toHaveLength(1)
            expect(details!.transcript![0].speaker).toBe('Speaker 1')
            expect(details!.usage).toHaveLength(1)
            expect(details!.usage![0].type).toBe('assist')
        })

        it('should return null for non-existent meeting', () => {
            const details = manager.getMeetingDetails('non-existent')
            expect(details).toBeNull()
        })
    })

    describe('deleteMeeting', () => {
        it('should delete meeting and related data via cascade', () => {
            const meeting: Meeting = {
                id: 'meeting-1',
                title: 'Test',
                date: new Date().toISOString(),
                duration: '1:00',
                summary: '',
                transcript: [
                    { speaker: 'Speaker', text: 'Hello', timestamp: 0 },
                ],
            }

            manager.saveMeeting(meeting, Date.now(), 60000)

            const result = manager.deleteMeeting('meeting-1')
            expect(result).toBe(true)

            expect(manager.getMeetingDetails('meeting-1')).toBeNull()

            const db = manager.getDb()!
            const transcripts = db.prepare('SELECT * FROM transcripts WHERE meeting_id = ?').all('meeting-1')
            expect(transcripts).toHaveLength(0)
        })

        it('should return false for non-existent meeting', () => {
            const result = manager.deleteMeeting('non-existent')
            expect(result).toBe(false)
        })
    })

    describe('app_state key-value storage', () => {
        it('should store and retrieve app state', () => {
            manager.setAppState('last_embedding_provider', 'openai')
            expect(manager.getAppState('last_embedding_provider')).toBe('openai')
        })

        it('should return null for missing key', () => {
            expect(manager.getAppState('missing_key')).toBeNull()
        })

        it('should delete app state', () => {
            manager.setAppState('test_key', 'test_value')
            manager.deleteAppState('test_key')
            expect(manager.getAppState('test_key')).toBeNull()
        })

        it('should overwrite existing key', () => {
            manager.setAppState('key1', 'value1')
            manager.setAppState('key1', 'value2')
            expect(manager.getAppState('key1')).toBe('value2')
        })
    })

    describe('clearAllData', () => {
        it('should clear all data from tables', () => {
            const meeting: Meeting = {
                id: 'm1',
                title: 'Meeting 1',
                date: new Date().toISOString(),
                duration: '1:00',
                summary: '',
                transcript: [
                    { speaker: 'Speaker', text: 'Hello', timestamp: 0 },
                ],
                usage: [
                    { type: 'assist', timestamp: Date.now() },
                ],
            }

            manager.saveMeeting(meeting, Date.now(), 60000)

            const result = manager.clearAllData()
            expect(result).toBe(true)

            const db = manager.getDb()!
            expect(db.prepare('SELECT * FROM meetings').all()).toHaveLength(0)
            expect(db.prepare('SELECT * FROM transcripts').all()).toHaveLength(0)
            expect(db.prepare('SELECT * FROM chunks').all()).toHaveLength(0)
            expect(db.prepare('SELECT * FROM ai_interactions').all()).toHaveLength(0)
        })
    })

    describe('indexes', () => {
        it('should create indexes on foreign keys', () => {
            const db = manager.getDb()!

            const idxChunksMeeting = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_chunks_meeting'").get()
            expect(idxChunksMeeting).toBeDefined()

            const idxTranscriptsMeeting = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_transcripts_meeting'").get()
            expect(idxTranscriptsMeeting).toBeDefined()

            const idxInteractionsMeeting = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_ai_interactions_meeting'").get()
            expect(idxInteractionsMeeting).toBeDefined()
        })
    })
})
