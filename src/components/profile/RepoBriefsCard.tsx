// GitHub Repos (#781): its own tab in Profile Intelligence's sidebar, next to
// Cue Cards. Lists the repositories found on the résumé and takes more by link.
//
// Laid out like the Modes Manager's editor (premium/src/ModesSettings.tsx), by
// request: the 28px title with a pill beside it, bold section labels over one
// bordered box each, Reference files' rows and empty box. The link and its Add button share one
// line at the top, by request. The styles below are
// copies of that file's S.* objects with --mm-* swapped for the --pi-* tokens
// Profile Intelligence defines with the same values (dark and light).
import React, { useEffect, useRef, useState } from 'react';
import { Check, FolderGit2, Plus, RefreshCw, X } from 'lucide-react';
import SwapText from '../ui/SwapText';
import { failureText } from '../../lib/proRefusal.mjs';
import type { RepoBriefView, RepoBriefsState } from '../../types/electron';

const STAGE_TEXT: Record<string, string> = {
    queued: 'Waiting its turn at Natively…',
    planning: 'Looking at the repository…',
    fetching: 'Reading the code…',
    mapping: 'Finding the functions…',
    writing: 'Writing the brief…',
};

export function repoStatusText(r: RepoBriefView): string {
    if (r.status === 'ready') {
        const parts = ['Ready'];
        if (typeof r.functionCount === 'number') parts.push(`${r.functionCount} functions`);
        // "read in part" before the commit, so a narrow row cuts the hash first.
        if (r.tier && r.tier !== 'small') parts.push('read in part');
        if (r.sha) parts.push(r.sha.slice(0, 7));
        return parts.join(' · ');
    }
    if (r.status === 'failed' || r.status === 'waiting') return r.error?.message || 'Could not build the brief';
    if (r.stage === 'retrying') {
        // A clock time, not "in N minutes": the card re-renders only on changes,
        // and a wait for GitHub can last most of an hour.
        const later = r.error?.retryAt && r.error.retryAt - Date.now() >= 2 * 60_000
            ? `at ${new Date(r.error.retryAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
            : 'shortly';
        return `${r.error?.message || 'Natively is busy'}. Trying again ${later}…`;
    }
    if (r.status === 'building') return STAGE_TEXT[r.stage || ''] || 'Reading the code…';
    return 'Waiting to start…';
}

const EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';

// Modes Manager's styles (S.* in premium/src/ModesSettings.tsx), --mm-* → --pi-*.
const S = {
    title: { fontSize: 28, fontWeight: 700, color: 'var(--pi-hero)', lineHeight: 1.1, margin: 0 } as React.CSSProperties,
    sectionLabel: {
        fontSize: 15,
        fontWeight: 700,
        color: 'var(--pi-hero)',
        margin: 0,
        marginBottom: 10,
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif',
        letterSpacing: '-0.02em',
        lineHeight: 1.2,
    } as React.CSSProperties,
    contentBox: { border: '1px solid var(--pi-input-border)', borderRadius: 10, background: 'var(--pi-input-bg)' } as React.CSSProperties,
    fileRow: {
        display: 'grid',
        gridTemplateColumns: '13px minmax(0, 1fr) auto 20px 20px',
        alignItems: 'center',
        gap: 7,
        padding: '8px 12px',
        background: 'var(--pi-btn-bg)',
        border: '1px solid var(--pi-btn-border)',
        borderRadius: 10,
    } as React.CSSProperties,
    iconBtn: {
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: 'var(--pi-tertiary)',
        padding: 4,
        display: 'flex',
        borderRadius: 4,
        transition: `color 180ms ${EASE}, transform 140ms ${EASE}`,
    } as React.CSSProperties,
    addFileBtn: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: 'var(--pi-tertiary)',
        fontSize: 12,
        padding: '6px 2px',
        transition: `color 180ms ${EASE}, transform 140ms ${EASE}`,
    } as React.CSSProperties,
    pill: {
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        padding: '7px 18px',
        background: 'var(--pi-btn-bg)',
        border: '1px solid var(--pi-btn-border)',
        borderRadius: 20,
        color: 'var(--pi-primary)',
        fontSize: 12,
        fontWeight: 500,
    } as React.CSSProperties,
    input: {
        width: '100%',
        background: 'transparent',
        border: 'none',
        outline: 'none',
        padding: '14px 16px',
        fontSize: 12,
        color: 'var(--pi-primary)',
        lineHeight: 1.6,
        fontFamily: 'inherit',
        boxSizing: 'border-box',
    } as React.CSSProperties,
    saveBtn: {
        background: 'rgba(255, 255, 255, 0.05)',
        border: '1px solid var(--pi-btn-border)',
        borderRadius: 6,
        color: 'var(--pi-primary)',
        fontSize: 12,
        fontWeight: 500,
        padding: '4px 12px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        transition: `background 180ms ${EASE}, opacity 200ms ease, transform 160ms ${EASE}`,
    } as React.CSSProperties,
    rowName: { fontSize: 12, color: 'var(--pi-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as React.CSSProperties,
    rowMeta: { fontSize: 11, textAlign: 'right', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5 } as React.CSSProperties,
};

const hoverColor = (on: string, off: string) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.color = on; },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.color = off; },
});

// Motion, all from what the app already ships: SwapText and t-icon-swap,
// t-shimmer and t-notice-shake (transitions.dev #04, #09, #15, #12, in
// index.css), the panel's pi-list-in, and Modes Manager's row removal. Those
// snippets read their timing from variables a container sets, so this tab
// sets them on its own blocks (.pi-repos), with the panel's colours.
const MOTION_CSS = `
.pi-root .pi-repos {
    --text-swap-dur: 150ms;
    --text-swap-translate-y: 4px;
    --text-swap-blur: 2px;
    --text-swap-ease: ease-in-out;
    --icon-swap-dur: 250ms;
    --icon-swap-blur: 2px;
    --icon-swap-start-scale: 0.25;
    --icon-swap-ease: ease-in-out;
    --shimmer-dur: 2000ms;
    --shimmer-base: var(--pi-tertiary);
    --shimmer-highlight: var(--pi-hero);
    --shimmer-band: 400%;
    --shimmer-ease: linear;
}
/* Hover is a tint, not movement: rows are scanned often. Pointer devices only,
   so a tap on a touch screen does not leave a row lit. */
.pi-root .pi-repo-row { transition: background-color 150ms ease, border-color 150ms ease; }
@media (hover: hover) and (pointer: fine) {
    .pi-root .pi-repo-row:hover { background-color: var(--pi-btn-bg-hover); }
}
/* A row added while the tab is open rises in like Modes' fresh rows. Rows
   already there arrive with the panel's cascade instead. fill backwards, never
   both: a finished "both" leaves the row a stacking context for good. */
.pi-root .pi-repo-row.is-fresh { animation: pi-list-in 420ms var(--pi-ease-expo) backwards; }
/* The status text: SwapText's inline-block is capped so a long status still
   ends in an ellipsis rather than being cut. */
.pi-root .pi-repo-status .t-text-swap { max-width: 100%; vertical-align: bottom; }
.pi-root .pi-repo-status-text { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Update / Try again comes in on the icon-swap curve once the build stops,
   and leaves the same way while one runs: the slot never jumps. */
.pi-root .pi-repo-act {
    transition:
        opacity var(--icon-swap-dur) var(--icon-swap-ease),
        filter var(--icon-swap-dur) var(--icon-swap-ease),
        transform var(--icon-swap-dur) var(--icon-swap-ease),
        color 180ms var(--pi-ease-out);
}
.pi-root .pi-repo-act[data-hidden='true'] {
    opacity: 0;
    filter: blur(var(--icon-swap-blur));
    transform: scale(var(--icon-swap-start-scale));
    pointer-events: none;
}
.pi-root .pi-repo-add[data-error='true'] { border-color: color-mix(in srgb, var(--pi-danger) 55%, transparent) !important; }
.pi-root .pi-repo-error { animation: pi-list-in 250ms var(--pi-ease-out) backwards; }
@media (prefers-reduced-motion: reduce) {
    .pi-root .pi-repo-row.is-fresh,
    .pi-root .pi-repo-error { animation: pi-fade-only 150ms ease backwards; }
    .pi-root .pi-repo-act[data-hidden='true'] { filter: none; transform: none; }
}
`;

// Modes Manager's animateRowRemove (premium/src/ModesSettings.tsx), ported:
// the content fades and lifts first, then the space closes on the manager's
// spring, the list's gap with it, so the rows below glide up instead of
// jumping. `restore` puts the row back if the removal did not happen.
const REPO_SPRING = 'linear(0, 0.0229, 0.0789, 0.1534, 0.2363, 0.3211, 0.4034, 0.4807, 0.5515, 0.6152, 0.6717, 0.7214, 0.7645, 0.8018, 0.8337, 0.861, 0.8841, 0.9036, 0.9201, 0.9339, 0.9454, 0.9551, 0.9631, 0.9698, 0.9753, 0.9799, 0.9837, 0.9868, 0.9894, 0.9915, 0.9932, 0.9946, 0.9958, 0.9968, 0.9975, 0.9982, 0.9987, 0.9991, 0.9995, 0.9998, 1)';
const ROW_GAP = 6;
function collapseRow(el: HTMLElement | null, onDone: () => void): { restore: () => void } {
    const none = { restore: () => {} };
    if (!el || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { onDone(); return none; }
    if (el.dataset.removing) return none;
    el.dataset.removing = 'true';
    const saved = el.style.cssText;
    const borders = el.offsetHeight - el.clientHeight;
    el.style.maxHeight = `${el.offsetHeight}px`;
    el.style.overflow = 'hidden';
    void el.offsetHeight; // commit the starting height before transitioning from it
    el.style.transition = `opacity 150ms var(--pi-ease-out), transform 150ms var(--pi-ease-out), max-height 320ms ${REPO_SPRING}, margin 320ms ${REPO_SPRING}, padding 320ms ${REPO_SPRING}`;
    el.style.opacity = '0';
    el.style.transform = 'translateY(-4px)';
    el.style.maxHeight = '0px';
    el.style.marginBottom = `${-(ROW_GAP + borders)}px`;
    el.style.paddingTop = '0px';
    el.style.paddingBottom = '0px';
    setTimeout(onDone, 320);
    return { restore: () => { el.style.cssText = saved; delete el.dataset.removing; } };
}

/** Two icons in one slot, transitions.dev #09 (index.css `.t-icon-swap`). */
function IconSwap({ showB, a, b, size }: { showB: boolean; a: React.ReactNode; b: React.ReactNode; size: number }) {
    return (
        <span className="t-icon-swap" data-state={showB ? 'b' : 'a'} style={{ width: size, height: size, flexShrink: 0 }} aria-hidden="true">
            <span className="t-icon" data-icon="a" style={{ display: 'flex' }}>{a}</span>
            <span className="t-icon" data-icon="b" style={{ display: 'flex' }}>{b}</span>
        </span>
    );
}

const EMPTY: RepoBriefsState = { repos: [], suggestions: [], max: 5 };

export function RepoBriefsSection({ hasResume, onGoToIdentity }: { hasResume: boolean; onGoToIdentity?: () => void }) {
    const [state, setState] = useState<RepoBriefsState>(EMPTY);
    const [url, setUrl] = useState('');
    const [error, setError] = useState('');
    const [errorSeq, setErrorSeq] = useState(0);
    const [busy, setBusy] = useState(false);
    const [focused, setFocused] = useState(false);
    // Rows on screen when the tab opened arrive with the panel's cascade; only
    // the ones added after that get their own entrance.
    const known = useRef<Set<string> | null>(null);
    const addBox = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let alive = true;
        const take = (s: RepoBriefsState | null | undefined) => {
            if (!alive || !s) return;
            if (!known.current) known.current = new Set(s.repos.map((r) => r.key));
            setState(s);
        };
        window.electronAPI?.repoBriefsList?.().then(take).catch(() => { if (!known.current) known.current = new Set(); });
        const off = window.electronAPI?.onRepoBriefsUpdated?.(take);
        return () => { alive = false; off?.(); };
    }, []);

    // A failed add shakes the box once (t-notice-shake). Remove, reflow, re-add
    // replays it for a second failure in a row.
    useEffect(() => {
        const el = addBox.current;
        if (!errorSeq || !el) return;
        el.classList.remove('t-notice-shake');
        void el.offsetWidth;
        el.classList.add('t-notice-shake');
    }, [errorSeq]);

    const full = state.repos.length >= state.max;
    const fail = (message: string) => { setError(message); setErrorSeq((n) => n + 1); };

    const add = async (link: string, projectName?: string, row?: HTMLElement | null) => {
        if (!link.trim() || busy) return false;
        setError(''); setBusy(true);
        // A suggestion leaves its list while the add runs; it comes back if the add fails.
        const leaving = row ? collapseRow(row, () => {}) : null;
        try {
            const res = await window.electronAPI?.repoBriefsAdd?.(link.trim(), projectName);
            if (res && res.success) { setState(res); setUrl(''); return true; }
            leaving?.restore();
            fail(failureText(res, 'Could not add this repository.'));
        } catch (e: any) {
            leaving?.restore();
            fail(e?.message || 'Could not add this repository.');
        } finally { setBusy(false); }
        return false;
    };
    const remove = (key: string, row: HTMLElement | null) => {
        let restore = () => {};
        ({ restore } = collapseRow(row, async () => {
            try {
                const res = await window.electronAPI?.repoBriefsRemove?.(key);
                if (res?.repos) setState(res as RepoBriefsState);
                else restore();
            } catch { restore(); }
        }));
    };
    const refresh = async (key: string) => {
        const res = await window.electronAPI?.repoBriefsRefresh?.(key);
        if (res && !res.success) fail(failureText(res, 'Could not update this repository.'));
        else if (res?.repos) setState(res as RepoBriefsState);
    };

    const canAdd = !busy && !!url.trim();

    return (
        <>
            {/* Header: title + pill, as Modes Manager's title + Active */}
            <div className="pi-repos" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 28 }}>
                <h2 style={S.title}>GitHub Repos</h2>
                <span style={S.pill}>
                    {/* One flex item: the pill's gap would otherwise split "3" from "of 5". */}
                    <span><SwapText swapKey={String(state.repos.length)}>{state.repos.length}</SwapText> of {state.max}</span>
                </span>
            </div>

            {/* Add a repository: one line, the link and its Add button in one box */}
            {!full && (
                <div className="pi-repos" style={{ marginBottom: 24 }}>
                    <h3 style={S.sectionLabel}>Add a repository</h3>
                    <div
                        ref={addBox}
                        className="pi-repo-add"
                        data-error={error ? 'true' : undefined}
                        style={{
                            ...S.contentBox,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            paddingRight: 8,
                            background: focused ? 'var(--pi-input-bg-focus)' : 'transparent',
                            borderColor: focused ? 'var(--pi-input-border-focus)' : 'var(--pi-input-border)',
                            transition: `border-color 180ms ${EASE}, background 180ms ease`,
                        }}
                    >
                        <input
                            type="text"
                            value={url}
                            placeholder="github.com/you/project"
                            spellCheck={false}
                            aria-invalid={error ? true : undefined}
                            style={{ ...S.input, flex: 1, minWidth: 0, padding: '12px 16px' }}
                            onFocus={() => setFocused(true)}
                            onBlur={() => setFocused(false)}
                            onChange={(e) => { setUrl(e.target.value); setError(''); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') void add(url); }}
                        />
                        <button
                            className="pi-press"
                            style={{ ...S.saveBtn, flexShrink: 0, opacity: canAdd || busy ? 1 : 0.4, cursor: canAdd ? 'pointer' : 'default' }}
                            disabled={!canAdd}
                            onClick={() => add(url)}
                        >
                            <IconSwap showB={busy} size={11} a={<Plus size={11} />} b={<RefreshCw size={11} className="pi-spinner" />} />
                            Add
                        </button>
                    </div>
                </div>
            )}

            {/* An Add or Update failure, under the box it came from or alone when the list is full. */}
            {error && (
                <p key={errorSeq} role="status" className="pi-repos pi-repo-error" style={{ fontSize: 11, color: 'var(--pi-danger)', margin: full ? '0 0 24px' : '-14px 0 24px 4px' }}>
                    {error}
                </p>
            )}

            {/* Your repositories: Reference files' box and rows */}
            <div className="pi-repos" style={{ marginBottom: 24 }}>
                <h3 style={S.sectionLabel}>Your repositories</h3>
                {state.repos.length === 0 ? (
                    <div style={{ ...S.contentBox, padding: '22px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                        <p style={{ fontSize: 12, color: 'var(--pi-tertiary)', textAlign: 'center', margin: 0, lineHeight: 1.5, maxWidth: 420 }}>
                            Natively reads each public repository before your interview, so answers about your code name its real functions and files.
                        </p>
                        {!hasResume && (
                            <p style={{ fontSize: 12, color: 'var(--pi-tertiary)', textAlign: 'center', margin: 0, lineHeight: 1.5 }}>
                                Repositories linked on your resume show up here. Add your resume in{' '}
                                {onGoToIdentity
                                    ? <button type="button" onClick={onGoToIdentity} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontWeight: 600, color: 'var(--pi-primary)', cursor: 'pointer' }}>Identity</button>
                                    : <strong style={{ color: 'var(--pi-primary)' }}>Identity</strong>}
                                .
                            </p>
                        )}
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: ROW_GAP }}>
                        {state.repos.map((r) => {
                            const working = r.status === 'queued' || r.status === 'building';
                            const problem = r.status === 'failed' || r.status === 'waiting';
                            const status = repoStatusText(r);
                            const fresh = !!known.current && !known.current.has(r.key);
                            return (
                                <div key={r.key} className={`pi-repo-row${fresh ? ' is-fresh' : ''}`} style={S.fileRow}>
                                    <FolderGit2 size={13} style={{ color: 'var(--pi-secondary)', flexShrink: 0 }} />
                                    <span style={S.rowName} title={`${r.owner}/${r.repo}`}>
                                        {r.owner}/{r.repo}
                                        {r.projectName && <span style={{ color: 'var(--pi-tertiary)' }}> · {r.projectName}</span>}
                                    </span>
                                    <span className="pi-repo-status" style={{ ...S.rowMeta, color: problem ? 'var(--pi-danger)' : 'var(--pi-tertiary)' }} title={status}>
                                        {!problem && (
                                            <IconSwap
                                                showB={!working}
                                                size={11}
                                                a={<RefreshCw size={10} className="pi-spinner" />}
                                                b={<Check size={11} />}
                                            />
                                        )}
                                        <span style={{ display: 'block', minWidth: 0, overflow: 'hidden' }}>
                                            <SwapText swapKey={`${r.status}|${r.stage ?? ''}|${r.error?.code ?? ''}`}>
                                                <span className={`pi-repo-status-text${working ? ' t-shimmer' : ''}`} data-text={status}>{status}</span>
                                            </SwapText>
                                        </span>
                                    </span>
                                    <button
                                        className="pi-press-soft pi-repo-act"
                                        data-hidden={working ? 'true' : undefined}
                                        disabled={working}
                                        tabIndex={working ? -1 : undefined}
                                        style={S.iconBtn}
                                        onClick={() => refresh(r.key)}
                                        title={r.status === 'ready' ? 'Read the newest commit' : 'Try again'}
                                        aria-label={r.status === 'ready' ? `Update ${r.owner}/${r.repo}` : `Try ${r.owner}/${r.repo} again`}
                                        {...hoverColor('var(--pi-primary)', 'var(--pi-tertiary)')}
                                    >
                                        <RefreshCw size={12} />
                                    </button>
                                    <button
                                        className="pi-press-soft"
                                        style={S.iconBtn}
                                        onClick={(e) => remove(r.key, e.currentTarget.closest<HTMLElement>('.pi-repo-row'))}
                                        aria-label={`Remove ${r.owner}/${r.repo}`}
                                        {...hoverColor('var(--pi-danger)', 'var(--pi-tertiary)')}
                                    >
                                        <X size={12} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* From your resume: the same rows, with Reference files' "+ Add" */}
            {state.suggestions.length > 0 && !full && (
                <div className="pi-repos" style={{ marginBottom: 24 }}>
                    <h3 style={S.sectionLabel}>From your resume</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: ROW_GAP }}>
                        {state.suggestions.map((s) => (
                            <div key={s.url} className="pi-repo-row" style={{ ...S.fileRow, gridTemplateColumns: '13px minmax(0, 1fr) auto' }}>
                                <FolderGit2 size={13} style={{ color: 'var(--pi-secondary)', flexShrink: 0 }} />
                                <span style={S.rowName} title={`${s.owner}/${s.repo}`}>
                                    {s.owner}/{s.repo}
                                    {s.projectName && <span style={{ color: 'var(--pi-tertiary)' }}> · {s.projectName}</span>}
                                </span>
                                <button
                                    className="pi-press-soft"
                                    style={{ ...S.addFileBtn, padding: '2px' }}
                                    disabled={busy}
                                    onClick={(e) => add(s.url, s.projectName, e.currentTarget.closest<HTMLElement>('.pi-repo-row'))}
                                    {...hoverColor('var(--pi-primary)', 'var(--pi-tertiary)')}
                                >
                                    <Plus size={12} /> Add
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Last, so it never takes a slot in the panel's nth-child cascade. */}
            <style>{MOTION_CSS}</style>
        </>
    );
}
