import React, { useState, useRef, useEffect, useLayoutEffect, useId, useMemo } from 'react';
import { useT } from '../i18n';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { ArrowLeft, Search, Mail, Link, ChevronDown, Play, ArrowUp, Copy, Check, MoreHorizontal, Settings, ArrowRight, RefreshCw, Info, Eye, EyeOff, History, Pencil, X, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { genMessageId } from '../utils/messageId';
import { mapLanguageForPrism, isBlockCode } from '../utils/prismLanguage';
import { registerPrismLanguages } from '../utils/registerPrismLanguages';
import MeetingChatOverlay from './MeetingChatOverlay';
import EditableTextBlock from './EditableTextBlock';
import NativelyLogo from './icon.png';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-light';
import { vividDarkCodeTheme } from '../lib/codeTheme';
import { splitGistLine } from '../lib/displayMarkup';
import { splitIntoWordRuns } from '../lib/textRevealAnimation.mjs';

registerPrismLanguages();

const formatTime = (ms: number) => {
    const date = new Date(ms);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).toLowerCase();
};

const formatDuration = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}:${Number(seconds) < 10 ? '0' : ''}${seconds}`;
};

// Some stored answers arrive with their list newlines collapsed to spaces, so a
// bullet list becomes a run-on line ("- a. - b - c"). remark then parses that as
// ONE list item with literal inline dashes. Re-break mid-line bullet markers onto
// their own lines so the list renders. Heavily gated to avoid corrupting prose:
// only fires when the text actually looks like a flattened list, protects code,
// and never splits number ranges ("3 - 1") or hyphenated words ("state-of-art").
const reflowFlattenedList = (text: string): string => {
    // Detect a list whose newlines were collapsed to spaces upstream, e.g.
    // "Here's the plan: - Build it. - Test it." or "Steps: 1. Do x. 2. Do y.".
    // remark then parses that run-on as a single paragraph / single list item.
    // We re-break the inline markers onto their own lines so it renders as a list.
    //
    // Gating (to avoid corrupting prose): require at least TWO inline markers of
    // the same kind. Bullets must be space-surrounded with a non-digit neighbour
    // (so "3 - 1" ranges and "state-of-art" are untouched); numbered items match
    // " N. Capital" runs (so "version 2. x" mid-sentence is unlikely to trip).
    const bulletRun = /(^|\s)[-*\u2022]\s+(?=[^\d\s])/g;
    const numberRun = /(^|\s)\d{1,2}[.)]\s+(?=[A-Z(`])/g;
    const bulletCount = (text.match(bulletRun) || []).length;
    const numberCount = (text.match(numberRun) || []).length;
    const looksBullet = bulletCount >= 2;
    const looksNumber = numberCount >= 2;
    if (!looksBullet && !looksNumber) return text;
    // If it already has real newlines separating most markers, leave it alone.
    if (/\n\s*(?:[-*\u2022]|\d{1,2}[.)])\s+/.test(text) && !/\S[ \t]+(?:[-*\u2022]|\d{1,2}[.)])[ \t]+/.test(text)) {
        return text;
    }

    // Protect fenced + inline code so a marker inside code is never broken.
    const stash: string[] = [];
    const put = (m: string): string => {
        stash.push(m);
        return '\u0001' + (stash.length - 1) + '\u0001';
    };
    let out = text
        .replace(/```[\s\S]*?```/g, put)
        .replace(/`[^`]*`/g, put);

    if (looksBullet) {
        // Break " <char> <marker> <non-digit>" onto a new bullet line.
        out = out.replace(/([^\d\s])[ \t]+([-*\u2022])[ \t]+(?=[^\d\s])/g, '$1\n$2 ');
    }
    if (looksNumber) {
        // Break " N. Capital" onto a new numbered line (keep the number).
        out = out.replace(/([^\s])[ \t]+(\d{1,2}[.)])[ \t]+(?=[A-Z(\u0001])/g, '$1\n$2 ');
    }

    // Restore code.
    return out.replace(/\u0001(\d+)\u0001/g, (_m, i) => stash[Number(i)] || '');
};

const cleanMarkdown = (content: string) => {
    if (!content) return '';
    // Ensure code blocks are on new lines to fix rendering issues
    const withCodeBreaks = content.replace(/([^\n])```/g, '$1\n\n```');
    // Repair lists whose newlines were collapsed to spaces upstream.
    return reflowFlattenedList(withCodeBreaks);
};

// ── Coding template renderer ──────────────────────────────────────────────────

interface CodingSection {
    title: string;
    body: string;
}

type DetailKind = 'approach' | 'dry-run' | 'complexity' | 'followup';

// Ordered labels for the detail pill strip. "Approach" only appears when the full
// reasoning is longer than the one-line thesis we already show above the code.
const DETAIL_PILLS: { kind: DetailKind; label: string }[] = [
    { kind: 'approach',   label: 'Approach'       },
    { kind: 'dry-run',    label: 'Dry run'        },
    { kind: 'complexity', label: 'Complexity'     },
    { kind: 'followup',   label: 'Follow-up tips' },
];

// iOS drawer easing (Vaul/Ionic) for the panel height reveal; content crossfade
// uses a snappier out-curve.
const DRAWER_EASE = [0.32, 0.72, 0, 1] as [number, number, number, number];
const CROSSFADE_EASE = [0.23, 1, 0.32, 1] as [number, number, number, number];

// Mount cascade: blocks settle in with a short blur-bridged stagger.
const MOUNT_CONTAINER = {
    hidden: {},
    show: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
};
const MOUNT_CHILD = {
    hidden: { opacity: 0, y: 6, filter: 'blur(4px)' },
    show:   { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.32, ease: CROSSFADE_EASE } },
};
const MOUNT_CHILD_REDUCED = {
    hidden: { opacity: 0 },
    show:   { opacity: 1, transition: { duration: 0.2 } },
};

// This section is HISTORY — read-mostly, viewed repeatedly. Animation earns its
// place only the FIRST time a given Q&A is seen this session; on every later view
// it renders instantly. This module-scope set persists across tab unmount/remount
// within the session, which is exactly the lifetime we want.
const seenInteractionIds = new Set<string>();

// Pull the first sentence from the approach so we can lead with a one-line thesis
// and tuck the full reasoning into a pill. Avoids cutting on common false
// terminators — decimals (3.4x), abbreviations (e.g., i.e., etc.), and single
// initials — by requiring the terminator to be followed by a space + a capital or
// end-of-string, and rejecting matches that end in a known abbreviation. Falls
// back to a length cap so a run-on paragraph never becomes the whole thesis.
const ABBREV_RE = /(?:^|\s)(?:e\.g|i\.e|etc|vs|approx|Dr|Mr|Ms|Mrs|Fig|No|cf|al)\.$/i;
function firstSentence(text: string): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    // Terminator = .!? not preceded by a digit (decimals) and followed by space +
    // uppercase/quote/end. Scan for the first that isn't a known abbreviation.
    const re = /(?<!\d)[.!?](?=\s+["'“(]?[A-Z0-9]|\s*$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(flat)) !== null) {
        const candidate = flat.slice(0, m.index + 1);
        if (!ABBREV_RE.test(candidate)) {
            return candidate.trim();
        }
    }
    // No clean sentence boundary — cap length so the thesis stays one line.
    return flat.length > 160 ? flat.slice(0, 157).trimEnd() + '…' : flat;
}

// Extract a compact "O(n) time · O(1) space" chip from the complexity section so
// the single most-scanned fact is never hidden behind a click. Returns null when
// nothing parseable is found (caller then keeps complexity as a pill).
function extractComplexity(body: string): string | null {
    // NOTE: a negated class like [^O] under /i also excludes lowercase 'o', which
    // breaks on the common phrasing "Time complexity: O(n)" (the 'o' in
    // "complexity" blocks the lazy scan). Match Big-O on the SAME line as the
    // time/space keyword instead, so any prose in between is fine.
    const time  = /time[^\n]*?(O\([^)]*\))/i.exec(body)?.[1];
    const space = /space[^\n]*?(O\([^)]*\))/i.exec(body)?.[1];
    if (time || space) {
        return [time && `${time} time`, space && `${space} space`].filter(Boolean).join(' · ');
    }
    const bare = body.match(/O\([^)]*\)/g);
    return bare && bare.length ? Array.from(new Set(bare)).slice(0, 2).join(' · ') : null;
}

