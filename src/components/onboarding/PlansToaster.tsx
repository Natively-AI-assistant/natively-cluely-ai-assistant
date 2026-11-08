// src/components/onboarding/PlansToaster.tsx
//
// The Natively Plans card: the first card after getting started (welcome →
// tour → permissions), for someone not yet on a plan. A startup paywall: the
// Unlock Pro plans page (upgrade/UnlockProPlans.tsx: the $5 Pro Pack, API Pro,
// Pro Yearly and "See all plans"), with a quiet "Continue for free" in place
// of a close button. It used to show the four API plans side by side; since
// 2026-11-07 it is the same page the Modes and Profile Intelligence paywalls
// open, so a new install meets one set of offers wherever it looks.
//
// It pours out over the launcher with the genie (GenieModal) at the page's
// own size, 820 × 600, as in the manager panel. Presentational: the
// onboarding orchestrator decides when it opens (OrchestratedToasterHost) and
// the card ledger decides when it may return.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { GenieModal } from '../ui/GenieModal';
import { UnlockProPlans } from '../upgrade/UnlockProPlans';

const SHADOW = {
  dark: '0 40px 90px -30px rgba(0,0,0,0.85)',
  light: '0 40px 90px -34px rgba(76,46,122,0.45)',
};
const BACKDROP = { dark: 'rgba(0,0,0,0.42)', light: 'rgba(40,30,70,0.18)' };

interface Props {
  isOpen:    boolean;
  /** Why it closed, for the host's card ledger: 'acted' once a checkout opened, else nothing. */
  onDismiss: (reason?: 'acted') => void;
  /** Settings › Plans & Billing, for someone who already holds a licence or key. */
  onOpenPlans?: () => void;
}

export const PlansToaster: React.FC<Props> = ({ isOpen, onDismiss, onOpenPlans }) => {
  const theme = useResolvedTheme() === 'light' ? 'light' : 'dark';

  // Starts closed, so the first thing the card does is pour out.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(isOpen);
  }, [isOpen]);

  // The orchestrator unmounts this the moment it hears "dismissed", so every
  // way out closes the card first (the genie) and reports from onClosed.
  const afterCloseRef = useRef<(() => void) | null>(null);
  const closeThen = useCallback((after: () => void) => {
    if (afterCloseRef.current) return;
    afterCloseRef.current = after;
    setVisible(false);
  }, []);

  // Escape, backdrop and "Continue for free" are a "later". No ✕: the
  // quiet link is the way out, as on a startup paywall.
  const handleDismiss = useCallback(() => closeThen(() => onDismiss()), [closeThen, onDismiss]);
  // A checkout opened: the user is at checkout, so the card has done its job.
  const handleCheckoutOpened = useCallback(() => closeThen(() => onDismiss('acted')), [closeThen, onDismiss]);
  const handleHaveLicense = useCallback(
    () => closeThen(() => { onDismiss(); onOpenPlans?.(); }),
    [closeThen, onDismiss, onOpenPlans],
  );

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleDismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, handleDismiss]);

  return (
    <GenieModal
      open={visible}
      label="PlansToaster"
      // Keeps no pictures: one bakes in the launcher behind it as it was then,
      // and the next open would pour out that stale backdrop (and, after a
      // redesign, the old card). Its open pours the live card instead.
      keepPictures={false}
      zIndex={9998}
      onBackdropClick={handleDismiss}
      onClosed={() => { const after = afterCloseRef.current; afterCloseRef.current = null; after?.(); }}
      backdropStyle={{ background: BACKDROP[theme] }}
      padding={16}
      wrapStyle={{ width: '820px', height: '600px', maxWidth: '100%', maxHeight: '100%' }}
      cardStyle={{ background: 'none' }}
      cardProps={{
        role: 'dialog',
        'aria-modal': true,
        'aria-labelledby': 'unlock-pro-title',
        'aria-describedby': 'unlock-pro-desc',
      }}
      shadow={SHADOW[theme]}
      radius={24}
    >
      <UnlockProPlans
        surface="plans_card"
        theme={theme}
        subtitle="Every plan includes the full Natively Pro app."
        dismiss={{ label: 'Continue for free', onClick: handleDismiss }}
        onCheckoutOpened={handleCheckoutOpened}
        onHaveLicense={onOpenPlans ? handleHaveLicense : undefined}
      />
    </GenieModal>
  );
};

export default PlansToaster;
