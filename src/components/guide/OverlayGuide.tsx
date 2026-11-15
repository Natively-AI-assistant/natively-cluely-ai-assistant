// First-run guide, overlay window: meeting 1 (Evin, 2026-11-15: the first
// meeting is the overlay's, the second the notepad's). Step 2 (the meeting
// overlay itself), step 3 (What to answer), step 4 (screenshots) and step 5
// (stop, so its notes follow). Each is the
// overlay's own banner (ui/OverlayBanner.tsx) in a periwinkle guide tone, in a
// banner fold of NativelyInterface.tsx: the overlay grows to hold it and the
// banner picker can hold it back for a fault. It never takes focus: the user's
// call stays in front.
import React, { useEffect, useState } from 'react';
import { AppWindow, Camera, Check, CircleStop, Pencil } from 'lucide-react';
import { useT } from '../../i18n';
import { GUIDE_STEP_COUNT, GUIDE_STEP_NUMBER, GUIDE_STOP_LOCK_MS } from '../../lib/onboarding/firstRunGuide.mjs';
import type { GuideStepId } from '../../lib/onboarding/firstRunGuide.mjs';
import { OverlayBanner, OverlayBannerButton } from '../ui/OverlayBanner';
import { guideOn, useGuide, useGuideKeys, useGuideLit } from './useGuide';
import { DEMO_FILM_QUIET_MS, DEMO_VIDEO_URL } from '../../lib/demoVideoUrl';
import './guide.css';

const Keys: React.FC<{ keys: string[] }> = ({ keys }) => (
  <span className="ov-banner-keys">{keys.map((k, i) => <kbd key={i}>{k}</kbd>)}</span>
);

export function useOverlayGuide(): { wants: boolean; node: React.ReactNode } {
  const tr = useT();
  const { state, justDone, dispatch } = useGuide();
  const active = state?.status === 'active';
  const step = active ? state!.step : null;
  const keysFor = useGuideKeys(step === 'answer' || step === 'screenshot');
  useGuideLit(step === 'answer' && !justDone ? '[data-guide="what-to-answer"]' : null);

  // Has anyone said anything yet? Until then step 3 says how to get a question.
  // Listened for from step 2, as the demo film starts with the meeting; any
  // words count, interim too: they prove the film (or a voice) is coming through.
  const listening = step === 'overlay' || step === 'answer';
  const [heard, setHeard] = useState(false);
  useEffect(() => {
    if (!listening || heard) return;
    const off = window.electronAPI?.onNativeAudioTranscript?.((tx) => {
      if (tx?.text?.trim()) setHeard(true);
    });
    return () => { off?.(); };
  }, [listening, heard]);

  // The first meeting opened the demo film (main, at step 1 -> 2; its Stop
  // lock is stamped at the same moment). Still nothing heard 8 s in: the
  // browser most likely blocked autoplay, so the banner asks for a press on
  // play, with a button that brings the film forward.
  const filmFrom = typeof state?.stopLockUntil === 'number' ? state.stopLockUntil - GUIDE_STOP_LOCK_MS : null;
  const [quiet, setQuiet] = useState(false);
  useEffect(() => {
    setQuiet(false);
    if (!listening || heard || filmFrom === null) return;
    const t = setTimeout(() => setQuiet(true), Math.max(0, filmFrom + DEMO_FILM_QUIET_MS - Date.now()));
    return () => clearTimeout(t);
  }, [listening, heard, filmFrom]);
  const pressPlay = quiet && !heard;
  const openFilm = (
    <OverlayBannerButton variant="secondary" onClick={() => { void window.electronAPI?.openExternal?.(DEMO_VIDEO_URL); }}>
      {tr('Open the demo')}
    </OverlayBannerButton>
  );

  // Step 3 moves on when an answer arrives, from the keys or the button.
  useEffect(() => {
    if (step !== 'answer' || justDone) return;
    const done = () => dispatch({ type: 'answer_shown' });
    const offs = [
      window.electronAPI?.onIntelligenceSuggestedAnswer?.(done),
      window.electronAPI?.onIntelligenceManualResult?.(done),
    ];
    return () => { offs.forEach((off) => off?.()); };
  }, [step, justDone, dispatch]);

  // Step 4 moves on with either screenshot.
  useEffect(() => {
    if (step !== 'screenshot' || justDone) return;
    const done = () => dispatch({ type: 'screenshot_taken' });
    const offs = [
      window.electronAPI?.onScreenshotTaken?.(done),
      window.electronAPI?.onScreenshotAttached?.(done),
    ];
    return () => { offs.forEach((off) => off?.()); };
  }, [step, justDone, dispatch]);

  const banner = (
    stepId: GuideStepId,
    icon: React.ReactNode,
    title: string,
    message: React.ReactNode,
    extra?: React.ReactNode,
  ) => {
    const done = !!justDone;
    const count = tr('{n} of {total}')
      .replace('{n}', String(GUIDE_STEP_NUMBER[stepId]))
      .replace('{total}', String(GUIDE_STEP_COUNT));
    return (
      <OverlayBanner
        className="mx-4"
        data-guide-strip={stepId}
        tone={done ? 'ok' : 'guide'}
        icon={done ? <Check strokeWidth={2.4} /> : icon}
        title={title}
        message={message}
        actions={
          <>
            {!done && extra}
            <span className="guide-count" aria-label={count}>{count}</span>
          </>
        }
        onDismiss={done ? undefined : () => dispatch({ type: 'skip' })}
        dismissLabel={tr('Skip guide')}
      />
    );
  };

  if (guideOn(state, 'overlay')) {
    return {
      wants: true,
      node: banner(
        'overlay',
        <AppWindow strokeWidth={2.2} />,
        tr('This is your meeting overlay.'),
        pressPlay
          ? tr('No sound yet? Press play on the Natively demo in your browser.')
          : tr('Answers, screenshots and chat show up here, over your call.'),
        <>
          {pressPlay && openFilm}
          <OverlayBannerButton variant="primary" onClick={() => dispatch({ type: 'overlay_next' })}>
            {tr('Next')}
          </OverlayBannerButton>
        </>,
      ),
    };
  }

  if (guideOn(state, 'answer')) {
    return {
      wants: true,
      node: banner(
        'answer',
        <Pencil strokeWidth={2.2} />,
        tr('They just asked you something.'),
        heard
          ? tr('Press the keys. Natively writes your reply from the conversation.')
          : pressPlay
            ? tr('No sound yet? Press play on the Natively demo in your browser.')
            : tr('Not on a call? Play any interview video, or ask a question out loud.'),
        <>
          {pressPlay && openFilm}
          <Keys keys={keysFor('chat:whatToAnswer')} />
        </>,
      ),
    };
  }

  if (guideOn(state, 'screenshot')) {
    return {
      wants: true,
      node: banner(
        'screenshot',
        <Camera strokeWidth={2.2} />,
        tr('Show Natively your screen.'),
        <span className="guide-key-row">
          <span><Keys keys={keysFor('general:take-screenshot')} /> {tr('Whole screen')}</span>
          <span><Keys keys={keysFor('general:selective-screenshot')} /> {tr('Drag an area')}</span>
        </span>,
      ),
    };
  }

  if (guideOn(state, 'stop')) {
    return {
      wants: true,
      node: banner(
        'stop',
        <CircleStop strokeWidth={2.2} />,
        tr('Stop the meeting when you’re ready.'),
        tr('Press the stop button ■ in the bar at the top. Natively writes up your notes.'),
      ),
    };
  }

  return { wants: false, node: null };
}
