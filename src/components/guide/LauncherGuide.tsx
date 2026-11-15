// First-run guide, launcher window: the two Starts (step 1, the overlay
// meeting; step 8, the notepad meeting), the two finished meetings (steps 6
// and 13), the meeting and trial events the guide moves on, and the hand-off
// to Settings (step 7, Settings › Overlay; the last step, Plans or keys). The
// overlay, notes window and Settings draw their own steps (src/components/guide/*).
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../i18n';
import { startCoverage, trialEventFromLocal } from '../../lib/onboarding/firstRunGuide.mjs';
import { GuideCard } from './GuideCard';
import { GuideGlass } from './GuideGlass';
import { LiquidGlassButton } from '../../ui-components/LiquidGlassButton';
import { guideOn, useAnchorRect, useGuide } from './useGuide';

/** The control each launcher-side step points at (Settings opens in this window). */
const STEP_ANCHOR: Partial<Record<string, string>> = {
  notes: '[data-guide="meeting-tabs"]',
  surface: '[data-guide="surface-switch"]',
  start2: '[data-guide="start"]',
  notes2: '[data-guide="meeting-tabs"]',
  plans: '[data-guide="nav-plans"]',
  keys: '[data-guide="nav-ai-providers"]',
};
/** The Settings tab each Settings-side step opens. */
const SETTINGS_TAB: Partial<Record<string, string>> = { surface: 'overlay', plans: 'plans', keys: 'ai-providers' };
/** How long a step's control may be off screen before the way back shows. */
const OFF_SCREEN_MS = 1200;
/** How long a notes step waits for main's saved meeting before offering to go on.
 *  Past endMeeting's own waits (STT finals up to ~5 s, then the save); a save
 *  that still lands later brings step 6 back (the reducer's late-save rule). */
const NO_NOTES_MS = 20_000;

interface Props {
  onOpenSettings: (tab: string) => void;
  onOpenMeeting: (id: string) => void;
  /** Settings closed and the Launcher back on Home (step 8's Start button). */
  onShowHome: () => void;
}

