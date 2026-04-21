const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const rootDir = process.cwd();
const compiledDatabaseManagerPath = path.join(rootDir, 'dist-electron/electron/db/DatabaseManager.js');

function createFakeDb() {
    const rowsById = {
        'meeting-processed': {
            id: 'meeting-processed',
            title: 'Processed',
            created_at: '2026-04-21T00:00:00.000Z',
            duration_ms: 90_000,
            summary_json: JSON.stringify({
                legacySummary: 'done',
                detailedSummary: { actionItems: ['a'], keyPoints: ['k'] },
            }),
            calendar_event_id: null,
            source: 'manual',
            is_processed: 1,
        },
        'meeting-unprocessed': {
            id: 'meeting-unprocessed',
            title: 'Unprocessed',
            created_at: '2026-04-21T00:00:00.000Z',
            duration_ms: 90_000,
            summary_json: JSON.stringify({
                legacySummary: '',
                detailedSummary: { actionItems: [], keyPoints: [] },
            }),
            calendar_event_id: null,
            source: 'manual',
            is_processed: 0,
        },
    };

    return {
        prepare(sql) {
            const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

            if (normalized === 'select * from meetings where id = ?') {
                return {
                    get(id) {
                        return rowsById[id];
                    },
                };
            }

            if (normalized.startsWith('select * from transcripts where meeting_id = ?')) {
                return {
                    all() {
                        return [];
                    },
                };
            }

            if (normalized.startsWith('select * from ai_interactions where meeting_id = ?')) {
                return {
                    all() {
                        return [];
                    },
                };
            }

            throw new Error(`Unhandled SQL in fake DB: ${sql}`);
        },
    };
}

test('DatabaseManager.getMeetingDetails includes isProcessed from meetings.is_processed', () => {
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

    try {
        const { DatabaseManager } = require(compiledDatabaseManagerPath);
        const dbManager = Object.create(DatabaseManager.prototype);
        dbManager.db = createFakeDb();

        const processed = dbManager.getMeetingDetails('meeting-processed');
        const unprocessed = dbManager.getMeetingDetails('meeting-unprocessed');

        assert.equal(processed?.isProcessed, true);
        assert.equal(unprocessed?.isProcessed, false);
    } finally {
        Module._load = originalLoad;
    }
});
