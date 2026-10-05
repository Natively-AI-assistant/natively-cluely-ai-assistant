// DEV-ONLY visual harness for Settings → Setup & Help. Not shipped — same
// precedent as intelligenceSettingsHarness.tsx.
//
// WHY: Get started reads this install (permissions, credentials, model), and
// most of its states can't be reached on one machine: Windows, a denied
// Screen Recording grant, a provider chosen without its key, a failed check.
// The stub below renders each on demand against the real pane.
//
// Query parameters (all optional):
//   platform=darwin|win32     the OS the pane is written for (set before modules
//                             load by helpSettingsHarness.html's inline script)
//   theme=light|dark          data-theme on <html>, as the app sets it
//   perm=ok|screen|mic|none|fail|slow
//                             permissions:check → both allowed, Screen Recording
//                             denied, microphone denied, both denied, the check
//                             throws, or it answers after 4 s
//   setup=fresh|natively|nokey|keys
//                             credentials → nothing set up, a Natively key, Deepgram
//                             chosen without its key, or Deepgram + a DeepSeek key
//   pro=on|trial|off          Natively Pro, a live trial, or neither (Modes and
//                             Profile Intelligence show "Pro" and their gate)
//   mode=general|ti|none      the active mode: General, Technical Interview, none
//   profile=1|0               a résumé has been added
//   open=speech,model         guides to open after mount, by title
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { HelpSettings } from '../components/settings/HelpSettings';

const q = new URLSearchParams(location.search);
const platform = q.get('platform') === 'win32' ? 'win32' : 'darwin';
const theme = q.get('theme') === 'light' ? 'light' : 'dark';
document.documentElement.setAttribute('data-theme', theme);

const perm = q.get('perm') ?? 'ok';
const pro = q.get('pro') ?? 'on';
const mode = q.get('mode') ?? 'general';
const hasProfile = q.get('profile') === '1';
const setup = q.get('setup') ?? 'natively';
const later = <T,>(v: T, ms = 300) => new Promise<T>((r) => setTimeout(() => r(v), ms));

const permissionResult = () => {
  const screen = platform === 'win32' ? 'granted' : perm === 'screen' || perm === 'none' ? 'denied' : 'granted';
  const microphone = perm === 'mic' || perm === 'none' ? 'denied' : 'granted';
  return { platform, microphone, screen };
};

const credentials: Record<string, unknown> = {
  fresh: { sttProvider: 'none', hasNativelyKey: false },
  natively: { sttProvider: 'natively', hasNativelyKey: true },
  nokey: { sttProvider: 'deepgram', hasDeepgramKey: false, hasNativelyKey: false },
  keys: { sttProvider: 'deepgram', hasDeepgramKey: true, hasDeepseekKey: true, hasNativelyKey: false },
}[setup] ?? {};
const llm = setup === 'natively'
  ? { provider: 'gemini', modelId: 'natively', displayName: 'natively' }
  : { provider: 'gemini', modelId: setup === 'keys' ? 'deepseek-flash' : 'gemini-3.7-flash', displayName: 'x' };

Object.assign((window as any).electronAPI, {
  checkPermissions: () =>
    perm === 'fail' ? Promise.reject(new Error('check failed')) : later(permissionResult(), perm === 'slow' ? 4000 : 250),
  getStoredCredentials: () => later(credentials, 120),
  getCurrentLlmConfig: () => later({ ...llm, isOllama: false, model: llm.modelId }, 120),
  onCredentialsChanged: () => () => undefined,
  onModelChanged: () => () => undefined,
  openExternal: (url: string) => { ((window as any).__opened ??= []).push(url); },
  openMicSettings: async () => { ((window as any).__opened ??= []).push('mic-settings'); },
  licenseGetDetails: () => later({ isPremium: pro === 'on' }, 150),
  getLocalTrial: () => later(pro === 'trial' ? { hasToken: true, expired: false } : { hasToken: false }, 150),
  modesGetActive: () => later(
    mode === 'none' ? null
      : mode === 'ti' ? { id: 'm2', name: 'Technical Interview', templateType: 'technical-interview' }
      : { id: 'mode_general_default', name: 'General', templateType: 'general' },
    150,
  ),
  profileGetStatus: () => later({ hasProfile, profileMode: hasProfile }, 150),
  onLicenseStatusChanged: () => () => undefined,
  onTrialStarted: () => () => undefined,
  getKeybinds: async () => [],
  onKeybindsUpdate: () => () => undefined,
  getGlobalShortcutsEnabled: async () => true,
});

const Harness: React.FC = () => (
  // The Settings content column: 574px wide (SettingsOverlay's panel minus its
  // sidebar and padding), on the panel's own background.
  <div style={{ background: 'var(--bg-main)', minHeight: '100vh', padding: '32px 0' }}>
    <div id="help-column" style={{ width: 574, margin: '0 auto' }}>
      <HelpSettings
        platform={platform}
        onNavigate={(tab) => { ((window as any).__nav ??= []).push(tab); }}
        onOpenModes={() => { ((window as any).__nav ??= []).push('modes-manager'); }}
        onOpenProfile={() => { ((window as any).__nav ??= []).push('profile-manager'); }}
      />
    </div>
  </div>
);

createRoot(document.getElementById('harness-root')!).render(<Harness />);

// Opens guides by title after mount, for screenshots of a guide's body.
const open = q.get('open')?.split(',').filter(Boolean) ?? [];
if (open.length) {
  setTimeout(() => {
    for (const title of open) {
      const button = [...document.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].find(
        (b) => b.getAttribute('aria-label')?.toLowerCase() === `show ${title.toLowerCase()}`,
      );
      button?.click();
    }
  }, 600);
}
