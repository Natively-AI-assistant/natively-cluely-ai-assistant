// DEV-ONLY visual/behavioural harness for the AI Providers panel's group
// tablist (Cloud Providers / Local & Gateways / Privacy). Not part of the
// shipped app — same precedent as embeddingSettingsHarness.tsx and
// rerankerSettingsHarness.tsx, and vite's build input is index.html alone, so
// the sibling *.html entry never ships.
//
// WHY: the tablist's selection pill is now a framer-motion shared-layout spring
// (matching the meeting-notes Summary/Transcript/Usage switcher). Reading the
// variant tells you nothing about whether it actually plays — framer-motion
// runs on main-thread rAF here, so it has to be driven in a VISIBLE page and
// sampled per frame. This mounts the REAL component with a stubbed
// `window.electronAPI` so the pill measured is the shipped one.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { AIProvidersSettings } from '../components/settings/AIProvidersSettings';

// Every call site in the panel is `window.electronAPI?.foo?.()`, so a Proxy that
// answers any name with a resolved no-op is enough to get it mounted. Anything
// that needs a real shape (the panel reads a handful of getters on mount) falls
// back to undefined, which each call site already tolerates.
// Resolves to `[]`, which is the only value that satisfies every consumer here:
// an array is still an object, so `(await get()).someField` reads as undefined
// instead of throwing, while `.forEach` / `.map` / spread on the getters that
// return collections still work.
const noop = async () => ([] as any);

// The handful of getters whose result is destructured further than one level.
// `[]` would be truthy and then blow up on the second hop, so they answer null
// (each consumer already treats null as "nothing to show").
// `?signedIn=1` drives the post-sign-in half of the OAuth cards, which is
// otherwise unreachable here: the default stub reports signed-out, so the model
// list, the account line and the Disconnect action never render and cannot be
// looked at. Model ids match the real catalogue shape (bare ids; the card adds
// the `antigravity:` prefix itself).
const SIGNED_IN = new URLSearchParams(location.search).get('signedIn') === '1';

const OVERRIDES: Record<string, () => Promise<any>> = {
    getAmbiguousCredentialStores: async () => null,
    antigravityStatus: async () => ({
        signedIn: SIGNED_IN, inProgress: false,
        expiresAt: SIGNED_IN ? Date.now() + 3_600_000 : undefined,
    }),
    antigravityModels: async () => ({
        success: true,
        models: SIGNED_IN ? [
            { id: 'gemini-3-pro', label: 'Gemini 3 Pro' },
            { id: 'gemini-3-flash', label: 'Gemini 3 Flash' },
            { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
            { id: 'gpt-5.4', label: 'GPT-5.4' },
        ] : [],
    }),
};

(window as any).electronAPI = new Proxy({}, {
    get: (_target, prop: string) => {
        if (prop === 'then') return undefined; // never look thenable
        if (prop.startsWith('on')) return () => () => { };  // subscribe -> unsubscribe
        return OVERRIDES[prop] ?? noop;
    },
});

// useResolvedTheme reads html[data-theme] and defaults to dark; pin it here so
// the harness is deterministic and both themes can be eyeballed (?theme=light).
document.documentElement.setAttribute(
    'data-theme',
    new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark',
);

const isLight = new URLSearchParams(location.search).get('theme') === 'light';

function Harness() {
    const ref = React.useRef<HTMLDivElement | null>(null);
    return (
        // The real panel renders inside SettingsOverlay's periwinkle theme scope;
        // without it --accent-primary resolves to the app default and the pill
        // reads a different colour than it does in Settings.
        // The background is set explicitly because index.css leaves body/html
        // transparent (the real window paints its own surface). Without it the
        // canvas is white and every translucent --aip-* token — the well is
        // rgba(0,0,0,0.22) in dark — renders inverted.
        // Reproduces SettingsOverlay's real content box: a fixed-height
        // `overflow-y-auto` scroller with `overflowAnchor: 'none'`. Scrolling the
        // WINDOW instead would hide every scroll-position bug this panel can have,
        // because the scroller that outlives a tab switch is this inner div.
        <div
            data-settings-theme="periwinkle"
            id="panel-scroll"
            style={{
                padding: 32, maxWidth: 760, margin: '0 auto',
                height: '100vh', overflowY: 'auto', overflowAnchor: 'none',
                background: isLight ? '#f5f5f7' : '#141416',
            }}
        >
            <AIProvidersSettings
                aiResponseLanguage="auto"
                availableAiLanguages={[{ code: 'auto', label: 'Auto' }, { code: 'en', label: 'English' }]}
                isAiLangDropdownOpen={false}
                onToggleAiLangDropdown={() => { }}
                onSelectAiLanguage={() => { }}
                aiLangDropdownRef={ref}
            />
        </div>
    );
}

createRoot(document.getElementById('harness-root')!).render(<Harness />);
