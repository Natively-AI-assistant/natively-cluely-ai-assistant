// First-run guide, notes window: meeting 2, the notepad's (Evin, 2026-11-15:
// "shown how recipes and meeting notepad work"). Step 9 types a line, step 10
// opens Ask, step 11 runs a recipe, step 12 stops so the notes follow. Drawn as
// the notes window's own raised pill in its bottom bar (np-elevated, the look of
// the "Natively stops in 1 minute" notice), lighting the control each step is
// about. The window is no-activate on Windows (PR #709) and sits beside the
// user's call: nothing here takes focus.
import React, { useCallback, useRef } from 'react';
import { Check, X } from 'lucide-react';
import { useT } from '../../i18n';
import { GUIDE_STEP_COUNT, GUIDE_STEP_NUMBER } from '../../lib/onboarding/firstRunGuide.mjs';
import { guideOn, useGuide, useGuideLit } from './useGuide';
import './guide.css';

const ink = (v: string): React.CSSProperties => ({ color: `var(${v})` });

type NotesStep = 'notepad' | 'ask' | 'recipe' | 'stop2';

/** The control each step lights. */
const LIT: Record<NotesStep, string | null> = {
  notepad: null,
  ask: '[data-guide="notes-ask"]',
  recipe: '[data-guide="notes-recipes"]',
  stop2: '[data-guide="notes-stop"]',
};

export interface NotesGuide {
  node: React.ReactNode;
  /** The notes text changed (step 9 moves on at the first real line). */
  onTyped: (next: string) => void;
  /** Ask opened (step 10). */
  onAskOpened: () => void;
  /** A recipe ran, from a chip, All recipes or "/" (step 11). */
  onRecipeRun: () => void;
}

export function useNotesGuide(): NotesGuide {
  const tr = useT();
  const { state, justDone, dispatch } = useGuide();
  const step: NotesStep | null = (['notepad', 'ask', 'recipe', 'stop2'] as const).find((s) => guideOn(state, s)) ?? null;
  const live = step && !justDone ? step : null;
  const liveRef = useRef(live);
  liveRef.current = live;
  useGuideLit(live ? LIT[live] : null);

  // Each moves the guide once (the reducer ignores repeats; this keeps
  // keystrokes and re-renders off IPC).
  const onTyped = useCallback((next: string) => {
    if (liveRef.current !== 'notepad' || !next.trim()) return;
    liveRef.current = null;
    dispatch({ type: 'note_typed' });
  }, [dispatch]);
  const onAskOpened = useCallback(() => {
    if (liveRef.current !== 'ask') return;
    liveRef.current = null;
    dispatch({ type: 'ask_opened' });
  }, [dispatch]);
  const onRecipeRun = useCallback(() => {
    if (liveRef.current !== 'recipe') return;
    liveRef.current = null;
    dispatch({ type: 'recipe_run' });
  }, [dispatch]);

  const pill = (stepId: NotesStep, title: string, body: string) => {
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
  if (step === 'notepad') {
    node = pill('notepad', tr('Write while you talk.'), tr('Jot a line. It goes into your meeting notes.'));
  } else if (step === 'ask') {
    node = pill('ask', tr('Ask about the meeting.'), tr('Click Ask anything. It knows everything said so far.'));
  } else if (step === 'recipe') {
    node = pill('recipe', tr('Try a recipe.'), tr('Recipes are ready-made asks. Pick one, or type / to see them all.'));
  } else if (step === 'stop2') {
    node = pill('stop2', tr('Stop the meeting when you’re ready.'), tr('Natively writes up your notes as soon as it stops.'));
  }
  return { node, onTyped, onAskOpened, onRecipeRun };
}