// Render a complexity string with real superscripts: "O(N^2 2^N)" → O(N²2ᴺ) via
// <sup>, plus the middot separator styled down. The exponent after ^ is the run
// of alphanumerics that follows (e.g. 2, N, log).
const renderComplexity = (text: string): React.ReactNode => {
    const parts = text.split(/(\^[A-Za-z0-9]+|·)/g);
    return parts.map((part, i) => {
        if (part === '·') {
            return <span key={i} className="mx-1 text-white/25">·</span>;
        }
        if (part.startsWith('^')) {
            return <sup key={i} className="text-[0.7em] font-semibold">{part.slice(1)}</sup>;
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
    });
};

// Pull out the fenced code from the "Code" section, but ONLY take the single-hero
// fast-path (custom header + technique chip) when the body is EXACTLY one fenced
// block and nothing else. Anything richer (multiple blocks, or code interleaved
// with prose) returns null so the caller falls back to the full markdown renderer
// and nothing is dropped.
function extractCodeBlock(body: string): { lang: string; code: string } | null {
    const trimmed = body.trim();
    const matches = Array.from(trimmed.matchAll(/```([\w+#-]*)\n?([\s\S]*?)```/g));
    if (matches.length !== 1) return null;
    const m = matches[0];
    if (trimmed.replace(m[0], '').trim().length > 0) return null; // prose outside fence
    return { lang: m[1] || '', code: m[2].replace(/\n$/, '') };
}

// Short, single-line label for the technique chip in the code header.
function techniqueLabel(body: string): string {
    return body
        .replace(/[`*_#>]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^(via|using|use|technique[:\s-]*)\s*/i, '')
        .slice(0, 48);
}

// Copy-to-clipboard control for the code hero. Ghosted until hover on desktop,
// icon crossfades copy → check on success and reverts after 2s.
const CopyButton: React.FC<{ text: string }> = ({ text }) => {
    const t = useT();
    const [copied, setCopied] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
    const handle = () => {
        // navigator.clipboard is undefined outside a secure context; the optional
        // chain guards .writeText but the whole expression is then undefined, so
        // guard the promise before calling .then/.catch on it.
        const p = navigator.clipboard?.writeText(text);
        if (!p) return;
        p.then(() => {
            setCopied(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 2000);
        }).catch(() => {});
    };
    return (
        <button
            type="button"
            onClick={handle}
            aria-label={copied ? t('Copied') : t('Copy code')}
            className="relative w-6 h-6 inline-flex items-center justify-center rounded-md text-white/40 hover:text-white/80 hover:bg-white/[0.06] transition-[color,background-color,transform] duration-100 ease-out active:scale-[0.92] opacity-100 md:opacity-0 md:group-hover:opacity-100 focus:outline-none focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-white/20"
        >
            <AnimatePresence mode="wait" initial={false}>
                {copied ? (
                    <motion.span key="check" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.14 }} className="absolute inset-0 flex items-center justify-center">
                        <Check className="w-3.5 h-3.5 text-emerald-400" strokeWidth={2.5} />
                    </motion.span>
                ) : (
                    <motion.span key="copy" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.14 }} className="absolute inset-0 flex items-center justify-center">
                        <Copy className="w-3.5 h-3.5" strokeWidth={2} />
                    </motion.span>
                )}
            </AnimatePresence>
        </button>
    );
};

// Strip markdown to plain text for the "copy whole answer" action — drops
// heading hashes, list bullets, emphasis, and code fences but keeps the words and
// code body, so what lands on the clipboard reads like the rendered answer.
function markdownToPlainText(md: string): string {
    return md
        .replace(/```[\w+#-]*\n?/g, '')      // fence openers
        .replace(/```/g, '')                  // fence closers
        .replace(/^#{1,6}\s+/gm, '')          // heading hashes
        .replace(/^\s*[-*+]\s+/gm, '• ')      // list bullets
        .replace(/^\s*\d+\.\s+/gm, (m) => m.trim() + ' ')
        .replace(/\*\*([^*]+)\*\*/g, '$1')    // bold
        .replace(/\*([^*]+)\*/g, '$1')        // italic
        .replace(/`([^`]+)`/g, '$1')          // inline code
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// Text button used in the answer-level hover action bar (copy whole answer).
// Same copy→check feedback as CopyButton but with a visible label.
const AnswerCopyButton: React.FC<{ text: string }> = ({ text }) => {
    const t = useT();
    const [copied, setCopied] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
    const handle = () => {
        const p = navigator.clipboard?.writeText(text);
        if (!p) return;
        p.then(() => {
            setCopied(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 2000);
        }).catch(() => {});
    };
    return (
        <button
            type="button"
            onClick={handle}
            aria-label={copied ? t('Copied answer') : t('Copy answer')}
            className="inline-flex items-center gap-1 h-6 px-1.5 rounded-md cursor-default select-none text-[11px] font-medium text-text-tertiary hover:text-text-secondary hover:bg-white/[0.05] transition-[color,background-color,transform] duration-[120ms] ease-out active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
        >
            {copied ? <Check className="w-3 h-3 text-emerald-400" strokeWidth={2.5} /> : <Copy className="w-3 h-3" strokeWidth={2} />}
            <span>{copied ? t('Copied') : t('Copy')}</span>
        </button>
    );
};

function classifySection(title: string): 'approach' | 'technique' | 'code' | DetailKind | 'other' {
    const t = title.toLowerCase().trim();
    if (/approach/.test(t))                            return 'approach';
    if (/technique|data.?structure|algorithm/.test(t)) return 'technique';
    if (/^code$/.test(t))                              return 'code';
    if (/dry.?run|trace/.test(t))                      return 'dry-run';
    if (/complex/.test(t))                             return 'complexity';
    if (/follow.?up|interviewer/.test(t))              return 'followup';
    return 'other';
}

/**
 * Split a coding answer into named sections. Returns null when the answer does
 * not contain recognisable coding template headings.
 */
function parseCodingTemplate(answer: string): CodingSection[] | null {
    const lines = answer.split('\n');
    const sections: CodingSection[] = [];
    let current: CodingSection | null = null;

    const H2_RE = /^##\s+(.+)$/;
    for (const line of lines) {
        const m = H2_RE.exec(line);
        if (m) {
            if (current) sections.push(current);
            current = { title: m[1].trim(), body: '' };
        } else if (current) {
            current.body += (current.body ? '\n' : '') + line;
        }
    }
    if (current) sections.push(current);

    const KNOWN = new Set(['approach','technique','code','dry-run','complexity','followup']);
    const knownCount = sections.filter(s => KNOWN.has(classifySection(s.title))).length;
    if (knownCount < 2) return null;
    return sections;
}

// GFM table renderers, defined once and shared by every ReactMarkdown surface in
// this file. Tailwind's preflight zeroes cell padding, so columns need explicit
// gaps (right padding) and a hairline under the header. The min-w-0 wrapper is
// what makes a wide table scroll instead of stretching the column it sits in,
// and `code-scroll` keeps that scrollbar discreet — see the .code-scroll block
// in index.css for why the global scrollbar rule does not cover this case.
// `tableClass` is the only thing that varies between surfaces (font size).
const makeTableComponents = (tableClass: string) => ({
    table: ({ node, ...props }: any) => (
        <div className="code-scroll w-full min-w-0 overflow-x-auto mb-2 last:mb-0">
            <table className={`border-collapse ${tableClass}`} {...props} />
        </div>
    ),
    th: ({ node, ...props }: any) => <th className="text-left align-top font-semibold text-text-primary pr-5 last:pr-0 pb-1.5 border-b border-border-muted" {...props} />,
    td: ({ node, ...props }: any) => <td className="text-left align-top text-text-secondary tabular-nums pr-5 last:pr-0 py-1" {...props} />,
});

// Shared markdown renderer config — used by both CodingAnswerBlock and plain answers.
const mdComponents = {
    h1: ({ node, ...props }: any) => <p className="text-[15px] text-text-secondary font-semibold leading-relaxed mb-2" {...props} />,
    h2: ({ node, ...props }: any) => <p className="text-[15px] text-text-secondary font-semibold leading-relaxed mb-2" {...props} />,
    h3: ({ node, ...props }: any) => <p className="text-[14px] text-text-secondary font-semibold leading-relaxed mb-1.5" {...props} />,
    p: ({ node, ...props }: any) => <p className="text-[15px] text-text-secondary font-normal leading-relaxed mb-2 last:mb-0" {...props} />,
    ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-2 space-y-1.5" {...props} />,
    ol: ({ node, ...props }: any) => <ol className="list-decimal ml-4 mb-2 space-y-1.5" {...props} />,
    li: ({ node, ...props }: any) => <li className="text-[15px] text-text-secondary font-normal leading-relaxed" {...props} />,
    strong: ({ node, ...props }: any) => <strong className="font-semibold text-text-primary" {...props} />,
    ...makeTableComponents('text-[13.5px] leading-relaxed'),
    a: ({ node, ...props }: any) => <a target="_blank" rel="noopener noreferrer" className="text-accent-primary hover:text-accent-hover underline underline-offset-2 transition-colors duration-150" {...props} />,
    pre: ({ children }: any) => <div className="mb-3 last:mb-0">{children}</div>,
    code: ({ node, className, children, ...props }: any) => {
        const match = /language-([\w+#-]+)/.exec(className || '');
        const lang = match ? match[1] : '';
        const codeStr = String(children);
        const isBlock = isBlockCode(className, codeStr);
        return isBlock ? (
            <CodeHero lang={lang} code={codeStr.replace(/\n$/, '')} />
        ) : (
            <code className="bg-white/[0.07] px-1.5 py-0.5 rounded-md text-[13px] font-mono text-blue-300/80 border border-white/[0.06]" {...props}>
                {children}
            </code>
        );
    },
};

// Bespoke code hero: custom header (language label · technique chip · copy button),
// inner top-edge highlight instead of a drop shadow, line numbers only past 8 lines.
// FIXED WIDTH: the card is always w-full and never grows with content — a long
// unbreakable code line scrolls INSIDE the min-w-0 scroll container rather than
// stretching the card (a flex/grid child's default min-width:auto would otherwise
// let the <pre> push the whole answer column wider).
const CodeHero: React.FC<{ lang: string; code: string; technique?: string }> = ({ lang, code, technique }) => {
    const resolved = mapLanguageForPrism(lang, code);
    const lineCount = code.split('\n').length;
    // Right-edge fade only while there's more code to scroll to — hints "more →"
    // without a hard cut; absent when the block fits.
    const scrollRef = useRef<HTMLDivElement>(null);
    const [overflowRight, setOverflowRight] = useState(false);
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const update = () => setOverflowRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 1);
        update();
        el.addEventListener('scroll', update, { passive: true });
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => { el.removeEventListener('scroll', update); ro.disconnect(); };
    }, [code]);
    return (
        <div className="group relative w-full min-w-0 rounded-xl overflow-hidden border border-white/[0.08] ring-1 ring-inset ring-white/[0.05] bg-[#0a0a0d]/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] transition-colors duration-200 hover:border-white/[0.12]">
            <div className="flex items-center gap-2 h-9 px-3 border-b border-white/[0.05] bg-white/[0.02]">
                <span className="text-[11px] uppercase tracking-[0.04em] font-medium text-text-tertiary font-mono select-none cursor-default">
                    {resolved || 'code'}
                </span>
                <div className="flex-1" />
                {technique && (
                    <span className="hidden sm:inline-flex items-center max-w-[220px] truncate text-[11px] font-medium text-white/45 select-none cursor-default">
                        {technique}
                    </span>
                )}
                <CopyButton text={code} />
            </div>
            <div
                ref={scrollRef}
                className="code-scroll w-full min-w-0 overflow-x-auto"
                style={overflowRight ? { WebkitMaskImage: 'linear-gradient(to right, #000 calc(100% - 24px), transparent)', maskImage: 'linear-gradient(to right, #000 calc(100% - 24px), transparent)' } : undefined}
            >
                <SyntaxHighlighter
                    language={resolved}
                    style={vividDarkCodeTheme}
                    customStyle={{ margin: 0, borderRadius: 0, fontSize: '13px', lineHeight: '1.6', background: 'transparent', padding: '14px 16px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
                    showLineNumbers={lineCount > 8}
                    lineNumberStyle={{ minWidth: '2.2em', paddingRight: '1.2em', color: 'rgba(255,255,255,0.2)', textAlign: 'right', fontSize: '11px', userSelect: 'none' }}
                >
                    {code}
                </SyntaxHighlighter>
            </div>
        </div>
    );
};

/**
 * Apple-quality coding answer renderer.
 * - Leads with a one-line thesis (first sentence of the approach), then the code.
 * - Technique rides as a chip inside the code header; complexity as an always-visible
 *   chip beneath it — the fact people came for is never behind a click.
 * - Deep reasoning (full approach / dry run / follow-up) collapses into one pill row
 *   with a sliding highlight and a single continuous-height panel (blur-bridged
 *   crossfade when switching, iOS drawer curve for open/close).
 */
const CodingAnswerBlock: React.FC<{ sections: CodingSection[]; firstView?: boolean }> = ({ sections, firstView = false }) => {
    const t = useT();
    const reduce = useReducedMotion();
    const [activeDetail, setActiveDetail] = useState<DetailKind | null>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const pillsRef = useRef<HTMLDivElement>(null);
    const [panelHeight, setPanelHeight] = useState(0);
    // framer-motion resolves layoutId GLOBALLY. The usage tab renders one
    // CodingAnswerBlock per Q&A, so a shared literal id would cross-animate the
    // active-pill highlight between separate answers. Scope it per instance.
    const pillLayoutId = useId();
    // Only play the mount cascade the first time this answer is seen this session.
    const animateMount = firstView && !reduce;

    const tagged = sections.map(s => ({ ...s, kind: classifySection(s.title) }));

    const approach  = tagged.find(s => s.kind === 'approach');
    const technique = tagged.find(s => s.kind === 'technique');
    const code      = tagged.find(s => s.kind === 'code');
    const others    = tagged.filter(s => s.kind === 'other');

    const thesis = approach ? firstSentence(approach.body.trim()) : '';
    // Only surface the full approach as a pill when it says more than the thesis.
    const approachIsRicher = approach ? approach.body.trim().length > thesis.length + 24 : false;

    const parsedCode = code ? extractCodeBlock(code.body) : null;
    const techniqueChip = technique ? techniqueLabel(technique.body) : '';

    const complexitySection = tagged.find(s => s.kind === 'complexity');
    const complexityChip = complexitySection ? extractComplexity(complexitySection.body) : null;

    // Build the ordered detail map. Approach (full) is optional; complexity stays a
    // pill only when we couldn't distil a chip from it.
    const detailMap = new Map<DetailKind, CodingSection>();
    if (approach && approachIsRicher) detailMap.set('approach', approach);
    const dryRun = tagged.find(s => s.kind === 'dry-run');
    if (dryRun) detailMap.set('dry-run', dryRun);
    if (complexitySection && !complexityChip) detailMap.set('complexity', complexitySection);
    const followup = tagged.find(s => s.kind === 'followup');
    if (followup) detailMap.set('followup', followup);

    const availablePills = DETAIL_PILLS.filter(p => detailMap.has(p.kind));
    const activeSection  = activeDetail != null ? detailMap.get(activeDetail) : undefined;

    // Measure active content so the container height animates continuously (no
    // collapse-to-zero flicker) even when switching directly between pills.
    // Key on stable primitives — activeSection is a fresh object each render
    // (detailMap is rebuilt from sections.map), so depending on it would tear
    // down and rebuild the observer on every parent re-render.
    const activeBody = activeSection?.body;
    useEffect(() => {
        if (activeBody == null) { setPanelHeight(0); return; }
        const el = panelRef.current;
        if (!el) return;
        setPanelHeight(el.scrollHeight);
        const ro = new ResizeObserver(() => setPanelHeight(el.scrollHeight));
        ro.observe(el);
        return () => ro.disconnect();
    }, [activeDetail, activeBody]);

    const childVariant = reduce ? MOUNT_CHILD_REDUCED : MOUNT_CHILD;

    // Arrow-key navigation across the pill strip (macOS segmented-control feel).
    const onPillKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
        if (!keys.includes(e.key)) return;
        const btns = pillsRef.current ? Array.from(pillsRef.current.querySelectorAll<HTMLButtonElement>('[role="tab"]')) : [];
        if (!btns.length) return;
        e.preventDefault();
        const currentIdx = btns.findIndex(b => b === document.activeElement);
        let next = currentIdx < 0 ? 0 : currentIdx;
        if (e.key === 'ArrowLeft')  next = (currentIdx - 1 + btns.length) % btns.length;
        if (e.key === 'ArrowRight') next = (currentIdx + 1) % btns.length;
        if (e.key === 'Home')       next = 0;
        if (e.key === 'End')        next = btns.length - 1;
        btns[next]?.focus();
    };

    return (
        <motion.div
            className="flex flex-col gap-4 min-w-0 w-full"
            variants={MOUNT_CONTAINER}
            initial={animateMount ? 'hidden' : false}
            animate="show"
        >
            {/* Thesis — one-line claim, the answer at a glance */}
            {thesis && (
                <motion.p variants={childVariant} className="text-[15px] leading-[1.6] text-text-primary m-0 select-text">
                    {thesis}
                </motion.p>
            )}

            {/* Code — hero block with technique chip + copy button */}
            {parsedCode ? (
                <motion.div variants={childVariant} className="min-w-0 w-full">
                    <CodeHero lang={parsedCode.lang} code={parsedCode.code} technique={techniqueChip} />
                </motion.div>
            ) : code ? (
                <motion.div variants={childVariant} className="flex flex-col gap-3 min-w-0 w-full">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                        {cleanMarkdown(code.body.trim())}
                    </ReactMarkdown>
                </motion.div>
            ) : null}

            {/* Complexity — always-visible chip, never behind a click */}
            {complexityChip && (
                <motion.div variants={childVariant} className="flex items-center gap-1.5 -mt-1">
                    <span className="text-[10px] uppercase tracking-[0.1em] font-semibold text-white/25 select-none cursor-default">{t('cost')}</span>
                    <span className="text-[12px] tabular-nums text-text-secondary font-medium select-text font-mono">{renderComplexity(complexityChip)}</span>
                </motion.div>
            )}

            {/* Unrecognised sections — graceful fallthrough */}
            {others.map(s => (
                <motion.div key={s.title} variants={childVariant} className="flex flex-col gap-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-white/20 select-none cursor-default">{s.title}</p>
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                        {cleanMarkdown(s.body.trim())}
                    </ReactMarkdown>
                </motion.div>
            ))}

            {/* Detail pill strip + continuous-height panel */}
            {availablePills.length > 0 && (
                <motion.div variants={childVariant} className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                        <div className="h-px flex-1 bg-white/[0.06]" />
                        {/* Segmented-control semantics: roving tabindex, arrow-key nav */}
                        <div
                            ref={pillsRef}
                            role="tablist"
                            aria-label={t("Answer detail")}
                            className="flex items-center gap-0.5"
                            onKeyDown={onPillKeyDown}
                        >
                            {availablePills.map((pill, i) => {
                                const isActive = activeDetail === pill.kind;
                                // Roving tabindex: the active pill (or the first, when none
                                // active) is the single tab stop; arrows move between the rest.
                                const isTabStop = isActive || (activeDetail == null && i === 0);
                                return (
                                    <button
                                        key={pill.kind}
                                        role="tab"
                                        aria-selected={isActive}
                                        aria-expanded={isActive}
                                        tabIndex={isTabStop ? 0 : -1}
                                        onClick={() => setActiveDetail(prev => prev === pill.kind ? null : pill.kind)}
                                        className={[
                                            'relative inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12.5px] font-medium select-none cursor-default',
                                            'transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97]',
                                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/25',
                                            isActive ? 'text-text-primary' : 'text-white/35 hover:text-text-tertiary hover:bg-white/[0.04]',
                                        ].join(' ')}
                                    >
                                        {isActive && (
                                            <motion.span
                                                layoutId={`codingActivePill-${pillLayoutId}`}
                                                className="absolute inset-0 rounded-full bg-white/[0.08] ring-1 ring-inset ring-white/[0.06]"
                                                transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
                                            />
                                        )}
                                        <span className="relative z-10">{pill.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                        <div className="h-px flex-1 bg-white/[0.06]" />
                    </div>

                    {/* One container; height retargets continuously, content crossfades w/ blur.
                        Open 260ms / close 200ms — exits are quicker than entrances. */}
                    <motion.div
                        animate={{ height: activeSection ? panelHeight : 0 }}
                        transition={reduce
                            ? { duration: 0.12 }
                            : { duration: activeSection ? 0.26 : 0.2, ease: DRAWER_EASE }}
                        style={{ overflow: 'hidden' }}
                    >
                        <div ref={panelRef} className="pt-0.5">
                            <AnimatePresence initial={false} mode="popLayout">
                                {activeSection && (
                                    <motion.div
                                        key={activeDetail ?? 'none'}
                                        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4, filter: 'blur(3px)' }}
                                        animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' }}
                                        exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4, filter: 'blur(3px)' }}
                                        // Content settles just after the box starts opening so it
                                        // never flashes into a not-yet-open panel on switch.
                                        transition={{ duration: 0.18, ease: CROSSFADE_EASE, delay: reduce ? 0 : 0.04 }}
                                    >
                                        <div className="rounded-xl px-4 py-3.5 bg-white/[0.025] border border-white/[0.05] ring-1 ring-inset ring-white/[0.02]">
                                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                                                {cleanMarkdown(activeSection.body.trim())}
                                            </ReactMarkdown>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </motion.div>
    );
};

// One Q&A pair in the usage/history tab. Owns its first-view entrance (question
// enters from the right, answer settles just after) and a hover-revealed
// answer-action bar (copy full answer + timestamp). Entrance plays only the first
// time this interaction is seen this session — history is read-mostly, so
// re-viewing must be instant, never a re-cascade.
const UsageInteraction: React.FC<{
    interaction: { timestamp: number; question?: string; answer?: string };
    id: string;
    staggerDelay: number;
}> = ({ interaction, id, staggerDelay }) => {
    const reduce = useReducedMotion();
    const firstView = !seenInteractionIds.has(id);
    useEffect(() => { seenInteractionIds.add(id); }, [id]);

    const codingSections = interaction.answer ? parseCodingTemplate(interaction.answer) : null;
    const answerPlain = interaction.answer ? markdownToPlainText(splitGistLine(interaction.answer).body) : '';

    const enter = (offset: { x?: number; y?: number }, delay: number) => {
        // Repeat views are always instant. First view: full slide-in normally,
        // opacity-only under reduced-motion.
        if (!firstView) return { initial: false as const, animate: { opacity: 1 } };
        if (reduce) return { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.2 } };
        return { initial: { opacity: 0, ...offset }, animate: { opacity: 1, x: 0, y: 0 }, transition: { duration: 0.32, ease: CROSSFADE_EASE, delay } };
    };

    return (
        <div className="space-y-4">
            {/* User question — contained bubble, enters from the right, selectable */}
            {interaction.question && (
                <div className="group/q flex flex-col items-end">
                    {/* Fill, gradient, glow and foreground all come from .bubble-user (index.css)
                        rather than utilities — a gradient cannot live in the background-color that
                        bg-[var(...)] compiles to. It also replaces shadow-sm, whose plain black
                        shadow is invisible on the dark pane and muddies the tinted glow. Not
                        the accent tokens directly: --bubble-user-* points AT the accent but stays a
                        separate pair, so the bubble can be retuned without moving every button and
                        focus ring with it. White text on the dark-mode fill is 2.21:1 — an
                        accepted but severe AA shortfall, recorded in
                        PeriwinkleContrastGuard.test.mjs. */}
                    <motion.div {...enter({ x: 8 }, staggerDelay)} className="bubble-user px-5 py-2.5 rounded-2xl rounded-tr-sm max-w-[80%] text-[15px] leading-relaxed select-text">
                        {interaction.question}
                    </motion.div>
                    <span className="mt-1 pr-1 text-[11px] text-text-tertiary select-none cursor-default opacity-0 translate-y-1 group-hover/q:opacity-100 group-hover/q:translate-y-0 transition-all duration-[160ms] ease-out">
                        {formatTime(interaction.timestamp)}
                    </span>
                </div>
            )}

            {/* AI answer — open canvas (no bubble), avatar + body + hover action bar */}
            {interaction.answer && (
                <motion.div {...enter({ y: 8 }, staggerDelay + 0.08)} className="group/a flex items-start gap-4">
                    <div className="mt-1 w-6 h-6 rounded-full bg-bg-input flex items-center justify-center border border-border-subtle shrink-0 select-none opacity-40 group-hover/a:opacity-60 transition-opacity duration-[160ms]">
                        <img src={NativelyLogo} alt="" aria-hidden="true" className="w-4 h-4 object-contain force-black-icon" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="text-text-secondary text-[15px] leading-relaxed max-w-none select-text">
                            {codingSections
                                ? <CodingAnswerBlock sections={codingSections} firstView={firstView} />
                                : (() => {
                                    // Teleprompter gist: persisted answers can end with a
                                    // [[GIST]] line — render it as a summary chip, not text.
                                    const { body: gistBody, gist: gistLine } = splitGistLine(interaction.answer || '');
                                    return (
                                        <>
                                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                                                {cleanMarkdown(gistBody)}
                                            </ReactMarkdown>
                                            {gistLine && <div className="overlay-gist-chip">{gistLine}</div>}
                                        </>
                                    );
                                })()}
                        </div>
                        {/* Answer action bar — bottom-left, revealed on hover/focus-within */}
                        <div className="flex items-center gap-2 mt-2 opacity-0 translate-y-1 [@media(hover:hover)]:group-hover/a:opacity-100 [@media(hover:hover)]:group-hover/a:translate-y-0 group-focus-within/a:opacity-100 group-focus-within/a:translate-y-0 [@media(hover:none)]:opacity-100 transition-all duration-[160ms] ease-out select-none">
                            <AnswerCopyButton text={answerPlain} />
                            <span className="text-[11px] text-text-tertiary cursor-default">{formatTime(interaction.timestamp)}</span>
                        </div>
                    </div>
                </motion.div>
            )}
        </div>
    );
};

// Tone dropdown for the follow-up draft regeneration toolbar.
// Must be a named component (not an IIFE) so React can track its hooks stably.
const ToneDropdown: React.FC<{
    followUpTone: 'professional' | 'warm' | 'concise' | 'friendly';
    isRegeneratingFollowUp: boolean;
    onSelect: (tone: 'professional' | 'warm' | 'concise' | 'friendly') => void;
}> = ({ followUpTone, isRegeneratingFollowUp, onSelect }) => {
    const t = useT();
    const toneOptions: { value: 'professional' | 'warm' | 'concise' | 'friendly'; label: string }[] = [
        { value: 'professional', label: t('Professional') },
        { value: 'warm',         label: t('Warm')         },
        { value: 'concise',      label: t('Concise')      },
        { value: 'friendly',     label: t('Friendly')     },
    ];
    const [toneOpen, setToneOpen] = useState(false);
    const toneRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!toneOpen) return;
        const handler = (e: MouseEvent) => {
            if (toneRef.current && !toneRef.current.contains(e.target as Node)) setToneOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [toneOpen]);
    return (
        <div ref={toneRef} className="relative w-fit">
            <button
                type="button"
                disabled={isRegeneratingFollowUp}
                onClick={() => setToneOpen(v => !v)}
                className="h-7 inline-flex items-center gap-1.5 text-[11px] font-medium pl-2.5 pr-2 rounded-md text-text-secondary hover:text-text-primary hover:bg-white/[0.06] disabled:opacity-50 transition-colors"
            >
                <span>{toneOptions.find(o => o.value === followUpTone)?.label ?? t('Tone')}</span>
                <ChevronDown className={`w-3 h-3 text-text-tertiary transition-transform duration-150 ${toneOpen ? 'rotate-180' : ''}`} strokeWidth={2.5} />
            </button>
            <AnimatePresence>
                {toneOpen && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.96, y: -2 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: -2 }}
                        transition={{ duration: 0.1, ease: [0.23, 1, 0.32, 1] }}
                        className="absolute left-0 top-full mt-1 z-50 w-full rounded-lg border border-border-subtle bg-[#121214] overflow-hidden py-0.5 shadow-[0_4px_16px_rgba(0,0,0,0.5)]"
                    >
                        {toneOptions.map((opt) => (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() => { onSelect(opt.value); setToneOpen(false); }}
                                className={`w-full text-left flex items-center justify-between px-2.5 py-1.5 text-[11px] font-medium transition-colors ${followUpTone === opt.value ? 'text-text-primary bg-white/[0.06]' : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'}`}
                            >
                                <span>{opt.label}</span>
                                {followUpTone === opt.value && (
                                    <Check className="w-3 h-3 text-text-tertiary shrink-0" strokeWidth={2.5} />
                                )}
                            </button>
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

// The mode's note-section template is the source of truth for the notes layout
// (Summary on top, then the mode's sections). The imposed Decisions/Action-items/
// Open-questions/Risks blocks are kept in the schema (they power the follow-up draft and
// cross-meeting recall) but are NOT rendered as the primary layout. Set true to surface them.
const SHOW_STRUCTURED_BLOCKS = false;

// The labelled "Next steps" block is switched off (2026-08-24 product decision): it
// restated the action items the notes already carry, so every set of notes and every
// follow-up mail ended with the same list twice. The generator-side switches live in
// electron/services/meeting/MeetingSummaryReducer.ts (INCLUDE_NEXT_STEPS),
// FollowUpDraftGenerator.ts and post-call/PostCallWorkflow.ts — flip all four together.
// This renderer-side one also hides the section on meetings that were ALREADY generated
// and saved with it, which the generator-side switches cannot reach.
const SHOW_NEXT_STEPS = false;

// Matches the next-steps note section across built-in templates and user-authored
// sections: "Next steps", "Owners and next steps", "Asks / next steps",
// "What happens next", "Recommended next step". Mirrors isNextStepsSectionTitle()
// in MeetingSummaryReducer.ts (duplicated, not imported — this is renderer code).
const isNextStepsSectionTitle = (title?: string | null): boolean => {
    const t = (title || '').trim();
    if (!t) return false;
    return /next\s*steps?\b/i.test(t) || /^what\s+happens\s+next\b/i.test(t);
};

// Not every "quality warning" is a real problem. A note like "Removed 1 empty,
// duplicate, or interim transcript segment." is a benign cleanup log and should
// read as low-key info — not an alarming amber warning. Anything about speaker
// labels, coverage, or that asks the reader to verify is a genuine concern.
const isBenignQualityNote = (warning: string): boolean =>
    /removed|cleaned|interim|duplicate|empty/i.test(warning);

interface Evidence { speakerId?: string; speakerName?: string; speaker?: string; timestampMs?: number; timestamp?: number; quote?: string; segmentId?: string }
interface FollowUpDraftObj { type?: string; subject?: string; body: string; tone?: string }

interface Meeting {
    id: string;
    title: string;
    date: string;
    duration: string;
    summary: string;
    detailedSummary?: {
        overview?: string;
        actionItems: string[];
        keyPoints: string[];
        actionItemsTitle?: string;
        keyPointsTitle?: string;
        sections?: Array<{ title: string; bullets: string[] }>;
        sectionsV3?: Array<{ id: string; title: string; order?: number; bullets: Array<{ id?: string; text: string; confidence?: 'high' | 'medium' | 'low'; evidence?: Evidence[] }> }>;
        tldr?: string[];
        whatChanged?: string[];
        decisions?: Array<{ id?: string; text: string; owner?: string; timestampMs?: number; confidence: 'high' | 'medium' | 'low'; evidence?: Evidence[] }>;
        actionItemsV3?: Array<{ id?: string; text: string; owner?: string; deadline?: string; sourceTimestampMs?: number; explicitness: 'explicit' | 'inferred'; confidence: 'high' | 'medium' | 'low'; status?: 'open' | 'done' | 'deferred'; evidence?: Evidence[] }>;
        openQuestions?: Array<{ id?: string; text: string; owner?: string; status: 'open' | 'answered' | 'deferred'; confidence?: 'high' | 'medium' | 'low'; evidence?: Evidence[] }>;
        risks?: Array<{ id?: string; text: string; severity: 'low' | 'medium' | 'high'; confidence?: 'high' | 'medium' | 'low'; evidence?: Evidence[] }>;
        timeline?: Array<{ id?: string; timestampMs?: number; title: string; description?: string; type: string; evidence?: Evidence[] }>;
        sourceQuality?: { transcriptCoverage: number; speakerQuality: 'good' | 'mixed' | 'poor'; actionItemConfidence: 'high' | 'medium' | 'low'; warnings: string[] };
        mode?: { selectedModeId?: string; selectedModeName?: string; selectedTemplateType?: string; detectedModeId?: string; detectedModeName?: string; detectedConfidence?: number; summaryModeUsed?: string };
        generation?: { strategy?: string; chunkCount?: number; durationMs?: number; warnings?: string[] };
        speakerLabels?: Record<string, string>;
        crossMeeting?: { stillOpen?: string[] };
        recipes?: Record<string, string>;
        // Phase 7 — PostCallWorkflow enhancements (schema v2). Backend writes
        // these via buildPostCallEnhancements(); UI renders them when present.
        schemaVersion?: number;
        actionItemsStructured?: Array<{
            id: string;
            text: string;
            owner?: string;
            deadline?: string;
            sourceTimestamp?: number;
        }>;
        // V3 follow-up is a structured object; legacy rows stored a plain string.
        followUpDraft?: FollowUpDraftObj | string;
        coachingInsights?: Array<{
            id: string;
            type: string;
            title: string;
            detail: string;
            severity: 'info' | 'opportunity' | 'warning';
            evidence?: string;
        }>;
    };
    transcript?: Array<{
        speaker: string;
        text: string;
        timestamp: number;
    }>;
    usage?: Array<{
        type: 'assist' | 'followup' | 'chat' | 'followup_questions';
        timestamp: number;
        question?: string;
        answer?: string;
        items?: string[];
    }>;
    summaryStatus?: MeetingSummaryStatus;
}

// Mirrors SummaryStatus in electron/services/meeting/MeetingSummaryV3.ts. The
// renderer can't import from electron/, so this copy has to move with it; the
// allow-list below is validated against the same set in
// DatabaseManager.updateSummaryStatus.
type MeetingSummaryStatus =
    | 'queued'
    | 'chunking'
    | 'summarizing_chunks'
    | 'reducing'
    | 'validating'
    | 'completed'
    | 'failed';

// Gate the skeleton on the status ALLOW-LIST, never on "the summary is empty".
// Three separate states persist an empty detailedSummary and must not shimmer:
// a failed generation, the zero-eligible "Chat session" path (which is written
// straight to 'completed'), and pre-column rows whose status is undefined.
const SUMMARY_IN_PROGRESS: ReadonlySet<string> = new Set<MeetingSummaryStatus>([
    'queued',
    'chunking',
    'summarizing_chunks',
    'reducing',
    'validating',
]);

// One placeholder line. Height is the type's cap height, not its line box, and
// the radius is a full pill — it should read as a stroke of text waiting to be
// set, not as a wireframe block. The tone carries the note's own typographic
// hierarchy (see --mn-skel-* in index.css); the breath lives in `.mn-skel`.
const SkeletonLine: React.FC<{
    w: number | string;
    h?: number;
    tone?: 'strong' | 'base' | 'soft';
    className?: string;
}> = ({ w, h = 10, tone = 'base', className = '' }) => (
    <div
        aria-hidden="true"
        className={`mn-skel ${className}`}
        style={{ width: w, height: h, borderRadius: h / 2, background: `var(--mn-skel-${tone})` }}
    />
);

// Ragged line lengths — an even column of identical bars reads as a loading
// widget; prose has a short last line and sentences that don't end together.
const SKELETON_SECTIONS: ReadonlyArray<ReadonlyArray<string>> = [
    ['94%', '77%', '86%'],
    ['90%', '71%', '83%', '62%'],
    ['88%', '58%'],
];

// Document-order text cascade, paced by VISUAL LINE.
//
// It used to be paced per word, with headings costing a fixed block weight, and
// the whole thing normalised into a 620ms cap. Measured on a representative V3
// note (28 visual lines, 153 animated nodes) that produced a 4ms median step
// against a 160ms fade — a 2.5% stagger, which the eye cannot resolve. Every
// word of a bullet therefore arrived together and the note read as it was
// reported: block by block. The cap had silently crushed the cascade it was
// meant to bound.
//
// The unit is now the visual line, measured after layout (see the cadence
// effect), because that is the unit a reader's eye actually moves in. Words
// sharing a line share one delay; the sweep travels DOWN the note rather than
// along it, which is what iOS/macOS text materialisation reads like.
//
// STEP is the natural line-to-line beat. FLOOR is the reason the old pacing
// failed: normalising into a cap with no lower bound lets the step collapse to
// nothing on a long note. Below ~20ms consecutive lines are indistinguishable,
// so the cap yields to the floor and a very long note simply runs a little past
// it — most of that note is off-screen anyway on the fixed 732px panel.
//
// The step also sets the BAND — how many lines are mid-fade at any instant, which
// is FADE / STEP. That ratio, not the step alone, is what decides whether the
// reveal reads as a continuous sweep or as lines popping one after another:
//
//   step 40 / fade 220  →  ~5 lines   a hard edge stepping down the note
//   step 28 / fade 220  →  ~8 lines   a soft gradient
//   step 36 / fade 320  →  ~9 lines   slower, and softer still  ← current
//
// So slowing the reveal down is done by lengthening BOTH together. Raising the
// step alone would make it slower and MORE stepped, which is the opposite of
// seamless. A 22-line note now settles at ~1.4s (was ~1.1s).
const REVEAL_LINE_STEP_MS = 36;
const REVEAL_LINE_STEP_MIN_MS = 20;
const REVEAL_CASCADE_CAP_MS = 1400;

// The longer leg of the per-line animation. MUST stay in step with
// `mn-line-blur` in src/index.css: the teardown timer is derived from it,
// and a timer that fires early snaps the un-revealed tail to full opacity.
const REVEAL_LINE_FADE_MS = 320;

// Lines are ~20px apart at the tightest text size on this panel (measured on the
// follow-up <pre>), so 5px separates real lines while still absorbing the couple
// of pixels a differently-sized inline (<code>, <strong>) can sit off by. It is
// deliberately NOT large enough to need to absorb a bullet dot's `mt-2` offset —
// dots are excluded from measurement and inherit their bullet's first line.
const REVEAL_LINE_TOLERANCE_PX = 5;

// The cascade cannot start at t=0. This component mounts INSIDE Launcher's
// list → notes transition, whose content layer fades in over 340ms after a 150ms
// delay — so a cascade starting immediately runs, and finishes, behind a panel
// the reader cannot see yet. Measured: the first word animated at panel opacity
// 0.00, and every word of a 30-word note had already settled by the time the
// panel reached full opacity at 533ms. The reveal was real and completely
// invisible.
//
// 300ms is the panel's own delay plus roughly half its fade: the first words land
// as the surface becomes legible and the bulk of the wave plays against a fully
// opaque panel, without ever leaving a visible-but-empty note on screen. It also
// suits the other trigger — the placeholder's 260ms defocus finishes just as the
// words begin.
const REVEAL_START_DELAY_MS = 300;

/** Delay for a unit sitting on visual line `lineIndex`. */
const revealDelayMs = (lineIndex: number, stepMs: number) =>
    Math.round(REVEAL_START_DELAY_MS + lineIndex * stepMs);

/** Line-to-line beat for a note of `lineCount` visual lines. The cap bounds the
 *  envelope on ordinary notes; the floor stops it collapsing on long ones. */
const revealStepFor = (lineCount: number) => Math.round(Math.min(
    REVEAL_LINE_STEP_MS,
    Math.max(REVEAL_LINE_STEP_MIN_MS, REVEAL_CASCADE_CAP_MS / Math.max(1, lineCount - 1)),
));

/** What the cadence effect measures: which visual line each animated unit landed
 *  on, plus the beat that spacing implies. `null` until the first layout pass. */
type RevealCadence = { lineOf: number[]; step: number; lineCount: number };

const HANDOFF_EASE = [0.23, 1, 0.32, 1] as [number, number, number, number];

// The pipeline's real stages, in order. The note is never 0% done (work started
// the moment the meeting ended) and never 100% (it isn't saved yet), so the rail
// is scaled across n+1 slots and can only ever move forward.
const SUMMARY_STAGES: ReadonlyArray<MeetingSummaryStatus> = [
    'queued', 'chunking', 'summarizing_chunks', 'reducing', 'validating',
];

/**
 * The Summary tab while the note is still being written. Deliberately shaped
 * like the finished note rather than like a spinner: same overview block, same
 * "Summary" heading, same bullet rhythm, same follow-up card, same line boxes.
 *
 * One intentional divergence from the Company Intel skeleton it's modelled on:
 * that panel prints its section headers as real text because its sections are
 * fixed. A meeting's come from the mode template in `sectionsV3` and are unknown
 * until generation finishes, so every header below "Summary" is a bar rather
 * than a guessed title.
 */
const MeetingNotesSkeleton: React.FC<{
    status: MeetingSummaryStatus | undefined;
    isLight: boolean;
    still: boolean;
    t: (text: string) => string;
}> = ({ status, isLight, still, t }) => {
    const statusLabel =
        status === 'chunking' ? t('Reading the transcript')
        : status === 'summarizing_chunks' ? t('Summarizing')
        : status === 'reducing' ? t('Pulling it together')
        : status === 'validating' ? t('Checking it against the transcript')
        : t('Writing your notes');

    const stage = SUMMARY_STAGES.indexOf(status as MeetingSummaryStatus);
    const progress = ((stage < 0 ? 0 : stage) + 1) / (SUMMARY_STAGES.length + 1);

    // Sections lift in on a short ease-out stagger, the same beat the real
    // note's cards use. Reduced motion keeps the fade and drops the travel.
    const enter = (i: number) => (still
        ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.2 } }
        : {
            initial: { opacity: 0, y: 8 },
            animate: { opacity: 1, y: 0 },
            transition: { duration: 0.28, ease: [0.23, 1, 0.32, 1] as [number, number, number, number], delay: 0.05 * i },
        });

    // h-[23px] is the real bullet's line box (text-sm x leading-relaxed), so the
    // list keeps its exact height when the sentences arrive — the rows swap in
    // place instead of the page growing under the reader.
    const bullet = (dot: { className?: string; style?: React.CSSProperties }, w: string, key: React.Key) => (
        <li key={key} className="flex items-start gap-3">
            <div className={`mn-skel shrink-0 mt-2 w-1.5 h-1.5 rounded-full ${dot.className ?? ''}`} style={dot.style} />
            <div className="h-[23px] flex items-center min-w-0 flex-1">
                <SkeletonLine w={w} />
            </div>
        </li>
    );

    return (
        // No aria-busy here: it tells assistive tech to hold announcements until
        // it flips to false, and this whole region unmounts the moment the notes
        // land — it would never flip, so the progress label would never be read.
        <div role="status" aria-live="polite" data-generating="true">
            <span className="sr-only">{statusLabel}</span>

            {/* Overview prose + its rule. The real note opens with this block, so
                leaving it out floats everything below it ~240px up the page and
                drops it again the moment the notes land. */}
            <motion.div {...enter(0)} className="pb-5 border-b border-border-subtle" aria-hidden="true">
                {['97%', '99%', '93%', '46%'].map((w, i) => (
                    <div key={i} className="h-[23px] flex items-center">
                        <SkeletonLine w={w} />
                    </div>
                ))}
            </motion.div>

            {/* Sits where the real note's toolbar sits, so nothing jumps when the
                toolbar replaces it. The rail is the honest part: the pipeline
                reports five real stages, so show which one you're on instead of
                a dot that pulses and says nothing. */}
            <motion.div {...enter(1)} className="mt-6 mb-6 flex items-center gap-2.5" aria-hidden="true">
                <div className="h-[3px] w-11 rounded-full overflow-hidden shrink-0" style={{ background: 'var(--mn-skel-base)' }}>
                    <motion.div
                        className="h-full w-full rounded-full bg-accent-primary"
                        style={{ transformOrigin: 'left center' }}
                        initial={{ scaleX: still ? progress : 0 }}
                        animate={{ scaleX: progress }}
                        // Apple's move/reposition spring: critically damped,
                        // response 0.4. No bounce — nothing was flicked, and a
                        // progress rail that overshoots is lying twice.
                        transition={still ? { duration: 0 } : { type: 'spring', bounce: 0, duration: 0.4 }}
                    />
                </div>
                <AnimatePresence initial={false} mode="wait">
                    <motion.span
                        key={statusLabel}
                        initial={still ? { opacity: 0 } : { opacity: 0, y: 3 }}
                        animate={still ? { opacity: 1 } : { opacity: 1, y: 0 }}
                        exit={still ? { opacity: 0 } : { opacity: 0, y: -3 }}
                        transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
                        className="text-[11px] font-medium text-text-tertiary"
                    >
                        {statusLabel}
                    </motion.span>
                </AnimatePresence>
            </motion.div>

            {/* "Summary" is the one heading the note always has, so it's real text. */}
            <motion.section {...enter(2)} className="mb-8">
                <h2 className="text-lg font-semibold text-text-primary mb-4">{t('Summary')}</h2>
                <ul className="space-y-3">
                    {SKELETON_SECTIONS[0].map((w, i) => bullet({ className: 'bg-blue-400/70' }, w, i))}
                </ul>
            </motion.section>

            {SKELETON_SECTIONS.slice(1).map((widths, si) => (
                <motion.section key={si} {...enter(3 + si)} className="mb-8">
                    {/* h-7 matches the text-lg heading's line box, so the real title
                        lands without shifting the bullets under it. */}
                    <div className="h-7 flex items-center mb-4">
                        <SkeletonLine w={si === 0 ? 168 : 132} h={13} tone="strong" />
                    </div>
                    <ul className="space-y-3">
                        {widths.map((w, i) => bullet({ style: { background: 'var(--text-secondary)', opacity: 0.5 } }, w, i))}
                    </ul>
                </motion.section>
            ))}

            {/* Follow-up draft — header bar plus the bordered prose card. */}
            <motion.section {...enter(5)} className="mb-8">
                <div className="h-7 flex items-center mb-3">
                    <SkeletonLine w={118} h={13} tone="strong" />
                </div>
                <div className={`p-3 rounded-[10px] border ${isLight ? 'border-black/[0.06] bg-black/[0.015]' : 'border-white/10 bg-white/[0.02]'}`}>
                    {/* h-5 is the draft's own line box (text-[12.5px] x leading-relaxed). */}
                    {['86%', '93%', '69%'].map((w, i) => (
                        <div key={i} className="h-5 flex items-center">
                            <SkeletonLine w={w} h={9} tone="soft" />
                        </div>
                    ))}
                </div>
            </motion.section>
        </div>
    );
};

interface MeetingDetailsProps {
    meeting: Meeting;
    onBack: () => void;
    onOpenSettings: () => void;
}

const MeetingDetails: React.FC<MeetingDetailsProps> = ({ meeting: initialMeeting }) => {
    const t = useT();
    const isLight = useResolvedTheme() === 'light';
    // We need local state for the meeting object to reflect optimistic updates
    const [meeting, setMeeting] = useState<Meeting>(initialMeeting);
    const [activeTab, setActiveTab] = useState<'summary' | 'transcript' | 'usage'>('summary');
    const [query, setQuery] = useState('');
    const [isCopied, setIsCopied] = useState(false);
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [submittedQuery, setSubmittedQuery] = useState('');

    // Stable client-side keys for the action-item and key-point lists. The
    // persisted shape is string[], so React keyed the rows by index, but the
    // onEnter handler splices a new empty row in mid-list — shifting indices
    // and causing React to reuse the wrong EditableTextBlock instance for the
    // shifted rows (focus, draft text, and selection jump to the wrong row).
    // Same bug class as issue #253; keep the ids array in lockstep with the
    // items array via state updates rather than a ref so React re-renders
    // see the post-splice ordering atomically.
    const [actionItemKeys, setActionItemKeys] = useState<string[]>(() =>
        (initialMeeting.detailedSummary?.actionItems ?? []).map(() => genMessageId()),
    );
    const [keyPointKeys, setKeyPointKeys] = useState<string[]>(() =>
        (initialMeeting.detailedSummary?.keyPoints ?? []).map(() => genMessageId()),
    );

    const isV3Summary = meeting.detailedSummary?.schemaVersion === 3;
    const v3Actions = meeting.detailedSummary?.actionItemsV3 || [];
    const v3Decisions = meeting.detailedSummary?.decisions || [];
    const v3Questions = meeting.detailedSummary?.openQuestions || [];
    const v3Risks = meeting.detailedSummary?.risks || [];
    const v3Tldr = meeting.detailedSummary?.tldr || [];
    const v3WhatChanged = meeting.detailedSummary?.whatChanged || [];
    const v3Mode = meeting.detailedSummary?.mode;
    const v3SummaryStatus = meeting.summaryStatus;

    // Post-meeting generation state. `isSummaryGenerating` drives the skeleton;
    // `hasRenderableNotes` keeps the failure card off a meeting whose V3 pass
    // failed but whose V2 fallback still produced something worth showing.
    const isSummaryGenerating = SUMMARY_IN_PROGRESS.has(v3SummaryStatus ?? '');
    const hasRenderableNotes = Boolean(
        isV3Summary
        || meeting.detailedSummary?.overview?.trim()
        || (meeting.detailedSummary?.actionItems?.length ?? 0) > 0
        || (meeting.detailedSummary?.keyPoints?.length ?? 0) > 0,
    );
    const showSummaryFailure = v3SummaryStatus === 'failed' && !hasRenderableNotes;


    // Normalize follow-up draft (object in V3, legacy string).
    const rawFollowUp = meeting.detailedSummary?.followUpDraft;
    const followUpBody = typeof rawFollowUp === 'string' ? rawFollowUp : (rawFollowUp?.body || '');
    const followUpSubject = typeof rawFollowUp === 'string' ? undefined : rawFollowUp?.subject;
    const followUpDraftTone = (typeof rawFollowUp === 'string' ? undefined : rawFollowUp?.tone) as 'professional' | 'warm' | 'concise' | 'friendly' | undefined;

    // Regenerate / evidence-jump / speaker-rename UI state.
    const [isRegenerating, setIsRegenerating] = useState(false);
    const [isRegeneratingFollowUp, setIsRegeneratingFollowUp] = useState(false);
    // Selected follow-up tone, shown in the selector. Seeded from the saved draft's tone.
    const [followUpTone, setFollowUpTone] = useState<'professional' | 'warm' | 'concise' | 'friendly'>(followUpDraftTone || 'professional');
    // Local "Copied!" confirmation for the follow-up copy button.
    const [followUpCopied, setFollowUpCopied] = useState(false);
    const [showEvidence, setShowEvidence] = useState(false);
    const [pendingScrollTs, setPendingScrollTs] = useState<number | null>(null);
    const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
    const [speakerDraft, setSpeakerDraft] = useState('');
    // Armed for exactly one materialisation: on mount when the notes are already
    // there, and again the moment generation finishes. Dropped when the cascade
    // ends, after which React renders plain strings — so no span survives into
    // selection, copy, or a later re-render.
    const [revealing, setRevealing] = useState(false);
    // Measured in a layout pass, not derivable at render time — which line each
    // animated unit landed on once the text had actually wrapped. `null` means
    // "not measured yet": the first pass renders the units held invisible and
    // this effect supplies the delays before the browser ever paints them.
    const [cadence, setCadence] = useState<RevealCadence | null>(null);
    const notesRef = useRef<HTMLDivElement | null>(null);
    const prefersReducedMotion = useReducedMotion();

    useEffect(() => {
        if (isSummaryGenerating || !hasRenderableNotes) { setRevealing(false); setCadence(null); return; }
        setRevealing(true);
        setCadence(null);
    }, [isSummaryGenerating, hasRenderableNotes]);

    // The placeholder defocuses out on this Framer exit, on a layer that unmounts
    // straight after — so it can leave no filter behind — while the note itself
    // materialises word by word underneath (see revealWords / index.css). The
    // words carry the focus work: an additional 6px blur on the whole layer would
    // nest under each word's own 2px blur and compound both.
    //
    // AnimatePresence runs in popLayout mode so the outgoing layer leaves flow on
    // the same frame the exit starts — animating `position` by hand left one frame
    // with BOTH layers in flow, and that momentary reflow was enough to send the
    // tab row's shared-layout indicator flying across the header.
    const handoffExit = prefersReducedMotion
        ? { opacity: 0, transition: { duration: 0.16 } }
        : { opacity: 0, filter: 'blur(6px)', transition: { duration: 0.26, ease: HANDOFF_EASE } };
    const revealOn = revealing && !prefersReducedMotion;

    // ── Cadence measurement ────────────────────────────────────────────────
    // Runs BEFORE paint, so the two passes are invisible: pass 1 renders every
    // animated unit carrying `data-rw` and held at opacity 0 (`.mn-line-hold`),
    // this reads where each one actually landed, and the setState re-render
    // supplies the delays. React owns the spans throughout — nothing is written
    // into the DOM behind its back, so an unrelated re-render mid-cascade cannot
    // strip the delays off again.
    //
    // Measurement is scoped to the NOTES FLOW, and the title is placed ahead of it
    // by construction rather than by geometry. That is not a shortcut — measuring
    // across the two boxes is unsound, in both available coordinate systems:
    //
    //   • Viewport rects: the title lives in a `position: sticky` header. The notes
    //     also land under a reader already watching the placeholder — the other
    //     trigger REVEAL_START_DELAY_MS was tuned for — and by then <main> may be
    //     scrolled. A stuck title does not scroll away, so its rect top lands BELOW
    //     content that precedes it in document order, the monotonic grouping never
    //     advances, and the whole prefix collapses onto one line. Measured at
    //     scrollTop 260: title + both overview lines all arrived together.
    //   • offsetTop: no better. Chrome reports a sticky element's STUCK offset, so
    //     the title measured 352 against the overview's 232 — same collapse, and
    //     the chain walk needed to compare depths buys nothing.
    //
    // Within the notes flow nothing is sticky, so a plain rect delta is exact, and
    // it is a DIFFERENCE — immune to the translate/scale Launcher's page transition
    // may still be applying while this runs. The title is always the line above
    // that flow, which needs no measuring at all.
    useLayoutEffect(() => {
        if (!revealOn) { setCadence(null); return; }
        if (cadence) return;
        const root = notesRef.current;
        if (!root) return;
        const units = root.querySelectorAll<HTMLElement>('[data-rw]');
        if (!units.length) { setCadence({ lineOf: [], step: REVEAL_LINE_STEP_MS, lineCount: 1 }); return; }

        const originTop = root.getBoundingClientRect().top;
        const lineOf: number[] = [];
        // Line 0 is the title, which sits above this flow and is not measured, so
        // the first measured line is line 1.
        let lineIndex = 0;
        let lineTop = -Infinity;
        // Document order is also visual order here, so a top that has moved further
        // down than the tolerance starts a new line and nothing needs sorting.
        for (const unit of units) {
            const top = unit.getBoundingClientRect().top - originTop;
            if (top > lineTop + REVEAL_LINE_TOLERANCE_PX) { lineIndex += 1; lineTop = top; }
            lineOf[Number(unit.dataset.rw)] = lineIndex;
        }
        const lineCount = lineIndex + 1;
        setCadence({ lineOf, step: revealStepFor(lineCount), lineCount });
    }, [revealOn, cadence]);

    // Teardown, derived from the cadence that was actually assigned rather than
    // from a cap — the floor lets a long note run past CAP, and a timer that
    // fires early would drop `revealing`, re-render plain strings, and snap the
    // un-revealed tail to full opacity mid-sweep.
    useEffect(() => {
        if (!revealing || !cadence) return;
        const settles = revealDelayMs(Math.max(0, cadence.lineCount - 1), cadence.step) + REVEAL_LINE_FADE_MS;
        const id = setTimeout(() => setRevealing(false), settles + 80);
        return () => clearTimeout(id);
    }, [revealing, cadence]);

    // The cascade allocator. A plain `let` in the render body: recomputed from
    // scratch on every render, so it needs no ref and is StrictMode-safe. The JSX
    // below is built in document order, so the counter walks the note the way a
    // reader does, and the index it hands out is the key the measured `lineOf`
    // table is read back with.
    let revealSlot = 0;

    /** Props for one animated unit at reveal index `idx`: invisible while the
     *  cadence is being measured, then animating on its measured line. */
    const revealAt = (idx: number): { className: string; style?: React.CSSProperties; 'data-rw'?: number } => {
        if (!cadence) return { className: 'mn-line-hold', 'data-rw': idx };
        return {
            className: 'mn-line-cascade',
            style: { animationDelay: `${revealDelayMs(cadence.lineOf[idx] ?? 0, cadence.step)}ms` },
            'data-rw': idx,
        };
    };

    /** Body text, materialising line by line. The two passes render DIFFERENT
     *  shapes, on purpose:
     *
     *  Pass 1 gives every word its own span, because that is the only way to see
     *  where the text wrapped — the measurement reads one box per word.
     *
     *  Pass 2 emits ONE span per visual line. Once the grouping is known the
     *  per-word spans have no job left, and collapsing them is what makes the
     *  cascade cheap: a representative note goes from 188 animated nodes and 376
     *  running animations to 29 and 58. Measured: the cascade's own frame cost at
     *  the start of the sweep roughly halves. It also looks better — the blur now
     *  covers a whole line as one surface instead of leaving a per-word island at
     *  every space.
     *
     *  Line breaks are preserved because the concatenated text is byte-identical
     *  and inline elements do not affect line breaking; the whitespace a break
     *  falls on is kept with the line before it. */
    const revealWords = (text: string): React.ReactNode => {
        if (!revealOn) return text;
        const runs = splitIntoWordRuns(text);
        if (!cadence) {
            return runs.map((run, i) => (run.isWord
                ? <span key={i} {...revealAt(revealSlot++)}>{run.text}</span>
                : <React.Fragment key={i}>{run.text}</React.Fragment>));
        }
        const out: React.ReactNode[] = [];
        let buf = '';
        let line: number | null = null;
        const flush = () => {
            if (!buf) return;
            out.push(
                <span
                    key={out.length}
                    className="mn-line-cascade"
                    style={{ animationDelay: `${revealDelayMs(line ?? 0, cadence.step)}ms` }}
                >{buf}</span>,
            );
            buf = '';
        };
        for (const run of runs) {
            if (run.isWord) {
                const at = cadence.lineOf[revealSlot++] ?? 0;
                if (line !== null && at !== line) flush();
                line = at;
            }
            buf += run.text;
        }
        flush();
        return out;
    };

    /** The title. It leads the cascade on line 0 by construction: it lives in the
     *  sticky header, a box that cannot be soundly measured against the notes flow
     *  (see the cadence effect), and it is unconditionally the line above it. Takes
     *  no reveal index, because it is never measured. */
    const revealLead = (): { cls: string; style?: React.CSSProperties } => {
        if (!revealOn) return { cls: '' };
        if (!cadence) return { cls: ' mn-line-hold' };
        return { cls: ' mn-line-cascade', style: { animationDelay: `${revealDelayMs(0, cadence.step)}ms` } };
    };

    /** A unit that is measured as a whole — a heading whose words must not be
     *  split. Occupies one line of the cascade. */
    const revealBlock = (): { cls: string; style?: React.CSSProperties; 'data-rw'?: number } => {
        if (!revealOn) return { cls: '' };
        const { className, style, ...rest } = revealAt(revealSlot++);
        return { cls: ` ${className}`, style, ...rest };
    };

    /** A unit that must NOT be measured, because its own box does not sit on the
     *  line it belongs to — the bullet dots carry `mt-2`, which would otherwise
     *  either split a line or force the grouping tolerance wide enough to merge
     *  two real ones. `idx` is the reveal index of the first word of the bullet
     *  text the dot introduces, so the dot lands exactly with it. */
    const revealWith = (idx: number): { cls: string; style?: React.CSSProperties } => {
        if (!revealOn) return { cls: '' };
        if (!cadence) return { cls: ' mn-line-hold' };
        return {
            cls: ' mn-line-cascade',
            style: { animationDelay: `${revealDelayMs(cadence.lineOf[idx] ?? 0, cadence.step)}ms` },
        };
    };

    /** An opacity-only floor under a subtree whose text is wrapped word by word.
     *  It is MEASURED like any other unit — its own box top is the top of its first
     *  line of text, so it clusters onto that line and can only ever hide text that
     *  would otherwise have popped in at t=0.
     *
     *  It deliberately does NOT read `lineOf[revealSlot]`. ReactMarkdown renders in
     *  a child pass, so the word spans inside this container are allocated their
     *  indices long AFTER this function runs — the slot counter here points at an
     *  unrelated later unit, which would hold the overview hidden past its own
     *  words' delays. Measuring the container sidesteps the ordering entirely. */
    const revealGuard = (): { cls: string; style?: React.CSSProperties; 'data-rw'?: number } => {
        if (!revealOn) return { cls: '' };
        const { className, style, ...rest } = revealAt(revealSlot++);
        return { cls: className === 'mn-line-hold' ? ' mn-line-hold' : ' mn-line-guard', style, ...rest };
    };

    /** ReactMarkdown renders the overview, so its text never passed through
     *  `revealWords` and the whole paragraph — the largest slab of prose in the
     *  note — arrived as one block. This maps the string children of every
     *  text-bearing element through the cascade. Elements are visited in render
     *  order, which is document order, so the slot counter stays coherent. */
    const revealMarkdownChildren = (children: React.ReactNode): React.ReactNode => {
        if (!revealOn) return children;
        return React.Children.map(children, (child) =>
            (typeof child === 'string' ? revealWords(child) : child));
    };

    // Keep the view live while the note is still being written. The meeting row
    // changes underneath us — the status advances queued → … → completed and the
    // notes land in one write — but this component seeds from a prop and never
    // re-reads it, and Launcher's `meetings-updated` handler refreshes only the
    // list, not the open meeting. Without this the placeholder would never resolve.
    //
    // Both signals are needed. `meetings-updated` now fires on completion AND on
    // hard failure, which makes both swaps immediate — but the stage advances
    // (queued → chunking → reducing → …) are written straight to SQLite and never
    // broadcast, so on the listener alone the progress rail would sit frozen for
    // the whole generation. The poll reads those, and backstops any notification
    // that never arrives. Both are torn down the moment generation ends.
    useEffect(() => {
        if (!isSummaryGenerating) return;
        let cancelled = false;
        const refresh = async () => {
            try {
                const fresh = await window.electronAPI?.getMeetingDetails?.(meeting.id) as Meeting | undefined;
                if (cancelled || !fresh) return;
                // Re-seed the row-key arrays alongside the notes: they were built
                // from the empty placeholder, so the legacy lists would otherwise
                // render with undefined keys the first time real items arrive.
                if (!SUMMARY_IN_PROGRESS.has(fresh.summaryStatus ?? '')) {
                    setActionItemKeys((fresh.detailedSummary?.actionItems ?? []).map(() => genMessageId()));
                    setKeyPointKeys((fresh.detailedSummary?.keyPoints ?? []).map(() => genMessageId()));
                }
                setMeeting(fresh);
            } catch { /* swallow — the next tick retries */ }
        };
        // Back off rather than stop. A generation still going after ten minutes is
        // almost certainly hung — recoverUnprocessedMeetings only retries such a
        // row at the NEXT app start — but "almost certainly" is not certain, and a
        // poll that simply retired would leave the placeholder breathing at a view
        // that has quietly stopped listening. Widening to 30s costs nothing (a
        // local sqlite read) and keeps a late completion able to land.
        const startedMs = Date.now();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const schedule = () => {
            const delay = Date.now() - startedMs < 600_000 ? 2_000 : 30_000;
            timer = setTimeout(async () => {
                await refresh();
                if (!cancelled) schedule();
            }, delay);
        };
        schedule();
        const off = window.electronAPI?.onMeetingsUpdated?.(() => { void refresh(); });
        return () => { cancelled = true; if (timer) clearTimeout(timer); off?.(); };
    }, [isSummaryGenerating, meeting.id]);

    const copyRecipe = (text: string) => {
        navigator.clipboard?.writeText(text || '').catch(() => { /* swallow */ });
    };

    const reloadMeeting = async () => {
        try {
            const fresh = await window.electronAPI?.getMeetingDetails?.(meeting.id);
            if (fresh) {
                setMeeting(fresh as Meeting);
                // Keep the tone selector in sync with the regenerated draft.
                const fu = (fresh as Meeting).detailedSummary?.followUpDraft;
                const tone = typeof fu === 'string' ? undefined : fu?.tone;
                if (tone === 'professional' || tone === 'warm' || tone === 'concise' || tone === 'friendly') setFollowUpTone(tone);
            }
        } catch { /* swallow */ }
    };

    const handleRegenerate = async (templateType?: string) => {
        if (isRegenerating || !window.electronAPI?.regenerateMeetingSummary) return;
        setIsRegenerating(true);
        try {
            const res = await window.electronAPI.regenerateMeetingSummary(meeting.id, templateType ? { templateType } : undefined);
            if (res?.success) await reloadMeeting();
        } catch { /* swallow */ } finally { setIsRegenerating(false); }
    };

    const handleRegenerateFollowUp = async (tone?: 'professional' | 'warm' | 'concise' | 'friendly') => {
        if (isRegeneratingFollowUp || !window.electronAPI?.regenerateMeetingFollowUp) return;
        setIsRegeneratingFollowUp(true);
        try {
            const res = await window.electronAPI.regenerateMeetingFollowUp(meeting.id, tone);
            if (res?.success) await reloadMeeting();
        } catch { /* swallow */ } finally { setIsRegeneratingFollowUp(false); }
    };

    const handleSaveSpeakerLabel = async (speakerId: string, name: string) => {
        const existing = meeting.detailedSummary?.speakerLabels || {};
        const next = { ...existing, [speakerId]: name.trim() };
        if (!name.trim()) delete next[speakerId];
        setMeeting(prev => ({ ...prev, detailedSummary: { ...(prev.detailedSummary as any), speakerLabels: next } }));
        setEditingSpeaker(null);
        try { await window.electronAPI?.updateMeetingSpeakerLabels?.(meeting.id, next); } catch { /* swallow */ }
    };

    // Resolve a transcript segment's display name using saved speaker labels.
    const resolveSpeakerName = (rawSpeaker: string): string => {
        const labels = meeting.detailedSummary?.speakerLabels || {};
        const lower = (rawSpeaker || '').toLowerCase();
        const id = /^(user|me)$/.test(lower) ? 'me' : (/^(interviewer|them|other|system|assistant)$/.test(lower) ? 'speaker_1' : lower.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown');
        if (labels[id]) return labels[id];
        if (id === 'me') return 'Me';
        if (id === 'speaker_1') return 'Speaker 1';
        return rawSpeaker || 'Speaker';
    };

    const evidenceTimestamp = (evidence?: Evidence[]): number | undefined => {
        const first = evidence?.[0];
        if (!first) return undefined;
        return typeof first.timestampMs === 'number' ? first.timestampMs : (typeof first.timestamp === 'number' ? first.timestamp : undefined);
    };

    // Transcript timestamps are absolute epoch ms (Date.now()); the earliest segment is the
    // meeting start. Use it to render evidence times as a relative m:ss offset into the meeting.
    const meetingStartMs = React.useMemo(() => {
        const ts = (meeting.transcript || []).map(t => t.timestamp).filter(t => typeof t === 'number' && t > 0);
        return ts.length ? Math.min(...ts) : 0;
    }, [meeting.transcript]);

    // Render a (possibly absolute-epoch) timestamp as a relative m:ss into the meeting.
    const formatEvidenceTime = (ts?: number): string => {
        if (typeof ts !== 'number') return '';
        // Epoch-ms values are huge; subtract meeting start. Already-relative small values pass through.
        const rel = ts > 1e11 && meetingStartMs > 0 ? ts - meetingStartMs : ts;
        return formatDuration(Math.max(0, rel));
    };

    const evidenceLabel = (evidence?: Evidence[]) => {
        const first = evidence?.[0];
        if (!first) return '';
        const time = formatEvidenceTime(evidenceTimestamp(evidence));
        const who = first.speakerName || first.speaker || '';
        const quote = first.quote ? `“${first.quote}”` : '';
        return [time, who, quote].filter(Boolean).join(' · ');
    };

    // Jump to the transcript tab and scroll to the segment nearest an evidence timestamp.
    const jumpToEvidence = (evidence?: Evidence[]) => {
        const ts = evidenceTimestamp(evidence);
        if (typeof ts !== 'number') return;
        setActiveTab('transcript');
        setPendingScrollTs(ts);
    };

    const handleSubmitQuestion = () => {
        if (query.trim()) {
            setSubmittedQuery(query);
            if (!isChatOpen) {
                setIsChatOpen(true);
            }
            setQuery('');
        }
    };

    const handleInputKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && query.trim()) {
            e.preventDefault();
            handleSubmitQuestion();
        }
    };

    const handleCopy = async () => {
        let textToCopy = '';

        if (activeTab === 'summary' && meeting.detailedSummary) {
            if (meeting.detailedSummary.schemaVersion === 3) {
                textToCopy = `
Meeting: ${meeting.title}
Date: ${new Date(meeting.date).toLocaleDateString()}

TLDR:
${meeting.detailedSummary.tldr?.map(item => `- ${item}`).join('\n') || 'None'}

WHAT CHANGED:
${meeting.detailedSummary.whatChanged?.map(item => `- ${item}`).join('\n') || 'None'}

DECISIONS:
${meeting.detailedSummary.decisions?.map(item => `- ${item.text}`).join('\n') || 'None'}

ACTION ITEMS:
${meeting.detailedSummary.actionItemsV3?.map(item => `- ${item.owner ? `${item.owner}: ` : ''}${item.text}${item.deadline ? ` by ${item.deadline}` : ''}${item.explicitness === 'inferred' ? ' (inferred)' : ''}`).join('\n') || 'None'}

OPEN QUESTIONS:
${meeting.detailedSummary.openQuestions?.map(item => `- ${item.text}`).join('\n') || 'None'}

RISKS / BLOCKERS:
${meeting.detailedSummary.risks?.map(item => `- [${item.severity}] ${item.text}`).join('\n') || 'None'}

OVERVIEW:
${meeting.detailedSummary.overview || ''}
${followUpBody.trim() ? `\nFOLLOW-UP DRAFT:\n${followUpSubject ? `Subject: ${followUpSubject}\n` : ''}${followUpBody}` : ''}
                `.trim();
            } else {
                textToCopy = `
Meeting: ${meeting.title}
Date: ${new Date(meeting.date).toLocaleDateString()}

OVERVIEW:
${meeting.detailedSummary.overview || ''}

ACTION ITEMS:
${meeting.detailedSummary.actionItems?.map(item => `- ${item}`).join('\n') || 'None'}

KEY POINTS:
${meeting.detailedSummary.keyPoints?.map(item => `- ${item}`).join('\n') || 'None'}
                `.trim();
            }
        } else if (activeTab === 'transcript' && meeting.transcript) {
            textToCopy = meeting.transcript.map(t => `[${formatTime(t.timestamp)}] ${resolveSpeakerName(t.speaker)}: ${t.text}`).join('\n');
        } else if (activeTab === 'usage' && meeting.usage) {
            textToCopy = meeting.usage.map(u => `Q: ${u.question || ''}\nA: ${u.answer || ''}`).join('\n\n');
        }

        if (!textToCopy) return;

        try {
            await navigator.clipboard.writeText(textToCopy);
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy content:', err);
        }
    };

    // UPDATE HANDLERS
    const handleTitleSave = async (newTitle: string) => {
        setMeeting(prev => ({ ...prev, title: newTitle }));
        if (window.electronAPI?.updateMeetingTitle) {
            await window.electronAPI.updateMeetingTitle(meeting.id, newTitle);
        }
    };

    const handleOverviewSave = async (newOverview: string) => {
        setMeeting(prev => ({
            ...prev,
            detailedSummary: {
                ...prev.detailedSummary!,
                overview: newOverview
            }
        }));
        if (window.electronAPI?.updateMeetingSummary) {
            await window.electronAPI.updateMeetingSummary(meeting.id, { overview: newOverview });
        }
    };

    const handleActionItemSave = async (index: number, newVal: string) => {
        const newItems = [...(meeting.detailedSummary?.actionItems || [])];
        if (!newVal.trim()) {
            // Optional: Remove empty items? For now just keep empty or update
        }
        newItems[index] = newVal;

        setMeeting(prev => ({
            ...prev,
            detailedSummary: {
                ...prev.detailedSummary!,
                actionItems: newItems
            }
        }));

        if (window.electronAPI?.updateMeetingSummary) {
            await window.electronAPI.updateMeetingSummary(meeting.id, { actionItems: newItems });
        }
    };

    const handleKeyPointSave = async (index: number, newVal: string) => {
        const newItems = [...(meeting.detailedSummary?.keyPoints || [])];
        newItems[index] = newVal;

        setMeeting(prev => ({
            ...prev,
            detailedSummary: {
                ...prev.detailedSummary!,
                keyPoints: newItems
            }
        }));

        if (window.electronAPI?.updateMeetingSummary) {
            await window.electronAPI.updateMeetingSummary(meeting.id, { keyPoints: newItems });
        }
    };


    // Dark theme sits on the elevated grey (#151515) rather than the near-black
    // --bg-secondary, matching the Launcher hero section. Light theme is unchanged.
    return (
        <div className={`h-full w-full flex flex-col ${isLight ? 'bg-bg-secondary' : 'bg-bg-elevated'} text-text-secondary font-sans overflow-hidden`}>
            {/* Main Content */}
            <main className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                {/* Pinned header — date, title and the tab row stay put; only tab content scrolls.
                    Kept inside <main> (rather than hoisted above it) so it shares the scroll box's
                    content width: a two-container split would offset this column from the one below
                    by the scrollbar width on platforms with classic (non-overlay) scrollbars. */}
                <div className={`sticky top-0 z-20 ${isLight ? 'bg-bg-secondary' : 'bg-bg-elevated'}`}>
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1, duration: 0.3 }}
                        className="max-w-4xl mx-auto px-8 pt-8 pb-8"
                    >
                    {/* Meta Info & Actions Row */}
                    <div className="flex items-start justify-between mb-6">
                        <div className="w-full pr-4">
                            {/* Date formatting could be improved to use meeting.date if it's an ISO string */}
                            <div className="text-xs text-text-tertiary font-medium mb-1">
                                {new Date(meeting.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                            </div>

                            {/* Editable Title — a bar while the note is being written. The
                                placeholder row's title is the literal "Processing...", and
                                regeneration overwrites the title on completion anyway, so an
                                editable field here would only invite an edit that gets thrown
                                away. h-11 is the field's own height (36px line box + py-1),
                                so the real title lands without moving the tabs. */}
                            {/* The title rides the same handoff as the body (see
                                handoffExit/handoffEnter) rather than snapping from bar to
                                text. Only the OUTGOING layer is taken out of flow, so a
                                long title still sizes this box for itself — a fixed height
                                here would clip the two-line case. */}
                            <div className="relative">
                                <AnimatePresence initial={false} mode="popLayout">
                                    {isSummaryGenerating ? (
                                        <motion.div
                                            key="title-generating"
                                            className="h-11 flex items-center"
                                            aria-hidden="true"
                                            exit={handoffExit}
                                        >
                                            <SkeletonLine w={260} h={22} tone="strong" />
                                        </motion.div>
                                    ) : (
                                        <motion.div key="title" {...(() => { const r = revealLead(); return { className: r.cls.trim() || undefined, style: r.style }; })()}>
                                            <EditableTextBlock
                                                initialValue={meeting.title}
                                                onSave={handleTitleSave}
                                                tagName="h1"
                                                className="text-3xl font-bold text-text-primary tracking-tight -ml-2 px-2 py-1 rounded-md transition-colors"
                                                multiline={false}
                                            />
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </div>

                        {/* Moved Actions: Follow-up & Share (REMOVED per user request) */}
                        {/* <div className="flex items-center gap-2 mt-1"> ... </div> */}
                    </div>

                    {/* Tabs */}
                    {/* Designing Tabs to match reference 1:1 (Dark Pill Container) */}
                    {/* Spacing below the tab row lives on the sticky wrapper's pb-8, not a margin
                        here — a trailing child margin collapses out of the sticky box and would
                        leave a 32px strip the header background doesn't paint. */}
                    <div className="flex items-center justify-between">
                        {/* Dark well deepened from #121214 to #0D0D0F: against the old near-black
                            surface it read as a raised container, but on the elevated grey it was
                            within ~3 levels of the page and the control lost its shape. */}
                        <div className={`p-1 rounded-xl inline-flex items-center gap-0.5 ${isLight ? 'bg-[#E5E5EA] border border-black/[0.04]' : 'bg-[#0D0D0F] border border-white/[0.08]'}`}>
                            {['summary', 'transcript', 'usage'].map((tab) => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab as any)}
                                    className={`
                                        relative px-3 py-1 text-[13px] font-medium rounded-lg transition-all duration-200 z-10
                                        ${activeTab === tab ? (isLight ? 'text-black' : 'text-[#E9E9E9]') : `${isLight ? 'text-text-secondary' : 'text-text-tertiary'} hover:text-text-primary`}
                                    `}
                                >
                                    {activeTab === tab && (
                                        <motion.div
                                            layoutId="activeTabBackground"
                                            className={`absolute inset-0 rounded-lg -z-10 shadow-sm ${isLight ? 'bg-white' : 'bg-[#3A3A3C]'}`}
                                            initial={false}
                                            transition={{ type: "spring", stiffness: 400, damping: 30 }}
                                        />
                                    )}
                                    {tab === 'summary' ? t('Summary') : tab === 'transcript' ? t('Transcript') : t('Usage')}
                                </button>
                            ))}
                        </div>

                        {/* Copy Button - Inline with Tabs (Always visible) */}
                        {/* handleCopy's summary branch reads detailedSummary, which is a
                            truthy-but-empty placeholder during generation — copying would
                            silently yield a header and nothing else. */}
                        <button
                            onClick={handleCopy}
                            disabled={activeTab === 'summary' && isSummaryGenerating}
                            className="flex items-center gap-2 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40 disabled:cursor-default disabled:hover:text-text-secondary"
                        >
                            {isCopied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                            {isCopied ? t('Copied') : activeTab === 'summary' ? t('Copy full summary') : activeTab === 'transcript' ? t('Copy full transcript') : t('Copy usage')}
                        </button>
                    </div>
                    </motion.div>
                </div>

                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1, duration: 0.3 }}
                    className="max-w-4xl mx-auto px-8 pb-32" // pb-32 for floating footer clearance
                >
                    {/* Tab Content */}
                    <div className="space-y-8">
                        {/* Using standard divs for content, framer motion for layout */}
                        {activeTab === 'summary' && (
                        <div className="relative">
                        <AnimatePresence initial={false} mode="popLayout">
                        {isSummaryGenerating ? (
                            <motion.div
                                key="generating"
                                exit={handoffExit}
                            >
                                <MeetingNotesSkeleton
                                    status={v3SummaryStatus}
                                    isLight={isLight}
                                    still={Boolean(prefersReducedMotion)}
                                    t={t}
                                />
                            </motion.div>
                        ) : showSummaryFailure ? (
                            /* Generation failed with nothing to fall back on. The transcript
                               is already saved, and regenerateSavedMeeting only needs that —
                               so the retry is real, not a dead-end message. */
                            <motion.div
                                key="failed"
                                initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
                                animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                                transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
                                className={`px-4 py-5 rounded-[10px] border ${isLight ? 'border-black/[0.08] bg-black/[0.015]' : 'border-white/10 bg-white/[0.02]'}`}
                            >
                                <p className="text-sm font-semibold text-text-primary mb-1">{t("Notes couldn't be generated")}</p>
                                <p className="text-[12.5px] text-text-secondary leading-relaxed mb-4">
                                    {t('The full transcript is saved — you can generate the notes again.')}
                                </p>
                                <motion.button
                                    type="button"
                                    onClick={() => handleRegenerate()}
                                    disabled={isRegenerating}
                                    whileTap={prefersReducedMotion || isRegenerating ? undefined : { scale: 0.97 }}
                                    transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
                                    className={`h-8 inline-flex items-center gap-1.5 text-[12px] font-medium px-3 rounded-md text-text-primary disabled:opacity-50 transition-colors ${isLight ? 'bg-black/[0.05] hover:bg-black/[0.09]' : 'bg-white/[0.06] hover:bg-white/[0.1]'}`}
                                >
                                    <RefreshCw
                                        className={`w-3.5 h-3.5 shrink-0 ${isRegenerating && !prefersReducedMotion ? 'animate-spin' : ''}`}
                                        strokeWidth={2}
                                    />
                                    <span>{isRegenerating ? t('Generating…') : t('Try again')}</span>
                                </motion.button>
                            </motion.div>
                        ) : (
                            <motion.div
                                key="notes"
                                ref={notesRef}
                                className={revealing && prefersReducedMotion ? 'mn-reveal-reduced' : undefined}
                            >
                                {/* Overview — the largest slab of prose in the note, and the one that made
                                    the old cascade read as "block by block": it renders through ReactMarkdown,
                                    so its text never passed through revealWords and the whole paragraph
                                    arrived on a single delay. The overrides below route every element's string
                                    children through the cascade, so it now sweeps line by line like the rest.

                                    The container keeps an OPACITY-ONLY guard on the first of those lines. It is
                                    not decoration: react-markdown can emit text this component does not override
                                    (a table cell, a code span), and anything unwrapped would otherwise sit at
                                    full opacity from the very first frame while the prose around it swept in —
                                    which reads worse than the block reveal being replaced. Opacity only, because
                                    a blur here would nest under each word's own blur and compound both. */}
                                {meeting.detailedSummary?.overview && (() => { const g = revealGuard(); return (
                                <div className={`pb-5 border-b border-border-subtle prose prose-sm max-w-none${g.cls}`} style={g.style} data-rw={g['data-rw']}>
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                        components={{
                                            h1: ({ node, children, ...props }) => <h1 className="text-xl font-bold text-text-primary mt-4 mb-2" {...props}>{revealMarkdownChildren(children)}</h1>,
                                            h2: ({ node, children, ...props }) => <h2 className="text-lg font-semibold text-text-primary mt-4 mb-2" {...props}>{revealMarkdownChildren(children)}</h2>,
                                            h3: ({ node, children, ...props }) => <h3 className="text-base font-semibold text-text-primary mt-3 mb-1" {...props}>{revealMarkdownChildren(children)}</h3>,
                                            p: ({ node, children, ...props }) => <p className="text-sm text-text-secondary leading-relaxed mb-2" {...props}>{revealMarkdownChildren(children)}</p>,
                                            ul: ({ node, ...props }) => <ul className="list-disc ml-4 mb-2 space-y-1" {...props} />,
                                            ol: ({ node, ...props }) => <ol className="list-decimal ml-4 mb-2 space-y-1" {...props} />,
                                            li: ({ node, children, ...props }) => <li className="text-sm text-text-secondary" {...props}>{revealMarkdownChildren(children)}</li>,
                                            em: ({ node, children, ...props }) => <em {...props}>{revealMarkdownChildren(children)}</em>,
                                            strong: ({ node, children, ...props }) => <strong className="font-semibold text-text-primary" {...props}>{revealMarkdownChildren(children)}</strong>,
                                            a: ({ node, children, ...props }) => <a className="text-accent-primary hover:underline" {...props}>{revealMarkdownChildren(children)}</a>,
                                            ...makeTableComponents('text-sm leading-relaxed'),
                                        }}
                                    >
                                        {meeting.detailedSummary?.overview || ''}
                                    </ReactMarkdown>
                                </div>
                                ); })()}

                                {/* V3 — product-grade structured notes: fast skim, decisions, actions, open questions, risks, quality.
                                    The four callout cards below form one coherent family: same radius, padding, icon
                                    treatment and type scale. They fade + lift in with a short ease-out stagger. */}

                                {/* 1. Source quality — severity-aware. Benign cleanup notes (segments removed/cleaned)
                                    read as quiet info; genuine concerns (speaker labels, coverage, "verify") stay amber. */}
                                {/* 1. Source quality warning */}
                                {isV3Summary && (() => {
                                    const sqWarnings = meeting.detailedSummary?.sourceQuality?.warnings ?? [];
                                    const realIssues = sqWarnings.filter(w => !isBenignQualityNote(w));
                                    if (realIssues.length === 0) return null;
                                    return (
                                        <motion.div
                                            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
                                            animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                                            transition={{ duration: 0.24, ease: [0.25, 0.46, 0.45, 0.94] }}
                                            className="mb-4 flex items-start gap-2.5 px-4 py-3 rounded-lg bg-white/[0.08]"
                                        >
                                            <Info className="w-3.5 h-3.5 text-text-tertiary shrink-0 mt-[1px]" strokeWidth={2} />
                                            <div className="space-y-0.5">
                                                {realIssues.map((w, i) => (
                                                    <p key={i} className="text-[12.5px] text-text-secondary leading-snug">{w}</p>
                                                ))}
                                            </div>
                                        </motion.div>
                                    );
                                })()}

                                {/* 2. Toolbar */}
                                {isV3Summary && (
                                    <motion.div
                                        initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
                                        animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                                        transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1], delay: prefersReducedMotion ? 0 : 0.05 }}
                                        className="mb-6 flex flex-wrap items-center gap-2"
                                    >
                                        <div className="flex items-center gap-1 p-1 rounded-lg bg-white/[0.03] border border-border-subtle">
                                            <motion.button
                                                type="button"
                                                onClick={() => handleRegenerate()}
                                                disabled={isRegenerating}
                                                initial="rest"
                                                whileHover={prefersReducedMotion || isRegenerating ? undefined : 'hover'}
                                                whileTap={prefersReducedMotion || isRegenerating ? undefined : { scale: 0.96 }}
                                                transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
                                                className="h-7 inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-white/[0.06] disabled:opacity-50 disabled:hover:bg-transparent transition-colors"
                                            >
                                                <motion.span
                                                    className="w-3.5 h-3.5 shrink-0 inline-flex"
                                                    variants={prefersReducedMotion ? undefined : { rest: { rotate: 0 }, hover: { rotate: -180 } }}
                                                    transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
                                                >
                                                    <RefreshCw
                                                        className={`w-3.5 h-3.5 ${isRegenerating && !prefersReducedMotion ? 'animate-spin' : ''}`}
                                                        strokeWidth={2}
                                                    />
                                                </motion.span>
                                                <span>{isRegenerating ? t('Regenerating…') : t('Regenerate notes')}</span>
                                            </motion.button>

                                            <div className="w-px h-4 bg-border-subtle shrink-0" aria-hidden="true" />

                                            <motion.button
                                                type="button"
                                                onClick={() => setShowEvidence(v => !v)}
                                                whileTap={prefersReducedMotion ? undefined : { scale: 0.96 }}
                                                transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
                                                aria-pressed={showEvidence}
                                                className={`h-7 inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 rounded-md transition-colors ${showEvidence ? 'text-accent-primary bg-accent-subtle' : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.06]'}`}
                                            >
                                                <span className="relative w-3.5 h-3.5 shrink-0">
                                                    <AnimatePresence initial={false} mode="wait">
                                                        <motion.span
                                                            key={showEvidence ? 'eye' : 'eyeoff'}
                                                            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
                                                            animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                                                            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
                                                            transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
                                                            className="absolute inset-0 flex items-center justify-center"
                                                        >
                                                            {showEvidence
                                                                ? <Eye className="w-3.5 h-3.5" strokeWidth={2} />
                                                                : <EyeOff className="w-3.5 h-3.5" strokeWidth={2} />}
                                                        </motion.span>
                                                    </AnimatePresence>
                                                </span>
                                                <span>{showEvidence ? t('Hide evidence') : t('Show evidence')}</span>
                                            </motion.button>
                                        </div>
                                        {v3SummaryStatus && v3SummaryStatus !== 'completed' && (
                                            <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-400">
                                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                                                {v3SummaryStatus.replace(/_/g, ' ')}
                                            </span>
                                        )}
                                    </motion.div>
                                )}

                                {/* 3. Mode auto-detect suggestion */}
                                {isV3Summary && v3Mode?.detectedModeName && v3Mode?.detectedConfidence != null && v3Mode.detectedConfidence >= 0.5 &&
                                  v3Mode.detectedModeName !== v3Mode.selectedModeName && (
                                    <motion.button
                                        type="button"
                                        onClick={() => handleRegenerate(v3Mode.detectedModeId ? undefined : (v3Mode.detectedModeName || '').toLowerCase())}
                                        disabled={isRegenerating}
                                        initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
                                        animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                                        whileTap={prefersReducedMotion || isRegenerating ? undefined : { scale: 0.99, transition: { duration: 0.1 } }}
                                        transition={{ duration: 0.24, ease: [0.25, 0.46, 0.45, 0.94], delay: prefersReducedMotion ? 0 : 0.06 }}
                                        className="mb-5 w-full text-left flex items-center justify-between gap-3 px-4 py-3.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.11] active:bg-white/[0.06] disabled:opacity-40 transition-colors duration-150 group"
                                    >
                                        <div className="min-w-0">
                                            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-tertiary mb-1">
                                                {v3Mode.selectedModeName ? `${t('This looks like a')} ${v3Mode.detectedModeName}` : t('Better template available')}
                                            </p>
                                            <p className="text-[14px] font-semibold text-text-primary tracking-[-0.01em] truncate leading-tight">
                                                {isRegenerating
                                                    ? t('Regenerating…')
                                                    : <>{t('Regenerate notes as')} <span className="text-accent-primary">{v3Mode.detectedModeName}</span></>}
                                            </p>
                                        </div>
                                        <ChevronRight className="shrink-0 w-4 h-4 text-text-tertiary group-hover:text-accent-primary group-hover:translate-x-0.5 transition-all duration-150" strokeWidth={2} />
                                    </motion.button>
                                )}

                                {/* 4. Cross-meeting recall — still-open carryover from prior meetings (Phase 13). */}
                                {isV3Summary && meeting.detailedSummary?.crossMeeting?.stillOpen && meeting.detailedSummary.crossMeeting.stillOpen.length > 0 && (
                                    <motion.section
                                        initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
                                        animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                                        transition={{ duration: 0.24, ease: [0.25, 0.46, 0.45, 0.94], delay: prefersReducedMotion ? 0 : 0.12 }}
                                        className="mb-6 px-4 py-3.5 rounded-lg bg-white/[0.08]"
                                    >
                                        <div className="flex items-center gap-2 mb-2.5">
                                            <History className="w-3.5 h-3.5 text-text-tertiary shrink-0" strokeWidth={2} />
                                            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-tertiary">{t('From earlier meetings')}</p>
                                        </div>
                                        <ul className="space-y-2">
                                            {meeting.detailedSummary.crossMeeting.stillOpen.map((line, i) => (
                                                <li key={i} className="flex items-start gap-2.5 text-[12.5px] text-text-secondary leading-snug">
                                                    <span className="mt-[7px] w-[3px] h-[3px] rounded-full bg-text-tertiary shrink-0" />
                                                    <span>{line}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </motion.section>
                                )}

                                {/* Summary on top — outcome-first, grounded. Then the mode's template sections below. */}
                                {isV3Summary && v3Tldr.length > 0 && (() => { const h = revealBlock(); return (
                                    <section className="mb-8">
                                        <h2 className={`text-lg font-semibold text-text-primary mb-4${h.cls}`} style={h.style} data-rw={h['data-rw']}>{t('Summary')}</h2>
                                        <ul className="space-y-3">
                                            {v3Tldr.map((item, i) => {
                                                // The dot rides the first word of its own bullet (see revealWith):
                                                // its `mt-2` box would otherwise measure as a line of its own.
                                                const dot = revealWith(revealSlot);
                                                return (
                                                <li key={i} className="flex items-start gap-3 group">
                                                    <div
                                                        className={`mt-2 w-1.5 h-1.5 rounded-full bg-blue-400/70 shrink-0${dot.cls}`}
                                                        style={dot.style}
                                                    />
                                                    <p className="text-sm text-text-secondary leading-relaxed">{revealWords(item)}</p>
                                                </li>
                                                );
                                            })}
                                        </ul>
                                    </section>
                                ); })()}

                                {/* The mode's note-section TEMPLATE — the primary notes layout (e.g. Questions and
                                    responses, Discovery, Action items). Rendered right under Summary, in template order.
                                    Empty sections are dropped server-side. */}
                                {isV3Summary && meeting.detailedSummary?.sectionsV3 && meeting.detailedSummary.sectionsV3.length > 0 && (
                                    <>
                                        {meeting.detailedSummary.sectionsV3
                                            .filter(section => SHOW_NEXT_STEPS || !isNextStepsSectionTitle(section.title))
                                            .map((section) => {
                                            const h = revealBlock();
                                            return (
                                            <section key={section.id} className="mb-8">
                                                <h2 className={`text-lg font-semibold text-text-primary mb-4${h.cls}`} style={h.style} data-rw={h['data-rw']}>{section.title}</h2>
                                                <ul className="space-y-3">
                                                    {section.bullets.map((bullet, i) => {
                                                        const dot = revealWith(revealSlot);
                                                        return (
                                                        <li key={bullet.id || i} className="flex items-start gap-3">
                                                            {/* The colour rides a style object, not `bg-text-secondary/60`:
                                                                `text-secondary` is a bare var() reference, so Tailwind cannot
                                                                recompute its alpha and that utility compiled to NOTHING —
                                                                every bullet in the mode's note sections rendered with an
                                                                invisible dot. Same token, alpha applied where it works. */}
                                                            <div
                                                                className={`mt-2 w-1.5 h-1.5 rounded-full shrink-0${dot.cls}`}
                                                                // The alpha rides IN the colour rather than on `opacity`: the
                                                                // reveal animates opacity 0 → 1 with fill-mode `both`, so an
                                                                // `opacity: 0.6` here would be overridden to 1 for as long as the
                                                                // animation is applied and then snap back when the class drops.
                                                                style={{ background: 'color-mix(in srgb, var(--text-secondary) 60%, transparent)', ...dot.style }}
                                                            />
                                                            <div className="min-w-0 flex-1">
                                                                <p className="text-sm text-text-secondary leading-relaxed">{revealWords(bullet.text)}</p>
                                                                {showEvidence && evidenceLabel(bullet.evidence) && (
                                                                    <button type="button" onClick={() => jumpToEvidence(bullet.evidence)} className="text-[11px] text-accent-primary hover:text-accent-hover mt-1 text-left">↳ {evidenceLabel(bullet.evidence)}</button>
                                                                )}
                                                            </div>
                                                        </li>
                                                        );
                                                    })}
                                                </ul>
                                            </section>
                                            ); })}
                                    </>
                                )}

                                {/* SHOW_STRUCTURED_BLOCKS: the mode's note-section TEMPLATE is the source of truth, so the
                                    imposed What-changed/Decisions/Actions/Questions/Risks blocks are NOT rendered as the
                                    primary layout (they remain in the schema, powering the follow-up draft + cross-meeting
                                    recall). Flip to true to surface them again. */}
                                {SHOW_STRUCTURED_BLOCKS && isV3Summary && v3WhatChanged.length > 0 && (
                                    <section className="mb-8">
                                        <h2 className="text-lg font-semibold text-text-primary mb-4">{t('What changed')}</h2>
                                        <ul className="space-y-3">
                                            {v3WhatChanged.map((item, i) => (
                                                <li key={i} className="flex items-start gap-3 group">
                                                    <div className="mt-2 w-1.5 h-1.5 rounded-full bg-indigo-500/80 shrink-0" />
                                                    <p className="text-sm text-text-secondary leading-relaxed">{item}</p>
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                )}

                                {SHOW_STRUCTURED_BLOCKS && isV3Summary && v3Decisions.length > 0 && (
                                    <section className="mb-8">
                                        <h2 className="text-lg font-semibold text-text-primary mb-4">{t('Decisions')}</h2>
                                        <ul className="space-y-3">
                                            {v3Decisions.map((item, i) => (
                                                <li key={item.id || i} className="p-3 rounded-[10px] border border-white/10 bg-white/[0.02]">
                                                    <div className="flex items-start gap-3">
                                                        <div className="mt-2 w-1.5 h-1.5 rounded-full bg-blue-500/80 shrink-0" />
                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-sm text-text-secondary leading-relaxed">{item.text}</p>
                                                            <p className="text-[11px] text-text-tertiary mt-1">
                                                                {item.owner && <span>{item.owner} · </span>}
                                                                <span>{item.confidence} {t('confidence')}</span>
                                                            </p>
                                                            {showEvidence && evidenceLabel(item.evidence) && (
                                                                <button type="button" onClick={() => jumpToEvidence(item.evidence)} className="text-[11px] text-accent-primary hover:text-accent-hover mt-1 text-left">↳ {evidenceLabel(item.evidence)}</button>
                                                            )}
                                                        </div>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                )}

                                {SHOW_STRUCTURED_BLOCKS && isV3Summary && v3Actions.length > 0 && (
                                    <section className="mb-8">
                                        <h2 className="text-lg font-semibold text-text-primary mb-4">{t('Action Items')}</h2>
                                        <ul className="space-y-3">
                                            {v3Actions.map((item, i) => (
                                                <li key={item.id || i} className="p-3 rounded-[10px] border border-emerald-400/20 bg-emerald-500/[0.03]">
                                                    <div className="flex items-start gap-3">
                                                        <div className="mt-2 w-1.5 h-1.5 rounded-full bg-emerald-500/80 shrink-0" />
                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-sm text-text-secondary leading-relaxed">{item.text}</p>
                                                            <p className="text-[11px] text-text-tertiary mt-1 flex flex-wrap gap-x-1">
                                                                {item.owner && <span className="font-medium">{item.owner}</span>}
                                                                {item.deadline && <span>{t('by')} {item.deadline}</span>}
                                                                <span className={`px-1.5 py-0.5 rounded border ${item.explicitness === 'explicit' ? 'border-emerald-400/30 text-emerald-400' : 'border-amber-400/30 text-amber-400'}`}>{item.explicitness}</span>
                                                                <span>{item.confidence} {t('confidence')}</span>
                                                            </p>
                                                            {showEvidence && evidenceLabel(item.evidence) && (
                                                                <button type="button" onClick={() => jumpToEvidence(item.evidence)} className="text-[11px] text-accent-primary hover:text-accent-hover mt-1 text-left">↳ {evidenceLabel(item.evidence)}</button>
                                                            )}
                                                        </div>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                )}

                                {SHOW_STRUCTURED_BLOCKS && isV3Summary && v3Questions.length > 0 && (
                                    <section className="mb-8">
                                        <h2 className="text-lg font-semibold text-text-primary mb-4">{t('Open Questions')}</h2>
                                        <ul className="space-y-3">
                                            {v3Questions.map((item, i) => (
                                                <li key={item.id || i} className="flex items-start gap-3 group">
                                                    <div className="mt-2 w-1.5 h-1.5 rounded-full bg-yellow-500/80 shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm text-text-secondary leading-relaxed">{item.text}</p>
                                                        <p className="text-[11px] text-text-tertiary mt-0.5">{item.status}{item.owner ? ` · ${item.owner}` : ''}{evidenceLabel(item.evidence) ? ` · ${evidenceLabel(item.evidence)}` : ''}</p>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                )}

                                {SHOW_STRUCTURED_BLOCKS && isV3Summary && v3Risks.length > 0 && (
                                    <section className="mb-8">
                                        <h2 className="text-lg font-semibold text-text-primary mb-4">{t('Risks / Blockers')}</h2>
                                        <ul className="space-y-3">
                                            {v3Risks.map((item, i) => (
                                                <li key={item.id || i} className="p-3 rounded-[10px] border border-red-400/20 bg-red-500/[0.03]">
                                                    <p className="text-sm text-text-secondary leading-relaxed">{item.text}</p>
                                                    <p className="text-[11px] text-text-tertiary mt-1">{item.severity} {t('severity')}{evidenceLabel(item.evidence) ? ` · ${evidenceLabel(item.evidence)}` : ''}</p>
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                )}

                                {/* V3 follow-up draft — human prose, copy + regenerate + tone. */}
                                {isV3Summary && followUpBody.trim() && (() => { const h = revealBlock(); return (
                                    <section className="mb-8">
                                        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                                            <h2 className={`text-lg font-semibold text-text-primary${h.cls}`} style={h.style} data-rw={h['data-rw']}>{t('Follow-up draft')}</h2>
                                            <div className="flex items-center gap-1 p-1 rounded-lg bg-white/[0.03] border border-border-subtle">
                                                {/* Copy — with a real copied-confirmation state. */}
                                                <motion.button
                                                    type="button"
                                                    onClick={() => {
                                                        copyRecipe((followUpSubject ? `Subject: ${followUpSubject}\n\n` : '') + followUpBody);
                                                        setFollowUpCopied(true);
                                                        setTimeout(() => setFollowUpCopied(false), 1500);
                                                    }}
                                                    whileTap={prefersReducedMotion ? undefined : { scale: 0.96 }}
                                                    transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
                                                    aria-label={followUpCopied ? t('Copied') : t('Copy follow-up draft')}
                                                    className="h-7 inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-white/[0.06] transition-colors"
                                                >
                                                    <span className="relative w-3.5 h-3.5 shrink-0">
                                                        <AnimatePresence initial={false} mode="wait">
                                                            {followUpCopied ? (
                                                                <motion.span
                                                                    key="check"
                                                                    initial={prefersReducedMotion ? { opacity: 0 } : { scale: 0.6, opacity: 0 }}
                                                                    animate={prefersReducedMotion ? { opacity: 1 } : { scale: 1, opacity: 1 }}
                                                                    exit={prefersReducedMotion ? { opacity: 0 } : { scale: 0.6, opacity: 0 }}
                                                                    transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                                                                    className="absolute inset-0 flex items-center justify-center text-accent-primary"
                                                                >
                                                                    <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                                                                </motion.span>
                                                            ) : (
                                                                <motion.span
                                                                    key="copy"
                                                                    initial={prefersReducedMotion ? { opacity: 0 } : { scale: 0.6, opacity: 0 }}
                                                                    animate={prefersReducedMotion ? { opacity: 1 } : { scale: 1, opacity: 1 }}
                                                                    exit={prefersReducedMotion ? { opacity: 0 } : { scale: 0.6, opacity: 0 }}
                                                                    transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                                                                    className="absolute inset-0 flex items-center justify-center"
                                                                >
                                                                    <Copy className="w-3.5 h-3.5" strokeWidth={2} />
                                                                </motion.span>
                                                            )}
                                                        </AnimatePresence>
                                                    </span>
                                                    <span className="min-w-[30px] text-left">{followUpCopied ? t('Copied') : t('Copy')}</span>
                                                </motion.button>

                                                <div className="w-px h-4 bg-border-subtle shrink-0" aria-hidden="true" />

                                                {/* Regenerate — icon spins while regenerating. */}
                                                <motion.button
                                                    type="button"
                                                    onClick={() => handleRegenerateFollowUp()}
                                                    disabled={isRegeneratingFollowUp}
                                                    whileTap={prefersReducedMotion || isRegeneratingFollowUp ? undefined : { scale: 0.96 }}
                                                    transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
                                                    className="h-7 inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-white/[0.06] disabled:opacity-50 disabled:hover:bg-transparent transition-colors"
                                                >
                                                    <RefreshCw
                                                        className={`w-3.5 h-3.5 shrink-0 ${isRegeneratingFollowUp && !prefersReducedMotion ? 'animate-spin' : ''}`}
                                                        strokeWidth={2}
                                                    />
                                                    <span>{isRegeneratingFollowUp ? t('Regenerating…') : t('Regenerate')}</span>
                                                </motion.button>

                                                <div className="w-px h-4 bg-border-subtle shrink-0" aria-hidden="true" />

                                                {/* Tone — custom dropdown */}
                                                <ToneDropdown
                                                    followUpTone={followUpTone}
                                                    isRegeneratingFollowUp={isRegeneratingFollowUp}
                                                    onSelect={(tone) => { setFollowUpTone(tone); handleRegenerateFollowUp(tone); }}
                                                />
                                            </div>
                                        </div>
                                        {followUpSubject && <p className="text-[12.5px] text-text-tertiary mb-1">{revealWords(t('Subject:'))} {revealWords(followUpSubject)}</p>}
                                        <pre className="text-[12.5px] text-text-secondary leading-relaxed whitespace-pre-wrap font-sans select-text cursor-text p-3 rounded-[10px] border border-white/10 bg-white/[0.02]">{revealWords(followUpBody)}</pre>
                                    </section>
                                ); })()}

                                {/* Action Items - Only show if there are items */}
                                {!isV3Summary && meeting.detailedSummary?.actionItems && meeting.detailedSummary.actionItems.length > 0 && (
                                    <section className="mb-8">
                                        <div className="flex items-center justify-between mb-4">
                                            <EditableTextBlock
                                                initialValue={meeting.detailedSummary?.actionItemsTitle || t('Action Items')}
                                                onSave={(val) => {
                                                    setMeeting(prev => ({
                                                        ...prev,
                                                        detailedSummary: { ...prev.detailedSummary!, actionItemsTitle: val }
                                                    }));
                                                    window.electronAPI?.updateMeetingSummary(meeting.id, { actionItemsTitle: val });
                                                }}
                                                tagName="h2"
                                                className="text-lg font-semibold text-text-primary -ml-2 px-2 py-1 rounded-sm transition-colors"
                                                multiline={false}
                                            />
                                        </div>
                                        <ul className="space-y-3">
                                            {meeting.detailedSummary.actionItems.map((item, i) => (
                                                <li key={actionItemKeys[i] ?? i} className="flex items-start gap-3 group">
                                                    <div className="mt-2 w-1.5 h-1.5 rounded-full bg-text-secondary group-hover:bg-accent-primary transition-colors shrink-0" />
                                                    <div className="flex-1">
                                                        <EditableTextBlock
                                                            initialValue={item}
                                                            onSave={(val) => handleActionItemSave(i, val)}
                                                            tagName="p"
                                                            className="text-sm text-text-secondary leading-relaxed -ml-2 px-2 rounded-sm transition-colors"
                                                            placeholder={t("Type an action item...")}
                                                            onEnter={() => {
                                                                const newItems = [...(meeting.detailedSummary?.actionItems || [])];
                                                                newItems.splice(i + 1, 0, "");
                                                                setActionItemKeys(prev => {
                                                                    const next = [...prev];
                                                                    next.splice(i + 1, 0, genMessageId());
                                                                    return next;
                                                                });
                                                                setMeeting(prev => ({
                                                                    ...prev,
                                                                    detailedSummary: { ...prev.detailedSummary!, actionItems: newItems }
                                                                }));
                                                            }}
                                                        />
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                )}

                                {/* Key Points - Only show if there are items */}
                                {!isV3Summary && meeting.detailedSummary?.keyPoints && meeting.detailedSummary.keyPoints.length > 0 && (
                                    <section>
                                        <div className="flex items-center justify-between mb-4">
                                            <EditableTextBlock
                                                initialValue={meeting.detailedSummary?.keyPointsTitle || t('Key Points')}
                                                onSave={(val) => {
                                                    setMeeting(prev => ({
                                                        ...prev,
                                                        detailedSummary: { ...prev.detailedSummary!, keyPointsTitle: val }
                                                    }));
                                                    window.electronAPI?.updateMeetingSummary(meeting.id, { keyPointsTitle: val });
                                                }}
                                                tagName="h2"
                                                className="text-lg font-semibold text-text-primary -ml-2 px-2 py-1 rounded-sm transition-colors"
                                                multiline={false}
                                            />
                                        </div>
                                        <ul className="space-y-3">
                                            {meeting.detailedSummary.keyPoints.map((item, i) => (
                                                <li key={keyPointKeys[i] ?? i} className="flex items-start gap-3 group">
                                                    <div className="mt-2 w-1.5 h-1.5 rounded-full bg-text-secondary group-hover:bg-purple-500 transition-colors shrink-0" />
                                                    <div className="flex-1">
                                                        <EditableTextBlock
                                                            initialValue={item}
                                                            onSave={(val) => handleKeyPointSave(i, val)}
                                                            tagName="p"
                                                            className="text-sm text-text-secondary leading-relaxed -ml-2 px-2 rounded-sm transition-colors"
                                                            placeholder={t("Type a key point...")}
                                                            onEnter={() => {
                                                                const newItems = [...(meeting.detailedSummary?.keyPoints || [])];
                                                                newItems.splice(i + 1, 0, "");
                                                                setKeyPointKeys(prev => {
                                                                    const next = [...prev];
                                                                    next.splice(i + 1, 0, genMessageId());
                                                                    return next;
                                                                });
                                                                setMeeting(prev => ({
                                                                    ...prev,
                                                                    detailedSummary: { ...prev.detailedSummary!, keyPoints: newItems }
                                                                }));
                                                            }}
                                                        />
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                )}

                                {/* Phase 7 — Structured action items (with owner / deadline).
                                    Rendered ONLY when PostCallWorkflow has produced them
                                    (schemaVersion === 2). Falls through silently otherwise so
                                    pre-Phase-7 meetings still look the same. */}
                                {SHOW_NEXT_STEPS && !isV3Summary && meeting.detailedSummary?.actionItemsStructured && meeting.detailedSummary.actionItemsStructured.length > 0 && (
                                    <section className="mb-8">
                                        <h2 className="text-lg font-semibold text-text-primary mb-4">{t('Next Steps')}</h2>
                                        <ul className="space-y-2">
                                            {meeting.detailedSummary.actionItemsStructured.map(item => (
                                                <li key={item.id} className="flex items-start gap-3 group">
                                                    <div className="mt-2 w-1.5 h-1.5 rounded-full bg-emerald-500/70 group-hover:bg-emerald-400 shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm text-text-secondary leading-relaxed">{item.text}</p>
                                                        {(item.owner || item.deadline) && (
                                                            <p className="text-[11px] text-text-tertiary mt-0.5">
                                                                {item.owner && <span className="font-medium">{item.owner}</span>}
                                                                {item.owner && item.deadline && <span> · </span>}
                                                                {item.deadline && <span>{t('by')} {item.deadline}</span>}
                                                            </p>
                                                        )}
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                )}

                                {/* The "Coaching" section was removed on 2026-08-26 (product decision);
                                    generation is switched off at INCLUDE_COACHING_INSIGHTS in
                                    electron/services/post-call/PostCallWorkflow.ts. The
                                    `coachingInsights` type above is kept so already-saved notes
                                    still parse; restore this <section> from git history if the
                                    flag is ever flipped back on. */}

                                {/* Phase 7 — Follow-up email draft (legacy V2: string). V3 renders its own above. */}
                                {!isV3Summary && typeof meeting.detailedSummary?.followUpDraft === 'string' && meeting.detailedSummary.followUpDraft.trim() && (
                                    <section className="mb-8">
                                        <div className="flex items-center justify-between mb-3">
                                            <h2 className="text-lg font-semibold text-text-primary">{t('Follow-up Draft')}</h2>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const fu = meeting.detailedSummary?.followUpDraft;
                                                    navigator.clipboard?.writeText(typeof fu === 'string' ? fu : '').catch(() => { /* swallow */ });
                                                }}
                                                className="text-[11px] px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-text-secondary border border-white/10 transition-colors"
                                            >
                                                {t('Copy')}
                                            </button>
                                        </div>
                                        <pre className="text-[12.5px] text-text-secondary leading-relaxed whitespace-pre-wrap font-sans select-text cursor-text p-3 rounded-[10px] border border-white/10 bg-white/[0.02]">{meeting.detailedSummary.followUpDraft}</pre>
                                    </section>
                                )}

                                {/* Mode-specific sections (when active mode has a notes template) */}
                                {!isV3Summary && meeting.detailedSummary?.sections && meeting.detailedSummary.sections.length > 0 && (
                                    <div className="space-y-8">
                                        {meeting.detailedSummary.sections.map((section, si) => (
                                            section.bullets.length > 0 && (
                                                <section key={`${section.title}-${si}`}>
                                                    <div className="flex items-center justify-between mb-4">
                                                        <h2 className="text-lg font-semibold text-text-primary">{section.title}</h2>
                                                    </div>
                                                    <ul className="space-y-3">
                                                        {section.bullets.map((bullet, bi) => (
                                                            <li key={bi} className="flex items-start gap-3 group">
                                                                <div className="mt-2 w-1.5 h-1.5 rounded-full bg-text-secondary shrink-0" />
                                                                <p className="text-sm text-text-secondary leading-relaxed">{bullet}</p>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </section>
                                            )
                                        ))}
                                    </div>
                                )}
                            </motion.div>
                        )}
                        </AnimatePresence>
                        </div>
                        )}

                        {activeTab === 'transcript' && (
                            <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                {/* Speaker rename row: distinct speakers + inline rename (Phase 9). */}
                                {(() => {
                                    const speakers = Array.from(new Set((meeting.transcript || [])
                                        .filter(e => !['system', 'ai', 'assistant', 'model'].includes((e.speaker || '').toLowerCase()))
                                        .map(e => e.speaker)));
                                    if (speakers.length === 0) return null;
                                    return (
                                        <div className="mb-5 flex flex-wrap items-center gap-2">
                                            <span className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mr-0.5">{t('Speakers')}</span>
                                            <AnimatePresence initial={false} mode="popLayout">
                                            {speakers.map((sp) => {
                                                const display = resolveSpeakerName(sp);
                                                const id = (sp || '').toLowerCase().replace(/^(user|me)$/, 'me').replace(/^(interviewer|them|other|system|assistant)$/, 'speaker_1').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
                                                if (editingSpeaker === id) {
                                                    return (
                                                        <motion.span
                                                            key={id}
                                                            layout
                                                            initial={prefersReducedMotion ? undefined : { opacity: 0, scale: 0.96 }}
                                                            animate={prefersReducedMotion ? undefined : { opacity: 1, scale: 1 }}
                                                            transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
                                                            className="inline-flex items-center gap-1 h-7 pl-2 pr-1 rounded-full bg-bg-secondary border border-accent-focus ring-1 ring-accent-border"
                                                        >
                                                            <input
                                                                autoFocus
                                                                value={speakerDraft}
                                                                onChange={e => setSpeakerDraft(e.target.value)}
                                                                onKeyDown={e => { if (e.key === 'Enter') handleSaveSpeakerLabel(id, speakerDraft); if (e.key === 'Escape') setEditingSpeaker(null); }}
                                                                placeholder={display}
                                                                className="text-[11px] bg-transparent text-text-primary placeholder:text-text-tertiary outline-none w-28"
                                                            />
                                                            <motion.button
                                                                type="button"
                                                                onMouseDown={e => e.preventDefault()}
                                                                onClick={() => handleSaveSpeakerLabel(id, speakerDraft)}
                                                                whileTap={prefersReducedMotion ? undefined : { scale: 0.9 }}
                                                                className="inline-flex items-center justify-center w-5 h-5 rounded-full text-accent-primary hover:bg-accent-muted transition-colors"
                                                                title={t("Save")}
                                                            >
                                                                <Check className="w-3 h-3" strokeWidth={2.5} />
                                                            </motion.button>
                                                            <motion.button
                                                                type="button"
                                                                onMouseDown={e => e.preventDefault()}
                                                                onClick={() => setEditingSpeaker(null)}
                                                                whileTap={prefersReducedMotion ? undefined : { scale: 0.9 }}
                                                                className="inline-flex items-center justify-center w-5 h-5 rounded-full text-text-tertiary hover:text-text-primary hover:bg-white/[0.08] transition-colors"
                                                                title={t("Cancel")}
                                                            >
                                                                <X className="w-3 h-3" strokeWidth={2.5} />
                                                            </motion.button>
                                                        </motion.span>
                                                    );
                                                }
                                                return (
                                                    <motion.button
                                                        key={id}
                                                        layout
                                                        type="button"
                                                        onClick={() => { setEditingSpeaker(id); setSpeakerDraft(display); }}
                                                        whileTap={prefersReducedMotion ? undefined : { scale: 0.96 }}
                                                        transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
                                                        className="group inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-white/[0.04] hover:bg-white/[0.08] text-text-secondary hover:text-text-primary border border-border-subtle transition-colors"
                                                        title={t("Rename speaker")}
                                                    >
                                                        <span className="text-[11px] font-medium">{display}</span>
                                                        <Pencil className="w-2.5 h-2.5 text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity shrink-0" strokeWidth={2} />
                                                    </motion.button>
                                                );
                                            })}
                                            </AnimatePresence>
                                        </div>
                                    );
                                })()}
                                <div className="space-y-6">
                                    {(() => {
                                        const filteredTranscript = meeting.transcript?.filter(entry => {
                                            const isHidden = ['system', 'ai', 'assistant', 'model'].includes(entry.speaker?.toLowerCase());
                                            return !isHidden;
                                        }) || [];

                                        if (filteredTranscript.length === 0) {
                                            return <p className="text-text-tertiary">{t('No transcript available.')}</p>;
                                        }

                                        // Find the segment index closest to a pending evidence timestamp.
                                        const scrollIndex = pendingScrollTs == null ? -1 : filteredTranscript.reduce((best, e, idx) => {
                                            const d = Math.abs((e.timestamp || 0) - pendingScrollTs);
                                            return d < best.d ? { d, idx } : best;
                                        }, { d: Infinity, idx: -1 }).idx;

                                        return filteredTranscript.map((entry, i) => (
                                            <div
                                                key={i}
                                                className={`group rounded-md transition-colors ${i === scrollIndex ? 'bg-accent-subtle ring-1 ring-accent-border -mx-2 px-2 py-1' : ''}`}
                                                ref={i === scrollIndex ? (el) => { if (el && pendingScrollTs != null) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => setPendingScrollTs(null), 1500); } } : undefined}
                                            >
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-xs font-semibold text-text-secondary">
                                                        {resolveSpeakerName(entry.speaker)}
                                                    </span>
                                                    <span className="text-xs text-text-tertiary font-mono">{entry.timestamp ? formatTime(entry.timestamp) : '0:00'}</span>
                                                </div>
                                                <p className="text-text-secondary text-[15px] leading-relaxed transition-colors select-text cursor-text">{entry.text}</p>
                                            </div>
                                        ));
                                    })()}
                                </div>
                            </motion.section>
                        )}

                        {activeTab === 'usage' && (
                            <section className="space-y-8 pb-10">
                                {(() => {
                                    const items = meeting.usage ?? [];
                                    // Stagger only the newest few items on first view — a long
                                    // history should never cascade top-to-bottom.
                                    const STAGGER_TAIL = 4;
                                    const firstStaggered = Math.max(0, items.length - STAGGER_TAIL);
                                    return items.map((interaction, i) => {
                                        const id = `${interaction.timestamp}-${i}`;
                                        const staggerDelay = i >= firstStaggered ? (i - firstStaggered) * 0.06 : 0;
                                        return (
                                            <UsageInteraction
                                                key={id}
                                                id={id}
                                                interaction={interaction}
                                                staggerDelay={staggerDelay}
                                            />
                                        );
                                    });
                                })()}
                                {!meeting.usage?.length && <p className="text-text-tertiary">{t('No usage history.')}</p>}
                            </section>
                        )}
                    </div>
                </motion.div>
            </main>

            {/* Floating Footer (Ask Bar) */}
            <div className={`absolute bottom-0 left-0 right-0 p-6 flex justify-center pointer-events-none ${isChatOpen ? 'z-50' : 'z-20'}`}>
                <div className="w-full max-w-[440px] relative group pointer-events-auto">
                    {/* Dark Glass Effect Input (Matching Reference) */}
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleInputKeyDown}
                        placeholder={t("Ask about this meeting...")}
                        className="w-full pl-5 pr-12 py-3 bg-transparent backdrop-blur-[24px] backdrop-saturate-[140%] shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-white/20 rounded-full text-sm text-text-primary placeholder-text-tertiary/70 focus:outline-none transition-shadow duration-200"
                    />
                    <button
                        onClick={handleSubmitQuestion}
                        className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full transition-all duration-200 border border-white/5 ${query.trim() ? 'bg-text-primary text-bg-primary hover:scale-105' : 'bg-bg-item-active text-text-primary hover:bg-bg-item-hover'
                            }`}
                    >
                        <ArrowUp size={16} className="transform rotate-45" />
                    </button>
                </div>
            </div>

            {/* Chat Overlay */}
            <MeetingChatOverlay
                isOpen={isChatOpen}
                onClose={() => {
                    setIsChatOpen(false);
                    setQuery('');
                    setSubmittedQuery('');
                }}
                meetingContext={{
                    id: meeting.id,  // Required for RAG queries
                    title: meeting.title,
                    summary: meeting.detailedSummary?.overview,
                    keyPoints: meeting.detailedSummary?.keyPoints,
                    actionItems: meeting.detailedSummary?.actionItems,
                    transcript: meeting.transcript
                }}
                initialQuery={submittedQuery}
                onNewQuery={(newQuery) => {
                    setSubmittedQuery(newQuery);
                }}
            />
        </div>
    );
};

export default MeetingDetails;
