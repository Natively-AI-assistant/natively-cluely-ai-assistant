// First-run guide, overlay window: step 2 (the meeting overlay itself), step 3
// (What to answer), step 4 (screenshots), opening the notepad for step 5 (and an
// "Open notepad" banner if it gets closed), and the stop prompt. Each is the
// overlay's own banner (ui/OverlayBanner.tsx) in a periwinkle guide tone, in a
// banner fold of NativelyInterface.tsx: the overlay grows to hold it and the
// banner picker can hold it back for a fault. It never takes focus: the user's
// call stays in front.
import React, { useEffect, useRef, useState } from 'react';
import { AppWindow, Camera, Check, CircleStop, NotebookPen, Pencil } from 'lucide-react';
import { useT } from '../../i18n';
import { GUIDE_STEP_COUNT, GUIDE_STEP_NUMBER } from '../../lib/onboarding/firstRunGuide.mjs';
import type { GuideStepId } from '../../lib/onboarding/firstRunGuide.mjs';
import { OverlayBanner, OverlayBannerButton } from '../ui/OverlayBanner';
import { guideOn, useGuide, useGuideKeys, useGuideLit } from './useGuide';
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

  // Whether the notes window is open: step 5 is drawn there when it is.
  const [notesOpen, setNotesOpen] = useState(false);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    window.electronAPI?.notesWindowIsOpen?.().then((open) => { if (alive) setNotesOpen(!!open); }).catch(() => {});
    const off = window.electronAPI?.onNotesWindowVisibility?.((open) => setNotesOpen(!!open));
    return () => { alive = false; off?.(); };
  }, [active]);

  // Step 5 opens the notepad by itself: it is its own step, in its own window.
  // Asked of main first, since a toggle would close one that is already open.
  // Once per visit to the step, so closing it is respected.
  const openedForStep = useRef(false);
  const onNotepad = guideOn(state, 'notepad') && !justDone;
  useEffect(() => {
    if (!onNotepad) { openedForStep.current = false; return; }
    if (openedForStep.current) return;
    openedForStep.current = true;
    window.electronAPI?.notesWindowIsOpen?.()
      .then((open) => { if (!open) void window.electronAPI?.notesWindowToggle?.(); })
      .catch(() => {});
  }, [onNotepad]);

  // Has anyone said anything yet? Until then step 3 says how to get a question.
  const [heard, setHeard] = useState(false);
  useEffect(() => {
    if (step !== 'answer' || heard) return;
    const off = window.electronAPI?.onNativeAudioTranscript?.((tx) => {
      if (tx?.final && tx.text?.trim()) setHeard(true);
    });
    return () => { off?.(); };
  }, [step, heard]);

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
        tr('Answers, screenshots and chat show up here, over your call.'),
        <OverlayBannerButton variant="primary" onClick={() => dispatch({ type: 'overlay_next' })}>
          {tr('Next')}
        </OverlayBannerButton>,
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
          : tr('Not on a call? Play any interview video, or ask a question out loud.'),
        <Keys keys={keysFor('chat:whatToAnswer')} />,
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

  if (guideOn(state, 'notepad') && !notesOpen) {
    return {
      wants: true,
      node: banner(
        'notepad',
        <NotebookPen strokeWidth={2.2} />,
        tr('Write while you talk.'),
        tr('Jot a line. It goes into your meeting notes.'),
        <OverlayBannerButton variant="primary" onClick={() => { void window.electronAPI?.notesWindowToggle?.(); }}>
          {tr('Open notepad')}
        </OverlayBannerButton>,
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
        tr('Natively writes up your notes as soon as it stops.'),
      ),
    };
  }

  return { wants: false, node: null };
}
