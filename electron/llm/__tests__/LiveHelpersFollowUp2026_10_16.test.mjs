// Granola parity round 5 (2026-10-16): the fourth live helper, "Follow-up
// questions" (Granola's suggest-follow-up-questions). Same envelope as the
// other three; this checks it is wired into every table the helpers share.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const lh = require(path.join(REPO, 'dist-electron/electron/llm/liveHelpers.js'));

describe('follow_up_questions live helper', () => {
    test('is a known action with a window, an empty message, a prompt and a task line', () => {
        assert.ok(lh.LIVE_HELPER_ACTIONS.includes('follow_up_questions'));
        assert.equal(lh.isLiveHelperAction('follow_up_questions'), true);
        assert.ok(lh.LIVE_HELPER_WINDOW_SECONDS.follow_up_questions >= 120);
        assert.match(lh.LIVE_HELPER_EMPTY.follow_up_questions, /no conversation yet/i);
        const prompt = lh.liveHelperSystemPrompt('follow_up_questions', undefined);
        assert.match(prompt, /follow-up questions/i);
        assert.match(prompt, /nothing invented/i);
    });
    test('shows on Clarify\'s line, like Sound smart', () => {
        assert.equal(lh.liveHelperDisplayKind('follow_up_questions'), 'clarify');
        assert.equal(lh.liveHelperDisplayKind('catch_me_up'), 'recap');
    });
});