export const LauncherGuide: React.FC<Props> = ({ onOpenSettings, onOpenMeeting, onShowHome }) => {
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
  // Step 1's line says what covers the meeting: a running trial, else a paid key.
  const [coverage, setCoverage] = useState<'trial' | 'plan'>('trial');
  useEffect(() => {
    if (step !== 'start') return;
    let alive = true;
    const api = window.electronAPI;
    Promise.all([api?.getLocalTrial?.().catch(() => null), api?.getStoredCredentials?.().catch(() => null)])
      .then(([local, creds]) => {
        if (!alive) return;
        setCoverage(startCoverage({ trial: local ?? null, hasNativelyKey: !!creds?.hasNativelyKey }));
        const ev = trialEventFromLocal(local);
        if (ev) dispatch({ type: ev });
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

  // Steps 6 and 13: open the meeting main saved when a guide meeting ended
  // (meeting_saved), once per meeting.
  const onNotes = step === 'notes' || step === 'notes2';
  const endedMeetingId = state?.endedMeetingId ?? null;
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!onNotes || justDone || !endedMeetingId || openedFor.current === endedMeetingId) return;
    openedFor.current = endedMeetingId;
    onOpenMeeting(endedMeetingId);
  }, [onNotes, justDone, endedMeetingId, onOpenMeeting]);

  // Settings-side steps: open the right tab once per step.
  const openedSettings = useRef<string | null>(null);
  useEffect(() => {
    const tab = step ? SETTINGS_TAB[step] : undefined;
    if (!tab || justDone) return;
    const key = `${step}:${state?.updatedAt ?? 0}`;
    if (openedSettings.current === key) return;
    openedSettings.current = key;
    onOpenSettings(tab);
  }, [step, justDone, state?.updatedAt, onOpenSettings]);

  // Step 8: Settings closed, back on Home where Start Natively is, once.
  const homeFor = useRef<number | null>(null);
  useEffect(() => {
    if (step !== 'start2' || justDone || homeFor.current === (state?.updatedAt ?? 0)) return;
    homeFor.current = state?.updatedAt ?? 0;
    onShowHome();
  }, [step, justDone, state?.updatedAt, onShowHome]);

  const skip = () => dispatch({ type: 'skip' });

  // The way back: a step whose control is not on screen (Settings closed, or
  // the user left the meeting) shows one small button instead of nothing,
  // since the guide holds the card slot while it runs.
  const anchor = step && !justDone ? STEP_ANCHOR[step] ?? null : null;
  const anchorRect = useAnchorRect(anchor);
  const [offScreen, setOffScreen] = useState(false);
  useEffect(() => {
    setOffScreen(false);
    if (!anchor || anchorRect) return;
    // A notes step with no saved meeting (the save failed, or the app quit
    // between Stop and the save) has nothing to open: after a wait for the
    // save, the way back moves the guide on instead of leaving nothing on screen.
    const timer = setTimeout(() => setOffScreen(true), onNotes && !endedMeetingId ? NO_NOTES_MS : OFF_SCREEN_MS);
    return () => clearTimeout(timer);
  }, [anchor, anchorRect, onNotes, endedMeetingId]);
  const resume = () => {
    const tab = step ? SETTINGS_TAB[step] : undefined;
    if (onNotes && !endedMeetingId) dispatch({ type: 'notes_next' });
    else if (onNotes) onOpenMeeting(endedMeetingId!);
    else if (step === 'start2') onShowHome();
    else if (tab) onOpenSettings(tab);
  };

  // First: a card whose control is gone draws nothing, so the way back must
  // win over it (seen live 2026-11-15: step 13 at Home showed neither).
  if (offScreen && anchor) return <ContinueGuide label={tr('Continue the guide')} skipLabel={tr('Skip guide')} onContinue={resume} onSkip={skip} />;

  if (guideOn(state, 'start')) {
    return (
      <GuideCard
        anchor='[data-guide="start"]'
        width={330}
        stepId="start"
        title={tr('Start your first meeting.')}
        body={coverage === 'plan'
          ? tr('Your plan covers it. Start now: the Natively demo plays in your browser so you can watch it work.')
          : tr('Your free trial covers it. Start now: the Natively demo plays in your browser so you can watch it work.')}
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

  if (guideOn(state, 'start2')) {
    return (
      <GuideCard
        anchor='[data-guide="start"]'
        width={330}
        stepId="start2"
        title={tr('Start Natively again.')}
        body={tr('This time your meeting opens in the notepad.')}
        waiting={tr('Waiting for you')}
        done={justDone}
        onSkip={skip}
      />
    );
  }

  if (guideOn(state, 'notes2')) {
    return (
      <GuideCard
        anchor='[data-guide="meeting-tabs"]'
        width={340}
        stepId="notes2"
        title={tr('Your notepad meeting, written up.')}
        body={tr('Your notes, the summary and Ask’s answers are saved together. Find them any time on Home.')}
        action={{ label: tr('Next'), onClick: () => dispatch({ type: 'notes_next' }) }}
        done={justDone}
        onSkip={skip}
      />
    );
  }

  return null;
};

/** The guide's step is off screen: one floating pill in the tip's liquid glass. */
const ContinueGuide: React.FC<{ label: string; skipLabel: string; onContinue: () => void; onSkip: () => void }> = ({
  label, skipLabel, onContinue, onSkip,
}) => {
  return createPortal(
    // Centred by the row, not a translateX: the pill's own transform is its motion (guide.css).
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 20, display: 'flex', justifyContent: 'center', pointerEvents: 'none', zIndex: 2147483001 }}>
      <div className="guide-enter guide-pill" data-guide-card="continue" style={{ pointerEvents: 'auto', transformOrigin: '50% 100%' }}>
        <div className="guide-pill-shell">
          <GuideGlass radius={22} />
          <div className="guide-pill-row">
            <button type="button" className="guide-skip" onClick={onSkip}>{skipLabel}</button>
            <LiquidGlassButton variant="lavender" className="lg-sm" onClick={onContinue}>{label}</LiquidGlassButton>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
