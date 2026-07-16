const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const originalModuleLoad = Module._load;
Module._load = function mockElectron(request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: { getPath: () => '/tmp' },
      BrowserWindow: { getAllWindows: () => [] },
    };
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};
const { MeetingPersistence } = require('../dist-electron/electron/MeetingPersistence.js');
const { DatabaseManager } = require('../dist-electron/electron/db/DatabaseManager.js');
Module._load = originalModuleLoad;

test('placeholder is saved before an update-only finalizer', async () => {
  const calls = [];
  const originalGetInstance = DatabaseManager.getInstance;
  DatabaseManager.getInstance = () => ({
    saveMeeting: (_meeting, _start, _duration, options = {}) => {
      calls.push(options);
      return calls.length === 1;
    },
  });

  const startedAt = Date.now() - 2_000;
  const session = {
    flushInterimTranscript() {},
    getSessionStartTime: () => startedAt,
    getFullTranscript: () => [],
    getFullUsage: () => [],
    getFullSessionContext: () => '',
    getMeetingMetadata: () => ({ title: 'Prepared interview' }),
    reset() {},
  };
  const persistence = new MeetingPersistence(session, {});

  try {
    const meetingId = await persistence.stopMeeting();
    assert.ok(meetingId);
    assert.deepEqual(calls, [{}, { requireExisting: true }]);
  } finally {
    DatabaseManager.getInstance = originalGetInstance;
  }
});
