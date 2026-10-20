// The MCP section, laid out like Granola's card in Settings' own parts: who it
// connects (Natively's app icon, then the AI apps), a bold heading, three
// numbered steps with the address as an accent chip, and Liquid Glass pills to
// act ("Turn on" in the lavender glass, "Turn off" and "New token" clear). Granola's address is
// public and signs in through the browser; Natively's server is local
// (127.0.0.1 with a token), so turning it on reveals the setup for each app,
// token included, in a quiet code block under the steps.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { Check, Code2, Copy, Loader2, Plus } from 'lucide-react';
import { useT } from '../../../i18n';
import { LiquidGlassButton } from '../../../ui-components/LiquidGlassButton';
import { Collapse, SETTINGS_CARD, useSettingsTones } from '../SettingsRow';
import { GlassPill, LAVENDER_PILL, StepList } from './parts';
import claudeMark from '../../../assets/provider-logos/claude.svg?raw';
import openaiMark from '../../../assets/provider-logos/openai.svg?raw';
// The app's own icon, as About shows it: the Liquid Glass render macOS puts in
// the Dock, and the Windows icon on Windows.
import appIconMac from '../../../assets/about/app-icon-mac.webp';
import appIconWin from '../../../assets/about/app-icon-win.webp';
import { isMac } from '../../../utils/platformUtils';
import type { McpServerStatus } from '../../../types/meetingOutputs';

type Snippets = NonNullable<McpServerStatus['snippets']>;

// One tab per app, with where its setup goes. Paths are named the same way on
// macOS and Windows (a home-folder file), so no platform wording is needed.
const APPS: readonly { id: keyof Snippets; label: string; where: string }[] = [
    { id: 'claudeCode', label: 'Claude Code', where: 'Run this in a terminal.' },
    { id: 'claudeDesktop', label: 'Claude Desktop', where: 'Add this to claude_desktop_config.json.' },
    { id: 'cursor', label: 'Cursor', where: 'Add this to mcp.json.' },
    { id: 'codex', label: 'Codex', where: 'Add this to config.toml in your .codex folder.' },
];

// Motion, on the transitions.dev token scale: smooth-out for anything that
// moves, ease-in-out for swaps.
const EASE = 'ease-[cubic-bezier(0.23,1,0.32,1)]';
const PRESS = `transition-transform duration-150 ${EASE} active:scale-[0.97]`;
const SMOOTH_OUT = [0.22, 1, 0.36, 1] as const;

/**
 * Text that changes in place (the pill label, the status, step 1, the setup
 * hint): the old words leave upward and the new ones rise in just behind them
 * (transitions.dev #04: 4px, 2px blur). CSS keyframes (.mcp-swap in index.css),
 * not Framer: turning the server off folds the setup panel and waits on main in
 * the same frames, and a main-thread swap stuttered through them. The leaving
 * copy is out of flow, so the line takes its new size once and the two never
 * read on top of each other. `block` fills the line (text that wraps); without
 * it the swap is as wide as its text and never wraps. The first paint is still.
 */
const SWAP_MS = 240;
const Swap: React.FC<{ k: string; block?: boolean; children: React.ReactNode }> = ({ k, block, children }) => {
    const nodeRef = useRef<React.ReactNode>(children);
    const keyRef = useRef(k);
    const [leaving, setLeaving] = useState<{ key: string; node: React.ReactNode } | null>(null);
    const [swapped, setSwapped] = useState(false);
    useLayoutEffect(() => {
        if (keyRef.current === k) return;
        // nodeRef still holds the last paint's children (it is updated after paint).
        setLeaving({ key: keyRef.current, node: nodeRef.current });
        keyRef.current = k;
        setSwapped(true);
        const id = setTimeout(() => setLeaving(null), SWAP_MS);
        return () => clearTimeout(id);
    }, [k]);
    useEffect(() => { nodeRef.current = children; });
    return (
        <span className={block ? 'mcp-swap mcp-swap--block' : 'mcp-swap'}>
            {leaving && <span key={`o${leaving.key}`} aria-hidden="true" className="mcp-swap-out">{leaving.node}</span>}
            <span key={`i${k}`} className={swapped ? 'mcp-swap-in' : undefined}>{children}</span>
        </span>
    );
};

