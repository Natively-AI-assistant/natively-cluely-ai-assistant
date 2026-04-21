const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const rootDir = process.cwd();
const compiledVectorStorePath = path.join(rootDir, 'dist-electron/electron/rag/VectorStore.js');

function makeChunk(meetingId, chunkIndex, text) {
    return {
        meetingId,
        chunkIndex,
        speaker: 'user',
        startMs: chunkIndex * 1000,
        endMs: chunkIndex * 1000 + 500,
        text,
        tokenCount: Math.max(1, text.split(/\s+/).length),
    };
}

function createFakeDb() {
    const chunks = [];
    let nextId = 1;

    const normalize = (sql) => sql.replace(/\s+/g, ' ').trim().toLowerCase();

    return {
        transaction(fn) {
            return () => fn();
        },
        prepare(sql) {
            const normalized = normalize(sql);

            if (normalized.includes('select count(*) as cnt from vec_chunks_768')) {
                return {
                    get() {
                        throw new Error('vec0 table not available in test stub');
                    },
                };
            }

            if (normalized.startsWith('insert into chunks')) {
                return {
                    run(meetingId, chunkIndex, chunkSource, speaker, startMs, endMs, text, tokenCount) {
                        const row = {
                            id: nextId++,
                            meeting_id: meetingId,
                            chunk_index: chunkIndex,
                            chunk_source: chunkSource,
                            speaker,
                            start_timestamp_ms: startMs,
                            end_timestamp_ms: endMs,
                            cleaned_text: text,
                            token_count: tokenCount,
                            embedding: null,
                        };
                        chunks.push(row);
                        return { lastInsertRowid: row.id, changes: 1 };
                    },
                };
            }

            if (normalized.startsWith('select * from chunks where meeting_id = ?')) {
                return {
                    all(...params) {
                        const meetingId = params[0];
                        const source = params.length > 1 ? params[1] : undefined;
                        return chunks
                            .filter((r) => r.meeting_id === meetingId)
                            .filter((r) => !source || r.chunk_source === source)
                            .sort((a, b) => a.chunk_index - b.chunk_index)
                            .map((r) => ({ ...r }));
                    },
                };
            }

            if (normalized.startsWith('delete from chunks where meeting_id = ?')) {
                return {
                    run(...params) {
                        const meetingId = params[0];
                        const source = params.length > 1 ? params[1] : undefined;
                        const before = chunks.length;
                        for (let i = chunks.length - 1; i >= 0; i--) {
                            const row = chunks[i];
                            if (row.meeting_id !== meetingId) continue;
                            if (source && row.chunk_source !== source) continue;
                            chunks.splice(i, 1);
                        }
                        return { changes: before - chunks.length };
                    },
                };
            }

            if (normalized.startsWith('select count(*) as count from chunks')) {
                return {
                    get(...params) {
                        const meetingId = params[0];
                        const source = params.length > 1 ? params[1] : undefined;
                        const count = chunks.filter((r) => r.meeting_id === meetingId)
                            .filter((r) => !source || r.chunk_source === source)
                            .filter((r) => r.embedding !== null)
                            .length;
                        return { count };
                    },
                };
            }

            throw new Error(`Unhandled SQL in fake DB: ${sql}`);
        },
    };
}

test('VectorStore persists and selectively deletes live/final chunk sources', () => {
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

    delete require.cache[require.resolve(compiledVectorStorePath)];

    try {
        const { VectorStore } = require(compiledVectorStorePath);
        const db = createFakeDb();

        const store = new VectorStore(db, ':memory:', '');

        store.saveChunks([makeChunk('meeting-1', 0, 'live chunk')], 'live');
        store.saveChunks([makeChunk('meeting-1', 1, 'final chunk')], 'final');

        const allBeforeDelete = store.getChunksForMeeting('meeting-1');
        const liveCount = allBeforeDelete.filter((c) => c.source === 'live').length;
        const finalCount = allBeforeDelete.filter((c) => c.source === 'final').length;

        assert.equal(liveCount, 1);
        assert.equal(finalCount, 1);

        store.deleteChunksForMeeting('meeting-1', 'live');

        const remaining = store.getChunksForMeeting('meeting-1');

        assert.equal(remaining.length, 1);
        assert.equal(remaining[0].source, 'final');
        assert.equal(remaining[0].text, 'final chunk');
    } finally {
        Module._load = originalLoad;
    }
});
