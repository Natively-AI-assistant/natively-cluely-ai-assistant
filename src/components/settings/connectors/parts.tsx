// Shared pieces of the Connectors page, built from Settings' own parts so the
// tab reads like General and Audio: Audio's card (bg-card, 12px corners) holding
// General's rows (a 40px tile, a bold 14px title over a 12px grey line, the
// control on the right), Audio's bold section heading with its grey line over
// each card, and General's small-capitals label over each group of the list.
// Buttons stay Natively's Liquid Glass pills: the one action in the lavender
// glass of the meeting notes' Usage question, every other in the clear glass.
// The MCP card sits in the same card.

import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight, Loader2, Unplug } from 'lucide-react';
import { useT } from '../../../i18n';
import { LiquidGlassButton, type LiquidGlassButtonProps } from '../../../ui-components/LiquidGlassButton';
import { Presence, SETTINGS_CARD, useSettingsTones, type SettingsTone } from '../SettingsRow';
import { AIP_CSS, AipSelect, type AipSelectOption } from '../AIProvidersSettings';
import { useResolvedTheme } from '../../../hooks/useResolvedTheme';
import type { DeliveryInfo, FolderOption } from '../../../types/connectors';

/** A row inside a card: General's padding. */
export const ROW = 'flex items-center gap-4 px-4 py-3';

/** A fold that opens under a row (a form, a secret, a search), on its own line. */
export const FOLD = 'border-t border-border-subtle px-4 py-4';

/**
 * Audio's card, its rows split by the settings line (border-subtle: a hairline
 * in light, none in dark, as General's rows have none). No overflow clip: a
 * folder picker's menu opens out of it.
 */
export const Group: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
    <div className={`${SETTINGS_CARD} divide-y divide-border-subtle ${className}`}>{children}</div>
);

/** The small-capitals label over a group of the list, as General labels its groups. */
export const GroupLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <h4 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">{children}</h4>
);

/** Audio's section heading: bold 18px over one grey line, then the card. */
export const SectionHeading: React.FC<{ title: React.ReactNode; subtitle?: React.ReactNode }> = ({ title, subtitle }) => (
    <div className="mb-3">
        <h3 className="text-lg font-bold text-text-primary">{title}</h3>
        {subtitle ? <p className="mt-1 text-xs text-text-secondary">{subtitle}</p> : null}
    </div>
);

/** General's 40px tile, holding a brand mark or a glyph; `sm` is 32px for a row inside a list. */
export const Tile: React.FC<{ children: React.ReactNode; size?: 'sm' | 'md'; className?: string }> = ({ children, size = 'md', className = '' }) => (
    <span className={`${size === 'sm' ? 'h-8 w-8' : 'h-10 w-10'} flex shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-bg-item-surface text-text-primary ${className}`}>
        {children}
    </span>
);

/** The status dot: green while a connection is live. */
export const LiveDot: React.FC = () => <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />;

/**
 * One connector in the list, as General's row: its mark in the tile, the name,
 * what is connected (with the dot) or what it does, and a chevron. The whole
 * row opens the page.
 */
export const NavRow: React.FC<{ icon: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; value?: React.ReactNode; onOpen: () => void }> = ({ icon, title, description, value, onOpen }) => (
    <button type="button" onClick={onOpen} className={`cx-row ${ROW} w-full text-left first:rounded-t-xl last:rounded-b-xl`}>
        <Tile>{icon}</Tile>
        <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold text-text-primary">{title}</span>
            {value ? (
                <span className="mt-0.5 flex items-center gap-1.5 text-xs text-text-secondary">
                    <LiveDot />
                    <span className="min-w-0 truncate">{value}</span>
                </span>
            ) : description ? (
                <span className="mt-0.5 block truncate text-xs text-text-secondary">{description}</span>
            ) : null}
        </span>
        <ChevronRight size={16} className="shrink-0 text-text-tertiary" />
    </button>
);

/** Rows inside a card: each its own row, so the card draws the lines. */
export const ListCard: React.FC<{ children: React.ReactNode; inset?: 'tile' | 'small' }> = ({ children }) => <>{children}</>;

