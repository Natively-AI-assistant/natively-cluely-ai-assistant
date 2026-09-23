import React, { useEffect, useRef } from 'react';
import { useT } from '../i18n';
import {
    Github, Twitter, Linkedin, Instagram, Globe, Send, Star, Bug, Mail, Heart,
    AudioLines, Sparkles, Layers, Search, Cpu, FileText,
    HardDrive, SlidersHorizontal, KeyRound, EyeOff, Camera,
} from 'lucide-react';
import evinProfile from '../assets/evin.png';
import nativelyIcon from './icon.png';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { APP_FEATURE_VERSION } from '../utils/appVersion';
import { AIP_CSS, AipBadge } from './settings/AIProvidersSettings';
import { LiquidGlassButton } from '../ui-components/LiquidGlassButton';

// Built from the AI Providers panel's `.aip-*` system (the same one Retrieval
// adopts), so About reads as part of Settings rather than its own UI: aip-card
// surfaces, rows split by --aip-divider hairlines, and colour only where
// something carries a state.

const WHATS_NEW: { title: string; body: string; badge?: string }[] = [
    { title: 'Direct Assist', body: 'Sends your last three minutes and reference files verbatim. Turn it on in AI Providers.', badge: 'Off by default' },
    { title: 'Rerankers', body: 'Jina AI, OpenRouter, or a local model. In Retrieval.' },
    { title: 'Lighter and faster', body: 'About a quarter less memory. Windows open faster.' },
    { title: 'Provider failover', body: 'OpenAI, Claude, DeepSeek, LiteLLM, NVIDIA NIM and custom endpoints switch to a spare when stalled. Local models are untouched.' },
    { title: 'Embedding models', body: 'Gemini, OpenAI, Voyage AI, OpenRouter, Ollama, or any OpenAI-compatible endpoint. In Retrieval.' },
];

// Checked against the code on 2026-09-23 (the earlier copy described the app's
// first week). Keep claims to what the app does by default on both platforms.
const HOW_IT_WORKS = [
    { Icon: AudioLines, title: 'Hears both sides', body: 'Captures your mic and system audio and transcribes it with the speech provider you choose, including on-device ones.' },
    { Icon: Sparkles, title: 'Answers from context', body: "Each answer draws on the conversation, your mode's files, your profile, and any screenshot you take." },
    { Icon: Layers, title: 'Modes', body: 'Start from templates like Sales, Recruiting or Technical Interview, then add your own context and files.' },
    { Icon: Search, title: 'Searches files and meetings', body: 'Indexed in a local database, using a built-in on-device model or a cloud one you pick.' },
    { Icon: Cpu, title: 'Your choice of AI', body: "Gemini, OpenAI, Claude, Groq, OpenRouter and more, or local models through Ollama. A stalled provider fails over to your spare." },
    { Icon: FileText, title: 'Notes after every meeting', body: 'Structured notes, plus open questions that came up in recent meetings.' },
];

