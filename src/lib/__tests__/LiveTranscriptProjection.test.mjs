/**
 * always-on-live-transcript projection rules (InterviewMan listen ticket 02).
 *
 * User-mic chunks must stay visible on the overlay rolling bar whenever
 * listen transport is armed — not only when Answers/Ask sets isManualRecording.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  projectLiveTranscriptChunk,
  shouldKeepUserMicChunk,
} from '../liveTranscriptProjection.mjs';

describe('shouldKeepUserMicChunk', () => {
  test('keeps user chunks when listenArmed without manual recording', () => {
    assert.equal(
      shouldKeepUserMicChunk({ listenArmed: true, isManualRecording: false }),
      true,
    );
  });

  test('keeps user chunks when manual recording without listenArmed (Ask path)', () => {
    assert.equal(
      shouldKeepUserMicChunk({ listenArmed: false, isManualRecording: true }),
      true,
    );
  });

  test('drops user chunks when neither armed nor manual recording', () => {
    assert.equal(
      shouldKeepUserMicChunk({ listenArmed: false, isManualRecording: false }),
      false,
    );
  });
});

describe('projectLiveTranscriptChunk', () => {
  test('armed transport projects user-mic to rolling without Answers', () => {
    const route = projectLiveTranscriptChunk({
      speaker: 'user',
      listenArmed: true,
      isManualRecording: false,
    });
    assert.deepEqual(route, {
      projectToRolling: true,
      captureForAsk: false,
    });
  });

  test('paused/idle transport does not project user-mic to rolling', () => {
    const route = projectLiveTranscriptChunk({
      speaker: 'user',
      listenArmed: false,
      isManualRecording: false,
    });
    assert.deepEqual(route, {
      projectToRolling: false,
      captureForAsk: false,
    });
  });

  test('manual recording captures for Ask even when not armed', () => {
    const route = projectLiveTranscriptChunk({
      speaker: 'user',
      listenArmed: false,
      isManualRecording: true,
    });
    assert.deepEqual(route, {
      projectToRolling: false,
      captureForAsk: true,
    });
  });

  test('armed + manual recording projects to rolling and captures for Ask', () => {
    const route = projectLiveTranscriptChunk({
      speaker: 'user',
      listenArmed: true,
      isManualRecording: true,
    });
    assert.deepEqual(route, {
      projectToRolling: true,
      captureForAsk: true,
    });
  });

  test('interviewer always projects to rolling', () => {
    const route = projectLiveTranscriptChunk({
      speaker: 'interviewer',
      listenArmed: false,
      isManualRecording: false,
    });
    assert.deepEqual(route, {
      projectToRolling: true,
      captureForAsk: false,
    });
  });
});
