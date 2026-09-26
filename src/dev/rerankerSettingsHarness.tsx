// DEV-ONLY visual harness. The fixture data and the `window.electronAPI`
// stub live in a sibling module so the combined Retrieval harness can merge this
// panel's stub with the other one's instead of duplicating both.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { RerankerSettings } from '../components/settings/RerankerSettings';
import { RERANKER_SETTINGS_API } from './rerankerSettingsApi';

(window as any).electronAPI = { ...((window as any).electronAPI || {}), ...RERANKER_SETTINGS_API };

function Harness() {
    // Mirrors the real Settings panel container: dark canvas, the width the
    // overlay gives a tab, and the theme attribute the --aip-* scope reads.
    return (
        <div data-theme="dark" style={{ background: 'var(--bg-main, #0b0b0c)', minHeight: '100vh', padding: 24 }}>
            <div style={{ maxWidth: 720, margin: '0 auto' }}>
                <RerankerSettings />
            </div>
        </div>
    );
}

createRoot(document.getElementById('harness-root')!).render(<Harness />);
