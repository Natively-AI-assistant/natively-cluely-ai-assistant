export type WorkspacePane = 'transcript' | 'copilot';
export type WorkspaceMode = 'tabs' | 'grid';

export interface WorkspaceState {
  hiddenPaneUnread: Record<WorkspacePane, number>;
  pausedScrollUnread: Record<WorkspacePane, number>;
}

export function createWorkspaceState(): WorkspaceState;

export function recordPaneItem(
  state: WorkspaceState,
  options: {
    pane: WorkspacePane;
    hidden: boolean;
    paused: boolean;
    stable: boolean;
  },
): WorkspaceState;

export function revealPane(
  state: WorkspaceState,
  pane: WorkspacePane,
): WorkspaceState;

export function goLivePane(
  state: WorkspaceState,
  pane: WorkspacePane,
): WorkspaceState;

export function resolveWorkspaceMode(
  current: WorkspaceMode,
  options: {
    targetWide: boolean;
    settled: boolean;
    reducedMotion: boolean;
  },
): WorkspaceMode;
