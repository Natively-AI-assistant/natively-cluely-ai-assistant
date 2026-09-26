import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Boxes, ListOrdered } from 'lucide-react';
import { useT } from '../../i18n';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { AIP_CSS } from './AIProvidersSettings';
import { EmbeddingSettings, type EmbeddingSettingsParts } from './EmbeddingSettings';
import { RerankerSettings, type RerankerSettingsParts } from './RerankerSettings';

/**
 * Retrieval — the two halves of document search on one page.
 *
 * Embeddings decide WHICH passages come back; the reranker decides which of
 * those actually answer the question. They were two sidebar entries, which
 * made a single pipeline read as two unrelated settings and put the embedding
 * width and the reranker candidate count a navigation apart.
 *
 * The layout is: both Active cards first (the two decisions), then a switcher
 * over the two provider stacks (the configuration behind them). The Active
 * cards stay above the switcher on purpose — they are what the page is FOR,
 * and burying either inside a tab would mean you cannot see which embedding
 * model you are on while looking at reranker providers.
 */

// Icons are lucide, never emoji — including in comments (Stage 7's sweep greps
// this file for codepoints). Boxes and ListOrdered are what the two sidebar
// entries carried before the merge, so recognition survives it.
const RETRIEVAL_TABS = [
    { id: 'embedding' as const, label: 'Embedding', Icon: Boxes },
    { id: 'reranker' as const, label: 'Reranker', Icon: ListOrdered },
];
export type RetrievalTabId = (typeof RETRIEVAL_TABS)[number]['id'];
const tabButtonId = (id: RetrievalTabId) => `retrieval-tab-${id}`;
const tabPanelId = (id: RetrievalTabId) => `retrieval-tabpanel-${id}`;

interface RetrievalLayoutProps {
    embedding: EmbeddingSettingsParts;
    reranker: RerankerSettingsParts;
    /**
     * Sub-tab to force. Set ONLY by a legacy deep link ('embedding' /
     * 'reranker'); undefined when the user simply opened Retrieval, which is
     * what lets their own sub-tab choice survive a re-click of the sidebar
     * item — see the effect below.
     */
    initialTab?: RetrievalTabId;
    /**
     * Settings' nav sequence. Changes on every deep-link request, so a REPEAT
     * request for the sub-tab already named in `initialTab` still re-asserts.
     */
    navSeq?: number;
}

