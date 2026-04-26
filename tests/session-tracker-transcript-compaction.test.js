const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { SessionTracker } = require(path.join(process.cwd(), 'dist-electron/electron/SessionTracker.js'));

function makeSegment(index) {
    return {
        speaker: 'interviewer',
        text: `segment ${index}`,
        timestamp: index,
        final: true,
        confidence: 1,
    };
}

test('SessionTracker compacts in-memory transcript for context after threshold', async () => {
    const tracker = new SessionTracker();

    for (let index = 0; index <= 1800; index++) {
        tracker.addTranscript(makeSegment(index));
    }

    await new Promise((resolve) => setImmediate(resolve));

    const transcript = tracker.getFullTranscript();
    assert.equal(transcript.length, 1301);
    assert.equal(transcript[0].text, 'segment 500');
    assert.equal(transcript.at(-1).text, 'segment 1800');

    const fullContext = tracker.getFullSessionContext();
    assert.match(fullContext, /SESSION HISTORY - EARLIER DISCUSSION/);
    assert.match(fullContext, /Earlier discussion/);
});