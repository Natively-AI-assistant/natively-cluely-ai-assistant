import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  createWorkspaceState,
  recordPaneItem,
  revealPane,
  type WorkspaceMode,
  type WorkspacePane,
} from '../../lib/overlayWorkspaceState.mjs';

interface Props {
  mode: WorkspaceMode;
  transcriptEnabled: boolean;
  transcriptCommitRevision: number;
  transcriptPartialActive: boolean;
  copilotMessageKey: string | null;
  resetKey: number;
  transcriptPane(visible: boolean): React.ReactNode;
  copilotPane(visible: boolean): React.ReactNode;
  footer: React.ReactNode;
}

export default function AdaptiveMeetingWorkspace({
  mode,
  transcriptEnabled,
  transcriptCommitRevision,
  transcriptPartialActive,
  copilotMessageKey,
  resetKey,
  transcriptPane,
  copilotPane,
  footer,
}: Props) {
  const [activePane, setActivePane] = useState<WorkspacePane>(
    transcriptEnabled ? 'transcript' : 'copilot',
  );
  const [renderMode, setRenderMode] = useState(mode);
  const [renderTranscript, setRenderTranscript] = useState(transcriptEnabled);
  const [workspaceState, setWorkspaceState] = useState(createWorkspaceState);
  const previousTranscriptRevision = useRef(transcriptCommitRevision);
  const previousCopilotKey = useRef<string | null>(copilotMessageKey);
  const previousResetKey = useRef(resetKey);
  const tabFocusFrame = useRef<number | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const transcriptTabRef = useRef<HTMLButtonElement>(null);
  const copilotTabRef = useRef<HTMLButtonElement>(null);
  const resetPending = previousResetKey.current !== resetKey;
  const targetActivePane = resetPending
    ? transcriptEnabled ? 'transcript' : 'copilot'
    : !transcriptEnabled && activePane === 'transcript'
      ? 'copilot'
      : activePane;
  const targetCompact = mode === 'tabs';
  const targetTranscriptVisible = transcriptEnabled && (
    !targetCompact || targetActivePane === 'transcript'
  );
  const targetCopilotVisible = !targetCompact || !transcriptEnabled || targetActivePane === 'copilot';
  const compact = renderMode === 'tabs';
  const split = renderMode === 'grid' && renderTranscript;
  const transcriptVisible = renderTranscript && (!compact || activePane === 'transcript');
  const copilotVisible = !compact || !renderTranscript || activePane === 'copilot';
  const visibilitySettled =
    !resetPending &&
    renderMode === mode &&
    renderTranscript === transcriptEnabled &&
    activePane === targetActivePane;

  useEffect(() => {
    const delta = Math.max(0, transcriptCommitRevision - previousTranscriptRevision.current);
    previousTranscriptRevision.current = transcriptCommitRevision;
    if (delta > 0 && !targetTranscriptVisible) {
      setWorkspaceState((state) => {
        let next = state;
        for (let index = 0; index < delta; index += 1) {
          next = recordPaneItem(next, {
            pane: 'transcript', hidden: true, paused: false, stable: true,
          });
        }
        return next;
      });
    }
  }, [targetTranscriptVisible, transcriptCommitRevision]);

  useEffect(() => {
    const changed = copilotMessageKey !== null && copilotMessageKey !== previousCopilotKey.current;
    previousCopilotKey.current = copilotMessageKey;
    if (changed && !targetCopilotVisible) {
      setWorkspaceState((state) => recordPaneItem(state, {
        pane: 'copilot', hidden: true, paused: false, stable: true,
      }));
    }
  }, [copilotMessageKey, targetCopilotVisible]);

  useLayoutEffect(() => {
    const resetChanged = resetPending;
    const structureChanged = renderMode !== mode || renderTranscript !== transcriptEnabled;
    if (!resetChanged && !structureChanged) return;

    if (tabFocusFrame.current !== null) {
      cancelAnimationFrame(tabFocusFrame.current);
      tabFocusFrame.current = null;
    }

    const nextActivePane = targetActivePane;
    const nextCompact = mode === 'tabs';
    const nextTranscriptVisible = transcriptEnabled && (
      !nextCompact || nextActivePane === 'transcript'
    );
    const nextCopilotVisible = !nextCompact || !transcriptEnabled || nextActivePane === 'copilot';
    const activeElement = document.activeElement;
    const transcriptPanel = document.getElementById('overlay-panel-transcript');
    const copilotPanel = document.getElementById('overlay-panel-copilot');
    const transcriptTabFocused = transcriptTabRef.current === activeElement;
    const copilotTabFocused = copilotTabRef.current === activeElement;
    const focusedPanelWillHide =
      (transcriptPanel?.contains(activeElement) && !nextTranscriptVisible) ||
      (copilotPanel?.contains(activeElement) && !nextCopilotVisible);
    const focusedTabWillUnmount =
      renderMode === 'tabs' &&
      renderTranscript &&
      (mode !== 'tabs' || !transcriptEnabled) &&
      (transcriptTabFocused || copilotTabFocused);
    const focusedActiveTabWillChange =
      resetChanged &&
      nextActivePane !== activePane &&
      (
        (activePane === 'transcript' && transcriptTabFocused) ||
        (activePane === 'copilot' && copilotTabFocused)
      );

    if (focusedPanelWillHide || focusedTabWillUnmount || focusedActiveTabWillChange) {
      workspaceRef.current?.focus();
    }

    if (resetChanged) {
      previousResetKey.current = resetKey;
      setWorkspaceState(createWorkspaceState());
      previousTranscriptRevision.current = transcriptCommitRevision;
      previousCopilotKey.current = copilotMessageKey;
    }
    if (nextActivePane !== activePane) setActivePane(nextActivePane);
    if (renderMode !== mode) setRenderMode(mode);
    if (renderTranscript !== transcriptEnabled) setRenderTranscript(transcriptEnabled);
  }, [
    activePane,
    copilotMessageKey,
    mode,
    renderMode,
    renderTranscript,
    resetKey,
    resetPending,
    targetActivePane,
    transcriptCommitRevision,
    transcriptEnabled,
  ]);

  useLayoutEffect(() => {
    if (!visibilitySettled) return;
    setWorkspaceState((state) => {
      let next = state;
      if (transcriptVisible) next = revealPane(next, 'transcript');
      if (copilotVisible) next = revealPane(next, 'copilot');
      return next;
    });
  }, [copilotVisible, transcriptVisible, visibilitySettled]);

  useEffect(() => () => {
    if (tabFocusFrame.current !== null) {
      cancelAnimationFrame(tabFocusFrame.current);
      tabFocusFrame.current = null;
    }
  }, []);

  const activate = (pane: WorkspacePane, focus = false) => {
    if (tabFocusFrame.current !== null) {
      cancelAnimationFrame(tabFocusFrame.current);
      tabFocusFrame.current = null;
    }
    if (pane !== activePane) {
      const activePanel = document.getElementById(`overlay-panel-${activePane}`);
      if (activePanel?.contains(document.activeElement)) {
        (activePane === 'transcript' ? transcriptTabRef.current : copilotTabRef.current)?.focus();
      }
    }
    setActivePane(pane);
    setWorkspaceState((state) => revealPane(state, pane));
    if (focus) {
      tabFocusFrame.current = requestAnimationFrame(() => {
        tabFocusFrame.current = null;
        const tab = pane === 'transcript' ? transcriptTabRef.current : copilotTabRef.current;
        if (tab?.isConnected && tab.getAttribute('aria-selected') === 'true') {
          tab.focus();
        }
      });
    }
  };

  const onTabKeyDown = (event: React.KeyboardEvent, pane: WorkspacePane) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home'
      ? 'transcript'
      : event.key === 'End'
        ? 'copilot'
        : pane === 'transcript' ? 'copilot' : 'transcript';
    activate(next, true);
  };

  return (
    <div
      ref={workspaceRef}
      data-testid="overlay-workspace"
      data-workspace-mode={renderMode}
      tabIndex={-1}
      className="flex min-h-0 min-w-0 flex-col p-3 pt-2"
    >
      {compact && renderTranscript && (
        <div
          role="tablist"
          aria-label="Conteúdo da reunião"
          data-testid="compact-tabs"
          className="mb-2 grid grid-cols-2 rounded-xl border border-[color:var(--overlay-border-soft)] p-1 overlay-control-surface"
        >
          <button
            ref={transcriptTabRef}
            id="overlay-tab-transcript"
            role="tab"
            type="button"
            aria-selected={activePane === 'transcript'}
            aria-controls="overlay-panel-transcript"
            tabIndex={activePane === 'transcript' ? 0 : -1}
            onClick={() => activate('transcript')}
            onKeyDown={(event) => onTabKeyDown(event, 'transcript')}
            className={`rounded-lg px-3 py-1.5 text-[11px] ${
              activePane === 'transcript'
                ? 'font-medium overlay-subtle-surface overlay-text-primary'
                : 'overlay-text-muted'
            }`}
          >
            Ao vivo
            {workspaceState.hiddenPaneUnread.transcript > 0 &&
              ` (${workspaceState.hiddenPaneUnread.transcript})`}
            {workspaceState.hiddenPaneUnread.transcript === 0 &&
              activePane !== 'transcript' && transcriptPartialActive && ' •'}
          </button>
          <button
            ref={copilotTabRef}
            id="overlay-tab-copilot"
            role="tab"
            type="button"
            aria-selected={activePane === 'copilot'}
            aria-controls="overlay-panel-copilot"
            tabIndex={activePane === 'copilot' ? 0 : -1}
            onClick={() => activate('copilot')}
            onKeyDown={(event) => onTabKeyDown(event, 'copilot')}
            className={`rounded-lg px-3 py-1.5 text-[11px] ${
              activePane === 'copilot'
                ? 'font-medium overlay-subtle-surface overlay-text-primary'
                : 'overlay-text-muted'
            }`}
          >
            Copiloto{workspaceState.hiddenPaneUnread.copilot > 0 &&
              ` (${workspaceState.hiddenPaneUnread.copilot})`}
          </button>
        </div>
      )}

      <div
        className={split
          ? 'grid min-h-0 min-w-0 grid-cols-[minmax(240px,0.84fr)_minmax(0,1.16fr)] gap-x-3'
          : 'grid min-h-0 min-w-0 grid-cols-1'}
      >
        <div
          id="overlay-panel-transcript"
          role={compact ? 'tabpanel' : undefined}
          aria-labelledby={compact ? 'overlay-tab-transcript' : undefined}
          aria-hidden={!transcriptVisible}
          inert={!transcriptVisible}
          onFocusCapture={() => setActivePane('transcript')}
          onPointerDownCapture={() => setActivePane('transcript')}
          onWheelCapture={() => setActivePane('transcript')}
          className="col-start-1 row-start-1 min-h-0 min-w-0"
          data-visibility={transcriptVisible ? 'visible' : 'hidden'}
          style={{
            visibility: transcriptVisible ? 'visible' : 'hidden',
            pointerEvents: transcriptVisible ? 'auto' : 'none',
          }}
        >
          {transcriptPane(transcriptVisible)}
        </div>

        <div
          id="overlay-panel-copilot"
          role={compact && renderTranscript ? 'tabpanel' : undefined}
          aria-labelledby={compact && renderTranscript ? 'overlay-tab-copilot' : undefined}
          aria-hidden={!copilotVisible}
          inert={!copilotVisible}
          onFocusCapture={() => setActivePane('copilot')}
          onPointerDownCapture={() => setActivePane('copilot')}
          onWheelCapture={() => setActivePane('copilot')}
          className={`${split ? 'col-start-2' : 'col-start-1'} row-start-1 min-h-0 min-w-0`}
          data-visibility={copilotVisible ? 'visible' : 'hidden'}
          style={{
            visibility: copilotVisible ? 'visible' : 'hidden',
            pointerEvents: copilotVisible ? 'auto' : 'none',
          }}
        >
          {copilotPane(copilotVisible)}
        </div>
      </div>

      <div className={split
        ? 'grid min-w-0 grid-cols-[minmax(240px,0.84fr)_minmax(0,1.16fr)] gap-x-3'
        : 'min-w-0'}>
        {split && <div aria-hidden="true" />}
        <div
          data-testid="overlay-footer"
          className={split ? 'col-start-2 min-w-0' : 'min-w-0'}
        >
          {footer}
        </div>
      </div>
    </div>
  );
}
