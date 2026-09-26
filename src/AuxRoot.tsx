/**
 * Renderer root for the LIGHT windows — the overlay pill, the resize toggle,
 * and the cropper.
 *
 * WHY THIS EXISTS. Every Natively window loads the same index.html with a
 * different `?window=` param, and every one of them used to mount `App`. `App`
 * statically imports NativelyInterface, which pulls react-markdown,
 * react-syntax-highlighter and KaTeX — so the 36px resize toggle evaluated the
 * entire application bundle to render thirty DOM nodes.
 *
 * MEASURED 2026-09-03 (dev, macOS, per-window CDP heap read):
 *
 *     window            heap    JS files   DOM nodes   katex/highlighter/markdown
 *     launcher          66 MB      218         784      all loaded
 *     overlay-toggle    52 MB      219          30      all loaded
 *     cropper           47 MB      218          22      all loaded
 *
 * 79% of the launcher's heap for 4% of its DOM. These three routes need React,
 * a couple of lucide icons, framer-motion and one appearance helper — nothing
 * else — so they get their own root that never imports App at all.
 *
 * The routes here must stay genuinely self-contained. App's own comment for the
 * aux windows already required that ("Deliberately minimal: no providers, no
 * banners"), because App's hooks run even when its JSX early-returns, and an
 * aux renderer firing launcher-only effects double-counts analytics and eats
 * onboarding toaster stages. Nothing here uses i18n, so LanguageProvider is
 * deliberately absent too; adding a provider that needs it would pull i18n back
 * into these windows.
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider, ToastViewport } from './components/ui/toast';
import { OverlayPillWindow, OverlayToggleWindow } from './components/OverlayAuxWindows';
import { getMeetingInterfaceTheme, type MeetingInterfaceTheme } from './lib/meetingInterfaceTheme';

const CropperWindow = React.lazy(() => import('./components/Cropper'));
const SettingsPopup = React.lazy(() => import('./components/SettingsPopup'));
const ModelSelectorWindow = React.lazy(() => import('./components/ModelSelectorWindow'));

/** Routes this root can serve. Keep in sync with LIGHT_ROUTES in main.tsx. */
export type AuxRoute =
  | 'overlay-pill'
  | 'overlay-toggle'
  | 'cropper'
  | 'settings'
  | 'model-selector';

/** One client for this renderer, mirroring App's module-level instance. */
const queryClient = new QueryClient();

/**
 * The panel routes need App's provider stack but none of its state, so it is
 * reproduced here rather than dragging App along for it.
 *
 * VERIFIED before splitting: no effect in App is gated on `isSettingsWindow` or
 * `isModelSelectorWindow` — those flags appear only in the `isDefault`
 * exclusion and in the render branches — so these windows ran no App-specific
 * behaviour to lose. Their own import graphs are 9 and 6 modules with no heavy
 * dependency, against App's 131.
 */
const PanelShell: React.FC<{ context: string; className: string; children: React.ReactNode }> = ({
  context, className, children,
}) => {
  // Mirrors App's handling: the attribute is read at mount and refreshed on the
  // same two signals App listens to, so a theme change still lands here.
  const [theme, setTheme] = React.useState<MeetingInterfaceTheme>(getMeetingInterfaceTheme);
  React.useEffect(() => {
    const onStorage = () => setTheme(getMeetingInterfaceTheme());
    window.addEventListener('storage', onStorage);
    const off = window.electronAPI?.onMeetingInterfaceThemeChanged?.((next) => {
      const valid: MeetingInterfaceTheme[] = ['default', 'liquid-glass', 'modern'];
      if (valid.includes(next as MeetingInterfaceTheme)) setTheme(next as MeetingInterfaceTheme);
    });
    return () => {
      window.removeEventListener('storage', onStorage);
      try { (off as undefined | (() => void))?.(); } catch { /* best effort */ }
    };
  }, []);

  return (
    <ErrorBoundary context={context}>
      <div className={className} data-interface-theme={theme === 'default' ? undefined : theme}>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <React.Suspense fallback={<div className="h-full w-full" />}>
              {children}
            </React.Suspense>
            <ToastViewport />
          </ToastProvider>
        </QueryClientProvider>
      </div>
    </ErrorBoundary>
  );
};

const AuxRoot: React.FC<{ route: AuxRoute }> = ({ route }) => {
  if (route === 'cropper') {
    return (
      <ErrorBoundary context="Cropper">
        <React.Suspense fallback={<div className="w-screen h-screen bg-transparent" />}>
          <CropperWindow />
        </React.Suspense>
      </ErrorBoundary>
    );
  }

  if (route === 'settings') {
    return (
      <PanelShell context="SettingsPopup" className="h-full min-h-0 w-full">
        <SettingsPopup />
      </PanelShell>
    );
  }

  if (route === 'model-selector') {
    return (
      <PanelShell context="ModelSelector" className="h-full min-h-0 w-full overflow-hidden">
        <ModelSelectorWindow />
      </PanelShell>
    );
  }

  if (route === 'overlay-pill') {
    return (
      <ErrorBoundary context="OverlayPill">
        <OverlayPillWindow />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary context="OverlayToggle">
      <OverlayToggleWindow />
    </ErrorBoundary>
  );
};

export default AuxRoot;
