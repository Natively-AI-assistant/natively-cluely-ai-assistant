// DEV-ONLY visual harness for Settings → About. Not shipped — same precedent as
// helpSettingsHarness.tsx. Renders the real AboutSection in the 574px Settings
// column, with its navigation recorded on window.__nav.
//
// Query parameters: platform=darwin|win32 (set before modules load by the HTML),
// theme=light|dark.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { AboutSection } from '../components/AboutSection';

const q = new URLSearchParams(location.search);
document.documentElement.setAttribute('data-theme', q.get('theme') === 'light' ? 'light' : 'dark');
const record = (what: string) => { ((window as any).__nav ??= []).push(what); };
Object.assign((window as any).electronAPI, {
  openExternal: (url: string) => record(`open:${url}`),
  setDonationComplete: async () => undefined,
});

createRoot(document.getElementById('harness-root')!).render(
  <div style={{ background: 'var(--bg-main)', minHeight: '100vh', padding: '32px 0' }}>
    <div id="about-column" style={{ width: 574, margin: '0 auto' }}>
      <AboutSection
        onNavigate={(tab) => record(`tab:${tab}`)}
        onOpenModes={() => record('modes')}
        onOpenProfile={() => record('profile')}
        onOpenSearch={() => record('search')}
        onOpenMeeting={(id) => record(`meeting:${id}`)}
      />
    </div>
  </div>,
);
