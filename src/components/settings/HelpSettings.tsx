import React, { useEffect, useState } from 'react';
import {
    AppWindow, ArrowRight, AudioLines, Brain, CalendarCheck, Code, Crop, Eye, FileText, FlaskConical, Ghost, Globe, Info,
    Keyboard, LayoutGrid, ListOrdered, Mail, MessageSquareText, MonitorUp, MousePointerClick, Move, NotebookPen, PanelTop,
    Pin, Play, Plug, PointerOff, Search, Share2, ShieldCheck, Smartphone, TextCursorInput, TriangleAlert,
} from 'lucide-react';
import { AutoAnswerIcon } from '../AutoAnswerIcon';
import { ProfileIntelligenceIcon } from '../ProfileIntelligenceIcon';
import { useT } from '../../i18n';
import { useShortcuts, type ShortcutConfig } from '../../hooks/useShortcuts';
import { isMac, isWindows } from '../../utils/platformUtils';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { LiquidGlassBadge } from '../../ui-components/LiquidGlassBadge';
import { LiquidGlassButton } from '../../ui-components/LiquidGlassButton';
import {
    Presence, SETTINGS_BTN, SettingsFootnote, SettingsMotionReady, SettingsNotice, SettingsRow,
    SettingsSectionHeading, useMotionReadyAfter, useSettingsTones,
} from './SettingsRow';
// The learn-more hover (.t-learn) the Go buttons use, shared with Plans and About.
import './HowItWorksRefund.css';
import {
    HelpClip, HelpCommand, HelpDefinitions, HelpFigure, HelpGroupLabel, HelpGuideRow, HelpGuideSearch, HelpKeys, HelpLegend,
    HelpLink, HelpPath, HelpSetupMeter, HelpSteps, HelpSubhead, matchesHelpQuery, type HelpMeterStep,
} from './help/HelpParts';
import { AnswerFlowFigure, NativelyGlyph, OverlayAnatomyFigure, PermissionsFigure } from './help/HelpGraphics';
import { HELP_CLIPS, PERMISSIONS_CARD, type HelpClipEntry } from './help/helpClips';
import {
    getPermissions, getPlatformFacts, getRowCopy, isHelpPlatform,
    type HelpPermission, type HelpPlatform,
} from '../../lib/helpContent.mjs';
import {
    contextUnlocked, modeStep, modelStep, nativelyStep, permissionsStep, profileStep, speechStep, type SetupStep,
} from '../../lib/helpSetupStatus.mjs';
import zoomCaptureModeScreenshot from '../../assets/zoom-capture-mode.png';

// Settings → Setup & Help.
//
// Built from `./SettingsRow`, the module General, Audio, Companion, Intelligence and
// About are built from, so this pane reads as part of Settings: a section is an
// 18px heading over one short line, and everything under it is the same row —
// [40px tile][14px/700 title][12px description][control].
//
// Show, don't tell. A guide opens on a screen recording of the real app with its
// steps underneath (HelpClip); the steps are the guide's text, and pressing one
// jumps the recording there. What stays in prose is what a recording can't
// show: a warning, a fact that differs by platform, a command to copy.
//
// Get started reads this install (helpSetupStatus.mjs) and says what is already
// done, as facts — "Microphone and Screen Recording allowed" — never "working".
// A meter over the rows counts the three steps a meeting can't run without.
//
// Guides are grouped by when you need them (Set up, In a meeting, After a
// meeting, Under the hood) and a search field narrows them by title,
// description and the words people type. Revamped 2026-11-01 for 3.0: Notepad,
// your own overlay buttons, sharing and Connectors, the follow-up compose
// sheet, MCP and Intelligence got guides, and the recordings were re-made on
// the 3.0 UI (helpContent.mjs says which platform may show each).
//
// Nothing here restates a fact the app owns. Keys come from the user's own
// bindings (useShortcuts). Platform differences, including which recordings a
// platform may be shown, come from src/lib/helpContent.mjs, where the macOS
// and Windows branches are both tested. The copy names UI labels, not model
// ids, counts, durations or prices.

const CHROME_WEB_STORE_URL = 'https://chromewebstore.google.com/detail/lmhgnkbjnelmciecjkleaomjpejcgaln?utm_source=item-share-cb';
const OLLAMA_DOWNLOAD_URL = 'https://ollama.com/download';
// The model AI Providers' own Ollama empty state suggests (AIProvidersSettings).
const OLLAMA_STARTER_COMMAND = 'ollama pull qwen2.5:3b';

// Rows separate by rhythm, not rules — General's container, verbatim (see About).
const ROW_GROUP = 'rounded-xl border bg-transparent border-transparent';

/** A navigation button in a row's control rail: "Audio →". The arrow leans 2px
    toward where it goes on hover (.t-learn, HowItWorksRefund.css), as About's do. */
const GoButton: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
    <button type="button" onClick={onClick} className={`t-learn ${SETTINGS_BTN}`}>
        {label}
        <span className="t-learn-chevron" aria-hidden="true"><ArrowRight size={13} /></span>
    </button>
);

/** Opens the OS page for one permission. */
function openPermission(permission: HelpPermission) {
    if (permission.open.kind === 'url') {
        window.electronAPI?.openExternal?.(permission.open.url);
    } else {
        void window.electronAPI?.openMicSettings?.();
    }
}

/** The four "Move Window" bindings as one row of keys when they share modifiers. */
function moveKeys(shortcuts: ShortcutConfig): string[] {
    const all = [shortcuts.moveWindowUp, shortcuts.moveWindowDown, shortcuts.moveWindowLeft, shortcuts.moveWindowRight];
    if (all.some((keys) => !keys || keys.length === 0)) return shortcuts.moveWindowUp ?? [];
    const prefix = all[0].slice(0, -1);
    const shared = all.every((keys) => keys.length === prefix.length + 1 && keys.slice(0, -1).join('+') === prefix.join('+'));
    return shared ? [...prefix, 'Arrows'] : shortcuts.moveWindowUp;
}

function currentHelpPlatform(): string {
    if (isMac) return 'darwin';
    if (isWindows) return 'win32';
    return 'unsupported';
}

// ── Live setup status ───────────────────────────────────────────────────────

type PermissionCheck = { platform?: string; microphone?: string; screen?: string };

interface SetupStatus {
    natively: SetupStep;
    /** null when the OS check itself failed: the row then says where the setting is. */
    permissions: SetupStep | null;
    speech: SetupStep;
    model: SetupStep;
    mode: SetupStep;
    profile: SetupStep;
    /** Every first read has landed (the permission check may also have failed). */
    loaded: boolean;
}

type ActiveMode = { name?: string; templateType?: string } | null;

/**
 * What Get started reports: the OS permission check the launcher's permissions
 * card uses, the saved credentials, and the active model. Re-read when
 * credentials or the model change, and when the window regains focus — which
 * is when someone comes back from System Settings or Windows Settings.
 */
