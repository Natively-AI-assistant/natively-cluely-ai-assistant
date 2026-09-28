// src/components/onboarding/WelcomeScreen.tsx
//
// First-launch welcome. Fills the launcher window once, on a fresh install,
// between the logo splash and the launcher; App.tsx decides when (see
// src/lib/onboarding/welcomeGate.mjs). "Get started" moves on to the shortcut
// tour (ShortcutTour), and from there to the launcher, where the permissions
// card follows as usual.
//
// Left: the N mark (black on light, as-is white on dark), the pitch and one
// lavender liquid-glass action. Right: the Natively overlay answering over a
// live call (MeetingDemo, shared with the tour).

import React from 'react';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import nativelyMark from '../../assets/logo.webp';
import { useWelcomeTheme, useRise, WelcomeFrame, LavenderButton, MeetingDemo } from './welcomeShared';

const TERMS_URL = 'https://natively.software/termsandconditions';
const PRIVACY_URL = 'https://natively.software/privacy';

interface Props {
  onGetStarted: () => void;
}

export const WelcomeScreen: React.FC<Props> = ({ onGetStarted }) => {
  const t = useWelcomeTheme();
  const rise = useRise();

  const openLink = (url: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    window.electronAPI?.openExternal?.(url);
  };

  return (
    <WelcomeFrame t={t} role="main" aria-labelledby="welcome-title">
      <div className="flex-1 min-w-0 flex flex-col items-center text-center" style={{ padding: '64px 72px 48px' }}>
        <div className="my-auto flex flex-col items-center" style={{ gap: 22 }}>
          <motion.img {...rise(0.05)} src={nativelyMark} alt="Natively" draggable={false}
            style={{ width: 60, height: 60, filter: t.markFilter }} />
          <motion.div {...rise(0.1)} style={{ fontSize: 13, fontWeight: 500, letterSpacing: '-0.005em', color: t.quiet }}>
            Welcome to Natively
          </motion.div>
          <motion.h1 {...rise(0.14)} id="welcome-title"
            style={{ margin: 0, fontSize: 56, fontWeight: 300, letterSpacing: '-0.035em', lineHeight: 1.04, color: t.strong }}>
            Real-time help,<br />in every meeting.
          </motion.h1>
          <motion.p {...rise(0.18)}
            style={{ margin: 0, maxWidth: 400, fontSize: 16, lineHeight: 1.6, letterSpacing: '-0.008em', color: t.body }}>
            Natively listens along, answers the question in front of you, and can stay hidden from screen sharing.
          </motion.p>
          <motion.div {...rise(0.24)} style={{ marginTop: 16 }}>
            <LavenderButton t={t} width={320} onClick={onGetStarted}>
              Get started <ArrowRight size={15} strokeWidth={2} aria-hidden />
            </LavenderButton>
          </motion.div>
        </div>
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: t.faint }}>
          By continuing, you agree to our{' '}
          <a href={TERMS_URL} onClick={openLink(TERMS_URL)} className="underline underline-offset-2" style={{ color: 'inherit' }}>Terms &amp; Conditions</a>
          {' '}and{' '}
          <a href={PRIVACY_URL} onClick={openLink(PRIVACY_URL)} className="underline underline-offset-2" style={{ color: 'inherit' }}>Privacy Policy</a>.
        </p>
      </div>

      <MeetingDemo t={t} />
    </WelcomeFrame>
  );
};