/** The way back to the list, over a connector's page. */
export const BackLink: React.FC<{ onBack: () => void }> = ({ onBack }) => {
    const t = useT();
    return (
        <button
            type="button"
            onClick={onBack}
            className="-ml-1 mb-4 flex items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary"
        >
            <ChevronLeft size={14} />
            {t('Connectors')}
        </button>
    );
};

/** What the page's first group says about the connector: its mark, name and line. */
export type ConnectorPageInfo = { mark: React.ReactNode; title: string; description: string; steps?: string[] };
export const ConnectorPageContext = React.createContext<ConnectorPageInfo | null>(null);

/**
 * Every button but the page's one action: the clear Liquid Glass pill, which
 * has no body of its own, so it sits on the canvas and on a card alike and
 * takes its label colour from `tone` (danger for a second-press confirm, ok
 * for Copied) or the primary ink.
 */
export const GlassPill: React.FC<Omit<LiquidGlassButtonProps, 'variant'> & { tone?: SettingsTone }> = ({ tone, className = '', ...rest }) => {
    const tones = useSettingsTones();
    // An icon alone (Remove) gets a round 30px pill rather than 16px of padding either side.
    const iconOnly = rest.children == null || rest.children === false;
    // .lg-clear takes `color: inherit` at a specificity a text utility cannot beat, so
    // the ink goes on a box-less wrapper it inherits from.
    return (
        <span className={`contents ${tone ? tones.text[tone] : 'text-text-primary'}`}>
            <LiquidGlassButton variant="clear" className={`lg-sm shrink-0 ${iconOnly ? '!w-[30px] !px-0' : ''} ${className}`} {...rest} />
        </span>
    );
};

/** The one action's material: the Usage question's lavender glass, re-tinted for dark (`.lg-lav-tinted`, index.css). */
export const LAVENDER_PILL = 'lg-sm lg-lav-tinted shrink-0';

/**
 * The page's one action, in the lavender glass. "Connect Notion" carries an
 * arrow when the step happens in the browser, and reads "Connecting…" while
 * it does (the status carries the spinner). Once it has opened a form
 * (`expanded`) it steps back to the clear pill, so a lavender Cancel never
 * competes with the form's own Save.
 */
export const ConnectPill: React.FC<{
    label: string;
    external?: boolean;
    waiting?: boolean;
    disabled?: boolean;
    expanded?: boolean;
    onClick: () => void;
}> = ({ label, external, waiting, disabled, expanded, onClick }) => {
    const t = useT();
    if (expanded) {
        return <GlassPill aria-expanded onClick={onClick} disabled={disabled}>{label}</GlassPill>;
    }
    return (
        <LiquidGlassButton
            variant="lavender"
            className={LAVENDER_PILL}
            onClick={onClick}
            disabled={disabled || waiting}
            aria-expanded={expanded}
        >
            {waiting ? t('Connecting…') : external ? (
                <span className="inline-flex items-center gap-1">{label}<ArrowUpRight size={14} /></span>
            ) : label}
        </LiquidGlassButton>
    );
};

/**
 * Disconnect, in the clear pill. The first press asks ("Disconnect
 * Gmail?") in the danger tone; a second press within 4 seconds disconnects.
 */
export const DisconnectButton: React.FC<{ confirmLabel?: string; onDisconnect: () => void }> = ({ confirmLabel, onDisconnect }) => {
    const t = useT();
    const [confirm, setConfirm] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => clearTimeout(timer.current), []);
    const press = () => {
        clearTimeout(timer.current);
        if (!confirm) {
            setConfirm(true);
            timer.current = setTimeout(() => setConfirm(false), 4000);
            return;
        }
        setConfirm(false);
        onDisconnect();
    };
    return (
        <GlassPill onClick={press} tone={confirm ? 'danger' : undefined} icon={<Unplug size={14} />}>
            {confirm ? (confirmLabel ?? t('Disconnect?')) : t('Disconnect')}
        </GlassPill>
    );
};

export type ActionState = 'off' | 'busy' | 'on';

/**
 * The top of every connector page, as Audio opens a section: the connector's
 * name in the section heading with what it does under it, then a card whose
 * row is the connection (the mark in the tile, a dot or a spinner with what
 * is connected, one grey line, the pills on the right). Whatever opens from
 * those pills (a form, a one-time secret) folds open under the row, inside
 * the card. A result of pressing one (`flash`) lands under the card.
 */