// Granola's stack, to the class: each app tile overlaps the one before by 8px and
// sits on top of it (later in the row, higher in the stack), lifted by a soft
// shadow and a hairline; on hover they spread 12px and 24px to a 4px gap, on
// Granola's slightly overshooting curve. Letting go is the softer half: a
// longer return that settles with a small bounce instead of snapping shut.
// Only transform moves.
const SPREAD = 'transition-transform duration-[450ms] ease-[cubic-bezier(0.34,1.36,0.64,1)] group-hover:duration-300 group-hover:ease-[cubic-bezier(0.25,1.1,0.5,1)] motion-reduce:transition-none';
const Tile: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
    <span className={`relative flex h-10 w-10 items-center justify-center rounded-[10px] border border-border-muted bg-bg-item-surface shadow-sm ${SPREAD} ${className}`}>{children}</span>
);

function useCopy(text: string): [boolean, () => void] {
    const [copied, setCopied] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => clearTimeout(timer.current), []);
    const copy = () => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1500);
        }, () => { /* the text is selectable anyway */ });
    };
    return [copied, copy];
}

/** Copy turns into a tick: the two icons cross-fade with a touch of blur, so it reads as one icon changing. */
const CopyGlyph: React.FC<{ copied: boolean; size: number }> = ({ copied, size }) => (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
        <Copy size={size} className={`absolute inset-0 transition-[opacity,transform,filter] duration-[250ms] ease-in-out ${copied ? 'scale-75 opacity-0 blur-[2px]' : 'opacity-100'}`} />
        <Check size={size} className={`absolute inset-0 transition-[opacity,transform,filter] duration-[250ms] ease-in-out ${copied ? 'opacity-100' : 'scale-75 opacity-0 blur-[2px]'}`} />
    </span>
);

/** The address as Granola's inline chip, in the accent: press anywhere on it to copy. */
const AddressChip: React.FC<{ url: string }> = ({ url }) => {
    const t = useT();
    const [copied, copy] = useCopy(url);
    return (
        <button
            type="button"
            onClick={copy}
            aria-label={`${t('Copy')} ${url}`}
            className={`ml-1.5 inline-flex max-w-full items-center gap-1 rounded bg-accent-muted px-1.5 py-0.5 align-middle leading-[18px] text-accent-primary hover:bg-accent-border ${PRESS}`}
        >
            <span className="truncate">{url}</span>
            <CopyGlyph copied={copied} size={14} />
        </button>
    );
};

// Turning the server on reveals the setup as a short cascade: tabs, code, hint,
// 40ms apart, each rising 8px on smooth-out. No blur: these are large boxes of
// text, and a filter on them repaints every frame while the panel is opening.
const CASCADE: Variants = { hidden: {}, shown: { transition: { staggerChildren: 0.04 } } };
const RISE: Variants = {
    hidden: { opacity: 0, y: 8 },
    shown: { opacity: 1, y: 0, transition: { duration: 0.4, ease: SMOOTH_OUT } },
};
const FADE: Variants = { hidden: { opacity: 0 }, shown: { opacity: 1, transition: { duration: 0.2 } } };

