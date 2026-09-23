import React, { useEffect, useRef } from 'react';
import { useT } from '../i18n';
import { Github, Twitter, Linkedin, Instagram, Globe, Send, ExternalLink } from 'lucide-react';
import evinProfile from '../assets/evin.png';
import nativelyIcon from './icon.png';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { APP_FEATURE_VERSION } from '../utils/appVersion';
import { AIP_CSS, AipBadge } from './settings/AIProvidersSettings';
import { LiquidGlassBadge } from '../ui-components/LiquidGlassBadge';

// Built from the AI Providers panel's `.aip-*` system (the same one Retrieval
// adopts), so About reads as part of Settings rather than its own UI: aip-card
// surfaces, rows split by --aip-divider hairlines, neutral 1.75-stroke icons,
// and colour only where something carries a state.

const WHATS_NEW: { title: string; body: string; badge?: string }[] = [
    { title: 'Direct Assist', body: 'Sends your last three minutes and reference files verbatim. Turn it on in AI Providers.', badge: 'Off by default' },
    { title: 'Rerankers', body: 'Jina AI, OpenRouter, or a local model. In Retrieval.' },
    { title: 'Lighter and faster', body: 'About a quarter less memory. Windows open faster.' },
    { title: 'Provider failover', body: 'OpenAI, Claude, DeepSeek, LiteLLM, NVIDIA NIM and custom endpoints switch to a spare when stalled. Local models are untouched.' },
    { title: 'Embedding models', body: 'Gemini, OpenAI, Voyage AI, OpenRouter, Ollama, or any OpenAI-compatible endpoint. In Retrieval.' },
];

const HOW_IT_WORKS = [
    { title: 'Stateful Intelligence OS', body: 'Acts as a persistent control plane using mode-aware priors (Sales, Technical, Lecture) to dynamically filter context and direct queries to the optimal reasoning engine.' },
    { title: 'Hindsight LTM & Session Memory', body: 'Combines a secure local sidecar vector database for document indexing with a time-decayed sliding transcript memory to retrieve relevant semantic context on-demand.' },
];

const REPO_URL = 'https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant';
const DONATE_URL = 'https://buymeacoffee.com/evinjohnn';

const NATIVELY_LINKS = [
    { label: 'Website', url: 'https://natively.software', Icon: Globe },
    { label: 'Telegram', url: 'https://t.me/nativelyaichat', Icon: Send },
    { label: 'LinkedIn', url: 'https://www.linkedin.com/company/nativley-ai', Icon: Linkedin },
];

const CREATOR_LINKS = [
    { label: 'GitHub', url: REPO_URL, Icon: Github },
    { label: 'X', url: 'https://x.com/evinjohnn', Icon: Twitter },
    { label: 'LinkedIn', url: 'https://www.linkedin.com/in/evinjohn', Icon: Linkedin },
    { label: 'Instagram', url: 'https://www.instagram.com/evinjohnn/', Icon: Instagram },
];

// One row of a divided aip-card: title over a meta line, optional trailing
// control. Every row after the first carries the hairline.
const AboutRow: React.FC<{ title: string; body: string; first: boolean; children?: React.ReactNode }> = ({ title, body, first, children }) => (
    <div
        className={`flex items-center justify-between gap-3 ${first ? '' : 'pt-3 border-t'}`}
        style={first ? undefined : { borderColor: 'var(--aip-divider)' }}
    >
        <div className="flex flex-col min-w-0">
            <span className="text-xs aip-hero font-semibold">{title}</span>
            <span className="aip-meta leading-snug mt-0.5">{body}</span>
        </div>
        {children}
    </div>
);

const SectionHeading: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => (
    <div>
        <h3 className="text-sm font-bold aip-hero mb-1">{title}</h3>
        <p className="text-xs aip-muted mb-2">{subtitle}</p>
    </div>
);

interface AboutSectionProps { }

