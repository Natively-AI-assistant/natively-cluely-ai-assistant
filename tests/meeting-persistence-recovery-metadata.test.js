const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const rootDir = process.cwd();
const compiledMeetingPersistencePath = path.join(rootDir, 'dist-electron/electron/MeetingPersistence.js');
const compiledDatabaseManagerPath = path.join(rootDir, 'dist-electron/electron/db/DatabaseManager.js');

test('MeetingPersistence recovery preserves persisted calendar metadata', async () => {
    const originalLoad = Module._load;

    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === 'electron') {
            return {
                BrowserWindow: {
                    getAllWindows() {
                        return [];
                    },
                },
            };
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    delete require.cache[require.resolve(compiledMeetingPersistencePath)];
    delete require.cache[require.resolve(compiledDatabaseManagerPath)];

    const { MeetingPersistence } = require(compiledMeetingPersistencePath);
    const { DatabaseManager } = require(compiledDatabaseManagerPath);

    const finalizedMeetings = [];
    const originalGetInstance = DatabaseManager.getInstance;
    const now = Date.now();

    DatabaseManager.getInstance = function fakeGetInstance() {
        return {
            getUnprocessedMeetings() {
                return [{ id: 'meeting-123' }];
            },
            getMeetingDetails(meetingId) {
                assert.equal(meetingId, 'meeting-123');

                return {
                    id: meetingId,
                    title: 'Calendar Sync',
                    date: new Date(now - 60_000).toISOString(),
                    transcript: [
                        {
                            speaker: 'interviewer',
                            text: 'short transcript',
                            timestamp: now - 1_000,
                        },
                    ],
                    usage: undefined,
                    calendarEventId: 'evt-456',
                    source: 'calendar',
                };
            },
            finalizeMeeting(meetingId, data) {
                finalizedMeetings.push({ meetingId, data });
            },
        };
    };

    try {
        const persistence = new MeetingPersistence({}, {
            async generateMeetingSummary() {
                throw new Error('generateMeetingSummary should not be called for this recovery path');
            },
        });

        await persistence.recoverUnprocessedMeetings();

        assert.equal(finalizedMeetings.length, 1);
        assert.equal(finalizedMeetings[0].meetingId, 'meeting-123');
        assert.equal(finalizedMeetings[0].data.title, 'Calendar Sync');
        assert.equal(finalizedMeetings[0].data.calendarEventId, 'evt-456');
        assert.equal(finalizedMeetings[0].data.source, 'calendar');
        assert.deepEqual(finalizedMeetings[0].data.usage, []);
    } finally {
        DatabaseManager.getInstance = originalGetInstance;
        Module._load = originalLoad;
    }
});