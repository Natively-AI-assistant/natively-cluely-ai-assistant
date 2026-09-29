// src/components/onboarding/ShortcutTour.tsx
//
// First-launch shortcut tour, between WelcomeLeft and the launcher. One
// shortcut per step (show/hide, what to answer, screenshot), each tried for
// real: the key press — or a click on the keycaps — plays out on the overlay in
// MeetingDemo on the right.
//
// The tour is split in two so the right-hand plate can outlive the step change:
// `useShortcutTour` owns the state and the shortcut plumbing, `TourLeft` draws
// the left column, and WelcomeFlow renders ONE MeetingDemo for the whole flow
// (the video no longer restarts when Get started is pressed).
//
// The keys are the user's actual bindings (keybinds:get-all), drawn for this
// platform: ⌘ on macOS, Ctrl on Windows (src/lib/onboarding/shortcutKeys.mjs).
//
// Two of them are global shortcuts that main would act on — Toggle Visibility
// hides the very window this tour is drawn in, and Take Screenshot captures for
// real. So while the tour is up main routes them here instead
// (onboarding:set-shortcut-tour → AppState.setShortcutTour); main drops that
// routing on its own if this renderer reloads or dies. A shortcut main does not
// register in launcher mode (What to Answer) reaches this window as a plain
// keydown, which is matched against the same binding.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import nativelyMark from '../../assets/logo.webp';
import { useT } from '../../i18n';
import { isMac, isWindows } from '../../utils/platformUtils';
import { acceleratorToKeys, matchesAccelerator } from '../../lib/onboarding/shortcutKeys.mjs';
import { useWelcomeTheme, useRise, LavenderButton, Keycaps, useSlideVariants, useTextSwap } from './welcomeShared';
import { fmt } from './i18nText';

type Action = 'toggle' | 'answer' | 'shot';

const PLATFORM = isMac ? 'darwin' : isWindows ? 'win32' : 'linux';

const LESSONS: { action: Action; id: string; fallback: string; title: string; text: string }[] = [
  { action: 'toggle', id: 'general:toggle-visibility', fallback: 'CommandOrControl+B', title: 'Show or hide Natively', text: 'Tap it again to bring the overlay back. Works from any app.' },
  { action: 'answer', id: 'chat:whatToAnswer', fallback: 'CommandOrControl+1', title: 'Get the answer', text: 'Natively answers the question you were just asked.' },
  { action: 'shot', id: 'general:take-screenshot', fallback: 'CommandOrControl+H', title: 'Show it your screen', text: 'Takes a screenshot so Natively can read what you see.' },
];
const ACTION_BY_ID: Record<string, Action> = Object.fromEntries(LESSONS.map(l => [l.id, l.action]));