/** Pick an app, see its setup. The pill slides to the chosen name like tabs (250ms smooth-out). */
const AppSetup: React.FC<{ snippets: Snippets }> = ({ snippets }) => {
    const t = useT();
    const reduce = useReducedMotion();
    // Only apps main wrote a setup for: a main process older than this screen
    // (the app not restarted after an update) may not know every app yet.
    const apps = APPS.filter((a) => !!snippets[a.id]);
    const [picked, setApp] = useState<keyof Snippets>('claudeCode');
    const current = apps.find((a) => a.id === picked) ?? apps[0];
    const app = current?.id;
    const [copied, copy] = useCopy(app ? snippets[app] : '');
    if (!current || !app) return null;
    return (
        <motion.div className="pt-6" variants={CASCADE} initial="hidden" animate="shown">
            <motion.div variants={reduce ? FADE : RISE} role="tablist" aria-label={t('AI app')} className="flex flex-wrap gap-0.5">
                {apps.map((a) => (
                    <button
                        key={a.id}
                        type="button"
                        role="tab"
                        aria-selected={app === a.id}
                        onClick={() => setApp(a.id)}
                        className={`relative rounded-full px-2.5 py-1 text-[13px] transition-colors duration-150 ${app === a.id ? 'text-text-primary' : 'text-text-tertiary hover:text-text-secondary'}`}
                    >
                        {app === a.id && (
                            <motion.span
                                layoutId="mcp-app-pill"
                                className="absolute inset-0 rounded-full border border-border-muted bg-bg-input"
                                transition={reduce ? { duration: 0 } : { duration: 0.25, ease: SMOOTH_OUT }}
                            />
                        )}
                        <span className="relative">{t(a.label)}</span>
                    </button>
                ))}
            </motion.div>
            <motion.div variants={reduce ? FADE : RISE} className="relative mt-2.5 overflow-hidden rounded-xl border border-border-subtle bg-bg-input">
                {/* Three lines tall whatever the app, so switching tabs never moves the
                    card; longer setups scroll inside. Keyed per app: the new setup fades in
                    from the top instead of keeping the last one's scroll. */}
                <motion.div
                    key={app}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.15, ease: 'easeInOut' }}
                    className="h-[80px] overflow-y-auto overscroll-contain"
                >
                    <pre className="whitespace-pre-wrap py-3 pl-3.5 pr-12 font-mono text-[11.5px] leading-relaxed text-text-primary [overflow-wrap:anywhere]">
                        {snippets[app]}
                    </pre>
                </motion.div>
                <button
                    type="button"
                    onClick={copy}
                    aria-label={`${t('Copy')} ${t(current.label)}`}
                    title={copied ? t('Copied') : t('Copy')}
                    className={`absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md bg-bg-input text-text-tertiary hover:bg-bg-item-surface hover:text-text-primary ${PRESS}`}
                >
                    <CopyGlyph copied={copied} size={14} />
                </button>
            </motion.div>
            <motion.p variants={reduce ? FADE : RISE} className="mt-2 text-xs text-text-tertiary">
                <Swap k={app} block>{t(current.where)}</Swap>
            </motion.p>
        </motion.div>
    );
};

