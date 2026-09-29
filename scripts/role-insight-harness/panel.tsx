// scripts/role-insight-harness/panel.tsx
//
// Mounts the REAL `ProfileIntelligenceSettings` with a stubbed `electronAPI`,
// so every section — Identity, Profile, Role Insight, Company Intel, Cover
// Letter, Tavily — renders in its true container, with the real nav, the real
// sliding indicator, and the real `PI_CSS`.
//
// This exists because Role Insight cannot be judged in isolation: the question
// is whether it looks like it belongs *next to* those screens. Reading their
// source is not the same as seeing them.

import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProfileIntelligenceSettings } from '../../src/components/ProfileIntelligenceSettings';
import fixture from '../.role-insight-fixture.json';

const PROFILE = {
    identity: {
        name: 'Jordan Reyes',
        email: 'jordan@example.com',
        location: 'Austin, TX',
        summary: 'Backend engineer focused on real-time systems and streaming infrastructure. Six years building services that stay up under load, most recently WebRTC-based video relay for remote robotics operators.',
    },
    experienceCount: 2,
    experience: [
        {
            company: 'Aetherlab', role: 'Senior Software Engineer',
            start_date: '2022-03', end_date: null,
            bullets: [
                'Built and deployed a WebRTC-based Unreal Pixel Streaming architecture using AWS EC2 and STUN/TURN infrastructure',
                'Designed the PostgreSQL schema and query layer backing the session service',
                'Set up CI pipelines in GitHub Actions covering build, test and staged release',
            ],
        },
        {
            company: 'Northwind Data', role: 'Software Engineer',
            start_date: '2019-06', end_date: '2022-02',
            bullets: [
                'Maintained Python data services and their Docker-based deployment',
                'Mentored two junior engineers through their first six months',
            ],
        },
    ],
    education: [{ institution: 'UT Austin', degree: 'Bachelor of Science', field: 'Computer Science', start_date: '2015-08', end_date: '2019-05' }],
    projects: [{ name: 'Streamline', description: 'Low-latency video relay for remote robotics operators', technologies: ['WebRTC', 'Go', 'AWS'] }],
    skills: {
        languages: ['TypeScript', 'Python', 'SQL'],
        frameworks: ['Node.js', 'FastAPI'],
        cloud: ['AWS'],
        databases: ['PostgreSQL', 'Redis'],
        devops: ['Docker', 'GitHub Actions'],
        tools: ['Git', 'Datadog'],
    },
    skillsFlat: ['TypeScript', 'Python', 'SQL', 'Node.js', 'FastAPI', 'AWS', 'PostgreSQL', 'Redis', 'Docker', 'GitHub Actions', 'Git', 'Datadog'],
    hasActiveJD: true,
    jd: { title: 'Senior Backend Engineer', company: 'Acme Robotics' },
    coverLetter: null,
    companyDossier: null,
};

function installStub(scenario: string) {
    const report = (fixture as any)[scenario] ?? (fixture as any).populated;
    (window as any).electronAPI = {
        licenseGetDetails: async () => ({ isPremium: true, plan: 'pro' }),
        licenseCheckPremium: async () => true,
        profileGetStatus: async () => ({
            hasProfile: true, profileMode: true, name: 'Jordan Reyes',
            role: 'Senior Software Engineer', totalExperienceYears: 6,
            profileFactsReady: true, extractionMode: 'llm',
        }),
        profileGetProfile: async () => PROFILE,
        profileGetCompanyDossier: async () => null,
        getStoredCredentials: async () => ({ hasTavilyKey: true }),
        profileSetMode: async () => ({ success: true }),
        openExternal: () => {},
        onThemeChanged: () => () => {},

        roleInsightGetStatus: async () => ({
            available: true, hasResume: true, hasJobDescription: true,
            hasAnalysis: true, analysing: false, stage: null,
            outdated: false, outdatedReasons: [],
            resumeName: "Jordan Reyes's résumé",
            jdTitle: 'Senior Backend Engineer', jdCompany: 'Acme Robotics',
        }),
        roleInsightGetReport: async () => ({ success: true, report }),
        roleInsightListHistory: async () => ({ success: true, history: [] }),
        roleInsightAnalyse: async () => ({ success: true, report }),
        roleInsightCancel: async () => ({ success: true }),
        roleInsightApplyCorrection: async () => ({ success: true, report }),
        roleInsightAnswerClarification: async () => ({ success: true, report }),
        roleInsightSaveToProfile: async () => ({ success: true }),
        roleInsightPasteJd: async () => ({ success: true }),
        roleInsightImportJdUrl: async () => ({ success: true }),
        onRoleInsightProgress: () => () => {},
    };
}

const Harness: React.FC = () => {
    const q = new URLSearchParams(location.search);
    const [theme] = useState<'dark' | 'light'>((q.get('t') as any) || 'dark');
    installStub(q.get('s') || 'populated');

    React.useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
    }, [theme]);

    return <ProfileIntelligenceSettings onClose={() => {}} />;
};

// StrictMode mirrors src/main.tsx. Without it the harness cannot reproduce
// mount→cleanup→remount, which is exactly how the panel got stuck on its
// skeleton in the real app while looking healthy here.
createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <Harness />
    </React.StrictMode>,
);