/** Everything the tour knows; WelcomeFlow feeds the plate from it. */
export function useShortcutTour(active: boolean) {
  const [bindings, setBindings] = useState<Record<string, string>>(
    () => Object.fromEntries(LESSONS.map(l => [l.id, l.fallback])),
  );
  const [lesson, setLessonState] = useState(0);
  // +1 when the step moved forward, -1 back: what the swap slides along.
  const [dir, setDir] = useState(1);
  const lessonRef = useRef(0);
  const [hidden, setHidden] = useState(false);
  const [answerKey, setAnswerKey] = useState(0);
  const [shotKey, setShotKey] = useState(0);
  const [badge, setBadge] = useState<string[] | null>(null);
  // The keycaps go down while a real key (or a routed global shortcut) is held.
  const [pressed, setPressed] = useState(false);
  const [done, setDone] = useState<Record<Action, boolean>>({ toggle: false, answer: false, shot: false });

  const goTo = useCallback((i: number) => {
    setDir(i >= lessonRef.current ? 1 : -1);
    lessonRef.current = i;
    setLessonState(i);
  }, []);

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const later = (name: string, ms: number, fn: () => void) => {
    clearTimeout(timers.current[name]);
    timers.current[name] = setTimeout(fn, ms);
  };
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  // The user's real bindings; the defaults stand in until (or unless) they load.
  useEffect(() => {
    if (!active) return;
    window.electronAPI?.getKeybinds?.()
      .then(list => {
        const next: Record<string, string> = {};
        for (const kb of list ?? []) if (ACTION_BY_ID[kb.id] && kb.accelerator) next[kb.id] = kb.accelerator;
        if (Object.keys(next).length) setBindings(prev => ({ ...prev, ...next }));
      })
      .catch(() => {});
  }, [active]);

  const keysFor = useCallback((id: string) => acceleratorToKeys(bindings[id], PLATFORM), [bindings]);

  // One press, from any source. A short de-dupe guards the rare path where a
  // chord could arrive both as a routed global shortcut and as a keydown.
  const lastPress = useRef<{ action: Action; at: number } | null>(null);
  const press = useCallback((action: Action) => {
    const now = Date.now();
    if (lastPress.current && lastPress.current.action === action && now - lastPress.current.at < 150) return;
    lastPress.current = { action, at: now };

    const i = LESSONS.findIndex(l => l.action === action);
    goTo(i);
    setDone(d => ({ ...d, [action]: true }));
    setBadge(acceleratorToKeys(bindings[LESSONS[i].id], PLATFORM));
    later('badge', 1400, () => setBadge(null));
    setPressed(true);
    later('pressed', 140, () => setPressed(false));

    if (action === 'toggle') {
      setHidden(h => !h);
    } else if (action === 'answer') {
      // As in the overlay: What to Answer brings a hidden overlay back.
      setHidden(false);
      setAnswerKey(k => k + 1);
    } else {
      // As in the overlay: an attached screenshot expands it too.
      setHidden(false);
      setShotKey(k => k + 1);
    }
  }, [bindings, goTo]);

  // Global shortcuts, routed here by main for as long as the tour is up.
  useEffect(() => {
    if (!active) return;
    window.electronAPI?.onboardingSetShortcutTour?.(true).catch(() => {});
    const off = window.electronAPI?.onOnboardingTourShortcut?.((actionId) => {
      const action = ACTION_BY_ID[actionId];
      if (action) press(action);
    });
    return () => {
      off?.();
      window.electronAPI?.onboardingSetShortcutTour?.(false).catch(() => {});
    };
  }, [active, press]);

  // Anything main does not register right now arrives as an ordinary keydown.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      for (const l of LESSONS) {
        if (matchesAccelerator(e, bindings[l.id], PLATFORM)) {
          e.preventDefault();
          // Holding the chord is one press, not a stream of them.
          if (!e.repeat) press(l.action);
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, bindings, press]);

  return {
    lesson, dir, goTo, hidden, answerKey, shotKey, badge, pressed, done, press, keysFor,
    toggleKeys: keysFor('general:toggle-visibility'),
    placeholderKeys: acceleratorToKeys('CommandOrControl+Shift+H', PLATFORM),
  };
}

export type ShortcutTourState = ReturnType<typeof useShortcutTour>;

/** transitions.dev #10 success check, drawn for a 15px icon (onboardingMotion.css). */
const SuccessCheck: React.FC = () => (
  <span className="onb-check" aria-hidden>
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12.5l5.5 5.5L20 7" />
    </svg>
  </span>
);

interface LeftProps {
  tour: ShortcutTourState;
  onDone: () => void;
}