const RetrievalLayout: React.FC<RetrievalLayoutProps> = ({ embedding, reranker, initialTab, navSeq }) => {
    const t = useT();
    const aipTheme = useResolvedTheme();

    const [activeTab, setActiveTab] = useState<RetrievalTabId>(initialTab ?? 'embedding');
    /* Honour a deep link that arrives while this layout is ALREADY mounted
       (Settings open on Retrieval, AI Providers' lightweight notice fires).
       `initialTab` is undefined for a plain Retrieval open, so this does not
       fire then — which is the whole point.

       The alternative, keying this component on the outer tab id so it
       remounts, was measured and rejected: clicking the already-highlighted
       Retrieval item flipped the id 'embedding' -> 'retrieval', remounted BOTH
       panels, threw away the user's sub-tab choice and flashed 8 skeleton cards
       for ~400ms while every catalogue IPC re-ran. A click on the item you are
       already on must be a no-op. */
    useEffect(() => {
        if (initialTab) setActiveTab(initialTab);
        // `navSeq` is a dep so that repeating the SAME deep link re-asserts.
        // `initialTab` alone is unchanged on a repeat, so the effect would not
        // run and the click would do nothing — which is exactly what happened
        // when the lightweight-embedding notice was clicked twice with a visit
        // to the Reranker sub-tab in between. Verified live 2026-09-15.
    }, [initialTab, navSeq]);
    // Index drives the pill's spring target; -1 can't happen (state is typed to
    // the tab ids) but Math.max keeps a bad value from shifting it off-track.
    const activeTabIndex = Math.max(0, RETRIEVAL_TABS.findIndex((tab) => tab.id === activeTab));
    // Roving tabindex: only the selected tab is a tab stop, so Arrow/Home/End
    // are the ONLY way to reach the other one. Without this a keyboard user
    // lands on the active tab and can never leave it.
    const tabRefs = useRef<Partial<Record<RetrievalTabId, HTMLButtonElement | null>>>({});
    // Gates the tablist pill's spring only. Every other animation on this page
    // is CSS and is already covered by the .aip-root reduced-motion block.
    const prefersReducedMotion = useReducedMotion();

    const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        const navKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
        if (!navKeys.includes(event.key)) return;
        event.preventDefault();

        const current = Math.max(0, RETRIEVAL_TABS.findIndex((tab) => tab.id === activeTab));
        let nextIndex: number;
        if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = RETRIEVAL_TABS.length - 1;
        else {
            const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
            nextIndex = (current + delta + RETRIEVAL_TABS.length) % RETRIEVAL_TABS.length;
        }

        const nextId = RETRIEVAL_TABS[nextIndex].id;
        setActiveTab(nextId);
        // Automatic activation: focus follows selection. The target button only
        // becomes a tab stop after React re-renders, hence the rAF.
        requestAnimationFrame(() => tabRefs.current[nextId]?.focus());
    };

    return (
        // One `.aip-root`, one AIP_CSS. Both child components can emit their own
        // wrapper and style tag, and here they must not — this page mounts both.
        <div className="aip-root space-y-5 pb-10" data-theme={aipTheme} data-settings-stagger>
            {/* ONE header for both halves. Each child component still owns a
                heading for its STANDALONE layout, but neither exposes it as a
                part, so nothing is built here for a caller that would not
                render it. Two headings stacked above two Active cards restated
                "chosen separately from your AI model" twice and re-split the
                pipeline the merge exists to join. The cards' own labels —
                ACTIVE EMBEDDING MODEL, ACTIVE RERANKER — say which is which. */}
            <header className="space-y-1">
                <h3 className="aip-title">{t('Retrieval')}</h3>
                <p className="aip-subtitle">
                    {t('Two models decide what Natively finds in your documents: the embedding model indexes them and retrieves candidate passages, and the reranker decides which of those actually answer the question. Both are chosen separately from your AI model, and changing the embedding model re-indexes your project.')}
                </p>
            </header>

            {embedding.hero}
            {reranker.hero}

            {/* The switcher, ported from AI Providers' cloud/gateways/privacy
                tablist. The constraints below are load-bearing and were each
                paid for there:

                - No `layoutId` shared-layout element. This is ONE pill node that
                  never unmounts, springing `x` across the track. The layoutId
                  version forced a measure pass around the panel unmount/mount,
                  the scroller's content transiently collapsed below scrollTop +
                  clientHeight, and Chromium clamped — switching tabs from a
                  scrolled position snapped the panel back to the top (measured
                  there: scrollTop 260 -> 0 with layoutId, 260 -> 260 without).
                - The track has NO `overflow-hidden`. The spring overshoots the
                  hop while the track has only 4px of `p-1` to spare, so on the
                  end tabs the clip shaved the pill's outer edge flat for a few
                  frames — exactly the part of the feel being ported.
                - Transform-only. The tabs never restyle their background, which
                  is what stops the colour swap a per-button `bg` transition
                  produces; only the label colour crossfades, from `.aip-tab`. */}
            <div
                role="tablist"
                aria-label={t('Retrieval groups')}
                className="aip-tablist grid grid-cols-2 relative p-1 rounded-lg"
            >
                <motion.div
                    aria-hidden="true"
                    className="absolute top-0 bottom-0 left-0 w-1/2 p-1 will-change-transform"
                    initial={false}
                    animate={{ x: `${activeTabIndex * 100}%` }}
                    transition={prefersReducedMotion
                        ? { duration: 0 }
                        : { type: 'spring', stiffness: 400, damping: 30 }}
                >
                    <div className="w-full h-full rounded-md aip-tab-pill" />
                </motion.div>

                {RETRIEVAL_TABS.map(({ id, label, Icon }) => (
                    <button
                        key={id}
                        id={tabButtonId(id)}
                        ref={(node) => { tabRefs.current[id] = node; }}
                        type="button"
                        role="tab"
                        aria-selected={activeTab === id}
                        aria-controls={tabPanelId(id)}
                        tabIndex={activeTab === id ? 0 : -1}
                        onClick={() => setActiveTab(id)}
                        onKeyDown={handleTabKeyDown}
                        className="aip-tab relative z-10 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium"
                    >
                        <Icon size={13} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
                        <span className="truncate">{t(label)}</span>
                    </button>
                ))}
            </div>

            {/* Incoming panel only, no exit animation: the outgoing panel
                unmounts synchronously so the scroller never sees two children
                (an AnimatePresence cross-fade doubles content height for a
                frame, which flashes the scrollbar and jumps scrollTop). Each
                branch sits at its own fixed child position, so switching tabs
                already forces an unmount + mount and re-runs `.aip-panel-fade`
                — no `key` needed.

                `data-stagger-skip` is not optional: without it the
                `data-settings-stagger` ladder's animation-delay applies to THAT
                animation and puts a ~175ms stall in front of every sub-tab
                switch. */}
            {activeTab === 'embedding' && (
                <div
                    id={tabPanelId('embedding')}
                    role="tabpanel"
                    aria-labelledby={tabButtonId('embedding')}
                    tabIndex={0}
                    className="space-y-5 aip-panel-fade"
                    data-stagger-skip
                >
                    {embedding.panel}
                </div>
            )}

            {activeTab === 'reranker' && (
                <div
                    id={tabPanelId('reranker')}
                    role="tabpanel"
                    aria-labelledby={tabButtonId('reranker')}
                    tabIndex={0}
                    className="space-y-5 aip-panel-fade"
                    data-stagger-skip
                >
                    {reranker.panel}
                </div>
            )}

            <style>{AIP_CSS}</style>
        </div>
    );
};

interface RetrievalSettingsProps {
    /** Sub-tab to force — set only by a legacy `'embedding'`/`'reranker'` deep link. */
    initialTab?: RetrievalTabId;
    /** Settings' nav sequence, so a repeated deep link re-asserts. */
    navSeq?: number;
}

/**
 * RerankerSettings is nested INSIDE EmbeddingSettings' render prop, not beside
 * it, and the order matters. The outer component's state changes recreate the
 * render-prop closure and re-render the inner subtree wholesale; RerankerSettings
 * owns the hot ticker (per-file download percentages), so it belongs on the
 * inside where its ticks cannot cascade outward.
 */
export const RetrievalSettings: React.FC<RetrievalSettingsProps> = ({ initialTab, navSeq }) => (
    <EmbeddingSettings
        renderParts={(embedding) => (
            <RerankerSettings
                renderParts={(reranker) => (
                    <RetrievalLayout
                        embedding={embedding}
                        reranker={reranker}
                        initialTab={initialTab}
                        navSeq={navSeq}
                    />
                )}
            />
        )}
    />
);

export default RetrievalSettings;
