// scripts/role-insight-harness/entry.tsx
//
// Visual harness for Role Insight.
//
// Renders the REAL RoleInsightPanel component against REAL pipeline output
// (scripts/.role-insight-fixture.json, produced by dump-role-insight-fixture.mjs)
// inside a `.pi-root` carrying the real Profile Intelligence token set — so what
// is on screen is what ships, not a mock-up. `window.electronAPI` is stubbed to
// return the fixture, which is exactly the contract the panel talks to.

import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RoleInsightPanel } from '../../premium/src/RoleInsightPanel';
import fixture from '../.role-insight-fixture.json';

type Scenario = 'populated' | 'switcher' | 'thin' | 'blocked' | 'firstuse' | 'missing' | 'analysing' | 'outdated' | 'partial' | 'error';

const SCENARIOS: Array<{ key: Scenario; label: string }> = [
    { key: 'populated', label: 'Completed analysis' },
    { key: 'switcher', label: 'Many transferable / unresolved' },
    { key: 'thin', label: 'Low confidence (thin résumé)' },
    { key: 'blocked', label: 'Hard requirement not met' },
    { key: 'outdated', label: 'Outdated analysis' },
    { key: 'partial', label: 'Partial result' },
    { key: 'firstuse', label: 'First use (no analysis yet)' },
    { key: 'missing', label: 'Missing job description' },
    { key: 'analysing', label: 'Analysing' },
    { key: 'error', label: 'Error state' },
];

function installStub(scenario: Scenario) {
    const base = (fixture as any).populated;
    const pick: Record<string, any> = {
        populated: (fixture as any).populated,
        switcher: (fixture as any).switcher,
        thin: (fixture as any).thin,
        blocked: (fixture as any).blocked,
        outdated: { ...base, outdated: true, outdatedReasons: ['Your résumé has changed since this analysis ran.', 'Your Profile Intelligence data has changed since this analysis ran.'] },
        partial: {
            ...base,
            analysis: { ...base.analysis, status: 'partial', failedStages: ['assess_requirements', 'verify_official_posting'] },
        },
    };
    const report = pick[scenario] ?? null;

    const status = {
        available: true,
        hasResume: scenario !== 'missing',
        hasJobDescription: scenario !== 'missing',
        hasAnalysis: !!report,
        analysing: scenario === 'analysing',
        stage: scenario === 'analysing' ? 'finding_profile_evidence' : null,
        outdated: scenario === 'outdated',
        outdatedReasons: scenario === 'outdated' ? ['Your résumé has changed since this analysis ran.'] : [],
        resumeName: "Jordan Reyes's résumé",
        jdTitle: 'Senior Backend Engineer',
        jdCompany: 'Acme Robotics',
    };

    (window as any).electronAPI = {
        roleInsightGetStatus: async () => status,
        roleInsightGetReport: async () => ({ success: true, report }),
        roleInsightListHistory: async () => ({ success: true, history: [] }),
        roleInsightAnalyse: async () => (
            scenario === 'error'
                ? { success: false, error: 'The analysis model did not respond. Your sources are unchanged.', diagnosticId: '7f3a91c2' }
                : { success: true, report: base }
        ),
        roleInsightCancel: async () => ({ success: true }),
        roleInsightApplyCorrection: async () => ({ success: true, report }),
        roleInsightAnswerClarification: async () => ({ success: true, report }),
        roleInsightSaveToProfile: async () => ({ success: true }),
        roleInsightPasteJd: async () => ({ success: true }),
        roleInsightImportJdUrl: async () => ({ success: false, error: 'That page could not be read. Paste the job description text instead.' }),
        onRoleInsightProgress: () => () => {},
        openExternal: () => {},
    };
}

const Harness: React.FC = () => {
    const [scenario, setScenario] = useState<Scenario>(
        (new URLSearchParams(location.search).get('s') as Scenario) || 'populated',
    );
    const [theme, setTheme] = useState<'dark' | 'light'>(
        (new URLSearchParams(location.search).get('t') as 'dark' | 'light') || 'dark',
    );
    const [width, setWidth] = useState<number>(
        Number(new URLSearchParams(location.search).get('w')) || 760,
    );

    installStub(scenario);
    React.useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        document.body.style.background = theme === 'dark' ? '#0a0a0a' : '#e9e9ec';
    }, [theme]);

    // Remount on every switch so the panel re-reads the stubbed API from scratch.
    const key = `${scenario}-${theme}-${width}`;

    return (
        <div style={{ minHeight: '100vh', padding: 20, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
            <div id="harness-controls" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
                <select value={scenario} onChange={e => setScenario(e.target.value as Scenario)} style={{ padding: 5, fontSize: 12 }}>
                    {SCENARIOS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
                <select value={theme} onChange={e => setTheme(e.target.value as any)} style={{ padding: 5, fontSize: 12 }}>
                    <option value="dark">Dark</option><option value="light">Light</option>
                </select>
                <select value={width} onChange={e => setWidth(Number(e.target.value))} style={{ padding: 5, fontSize: 12 }}>
                    <option value={980}>980px (wide desktop)</option>
                    <option value={760}>760px (panel default)</option>
                    <option value={620}>620px (narrow)</option>
                    <option value={460}>460px (tablet)</option>
                </select>
            </div>

            {/* Mirrors ProfileIntelligenceSettings' panel container exactly:
                .pi-root supplies the tokens, and the panel body is the scrolling
                right-hand column at 32px horizontal padding. */}
            <div
                className="pi-root"
                data-theme={theme}
                style={{
                    width, maxWidth: '100%', margin: '0 auto',
                    background: 'var(--pi-bg)',
                    border: '1px solid var(--pi-border)',
                    borderRadius: 12, overflow: 'hidden',
                }}
            >
                <div className="pi-panel-header">
                    <h2 className="pi-panel-header-title">Role Insight</h2>
                </div>
                <div style={{ padding: '20px 32px 32px' }}>
                    <RoleInsightPanel
                        key={key}
                        hasAccess
                        onNeedUpgrade={() => {}}
                        onGoToProfile={() => {}}
                        onGoToTavily={() => {}}
                    />
                </div>
            </div>
        </div>
    );
};

// StrictMode mirrors src/main.tsx. Without it the harness cannot reproduce
// mount→cleanup→remount, which is exactly how the panel got stuck on its
// skeleton in the real app while looking healthy here.
createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <Harness />
    </React.StrictMode>,
);
