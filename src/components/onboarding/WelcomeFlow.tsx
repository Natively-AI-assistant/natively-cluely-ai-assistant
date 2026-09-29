// src/components/onboarding/WelcomeFlow.tsx
//
// The first-launch welcome and shortcut tour as ONE surface: a frame, a left
// column that swaps between the welcome and the tour, and a single MeetingDemo
// on the right that never remounts. Before this, WelcomeScreen and ShortcutTour
// each rendered their own frame and plate, so Get started faded the whole
// window out, slid a new plate in for 700ms and restarted the call video.
//
// Emil: spatial consistency — the thing that does not change (the plate, the
// call) should not move; only what changes should. transitions.dev #08 for the
// left column, #04 / #22 inside MeetingDemo.

import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useT } from '../../i18n';
import { useWelcomeTheme, WelcomeFrame, MeetingDemo, Keycaps, useSlideVariants } from './welcomeShared';
import { WelcomeLeft } from './WelcomeScreen';
import { TourLeft, useShortcutTour } from './ShortcutTour';
import { fillText } from './i18nText';

interface Props {
  /** Called when the tour ends (finished or skipped). */
  onDone: () => void;
}

export const WelcomeFlow: React.FC<Props> = ({ onDone }) => {
  const t = useWelcomeTheme();
  const slide = useSlideVariants();
  const tr = useT();
  const [step, setStep] = useState<'welcome' | 'tour'>('welcome');
  const tour = useShortcutTour(step === 'tour');

  return (
    <WelcomeFrame t={t}>
      <div className="flex-1 min-w-0 h-full">
        {/* The welcome only ever moves forward, into the tour. */}
        <AnimatePresence mode="wait" initial={false} custom={1}>
          <motion.div
            key={step}
            custom={1}
            variants={slide}
            initial="enter"
            animate="center"
            exit="exit"
            className="h-full w-full flex"
          >
            {step === 'welcome'
              ? <WelcomeLeft onGetStarted={() => setStep('tour')} />
              : <TourLeft tour={tour} onDone={onDone} />}
          </motion.div>
        </AnimatePresence>
      </div>

      <MeetingDemo
        t={t}
        live={{ hidden: tour.hidden, answerKey: tour.answerKey, shotKey: tour.shotKey, placeholderKeys: tour.placeholderKeys }}
        hiddenHint={<span className="inline-flex items-center gap-2 whitespace-nowrap">{fillText(tr('Overlay hidden. Press {keys} to bring it back.'), { keys: <Keycaps t={t} keys={tour.toggleKeys} /> })}</span>}
        badge={tour.badge ? <Keycaps t={t} keys={tour.badge} onDark /> : undefined}
      />
    </WelcomeFrame>
  );
};
