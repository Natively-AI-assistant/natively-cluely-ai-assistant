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
import ErrorBoundary from './components/ErrorBoundary';
import { OverlayPillWindow, OverlayToggleWindow } from './components/OverlayAuxWindows';

/** Cropper is the heaviest of the three and only one window ever shows it. */
const CropperWindow = React.lazy(() => import('./components/Cropper'));

/** Routes this root can serve. Keep in sync with LIGHT_ROUTES in main.tsx. */
export type AuxRoute = 'overlay-pill' | 'overlay-toggle' | 'cropper';

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
