import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LISTEN_TRANSPORT_EFFECTS,
  planAskSubmitAction,
  askSubmitTouchesListenTransport,
} from '../askSubmit.mjs';

describe('askSubmit (ticket 04 — decouple from listen transport)', () => {
  test('idle Ask arms voice capture only — no listen-transport effects', () => {
    const plan = planAskSubmitAction({
      isVoiceCaptureArmed: false,
      hasQuestionOrAttachments: false,
    });
    assert.equal(plan.action, 'arm_voice_capture');
    assert.equal(askSubmitTouchesListenTransport(plan.effects), false);
    for (const effect of LISTEN_TRANSPORT_EFFECTS) {
      assert.equal(plan.effects.includes(effect), false);
    }
  });

  test('empty speech errors without listen-transport toggle', () => {
    const plan = planAskSubmitAction({
      isVoiceCaptureArmed: true,
      hasQuestionOrAttachments: false,
    });
    assert.equal(plan.action, 'empty_speech_error');
    assert.deepEqual([...plan.effects], ['showEmptySpeechError']);
    assert.equal(askSubmitTouchesListenTransport(plan.effects), false);
  });

  test('submit path streams chat without listen-transport effects', () => {
    const plan = planAskSubmitAction({
      isVoiceCaptureArmed: true,
      hasQuestionOrAttachments: true,
    });
    assert.equal(plan.action, 'submit');
    assert.ok(plan.effects.includes('finalizeMicSTT'));
    assert.ok(plan.effects.includes('streamChatOrRag'));
    assert.equal(askSubmitTouchesListenTransport(plan.effects), false);
  });

  test('askSubmitTouchesListenTransport detects forbidden effects', () => {
    assert.equal(askSubmitTouchesListenTransport(['toggleListenTransport']), true);
    assert.equal(askSubmitTouchesListenTransport(['listen-transport:toggle']), true);
    assert.equal(askSubmitTouchesListenTransport(['streamChatOrRag']), false);
  });
});