export const TourLeft: React.FC<LeftProps> = ({ tour, onDone }) => {
  const t = useWelcomeTheme();
  const rise = useRise();
  const slide = useSlideVariants();
  const swap = useTextSwap();
  const tr = useT();
  const { lesson, dir, goTo, pressed, done, press, keysFor } = tour;

  const cur = LESSONS[lesson];
  const curKeys = keysFor(cur.id);
  const isLast = lesson === LESSONS.length - 1;

  return (
    <div role="main" aria-labelledby="tour-title" className="flex-1 min-w-0 h-full flex flex-col" style={{ padding: '64px 64px 44px 72px' }}>
      <motion.div {...rise(0.05)} className="flex items-center gap-[10px]">
        <img src={nativelyMark} alt="" draggable={false} style={{ width: 26, height: 26, filter: t.markFilter }} />
        <span style={{ fontSize: 13, fontWeight: 500, color: t.quiet }}>{tr('Get started')}</span>
      </motion.div>

      <motion.div {...rise(0.12)} className="my-auto flex flex-col" style={{ gap: 26 }}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={lesson} {...swap} style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: t.faint }}>
            {fmt(tr('Step {n} of {total}'), { n: lesson + 1, total: LESSONS.length })}
          </motion.div>
        </AnimatePresence>

        {/* The keycaps, title and line swap together, sliding the way the tour
            is going: Next travels forward, Back travels back. */}
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.div
            key={lesson}
            custom={dir}
            variants={slide}
            initial="enter"
            animate="center"
            exit="exit"
            className="flex flex-col"
            style={{ gap: 26 }}
          >
            <button
              type="button"
              onClick={() => press(cur.action)}
              aria-label={fmt(tr('Try {keys}'), { keys: curKeys.join(' + ') })}
              className="onb-keys-btn self-start bg-transparent border-0 p-0"
            >
              <Keycaps t={t} keys={curKeys} size="lg" pressed={pressed} />
            </button>
            <div className="flex flex-col" style={{ gap: 12 }}>
              <h1 id="tour-title" style={{ margin: 0, fontSize: 44, fontWeight: 300, letterSpacing: '-0.035em', lineHeight: 1.05, color: t.strong }}>
                {tr(cur.title)}
              </h1>
              <p style={{ margin: 0, maxWidth: 400, fontSize: 15, lineHeight: 1.6, color: t.body }}>{tr(cur.text)}</p>
            </div>
          </motion.div>
        </AnimatePresence>

        <div aria-live="polite" style={{ minHeight: 20, fontSize: 13, fontWeight: 500, color: t.quiet }}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={`${cur.action}-${done[cur.action]}`} {...swap}>
              {done[cur.action] ? (
                <span className="inline-flex items-center gap-2" style={{ color: '#34D399' }}>
                  <SuccessCheck /> {tr('That’s it. Watch the overlay on the right.')}
                </span>
              ) : (
                <>{fmt(tr('Try it now: press {keys} on your keyboard, or click the keys.'), { keys: curKeys.join(' + ') })}</>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>

      <div className="flex items-center" style={{ gap: 18 }}>
        {lesson === 0 ? (
          <button type="button" onClick={onDone} className="onb-textbtn bg-transparent border-0"
            style={{ ['--onb-quiet' as string]: t.quiet, ['--onb-strong' as string]: t.strong, fontSize: 12.5, fontWeight: 500, padding: '10px 4px' } as React.CSSProperties}>
            {tr('Skip')}
          </button>
        ) : (
          <button type="button" onClick={() => goTo(lesson - 1)} className="onb-textbtn bg-transparent border-0"
            style={{ ['--onb-quiet' as string]: t.quiet, ['--onb-strong' as string]: t.strong, fontSize: 12.5, fontWeight: 500, padding: '10px 4px' } as React.CSSProperties}>
            {tr('Back')}
          </button>
        )}
        {/* One button for both: it fits its label and tweens between them. */}
        <LavenderButton t={t} height={40} labelSize={14}
          labelKey={isLast ? 'start' : 'next'} onClick={isLast ? onDone : () => goTo(lesson + 1)}>
          {isLast ? tr('Start using Natively') : tr('Next')} <ArrowRight size={15} strokeWidth={2} aria-hidden />
        </LavenderButton>
        <div className="ml-auto flex items-center" style={{ gap: 6 }} aria-hidden>
          {LESSONS.map((l, i) => (
            <span key={l.action} style={{
              height: 7, width: i === lesson ? 20 : 7, borderRadius: i === lesson ? 4 : 999,
              // the toggle's ON blue, like the buttons (was the PR's lavender #9C6FF3)
              background: i === lesson ? '#6688F5' : t.dot,
              // --duration-fast, --ease-smooth-out (transitions-polish: was a bare 250ms ease).
              transition: 'width 250ms cubic-bezier(0.22, 1, 0.36, 1), background-color 250ms cubic-bezier(0.22, 1, 0.36, 1)',
            }} />
          ))}
        </div>
      </div>
    </div>
  );
};
