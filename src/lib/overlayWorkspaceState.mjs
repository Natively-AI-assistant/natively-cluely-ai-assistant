const isWorkspacePane = (pane) => pane === 'transcript' || pane === 'copilot';

export function createWorkspaceState() {
  return {
    hiddenPaneUnread: { transcript: 0, copilot: 0 },
    pausedScrollUnread: { transcript: 0, copilot: 0 },
  };
}

export function recordPaneItem(state, { pane, hidden, paused, stable }) {
  if (!stable || !isWorkspacePane(pane) || (!hidden && !paused)) {
    return state;
  }

  return {
    hiddenPaneUnread: hidden
      ? {
          ...state.hiddenPaneUnread,
          [pane]: state.hiddenPaneUnread[pane] + 1,
        }
      : state.hiddenPaneUnread,
    pausedScrollUnread: paused
      ? {
          ...state.pausedScrollUnread,
          [pane]: state.pausedScrollUnread[pane] + 1,
        }
      : state.pausedScrollUnread,
  };
}

export function revealPane(state, pane) {
  if (!isWorkspacePane(pane) || state.hiddenPaneUnread[pane] === 0) {
    return state;
  }

  return {
    ...state,
    hiddenPaneUnread: {
      ...state.hiddenPaneUnread,
      [pane]: 0,
    },
  };
}

export function goLivePane(state, pane) {
  if (!isWorkspacePane(pane) || state.pausedScrollUnread[pane] === 0) {
    return state;
  }

  return {
    ...state,
    pausedScrollUnread: {
      ...state.pausedScrollUnread,
      [pane]: 0,
    },
  };
}

export function resolveWorkspaceMode(
  current,
  { targetWide, settled, reducedMotion },
) {
  if (!targetWide) {
    return 'tabs';
  }

  if (reducedMotion || settled) {
    return 'grid';
  }

  return current;
}
