import React, { useEffect, useRef } from 'react';
import { useT } from '../i18n';
import {
    Github, Twitter, Linkedin, Instagram, Send, Star, Bug, Mail, Heart,
    CalendarCheck, Palette, Smartphone, ListOrdered,
    LayoutGrid, Search, FileText, UserRound,
    HardDrive, Sliders, Lock,
} from 'lucide-react';
import { AutoAnswerIcon } from './AutoAnswerIcon';
import evinProfile from '../assets/evin.png';
// Each platform's own app icon: the Liquid Glass render macOS shows in the Dock
// (assets/icons/mac/dock-icon.png) and the Windows icon (assets/icons/png), at
// 192px for an 80px header.
import appIconMac from '../assets/about/app-icon-mac.webp';
import appIconWin from '../assets/about/app-icon-win.webp';
import { isMac } from '../utils/platformUtils';
import { APP_FEATURE_VERSION } from '../utils/appVersion';
import { LiquidGlassButton } from '../ui-components/LiquidGlassButton';
import { LiquidGlassBadge } from '../ui-components/LiquidGlassBadge';
import { SettingsRow, SettingsSectionHeading } from './settings/SettingsRow';

// Built from the AI Providers panel's `.aip-*` system (the same one Retrieval
// adopts), so About reads as part of Settings rather than its own UI: aip-card
// surfaces, rows split by --aip-divider hairlines, and colour only where
// something carries a state.

// ABOUT_CSS is About's own layer OVER that system — three additions, no
// overrides, so AI Providers / Retrieval / Embedding (which all share AIP_CSS)
// cannot be reached from here. Kept in its own literal and concatenated at the
// single trailing <style>, because AIP_CSS is exported and shared.
//
// Container queries rather than Tailwind's `md:` / `lg:`: Settings is a
// `w-full max-w-4xl` modal with a `w-64` (256px) sidebar and `p-8` on the
// panel, so this column CAPS at ~576px and shrinks with the window — measured
// at 574px on a maximised window. A viewport breakpoint knows none of that:
// `md:` and `lg:` both fire off the window, which is how the pipeline grid
// came to render three ~190px columns inside 574px. `@container` measures the
// column itself, so it also handles the narrow-window case the viewport
// version got backwards. Written raw because tailwind.config.js has
// `plugins: []` — no container-queries plugin.
//
// (No backticks in this CSS: ABOUT_CSS is a template literal, as AIP_CSS is.)
type AboutIcon = React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;

interface AboutItem { title: string; body: string; badge?: string; Icon: AboutIcon }

// 2.9 official build, the owner's picks from the last 30 days of commits:
// Auto Answer (off by default and "Beta" in General; the judge skips asks
// named to someone else, 2cf229bd), embeddings + rerankers, Phone Mirror 2.0
// (nav label "Sync"), Calendar sync (calendarSessionMatch + follow-up draft),
// and the month's UI pass (Liquid Glass controls, the motion passes across
// Settings, overlay, meeting notes and cards). Undetectable is
// deliberately not claimed here: the owner won't promise it. Nothing here
// needs the Companion extension.
const WHATS_NEW: AboutItem[] = [
    { title: 'Auto Answer', body: 'Answers when a question ends, and skips ones meant for others. In General.', badge: 'Beta', Icon: AutoAnswerIcon },
    { title: 'Embeddings and rerankers', body: 'Gemini, OpenAI, Voyage AI, Jina AI or local models. In Retrieval.', Icon: ListOrdered },
    { title: 'Phone Mirror 2.0', body: 'Live transcript, streaming answers and photos from your phone. In Sync.', Icon: Smartphone },
    { title: 'Calendar sync', body: 'Meetings link to their event, with names and a follow-up email. In Calendar.', Icon: CalendarCheck },
    { title: 'Better UI and animations', body: 'Liquid Glass controls, and smoother motion in every window.', Icon: Palette },
];

// Compressed 2026-09-25 at the owner's request; every claim still checked
// against the code. Six capabilities, deliberately not numbered — they are not
// a pipeline ("Modes" is not step three of anything).
const HOW_IT_WORKS: AboutItem[] = [
    { title: 'Modes', body: 'Templates like Sales or Interview, plus your own.', Icon: LayoutGrid },
    { title: 'Profile Intelligence', body: 'Resume, job description and company intel.', Icon: UserRound },
    { title: 'Searches files and meetings', body: 'Indexed locally, on-device or cloud.', Icon: Search },
    { title: 'Notes after every meeting', body: 'Structured notes and open questions.', Icon: FileText },
];

const PRIVACY: AboutItem[] = [
    { title: 'Stored on your device', body: 'Local database. Audio is never saved.', Icon: HardDrive },
    { title: 'You decide what is sent', body: 'Audio to speech, text to AI. Local sends nothing.', Icon: Sliders },
    { title: 'Keys are encrypted', body: "In your OS secure storage.", Icon: Lock },
];

const REPO_URL = 'https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant';
const DONATE_URL = 'https://buymeacoffee.com/evinjohnn';

