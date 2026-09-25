import React from 'react';
import {
    ArrowRight, AudioLines, Code, Crop, Eye, FileText, Ghost, Info, Keyboard, LayoutGrid,
    MessageSquareText, MonitorUp, Move, PanelTop, PointerOff, ShieldCheck, Smartphone, FlaskConical,
    TriangleAlert, UserRound,
} from 'lucide-react';
import { useT } from '../../i18n';
import { useShortcuts, type ShortcutConfig } from '../../hooks/useShortcuts';
import { isMac, isWindows } from '../../utils/platformUtils';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { LiquidGlassBadge } from '../../ui-components/LiquidGlassBadge';
import {
    SETTINGS_BTN, SettingsFootnote, SettingsMotionReady, SettingsNotice, SettingsRow,
    SettingsSectionHeading, useSettingsTones,
} from './SettingsRow';
import {
    HelpCommand, HelpDefinitions, HelpFigure, HelpGuideRow, HelpKeys, HelpLegend, HelpLink,
    HelpPath, HelpSteps, HelpSubhead, HelpVideo,
} from './help/HelpParts';
import { AnswerFlowFigure, NativelyGlyph, OverlayAnatomyFigure, PermissionsFigure } from './help/HelpGraphics';
import {
    getPermissions, getPlatformFacts, getRowCopy, isHelpPlatform,
    type HelpPermission, type HelpPlatform,
} from '../../lib/helpContent.mjs';
import zoomCaptureModeScreenshot from '../../assets/zoom-capture-mode.png';
// Screen recordings of the real app, made 2026-09-25 on macOS against the dev
// build. Which platform may show each is decided in helpContent.mjs.
import whatToAnswerClip from '../../assets/help/what-to-answer.webm';
import speechProviderClip from '../../assets/help/speech-provider.webm';
import speechProviderClipLight from '../../assets/help/speech-provider-light.webm';
import activeModelClip from '../../assets/help/active-model.webm';
import activeModelClipLight from '../../assets/help/active-model-light.webm';

// Settings → Setup & Help.
//
// Built from `./SettingsRow`, the module General, Audio, Sync, Intelligence and
// About are built from, so this pane reads as part of Settings: a section is an
// 18px heading over one short line, and everything under it is the same row —
// [40px tile][14px/700 title][12px description][control]. Guides are those rows
// with a body that opens beneath, and every body is made of the same few parts
// (HelpParts), so text starts at one x in every guide.
//
// Nothing here restates a fact the app owns. Keys come from the user's own
// bindings (useShortcuts), never from a table, so a rebound key is shown as it
// is. Platform differences come from src/lib/helpContent.mjs, where both the
// macOS and Windows branches are tested. The copy names UI labels rather than
// model ids, counts, durations or prices, which is what made the previous
// version of this page wrong within weeks.

const CHROME_WEB_STORE_URL = 'https://chromewebstore.google.com/detail/lmhgnkbjnelmciecjkleaomjpejcgaln?utm_source=item-share-cb';
const OLLAMA_DOWNLOAD_URL = 'https://ollama.com/download';
// The model AI Providers' own Ollama empty state suggests (AIProvidersSettings).
const OLLAMA_STARTER_COMMAND = 'ollama pull qwen2.5:3b';

// Rows separate by rhythm, not rules — General's container, verbatim (see About).
const ROW_GROUP = 'rounded-xl border bg-transparent border-transparent';

/** A navigation button in a row's control rail: "Audio →". */
const GoButton: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
    <button type="button" onClick={onClick} className={SETTINGS_BTN}>
        {label}
        <ArrowRight size={13} />
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

export const HelpSettings: React.FC<{
    onNavigate?: (tab: string) => void;
    /** Injectable for the harness and tests; defaults to the running OS. */
    platform?: string;
}> = ({ onNavigate, platform = currentHelpPlatform() }) => {
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
        // Collapse animates only once the pane says it is ready; Help has no IPC
        // read to wait for, so it is ready from the first render.
        <SettingsMotionReady.Provider value>
            <HelpPane platform={platform} onNavigate={onNavigate} shortcuts={shortcuts} t={t} tones={tones} />
        </SettingsMotionReady.Provider>
    );
};