export const ActionArea: React.FC<{
    state: ActionState;
    title: React.ReactNode;
    /** Names the title's state, so a change swaps the words rather than snapping them. */
    titleKey: string;
    detail?: React.ReactNode;
    secondary?: React.ReactNode;
    below?: React.ReactNode;
    flash?: React.ReactNode;
    children?: React.ReactNode;
}> = ({ state, title, titleKey, detail, secondary, below, flash, children }) => {
    const t = useT();
    const page = React.useContext(ConnectorPageContext);
    return (
        <section className="mb-6">
            {page && <SectionHeading title={t(page.title)} subtitle={t(page.description)} />}
            <div className={SETTINGS_CARD}>
                <div className={`${ROW} flex-wrap gap-y-3`}>
                    <div className="flex min-w-[200px] flex-1 items-center gap-4">
                        {page && <Tile>{page.mark}</Tile>}
                        <div className="min-w-0">
                            <h4 className="flex items-center gap-2 text-sm font-bold text-text-primary">
                                {state === 'on' ? <LiveDot /> : state === 'busy' ? <Loader2 size={12} className="shrink-0 animate-spin text-text-secondary" /> : null}
                                <Presence kind="text" id={titleKey}>{title}</Presence>
                            </h4>
                            {detail ? <div className="mt-0.5 text-xs text-text-secondary">{detail}</div> : null}
                        </div>
                    </div>
                    <div className="ml-auto flex shrink-0 items-center gap-2">
                        {secondary}
                        {children}
                    </div>
                </div>
                {below}
            </div>
            {flash}
        </section>
    );
};

/**
 * A section that is read rather than worked in (Includes, How Gmail is used,
 * How it works): the heading, then its lines straight on the page, no card,
 * set in 4px so they line up with the footnote.
 */
export const PlainSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
    const t = useT();
    return (
        <section className="mb-6">
            <SectionHeading title={t(title)} />
            <div className="px-1">{children}</div>
        </section>
    );
};

/** The MCP card's small tile (its step numbers), holding a glyph. */
const SmallTile: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <span aria-hidden className="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border border-border-subtle bg-bg-item-surface text-text-secondary">{children}</span>
);

/**
 * One thing a connector adds (Granola's "Includes"), as a line on the page:
 * its glyph in the small tile, the name over one grey line, and room for a
 * switch on the right. Stack them in a PlainSection with space-y-4.
 */
export const FeatureCard: React.FC<{ icon?: React.ReactNode; title: string; description: string; control?: React.ReactNode }> = ({ icon, title, description, control }) => {
    const t = useT();
    return (
        <div className="flex items-start gap-3">
            {icon ? <SmallTile>{icon}</SmallTile> : null}
            <div className="min-w-0 flex-1">
                <h5 className="text-xs font-semibold leading-5 text-text-primary">{t(title)}</h5>
                <p className="text-xs leading-5 text-text-secondary">{t(description)}</p>
            </div>
            {control ? <div className="shrink-0 self-center">{control}</div> : null}
        </div>
    );
};

/** Granola's "How Gmail is used": plain promises straight on the page, no card, each with its glyph in the MCP card's small tile. */
export const UsageList: React.FC<{ title: string; rows: { icon: React.ReactNode; text: string }[] }> = ({ title, rows }) => {
    const t = useT();
    return (
        <section className="mb-6">
            <SectionHeading title={t(title)} />
            <ul className="space-y-2.5 px-1">
                {rows.map((row, i) => (
                    <li key={i} className="flex items-start gap-3 text-xs leading-5 text-text-primary">
                        <SmallTile>{row.icon}</SmallTile>
                        <span className="min-w-0">{t(row.text)}</span>
                    </li>
                ))}
            </ul>
        </section>
    );
};

/**
 * One setting on a connector's page, as Audio's sections: the bold heading
 * with its grey line (`subtitle`), then a card of rows. `after` (an error)
 * lands under the card.
 */
export const DetailSection: React.FC<{ title: string; subtitle?: React.ReactNode; after?: React.ReactNode; children: React.ReactNode }> = ({ title, subtitle, after, children }) => {
    const t = useT();
    return (
        <section className="mb-6">
            <SectionHeading title={t(title)} subtitle={subtitle} />
            <Group>{children}</Group>
            {after}
        </section>
    );
};