const CREATOR_LINKS = [
    { label: 'GitHub', url: REPO_URL, Icon: Github },
    { label: 'X', url: 'https://x.com/evinjohnn', Icon: Twitter },
    { label: 'LinkedIn', url: 'https://www.linkedin.com/in/evinjohn', Icon: Linkedin },
    { label: 'Instagram', url: 'https://www.instagram.com/evinjohnn/', Icon: Instagram },
];

// About is built from `./settings/SettingsRow` — the module General, Audio,
// Sync, Intelligence and Provider Performance are built from, whose own header
// says it exists "so a pane that adopts the Settings look takes the same
// measurements rather than a copy of them". About previously used the `aip-*`
// sheet from AI Providers, which is that panel's own dialect at its own scale
// (15px/600 headings, 26px tiles, 11px body) — correct for a dense credential
// panel, wrong for a reading pane sitting next to General in the same nav, and
// the reason About read as a different product.
//
// Every measurement below is therefore imported rather than restated:
//   panel heading   18px/700 + 12px sub   SettingsSectionHeading
//   row             [40px tile][14px/700 title (+badge)][12px description][control]
//   icon glyph      20px, as General, Keybinds, Audio and Intelligence pass it
//   group gap       space-y-6
// Nothing here re-declares a colour, a radius or a size that the module owns.

// Community's action rows carry NO tile. SettingsRow always paints one, and
// here it would show the SAME glyph twice on one line — a Star tile beside a
// "Star" button, a Bug beside "Report" — because the Liquid Glass button
// already leads with that icon and the button is the part that stays. So this
// is SettingsRow's row minus the tile: identical padding (px-4 py-3), identical
// type (14px/700 title over 12px description), identical control rail.
const CommunityActionRow: React.FC<{
    title: string;
    body: string;
    control: React.ReactNode;
}> = ({ title, body, control }) => (
    <div className="border-x border-transparent">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
                <h4 className="text-sm font-bold text-text-primary">{title}</h4>
                <div className="text-xs text-text-secondary mt-0.5">{body}</div>
            </div>
            <div className="shrink-0 flex items-center gap-2">{control}</div>
        </div>
    </div>
);

// General's row container, verbatim. The 1px TRANSPARENT border is load-bearing:
// SettingsRow carries the matching `border-x border-transparent`, and together
// they set the tiles 1px in from the section heading. General also carries
// `divide-y divide-border-subtle/20`, which is dead — Tailwind 3 cannot
// recompute alpha on a bare var() colour, so it emits no CSS and General's rows
// have no dividers at all. Verified against dist/assets/*.css (0 occurrences),
// and deliberately not reproduced: rows here separate by rhythm, as General's do.
const ROW_GROUP = 'rounded-xl border bg-transparent border-transparent';

interface AboutSectionProps { }

