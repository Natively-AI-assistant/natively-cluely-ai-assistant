// Dev-only, not shipped: the paywall plans page at the manager panel's real size.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { UnlockProPlans } from '../components/upgrade/UnlockProPlans';
// The app's global stylesheet, so the page renders on the app's own base styles.
import '../index.css';

const theme = (new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark') as 'light' | 'dark';
document.documentElement.style.background = document.body.style.background = theme === 'light' ? '#d9d9de' : '#0a0a0a';
(window as any).electronAPI = { openExternal: async () => ({ ok: true }), funnelTrack: async () => ({ ok: true }) };

createRoot(document.getElementById('harness-root')!).render(
  <div style={{ padding: 40 }}>
    <div style={{ width: 820, height: 600, borderRadius: 24, overflow: 'hidden', boxShadow: '0 30px 80px -20px rgba(0,0,0,0.6)' }}>
      {new URLSearchParams(location.search).has('card')
        // The Natively Plans card after getting started (onboarding/PlansToaster.tsx).
        ? <UnlockProPlans surface="plans_card" theme={theme} subtitle="Every plan includes the full Natively Pro app." dismiss={{ label: 'Continue for free', onClick: () => {} }} onHaveLicense={() => {}} />
        : <UnlockProPlans surface="modes_settings" theme={theme} onBack={() => {}} onClose={() => {}} onHaveLicense={() => {}} />}
    </div>
  </div>,
);