/**
 * "How it works", built as Plans builds its own How it works
 * (HowItWorksRefund's StepRow): Audio's section heading, then one row per
 * step on SettingsRow's columns (px-4, a 40px leading column, gap-4),
 * the number standing on its own in that column with no tile (a boxed "1"
 * read as a button in light mode). A step is one sentence, not a title and a
 * line, so rows are not padded out to the tile's 40px: they sit 12px apart.
 * No card around it and nothing staggers in. The text starts on the same
 * line as the account card's text above.
 */
export const HowItWorks: React.FC<{ lines: string[] }> = ({ lines }) => {
    const t = useT();
    return (
        <section className="mb-6">
            <SectionHeading title={t('How it works')} />
            <ol>
                {lines.map((line, i) => (
                    <li key={i} className="flex items-start gap-4 border-x border-transparent px-4 py-1.5">
                        <span className="w-10 shrink-0 text-center text-sm font-semibold leading-5 tabular-nums text-text-primary">{i + 1}</span>
                        <span className="min-w-0 text-sm leading-5 text-text-primary">{t(line)}</span>
                    </li>
                ))}
            </ol>
        </section>
    );
};

/** Numbered steps, as the MCP card's: each number in a small tile. */
export const StepList: React.FC<{ steps: React.ReactNode[] }> = ({ steps }) => (
    <ol className="space-y-2.5">
        {steps.map((step, i) => (
            <li key={i} className="flex items-start gap-3 text-xs leading-5 text-text-primary">
                <span aria-hidden className="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border border-border-subtle bg-bg-item-surface text-[10px] font-bold tabular-nums text-text-secondary">{i + 1}</span>
                <span className="min-w-0">{step}</span>
            </li>
        ))}
    </ol>
);

/** The app's in-flow select. Never a native <select>: its popup leaks into
 *  screen shares (NoNativePopups2026_09_27). AipSelect reads its tokens from an
 *  .aip-root, so it brings one. */
export const ConnectorSelect: React.FC<{ label: string; value: string; options: AipSelectOption[]; onChange: (v: string) => void; disabled?: boolean }> = (props) => {
    const theme = useResolvedTheme();
    return (
        <div className="aip-root" data-theme={theme}>
            <AipSelect {...props} />
            <style>{AIP_CSS}</style>
        </div>
    );
};

/** "All meetings" or one folder. */
export const FolderSelect: React.FC<{ folders: FolderOption[]; value: string | null; onChange: (v: string | null) => void; disabled?: boolean; label?: string }> = ({ folders, value, onChange, disabled, label }) => {
    const t = useT();
    return (
        <ConnectorSelect
            label={label ?? t('Which meetings')}
            value={value ?? ''}
            disabled={disabled}
            onChange={(v) => onChange(v || null)}
            options={[{ id: '', name: t('All meetings') }, ...folders.map((f) => ({ id: f.id, name: f.name }))]}
        />
    );
};

export const folderName = (folders: FolderOption[], id: string | null, all: string): string => (id ? folders.find((f) => f.id === id)?.name ?? all : all);

/** "1 min ago", "3 h ago", "2 days ago", from a timestamp. */
export function ago(at: number, now: number = Date.now()): string {
    const s = Math.max(0, Math.round((now - at) / 1000));
    if (s < 60) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    const d = Math.round(h / 24);
    return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** What was last sent, and whether it got there. */
export const DeliveryLine: React.FC<{ delivery?: DeliveryInfo }> = ({ delivery }) => {
    const t = useT();
    const tones = useSettingsTones();
    if (!delivery) return <span className="text-xs text-text-tertiary">{t('Nothing sent yet.')}</span>;
    const what = delivery.meetingTitle ? `“${delivery.meetingTitle}”` : t('a meeting');
    if (delivery.status === 'success') return <span className="text-xs text-text-secondary">{t('Sent')} {what} {t(ago(delivery.at))}.</span>;
    if (delivery.status === 'pending') return <span className="text-xs text-text-secondary">{t('Sending')} {what}…</span>;
    return <span className={`text-xs ${tones.text.danger}`}>{delivery.message || `${t('Could not send')} ${what}.`}</span>;
};
