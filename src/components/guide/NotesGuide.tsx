// First-run guide, notes window: step 4 and the stop prompt that follows it,
// as an inline strip above the editor. The window is no-activate on Windows
// (PR #709) and sits beside the user's call: nothing here takes focus.
import React, { useCallback, useRef } from 'react';
import { useT } from '../../i18n';
import { GuideStrip } from './GuideStrip';
import { guideOn, useGuide } from './useGuide';

export function useNotesGuide(): { node: React.ReactNode; onTyped: (next: string) => void } {
  const tr = useT();
  const { state, justDone, dispatch } = useGuide();
  const onNotepad = guideOn(state, 'notepad') && !justDone;
  const onNotepadRef = useRef(onNotepad);
  onNotepadRef.current = onNotepad;

  // The first real line typed moves the guide on; once is enough (the reducer
  // ignores repeats, this just keeps keystrokes off IPC).
  const onTyped = useCallback((next: string) => {
    if (!onNotepadRef.current || !next.trim()) return;
    onNotepadRef.current = false;
    dispatch({ type: 'note_typed' });
  }, [dispatch]);

  const skip = () => dispatch({ type: 'skip' });
  let node: React.ReactNode = null;
  if (guideOn(state, 'notepad')) {
    node = (
      <GuideStrip
        stepId="notepad"
        eyebrow={tr('Notepad')}
        title={tr('Write while you talk.')}
        body={tr('Jot a line. It goes into your meeting notes.')}
        waiting={tr('Type a line')}
        done={justDone}
        onSkip={skip}
      />
    );
  } else if (guideOn(state, 'stop')) {
    node = (
      <GuideStrip
        stepId="stop"
        eyebrow={tr('Notepad')}
        title={tr('Stop the meeting when you’re ready.')}
        body={tr('Natively writes up your notes as soon as it stops.')}
        onSkip={skip}
      />
    );
  }
  return { node: node && <div className="px-8 pt-3">{node}</div>, onTyped };
}
