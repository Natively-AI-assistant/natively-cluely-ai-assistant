import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { findSafeHandle, sliceSafeHandleBlock } from './ipcTestUtils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: Async post-call summary uses the mode that was active when meeting stopped,
//         not the mode that happens to be active when async processing runs.
// ─────────────────────────────────────────────────────────────────────────────

describe('BUG-MODE-BLEEDING: Async post-call summary mode snapshot', () => {
  test('stopMeeting snapshots active mode before session.reset() is called', () => {
    const sourcePath = path.resolve(__dirname, '../../MeetingPersistence.ts');
    const source = fs.readFileSync(sourcePath, 'utf8');

    // Extract only the stopMeeting function body
    const stopStart = source.indexOf('public async stopMeeting');
    const returnIdx = source.indexOf('return meetingId;', stopStart);
    const stopSource = source.slice(stopStart, returnIdx + 'return meetingId;'.length);
    assert.ok(stopStart >= 0, 'stopMeeting should exist');

    // The mode snapshot capture must occur BEFORE the MAIN session.reset() —
    // the one that runs after all snapshots and before the async background
    // processing call. Early-exit branches (duration<1000ms) and privacy-
    // gate branches (Phase 9 "do not persist") each have their own reset()
    // before they `return null;`, so we cannot rely on positional indices
    // ("first", "second", "third"). Find ALL resets that PRECEDE the line
    // that calls `this.processAndSaveMeeting(...)` — the last one of those
    // is the MAIN reset, and modeSnapshot must come before it.
    const processCallIdx = stopSource.indexOf('this.processAndSaveMeeting(');
    assert.ok(processCallIdx >= 0, 'processAndSaveMeeting call must exist in stopMeeting');

    let mainResetIdx = -1;
    let searchFrom = 0;
    while (true) {
      const next = stopSource.indexOf('this.session.reset()', searchFrom);
      if (next < 0 || next >= processCallIdx) break;
      mainResetIdx = next;
      searchFrom = next + 1;
    }
    assert.ok(mainResetIdx >= 0, 'A session.reset() before processAndSaveMeeting must exist (the main reset)');

    // Find the mode snapshot variable declaration
    const snapshotVarIndex = stopSource.indexOf('let modeSnapshot:');
    assert.ok(snapshotVarIndex >= 0, 'let modeSnapshot: should be declared in stopMeeting');

    // modeSnapshot must be declared before the MAIN reset (the one
    // immediately preceding processAndSaveMeeting).
    assert.ok(snapshotVarIndex < mainResetIdx,
      `let modeSnapshot: (index ${snapshotVarIndex}) must be declared before the main session.reset() (index ${mainResetIdx}) in stopMeeting`);
  });

  test('stopMeeting passes modeSnapshot to processAndSaveMeeting', () => {
    const sourcePath = path.resolve(__dirname, '../../MeetingPersistence.ts');
    const source = fs.readFileSync(sourcePath, 'utf8');

    // processAndSaveMeeting call must include modeSnapshot
    const processCallIndex = source.indexOf('this.processAndSaveMeeting(snapshot, meetingId, metadataSnapshot, modeSnapshot)');
    assert.ok(processCallIndex >= 0,
      'processAndSaveMeeting must be called with modeSnapshot as 4th argument');
  });

  test('processAndSaveMeeting accepts modeSnapshot parameter', () => {
    const sourcePath = path.resolve(__dirname, '../../MeetingPersistence.ts');
    const source = fs.readFileSync(sourcePath, 'utf8');

    // Find the function signature - extract enough chars to capture all parameters
    const fnStart = source.indexOf('private async processAndSaveMeeting(');
    assert.ok(fnStart >= 0, 'processAndSaveMeeting should exist');

    const fnSig = source.slice(fnStart, fnStart + 2000);

    // Must have modeSnapshot parameter (4th parameter after meetingId and metadata)
    assert.ok(fnSig.includes('modeSnapshot'), 'processAndSaveMeeting must accept modeSnapshot parameter');
    // modeSnapshot is optional so it appears as modeSnapshot? or just part of the type union
    assert.ok(fnSig.includes('modeSnapshot?') || fnSig.includes('modeSnapshot'),
      'modeSnapshot must be present in parameter list');
  });

  test('processAndSaveMeeting uses snapshotted mode ID for section lookup', () => {
    const sourcePath = path.resolve(__dirname, '../../MeetingPersistence.ts');
    const source = fs.readFileSync(sourcePath, 'utf8');

    // Find the processAndSaveMeeting function body
    const fnStart = source.indexOf('private async processAndSaveMeeting(');
    const fnEnd = source.indexOf('recoverUnprocessedMeetings', fnStart);
    const fnBody = source.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 18000);

    // The mode-section loading block must reference modeSnapshot.id or targetModeId
    // not just call getActiveMode() directly for section lookups
    const usesTargetModeId = fnBody.includes('targetModeId');
    const usesModeSnapshotId = fnBody.includes('modeSnapshot?.id') || fnBody.includes('modeSnapshot.id');

    assert.ok(usesTargetModeId || usesModeSnapshotId,
      'processAndSaveMeeting should use targetModeId or modeSnapshot.id for section lookups');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: setActiveMode clears session context before switching modes
// ─────────────────────────────────────────────────────────────────────────────

describe('BUG-MODE-BLEEDING: Mode-context clearing on mode switch', () => {
  test('modes:set-active IPC clears session context before calling setActiveMode', () => {
    const sourcePath = path.resolve(__dirname, '../../ipcHandlers.ts');
    const source = fs.readFileSync(sourcePath, 'utf8');

    // Find the modes:set-active handler
    const handlerStart = findSafeHandle(source, 'modes:set-active');
    assert.ok(handlerStart >= 0, 'modes:set-active handler should exist');

    const handlerBody = sliceSafeHandleBlock(source, 'modes:set-active');

    // Must call clearSessionContext before setActiveMode
    const clearIndex = handlerBody.indexOf('clearSessionContext');
    const setActiveIndex = handlerBody.indexOf('ModesManager.getInstance().setActiveMode');

    assert.ok(clearIndex >= 0, 'clearSessionContext should be called in modes:set-active handler');
    assert.ok(clearIndex < setActiveIndex,
      `clearSessionContext (index ${clearIndex}) must be called before setActiveMode (index ${setActiveIndex})`);
  });

  test('SessionTracker has clearSessionContext method', () => {
    const sourcePath = path.resolve(__dirname, '../../SessionTracker.ts');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.ok(source.includes('clearSessionContext(): void'),
      'SessionTracker must have clearSessionContext() method');
  });

  test('IntelligenceManager exposes clearSessionContext to IPC handlers', () => {
    const sourcePath = path.resolve(__dirname, '../../IntelligenceManager.ts');
    const source = fs.readFileSync(sourcePath, 'utf8');

    assert.ok(source.includes('clearSessionContext(): void'),
      'IntelligenceManager must expose clearSessionContext() method');
    assert.ok(source.includes('this.session.clearSessionContext()'),
      'IntelligenceManager.clearSessionContext must delegate to session.clearSessionContext()');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: Mode lifecycle tracking (snapshot captures mode id, name, templateType)
// ─────────────────────────────────────────────────────────────────────────────

describe('BUG-MODE-BLEEDING: Mode snapshot captures required fields', () => {
  test('stopMeeting mode snapshot includes id, name, and templateType', () => {
    const sourcePath = path.resolve(__dirname, '../../MeetingPersistence.ts');
    const source = fs.readFileSync(sourcePath, 'utf8');

    // Find the modeSnapshot assignment within stopMeeting function
    const stopStart = source.indexOf('public async stopMeeting');
    const stopEnd = source.indexOf('/**', source.indexOf('Heavy lifting'));
    const stopSource = source.slice(stopStart, stopEnd);

    const snapshotAssign = stopSource.match(/modeSnapshot\s*=\s*\{[^}]*\}/s);
    assert.ok(snapshotAssign, 'modeSnapshot assignment should be present in stopMeeting');

    const snapshot = snapshotAssign[0];
    assert.ok(snapshot.includes('id:'), 'modeSnapshot must capture id');
    assert.ok(snapshot.includes('name'), 'modeSnapshot must capture name');
    assert.ok(snapshot.includes('templateType'), 'modeSnapshot must capture templateType');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: Active mode suffix (verification that modes manager API works correctly)
// ─────────────────────────────────────────────────────────────────────────────

describe('BUG-MODE-BLEEDING: Active mode suffix appears exactly once', () => {
  test('getActiveModeSystemPromptSuffix strips shared prefix to avoid duplication', () => {
    const sourcePath = path.resolve(__dirname, '../../services/ModesManager.ts');
    const source = fs.readFileSync(sourcePath, 'utf8');

    // getActiveModeSystemPromptSuffix should be present and strip the shared prefix
    const fnIndex = source.indexOf('getActiveModeSystemPromptSuffix');
    assert.ok(fnIndex >= 0, 'getActiveModeSystemPromptSuffix should exist');

    const fnBody = source.slice(fnIndex, fnIndex + 1000);
    assert.ok(fnBody.includes('SHARED_MODE_PREFIX') || fnBody.includes('slice(prefix.length)'),
      'Suffix should strip shared prefix to avoid duplicate tokens');
  });
});