export const AboutSection: React.FC<AboutSectionProps> = () => {
    const t = useT();
    const theme = useResolvedTheme();
    const donationClickTimeRef = useRef<number | null>(null);
    const appVersion = import.meta.env.VITE_APP_VERSION || 'unknown';
    const buildCommit = import.meta.env.VITE_BUILD_COMMIT || 'unknown';

    useEffect(() => {
        const handleFocus = async () => {
            if (donationClickTimeRef.current) {
                const elapsed = Date.now() - donationClickTimeRef.current;
                if (elapsed > 20000) { // 20 seconds
                    console.log("User returned after >20s. Marking as donated.");
                    await window.electronAPI?.setDonationComplete();
                    donationClickTimeRef.current = null; // Reset
                } else {
                    console.log("User returned too quickly (<20s). Not confirming donation.");
                    donationClickTimeRef.current = null;
                }
            }
        };

        window.addEventListener('focus', handleFocus);
        return () => window.removeEventListener('focus', handleFocus);
    }, []);

    const openLink = (url: string) => {
        // Returning >20s after opening the donation page marks it complete (above).
        if (url === DONATE_URL) {
            donationClickTimeRef.current = Date.now();
        }

        if (window.electronAPI?.openExternal) {
            window.electronAPI.openExternal(url);
        } else {
            window.open(url, '_blank');
        }
    };

    const iconLinks = (links: typeof NATIVELY_LINKS) => (
        <div className="flex items-center gap-0.5 shrink-0">
            {links.map(({ label, url, Icon }) => (
                <button
                    key={url}
                    onClick={() => openLink(url)}
                    className="aip-btn"
                    data-icon="true"
                    data-variant="ghost"
                    title={label}
                    aria-label={label}
                >
                    <Icon size={14} strokeWidth={1.75} />
                </button>
            ))}
        </div>
    );

    const linkButton = (label: string, url: string, accent = false) => (
        <button
            onClick={() => openLink(url)}
            className="aip-btn shrink-0"
            data-size="sm"
            data-variant={accent ? 'accent' : 'ghost'}
        >
            <span className={accent ? undefined : 'uppercase tracking-wide'}>{label}</span>
            <ExternalLink size={12} strokeWidth={1.75} />
        </button>
    );

    const community = [
        { title: t('Star on GitHub'), body: t('Love Natively? Support us by starring the repo.'), action: linkButton(t('Star'), REPO_URL) },
        { title: t('Report an Issue'), body: t('Found a bug? Let us know so we can fix it.'), action: linkButton(t('Report'), `${REPO_URL}/issues`) },
        { title: t('Get in Touch'), body: t('Open for professional collaborations and job offers.'), action: linkButton(t('Email'), 'mailto:evinjohnignatious@gmail.com') },
        { title: t('Support Development'), body: t('Natively is independent source-available software.'), action: linkButton(t('Support Project'), DONATE_URL, true) },
    ];

    return (
        <div className="aip-root space-y-5 pb-10" data-theme={theme} data-settings-stagger>
            <header>
                <h3 className="aip-title mb-1">{t('About Natively')}</h3>
                <p className="aip-subtitle mb-2">{t('Designed to be invisible, intelligent, and trusted.')}</p>
            </header>

            {/* Identity: the app's mark, the running build, and its official channels. */}
            <div className="aip-card p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <span className="aip-tile aip-tile--mark">
                        <img
                            src={nativelyIcon}
                            alt=""
                            className="w-4 h-4 object-contain"
                            style={{ filter: theme === 'light' ? 'brightness(0)' : 'brightness(0) invert(1)' }}
                            draggable={false}
                        />
                    </span>
                    <div className="min-w-0">
                        <h4 className="aip-card-title">Natively</h4>
                        <p className="aip-meta tabular-nums truncate">{`Version ${appVersion} · Build ${buildCommit}`}</p>
                    </div>
                </div>
                {iconLinks(NATIVELY_LINKS)}
            </div>

            <div className="space-y-5">
                <SectionHeading title={`${t("What's New in")} v${APP_FEATURE_VERSION}`} subtitle={t('The changes you can see in this release.')} />
                <div className="aip-card p-5 flex flex-col gap-3">
                    {WHATS_NEW.map(({ title, body, badge }, i) => (
                        <AboutRow key={title} title={title} body={body} first={i === 0}>
                            {badge && <AipBadge tone="neutral" label={t(badge)} className="shrink-0" />}
                        </AboutRow>
                    ))}
                </div>
            </div>

            <div className="space-y-5">
                <SectionHeading title={t('How Natively Works')} subtitle={t('What runs underneath every answer.')} />
                <div className="aip-card p-5 flex flex-col gap-3">
                    {HOW_IT_WORKS.map(({ title, body }, i) => (
                        <AboutRow key={title} title={title} body={body} first={i === 0} />
                    ))}
                </div>
            </div>

            <div className="space-y-5">
                <SectionHeading title={t('Privacy & Data')} subtitle={t('You control exactly what leaves your device.')} />
                <div className="aip-card p-5 flex flex-col gap-3">
                    <AboutRow
                        first
                        title={t('Stealth & Control')}
                        body={'"Undetectable Mode" hides Natively from the dock, and "Masquerading" disguises it as a system app.'}
                    />
                    <AboutRow
                        first={false}
                        title={t('No Recording')}
                        body="Natively listens only when active. It does not record video, take arbitrary screenshots without command, or perform background surveillance."
                    />
                </div>
            </div>

            <div className="space-y-5">
                <SectionHeading title={t('Community')} subtitle={t('Follow along, report a bug, or support the project.')} />
                <div className="space-y-3">
                    <div className="aip-card p-4 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                            <img
                                src={evinProfile}
                                alt=""
                                className="w-[26px] h-[26px] rounded-full object-cover shrink-0"
                                draggable={false}
                            />
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <h4 className="aip-card-title">Evin John</h4>
                                    <LiquidGlassBadge>{t('Creator')}</LiquidGlassBadge>
                                </div>
                                <p className="aip-meta truncate">I build software that stays out of the way.</p>
                            </div>
                        </div>
                        {iconLinks(CREATOR_LINKS)}
                    </div>

                    <div className="aip-card p-5 flex flex-col gap-3">
                        {community.map(({ title, body, action }, i) => (
                            <AboutRow key={title} title={title} body={body} first={i === 0}>
                                {action}
                            </AboutRow>
                        ))}
                    </div>
                </div>
            </div>

            {/* Last child: first, it would pick up the space-y margin. */}
            <style>{AIP_CSS}</style>
        </div>
    );
};