export const McpCard: React.FC<{ mcp: McpServerStatus; onStatus: (s: McpServerStatus) => void }> = ({ mcp, onStatus }) => {
    const t = useT();
    const tones = useSettingsTones();
    const [busy, setBusy] = useState(false);
    // The spinner waits 300ms: starting or stopping the local server is usually
    // quicker than that, and a spinner that flashes in and out for a frame or two
    // only shoves the label sideways twice.
    const [slow, setSlow] = useState(false);
    const slowTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => clearTimeout(slowTimer.current), []);
    // A new token cuts off every app using the old one, so it asks for a second press.
    const [confirmReset, setConfirmReset] = useState(false);
    const confirmTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => clearTimeout(confirmTimer.current), []);
    const api = () => window.electronAPI?.meetingOutputs;

    const toggle = async () => {
        if (busy) return;
        setBusy(true);
        slowTimer.current = setTimeout(() => setSlow(true), 300);
        const next = await api()?.setMcpEnabled(!mcp.enabled).catch(() => undefined);
        clearTimeout(slowTimer.current);
        setSlow(false);
        setBusy(false);
        setConfirmReset(false);
        if (next) onStatus(next);
    };
    const reset = async () => {
        clearTimeout(confirmTimer.current);
        if (!confirmReset) {
            setConfirmReset(true);
            confirmTimer.current = setTimeout(() => setConfirmReset(false), 4000);
            return;
        }
        setConfirmReset(false);
        const next = await api()?.resetMcpToken().catch(() => undefined);
        if (next) onStatus(next);
    };

    const failed = mcp.enabled && !mcp.running && !!mcp.error;
    // A failure that arrives while the card is open shakes the status once (the
    // Settings notices' shake); one already there when it opens is just the state.
    const [shakeKey, setShakeKey] = useState<string | null>(null);
    const lastError = useRef(failed ? mcp.error : undefined);
    useEffect(() => {
        const now = failed ? mcp.error : undefined;
        if (now && now !== lastError.current) setShakeKey(now);
        lastError.current = now;
    }, [failed, mcp.error]);
    const status = !mcp.enabled
        ? t('Off. Nothing can read your meetings.')
        : mcp.running ? t('On. Only apps on this computer can connect.') : (mcp.error || t('Starting…'));

    return (
        <div className={`${SETTINGS_CARD} group p-5`}>
            <div className="mb-6 flex items-center gap-3" aria-hidden>
                {/* The macOS render carries the Dock's transparent margin (168 of 192px is
                    icon), so it is drawn larger and pulled in to sit level with the 40px tiles. */}
                <img src={isMac ? appIconMac : appIconWin} alt="" draggable={false} className={isMac ? '-m-[3px] h-[46px] w-[46px]' : 'h-10 w-10'} />
                <Plus size={16} className="text-text-tertiary" />
                <span className="flex">
                    <Tile className="text-[19px] leading-[0]"><span dangerouslySetInnerHTML={{ __html: claudeMark }} /></Tile>
                    <Tile className="-ml-2 text-[19px] leading-[0] text-text-primary group-hover:translate-x-3"><span dangerouslySetInnerHTML={{ __html: openaiMark }} /></Tile>
                    <Tile className="-ml-2 text-text-primary group-hover:translate-x-6"><Code2 size={17} /></Tile>
                </span>
            </div>

            <h4 className="text-base font-bold text-text-primary">{t('Bring your meeting notes to your AI tools')}</h4>
            <p className="mt-0.5 text-xs text-text-secondary">{t('AI apps on this computer can read and search your meetings. Nothing leaves it.')}</p>

            <div className="mt-5">
                <StepList steps={[
                    // One sentence, on or off: the address is kept, so it is there to
                    // copy before the server is on, as Granola's public URL is.
                    <>
                        {t('Add Natively using its local address')}
                        {mcp.url ? <AddressChip url={mcp.url} /> : '.'}
                    </>,
                    t('Sign in with your token. The setup for each app already carries it.'),
                    t('Chat, search and work with your meetings from Claude, Codex or Cursor.'),
                ]} />
            </div>

            <Collapse open={mcp.enabled && !!mcp.snippets}>
                {mcp.snippets ? <AppSetup snippets={mcp.snippets} /> : <span />}
            </Collapse>

            <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2">
                {/* Off, the card's one action wears the lavender glass; on, turning it
                    off steps back to the clear pill. */}
                {mcp.enabled ? (
                    <GlassPill
                        className="min-w-[84px]"
                        onClick={() => void toggle()}
                        disabled={busy}
                        aria-pressed
                        icon={busy && slow ? <Loader2 size={14} className="animate-spin" /> : undefined}
                    >
                        {t('Turn off')}
                    </GlassPill>
                ) : (
                    <LiquidGlassButton
                        variant="lavender"
                        className={`${LAVENDER_PILL} min-w-[84px]`}
                        onClick={() => void toggle()}
                        disabled={busy}
                        aria-pressed={false}
                        icon={busy && slow ? <Loader2 size={14} className="animate-spin" /> : undefined}
                    >
                        {t('Turn on')}
                    </LiquidGlassButton>
                )}
                <p
                    key={shakeKey ?? undefined}
                    className={`min-w-0 flex-1 text-xs transition-colors duration-150 ${failed ? tones.text.danger : 'text-text-tertiary'}${shakeKey && failed ? ' t-notice-shake' : ''}`}
                    role={failed ? 'alert' : undefined}
                >
                    {/* The dot travels with its sentence, so the text never slides over when it goes. */}
                    <Swap k={status} block>
                        <span className="flex items-center gap-2">
                            {mcp.enabled && mcp.running && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />}
                            <span className="min-w-0">{status}</span>
                        </span>
                    </Swap>
                </p>
                {mcp.enabled && mcp.token && (
                    <GlassPill onClick={() => void reset()} tone={confirmReset ? 'danger' : undefined}>
                        <Swap k={confirmReset ? 'confirm' : 'idle'}>{confirmReset ? t('Disconnect every app?') : t('New token')}</Swap>
                    </GlassPill>
                )}
            </div>
        </div>
    );
};