const HelpPane: React.FC<{
    platform: HelpPlatform;
    onNavigate?: (tab: string) => void;
    shortcuts: ShortcutConfig;
    t: (text: string) => string;
    tones: ReturnType<typeof useSettingsTones>;
}> = ({ platform, onNavigate, shortcuts, t, tones }) => {
    const facts = getPlatformFacts(platform);
    // Settings recordings come in both themes so a clip matches the pane around
    // it. The overlay recording is one version: it is footage of a desktop, not
    // Settings UI, and reads as a picture of the screen in either theme.
    const isLight = useResolvedTheme() === 'light';
    const rowCopy = getRowCopy(platform);
    const permissions = getPermissions(platform);
    const mac = platform === 'darwin';
    const go = (tab: string) => () => onNavigate?.(tab);
    const keys = (id: keyof ShortcutConfig) => <HelpKeys inline keys={shortcuts[id] ?? []} />;

    return (
        <div className="space-y-6 pb-10" data-settings-stagger>
            {/* ── Get started ─────────────────────────────────────────────── */}
            <section>
                <SettingsSectionHeading
                    title={t('Get started')}
                    subtitle={t('Natively needs permissions, a speech provider and an AI model.')}
                />
                <div className="mt-3 mb-1">
                    <HelpFigure>
                        <AnswerFlowFigure />
                    </HelpFigure>
                </div>
                <div className={ROW_GROUP}>
                    <SettingsRow
                        icon={<NativelyGlyph size={20} />}
                        title={t('Natively API')}
                        description={t('One key sets up the AI model and speech for you.')}
                        control={onNavigate && <GoButton label={t('Plans & Billing')} onClick={go('plans')} />}
                    />
                    <SettingsRow
                        icon={<ShieldCheck size={20} />}
                        title={t('Allow permissions')}
                        description={t(rowCopy.permissionsStep)}
                        control={
                            <button type="button" className={SETTINGS_BTN} onClick={() => openPermission(permissions[0])}>
                                {t('Open')}
                                <ArrowRight size={13} />
                            </button>
                        }
                    />
                    <SettingsRow
                        icon={<AudioLines size={20} />}
                        title={t('Choose a speech provider')}
                        description={t('Turns what is said in the meeting into text.')}
                        control={onNavigate && <GoButton label={t('Audio')} onClick={go('audio')} />}
                    />
                    <SettingsRow
                        icon={<FlaskConical size={20} />}
                        title={t('Choose an AI model')}
                        description={t('Writes the answers. Add a key, sign in, or run one locally.')}
                        control={onNavigate && <GoButton label={t('AI Providers')} onClick={go('ai-providers')} />}
                    />
                    <SettingsRow
                        icon={<UserRound size={20} />}
                        title={t('Add your context')}
                        badge={<LiquidGlassBadge variant="neutral">{t('Optional')}</LiquidGlassBadge>}
                        description={t('Modes and Profile Intelligence, from the Launcher header.')}
                    />
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
                    <SettingsRow icon={<MonitorUp size={20} />} title={t('Capture screen & ask AI')}
                        description={t('Screenshots your whole screen and answers about it.')}
                        control={<HelpKeys keys={shortcuts.captureAndProcess ?? []} />} />
                    <SettingsRow icon={<Crop size={20} />} title={t('Selective screenshot')}
                        description={t('Drag over part of the screen to attach it to your next question.')}
                        control={<HelpKeys keys={shortcuts.selectiveScreenshot ?? []} />} />
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
                    {t('What to answer? and moving the overlay only work while a meeting is running.')}
                    {facts.shortcutGuard && (
                        <> {t('Protect Natively shortcuts, in General, stops them from also typing into the app underneath.')}</>
                    )}
                </SettingsFootnote>
            </section>

            {/* ── Guides ──────────────────────────────────────────────────── */}
            <section>
                <SettingsSectionHeading
                    title={t('Guides')}
                    subtitle={t('How each part of Natively works, step by step.')}
                />
                <div className={ROW_GROUP}>
                    {/* Permissions */}
                    <HelpGuideRow icon={<ShieldCheck size={20} />} title={t('Permissions')} description={t(rowCopy.permissionsGuide)}>
                        <HelpFigure>
                            <PermissionsFigure platform={platform} />
                        </HelpFigure>
                        {mac ? (
                            <p>Natively asks for each permission the first time it needs it. If you said no, turn it on by hand:</p>
                        ) : (
                            <p>{permissions[0].why} If Natively can't hear you, check these:</p>
                        )}
                        <HelpSteps
                            steps={[
                                ...permissions.map((permission) => (
                                    <>
                                        Open <HelpPath parts={permission.path} />
                                        {permission.olderTitle && <> ({permission.olderTitle} on macOS 14 and earlier)</>}
                                        {mac
                                            ? <> and turn on Natively. </>
                                            : <> and turn on Microphone access and Let desktop apps access your microphone. </>}
                                        <button type="button" onClick={() => openPermission(permission)} className="text-accent-primary hover:underline">
                                            Open
                                        </button>
                                    </>
                                )),
                                facts.restartAfterGrant
                                    ? <>Quit Natively completely and open it again. macOS applies screen permission only after a restart.</>
                                    : <>Start the meeting again in Natively.</>,
                            ]}
                        />
                        {facts.stealthTypingNeedsAccessibility && (
                            <p>Accessibility is only for Stealth Typing ({keys('focusInput')}). Natively asks for it the first time you use it.</p>
                        )}
                    </HelpGuideRow>

                    {/* Speech providers */}
                    <HelpGuideRow icon={<AudioLines size={20} />} title={t('Speech providers')} description={t('What each provider needs, plus language and audio devices.')}>
                        <p>
                            Choose one in <HelpPath parts={['Audio', 'Speech Provider']} />, paste its key, press Save, then Test Connection.
                        </p>
                        {facts.recordings.speechProviders && (
                            <HelpVideo
                                src={isLight ? speechProviderClipLight : speechProviderClip}
                                size={[972, 834]}
                                label="Settings, Audio: the Speech Provider list opens and Deepgram Nova-3 is chosen, which shows its API key field."
                            />
                        )}
                        <HelpDefinitions
                            items={[
                                { term: 'Natively API', detail: 'Nothing to paste. It appears once you add a Natively key in Plans & Billing.' },
                                ...(facts.onDeviceSpeech.includes('Apple Speech')
                                    ? [{ term: 'Apple Speech', detail: 'Runs on this Mac. Needs macOS 26 or later.' }]
                                    : []),
                                { term: 'Local Models', detail: 'Runs on this computer once you download a model.' },
                                { term: 'Google Cloud', detail: 'A service-account JSON file, chosen with Select File. Not an API key.' },
                                { term: 'Azure Speech', detail: 'An API key and its Region, such as eastus.' },
                                { term: 'ElevenLabs Scribe', detail: 'An API key with Speech to Text access.' },
                                { term: 'Everything else', detail: "An API key from the provider's console." },
                            ]}
                        />
                        <p>Groq Whisper and OpenAI Whisper keys here are separate from the keys in AI Providers.</p>
                        <HelpSubhead>Language</HelpSubhead>
                        <p>
                            Language starts on Auto Detect. Picking yours makes transcripts more accurate, and English also offers Accent / Region.
                            On-device engines support fewer languages.
                        </p>
                        <HelpSubhead>Audio devices</HelpSubhead>
                        <p>
                            In <HelpPath parts={['Audio', 'Audio Configuration']} />, Input Device is your microphone. {facts.systemAudio.summary} {facts.systemAudio.fix}
                        </p>
                    </HelpGuideRow>

                    {/* AI models */}
                    <HelpGuideRow icon={<FlaskConical size={20} />} title={t('AI models')} description={t('Keys, sign-ins, local models, and switching models mid-meeting.')}>
                        <p>
                            In <HelpPath parts={['AI Providers']} />, add a key under Cloud Providers, or sign in with Google Antigravity or OpenAI Codex.
                            Then choose it in Active Model at the top. It applies to new chats straight away.
                        </p>
                        {facts.recordings.activeModel && (
                            <HelpVideo
                                src={isLight ? activeModelClipLight : activeModelClip}
                                size={[972, 392]}
                                label="Settings, AI Providers: the Active Model menu opens and another model is chosen."
                            />
                        )}
                        <p>During a meeting, the model button under the overlay's ask box switches models without opening Settings.</p>
                        <HelpSubhead>Run a model on this computer</HelpSubhead>
                        <HelpSteps
                            steps={[
                                <>Install Ollama from <HelpLink href={OLLAMA_DOWNLOAD_URL}>ollama.com</HelpLink>.</>,
                                <div className="space-y-2">
                                    <div>In {facts.terminal}, download a model that can chat:</div>
                                    <HelpCommand command={OLLAMA_STARTER_COMMAND} />
                                </div>,
                                <>
                                    Open <HelpPath parts={['AI Providers', 'Local & Gateways']} />. Natively finds Ollama by itself, and Auto-Fix
                                    Connection starts it if it isn't running.
                                </>,
                            ]}
                        />
                        <HelpSubhead>Your own endpoint</HelpSubhead>
                        <p>
                            Custom Providers, under Local &amp; Gateways, takes a cURL command. Put <code className="font-mono text-text-primary">{'{{TEXT}}'}</code> where
                            the question goes, and <code className="font-mono text-text-primary">{'{{IMAGE_BASE64}}'}</code> if it accepts screenshots.
                            Response JSON Path is optional; for OpenAI-style APIs it is <code className="font-mono text-text-primary">choices[0].message.content</code>.
                            LiteLLM Proxy and 9Router have their own cards.
                        </p>
                        <HelpSubhead>Fast Response</HelpSubhead>
                        <p>
                            Fast Response Mode, in AI Providers or behind the lightning in the overlay's quick settings, sends text questions a faster way.
                            It needs a Groq key or Natively API, and leaves screenshot questions as they are.
                        </p>
                    </HelpGuideRow>

                    {/* The overlay */}
                    <HelpGuideRow icon={<PanelTop size={20} />} title={t('The overlay')} description={t('Every button on the overlay, and the pill above it.')}>
                        {facts.recordings.overlay && (
                            <HelpVideo
                                src={whatToAnswerClip}
                                size={[972, 616]}
                                label="The overlay during a meeting: the interviewer's question scrolls past in the live transcript, What to answer? is pressed, and a suggested answer appears."
                                caption="The interviewer asks a question. What to answer? writes a reply you can say."
                            />
                        )}
                        <HelpFigure>
                            <OverlayAnatomyFigure />
                        </HelpFigure>
                        <HelpLegend
                            items={[
                                { title: 'The pill', body: <>The logo takes you to the Launcher, where Meeting ongoing brings you back. Hide hides the overlay; press {keys('toggleVisibility')} to show it again. The square ends the meeting.</> },
                                { title: 'Live transcript', body: 'What is being said, as your speech provider hears it.' },
                                { title: 'Quick actions', body: 'What to answer? replies to the last thing said. Clarify gives you a question to ask. Recap sums up what was just said, and becomes Brainstorm when Interview Mode is on. Follow Up Question suggests what to ask next. Answer records you; press it again to send.' },
                                { title: 'Ask box', body: <>Type any question. {keys('selectiveScreenshot')} attaches part of the screen.</> },
                                { title: 'Model', body: 'Switches the AI model.' },
                                { title: 'Quick settings', body: 'Undetectable, Fast Response, Transcript and Interview Mode.' },
                                { title: 'Mouse passthrough', body: 'Lets clicks go through the overlay to the app behind it.' },
                            ]}
                        />
                        <SettingsNotice tone={tones.warn} icon={<TriangleAlert size={14} />} className="mb-0">
                            With mouse passthrough on, the overlay can't be clicked. Press {keys('toggleMousePassthrough')} to turn it off. It also turns off when the meeting ends.
                        </SettingsNotice>
                    </HelpGuideRow>

                    {/* Meetings and search */}
                    <HelpGuideRow icon={<FileText size={20} />} title={t('Meetings and search')} description={t('Notes after each meeting, asking about one, and finding it again.')}>
                        <p>
                            When a meeting ends, Natively writes its notes: key points, action items, decisions, next steps and a follow-up draft.
                            Meetings are stored on this computer. To keep nothing, turn on Do not save meetings in <HelpPath parts={['General']} />.
                        </p>
                        <p>
                            Notes are written by Natively API, Groq, Gemini, Ollama, or a Codex or Antigravity sign-in, whichever you have. With
                            only an OpenAI, Claude, DeepSeek or OpenRouter key, the Summary tab says Notes couldn't be generated.
                        </p>
                        <p>
                            Open a meeting from the Launcher. Summary holds the notes, Transcript what was said, and Usage every question you asked
                            during it. Your microphone is labelled Me and meeting audio Speaker 1; rename either in Transcript.
                        </p>
                        <p>Ask about this meeting, at the bottom, answers from that meeting's transcript.</p>
                        <p>
                            In the Launcher, <HelpKeys inline keys={[facts.modifierKey, 'K']} /> opens search. Type to find a past meeting by its
                            title or summary, or press Enter to ask AI.
                        </p>
                    </HelpGuideRow>

                    {/* Modes and Profile Intelligence */}
                    <HelpGuideRow icon={<LayoutGrid size={20} />} title={t('Modes and Profile Intelligence')} description={t('Shape answers around the meeting, your résumé and the job.')}>
                        <p>
                            Both open from the Launcher header: Modes is the grid icon, Profile Intelligence the person icon. Both are
                            part of Natively Pro, which you activate in <HelpPath parts={['Plans & Billing']} />; an active free trial
                            opens Modes too.
                        </p>
                        <HelpSubhead>Modes</HelpSubhead>
                        <HelpSteps
                            steps={[
                                'Click New Mode, or start from one in Natively Templates.',
                                "Write a Real-time prompt and press Save. It's added to every answer while the mode is active.",
                                'Add Reference files, then choose its Knowledge source and Answer policy.',
                                "Press Set active. Deactivate returns to Natively's default behaviour.",
                            ]}
                        />
                        <HelpSubhead>Profile Intelligence</HelpSubhead>
                        <p>
                            In Identity, upload your résumé and the job description with Upload file. Natively builds your profile and researches
                            the company in Company Intel. Each mode's Knowledge source decides whether its answers use them.
                        </p>
                    </HelpGuideRow>

                    {/* Staying invisible */}
                    <HelpGuideRow icon={<Ghost size={20} />} title={t('Staying invisible')} description={t('Keep Natively out of screen shares and recordings.')}>
                        <p>
                            Turn on Undetectable in <HelpPath parts={['General']} /> or the overlay's quick settings; it stays off until you do.
                            Natively's windows are then left out of screen shares and recordings, and {facts.undetectable.hides} is hidden.
                            {' '}{facts.undetectable.caveat} Check with a test share before a call that matters.
                        </p>
                        {facts.zoomGuide && (
                            <>
                                <HelpSubhead>Zoom</HelpSubhead>
                                <p>
                                    Zoom needs one setting. In <HelpPath parts={['Zoom', 'Settings', 'Share Screen', 'Advanced']} />, set Screen
                                    capture mode to Advanced capture with window filtering. The modes without window filtering capture Natively.
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
                        <HelpSubhead>Lower your profile further</HelpSubhead>
                        <p>
                            Process Disguise, in General, makes Natively look like {facts.disguises.join(', ').replace(/, ([^,]*)$/, ' or $1')}.
                            Interface Opacity, also in General, makes the overlay see-through. Stealth Typing ({keys('focusInput')}) lets you type
                            into Natively without taking focus from the app you're in{facts.stealthTypingNeedsAccessibility ? ', and needs Accessibility permission' : ''}.
                        </p>
                    </HelpGuideRow>

                    {/* Phone and browser */}
                    <HelpGuideRow icon={<Smartphone size={20} />} title={t('Phone and browser')} description={t('Follow answers on your phone and send web pages to Natively.')}>
                        <HelpSubhead>Phone Mirror</HelpSubhead>
                        <HelpSteps
                            steps={[
                                <>In <HelpPath parts={['Sync']} />, turn on Enable Phone Mirror.</>,
                                'Turn on Allow LAN access so your phone can reach it over the same Wi-Fi.',
                                "On Pair a phone, press Show code and scan it with your phone's camera.",
                            ]}
                        />
                        <p>Your phone shows the chat as it happens and can send questions back. Reset pairing disconnects every phone and the browser extension.</p>
                        <SettingsNotice tone={tones.warn} icon={<TriangleAlert size={14} />} className="mb-0">
                            Turn on Allow LAN access only on networks you trust. Anyone with the pairing link can read your answers until you reset pairing.
                        </SettingsNotice>
                        <HelpSubhead>Browser extension</HelpSubhead>
                        <HelpSteps
                            steps={[
                                <>Install Natively Companion from the <HelpLink href={CHROME_WEB_STORE_URL}>Chrome Web Store</HelpLink>.</>,
                                <>With Phone Mirror on, press Connect on the Natively Companion row in <HelpPath parts={['Sync']} />.</>,
                                "Within a minute, click the extension's icon and press Connect to Natively.",
                                'In the extension, turn on Allow on all sites.',
                            ]}
                        />
                        <p>Then {keys('capturePage')} sends the page you're reading to Natively. On a page it can't read, it takes a screenshot instead.</p>
                    </HelpGuideRow>

                    {/* Verify coding answers */}
                    <HelpGuideRow icon={<Code size={20} />} title={t('Verify coding answers')} description={t('Runs the code in an answer to check it, and fixes it if it fails.')}>
                        <p>It stays off until you turn on Verify coding answers in <HelpPath parts={['General', 'Advanced']} />.</p>
                        <p>
                            Natively runs the code in a temporary folder with a time limit. A passing answer shows ✓ verified. A failing one is sent
                            back to the model with the error, and replaced by a Corrected answer only if the fix passes too.
                        </p>
                        <p>
                            It uses tools already installed on this computer: {facts.pythonCommand} for Python, node, g++, javac and java, go, and
                            sqlite3.{facts.sqliteBundled ? '' : " sqlite3 doesn't come with Windows."} A language without its tool is skipped.
                        </p>
                    </HelpGuideRow>
                </div>
            </section>
        </div>
    );
};
