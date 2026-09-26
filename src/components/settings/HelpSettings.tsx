import React, { useEffect, useState } from 'react';
import {
    ArrowRight, AudioLines, Check, Code, Crop, Eye, FileText, FlaskConical, Ghost, Info, Keyboard, LayoutGrid,
    MessageSquareText, MonitorUp, Move, PanelTop, PointerOff, ShieldCheck, Smartphone, TriangleAlert,
    UserRound,
} from 'lucide-react';
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
    HelpClip, HelpCommand, HelpDefinitions, HelpFigure, HelpGuideRow, HelpKeys, HelpLegend, HelpLink,
    HelpPath, HelpSteps, HelpSubhead,
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
// Built from `./SettingsRow`, the module General, Audio, Sync, Intelligence and
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

/**
 * A step's tile glyph, with a green check at the tile's corner once the step is
 * done. The check pops in (Presence "badge") when a step completes while the
 * pane is open — the one motion in Get started, and one that means something.
 */
const StepIcon: React.FC<{ done: boolean; children: React.ReactNode }> = ({ done, children }) => (
    <span className="relative flex items-center justify-center">
        {children}
        <span className="absolute -right-[16px] -bottom-[16px] flex">
            <Presence kind="badge" id={done ? 'done' : null}>
                <span className="flex w-[18px] h-[18px] items-center justify-center rounded-full bg-emerald-500 text-white ring-2 ring-[var(--bg-main)]">
                    <Check size={11} strokeWidth={3} />
                </span>
            </Presence>
        </span>
    </span>
);

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
    // Get started opens on what is already true, with no motion: descriptions
    // don't swap away from "Checking…" and ticks don't pop in for steps done
    // long ago (SettingsRow's rule — state already true on open isn't news).
    // Only a change while the pane is open, such as a permission granted in
    // System Settings, animates.
    const setupReady = useMotionReadyAfter(status.loaded);
    const isLight = useResolvedTheme() === 'light';
    const mac = platform === 'darwin';
    const go = (tab: string) => () => onNavigate?.(tab);
    const keys = (id: keyof ShortcutConfig) => <HelpKeys inline keys={shortcuts[id] ?? []} />;
    /** A guide's recording, when this platform may be shown it. */
    const clip = (id: keyof typeof HELP_CLIPS): HelpClipEntry | null => (facts.clips[id] ? HELP_CLIPS[id] : null);
    const answerClip = clip('answer');
    const speechClip = clip('speech');
    const modelClip = clip('model');
    const modesClip = clip('modes');
    const profileClip = clip('profile');
    const stealthClip = clip('stealth');
    const syncClip = clip('sync');
    const verifyClip = clip('verify');
    const notesClip = clip('notes');
    const searchClip = clip('search');

    // A step's action is the Liquid Glass action button (Sync's Connect) while
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

    return (
        <div className="space-y-6 pb-10" data-settings-stagger>
            {/* ── Get started ─────────────────────────────────────────────── */}
            <section>
                <SettingsSectionHeading
                    title={t('Get started')}
                    subtitle={t('Natively needs permissions, a speech provider and an AI model.')}
                />
                {/* How Natively works, where the answer-flow figure used to be: a
                    recording on macOS, the figure where there is none. */}
                <div className="mt-3 mb-2 space-y-2">
                    <HelpSubhead>{t('How Natively works')}</HelpSubhead>
                    {answerClip ? (
                        <HelpClip clip={answerClip} label={answerClip.label} />
                    ) : (
                        <HelpFigure>
                            <AnswerFlowFigure />
                        </HelpFigure>
                    )}
                </div>
                <SettingsMotionReady.Provider value={setupReady}>
                <div className={ROW_GROUP}>
                    <SettingsRow
                        icon={<StepIcon done={status.natively.state === 'done'}><NativelyGlyph size={20} /></StepIcon>}
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
                        icon={<StepIcon done={status.permissions?.state === 'done'}><ShieldCheck size={20} /></StepIcon>}
                        title={t('Allow permissions')}
                        description={t(status.permissions?.detail ?? rowCopy.permissionsStep)}
                        descriptionKey={status.permissions?.detail ?? 'unknown'}
                        control={stepAction(status.permissions, t('Open'), () => openPermission(permissions[0]))}
                    />
                    <SettingsRow
                        icon={<StepIcon done={status.speech.state === 'done'}><AudioLines size={20} /></StepIcon>}
                        title={t('Choose a speech provider')}
                        description={t(status.speech.detail)}
                        descriptionKey={status.speech.detail}
                        control={onNavigate && stepAction(status.speech, t('Audio'), go('audio'))}
                    />
                    <SettingsRow
                        icon={<StepIcon done={status.model.state === 'done'}><FlaskConical size={20} /></StepIcon>}
                        title={t('Choose an AI model')}
                        description={t(status.model.detail)}
                        descriptionKey={status.model.detail}
                        control={onNavigate && stepAction(status.model, t('AI Providers'), go('ai-providers'))}
                    />
                    {/* Optional, so never the blue call to action — but real steps:
                        each says what is set and opens its manager, which shows
                        its own Pro gate when locked. */}
                    <SettingsRow
                        icon={<StepIcon done={status.mode.state === 'done'}><LayoutGrid size={20} /></StepIcon>}
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
                        icon={<StepIcon done={status.profile.state === 'done'}><UserRound size={20} /></StepIcon>}
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
                    subtitle={t('Short recordings of each part of Natively. Press a step to jump to it.')}
                />
                <div className={ROW_GROUP}>
                    {/* Permissions */}
                    <HelpGuideRow icon={<ShieldCheck size={20} />} title={t('Permissions')} description={t(rowCopy.permissionsGuide)}>
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
                            <p>Accessibility is only for Stealth Typing ({keys('focusInput')}). Natively asks the first time you use it.</p>
                        )}
                    </HelpGuideRow>

                    {/* Speech providers */}
                    <HelpGuideRow
                        icon={<AudioLines size={20} />}
                        title={t('Speech providers')}
                        description={t('Pick who turns the meeting into text, and your language.')}
                    >
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
                                { term: 'Local Models', detail: 'Runs on this computer after a one-time download.' },
                                { term: 'Google Cloud', detail: 'A service-account JSON file, chosen with Select File.' },
                                { term: 'Azure Speech', detail: 'An API key and its Region, such as eastus.' },
                                { term: 'Everything else', detail: "An API key from the provider's console." },
                            ]}
                        />
                        <p>A few languages are offered only by the Parakeet local model. {facts.systemAudio.fix}</p>
                    </HelpGuideRow>

                    {/* AI models */}
                    <HelpGuideRow
                        icon={<FlaskConical size={20} />}
                        title={t('AI models')}
                        description={t('Choose the model that answers, or bring your own.')}
                    >
                        {modelClip ? (
                            <HelpClip clip={modelClip} label={modelClip.label} />
                        ) : (
                            <p>
                                In <HelpPath parts={['AI Providers']} />, add a key under Cloud Providers, then choose the model in Active Model.
                            </p>
                        )}
                        <p>During a meeting, the model button under the overlay's ask box switches models without opening Settings.</p>
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
                    </HelpGuideRow>

                    {/* The overlay */}
                    <HelpGuideRow icon={<PanelTop size={20} />} title={t('The overlay')} description={t('Every button on the overlay, and the pill above it.')}>
                        <HelpFigure>
                            <OverlayAnatomyFigure />
                        </HelpFigure>
                        <HelpLegend
                            items={[
                                { title: 'The pill', body: <>The logo opens the Launcher. Hide hides the overlay; {keys('toggleVisibility')} brings it back. The square ends the meeting.</> },
                                { title: 'Live transcript', body: 'What is being said, as your speech provider hears it.' },
                                { title: 'Quick actions', body: 'What to answer?, Clarify, Recap (Brainstorm in Interview Mode), Follow Up Question, and Answer, which records you.' },
                                { title: 'Ask box', body: <>Type any question. {keys('selectiveScreenshot')} attaches part of the screen.</> },
                                { title: 'Model', body: 'Switches the AI model.' },
                                { title: 'Quick settings', body: 'Undetectable, Fast Response, Transcript and Interview Mode.' },
                                { title: 'Mouse passthrough', body: 'Lets clicks go through to the app behind.' },
                            ]}
                        />
                        <p>Turn on Auto Answer in <HelpPath parts={['General']} /> and answers appear as soon as the interviewer finishes a question.</p>
                        <SettingsNotice tone={tones.warn} icon={<TriangleAlert size={14} />} className="mb-0">
                            With mouse passthrough on, the overlay can't be clicked. Press {keys('toggleMousePassthrough')} to turn it off.
                        </SettingsNotice>
                    </HelpGuideRow>

                    {/* Meetings and search */}
                    <HelpGuideRow
                        icon={<FileText size={20} />}
                        title={t('Meetings and search')}
                        description={t('Notes after each meeting, asking about one, and finding it again.')}
                    >
                        {notesClip ? (
                            <HelpClip clip={notesClip} label={notesClip.label} />
                        ) : (
                            <p>Open a meeting from the Launcher: Summary holds its notes, Transcript what was said, Usage what you asked.</p>
                        )}
                        <p>
                            Notes are written by Natively API, Groq, Gemini, a Codex or Antigravity sign-in, your own endpoint, or Ollama when
                            it is your model. With only an OpenAI, Claude, DeepSeek or OpenRouter key, the Summary says Notes couldn't be generated.
                        </p>
                        <HelpSubhead>Find it again</HelpSubhead>
                        {searchClip && <HelpClip clip={searchClip} label={searchClip.label} />}
                        <p>
                            <HelpKeys inline keys={[facts.modifierKey, 'K']} /> opens search in the Launcher and finds a meeting by its title;
                            Enter asks AI instead. To keep nothing, turn on Do not save meetings in <HelpPath parts={['General']} />.
                        </p>
                    </HelpGuideRow>

                    {/* Modes */}
                    <HelpGuideRow
                        icon={<LayoutGrid size={20} />}
                        title={t('Modes')}
                        description={t('Tell Natively how to answer in each kind of meeting.')}
                    >
                        {modesClip ? (
                            <HelpClip clip={modesClip} label={modesClip.label} />
                        ) : (
                            <p>Open Modes from the grid icon in the Launcher header, pick a mode, write its Real-time prompt, then Set active.</p>
                        )}
                        <p>
                            Reference files give a mode documents to answer from, and Deactivate returns to Natively's default. Modes and
                            Profile Intelligence are part of Natively Pro, in <HelpPath parts={['Plans & Billing']} />; a free trial opens both.
                        </p>
                    </HelpGuideRow>

                    {/* Profile Intelligence */}
                    <HelpGuideRow
                        icon={<UserRound size={20} />}
                        title={t('Profile Intelligence')}
                        description={t('Answers built from your résumé and the job you want.')}
                    >
                        {profileClip ? (
                            <HelpClip clip={profileClip} label={profileClip.label} />
                        ) : (
                            <p>Open it from the person icon in the Launcher header, and upload your résumé and the job description.</p>
                        )}
                        <p>
                            Only the Looking for work and Technical Interview modes use it. Company Intel researches the company, and Cover
                            Letter drafts one from both documents.
                        </p>
                    </HelpGuideRow>

                    {/* Staying invisible */}
                    <HelpGuideRow
                        icon={<Ghost size={20} />}
                        title={t('Staying invisible')}
                        description={t('Keep Natively out of screen shares and recordings.')}
                    >
                        {stealthClip && <HelpClip clip={stealthClip} label={stealthClip.label} />}
                        <p>
                            Turn on the Detectable switch in <HelpPath parts={['General']} />; it then reads Undetectable. Natively's windows stay
                            out of screen shares and recordings, and {facts.undetectable.hides} is hidden. {facts.undetectable.caveat}
                        </p>
                        <p>
                            Process Disguise makes Natively look like {facts.disguises.join(', ').replace(/, ([^,]*)$/, ' or $1')} while
                            Undetectable is on. Choose it first: it can't be changed while Undetectable is on.
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
                    </HelpGuideRow>

                    {/* Phone and browser */}
                    <HelpGuideRow
                        icon={<Smartphone size={20} />}
                        title={t('Phone and browser')}
                        description={t('Follow answers on your phone and send web pages to Natively.')}
                    >
                        {syncClip ? (
                            <HelpClip clip={syncClip} label={syncClip.label} />
                        ) : (
                            <HelpSteps
                                steps={[
                                    <>In <HelpPath parts={['Sync']} />, turn on Enable Phone Mirror.</>,
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
                                <>With Phone Mirror on, press Connect on its row in <HelpPath parts={['Sync']} />.</>,
                                "Within a minute, click the extension's icon and press Connect to Natively.",
                            ]}
                        />
                        <p>
                            Then {keys('capturePage')} sends the page you're reading. Smart Browser Context, also in Sync, spots coding and
                            interview pages and attaches the problem when you ask.
                        </p>
                    </HelpGuideRow>

                    {/* Verify coding answers */}
                    <HelpGuideRow
                        icon={<Code size={20} />}
                        title={t('Verify coding answers')}
                        description={t('Runs the code in an answer to check it, and fixes it if it fails.')}
                    >
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
                    </HelpGuideRow>
                </div>
            </section>
        </div>
    );
};
