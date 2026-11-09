// First-run guide, launcher window: step 1 (Start Natively) and step 5 (the
// finished meeting), the meeting and trial events the guide moves on, and the
// hand-off to Settings for steps 6 and 7. The overlay, notes window and Settings
// draw their own steps (src/components/guide/*).
import React, { useEffect, useRef } from 'react';
import { useT } from '../../i18n';
import { getOrchestrator } from '../../lib/onboarding/orchestrator.ts';
import { GuideCard } from './GuideCard';
import { guideOn, useGuide } from './useGuide';

interface Props {
  onOpenSettings: (tab: string) => void;
  onOpenMeeting: (id: string) => void;
}

export const LauncherGuide: React.FC<Props> = ({ onOpenSettings, onOpenMeeting }) => {
  const tr = useT();
  const { state, justDone, dispatch } = useGuide();
  const active = state?.status === 'active';
  const step = active ? state!.step : null;

  // The meeting starting and stopping moves the guide (steps 1 → 2, and on to 5).
  useEffect(() => {
    if (!active) return;
    const off = window.electronAPI?.onMeetingStateChanged?.(({ isActive }) => {
      dispatch({ type: isActive ? 'meeting_started' : 'meeting_stopped' });
    });
    return () => { off?.(); };
  }, [active, dispatch]);

  // No trial to cover the meeting: one already used on this device, or the
  // automatic start failed. Step 1 must not promise one; go to the plans step.
  useEffect(() => {
    if (step !== 'start') return;
    const us = getOrchestrator().getUserState();
    if (us.trialClaimed && !us.hasTrialToken) dispatch({ type: 'trial_unavailable' });
  }, [step, dispatch]);
  useEffect(() => {
    if (!active) return;
    const off = window.electronAPI?.onTrialAutoStart?.((data) => {
      if (data.state === 'failed') dispatch({ type: 'trial_unavailable' });
    });
    return () => { off?.(); };
  }, [active, dispatch]);

  // Step 5: open the meeting that just ended. It is saved a moment after the
  // stop, so try again each time the meeting list changes, once it is opened stop.
  const openedFor = useRef<number | null>(null);
  useEffect(() => {
    if (step !== 'notes' || justDone) return;
    const key = state?.updatedAt ?? 0;
    if (openedFor.current === key) return;
    let alive = true;
    const tryOpen = () => {
      window.electronAPI?.getRecentMeetings?.()
        .then((list) => {
          const id = list?.[0]?.id;
          if (!alive || !id || openedFor.current === key) return;
          openedFor.current = key;
          onOpenMeeting(id);
        })
        .catch(() => {});
    };
    tryOpen();
    const off = window.electronAPI?.onMeetingsUpdated?.(tryOpen);
    return () => { alive = false; off?.(); };
  }, [step, justDone, state?.updatedAt, onOpenMeeting]);

  // Steps 6 and 7 live in Settings: open the right tab once per step.
  const openedSettings = useRef<string | null>(null);
  useEffect(() => {
    if ((step !== 'plans' && step !== 'keys') || justDone) return;
    const key = `${step}:${state?.updatedAt ?? 0}`;
    if (openedSettings.current === key) return;
    openedSettings.current = key;
    onOpenSettings(step === 'plans' ? 'plans' : 'ai-providers');
  }, [step, justDone, state?.updatedAt, onOpenSettings]);

  const skip = () => dispatch({ type: 'skip' });

  if (guideOn(state, 'start')) {
    return (
      <GuideCard
        anchor='[data-guide="start"]'
        place="below"
        width={330}
        stepId="start"
        eyebrow={tr('Your first meeting')}
        title={tr('Start your first meeting.')}
        body={tr('Your free trial covers it. Join your call first, or start now.')}
        waiting={tr('Waiting for you')}
        done={justDone}
        onSkip={skip}
      />
    );
  }

  if (guideOn(state, 'notes')) {
    return (
      <GuideCard
        anchor='[data-guide="meeting-tabs"]'
        place="below"
        width={340}
        stepId="notes"
        eyebrow={tr('Meeting notes')}
        title={tr('Your meeting, written up.')}
        body={tr('The summary and the full transcript are saved here. Find them any time on Home.')}
        action={{ label: tr('Next'), onClick: () => dispatch({ type: 'notes_next' }) }}
        done={justDone}
        onSkip={skip}
      />
    );
  }

  return null;
};
