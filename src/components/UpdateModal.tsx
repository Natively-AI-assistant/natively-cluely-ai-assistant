// src/components/UpdateModal.tsx
//
// The update card. Presentational: UpdateBanner owns the updater events and
// passes the status in.
//
// Same two-pane family as the notification cards (SupportToaster.tsx holds
// the measured ink table): the words on a flat ground on the
// left, a light inset panel on the right. The panel shows the version, and
// while the update downloads a soft wave rises behind it with the progress.
//
//   idle         release notes, "Update now"
//   downloading  three steps with live size, speed and time left; wave rises
//   ready        steps complete, "Restart and update"
//   error        what went wrong, a way to the release page
//   instructions manual install steps (unsigned macOS builds, or a browser
//                download on Windows)
//
// Both the card and the corner toast pour out of, and back into, the bottom
// of the window like every other popup (GenieModal).
import React, { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { X, ArrowRight, Check } from 'lucide-react';
import { GenieModal } from './ui/GenieModal';
import { isMac } from '../utils/platformUtils';
import { APP_VERSION } from '../utils/appVersion';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { useT } from '../i18n';

export const LATEST_RELEASE_URL = 'https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant/releases/latest';

interface ReleaseNoteSection {
    title: string;
    items: string[];
}

interface ParsedReleaseNotes {
    version: string;
    summary: string;
    sections: ReleaseNoteSection[];
    fullBody?: string;
    url?: string;
}

/** electron-updater's download-progress payload, as far as the card uses it. */
export interface DownloadDetail {
    transferred?: number;
    total?: number;
    bytesPerSecond?: number;
}

interface UpdateModalProps {
    isOpen: boolean;
    updateInfo: any;
    parsedNotes: ParsedReleaseNotes | null;
    onDismiss: () => void;
    onInstall: () => void;
    downloadProgress: number;
    downloadDetail?: DownloadDetail | null;
    status: 'idle' | 'downloading' | 'ready' | 'error' | 'instructions';
    errorMessage?: string | null;
    instructionsArch?: 'arm64' | 'x64' | null;
    canAutoUpdate?: boolean;
    /** Skip the close genie: the corner toast is taking the card's place. */
    closeInstantly?: boolean;
}

// ─── Tokens ────────────────────────────────────────────────────
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

// The family's measured ink sets (the contrast table is in SupportToaster.tsx).
const INK_DARK = {
    strong: '#F2F2F4',
    body:   'rgba(255,255,255,0.66)',
    quiet:  'rgba(255,255,255,0.52)',
    faint:  'rgba(255,255,255,0.48)',
    rule:   'rgba(255,255,255,0.10)',
    well:   'rgba(255,255,255,0.05)',
    error:  '#FCA5A5',
};
const INK_LIGHT = {
    strong: '#0B1020',
    body:   'rgba(11,16,32,0.68)',
    quiet:  'rgba(11,16,32,0.66)',
    faint:  'rgba(11,16,32,0.58)',
    rule:   'rgba(11,16,32,0.12)',
    well:   'rgba(11,16,32,0.04)',
    error:  '#B42318',
};

// The panel is light in both themes, so its ink is fixed.
const PANEL = '#EDF0F5';
const PANEL_INK = { strong: '#0B1020', quiet: 'rgba(11,16,32,0.58)' };
const CLOSE_INK = { rest: 'rgba(11,16,32,0.34)', hover: 'rgba(11,16,32,0.92)' };
const WAVE = { top: '#C9D3E6', bottom: '#A9B8D4' };

// The cards' drop shadows, shared with the stand-in that carries each mid-genie.
const SHADOW = {
    light: '0 30px 70px -28px rgba(16,24,40,0.40)',
    dark:  '0 40px 90px -30px rgba(0,0,0,0.85)',
};
const TOAST_SHADOW = {
    light: '0 20px 50px -24px rgba(16,24,40,0.45)',
    dark:  '0 24px 60px -24px rgba(0,0,0,0.85)',
};

const EASE_CSS = 'cubic-bezier(0.23, 1, 0.32, 1)';
const CTA_IN  = 420;
const CTA_OUT = 280;

// Keyframes live here rather than in index.css so the card carries its own.
const KEYFRAMES = `
@keyframes upd-wave  { from { transform: translateX(0) } to { transform: translateX(-50%) } }
@keyframes upd-pulse { 50% { opacity: .35 } }
`;

type Ink = typeof INK_DARK;
type StepState = 'wait' | 'on' | 'done';

const formatMB = (bytes: number) => (bytes / 1_048_576).toFixed(1);

// Phrases are translated whole, with {placeholders}, so each language keeps its own word order.
const fill = (text: string, values: Record<string, string | number>) =>
    text.replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));

