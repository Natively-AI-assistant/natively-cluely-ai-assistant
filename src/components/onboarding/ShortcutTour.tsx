// src/components/onboarding/ShortcutTour.tsx
//
// First-launch shortcut tour, between WelcomeScreen and the launcher. One
// shortcut per step (show/hide, what to answer, screenshot), each tried for
// real: the key press — or a click on the keycaps — plays out on the overlay in
// MeetingDemo on the right.
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
import { ArrowRight, Check } from 'lucide-react';
import nativelyMark from '../../assets/logo.webp';
import { isMac, isWindows } from '../../utils/platformUtils';
import { acceleratorToKeys, matchesAccelerator } from '../../lib/onboarding/shortcutKeys.mjs';
import { useWelcomeTheme, useRise, WelcomeFrame, LavenderButton, MeetingDemo, Keycaps } from './welcomeShared';

type Action = 'toggle' | 'answer' | 'shot';

const PLATFORM = isMac ? 'darwin' : isWindows ? 'win32' : 'linux';

const LESSONS: { action: Action; id: string; fallback: string; title: string; text: string }[] = [
  { action: 'toggle', id: 'general:toggle-visibility', fallback: 'CommandOrControl+B', title: 'Show or hide Natively', text: 'Tap it again to bring the overlay back. Works from any app.' },
  { action: 'answer', id: 'chat:whatToAnswer', fallback: 'CommandOrControl+1', title: 'Get the answer', text: 'Natively answers the question you were just asked.' },
  { action: 'shot', id: 'general:take-screenshot', fallback: 'CommandOrControl+H', title: 'Show it your screen', text: 'Takes a screenshot so Natively can read what you see.' },
];
const ACTION_BY_ID: Record<string, Action> = Object.fromEntries(LESSONS.map(l => [l.id, l.action]));

interface Props {
  onDone: () => void;
}

