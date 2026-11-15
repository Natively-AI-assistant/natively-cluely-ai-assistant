// First-run guide, notes window: step 4 and the stop prompt that follows it.
// Drawn as the notes window's own raised pill in its bottom bar (np-elevated,
// the look of the "Natively stops in 1 minute" notice), just above the Stop
// button, which the stop prompt lights. The window is no-activate on Windows
// (PR #709) and sits beside the user's call: nothing here takes focus.
import React, { useCallback, useRef } from 'react';
import { Check, X } from 'lucide-react';
import { useT } from '../../i18n';
import { GUIDE_STEP_COUNT, GUIDE_STEP_NUMBER } from '../../lib/onboarding/firstRunGuide.mjs';
import { guideOn, useGuide, useGuideLit } from './useGuide';
import './guide.css';

const ink = (v: string): React.CSSProperties => ({ color: `var(${v})` });

export function useNotesGuide(): { node: React.ReactNode; onTyped: (next: string) => void } {
  const tr = useT();
  const { state, justDone, dispatch } = useGuide();
  const onNotepad = guideOn(state, 'notepad') && !justDone;
  const onNotepadRef = useRef(onNotepad);
  onNotepadRef.current = onNotepad;
  const onStop = guideOn(state, 'stop') && !justDone;
  useGuideLit(onStop ? '[data-guide="notes-stop"]' : null);

  // The first real line typed moves the guide on; once is enough (the reducer
  // ignores repeats, this just keeps keystrokes off IPC).
  const onTyped = useCallback((next: string) => {
    if (!onNotepadRef.current || !next.trim()) return;
    onNotepadRef.current = false;
    dispatch({ type: 'note_typed' });
  }, [dispatch]);

  const pill = (stepId: 'notepad' | 'stop', title: string, body: string) => {
    const count = tr('{n} of {total}')
      .replace('{n}', String(GUIDE_STEP_NUMBER[stepId]))
      .replace('{total}', String(GUIDE_STEP_COUNT));
    return (
      <div
        className="guide-enter np-elevated rounded-[20px] pl-4 pr-1.5 py-1.5 flex items-center gap-3"
        role="status"
        data-guide-strip={stepId}
      >
        <div className="min-w-0 flex-1 py-0.5">
          <p className="text-[13px] leading-[18px] font-medium flex items-center gap-1.5" style={ink('--np-ink')}>
            {justDone && <Check className="w-3.5 h-3.5 shrink-0" strokeWidth={2.4} style={ink('--np-accent')} aria-label={tr('Done')} />}
            <span className="min-w-0">{title}</span>
          </p>
          <p className="text-[12px] leading-4" style={ink('--np-ink-secondary')}>{body}</p>
        </div>
        <span className="shrink-0 text-[12px] tabular-nums" style={ink('--np-ink-tertiary')}>{count}</span>
        {!justDone && (
          <button
            type="button"
            aria-label={tr('Skip guide')}
            title={tr('Skip guide')}
            onClick={() => dispatch({ type: 'skip' })}
            className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center np-wash"
            style={ink('--np-ink-secondary')}
          >
            <X className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
        )}
      </div>
    );
  };

  let node: React.ReactNode = null;
  if (guideOn(state, 'notepad')) {
    node = pill('notepad', tr('Write while you talk.'), tr('Jot a line. It goes into your meeting notes.'));
  } else if (guideOn(state, 'stop')) {
    node = pill('stop', tr('Stop the meeting when you’re ready.'), tr('Natively writes up your notes as soon as it stops.'));
  }
  return { node, onTyped };
}