export const AboutSection: React.FC<AboutSectionProps> = () => {
    const t = useT();
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

    const iconLinks = (links: typeof CREATOR_LINKS) => (
        <div className="flex items-center gap-4 shrink-0">
            {links.map(({ label, url, Icon }) => (
                <button
                    key={url}
                    onClick={() => openLink(url)}
                    className="group text-text-tertiary hover:text-text-primary transition-colors"
                    title={label}
                    aria-label={label}
                >
                    {/* The Community buttons' glyph pop, so the creator's links
                        answer the pointer the same way: spring in, plain out. */}
                    <Icon
                        size={18}
                        className="[transition:transform_150ms_cubic-bezier(0.23,1,0.32,1)] group-hover:[transition:transform_280ms_cubic-bezier(0.34,1.56,0.64,1)] group-hover:scale-[1.12] motion-reduce:group-hover:scale-100"
                    />
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

    // Ordered by the WIDTH of each row's Liquid Glass button, ascending. The
    // buttons are right-aligned, so rising width steps their left edges
    // leftward down the list — a deliberate staircase instead of the ragged
    // column six arbitrary labels produce. Measured in the running app, not
    // guessed from label length (the icon and padding dominate at this size):
    //   Star 76 · Join 76 · Follow 89 · Report 91 · Contact Me 118 · Support Project 143
    // It doubles as an escalating-commitment ladder — one free click, then
    // follow, then report, then write, then pay — so the order reads as
    // intentional rather than as a sort. Re-measure if a label changes.
    const actions = [
        { title: t('Star on GitHub'), body: t('Love Natively? Support us by starring the repo.'), action: actionButton(t('Star'), REPO_URL, Star, 'group-hover:text-[#E3B341]') },
        { title: t('Telegram'), body: t('Early betas, direct help from the community, and usage tips.'), action: actionButton(t('Join'), 'https://t.me/nativelyaichat', Send, 'group-hover:text-sky-500') },
        { title: t('LinkedIn'), body: t('Follow the climb to the top of AI note-taking assistants.'), action: actionButton(t('Follow'), 'https://www.linkedin.com/company/nativley-ai', Linkedin, 'group-hover:text-sky-600') },
        { title: t('Report an Issue'), body: t('Found a bug? Let us know so we can fix it.'), action: actionButton(t('Report'), `${REPO_URL}/issues`, Bug, 'group-hover:text-red-500', false) },
        { title: t('Get in Touch'), body: t('Open for professional collaborations and job offers.'), action: actionButton(t('Contact Me'), 'mailto:evinjohnignatious@gmail.com', Mail, 'group-hover:text-accent-primary', false) },
        { title: t('Support Development'), body: t('Natively is independent source-available software.'), action: actionButton(t('Support Project'), DONATE_URL, Heart, 'group-hover:text-pink-500') },
    ];

    const shortCommit = buildCommit !== 'unknown' ? buildCommit.slice(0, 7) : null;
    const versionLine = `${t('Version')} ${appVersion}${shortCommit ? ` (${shortCommit})` : ''}`;

    return (
        // General's own shell: space-y-6, and the stagger attribute is the ONLY
        // entrance. General pairs it with "animated fadeIn", which is dead —
        // neither `.animated` nor `.fadeIn` exists in any stylesheet (0 hits in
        // dist/assets/*.css), so copying it would have copied nothing.
        <div className="space-y-6 pb-10" data-settings-stagger>
            {/* The header, as About This Mac draws one: the app's icon, its name,
                and the version. The one element off the row grid — it is the
                page's title, not a section. The build moved up here from the
                footnote under Community, where it sat a screen away from the
                question "which version am I on?". */}
            <header className="flex flex-col items-center text-center pt-1">
                <img
                    src={isMac ? appIconMac : appIconWin}
                    alt=""
                    // The macOS render carries the Dock's own margin and shadow; the
                    // Windows icon is full-bleed, so it is drawn smaller to match.
                    className={isMac ? 'w-[88px] h-[88px]' : 'w-[76px] h-[76px] my-1.5'}
                    draggable={false}
                />
                <h2 className="mt-2 text-[22px] leading-7 font-bold tracking-[-0.02em] text-text-primary">Natively</h2>
                <div className="mt-0.5 text-xs text-text-secondary tabular-nums select-text">{versionLine}</div>
            </header>

            <section>
                <SettingsSectionHeading
                    title={`${t("What's New in")} v${APP_FEATURE_VERSION}`}
                    subtitle={t('The changes you can see in this release.')}
                />
                <div className={ROW_GROUP}>
                    {WHATS_NEW.map(({ title, body, badge, Icon }) => (
                        <SettingsRow
                            key={title}
                            icon={<Icon size={20} />}
                            title={t(title)}
                            /* The app's own tag. `neutral` is its documented default
                               because "a tag qualifies the thing beside it rather than
                               competing with it", and it is the only variant that clears
                               the AA floor at 9.5px type. */
                            badge={badge ? <LiquidGlassBadge variant="neutral">{t(badge)}</LiquidGlassBadge> : undefined}
                            description={t(body)}
                        />
                    ))}
                </div>
            </section>

            <section>
                <SettingsSectionHeading
                    title={t('How Natively Works')}
                    subtitle={t('From the conversation to the answer.')}
                />
                <div className={ROW_GROUP}>
                    {HOW_IT_WORKS.map(({ title, body, Icon }) => (
                        <SettingsRow key={title} icon={<Icon size={20} />} title={t(title)} description={t(body)} />
                    ))}
                </div>
            </section>

            <section>
                <SettingsSectionHeading
                    title={t('Privacy & Data')}
                    subtitle={t('What stays local, and what you send.')}
                />
                <div className={ROW_GROUP}>
                    {PRIVACY.map(({ title, body, Icon }) => (
                        <SettingsRow key={title} icon={<Icon size={20} />} title={t(title)} description={t(body)} />
                    ))}
                </div>
            </section>

            {/* Community and the panel's own title are ONE closing section, at the
                owner's request. They were two, which meant two headings and three row
                groups for what is really a single block: who made it, how to reach
                the project, and which build you are on — the last being exactly what
                you need in hand when you click "Report an Issue" two rows above.

                One row group, so the creator, the four actions and the build line
                stack without seams. The actions deliberately carry no tile (see
                CommunityActionRow), so the group is intentionally not uniformly
                indented — that is the duplicate-icon fix, not an oversight. */}
            <section>
                <SettingsSectionHeading
                    title={t('About Natively')}
                    subtitle={t('Designed to be invisible, intelligent, and trusted.')}
                />
                <div className={ROW_GROUP}>
                    <SettingsRow
                        /* The avatar FILLS the tile rather than sitting inside it:
                           rounded-[7px] is the tile's 8px radius less its 1px border,
                           so the photo meets the hairline exactly. */
                        icon={<img src={evinProfile} alt="" className="w-full h-full object-cover rounded-[7px]" draggable={false} />}
                        title="Evin John"
                        badge={<LiquidGlassBadge variant="neutral">{t('Creator')}</LiquidGlassBadge>}
                        description="I build software that stays out of the way."
                        control={iconLinks(CREATOR_LINKS)}
                    />
                    {actions.map(({ title, body, action }) => (
                        <CommunityActionRow key={title} title={title} body={body} control={action} />
                    ))}
                </div>
            </section>
        </div>
    );
};