export const ShortcutTour: React.FC<Props> = ({ onDone }) => {
  const t = useWelcomeTheme();
  const rise = useRise();

  const [bindings, setBindings] = useState<Record<string, string>>(
    () => Object.fromEntries(LESSONS.map(l => [l.id, l.fallback])),
  );
  const [lesson, setLesson] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [answerKey, setAnswerKey] = useState(0);
  const [shotKey, setShotKey] = useState(0);
  const [badge, setBadge] = useState<string[] | null>(null);
  const [done, setDone] = useState<Record<Action, boolean>>({ toggle: false, answer: false, shot: false });

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const later = (name: string, ms: number, fn: () => void) => {
    clearTimeout(timers.current[name]);
    timers.current[name] = setTimeout(fn, ms);
  };
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  // The user's real bindings; the defaults stand in until (or unless) they load.
  useEffect(() => {
    window.electronAPI?.getKeybinds?.()
      .then(list => {
        const next: Record<string, string> = {};
        for (const kb of list ?? []) if (ACTION_BY_ID[kb.id] && kb.accelerator) next[kb.id] = kb.accelerator;
        if (Object.keys(next).length) setBindings(prev => ({ ...prev, ...next }));
      })
      .catch(() => {});
  }, []);

  const keysFor = useCallback((id: string) => acceleratorToKeys(bindings[id], PLATFORM), [bindings]);

  // One press, from any source. A short de-dupe guards the rare path where a
  // chord could arrive both as a routed global shortcut and as a keydown.
  const lastPress = useRef<{ action: Action; at: number } | null>(null);
  const press = useCallback((action: Action) => {
    const now = Date.now();
    if (lastPress.current && lastPress.current.action === action && now - lastPress.current.at < 150) return;
    lastPress.current = { action, at: now };

    const i = LESSONS.findIndex(l => l.action === action);
    setLesson(i);
    setDone(d => ({ ...d, [action]: true }));
    setBadge(acceleratorToKeys(bindings[LESSONS[i].id], PLATFORM));
    later('badge', 1400, () => setBadge(null));

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
  }, [bindings]);

  // Global shortcuts, routed here by main for as long as the tour is up.
  useEffect(() => {
    window.electronAPI?.onboardingSetShortcutTour?.(true).catch(() => {});
    const off = window.electronAPI?.onOnboardingTourShortcut?.((actionId) => {
      const action = ACTION_BY_ID[actionId];
      if (action) press(action);
    });
    return () => {
      off?.();
      window.electronAPI?.onboardingSetShortcutTour?.(false).catch(() => {});
    };
  }, [press]);

  // Anything main does not register right now arrives as an ordinary keydown.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      for (const l of LESSONS) {
        if (matchesAccelerator(e, bindings[l.id], PLATFORM)) {
          e.preventDefault();
          press(l.action);
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bindings, press]);

  const cur = LESSONS[lesson];
  const curKeys = keysFor(cur.id);
  const isLast = lesson === LESSONS.length - 1;
  const toggleKeys = keysFor('general:toggle-visibility');

  return (
    <WelcomeFrame t={t} role="main" aria-labelledby="tour-title">
      <div className="flex-1 min-w-0 flex flex-col" style={{ padding: '64px 64px 44px 72px' }}>
        <motion.div {...rise(0.05)} className="flex items-center gap-[10px]">
          <img src={nativelyMark} alt="" draggable={false} style={{ width: 26, height: 26, filter: t.markFilter }} />
          <span style={{ fontSize: 13, fontWeight: 500, color: t.quiet }}>Get started</span>
        </motion.div>

        <motion.div {...rise(0.12)} className="my-auto flex flex-col" style={{ gap: 26 }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: t.faint }}>
            Step {lesson + 1} of {LESSONS.length}
          </div>
          <button
            type="button"
            onClick={() => press(cur.action)}
            aria-label={`Try ${curKeys.join(' + ')}`}
            className="self-start bg-transparent border-0 p-0 cursor-pointer"
          >
            <Keycaps t={t} keys={curKeys} size="lg" />
          </button>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={lesson}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
              className="flex flex-col"
              style={{ gap: 12 }}
            >
              <h1 id="tour-title" style={{ margin: 0, fontSize: 44, fontWeight: 300, letterSpacing: '-0.035em', lineHeight: 1.05, color: t.strong }}>
                {cur.title}
              </h1>
              <p style={{ margin: 0, maxWidth: 400, fontSize: 15, lineHeight: 1.6, color: t.body }}>{cur.text}</p>
            </motion.div>
          </AnimatePresence>
          <div aria-live="polite" style={{ minHeight: 20, fontSize: 13, fontWeight: 500, color: t.quiet }}>
            {done[cur.action] ? (
              <span className="inline-flex items-center gap-2" style={{ color: '#34D399' }}>
                <Check size={15} strokeWidth={2.4} aria-hidden /> That&rsquo;s it. Watch the overlay on the right.
              </span>
            ) : (
              <>Try it now: press {curKeys.join(' + ')} on your keyboard, or click the keys.</>
            )}
          </div>
        </motion.div>

        <div className="flex items-center" style={{ gap: 18 }}>
          {lesson === 0 ? (
            <button type="button" onClick={onDone} className="bg-transparent border-0 cursor-pointer"
              style={{ fontSize: 12.5, fontWeight: 500, color: t.quiet, padding: '10px 4px' }}>
              Skip
            </button>
          ) : (
            <button type="button" onClick={() => setLesson(l => l - 1)} className="bg-transparent border-0 cursor-pointer"
              style={{ fontSize: 12.5, fontWeight: 500, color: t.quiet, padding: '10px 4px' }}>
              Back
            </button>
          )}
          {isLast ? (
            <LavenderButton t={t} width={210} height={40} labelSize={14} onClick={onDone}>
              Start using Natively <ArrowRight size={15} strokeWidth={2} aria-hidden />
            </LavenderButton>
          ) : (
            <LavenderButton t={t} width={132} height={40} labelSize={14} onClick={() => setLesson(l => l + 1)}>
              Next <ArrowRight size={15} strokeWidth={2} aria-hidden />
            </LavenderButton>
          )}
          <div className="ml-auto flex items-center" style={{ gap: 6 }} aria-hidden>
            {LESSONS.map((l, i) => (
              <span key={l.action} style={{
                height: 7, width: i === lesson ? 20 : 7, borderRadius: i === lesson ? 4 : 999,
                background: i === lesson ? '#9C6FF3' : t.dot, transition: 'width 250ms, background-color 250ms',
              }} />
            ))}
          </div>
        </div>
      </div>

      <MeetingDemo
        t={t}
        live={{ hidden, answerKey, shotKey, placeholderKeys: acceleratorToKeys('CommandOrControl+Shift+H', PLATFORM) }}
        hiddenHint={<span className="inline-flex items-center gap-2">Overlay hidden. Press <Keycaps t={t} keys={toggleKeys} /> to bring it back.</span>}
        badge={badge ? <Keycaps t={t} keys={badge} onDark /> : undefined}
      />
    </WelcomeFrame>
  );
};
