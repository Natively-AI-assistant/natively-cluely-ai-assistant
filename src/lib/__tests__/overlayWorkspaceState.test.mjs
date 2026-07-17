import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWorkspaceState,
  goLivePane,
  recordPaneItem,
  resolveWorkspaceMode,
  revealPane,
} from '../overlayWorkspaceState.mjs';

test('hidden and paused unread counters are independent', () => {
  const initial = createWorkspaceState();
  const recorded = recordPaneItem(initial, {
    pane: 'transcript',
    hidden: true,
    paused: true,
    stable: true,
  });

  assert.deepEqual(recorded, {
    hiddenPaneUnread: { transcript: 1, copilot: 0 },
    pausedScrollUnread: { transcript: 1, copilot: 0 },
  });

  const revealed = revealPane(recorded, 'transcript');
  assert.deepEqual(revealed, {
    hiddenPaneUnread: { transcript: 0, copilot: 0 },
    pausedScrollUnread: { transcript: 1, copilot: 0 },
  });

  const live = goLivePane(revealed, 'transcript');
  assert.deepEqual(live, {
    hiddenPaneUnread: { transcript: 0, copilot: 0 },
    pausedScrollUnread: { transcript: 0, copilot: 0 },
  });
});

test('partial/token unstable updates never increment and preserve state identity', () => {
  const initial = createWorkspaceState();

  assert.strictEqual(
    recordPaneItem(initial, {
      pane: 'transcript',
      hidden: true,
      paused: false,
      stable: false,
    }),
    initial,
  );
  assert.strictEqual(
    recordPaneItem(initial, {
      pane: 'copilot',
      hidden: false,
      paused: true,
      stable: false,
    }),
    initial,
  );
  assert.strictEqual(
    recordPaneItem(initial, {
      pane: 'invalid',
      hidden: true,
      paused: true,
      stable: true,
    }),
    initial,
  );
  assert.strictEqual(revealPane(initial, 'invalid'), initial);
  assert.strictEqual(goLivePane(initial, 'invalid'), initial);
  assert.strictEqual(revealPane(initial, 'transcript'), initial);
  assert.strictEqual(goLivePane(initial, 'transcript'), initial);
  assert.deepEqual(initial, {
    hiddenPaneUnread: { transcript: 0, copilot: 0 },
    pausedScrollUnread: { transcript: 0, copilot: 0 },
  });
});

test('collapse uses tabs immediately; expand waits for settle; reduced-motion expansion goes directly grid', () => {
  assert.equal(
    resolveWorkspaceMode('grid', {
      targetWide: false,
      settled: false,
      reducedMotion: false,
    }),
    'tabs',
  );
  assert.equal(
    resolveWorkspaceMode('tabs', {
      targetWide: true,
      settled: false,
      reducedMotion: false,
    }),
    'tabs',
  );
  assert.equal(
    resolveWorkspaceMode('tabs', {
      targetWide: true,
      settled: true,
      reducedMotion: false,
    }),
    'grid',
  );
  assert.equal(
    resolveWorkspaceMode('tabs', {
      targetWide: true,
      settled: false,
      reducedMotion: true,
    }),
    'grid',
  );
});
