// DEV-ONLY visual harness for the combined Retrieval settings panel. Not
// shipped — same precedent as embeddingSettingsHarness.tsx / rerankerSettingsHarness.tsx.
//
// WHY a third one: Retrieval is the first page that mounts BOTH components at
// once, so it is the only place where the merged layout, the single AIP_CSS
// injection and the Embedding/Reranker switcher can be looked at. The two
// existing harnesses still cover each panel's standalone layout, which the
// render-prop split must leave untouched.
//
// Motion caveat: the tablist pill is framer-motion. A HIDDEN browser tab has
// rAF hard-stopped by Chromium, so the spring never advances and the pill
// appears to teleport. Judge the motion in a VISIBLE window, or in the real
// Electron overlay — not from a background tab.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { RetrievalSettings, type RetrievalTabId } from '../components/settings/RetrievalSettings';
import { EMBEDDING_SETTINGS_API } from './embeddingSettingsApi';
import { RERANKER_SETTINGS_API } from './rerankerSettingsApi';

// One electronAPI carrying both halves — the combined panel calls into both.
(window as any).electronAPI = { ...EMBEDDING_SETTINGS_API, ...RERANKER_SETTINGS_API };

// `?tab=reranker` opens on the Reranker sub-tab, the way the legacy deep link
// does in the real overlay.
const INITIAL_TAB = new URLSearchParams(location.search).get('tab') === 'reranker'
    ? 'reranker' as RetrievalTabId
    : 'embedding' as RetrievalTabId;

function Harness() {
    // Mirrors the real Settings panel container: dark canvas, the width the
    // overlay gives a tab, and the theme attribute the --aip-* scope reads.
    return (
        <div data-theme="dark" style={{ background: 'var(--bg-main, #0b0b0c)', minHeight: '100vh', padding: 24 }}>
            <div style={{ maxWidth: 720, margin: '0 auto' }}>
                <RetrievalSettings initialTab={INITIAL_TAB} />
            </div>
        </div>
    );
}

createRoot(document.getElementById('harness-root')!).render(<Harness />);