/** "52.1 of 84.0 MB · 4.2 MB/s · 8s left", from whatever the updater has sent so far. */
function describeDownload(detail: DownloadDetail | null | undefined, progress: number, t: (s: string) => string): string {
    const total = detail?.total;
    const transferred = detail?.transferred;
    const speed = detail?.bytesPerSecond;
    const secondsLeft = total && transferred !== undefined && speed ? Math.ceil((total - transferred) / speed) : null;
    return [
        total && transferred !== undefined
            ? fill(t('{done} of {total} MB'), { done: formatMB(transferred), total: formatMB(total) })
            : `${Math.round(progress)}%`,
        speed ? `${formatMB(speed)} MB/s` : null,
        secondsLeft !== null && secondsLeft > 0 ? fill(t('{n}s left'), { n: secondsLeft }) : null,
    ].filter(Boolean).join(' · ');
}

/** The wave: its height is the download, its drift runs only while downloading. */
const Wave: React.FC<{ progress: number; moving: boolean; reduced: boolean; crest?: number }> = ({ progress, moving, reduced, crest = 14 }) => (
    <div aria-hidden style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        height: `${progress}%`,
        transition: reduced ? undefined : 'height 300ms linear',
    }}>
        <svg viewBox="0 0 400 20" preserveAspectRatio="none" style={{
            position: 'absolute', top: `${-crest + 2}px`, left: 0, width: '200%', height: `${crest}px`,
            animation: reduced || !moving ? undefined : 'upd-wave 3s linear infinite',
        }}>
            <path d="M0 10 Q 50 0 100 10 T 200 10 T 300 10 T 400 10 V 20 H 0 Z" fill={WAVE.top} />
        </svg>
        <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, ${WAVE.top}, ${WAVE.bottom})` }} />
    </div>
);

// ─── Pieces ────────────────────────────────────────────────────

const CtaButton: React.FC<{ ink: Ink; isLight: boolean; reduced: boolean; onClick: () => void; children: React.ReactNode }> = ({
    ink, isLight, reduced, onClick, children,
}) => {
    const [active, setActive] = useState(false);
    const [pressed, setPressed] = useState(false);
    const dur = active ? CTA_IN : CTA_OUT;
    return (
        <button
            type="button"
            onClick={onClick}
            onPointerEnter={e => { if (e.pointerType === 'mouse') setActive(true); }}
            onPointerLeave={() => { setActive(false); setPressed(false); }}
            onPointerDown={() => setPressed(true)}
            onPointerUp={() => setPressed(false)}
            onFocus={e => { if (e.currentTarget.matches(':focus-visible')) setActive(true); }}
            onBlur={() => setActive(false)}
            style={{
                display: 'inline-flex', alignItems: 'center', gap: '8px',
                flex: 'none', whiteSpace: 'nowrap',
                padding: '9px 14px', borderRadius: '9px',
                border: `1px solid ${isLight
                    ? (active ? 'rgba(11,16,32,0.46)' : 'rgba(11,16,32,0.22)')
                    : (active ? 'rgba(255,255,255,0.44)' : 'rgba(255,255,255,0.24)')}`,
                background: isLight
                    ? (active ? 'rgba(11,16,32,0.04)' : 'rgba(11,16,32,0)')
                    : (active ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0)'),
                outline: 'none', cursor: 'pointer', fontFamily: FONT,
                fontSize: '13px', fontWeight: 500, letterSpacing: '-0.01em',
                color: active ? ink.strong : (isLight ? 'rgba(11,16,32,0.84)' : 'rgba(255,255,255,0.88)'),
                transform: pressed && !reduced ? 'scale(0.97)' : 'none',
                transition:
                    `border-color ${dur}ms ${EASE_CSS}, background-color ${dur}ms ${EASE_CSS},`
                    + ` color ${dur}ms ${EASE_CSS}, transform 120ms ${EASE_CSS}`,
            }}
        >
            <span>{children}</span>
            <ArrowRight
                size={14} strokeWidth={1.9} aria-hidden
                style={{
                    flex: 'none',
                    transform: active && !reduced ? 'translateX(3px)' : 'translateX(0)',
                    transition: `transform ${dur}ms ${EASE_CSS}`,
                }}
            />
        </button>
    );
};

const QuietButton: React.FC<{ ink: Ink; onClick: () => void; children: React.ReactNode }> = ({ ink, onClick, children }) => (
    <button
        type="button"
        onClick={onClick}
        style={{
            background: 'none', border: 0, padding: '9px 0',
            flex: 'none', whiteSpace: 'nowrap',
            cursor: 'pointer', fontFamily: FONT,
            fontSize: '13px', fontWeight: 500, letterSpacing: '-0.008em',
            color: ink.faint, transition: `color 200ms ${EASE_CSS}`,
        }}
        onMouseEnter={e => (e.currentTarget.style.color = ink.body)}
        onMouseLeave={e => (e.currentTarget.style.color = ink.faint)}
        onFocus={e => (e.currentTarget.style.color = ink.body)}
        onBlur={e => (e.currentTarget.style.color = ink.faint)}
    >
        {children}
    </button>
);

const CopyBlock: React.FC<{ command: string; ink: Ink }> = ({ command, ink }) => {
    const t = useT();
    const [copied, setCopied] = useState(false);
    const copy = () => {
        navigator.clipboard.writeText(command);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            margin: '6px 0 0', padding: '6px 6px 6px 10px', borderRadius: '8px',
            background: ink.well, boxShadow: `inset 0 0 0 1px ${ink.rule}`,
        }}>
            <code style={{
                flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                fontFamily: MONO, fontSize: '11px', color: ink.body, userSelect: 'all',
            }}>
                {command}
            </code>
            <button
                type="button"
                onClick={copy}
                title={t('Copy to clipboard')}
                style={{
                    flex: 'none', padding: '4px 8px', borderRadius: '6px', border: 0, cursor: 'pointer',
                    background: 'none', boxShadow: `inset 0 0 0 1px ${ink.rule}`,
                    fontFamily: FONT, fontSize: '11px', fontWeight: 500,
                    color: copied ? ink.strong : ink.quiet,
                }}
            >
                {copied ? t('Copied') : t('Copy')}
            </button>
        </div>
    );
};

const Steps: React.FC<{
    ink: Ink; reduced: boolean;
    steps: { label: string; sub: string; state: StepState; progress?: number }[];
}> = ({ ink, reduced, steps }) => (
    <ol style={{ listStyle: 'none', margin: '26px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '18px' }}>
        {steps.map(s => (
            <li key={s.label} aria-current={s.state === 'on' ? 'step' : undefined}
                style={{ display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr)', columnGap: '12px' }}>
                <span aria-hidden style={{
                    width: '18px', height: '18px', borderRadius: '18px', marginTop: '1px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: `inset 0 0 0 1.5px ${s.state === 'wait' ? ink.rule : ink.strong}`,
                    background: s.state === 'done' ? ink.strong : 'none',
                    transition: `background-color 300ms ${EASE_CSS}, box-shadow 300ms ${EASE_CSS}`,
                }}>
                    {s.state === 'done' && <Check size={11} strokeWidth={3} color={ink === INK_DARK ? '#1C1C1E' : '#F7F8FC'} />}
                    {s.state === 'on' && (
                        <span style={{
                            width: '6px', height: '6px', borderRadius: '6px', background: ink.strong,
                            animation: reduced ? undefined : 'upd-pulse 1.2s ease-in-out infinite',
                        }} />
                    )}
                </span>
                <div style={{ minWidth: 0 }}>
                    <div style={{
                        fontSize: '13.5px', fontWeight: 600, letterSpacing: '-0.01em',
                        color: s.state === 'wait' ? ink.faint : ink.strong,
                    }}>{s.label}</div>
                    <div style={{
                        marginTop: '3px', fontSize: '12px', fontWeight: 500, lineHeight: 1.35,
                        color: ink.quiet, fontVariantNumeric: 'tabular-nums',
                    }}>{s.sub}</div>
                    {s.progress !== undefined && (
                        <div
                            role="progressbar"
                            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(s.progress)}
                            style={{ marginTop: '8px', maxWidth: '220px', height: '2px', borderRadius: '2px', background: ink.rule, overflow: 'hidden' }}
                        >
                            <div style={{
                                width: `${s.progress}%`, height: '100%', background: ink.strong,
                                transition: reduced ? undefined : 'width 200ms linear',
                            }} />
                        </div>
                    )}
                </div>
            </li>
        ))}
    </ol>
);

// ─── Card ──────────────────────────────────────────────────────

const UpdateModal: React.FC<UpdateModalProps> = ({
    isOpen,
    updateInfo,
    parsedNotes,
    onDismiss,
    onInstall,
    downloadProgress,
    downloadDetail,
    status,
    errorMessage,
    instructionsArch,
    closeInstantly = false,
}) => {
    const t = useT();
    const reduced = useReducedMotion() ?? false;
    const isLight = useResolvedTheme() === 'light';
    const ink = isLight ? INK_LIGHT : INK_DARK;
    const [showMacHelp, setShowMacHelp] = useState(false);

    const formatVersion = (v: string) => {
        if (!v) return t('Unknown');
        if (v === 'latest' || v === 'vlatest') return t('Latest');
        return v.startsWith('v') ? v : `v${v}`;
    };
    const displayVersion = formatVersion(updateInfo?.version);
    const genieView = `${displayVersion}|${status}|${instructionsArch ?? ''}`;
    const bareVersion = displayVersion.replace(/^v/, '');
    const installedVersion = APP_VERSION !== 'unknown' ? APP_VERSION.replace(/^v/, '') : null;

    const hasNotes = !!parsedNotes?.sections?.some(s => s.title !== 'Summary' && s.items.length > 0);
    const releaseUrl = parsedNotes?.url || LATEST_RELEASE_URL;

    const progress = status === 'ready' ? 100 : Math.max(0, Math.min(100, downloadProgress || 0));
    const busy = status === 'downloading' || status === 'ready';

    const downloadSub = describeDownload(downloadDetail, progress, t);

    useEffect(() => {
        if (!isOpen) { setShowMacHelp(false); return; }
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, onDismiss]);

    const openReleasePage = () => {
        if (window.electronAPI?.openExternal) window.electronAPI.openExternal(releaseUrl);
        else window.open(releaseUrl, '_blank');
    };

    // ── Left column, per status ──
    const eyebrow = (text: string) => (
        <div style={{ fontSize: '12px', fontWeight: 500, letterSpacing: '-0.005em', color: ink.quiet, margin: '0 0 14px' }}>{text}</div>
    );
    const headline = (lines: React.ReactNode) => (
        <h2 id="update-toast-title" style={{
            fontSize: '34px', fontWeight: 300, letterSpacing: '-0.032em', lineHeight: 1.08,
            margin: 0, color: ink.strong, whiteSpace: 'pre-line',
        }}>{lines}</h2>
    );
    const actions = (children: React.ReactNode) => (
        <div style={{ marginTop: 'auto', paddingTop: '28px', display: 'flex', alignItems: 'center', gap: '22px', flexWrap: 'nowrap' }}>
            {children}
        </div>
    );

    let left: React.ReactNode;
    if (status === 'error') {
        left = <>
            {eyebrow(`${t('Update')} · ${displayVersion}`)}
            {headline(t("Couldn't finish\nthe update."))}
            {errorMessage && (
                <p role="alert" style={{ margin: '18px 0 0', fontSize: '12.5px', lineHeight: 1.5, color: ink.error, overflowWrap: 'anywhere' }}>
                    {errorMessage}
                </p>
            )}
            <p id="update-toast-desc" style={{ margin: '12px 0 0', fontSize: '13.5px', lineHeight: 1.55, color: ink.body, maxWidth: '300px' }}>
                {t('Check your internet connection or download the update manually from GitHub.')}
            </p>
            {actions(<>
                <CtaButton ink={ink} isLight={isLight} reduced={reduced} onClick={openReleasePage}>{t('Open GitHub')}</CtaButton>
                <QuietButton ink={ink} onClick={onDismiss}>{t('Close')}</QuietButton>
            </>)}
        </>;
    } else if (status === 'instructions') {
        const dmg = `~/Downloads/Natively-${bareVersion}-${instructionsArch || 'arm64'}.dmg`;
        left = <>
            {eyebrow(`${t('Update')} · ${displayVersion}`)}
            {headline(t('Finish the\ninstall yourself.'))}
            <p id="update-toast-desc" style={{ margin: '14px 0 0', fontSize: '13.5px', lineHeight: 1.55, color: ink.body, maxWidth: '300px' }}>
                {t('The download has started in your browser. Follow these steps to install the update:')}
            </p>
            {isMac ? (
                <ol style={{ listStyle: 'none', margin: '18px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <li style={{ fontSize: '12.5px', fontWeight: 500, color: ink.body }}>
                        {t('1. Clear quarantine on the downloaded file:')}
                        <CopyBlock ink={ink} command={`xattr -cr ${dmg}`} />
                    </li>
                    <li style={{ fontSize: '12.5px', fontWeight: 500, color: ink.body }}>{t('2. Open the file and install Natively.')}</li>
                    <li style={{ fontSize: '12.5px', fontWeight: 500, color: ink.body }}>
                        {t('3. Clear quarantine on the installed app:')}
                        <CopyBlock ink={ink} command="xattr -cr /Applications/Natively.app" />
                    </li>
                </ol>
            ) : (
                <p style={{ margin: '18px 0 0', fontSize: '12.5px', fontWeight: 500, lineHeight: 1.5, color: ink.body }}>
                    {t('Run the downloaded installer (.exe) and follow the prompts. Natively will restart when finished.')}
                </p>
            )}
            {actions(<CtaButton ink={ink} isLight={isLight} reduced={reduced} onClick={onDismiss}>{t('Done')}</CtaButton>)}
        </>;
    } else if (busy) {
        const ready = status === 'ready';
        left = <>
            {eyebrow(fill(t('Updating to {version}'), { version: displayVersion }))}
            {headline(ready ? t('Ready to restart.') : t('Almost there.'))}
            <Steps ink={ink} reduced={reduced} steps={[
                { label: t('Downloading'), sub: ready ? t('Done') : downloadSub, state: ready ? 'done' : 'on', progress: ready ? undefined : progress },
                { label: t('Ready to install'), sub: t('Everything is on this device'), state: ready ? 'done' : 'wait' },
                { label: t('Restart and update'), sub: t('Takes a few seconds'), state: ready ? 'on' : 'wait' },
            ]} />
            {/* macOS only: the quarantine fix for "App is damaged". Meaningless on
                Windows, where the NSIS installer has no Gatekeeper equivalent. */}
            {isMac && !ready && (
                <div style={{ marginTop: '18px' }}>
                    <button
                        type="button"
                        aria-expanded={showMacHelp}
                        onClick={() => setShowMacHelp(v => !v)}
                        style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', fontFamily: FONT, fontSize: '12px', fontWeight: 500, color: ink.faint }}
                    >
                        {t('If macOS says "App is damaged"')}
                    </button>
                    {showMacHelp && <>
                        <p style={{ margin: '6px 0 0', fontSize: '12px', color: ink.quiet }}>{t('Move app to Applications folder, then run:')}</p>
                        <CopyBlock ink={ink} command="xattr -cr /Applications/Natively.app" />
                    </>}
                </div>
            )}
            {actions(ready ? <>
                <CtaButton ink={ink} isLight={isLight} reduced={reduced} onClick={() => window.electronAPI?.restartAndInstall?.()}>
                    {t('Restart and update')}
                </CtaButton>
                <QuietButton ink={ink} onClick={onDismiss}>{t('Later')}</QuietButton>
            </> : (
                <QuietButton ink={ink} onClick={onDismiss}>{t('Hide, keep downloading')}</QuietButton>
            ))}
        </>;
    } else {
        left = <>
            {eyebrow(`${t('Update available')} · ${displayVersion}`)}
            {headline(t('New in Natively.\nReady when you are.'))}
            <div
                id="update-toast-desc"
                tabIndex={hasNotes ? 0 : undefined}
                style={{
                    margin: '22px 0 0', maxHeight: '176px', overflowY: 'auto', paddingRight: '6px',
                    WebkitMaskImage: 'linear-gradient(180deg, #000 82%, transparent)',
                    maskImage: 'linear-gradient(180deg, #000 82%, transparent)',
                } as React.CSSProperties}
            >
                {hasNotes ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', paddingBottom: '18px' }}>
                        {parsedNotes!.sections.filter(s => s.title !== 'Summary' && s.items.length > 0).map((s, i) => (
                            <div key={i}>
                                <div style={{ fontSize: '12px', fontWeight: 500, color: ink.quiet, marginBottom: '6px' }}>{s.title}</div>
                                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                    {s.items.map((item, j) => (
                                        <li key={j} style={{ display: 'grid', gridTemplateColumns: '12px minmax(0, 1fr)', fontSize: '13px', lineHeight: 1.45, color: ink.body }}>
                                            <span aria-hidden style={{ color: ink.faint }}>–</span><span>{item}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p style={{ margin: 0, fontSize: '13.5px', lineHeight: 1.55, color: ink.body }}>
                        {parsedNotes?.summary || t('Includes performance improvements and bug fixes.')}
                    </p>
                )}
            </div>
            {actions(<>
                <CtaButton ink={ink} isLight={isLight} reduced={reduced} onClick={onInstall}>{t('Update now')}</CtaButton>
                <QuietButton ink={ink} onClick={onDismiss}>{t('Not now')}</QuietButton>
            </>)}
        </>;
    }

    const versionSize = bareVersion.length <= 4 ? 64 : bareVersion.length <= 6 ? 52 : 40;

    return (
        // Its picture is of one version in one state: another version's
        // "available" would pour out the wrong number. No picture is kept of a
        // download (it changes every tick) or of an error (its message varies).
        <GenieModal
            open={isOpen}
            label="UpdateModal"
            openingView={genieView}
            keepPictures={status === 'idle' || status === 'ready' || status === 'instructions'}
            cardProps={{ 'data-genie-view': genieView }}
            closeInstantly={closeInstantly}
            zIndex={9999}
            onBackdropClick={onDismiss}
            // Dims, never blurs (3a9901ae4).
            backdropStyle={{ background: isLight ? 'rgba(10,10,18,0.30)' : 'rgba(0,0,0,0.80)' }}
            padding={16}
            wrapStyle={{ width: '600px', maxWidth: '100%' }}
            cardStyle={{
                background: isLight ? '#F7F8FC' : '#1C1C1E',
                boxShadow: isLight
                    ? 'inset 0 0 0 1px rgba(11,16,32,0.10), inset 0 1px 0 rgba(255,255,255,0.80), ' + SHADOW.light
                    : 'inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.06), ' + SHADOW.dark,
                fontFamily: FONT,
                WebkitFontSmoothing: 'antialiased',
            } as React.CSSProperties}
            shadow={isLight ? SHADOW.light : SHADOW.dark}
            radius={20}
        >
                        <style>{KEYFRAMES}</style>
                        <div
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="update-toast-title"
                            aria-describedby={status === 'downloading' || status === 'ready' ? undefined : 'update-toast-desc'}
                            style={{ display: 'flex', alignItems: 'stretch', minHeight: '420px' }}
                        >
                            <div style={{
                                flex: '1 1 58%', minWidth: 0,
                                padding: '40px 28px 34px 40px',
                                display: 'flex', flexDirection: 'column',
                            }}>
                                {left}
                            </div>

                            <div style={{ flex: '0 0 40%', padding: '8px 8px 8px 0', display: 'flex' }}>
                                <div style={{
                                    position: 'relative', flex: 1,
                                    borderRadius: '14px', overflow: 'hidden',
                                    background: PANEL,
                                    boxShadow: isLight ? 'inset 0 0 0 1px rgba(11,16,32,0.07)' : 'none',
                                }}>
                                    {busy && <Wave progress={progress} moving={status === 'downloading'} reduced={reduced} />}

                                    <div style={{
                                        position: 'absolute', inset: 0,
                                        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
                                        padding: '24px',
                                    }}>
                                        <div style={{ fontSize: '12px', fontWeight: 500, color: PANEL_INK.quiet }}>{t('Version')}</div>
                                        <div style={{
                                            marginTop: '6px', fontSize: `${versionSize}px`, fontWeight: 200,
                                            letterSpacing: '-0.05em', lineHeight: 1, color: PANEL_INK.strong,
                                            fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere',
                                        }}>
                                            {bareVersion}
                                        </div>
                                        {(installedVersion || busy) && (
                                            <div style={{ marginTop: '10px', fontSize: '12px', fontWeight: 500, color: PANEL_INK.quiet, fontVariantNumeric: 'tabular-nums' }}>
                                                {[installedVersion && fill(t('from {version}'), { version: installedVersion }), busy && `${Math.floor(progress)}%`].filter(Boolean).join(' · ')}
                                            </div>
                                        )}
                                    </div>

                                    <button
                                        type="button"
                                        onClick={onDismiss}
                                        aria-label={t('Close')}
                                        style={{
                                            position: 'absolute', top: '8px', right: '8px', zIndex: 2,
                                            width: '30px', height: '30px',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            padding: 0, cursor: 'pointer',
                                            background: 'none', border: 0, borderRadius: '8px',
                                            color: CLOSE_INK.rest,
                                            transition: `color 180ms ${EASE_CSS}, transform 160ms ${EASE_CSS}`,
                                        }}
                                        onMouseEnter={e => { e.currentTarget.style.color = CLOSE_INK.hover; }}
                                        onMouseLeave={e => { e.currentTarget.style.color = CLOSE_INK.rest; e.currentTarget.style.transform = 'scale(1)'; }}
                                        onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.92)'; }}
                                        onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)'; }}
                                    >
                                        <X size={14} strokeWidth={2} color="currentColor" />
                                    </button>
                                </div>
                            </div>
                        </div>
        </GenieModal>
    );
};

// ─── Corner toast ──────────────────────────────────────────────
//
// What the card shrinks to when the download is hidden. A notice, not a
// modal: no scrim, so the app stays usable; a thumbnail of the version panel
// keeps the wave going. The body brings the full card back; × closes it.

interface UpdateCornerToastProps {
    isOpen: boolean;
    updateInfo: any;
    downloadProgress: number;
    downloadDetail?: DownloadDetail | null;
    status: UpdateModalProps['status'];
    onExpand: () => void;
    onClose: () => void;
    /** Skip the close genie: the full card is taking the toast's place. */
    closeInstantly?: boolean;
}

export const UpdateCornerToast: React.FC<UpdateCornerToastProps> = ({
    isOpen, updateInfo, downloadProgress, downloadDetail, status, onExpand, onClose, closeInstantly = false,
}) => {
    const t = useT();
    const reduced = useReducedMotion() ?? false;
    const isLight = useResolvedTheme() === 'light';
    const ink = isLight ? INK_LIGHT : INK_DARK;

    const ready = status === 'ready';
    const progress = ready ? 100 : Math.max(0, Math.min(100, downloadProgress || 0));
    const raw = updateInfo?.version ? String(updateInfo.version).replace(/^v/, '') : '';
    const version = raw && raw !== 'latest' ? raw : '';

    // Its numbers are new every tick, so no picture of it is kept.
    return (
        <GenieModal
            open={isOpen}
            label="UpdateCornerToast"
            modal={false}
            placement="bottom-right"
            keepPictures={false}
            closeInstantly={closeInstantly}
            zIndex={9999}
            padding={20}
            wrapStyle={{ width: '340px', maxWidth: 'calc(100vw - 40px)' }}
            cardStyle={{
                background: isLight ? '#F7F8FC' : '#1C1C1E',
                boxShadow: isLight
                    ? 'inset 0 0 0 1px rgba(11,16,32,0.10), inset 0 1px 0 rgba(255,255,255,0.80), ' + TOAST_SHADOW.light
                    : 'inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.06), ' + TOAST_SHADOW.dark,
                fontFamily: FONT,
                WebkitFontSmoothing: 'antialiased',
            } as React.CSSProperties}
            cardProps={{ role: 'region', 'aria-label': t('Update progress') }}
            shadow={isLight ? TOAST_SHADOW.light : TOAST_SHADOW.dark}
            radius={16}
        >
                    <style>{KEYFRAMES}</style>
                    <button
                        type="button"
                        onClick={onExpand}
                        aria-label={t('Show update details')}
                        style={{
                            display: 'grid', gridTemplateColumns: '52px minmax(0, 1fr)', columnGap: '14px', alignItems: 'center',
                            width: '100%', padding: '14px 44px 14px 14px', textAlign: 'left',
                            background: 'none', border: 0, cursor: 'pointer', fontFamily: FONT, outline: 'none',
                        }}
                    >
                        <span aria-hidden style={{
                            position: 'relative', width: '52px', height: '52px', borderRadius: '11px', overflow: 'hidden',
                            background: PANEL, boxShadow: isLight ? 'inset 0 0 0 1px rgba(11,16,32,0.07)' : 'none',
                        }}>
                            <Wave progress={progress} moving={!ready} reduced={reduced} crest={8} />
                            <span style={{
                                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '15px', fontWeight: 300, letterSpacing: '-0.03em', color: PANEL_INK.strong,
                                fontVariantNumeric: 'tabular-nums',
                            }}>
                                {ready ? <Check size={18} strokeWidth={2.2} /> : `${Math.floor(progress)}%`}
                            </span>
                        </span>
                        <span style={{ minWidth: 0 }}>
                            <span style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: ink.quiet }}>
                                {version ? fill(t('Updating to {version}'), { version: `v${version}` }) : t('Updating Natively')}
                            </span>
                            <span style={{ display: 'block', marginTop: '3px', fontSize: '15px', fontWeight: 500, letterSpacing: '-0.015em', color: ink.strong }}>
                                {ready ? t('Ready to restart.') : t('Downloading…')}
                            </span>
                            {!ready && (
                                <span style={{ display: 'block', marginTop: '4px', fontSize: '11.5px', fontWeight: 500, color: ink.faint, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {describeDownload(downloadDetail, progress, t)}
                                </span>
                            )}
                        </span>
                    </button>

                    {!ready && (
                        <div
                            role="progressbar"
                            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}
                            aria-label={t('Download progress')}
                            style={{ height: '2px', background: ink.rule }}
                        >
                            <div style={{ width: `${progress}%`, height: '100%', background: ink.strong, transition: reduced ? undefined : 'width 200ms linear' }} />
                        </div>
                    )}

                    {ready && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', padding: '0 14px 14px 80px' }}>
                            <CtaButton ink={ink} isLight={isLight} reduced={reduced} onClick={() => window.electronAPI?.restartAndInstall?.()}>
                                {t('Restart and update')}
                            </CtaButton>
                            <QuietButton ink={ink} onClick={onClose}>{t('Later')}</QuietButton>
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={t('Close')}
                        style={{
                            position: 'absolute', top: '8px', right: '8px',
                            width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            padding: 0, cursor: 'pointer', background: 'none', border: 0, borderRadius: '8px',
                            color: ink.faint, transition: `color 180ms ${EASE_CSS}`,
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = ink.strong; }}
                        onMouseLeave={e => { e.currentTarget.style.color = ink.faint; }}
                    >
                        <X size={14} strokeWidth={2} color="currentColor" />
                    </button>
        </GenieModal>
    );
};

export default UpdateModal;
