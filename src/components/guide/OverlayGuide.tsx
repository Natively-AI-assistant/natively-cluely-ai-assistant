// First-run guide, overlay window: step 2 (What to answer), step 3 (screenshots),
// the hand-off to the notepad when it is closed, and the stop prompt. Drawn as
// an inline strip in a banner fold of the overlay (NativelyInterface.tsx), so
// the overlay grows to hold it and the banner picker can hold it back for a
// fault. It never takes focus: the user's call stays in front.
import React, { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { GuideStrip } from './GuideStrip';
import { guideOn, useGuide, useGuideKeys } from './useGuide';

export function useOverlayGuide(): { wants: boolean; node: React.ReactNode } {
  const tr = useT();
  const { state, justDone, dispatch } = useGuide();
  const active = state?.status === 'active';
  const step = active ? state!.step : null;
  const keysFor = useGuideKeys(step === 'answer' || step === 'screenshot');

  // Whether the notes window is open: step 4 is drawn there when it is.
  const [notesOpen, setNotesOpen] = useState(false);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    window.electronAPI?.notesWindowIsOpen?.().then((open) => { if (alive) setNotesOpen(!!open); }).catch(() => {});
    const off = window.electronAPI?.onNotesWindowVisibility?.((open) => setNotesOpen(!!open));
    return () => { alive = false; off?.(); };
  }, [active]);

  // Has anyone said anything yet? Until then step 2 says how to get a question.
  const [heard, setHeard] = useState(false);
  useEffect(() => {
    if (step !== 'answer' || heard) return;
    const off = window.electronAPI?.onNativeAudioTranscript?.((tx) => {
      if (tx?.final && tx.text?.trim()) setHeard(true);
    });
    return () => { off?.(); };
  }, [step, heard]);

  // Step 2 moves on when an answer arrives, from the keys or the button.
  useEffect(() => {
    if (step !== 'answer' || justDone) return;
    const done = () => dispatch({ type: 'answer_shown' });
    const offs = [
      window.electronAPI?.onIntelligenceSuggestedAnswer?.(done),
      window.electronAPI?.onIntelligenceManualResult?.(done),
    ];
    return () => { offs.forEach((off) => off?.()); };
  }, [step, justDone, dispatch]);

  // Step 3 moves on with either screenshot.
  useEffect(() => {
    if (step !== 'screenshot' || justDone) return;
    const done = () => dispatch({ type: 'screenshot_taken' });
    const offs = [
      window.electronAPI?.onScreenshotTaken?.(done),
      window.electronAPI?.onScreenshotAttached?.(done),
    ];
    return () => { offs.forEach((off) => off?.()); };
  }, [step, justDone, dispatch]);

  const skip = () => dispatch({ type: 'skip' });

  if (guideOn(state, 'answer')) {
    return {
      wants: true,
      node: (
        <GuideStrip
          stepId="answer"
          eyebrow={tr('What to answer')}
          title={tr('They just asked you something.')}
          body={tr('Press the keys. Natively writes your reply from the conversation.')}
          note={heard ? undefined : tr('Not on a call? Play any interview video, or ask a question out loud.')}
          keys={[keysFor('chat:whatToAnswer')]}
          waiting={tr('Waiting for you')}
          lit='[data-guide="what-to-answer"]'
          done={justDone}
          onSkip={skip}
        />
      ),
    };
  }

  if (guideOn(state, 'screenshot')) {
    return {
      wants: true,
      node: (
        <GuideStrip
          stepId="screenshot"
          eyebrow={tr('Screenshots')}
          title={tr('Show Natively your screen.')}
          body={tr('A coding question, a slide, a doc.')}
          keys={[keysFor('general:take-screenshot'), keysFor('general:selective-screenshot')]}
          keyLabels={[tr('Whole screen'), tr('Drag an area')]}
          waiting={tr('Try either one')}
          done={justDone}
          onSkip={skip}
        />
      ),
    };
  }

  if (guideOn(state, 'notepad') && !notesOpen) {
    return {
      wants: true,
      node: (
        <GuideStrip
          stepId="notepad"
          eyebrow={tr('Notepad')}
          title={tr('Write while you talk.')}
          body={tr('Open the notepad and jot a line. It goes into your meeting notes.')}
          action={{ label: tr('Open notepad'), onClick: () => { void window.electronAPI?.notesWindowToggle?.(); } }}
          done={justDone}
          onSkip={skip}
        />
      ),
    };
  }

  if (guideOn(state, 'stop')) {
    return {
      wants: true,
      node: (
        <GuideStrip
          stepId="stop"
          eyebrow={tr('Notepad')}
          title={tr('Stop the meeting when you’re ready.')}
          body={tr('Natively writes up your notes as soon as it stops.')}
          onSkip={skip}
        />
      ),
    };
  }

  return { wants: false, node: null };
}