function useSetupStatus(platform: HelpPlatform): SetupStatus {
    const [check, setCheck] = useState<PermissionCheck | null>(null);
    const [checkFailed, setCheckFailed] = useState(false);
    const [creds, setCreds] = useState<Record<string, unknown> | null>(null);
    const [llm, setLlm] = useState<{ provider?: string; modelId?: string } | null>(null);
    const [license, setLicense] = useState<{ isPremium?: boolean } | null>(null);
    const [trial, setTrial] = useState<{ hasToken?: boolean; expired?: boolean } | null>(null);
    // undefined = still reading; null = read, and nothing is set.
    const [activeMode, setActiveMode] = useState<ActiveMode | undefined>(undefined);
    const [profile, setProfile] = useState<{ hasProfile?: boolean } | null | undefined>(undefined);

    useEffect(() => {
        const api = window.electronAPI;
        let alive = true;
        const readPermissions = () => {
            // On macOS this can take a few seconds: a Screen Recording status
            // other than 'granted' is confirmed with a capture probe. The
            // launcher runs the same check every time it opens, so this asks
            // the OS nothing new.
            api?.checkPermissions?.()
                .then((r) => { if (alive) { setCheck(r); setCheckFailed(false); } })
                .catch(() => { if (alive) setCheckFailed(true); });
        };
        const readCredentials = () => {
            api?.getStoredCredentials?.()
                .then((c) => { if (alive) setCreds(c as unknown as Record<string, unknown>); })
                .catch(() => {});
            api?.getCurrentLlmConfig?.()
                .then((l) => { if (alive) setLlm(l); })
                .catch(() => {});
        };
        // Modes and Profile Intelligence: whether the plan opens them (Pro or a
        // live trial, App.tsx's rule), and what is set in each. A failed read
        // settles as "nothing set" rather than leaving the row on Checking.
        const readContext = () => {
            api?.licenseGetDetails?.()
                .then((d) => { if (alive) setLicense({ isPremium: !!d?.isPremium }); })
                .catch(() => { if (alive) setLicense({ isPremium: false }); });
            (api?.getLocalTrial?.() ?? Promise.resolve({ hasToken: false }))
                .then((tr) => { if (alive) setTrial(tr ?? { hasToken: false }); })
                .catch(() => { if (alive) setTrial({ hasToken: false }); });
            (api?.modesGetActive?.() ?? Promise.resolve(null))
                .then((m) => { if (alive) setActiveMode(m ?? null); })
                .catch(() => { if (alive) setActiveMode(null); });
            (api?.profileGetStatus?.() ?? Promise.resolve(null))
                .then((p) => { if (alive) setProfile(p ?? null); })
                .catch(() => { if (alive) setProfile(null); });
        };
        readPermissions();
        readCredentials();
        readContext();
        const onFocus = () => { readPermissions(); readCredentials(); readContext(); };
        window.addEventListener('focus', onFocus);
        const offCreds = api?.onCredentialsChanged?.(readCredentials);
        const offModel = api?.onModelChanged?.(() => readCredentials());
        const offLicense = api?.onLicenseStatusChanged?.(readContext);
        const offTrial = api?.onTrialStarted?.(readContext);
        return () => {
            alive = false;
            window.removeEventListener('focus', onFocus);
            offCreds?.();
            offModel?.();
            offLicense?.();
            offTrial?.();
        };
    }, []);

    return {
        natively: nativelyStep(creds),
        permissions: checkFailed ? null : permissionsStep(platform, check),
        speech: speechStep(platform, creds),
        model: modelStep(creds, llm),
        mode: modeStep(contextUnlocked(license, trial), activeMode),
        profile: profileStep(contextUnlocked(license, trial), profile),
        loaded: !!creds && !!llm && (!!check || checkFailed)
            && !!license && !!trial && activeMode !== undefined && profile !== undefined,
    };
}

export const HelpSettings: React.FC<{
    onNavigate?: (tab: string) => void;
    /** Hands Settings over to the Modes manager, as the Launcher header's button does. */
    onOpenModes?: () => void;
    /** Hands Settings over to Profile Intelligence. */
    onOpenProfile?: () => void;
    /** Injectable for the harness and tests; defaults to the running OS. */
    platform?: string;
}> = ({ onNavigate, onOpenModes, onOpenProfile, platform = currentHelpPlatform() }) => {
    const t = useT();
    const tones = useSettingsTones();
    const { shortcuts } = useShortcuts();

    if (!isHelpPlatform(platform)) {
        // The app ships for macOS and Windows only. Neither branch's copy is
        // true anywhere else, so neither is borrowed.
        return (
            <SettingsNotice tone={tones.warn} icon={<TriangleAlert size={14} />}>
                {t('Setup & Help covers macOS and Windows.')}
            </SettingsNotice>
        );
    }

    return (
        // Collapse and Presence animate only once the pane says it is ready.
        // Guides have nothing to wait for, so the pane is ready at once; Get
        // started's status rows set their own readiness (see HelpPane).
        <SettingsMotionReady.Provider value>
            <HelpPane
                platform={platform}
                onNavigate={onNavigate}
                onOpenModes={onOpenModes}
                onOpenProfile={onOpenProfile}
                shortcuts={shortcuts}
                t={t}
                tones={tones}
            />
        </SettingsMotionReady.Provider>
    );
};

type GuideGroup = 'setup' | 'meeting' | 'after' | 'engine';

interface GuideDef {
    id: string;
    group: GuideGroup;
    icon: React.ReactNode;
    title: string;
    description: string;
    /** Words people type that the title and description don't say ("pdf", "mute"). */
    keywords: string;
    body: React.ReactNode;
}

const GUIDE_GROUPS: Array<{ id: GuideGroup; title: string }> = [
    { id: 'setup', title: 'Set up' },
    { id: 'meeting', title: 'In a meeting' },
    { id: 'after', title: 'After a meeting' },
    { id: 'engine', title: 'Under the hood' },
];

/** "A, B or C" — a list as a sentence says it. */
const orList = (items: string[]) => items.join(', ').replace(/, ([^,]*)$/, ' or $1');

