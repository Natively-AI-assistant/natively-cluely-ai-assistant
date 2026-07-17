import assert from 'node:assert/strict';
import test from 'node:test';

import {
    shouldApplyFollowFrame,
    shouldScheduleContentResizeFollow,
} from '../usePaneFollowLive.ts';

test('a follow frame applies only to the same eligible pane session', () => {
    const scheduled = { pane: 'transcript', resetKey: 7 };
    const eligible = {
        pane: 'transcript',
        resetKey: 7,
        autoScroll: true,
        isFollowing: true,
        visible: true,
    };

    assert.equal(shouldApplyFollowFrame(scheduled, eligible), true);

    const ineligibleCases = [
        { label: 'autoScroll disabled', current: { ...eligible, autoScroll: false } },
        { label: 'following paused', current: { ...eligible, isFollowing: false } },
        { label: 'pane hidden', current: { ...eligible, visible: false } },
        { label: 'session reset', current: { ...eligible, resetKey: 8 } },
        { label: 'pane changed', current: { ...eligible, pane: 'copilot' } },
    ];

    for (const { label, current } of ineligibleCases) {
        assert.equal(shouldApplyFollowFrame(scheduled, current), false, label);
    }
});

test('imperative content growth only schedules follow for the current eligible pane session', () => {
    const scheduled = { pane: 'copilot', resetKey: 3 };
    const eligible = {
        pane: 'copilot',
        resetKey: 3,
        autoScroll: true,
        isFollowing: true,
        visible: true,
    };

    assert.equal(
        shouldScheduleContentResizeFollow(scheduled, eligible),
        true,
    );

    for (const current of [
        { ...eligible, autoScroll: false },
        { ...eligible, isFollowing: false },
        { ...eligible, visible: false },
        { ...eligible, resetKey: 4 },
        { ...eligible, pane: 'transcript' },
    ]) {
        assert.equal(
            shouldScheduleContentResizeFollow(scheduled, current),
            false,
        );
    }
});
