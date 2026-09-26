// scripts/role-insight-harness/modes.tsx
//
// Renders the REAL Modes Manager with a stubbed electronAPI.
//
// Role Insight has to sit alongside BOTH premium surfaces, and Modes Manager is
// the denser of the two — it is the closest existing analogue to a workspace
// with a list, a detail pane and per-item controls.

import React from 'react';
import { createRoot } from 'react-dom/client';
import ModesSettings from '../../premium/src/ModesSettings';

const MODES = [
    { id: 'm1', name: 'Interview', templateType: 'interview', isActive: true, isCustom: false, description: 'Live interview support', referenceFileCount: 2 },
    { id: 'm2', name: 'Looking for work', templateType: 'job_search', isActive: false, isCustom: false, description: 'Job-search context', referenceFileCount: 0 },
    { id: 'm3', name: 'Technical Interview', templateType: 'technical', isActive: false, isCustom: false, description: 'Systems and coding rounds', referenceFileCount: 1 },
    { id: 'm4', name: 'Client Discovery', templateType: 'general', isActive: false, isCustom: true, description: 'Custom discovery mode', referenceFileCount: 3 },
];

const FILES = [
    { id: 'f1', modeId: 'm1', fileName: 'acme-jd.pdf', indexStatus: 'ready', sizeBytes: 84213, uploadedAt: new Date().toISOString() },
    { id: 'f2', modeId: 'm1', fileName: 'interview-loop-notes.docx', indexStatus: 'ready', sizeBytes: 22140, uploadedAt: new Date().toISOString() },
];

(window as any).electronAPI = {
    modesGetAll: async () => MODES,
    modesGetReferenceFiles: async (modeId: string) => FILES.filter(f => f.modeId === modeId),
    modesGetReferenceFileStatus: async () => ({}),
    modesGetNoteSections: async () => ([
        { id: 'n1', title: 'Company context', description: 'What the company does and why it matters', position: 0 },
        { id: 'n2', title: 'Role expectations', description: 'What this specific role is accountable for', position: 1 },
    ]),
    modesGetSourceContract: async () => ({
        owner: 'mixed', allowedExplicitSwitches: ['reference_files', 'profile', 'job_description'],
    }),
    modesBuildUserSourceContract: async () => ({ success: true }),
    modesSetActive: async () => ({ success: true }),
    modesCreate: async () => ({ success: true }),
    modesUpdate: async () => ({ success: true }),
    modesDelete: async () => ({ success: true }),
    answerPolicyGet: async () => ({ policy: 'use_references_when_relevant' }),
    answerPolicySet: async () => ({ success: true }),
    getIntelligenceFlags: async () => ({}),
    knowledgeGetPack: async () => null,
    onModeFileIndexStatus: () => () => {},
    onModesActiveCleared: () => () => {},
    openExternal: () => {},
    onThemeChanged: () => () => {},
};

const Harness: React.FC = () => {
    const theme = (new URLSearchParams(location.search).get('t') as 'dark' | 'light') || 'dark';
    React.useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);
    return <ModesSettings onClose={() => {}} isPremium isLoaded />;
};

createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <Harness />
    </React.StrictMode>,
);