const HelpPane: React.FC<{
    platform: HelpPlatform;
    onNavigate?: (tab: string) => void;
    onOpenModes?: () => void;
    onOpenProfile?: () => void;
    shortcuts: ShortcutConfig;
    t: (text: string) => string;
    tones: ReturnType<typeof useSettingsTones>;
}> = ({ platform, onNavigate, onOpenModes, onOpenProfile, shortcuts, t, tones }) => {
    const facts = getPlatformFacts(platform);
    const rowCopy = getRowCopy(platform);
    const permissions = getPermissions(platform);
    const status = useSetupStatus(platform);
    const [query, setQuery] = useState('');
    // Get started opens on what is already true, with no motion: descriptions
    // don't swap away from "Checking…" for steps done long ago (SettingsRow's
    // rule — state already true on open isn't news).
    // Only a change while the pane is open, such as a permission granted in
    // System Settings, animates.
    const setupReady = useMotionReadyAfter(status.loaded);
    const isLight = useResolvedTheme() === 'light';
    const mac = platform === 'darwin';
    const mod = facts.modifierKey;
    const go = (tab: string) => () => onNavigate?.(tab);
    const keys = (id: keyof ShortcutConfig) => <HelpKeys inline keys={shortcuts[id] ?? []} />;
    const inlineKeys = (k: string[]) => <HelpKeys inline keys={k} />;
    /** A guide's recording, when this platform may be shown it. */
    const clip = (id: keyof typeof HELP_CLIPS): HelpClipEntry | null => (facts.clips[id] ? HELP_CLIPS[id] : null);
    const answerClip = clip('answer');
    const autoAnswerClip = clip('autoanswer');
    const calendarClip = clip('calendar');
    const speechClip = clip('speech');
    const modelClip = clip('model');
    const retrievalClip = clip('retrieval');
    const phoneClip = clip('phone');
    const modesClip = clip('modes');
    const profileClip = clip('profile');
    const stealthClip = clip('stealth');
    const verifyClip = clip('verify');
    const notesClip = clip('notes');
    const searchClip = clip('search');
    const overlayClip = clip('overlay');
    const buttonsClip = clip('buttons');
    const notepadClip = clip('notepad');
    const syncClip = clip('sync');
    const followupClip = clip('followup');
    const shareClip = clip('share');
    const mcpClip = clip('mcp');

    // A step's action is the Liquid Glass action button (Companion's Connect) while
    // the step is still to do; once done it steps back to the neutral button,
    // still there to change it.
    // Status re-reads on focus and on credential/model changes, so a step can go
    // to-do -> done while the pane is on screen (allow the mic in System Settings,
    // come back): the blue action then trades places with the Go button
    // (Presence "control") instead of being swapped in one frame. Silent on load.
    const stepAction = (step: SetupStep | null, label: string, onClick: () => void) => (
        <Presence kind="control" id={step?.state === 'todo' ? 'todo' : 'go'}>
            {step?.state === 'todo' ? (
                <LiquidGlassButton variant="action" className="lg-sm" onClick={onClick}>
                    {label}
                </LiquidGlassButton>
            ) : (
                <GoButton label={label} onClick={onClick} />
            )}
        </Presence>
    );

    // The three steps a meeting can't run without. A failed permission check
    // counts as not done: the row then says where the setting is.
    const stepDone = (step: SetupStep | null): boolean | null =>
        !step ? false : step.state === 'checking' ? null : step.state === 'done';
    const meter: HelpMeterStep[] = [
        { label: t('Permissions'), done: status.loaded ? stepDone(status.permissions) : null },
        { label: t('Speech'), done: status.loaded ? stepDone(status.speech) : null },
        { label: t('AI model'), done: status.loaded ? stepDone(status.model) : null },
    ];

    // ── Guides ──────────────────────────────────────────────────────────────
    // One list, grouped by when you need it. Each guide carries the words a
    // person might search for; bodies stay mounted while filtered out (hidden),
    // so an open guide is still open when the search is cleared.
    const guides: GuideDef[] = [
        // ── Set up ──
        {
            id: 'permissions',
            group: 'setup',
            icon: <ShieldCheck size={20} />,
            title: t('Permissions'),
            description: t(rowCopy.permissionsGuide),
            keywords: 'microphone screen recording privacy accessibility allow denied system settings',
            body: (
                <>
                    {facts.clips.permissions ? (
                        <HelpFigure caption="Natively shows this card when it opens, until everything it needs is allowed.">
                            <img
                                src={isLight ? PERMISSIONS_CARD.light : PERMISSIONS_CARD.dark}
                                width={PERMISSIONS_CARD.size[0]}
                                height={PERMISSIONS_CARD.size[1]}
                                alt="Natively's permissions card: Screen Recording and Microphone, both showing Access granted."
                                className="block w-full h-auto"
                            />
                        </HelpFigure>
                    ) : (
                        <HelpFigure>
                            <PermissionsFigure platform={platform} />
                        </HelpFigure>
                    )}
                    <p>{mac ? 'If you said no to either, turn it on by hand:' : `${permissions[0].why} If Natively can't hear you:`}</p>
                    <HelpSteps
                        steps={[
                            ...permissions.map((permission) => (
                                <>
                                    <HelpPath parts={permission.path} />
                                    {permission.olderTitle && <> ({permission.olderTitle} on macOS 14 and earlier)</>}
                                    {mac ? <>: turn on Natively. </> : <>: turn on both switches. </>}
                                    <button type="button" onClick={() => openPermission(permission)} className="text-accent-primary underline decoration-transparent hover:decoration-current transition-colors duration-150 ease-out">
                                        Open
                                    </button>
                                </>
                            )),
                            facts.restartAfterGrant
                                ? <>Quit Natively and open it again. macOS applies screen permission after a restart.</>
                                : <>Start the meeting again.</>,
                        ]}
                    />
                    {facts.stealthTypingNeedsAccessibility && (
                        <p>
                            Accessibility is optional. Typing into the overlay ({keys('focusInput')}) needs it, and Natively asks the
                            first time you do.
                            {facts.callDetailsNeedAccessibility && (
                                <> With it allowed, Natively also reads Zoom and Teams for who is on the call and whether you are muted.</>
                            )}
                        </p>
                    )}
                </>
            ),
        },
        {
            id: 'speech',
            group: 'setup',
            icon: <AudioLines size={20} />,
            title: t('Speech providers'),
            description: t('Pick who turns the meeting into text, and your language.'),
            keywords: 'transcription transcript stt deepgram soniox groq whisper parakeet qwen local language dictionary words names spelling room speakers shared microphone muted audio',
            body: (
                <>
                    {speechClip ? (
                        <HelpClip clip={speechClip} label={speechClip.label} />
                    ) : (
                        <p>
                            Choose one in <HelpPath parts={['Audio', 'Speech Provider']} />, paste its key, press Save, then Test Connection.
                        </p>
                    )}
                    <HelpDefinitions
                        items={[
                            { term: 'Natively API', detail: 'Nothing to paste. It appears once your Natively key is saved.' },
                            { term: 'Local Models', detail: 'Runs on this computer after a one-time download. Parakeet v2 is English only; v3 is multilingual.' },
                            { term: 'Google Cloud', detail: 'A service-account JSON file, chosen with Select File.' },
                            { term: 'Azure Speech', detail: 'An API key and its Region, such as eastus.' },
                            { term: 'Everything else', detail: "An API key from the provider's console." },
                        ]}
                    />
                    <p>A few languages are offered only by the Parakeet local model. {facts.systemAudio.fix}</p>
                    <HelpSubhead>Hearing it right</HelpSubhead>
                    <HelpDefinitions
                        items={[
                            { term: 'Dictionary', detail: <>In <HelpPath parts={['Audio']} />, add names and terms with Add a name or word, so they are spelled your way.</> },
                            { term: 'People sharing your microphone', detail: 'Tells apart people talking into one microphone, on Natively, Deepgram and Soniox. The saved transcript and notes label each voice.' },
                            ...(facts.followMeetingMic
                                ? [{ term: "Use the meeting app's microphone", detail: 'Records from the microphone your meeting app uses, so a headset switch mid-call follows along.' }]
                                : []),
                        ]}
                    />
                    <p>
                        While you are muted in Zoom, Teams or Google Meet, the overlay shows Muted in Zoom (or Teams, or Google Meet), and
                        your microphone isn't transcribed.
                    </p>
                </>
            ),
        },
        {
            id: 'models',
            group: 'setup',
            icon: <FlaskConical size={20} />,
            title: t('AI models'),
            description: t('Choose the model that answers, or bring your own.'),
            keywords: 'llm openai claude gemini groq deepseek openrouter ollama key api provider fast response background model direct assist custom curl codex',
            body: (
                <>
                    {modelClip ? (
                        <HelpClip clip={modelClip} label={modelClip.label} />
                    ) : (
                        <p>
                            In <HelpPath parts={['AI Providers']} />, add a key under Cloud Providers, then choose the model in Active Model.
                        </p>
                    )}
                    <p>
                        Each provider's model list is fetched live, so a model released today can be picked today. During a meeting, the
                        model button under the overlay's ask box switches models without opening Settings.
                    </p>
                    <HelpDefinitions
                        items={[
                            { term: 'Background Model', detail: 'Runs Auto Answer, quick background decisions and Fast Response Mode. Auto is recommended.' },
                            { term: 'Fast Response Mode', detail: "Text answers from the Background Model instead of the Active Model. On Auto, whichever connected model this computer has measured fastest. AI Providers says when it can't apply." },
                            { term: 'Direct Assist', detail: 'Sends what you type, say or capture straight to the model, unprocessed. In beta.' },
                            { term: 'Custom Providers', detail: <>A cURL command, with <code className="font-mono text-text-primary">{'{{TEXT}}'}</code> where the question goes.</> },
                        ]}
                    />
                    <HelpSubhead>Run a model on this computer</HelpSubhead>
                    <HelpSteps
                        steps={[
                            <>Install Ollama from <HelpLink href={OLLAMA_DOWNLOAD_URL}>ollama.com</HelpLink>.</>,
                            <div className="space-y-2">
                                <div>In {facts.terminal}, download a model that can chat:</div>
                                <HelpCommand command={OLLAMA_STARTER_COMMAND} />
                            </div>,
                            <>Open <HelpPath parts={['AI Providers', 'Local & Gateways']} />. Natively finds Ollama by itself.</>,
                        ]}
                    />
                </>
            ),
        },
        {
            id: 'calendar',
            group: 'setup',
            icon: <CalendarCheck size={20} />,
            title: t('Calendar'),
            description: t('Your next meetings, and notes that know which meeting they were.'),
            keywords: 'google outlook apple ics link events detect meetings zoom teams meet webex start automatically remind shared screens snapshot end automatically',
            body: (
                <>
                    {calendarClip && <HelpClip clip={calendarClip} label={calendarClip.label} />}
                    <HelpSteps
                        steps={[
                            <>
                                In <HelpPath parts={['Calendar']} />, press Connect next to Google Calendar, Outlook
                                {facts.appleCalendar ? ', Apple Calendar' : ''} or a calendar link. Natively only reads your events.
                            </>,
                            'Your next meetings appear there and on the Launcher. In Calendar, from 15 minutes before one starts, its Start Natively button starts a session linked to it.',
                            "A linked session takes the event's title and attendees. Your voice is labelled with your first name, and in a one-to-one the other person's is too.",
                        ]}
                    />
                    <p>
                        To change the link, press the calendar chip on a meeting's page and pick the event, or Not a calendar
                        meeting.
                    </p>
                    <HelpSubhead>Detect meetings</HelpSubhead>
                    <p>
                        On by default, with or without a calendar: when a call starts in Zoom, Teams, Meet, Webex, Slack or another call
                        app, a Meeting detected card offers Start Natively or Not now. It stays quiet while Undetectable is on.
                        {facts.meetingDetection && <> {facts.meetingDetection}</>}
                    </p>
                    <HelpDefinitions
                        items={[
                            { term: 'Start automatically', detail: 'Starts after 10 seconds unless you press Not now.' },
                            { term: 'Remind me before meetings', detail: 'A reminder a few minutes before an event. Shown once a calendar is connected.' },
                            { term: 'End meetings automatically', detail: 'Ends the session when the call ends.' },
                            { term: 'Snapshot shared screens', detail: 'Off by default. When someone else shares a screen in Zoom or Teams, your vision model describes it in the notes. Paused while Undetectable is on.' },
                        ]}
                    />
                </>
            ),
        },
        {
            id: 'modes',
            group: 'setup',
            icon: <LayoutGrid size={20} />,
            title: t('Modes'),
            description: t('Tell Natively how to answer in each kind of meeting.'),
            keywords: 'prompt real-time reference files documents interview sales template suggestions pro',
            body: (
                <>
                    {modesClip ? (
                        <HelpClip clip={modesClip} label={modesClip.label} />
                    ) : (
                        <p>Open Modes from the grid icon in the Launcher header, pick a mode, write its Real-time prompt, then Set active.</p>
                    )}
                    <p>
                        Reference files give a mode documents to answer from, and Deactivate returns to Natively's default. With a mode
                        active, suggestions such as Suggest response appear at the top of the overlay.
                    </p>
                    <p>
                        Modes and Profile Intelligence are part of Natively Pro, in <HelpPath parts={['Plans & Billing']} />; a free trial
                        opens both.
                    </p>
                </>
            ),
        },
        {
            id: 'profile',
            group: 'setup',
            icon: <ProfileIntelligenceIcon size={20} />,
            title: t('Profile Intelligence'),
            description: t('Answers built from your résumé and the job you want.'),
            keywords: 'resume cv job description cue cards company intel cover letter interview weakness salary',
            body: (
                <>
                    {profileClip ? (
                        <HelpClip clip={profileClip} label={profileClip.label} />
                    ) : (
                        <p>Open it from the person icon in the Launcher header, and upload your résumé and the job description.</p>
                    )}
                    <p>
                        Only the Looking for work and Technical Interview modes use it. Company Intel researches the company, and Cover
                        Letter drafts one from both documents.
                    </p>
                    <p>
                        Cue Cards hold the answers only you can give, such as why you left a job or your salary range. Natively drafts the
                        ones your résumé suggests; a meeting uses an answer once you save it.
                    </p>
                </>
            ),
        },

        // ── In a meeting ──
        {
            id: 'start',
            group: 'meeting',
            icon: <Play size={20} />,
            title: t('Starting a meeting'),
            description: t('Start, the overlay or the notepad, and how a meeting ends.'),
            keywords: 'start natively launcher meeting ongoing detected overlay notepad stop end ambient mic is off auto stop silence',
            body: (
                <>
                    <HelpSteps
                        steps={[
                            <>Press Start Natively in the Launcher, or on a Meeting detected card. While a meeting runs, the button reads Meeting ongoing.</>,
                            <>
                                The meeting opens what <HelpPath parts={['Overlay']} /> says: the Natively overlay, or the Natively notepad on
                                the right of the screen. Both follow Undetectable.
                            </>,
                            <>End it with the square on the overlay's pill, or Stop transcript in the notepad.</>,
                        ]}
                    />
                    <p>
                        When nothing has been said for a while, Natively says it stops in 1 minute; Keep going carries on.
                    </p>
                    <SettingsNotice tone={tones.warn} icon={<TriangleAlert size={14} />} className="mb-0">
                        With Ambient AI Chat on, in <HelpPath parts={['General', 'Show advanced settings']} />, meetings start without
                        listening and the overlay says Mic is off. Turn on mic starts it.
                    </SettingsNotice>
                </>
            ),
        },
        {
            id: 'overlay',
            group: 'meeting',
            icon: <PanelTop size={20} />,
            title: t('The overlay'),
            description: t('Every button on the overlay, and the pill above it.'),
            keywords: 'pill hide transcript quick actions ask box model quick settings passthrough click-through suggestions screenshot tray',
            body: (
                <>
                    {overlayClip && <HelpClip clip={overlayClip} label={overlayClip.label} />}
                    <HelpFigure>
                        <OverlayAnatomyFigure />
                    </HelpFigure>
                    <HelpLegend
                        items={[
                            { title: 'The pill', body: <>The logo opens the Launcher. Hide hides the overlay; {keys('toggleVisibility')} brings it back. The square ends the meeting.</> },
                            { title: 'Live transcript', body: 'What is being said, as your speech provider hears it.' },
                            { title: 'Quick actions', body: 'Five buttons: What to answer?, Clarify, Recap, Follow Up Question and Speak, which records you. Swap in Brainstorm, What did I miss?, Define, Sound smart or a button you made.' },
                            { title: 'Ask box', body: <>Type any question, or paste or drop an image. {keys('selectiveScreenshot')} attaches part of the screen.</> },
                            { title: 'Model', body: 'Switches the AI model.' },
                            { title: 'Quick settings', body: 'Detectable or Undetectable, Fast Response and Transcript, with your main shortcuts.' },
                            { title: 'Mouse passthrough', body: 'Lets clicks go through to the app behind. Turned on, it opens into a pill with the keys to leave.' },
                        ]}
                    />
                    <p>
                        With a mode active, a suggestion can appear at the top of the overlay, one at a time, such as Suggest response or
                        Solve coding problem. Click it or press {keys('acceptSuggestion')}. Screenshots you take wait in a tray above the
                        ask box until you ask.
                    </p>
                    <SettingsNotice tone={tones.warn} icon={<TriangleAlert size={14} />} className="mb-0">
                        With mouse passthrough on, the overlay can't be clicked. Press {keys('toggleMousePassthrough')} to turn it off.
                    </SettingsNotice>
                </>
            ),
        },
        {
            id: 'buttons',
            group: 'meeting',
            icon: <Pin size={20} />,
            title: t('Your own buttons'),
            description: t('Describe a quick action in plain sentences, and it joins the overlay.'),
            keywords: 'custom button quick action make a button describe reorder tray drag reset order brainstorm define sound smart',
            body: (
                <>
                    {buttonsClip ? (
                        <>
                            <HelpClip clip={buttonsClip} label={buttonsClip.label} />
                            <p>
                                In <HelpPath parts={['Overlay', 'Your buttons']} />, a name is what the button says, up to 10 characters.
                                The description starts with lines to finish: What it does, What to read, How the answer looks, Never, and
                                If there's nothing to work with. New buttons wait in the tray; drag one into the row.
                            </p>
                        </>
                    ) : (
                        <HelpSteps
                            steps={[
                                <>In <HelpPath parts={['Overlay', 'Your buttons']} />, press Make a button.</>,
                                'Name it with what the button says, up to 10 characters, such as Rephrase.',
                                'Describe it. The box starts with lines to finish: What it does, What to read, How the answer looks, Never, and If there\'s nothing to work with.',
                                'Press Add. New buttons wait in the tray; drag one into the row under Meeting overlay.',
                            ]}
                        />
                    )}
                    <HelpDefinitions
                        items={[
                            { term: 'What to read', detail: 'The last 3 minutes of the conversation unless you say otherwise, up to an hour.' },
                            { term: 'Screenshot every press', detail: 'Attaches the screen each time the button is pressed.' },
                            { term: 'How Natively runs it', detail: 'Shows, once saved, what Natively understood from your description.' },
                        ]}
                    />
                    <p>
                        You can make up to 4. The row shows five buttons; drag to reorder, or swap one in from the tray. Reset order puts the
                        built-ins back.
                    </p>
                </>
            ),
        },
        {
            id: 'notepad',
            group: 'meeting',
            icon: <NotebookPen size={20} />,
            title: t('Meeting notepad'),
            description: t('Your own notes beside the transcript, with recipes and Ask.'),
            keywords: 'notes notepad write recipes what did i miss sound smart tldr todos follow up slash templates enhanced my notes ask',
            body: (
                <>
                    {notepadClip && <HelpClip clip={notepadClip} label={notepadClip.label} />}
                    <p>
                        Choose Natively notepad in <HelpPath parts={['Overlay']} /> and meetings open a notepad on the right of the screen
                        instead of the overlay. {keys('toggleVisibility')} still brings the overlay up when you want it.
                    </p>
                    <HelpDefinitions
                        items={[
                            { term: 'Recipes', detail: 'Chips under Ask: What did I miss and Make me sound smart while live; Write follow up email and List my todos after. All recipes lists the rest, such as Write tldr.' },
                            { term: '/ in Ask', detail: 'Runs a recipe by name; add words after it to steer it.' },
                            { term: '/ in your notes', detail: 'Inserts a note template. All templates… opens the gallery.' },
                            { term: 'Show transcript', detail: 'The live transcript beside your notes. More (…) has Find in notes and Pause transcription.' },
                        ]}
                    />
                    <p>
                        Closing the notepad mid-meeting (its X, or {inlineKeys(facts.closeNotepadKeys)}) takes you to the Launcher;
                        Meeting ongoing brings it back. After Stop transcript, My notes and Enhanced switch between your words and the
                        written-up notes, and Ask reads the whole meeting.
                    </p>
                </>
            ),
        },
        {
            id: 'autoanswer',
            group: 'meeting',
            icon: <AutoAnswerIcon size={20} />,
            title: t('Auto Answer'),
            description: t('Answers as soon as the interviewer finishes a question.'),
            keywords: 'automatic hands free beta background model',
            body: (
                <>
                    {autoAnswerClip && <HelpClip clip={autoAnswerClip} label={autoAnswerClip.label} />}
                    <p>
                        Turn it on in <HelpPath parts={['General']} />, where it is marked Beta. Each question is answered when it ends,
                        with nothing to press, and questions meant for someone else in the call are skipped.
                    </p>
                    <p>
                        Auto Answer runs on the Background Model, in <HelpPath parts={['AI Providers']} />. What to answer? still works
                        for anything it didn't answer.
                    </p>
                </>
            ),
        },
        {
            id: 'typing',
            group: 'meeting',
            icon: <TextCursorInput size={20} />,
            title: t('Typing, pasting and screenshots'),
            description: t('Type into the overlay without leaving your meeting app.'),
            keywords: 'stealth typing paste drop image screenshot tray selective capture memory copy cut select all delete word',
            body: (
                <>
                    <p>
                        {keys('focusInput')} types into the overlay's ask box while your meeting app keeps focus.
                        {facts.stealthTypingNeedsAccessibility && ' macOS asks for Accessibility the first time.'}
                    </p>
                    <HelpDefinitions
                        items={[
                            { term: 'Edit keys', detail: <>{inlineKeys([mod, 'V'])} pastes, {inlineKeys([mod, 'A'])}, {inlineKeys([mod, 'C'])} and {inlineKeys([mod, 'X'])} select, copy and cut, {inlineKeys(facts.wordDeleteKeys)} deletes a word. Text always goes at the end.</> },
                            { term: 'Images', detail: 'Paste an image, or drop image files on the overlay, to attach them to your question.' },
                            { term: 'Screenshots', detail: <>{keys('captureAndProcess')} answers about the whole screen; {keys('selectiveScreenshot')} attaches the part you drag over. They wait in the tray until you ask.</> },
                        ]}
                    />
                    <p>
                        Screenshots and pages you capture stay with the conversation, so a later Recap, quick action or typed question can
                        still see them.
                    </p>
                </>
            ),
        },
        {
            id: 'stealth',
            group: 'meeting',
            icon: <Ghost size={20} />,
            title: t('Staying invisible'),
            description: t('Keep Natively out of screen shares and recordings.'),
            keywords: 'undetectable detectable stealth screen share hide dock taskbar process disguise zoom capture',
            body: (
                <>
                    {stealthClip && <HelpClip clip={stealthClip} label={stealthClip.label} />}
                    <p>
                        Turn on the Detectable switch in <HelpPath parts={['General']} />; it then reads Undetectable. Natively asks the
                        system to keep its windows out of screen shares and recordings, and hides {facts.undetectable.hides}.
                        {' '}{facts.undetectable.caveat}
                    </p>
                    <p>
                        Process Disguise makes Natively look like {orList(facts.disguises)} while Undetectable is on. Choose it first: it
                        can't be changed while Undetectable is on.
                    </p>
                    <SettingsNotice tone={tones.warn} icon={<TriangleAlert size={14} />} className="mb-0">
                        Check with a test share before a call that matters.
                    </SettingsNotice>
                    {facts.zoomGuide && (
                        <>
                            <HelpSubhead>Zoom</HelpSubhead>
                            <p>
                                In <HelpPath parts={['Zoom', 'Settings', 'Share Screen', 'Advanced']} />, set Screen capture mode to Advanced
                                capture with window filtering. The other modes capture Natively.
                            </p>
                            <HelpFigure>
                                <img
                                    src={zoomCaptureModeScreenshot}
                                    width={1212}
                                    height={1008}
                                    alt="Zoom's Share Screen settings, with Screen capture mode set to Advanced capture with window filtering"
                                    className="block w-full"
                                />
                            </HelpFigure>
                        </>
                    )}
                </>
            ),
        },
        {
            id: 'phone',
            group: 'meeting',
            icon: <Smartphone size={20} />,
            title: t('Phone and browser'),
            description: t('The overlay on your phone, and web pages sent to Natively.'),
            keywords: 'phone mirror companion pair qr code lan wifi chrome extension page capture smart browser context coding problem',
            body: (
                <>
                    {phoneClip && <HelpClip clip={phoneClip} label={phoneClip.label} />}
                    <p>
                        Phone Mirror shows the live transcript and each answer as it is written, with the overlay's buttons: tap What to Say
                        for an answer, ask in the text box, or send a photo or screenshot from the phone. Clearing the screen there clears
                        only the phone.
                    </p>
                    <HelpSubhead>Pair a phone</HelpSubhead>
                    {syncClip ? (
                        <>
                            <HelpClip clip={syncClip} label={syncClip.label} />
                            <p>
                                In <HelpPath parts={['Companion']} />, Allow LAN access lets your phone reach it over the same Wi-Fi. Scan the
                                code with your phone's camera.
                            </p>
                        </>
                    ) : (
                        <HelpSteps
                            steps={[
                                <>In <HelpPath parts={['Companion']} />, turn on Enable Phone Mirror.</>,
                                'Turn on Allow LAN access so your phone can reach it over the same Wi-Fi.',
                                "On Pair a phone, press Show code and scan it with your phone's camera.",
                            ]}
                        />
                    )}
                    <SettingsNotice tone={tones.warn} icon={<TriangleAlert size={14} />} className="mb-0">
                        Allow LAN access only on networks you trust. Anyone with the pairing link can read your answers until you
                        press Reset pairing.
                    </SettingsNotice>
                    <HelpSubhead>Browser extension</HelpSubhead>
                    <HelpSteps
                        steps={[
                            <>Install Natively Companion from the <HelpLink href={CHROME_WEB_STORE_URL}>Chrome Web Store</HelpLink>.</>,
                            <>With Phone Mirror on, press Connect on its row in <HelpPath parts={['Companion', 'Browser Extension']} />.</>,
                            "Within a minute, click the extension's icon and press Connect to Natively.",
                        ]}
                    />
                    <p>
                        Then {keys('capturePage')} sends the page you're reading. Smart Browser Context, also in Companion, spots coding and
                        interview pages and attaches the problem when you ask.
                    </p>
                </>
            ),
        },
        {
            id: 'verify',
            group: 'meeting',
            icon: <Code size={20} />,
            title: t('Verify coding answers'),
            description: t('Runs the code in an answer to check it, and fixes it if it fails.'),
            keywords: 'code run test python node java go sqlite verified corrected',
            body: (
                <>
                    {verifyClip ? (
                        <HelpClip clip={verifyClip} label={verifyClip.label} />
                    ) : (
                        <p>Turn it on in <HelpPath parts={['General', 'Show advanced settings']} />.</p>
                    )}
                    <p>
                        A passing answer shows ✓ verified. A failing one goes back to the model with the error, and is replaced by a
                        Corrected answer only if the fix passes too.
                    </p>
                    <p>
                        It uses tools already on this computer: {facts.pythonCommand}, node, g++, javac and java, go, and sqlite3.
                        {facts.sqliteBundled ? '' : " sqlite3 doesn't come with Windows."} A language without its tool is skipped.
                    </p>
                </>
            ),
        },

        // ── After a meeting ──
        {
            id: 'notes',
            group: 'after',
            icon: <FileText size={20} />,
            title: t('Meeting notes and Ask'),
            description: t('Notes after each meeting, templates, and asking about it.'),
            keywords: 'summary transcript usage your notes template regenerate compare ask chat web search sources',
            body: (
                <>
                    {notesClip ? (
                        <HelpClip clip={notesClip} label={notesClip.label} />
                    ) : (
                        <p>Open a meeting from the Launcher: Summary holds its notes, Transcript what was said, Usage what you asked.</p>
                    )}
                    <p>
                        A meeting's page has Summary, Transcript and Usage, plus Your notes when you typed any. The notes name the meeting,
                        its app and the people on the call.
                    </p>
                    <HelpDefinitions
                        items={[
                            { term: 'Template', detail: 'The Template chip rewrites the notes with Regenerate as another template.' },
                            { term: 'Compare', detail: 'Shows the earlier notes beside the new ones, so you can pick the better.' },
                            { term: 'Ask about this meeting', detail: 'Answers from its transcript and notes. Ask it to search the web or look something up and it lists its Sources; answers during a meeting never search.' },
                        ]}
                    />
                    <p>If the notes couldn't be generated, the transcript is still saved: generate them again from the Summary.</p>
                </>
            ),
        },
        {
            id: 'followup',
            group: 'after',
            icon: <Mail size={20} />,
            title: t('Follow-up email'),
            description: t('A draft from the notes, in your tone, ready for Gmail.'),
            keywords: 'email follow up compose tone professional concise warm friendly your style gmail outlook send',
            body: (
                <>
                    {followupClip ? (
                        <>
                            <HelpClip clip={followupClip} label={followupClip.label} />
                            <p>
                                Follow-up email, in a meeting's header, writes a draft from the notes. The tones are Professional, Concise,
                                Warm and Friendly, and you can edit anything. Send with Gmail, or open its menu for Outlook or your mail app.
                            </p>
                        </>
                    ) : (
                        <HelpSteps
                            steps={[
                                "Press Follow-up email in a meeting's header. A draft is written from the notes.",
                                'Pick a tone: Professional, Concise, Warm or Friendly. Edit anything.',
                                'Send with Gmail, or use Other ways to send for Outlook or your mail app.',
                            ]}
                        />
                    )}
                    <p>When the meeting is linked to a calendar event, its attendees fill To.</p>
                    <HelpSubhead>In your style</HelpSubhead>
                    <p>
                        In Modes, each mode has Follow-ups in your style: paste an email you wrote and press Add sample. Follow-ups you
                        edit and then copy or send are learned too. Once the meeting's mode has a sample, Your style leads the tone menu
                        and writes the first draft. Samples stay on this computer.
                    </p>
                </>
            ),
        },
        {
            id: 'share',
            group: 'after',
            icon: <Share2 size={20} />,
            title: t('Share and send'),
            description: t('A link, a PDF, or straight to Slack, Notion and your CRM.'),
            keywords: 'share link pdf file copy slack notion gmail hubspot salesforce attio affinity pipedrive zapier webhook connectors crm auto send rule clearbit attendees',
            body: (
                <>
                    {shareClip && <HelpClip clip={shareClip} label={shareClip.label} />}
                    <HelpDefinitions
                        items={[
                            { term: 'Copy', detail: 'The notes, ready to paste.' },
                            { term: 'File', detail: 'The notes as a PDF.' },
                            { term: 'Link', detail: 'Copies a link to the notes and transcript. Anyone with the link can read them.' },
                            { term: 'Slack, Notion, CRM', detail: <>Sends the notes to a connector you set up in <HelpPath parts={['Connectors']} />.</> },
                        ]}
                    />
                    <HelpSubhead>Connectors</HelpSubhead>
                    <p>
                        Gmail, Slack and Notion; HubSpot, Salesforce, Attio, Affinity and Pipedrive; Zapier and webhooks. Most sign in
                        through your browser; the rest take a token. Notes go from this computer to the service, and stay here until you
                        send them.
                    </p>
                    <p>
                        Send automatically, with Add a rule, sends every meeting's notes somewhere without asking. With a Clearbit key,
                        Look up attendees appears in the Share menu.
                    </p>
                </>
            ),
        },
        {
            id: 'mcp',
            group: 'after',
            icon: <Plug size={20} />,
            title: t('Your meetings in your AI tools'),
            description: t('Let Claude, Cursor or Codex read your meetings.'),
            keywords: 'mcp server claude code desktop cursor codex token api integration',
            body: (
                <>
                    {mcpClip ? (
                        <>
                            <HelpClip clip={mcpClip} label={mcpClip.label} />
                            <p>
                                In <HelpPath parts={['Connectors', 'MCP']} />, each app's setup already carries your token. Then chat with
                                that app about your meetings, and search them.
                            </p>
                        </>
                    ) : (
                        <HelpSteps
                            steps={[
                                <>In <HelpPath parts={['Connectors', 'MCP']} />, press Turn on.</>,
                                'Pick your app: Claude Code, Claude Desktop, Cursor or Codex. Its setup already carries your token.',
                                'Chat with that app about your meetings, and search them.',
                            ]}
                        />
                    )}
                    <p>
                        It is a local address: only apps on this computer can reach it, and nothing leaves it. New token disconnects every
                        app that used the old one.
                    </p>
                </>
            ),
        },
        {
            id: 'search',
            group: 'after',
            icon: <Search size={20} />,
            title: t('Find it again'),
            description: t('Search your meetings, ask across all of them, or delete one.'),
            keywords: 'search find ask all meetings memory delete do not save history',
            body: (
                <>
                    {searchClip && <HelpClip clip={searchClip} label={searchClip.label} />}
                    <p>
                        {inlineKeys([mod, 'K'])} opens Search or ask anything in the Launcher. The first result asks AI across all your
                        meetings; below it, Sessions lists meetings whose title or summary matches, and Memory adds what Natively
                        remembered.
                    </p>
                    <p>
                        Pointing at a meeting in the Launcher shows a Delete pill. One click deletes it, with no undo. To keep nothing,
                        turn on Do not save meetings in <HelpPath parts={['General']} />.
                    </p>
                </>
            ),
        },

        // ── Under the hood ──
        {
            id: 'retrieval',
            group: 'engine',
            icon: <ListOrdered size={20} />,
            title: t('Embeddings and rerankers'),
            description: t('How Natively finds the right passage in your documents.'),
            keywords: 'retrieval rag embedding reranker voyage jina hugging face local index documents',
            body: (
                <>
                    {retrievalClip && <HelpClip clip={retrievalClip} label={retrievalClip.label} />}
                    <p>
                        When you ask, the embedding model finds candidate passages in your documents, such as a mode's reference files,
                        and the reranker picks the ones that answer. Choose both in <HelpPath parts={['Retrieval']} />, separately from
                        your AI model.
                    </p>
                    <HelpDefinitions
                        items={[
                            { term: 'Hosted', detail: 'Providers such as Natively API, Voyage AI, OpenAI or Jina AI. The text being searched is sent to that provider.' },
                            { term: 'On this device', detail: 'Local Embeddings and Local Reranker come with Natively; more models download from Hugging Face. Nothing leaves this computer.' },
                            { term: 'Fall back to the local reranker', detail: 'If a hosted reranker fails, reranking happens on this device instead.' },
                        ]}
                    />
                    <p>Changing the embedding model re-indexes your files.</p>
                </>
            ),
        },
        {
            id: 'intelligence',
            group: 'engine',
            icon: <Brain size={20} />,
            title: t('Skills and memory'),
            description: t('Instructions the chat follows, and what Natively remembers.'),
            keywords: 'intelligence skills slash memory long-term about you speaker labels diagrams calibration provider performance',
            body: (
                <>
                    <p>All of it is in <HelpPath parts={['Intelligence']} />.</p>
                    <HelpDefinitions
                        items={[
                            { term: 'Skills', detail: 'Instructions the chat follows. Start a message with /name or $name to use one.' },
                            { term: 'Notes & answers', detail: 'About you, and how notes are written: meeting type, speaker labels, diagrams and charts.' },
                            { term: 'Memory', detail: 'Key points kept from meetings, search across past meetings, and chat history. Long-term memory is in beta.' },
                            { term: 'Provider performance', detail: 'Learns how fast each provider answers from normal use. Run calibration measures it now, with small requests on your API key.' },
                        ]}
                    />
                </>
            ),
        },
    ];

    const visible = guides.filter((g) => matchesHelpQuery(query, `${g.title} ${g.description} ${g.keywords}`));
    const visibleIds = new Set(visible.map((g) => g.id));

    return (
        <div className="space-y-6 pb-10" data-settings-stagger>
            {/* ── Get started ─────────────────────────────────────────────── */}
            <section>
                <SettingsSectionHeading
                    title={t('Get started')}
                    subtitle={t('Natively needs permissions, a speech provider and an AI model.')}
                />
                <SettingsMotionReady.Provider value={setupReady}>
                <HelpSetupMeter
                    steps={meter}
                    readyText={t('Ready for your first meeting')}
                    leftText={(left) => (left === 1 ? t('One step left before your first meeting') : `${left} ${t('steps left before your first meeting')}`)}
                    checkingText={t('Checking this computer…')}
                />
                <div className={ROW_GROUP}>
                    <SettingsRow
                        icon={<NativelyGlyph size={20} />}
                        title={t('Natively API')}
                        badge={
                            <Presence kind="badge" id={status.natively.state === 'todo' ? 'quickest' : null}>
                                <LiquidGlassBadge variant="neutral">{t('Quickest')}</LiquidGlassBadge>
                            </Presence>
                        }
                        description={t(status.natively.detail)}
                        descriptionKey={status.natively.state}
                        control={onNavigate && <GoButton label={t('Plans & Billing')} onClick={go('plans')} />}
                    />
                    <SettingsRow
                        icon={<ShieldCheck size={20} />}
                        title={t('Allow permissions')}
                        description={t(status.permissions?.detail ?? rowCopy.permissionsStep)}
                        descriptionKey={status.permissions?.detail ?? 'unknown'}
                        control={stepAction(status.permissions, t('Open'), () => openPermission(permissions[0]))}
                    />
                    <SettingsRow
                        icon={<AudioLines size={20} />}
                        title={t('Choose a speech provider')}
                        description={t(status.speech.detail)}
                        descriptionKey={status.speech.detail}
                        control={onNavigate && stepAction(status.speech, t('Audio'), go('audio'))}
                    />
                    <SettingsRow
                        icon={<FlaskConical size={20} />}
                        title={t('Choose an AI model')}
                        description={t(status.model.detail)}
                        descriptionKey={status.model.detail}
                        control={onNavigate && stepAction(status.model, t('AI Providers'), go('ai-providers'))}
                    />
                    {/* Optional, so never the blue call to action — but real steps:
                        each says what is set and opens its manager, which shows
                        its own Pro gate when locked. */}
                    <SettingsRow
                        icon={<AppWindow size={20} />}
                        title={t('Choose what meetings open')}
                        badge={<LiquidGlassBadge variant="neutral">{t('Optional')}</LiquidGlassBadge>}
                        description={t('The overlay, or a notepad on the right of the screen.')}
                        control={onNavigate && <GoButton label={t('Overlay')} onClick={go('overlay')} />}
                    />
                    <SettingsRow
                        icon={<LayoutGrid size={20} />}
                        title={t('Pick a mode')}
                        badge={
                            <Presence kind="badge" id={status.mode.state === 'locked' ? 'pro' : 'optional'}>
                                <LiquidGlassBadge variant="neutral">{status.mode.state === 'locked' ? t('Pro') : t('Optional')}</LiquidGlassBadge>
                            </Presence>
                        }
                        description={t(status.mode.detail)}
                        descriptionKey={status.mode.detail}
                        control={onOpenModes && <GoButton label={t('Modes')} onClick={onOpenModes} />}
                    />
                    <SettingsRow
                        icon={<ProfileIntelligenceIcon size={20} />}
                        title={t('Add your résumé')}
                        badge={
                            <Presence kind="badge" id={status.profile.state === 'locked' ? 'pro' : 'optional'}>
                                <LiquidGlassBadge variant="neutral">{status.profile.state === 'locked' ? t('Pro') : t('Optional')}</LiquidGlassBadge>
                            </Presence>
                        }
                        description={t(status.profile.detail)}
                        descriptionKey={status.profile.detail}
                        control={onOpenProfile && <GoButton label={t('Profile')} onClick={onOpenProfile} />}
                    />
                </div>
                </SettingsMotionReady.Provider>
                {/* How Natively works: the answer path as a figure on every
                    platform, then, where one was recorded (macOS), the real thing
                    happening. After the steps, so what is left to do comes first. */}
                <div className="mt-6">
                    <HelpSubhead>{t('How an answer is made')}</HelpSubhead>
                </div>
                <div className="mt-2 space-y-2">
                    <HelpFigure>
                        <AnswerFlowFigure />
                    </HelpFigure>
                    {answerClip && (
                        <div className="pt-1">
                            <HelpClip clip={answerClip} label={answerClip.label} />
                        </div>
                    )}
                </div>
            </section>

            {/* ── Shortcuts ───────────────────────────────────────────────── */}
            <section>
                <SettingsSectionHeading
                    title={t('Shortcuts')}
                    subtitle={t('The keys you will use most. Change any of them in Keybinds.')}
                />
                <div className={ROW_GROUP}>
                    <SettingsRow icon={<Eye size={20} />} title={t('Show or hide Natively')}
                        description={t('Works everywhere, even with global shortcuts off.')}
                        control={<HelpKeys keys={shortcuts.toggleVisibility ?? []} />} />
                    <SettingsRow icon={<MessageSquareText size={20} />} title={t('What to answer?')}
                        description={t('Answers the last thing said, with any screenshots you attached.')}
                        control={<HelpKeys keys={shortcuts.whatToAnswer ?? []} />} />
                    <SettingsRow icon={<MousePointerClick size={20} />} title={t('Use a suggestion')}
                        description={t('Takes the suggestion showing at the top of the overlay.')}
                        control={<HelpKeys keys={shortcuts.acceptSuggestion ?? []} />} />
                    <SettingsRow icon={<TextCursorInput size={20} />} title={t('Type into the overlay')}
                        description={t('Types in the overlay without leaving your meeting app.')}
                        control={<HelpKeys keys={shortcuts.focusInput ?? []} />} />
                    <SettingsRow icon={<MonitorUp size={20} />} title={t('Capture screen & ask AI')}
                        description={t('Screenshots your whole screen and answers about it.')}
                        control={<HelpKeys keys={shortcuts.captureAndProcess ?? []} />} />
                    <SettingsRow icon={<Crop size={20} />} title={t('Selective screenshot')}
                        description={t('Drag over part of the screen to attach it to your next question.')}
                        control={<HelpKeys keys={shortcuts.selectiveScreenshot ?? []} />} />
                    <SettingsRow icon={<Globe size={20} />} title={t('Send this web page')}
                        description={t('Sends the page in your browser, through the Companion extension.')}
                        control={<HelpKeys keys={shortcuts.capturePage ?? []} />} />
                    <SettingsRow icon={<PointerOff size={20} />} title={t('Mouse passthrough')}
                        description={t('Clicks go through the overlay. Press again to click it.')}
                        control={<HelpKeys keys={shortcuts.toggleMousePassthrough ?? []} />} />
                    <SettingsRow icon={<Move size={20} />} title={t('Move the overlay')}
                        description={t('Nudges the overlay while a meeting is running.')}
                        control={<HelpKeys keys={moveKeys(shortcuts)} />} />
                    <SettingsRow icon={<Keyboard size={20} />} title={t('All shortcuts')}
                        description={t('Recap, Clarify, Follow Up, scrolling and more.')}
                        control={onNavigate && <GoButton label={t('Keybinds')} onClick={go('keybinds')} />} />
                </div>
                <SettingsFootnote icon={<Info size={13} />}>
                    {t('What to answer?, suggestions and moving the overlay only work while a meeting is running. Suggestions appear when a mode is active.')}
                    {facts.shortcutGuard && (
                        <> {t('Protect Natively shortcuts, in General, stops them from also typing into the app underneath.')}</>
                    )}
                </SettingsFootnote>
            </section>

            {/* ── Guides ──────────────────────────────────────────────────── */}
            <section>
                <SettingsSectionHeading
                    title={t('Guides')}
                    subtitle={t('Every part of Natively, in the order you meet it. Press a recording\'s step to jump to it.')}
                />
                <HelpGuideSearch
                    value={query}
                    onChange={setQuery}
                    placeholder={t('Search guides, like "notepad", "pdf" or "mute"')}
                    resultLabel={visible.length === 1 ? t('1 guide') : `${visible.length} ${t('guides')}`}
                    clearLabel={t('Clear search')}
                />
                {visible.length === 0 && (
                    <p className="px-1 py-6 text-center text-xs text-text-secondary">
                        {t('No guide mentions that.')}{' '}
                        <button
                            type="button"
                            onClick={() => setQuery('')}
                            className="text-accent-primary underline decoration-transparent hover:decoration-current transition-colors duration-150 ease-out"
                        >
                            {t('Show all guides')}
                        </button>
                    </p>
                )}
                {GUIDE_GROUPS.map((group) => {
                    const inGroup = guides.filter((g) => g.group === group.id);
                    const shown = inGroup.filter((g) => visibleIds.has(g.id)).length;
                    return (
                        <div key={group.id} hidden={shown === 0}>
                            <HelpGroupLabel title={t(group.title)} count={shown} />
                            <div className={ROW_GROUP}>
                                {inGroup.map((guide) => (
                                    <div key={guide.id} hidden={!visibleIds.has(guide.id)} data-help-guide={guide.id}>
                                        <HelpGuideRow icon={guide.icon} title={guide.title} description={guide.description}>
                                            {guide.body}
                                        </HelpGuideRow>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </section>
        </div>
    );
};
