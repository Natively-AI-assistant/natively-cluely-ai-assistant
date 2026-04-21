const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const rootDir = process.cwd();
const compiledSessionTrackerPath = path.join(rootDir, 'dist-electron/electron/SessionTracker.js');
const compiledMeetingPersistencePath = path.join(rootDir, 'dist-electron/electron/MeetingPersistence.js');
const compiledDatabaseManagerPath = path.join(rootDir, 'dist-electron/electron/db/DatabaseManager.js');

function makeSegment(index) {
    return {
        speaker: 'interviewer',
        text: `segment ${index}`,
        timestamp: index,
        final: true,
        confidence: 1,
    };
}

test('MeetingPersistence finalizes an existing live meeting ID without full transcript snapshot writes', async () => {
    const originalLoad = Module._load;

    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === 'electron') {
            return {
                app: {
                    getPath() {
                        return rootDir;
                    },
                },
                BrowserWindow: {
                    getAllWindows() {
                        return [];
                    },
                },
            };
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    delete require.cache[require.resolve(compiledSessionTrackerPath)];
    delete require.cache[require.resolve(compiledMeetingPersistencePath)];
    delete require.cache[require.resolve(compiledDatabaseManagerPath)];

    const { SessionTracker } = require(compiledSessionTrackerPath);
    const { MeetingPersistence } = require(compiledMeetingPersistencePath);
    const { DatabaseManager } = require(compiledDatabaseManagerPath);

    const finalizedMeetings = [];
    const finalizedCallbacks = [];
    const originalGetInstance = DatabaseManager.getInstance;

    DatabaseManager.getInstance = function fakeGetInstance() {
        return {
            finalizeMeeting(meetingId, data) {
                finalizedMeetings.push({ meetingId, data });
            },
            saveMeeting() {
                throw new Error('saveMeeting should not be used in persist-as-you-go finalization');
            },
        };
    };

    try {
        const session = new SessionTracker();
        session.sessionStartTime = Date.now() - 5_000;

        for (let index = 0; index <= 1800; index++) {
            session.addTranscript(makeSegment(index));
        }

        const llmHelper = {
            async generateMeetingSummary() {
                return null;
            },
        };

        const persistence = new MeetingPersistence(session, llmHelper, async (meetingId) => {
            finalizedCallbacks.push(meetingId);
        });
        const meetingId = await persistence.stopMeeting('meeting-123');

        assert.equal(meetingId, 'meeting-123');

        await new Promise((resolve) => setImmediate(resolve));

        assert.equal(finalizedMeetings.length, 1);
        assert.equal(finalizedMeetings[0].meetingId, 'meeting-123');
        assert.equal(finalizedMeetings[0].data.durationMs > 0, true);
        assert.ok(Array.isArray(finalizedMeetings[0].data.usage));
        assert.deepEqual(finalizedCallbacks, ['meeting-123']);
    } finally {
        DatabaseManager.getInstance = originalGetInstance;
        Module._load = originalLoad;
    }
});