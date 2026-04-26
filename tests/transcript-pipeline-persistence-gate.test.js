const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const rootDir = process.cwd();
const compiledSessionTrackerPath = path.join(rootDir, 'dist-electron/electron/SessionTracker.js');
const compiledPipelinePath = path.join(rootDir, 'dist-electron/electron/TranscriptPipeline.js');

function makeFinalSegment({ speaker, text, timestamp }) {
    return {
        speaker,
        text,
        timestamp,
        final: true,
        confidence: 1,
    };
}

test('Final segment persistence and RAG feed stay active when SessionTracker returns null for duplicates', async () => {
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
    delete require.cache[require.resolve(compiledPipelinePath)];

    const { SessionTracker } = require(compiledSessionTrackerPath);
    const { persistAndIndexFinalTranscriptSegment } = require(compiledPipelinePath);

    try {
        const session = new SessionTracker();
        const appended = [];
        const ragFed = [];
        let appendAttempts = 0;

        const now = Date.now();

        const first = makeFinalSegment({
            speaker: 'interviewer',
            text: 'Tell me about yourself',
            timestamp: now,
        });

        const duplicate = makeFinalSegment({
            speaker: 'interviewer',
            text: 'Tell me about yourself',
            timestamp: now + 200,
        });

        const firstResult = session.handleTranscript(first);
        assert.ok(firstResult);

        persistAndIndexFinalTranscriptSegment({
            isFinal: first.final,
            activeMeetingId: 'meeting-abc',
            speaker: first.speaker,
            text: first.text,
            timestamp: first.timestamp,
            transcriptResult: firstResult,
            appendTranscriptSegment: (meetingId, segment) => {
                appendAttempts += 1;
                // Simulate swallowed DB write failure on first attempt.
                if (appendAttempts === 1) {
                    return;
                }
                appended.push({ meetingId, segment });
            },
            feedLiveTranscript: (segments) => {
                ragFed.push(segments);
            },
        });

        const duplicateResult = session.handleTranscript(duplicate);
        assert.equal(duplicateResult, null);

        persistAndIndexFinalTranscriptSegment({
            isFinal: duplicate.final,
            activeMeetingId: 'meeting-abc',
            speaker: duplicate.speaker,
            text: duplicate.text,
            timestamp: duplicate.timestamp,
            transcriptResult: duplicateResult,
            appendTranscriptSegment: (meetingId, segment) => {
                appendAttempts += 1;
                appended.push({ meetingId, segment });
            },
            feedLiveTranscript: (segments) => {
                ragFed.push(segments);
            },
        });

        assert.equal(appendAttempts, 2);
        assert.equal(appended.length, 1);
        assert.equal(appended[0].meetingId, 'meeting-abc');
        assert.equal(appended[0].segment.text, 'Tell me about yourself');
        assert.equal(ragFed.length, 2);
    } finally {
        Module._load = originalLoad;
    }
});
