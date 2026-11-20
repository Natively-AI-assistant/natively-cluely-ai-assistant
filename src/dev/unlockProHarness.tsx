// Dev-only, not shipped: the paywall plans page at the manager panel's real size.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { UnlockProPlans } from '../components/upgrade/UnlockProPlans';
import { PlansSwap as RealPlansSwap } from '../components/upgrade/PlansSwap';
import { PlansToaster } from '../components/onboarding/PlansToaster';
// The app's global stylesheet, so the page renders on the app's own base styles.
import '../index.css';

const theme = (new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark') as 'light' | 'dark';
document.documentElement.style.background = document.body.style.background = theme === 'light' ? '#d9d9de' : '#0a0a0a';
(window as any).electronAPI = { openExternal: async () => ({ ok: true }), funnelTrack: async () => ({ ok: true }) };

// ?swap: a stand-in paywall that hands off to the plans page, as the Modes and
// Profile Intelligence gates do. ?toaster: the real startup card (genie + the
// "Start smaller" second step).
function SwapDemo() {
  const [plans, setPlans] = React.useState(false);
  // ?still: the hand-off as it was before PlansSwap, a hard cut, for comparing.
  const PlansSwap = new URLSearchParams(location.search).has('still')
    ? (({ children }: { children: React.ReactNode }) => <div style={{ height: '100%' }}>{children}</div>) as unknown as typeof RealPlansSwap
    : RealPlansSwap;
  const dark = theme === 'dark';
  return plans
    ? <PlansSwap swapKey="plans" direction={1}><UnlockProPlans surface="modes_settings" theme={theme} onBack={() => setPlans(false)} onClose={() => {}} onHaveLicense={() => {}} /></PlansSwap>
    : <PlansSwap swapKey="gate" direction={-1}>
        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: dark ? '#141414' : '#f4f2fa', color: dark ? '#eee' : '#222', flexDirection: 'column', gap: 16, fontFamily: 'system-ui' }}>
          <div style={{ fontSize: 28, fontWeight: 600 }}>Modes is a Pro feature</div>
          <button id="unlock" onClick={() => setPlans(true)} style={{ height: 40, padding: '0 22px', borderRadius: 999, border: 0, fontWeight: 600 }}>Unlock Pro</button>
        </div>
      </PlansSwap>;
}

createRoot(document.getElementById('harness-root')!).render(
  <div style={{ padding: 40 }}>
    <div style={{ width: 820, height: 600, borderRadius: 24, overflow: 'hidden', boxShadow: '0 30px 80px -20px rgba(0,0,0,0.6)' }}>
      {new URLSearchParams(location.search).has('toaster')
        ? <PlansToaster isOpen onDismiss={() => {}} onOpenPlans={() => {}} />
        : new URLSearchParams(location.search).has('swap')
        ? <SwapDemo />
        : new URLSearchParams(location.search).has('exit')
        // The second chance after "Continue for free" (PlansToaster, step 'exit').
        ? <UnlockProPlans variant="exit" surface="plans_card" theme={theme} title="Start smaller." subtitle="Not ready for the full week? Try everything in Pro for a couple of hours." dismiss={{ label: 'No thanks, continue for free', onClick: () => {} }} onHaveLicense={() => {}} />
        : new URLSearchParams(location.search).has('card')
        // The Natively Plans card after getting started (onboarding/PlansToaster.tsx).
        ? <UnlockProPlans surface="plans_card" theme={theme} subtitle="Every plan includes the full Natively Pro app." dismiss={{ label: 'Continue for free', onClick: () => {} }} onHaveLicense={() => {}} />
        : <UnlockProPlans surface="modes_settings" theme={theme} onBack={() => {}} onClose={() => {}} onHaveLicense={() => {}} />}
    </div>
  </div>,
);
