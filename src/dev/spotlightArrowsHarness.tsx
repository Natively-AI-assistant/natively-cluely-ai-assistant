// DEV-ONLY visual harness for FeatureSpotlight's paging arrows. Not part of the
// shipped app (same precedent as trialCardHarness.tsx / embeddingSettingsHarness.tsx
// and their sibling *.html entries; vite's build input is index.html alone, so
// this never ships).
//
// WHY this exists rather than "just look at the app": the arrows are revealed by
// pointer PROXIMITY, so the thing under test is a cursor position relative to the
// card — which means it has to be driven, and the card has to sit at a known box.
// Mounting the real component (not a copy of its CSS) is the point: it proves the
// Tailwind atoms compile and that the handler in the shipped source is what runs.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { FeatureSpotlight } from '../components/FeatureSpotlight';

// The card's real geometry in the launcher: max-w-4xl (896px) split 3 ways with
// gap-3, the spotlight taking 2 columns + one gap; h-[198px] from the hero grid.
const CARD_W = (896 - 24) / 3 * 2 + 12;
const CARD_H = 198;

function Harness() {
    return (
        <div style={{ padding: 40, background: '#0A0A0B', minHeight: '100vh' }}>
            <div style={{ width: CARD_W, height: CARD_H }}>
                <FeatureSpotlight />
            </div>
        </div>
    );
}

createRoot(document.getElementById('harness-root')!).render(<Harness />);