const PRIVACY = [
    { Icon: HardDrive, title: 'Stored on your device', body: 'Meetings, transcripts, notes and documents live in a local database. Audio is transcribed as it streams and never saved.' },
    { Icon: SlidersHorizontal, title: 'You decide what is sent', body: 'Audio goes only to your speech provider; text and screenshots only to your AI provider. Each can be switched off per provider, and local models keep everything on your computer.' },
    { Icon: KeyRound, title: 'Keys are encrypted', body: "API keys are encrypted with your operating system's secure storage." },
    { Icon: EyeOff, title: 'Undetectable Mode', body: 'Hides Natively from screen shares and recordings, and from the Dock on macOS or the taskbar and tray on Windows. Disguise renames it as a system app.' },
    { Icon: Camera, title: 'Screenshots only on command', body: 'Taken only from your hotkey, a button, or your phone shutter.' },
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
const AboutRow: React.FC<{ title: string; body: string; first: boolean; icon?: React.ReactNode; children?: React.ReactNode }> = ({ title, body, first, icon, children }) => (
    <div
        className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-2 ${first ? '' : 'pt-3 border-t'}`}
        style={first ? undefined : { borderColor: 'var(--aip-divider)' }}
    >
        {icon && <span className="aip-muted shrink-0 self-start mt-[1px]">{icon}</span>}
        <div className="flex flex-col flex-1 min-w-[160px]">
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
        <div className="flex items-center gap-4 shrink-0">
            {links.map(({ label, url, Icon }) => (
                <button
                    key={url}
                    onClick={() => openLink(url)}
                    className="text-text-tertiary hover:text-text-primary transition-colors"
                    title={label}
                    aria-label={label}
                >
                    <Icon size={18} />
                </button>
            ))}
        </div>
    );

    // Liquid Glass at UI scale. `clear` is the variant made for a flat panel in
    // both themes: the card shows through and only the rim is added. Its label
    // is `color: inherit` (and outranks a utility on the button itself), so the
    // colour has to come from a parent.
    // Hover: the glyph takes its own hue and fills in with a small spring pop.
    // The overshoot curve drives the scale ONLY; on colour it overshoots the hue
    // and visibly settles to a dimmer one, so colour and fill ease out plainly.
    // Leaving is a fast ease-out so it never lags the pointer. The fill is
    // fill-opacity on currentColor because `fill: none` cannot interpolate.
    // Line-art glyphs (bug, mail) only wash in, since a solid fill erases their
    // inner strokes. Reduced motion keeps the colour and drops the pop.
    const actionButton = (label: string, url: string, Icon: typeof Star, hue: string, solid = true) => (
        <span className="shrink-0 text-text-primary">
            <LiquidGlassButton
                variant="clear"
                className="lg-sm group [&_.lg-content]:text-text-primary"
                icon={
                    <Icon
                        size={14}
                        strokeWidth={1.75}
                        className={`fill-current [fill-opacity:0] [transition:transform_150ms_cubic-bezier(0.23,1,0.32,1),color_150ms_cubic-bezier(0.23,1,0.32,1),fill-opacity_150ms_cubic-bezier(0.23,1,0.32,1)] group-hover:[transition:transform_280ms_cubic-bezier(0.34,1.56,0.64,1),color_200ms_cubic-bezier(0.23,1,0.32,1),fill-opacity_200ms_cubic-bezier(0.23,1,0.32,1)] group-hover:scale-[1.12] motion-reduce:group-hover:scale-100 ${hue} ${solid ? 'group-hover:[fill-opacity:1]' : 'group-hover:[fill-opacity:0.28]'}`}
                    />
                }
                onClick={() => openLink(url)}
            >
                {label}
            </LiquidGlassButton>
        </span>
    );

    const community = [
        { title: t('Star on GitHub'), body: t('Love Natively? Support us by starring the repo.'), action: actionButton(t('Star'), REPO_URL, Star, 'group-hover:text-[#E3B341]') },
        { title: t('Report an Issue'), body: t('Found a bug? Let us know so we can fix it.'), action: actionButton(t('Report'), `${REPO_URL}/issues`, Bug, 'group-hover:text-red-500', false) },
        { title: t('Get in Touch'), body: t('Open for professional collaborations and job offers.'), action: actionButton(t('Contact Me'), 'mailto:evinjohnignatious@gmail.com', Mail, 'group-hover:text-accent-primary', false) },
        { title: t('Support Development'), body: t('Natively is independent source-available software.'), action: actionButton(t('Support Project'), DONATE_URL, Heart, 'group-hover:text-pink-500') },
    ];

    return (
        <div className="aip-root space-y-5 pb-10" data-theme={theme} data-settings-stagger>
            <header>
                <h3 className="aip-title mb-1">{t('About Natively')}</h3>
                <p className="aip-subtitle mb-2">{t('Designed to be invisible, intelligent, and trusted.')}</p>
            </header>

            {/* Identity: the app's mark, the running build, and its official channels. */}
            <div className="aip-card p-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <div className="flex items-center gap-3 flex-1 min-w-[180px]">
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
                <SectionHeading title={t('How Natively Works')} subtitle={t('What happens between the conversation and the answer.')} />
                {/* One surface split by hairlines: the grid gap shows the divider
                    colour behind cells painted in the card's own fill. */}
                <div className="aip-card overflow-hidden">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-px" style={{ background: 'var(--aip-divider)' }}>
                        {HOW_IT_WORKS.map(({ Icon, title, body }) => (
                            <div key={title} className="bg-bg-item-surface p-4">
                                <div className="flex items-center gap-2 mb-1">
                                    <Icon size={14} strokeWidth={1.75} className="aip-muted shrink-0" />
                                    <span className="text-xs aip-hero font-semibold">{t(title)}</span>
                                </div>
                                <p className="aip-meta leading-snug">{t(body)}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="space-y-5">
                <SectionHeading title={t('Privacy & Data')} subtitle={t('What stays on your computer, and what you choose to send.')} />
                <div className="aip-card p-5 flex flex-col gap-3">
                    {PRIVACY.map(({ Icon, title, body }, i) => (
                        <AboutRow
                            key={title}
                            first={i === 0}
                            title={t(title)}
                            body={t(body)}
                            icon={<Icon size={14} strokeWidth={1.75} />}
                        />
                    ))}
                </div>
            </div>

            <div className="space-y-5">
                <SectionHeading title={t('Community')} subtitle={t('Follow along, report a bug, or support the project.')} />
                <div className="space-y-3">
                    <div className="aip-card p-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                        <div className="flex items-center gap-3 flex-1 min-w-[180px]">
                            <img
                                src={evinProfile}
                                alt=""
                                className="w-[26px] h-[26px] rounded-full object-cover shrink-0"
                                draggable={false}
                            />
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <h4 className="aip-card-title">Evin John</h4>
                                    <span
                                        className="text-[10px] font-medium leading-none px-1.5 py-[3px] rounded-full border"
                                        style={{ color: 'var(--aip-accent)', background: 'var(--aip-accent-muted)', borderColor: 'var(--aip-accent-border)' }}
                                    >
                                        {t('Creator')}
                                    </span>
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
