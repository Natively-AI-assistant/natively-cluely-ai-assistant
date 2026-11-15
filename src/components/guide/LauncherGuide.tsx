// First-run guide, launcher window: step 1 (Start Natively) and step 6 (the
// finished meeting), the meeting and trial events the guide moves on, and the
// hand-off to Settings for steps 6 and 7. The overlay, notes window and Settings
// draw their own steps (src/components/guide/*).
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../i18n';
import { trialEventFromLocal } from '../../lib/onboarding/firstRunGuide.mjs';
import { GuideCard } from './GuideCard';
import { guideOn, useAnchorRect, useGuide } from './useGuide';

/** The control each launcher-side step points at (steps 6 and 7 live in Settings, in this window). */
const STEP_ANCHOR: Partial<Record<string, string>> = {
  notes: '[data-guide="meeting-tabs"]',
  plans: '[data-guide="nav-plans"]',
  keys: '[data-guide="nav-ai-providers"]',
};
/** How long a step's control may be off screen before the way back shows. */
const OFF_SCREEN_MS = 1200;

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

  // No trial to cover the meeting: used up, already claimed on this device, or
  // the automatic start failed. Step 1 must not promise one; go to the plans
  // step. Asked of main each time, not read from a cache that may not be filled yet.
  useEffect(() => {
    if (step !== 'start') return;
    let alive = true;
    window.electronAPI?.getLocalTrial?.()
      .then((local) => {
        const ev = trialEventFromLocal(local);
        if (alive && ev) dispatch({ type: ev });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [step, dispatch]);
  useEffect(() => {
    if (!active) return;
    const off = window.electronAPI?.onTrialAutoStart?.((data) => {
      if (data.state === 'failed') dispatch({ type: 'trial_unavailable' });
    });
    return () => { off?.(); };
  }, [active, dispatch]);

  // Step 5: open the meeting main saved when the first meeting ended
  // (meeting_saved), once per meeting.
  const endedMeetingId = state?.endedMeetingId ?? null;
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    if (step !== 'notes' || justDone || !endedMeetingId || openedFor.current === endedMeetingId) return;
    openedFor.current = endedMeetingId;
    onOpenMeeting(endedMeetingId);
  }, [step, justDone, endedMeetingId, onOpenMeeting]);

  // Steps 7 and 8 live in Settings: open the right tab once per step.
  const openedSettings = useRef<string | null>(null);
  useEffect(() => {
    if ((step !== 'plans' && step !== 'keys') || justDone) return;
    const key = `${step}:${state?.updatedAt ?? 0}`;
    if (openedSettings.current === key) return;
    openedSettings.current = key;
    onOpenSettings(step === 'plans' ? 'plans' : 'ai-providers');
  }, [step, justDone, state?.updatedAt, onOpenSettings]);

  const skip = () => dispatch({ type: 'skip' });

  // The way back: a step whose control is not on screen (Settings closed, or
  // the user left the meeting) shows one small button instead of nothing,
  // since the guide holds the card slot while it runs.
  const anchor = step && !justDone ? STEP_ANCHOR[step] ?? null : null;
  const anchorRect = useAnchorRect(anchor);
  const [offScreen, setOffScreen] = useState(false);
  useEffect(() => {
    setOffScreen(false);
    if (!anchor || anchorRect || (step === 'notes' && !endedMeetingId)) return;
    const timer = setTimeout(() => setOffScreen(true), OFF_SCREEN_MS);
    return () => clearTimeout(timer);
  }, [anchor, anchorRect, step, endedMeetingId]);
  const resume = () => {
    if (step === 'notes' && endedMeetingId) onOpenMeeting(endedMeetingId);
    else if (step === 'plans') onOpenSettings('plans');
    else if (step === 'keys') onOpenSettings('ai-providers');
  };

  if (guideOn(state, 'start')) {
    return (
      <GuideCard
        anchor='[data-guide="start"]'
        width={330}
        stepId="start"
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
        width={340}
        stepId="notes"
        title={tr('Your meeting, written up.')}
        body={tr('The summary and the full transcript are saved here. Find them any time on Home.')}
        action={{ label: tr('Next'), onClick: () => dispatch({ type: 'notes_next' }) }}
        done={justDone}
        onSkip={skip}
      />
    );
  }

  if (offScreen && anchor) return <ContinueGuide label={tr('Continue the guide')} skipLabel={tr('Skip guide')} onContinue={resume} onSkip={skip} />;

  return null;
};

/** The guide's step is off screen: one floating pill, the tip's own surface. */
const ContinueGuide: React.FC<{ label: string; skipLabel: string; onContinue: () => void; onSkip: () => void }> = ({
  label, skipLabel, onContinue, onSkip,
}) => createPortal(
  <div
    className="guide-enter guide-pill"
    data-guide-card="continue"
    style={{ position: 'fixed', left: '50%', bottom: 20, transform: 'translateX(-50%)', zIndex: 2147483001 }}
  >
    <button type="button" className="guide-skip" onClick={onSkip}>{skipLabel}</button>
    <button type="button" className="guide-pill-action" onClick={onContinue}>{label}</button>
  </div>,
  document.body,
);
