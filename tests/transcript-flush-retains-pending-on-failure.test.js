const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const rootDir = process.cwd();
const compiledDatabaseManagerPath = path.join(rootDir, 'dist-electron/electron/db/DatabaseManager.js');

function makeDbManager(DatabaseManager) {
    const dbManager = Object.create(DatabaseManager.prototype);
    dbManager.pendingTranscriptSegments = new Map();
    dbManager.pendingTranscriptFlushTimer = null;
    dbManager.transcriptFlushIntervalMs = 250;
    dbManager.transcriptFlushMaxBackoffMs = 30000;
    dbManager.transcriptFlushFailureCount = 0;
    dbManager.transcriptFlushBackoffUntilMs = 0;
    dbManager.getLastTranscriptByMeetingStmt = () => ({
        get: () => undefined,
    });
    dbManager.getInsertTranscriptStmt = () => ({
        run: () => {},
    });
    return dbManager;
}

test('flushPendingTranscriptSegments keeps pending data on failure', () => {
    const originalLoad = Module._load;

    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === 'electron') {
            return {
                app: {
                    getPath() {
                        return rootDir;
                    },
                },
            };
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    delete require.cache[require.resolve(compiledDatabaseManagerPath)];

    const { DatabaseManager } = require(compiledDatabaseManagerPath);
    const dbManager = makeDbManager(DatabaseManager);

    dbManager.db = {
        transaction: () => () => {
            throw new Error('flush failed');
        },
    };

    dbManager.scheduleTranscriptFlush = () => {
        dbManager._scheduleCalls = (dbManager._scheduleCalls || 0) + 1;
    };

    dbManager.pendingTranscriptSegments.set('meeting-1', [
        { speaker: 'user', text: 'hello', timestamp: 100 },
        { speaker: 'interviewer', text: 'hi', timestamp: 200 },
    ]);

    try {
        dbManager.flushPendingTranscriptSegments();

        const remaining = dbManager.pendingTranscriptSegments.get('meeting-1') || [];
        assert.equal(remaining.length, 2);
        assert.equal(dbManager._scheduleCalls, 1);
    } finally {
        Module._load = originalLoad;
    }
});

test('flushPendingTranscriptSegments clears flushed entries on success', () => {
    const originalLoad = Module._load;

    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === 'electron') {
            return {
                app: {
                    getPath() {
                        return rootDir;
                    },
                },
            };
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    delete require.cache[require.resolve(compiledDatabaseManagerPath)];

    const { DatabaseManager } = require(compiledDatabaseManagerPath);
    const dbManager = makeDbManager(DatabaseManager);

    let transactionRan = false;
    dbManager.db = {
        transaction: (fn) => () => {
            transactionRan = true;
            fn();
        },
    };

    dbManager.pendingTranscriptSegments.set('meeting-2', [
        { speaker: 'user', text: 'first', timestamp: 300 },
    ]);

    try {
        dbManager.flushPendingTranscriptSegments();

        assert.equal(transactionRan, true);
        assert.equal(dbManager.pendingTranscriptSegments.size, 0);
    } finally {
        Module._load = originalLoad;
    }
});
