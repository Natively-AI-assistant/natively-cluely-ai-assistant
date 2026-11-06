/**
 * ModesSettings — full Modes Manager
 *
 * Reconstructed from the compiled bundle at:
 *   /Natively-Recovered-Source/recovered/reconstructed/readable/dist/assets/App-h7VwvpAg.js
 *   lines ~28100–32710 (components: wL, eL, tL, uL, vL, jL, kL, gL, rL, yu, etc.)
 *
 * CSS tokens, layout, and interactions are taken verbatim from the bundle.
 * React/TypeScript syntax was necessarily rewritten since the source is compiled JS.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Briefcase,
  Check,
  ChevronRight,
  Code2,
  Headphones,
  LayoutGrid,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Trash2,
  TrendingUp,
  UserSearch,
  Users,
  X,
  Paperclip,
  FileText,
} from 'lucide-react';

// ─── CSS ────────────────────────────────────────────────────────────────────
const CSS = `
.modes-manager-root {
    --mm-bg: #111111;
    --mm-sidebar-bg: #0e0e0e;
    --mm-sidebar-border: rgba(255,255,255,0.07);
    --mm-border: rgba(255,255,255,0.07);
    --mm-text-hero: #ffffff;
    --mm-text-primary: rgba(255,255,255,0.85);
    --mm-text-secondary: rgba(255,255,255,0.55);
    --mm-text-tertiary: rgba(255,255,255,0.35);
    --mm-btn-bg: rgba(255,255,255,0.06);
    --mm-btn-bg-hover: rgba(255,255,255,0.1);
    --mm-btn-border: rgba(255,255,255,0.1);
    --mm-item-hover: rgba(255,255,255,0.04);
    --mm-item-active: rgba(255,255,255,0.08);
    --mm-input-bg: transparent;
    --mm-input-border: rgba(255,255,255,0.1);
    --mm-danger: #ef4444;
    --mm-danger-bg: rgba(239,68,68,0.12);
    --mm-warning-bg: rgba(251,191,36,0.08);
    --mm-warning-border: rgba(251,191,36,0.2);
    --mm-warning-text: rgba(251,191,36,0.9);
    --mm-active-blue: var(--periwinkle-300, #818cf8);
    --mm-card-border: rgba(255,255,255,0.1);
    --mm-ease-out: cubic-bezier(0.23, 1, 0.32, 1);
    --mm-ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
    --mm-ease-expo: cubic-bezier(0.16, 1, 0.3, 1);
    --mm-spring: linear(0,0.0229,0.0789,0.1534,0.2363,0.3211,0.4034,0.4807,0.5515,0.6152,0.6717,0.7214,0.7645,0.8018,0.8337,0.861,0.8841,0.9036,0.9201,0.9339,0.9454,0.9551,0.9631,0.9698,0.9753,0.9799,0.9837,0.9868,0.9894,0.9915,0.9932,0.9946,0.9958,0.9968,0.9975,0.9982,0.9987,0.9991,0.9995,0.9998,1);
    --mm-input-border-focus: color-mix(in srgb, var(--mm-active-blue) 38%, transparent);
    --mm-input-bg-focus: color-mix(in srgb, var(--mm-active-blue) 5%, transparent);
    --mm-pending-border: color-mix(in srgb, var(--mm-warning-text) 45%, transparent);
    --mm-card-border-hover: color-mix(in srgb, var(--mm-text-hero) 22%, transparent);
    --mm-card-bg-hover: color-mix(in srgb, var(--mm-text-hero) 3%, transparent);
}

.modes-manager-root[data-theme='light'] {
    --mm-bg: #ffffff;
    --mm-sidebar-bg: #f9f9f9;
    --mm-sidebar-border: rgba(0,0,0,0.08);
    --mm-border: rgba(0,0,0,0.08);
    --mm-text-hero: #111827;
    --mm-text-primary: #374151;
    --mm-text-secondary: #6b7280;
    --mm-text-tertiary: #9ca3af;
    --mm-btn-bg: rgba(0,0,0,0.04);
    --mm-btn-bg-hover: rgba(0,0,0,0.08);
    --mm-btn-border: rgba(0,0,0,0.05);
    --mm-item-hover: rgba(0,0,0,0.03);
    --mm-item-active: rgba(0,0,0,0.06);
    --mm-input-bg: transparent;
    --mm-input-border: rgba(0,0,0,0.1);
    --mm-danger: #ef4444;
    --mm-danger-bg: rgba(239,68,68,0.08);
    --mm-warning-bg: rgba(217,119,6,0.08);
    --mm-warning-border: rgba(217,119,6,0.2);
    --mm-warning-text: #b45309;
    --mm-active-blue: var(--periwinkle-600, #4f46e5);
    --mm-card-border: rgba(0,0,0,0.1);
}

@keyframes mm-list-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
}
@keyframes mm-fade-only {
    from { opacity: 0; }
    to   { opacity: 1; }
}
@keyframes mm-pop-in {
    from { opacity: 0; transform: scale(0.97); }
    to   { opacity: 1; transform: scale(1); }
}
@keyframes mm-fade-out { to { opacity: 0; } }
@keyframes mm-check-in {
    from { opacity: 0; transform: scale(0.4); }
    to   { opacity: 1; transform: scale(1); }
}
@keyframes mm-panel-fade {
    from { opacity: 0; transform: translateY(16px); filter: blur(6px); }
    45%  { opacity: 1; }
    to   { opacity: 1; transform: translateY(0); filter: blur(0); }
}
@keyframes mm-save-pulse {
    0%   { transform: scale(1); }
    45%  { transform: scale(1.045); }
    100% { transform: scale(1); }
}
.mm-save-pulse { animation: mm-save-pulse 360ms cubic-bezier(0.34, 1.56, 0.64, 1); }

.mm-sel-indicator {
    position: absolute; top: 0; left: 8px; right: 8px;
    background: var(--mm-item-active);
    border-radius: 6px;
    pointer-events: none; z-index: 0;
    will-change: transform;
    transition: transform 250ms var(--mm-ease-out), opacity 240ms ease;
}
.mm-sel-indicator[data-instant='true'] { transition: opacity 160ms ease; }

.mm-mode-item { animation: mm-list-in 420ms var(--mm-ease-expo) backwards; }
.mm-mode-item:nth-child(2)   { animation-delay: 0ms; }
.mm-mode-item:nth-child(3)   { animation-delay: 55ms; }
.mm-mode-item:nth-child(4)   { animation-delay: 110ms; }
.mm-mode-item:nth-child(5)   { animation-delay: 160ms; }
.mm-mode-item:nth-child(6)   { animation-delay: 205ms; }
.mm-mode-item:nth-child(7)   { animation-delay: 245ms; }
.mm-mode-item:nth-child(8)   { animation-delay: 280ms; }
.mm-mode-item:nth-child(n+9) { animation-delay: 310ms; }
.mm-mode-item { background: transparent; }
.mm-mode-item:hover { background: var(--mm-item-hover); }
.mm-mode-item:focus { outline: none; }

.mm-template-row { animation: mm-list-in 420ms var(--mm-ease-expo) backwards; }
.mm-template-row.mm-press { background: transparent; }
.mm-template-row.mm-press:hover { background: var(--mm-item-hover); }
.mm-template-row:nth-child(1) { animation-delay: 40ms; }
.mm-template-row:nth-child(2) { animation-delay: 95ms; }
.mm-template-row:nth-child(3) { animation-delay: 150ms; }
.mm-template-row:nth-child(4) { animation-delay: 200ms; }
.mm-template-row:nth-child(5) { animation-delay: 245ms; }
.mm-template-row:nth-child(6) { animation-delay: 285ms; }
.mm-template-row:nth-child(7) { animation-delay: 320ms; }
.mm-template-row:nth-child(n+8) { animation-delay: 350ms; }

.mm-section-card { animation: mm-list-in 420ms var(--mm-ease-expo) backwards; }
.mm-section-card:nth-child(1) { animation-delay: 0ms; }
.mm-section-card:nth-child(2) { animation-delay: 55ms; }
.mm-section-card:nth-child(3) { animation-delay: 110ms; }
.mm-section-card:nth-child(4) { animation-delay: 160ms; }
.mm-section-card:nth-child(5) { animation-delay: 205ms; }
.mm-section-card:nth-child(n+6) { animation-delay: 240ms; }

.mm-fresh-row { animation: mm-list-in 420ms var(--mm-ease-expo) backwards; }

@keyframes mm-swap-in {
    from { opacity: 0; filter: blur(2px); }
}
.mm-swap-in { animation: mm-swap-in 250ms var(--mm-ease-out) backwards; }

.mm-press {
    transition: background 180ms var(--mm-ease-out), color 180ms ease,
        border-color 180ms ease, transform 160ms var(--mm-ease-out);
}
.mm-press:active { transform: scale(0.97); }

.mm-press-soft {
    transition: background 180ms var(--mm-ease-out), color 180ms ease,
        transform 140ms var(--mm-ease-out);
}
.mm-press-soft:active { transform: scale(0.92); }

.mm-banner-slot {
    display: grid; grid-template-rows: 0fr; flex-shrink: 0;
    transition: grid-template-rows 320ms var(--mm-spring);
}
.mm-banner-slot[data-open='true'] {
    grid-template-rows: 1fr;
    transition-duration: 480ms;
}
.mm-banner-slot > div { min-height: 0; overflow: hidden; }
.mm-banner-slot .mm-banner {
    opacity: 0; transform: translateY(-4px);
    transition: opacity 150ms var(--mm-ease-out), transform 150ms var(--mm-ease-out);
    padding: 8px;
}
.mm-banner-slot[data-open='true'] .mm-banner { opacity: 1; transform: translateY(0); }

.mm-save-fail {
    opacity: 0; transform: translateY(4px); filter: blur(2px);
    transition: opacity 150ms ease-in-out, transform 150ms ease-in-out, filter 150ms ease-in-out;
}
.mm-save-fail[data-shown='true'] { opacity: 1; transform: translateY(0); filter: blur(0); }

.mm-prompt-foot {
    display: flex; align-items: center;
    grid-row: 1; grid-column: 1;
    opacity: 0; pointer-events: none;
    transition: opacity 150ms ease-in-out;
}
.mm-prompt-foot[data-shown='true'] { opacity: 1; pointer-events: auto; }

.mm-check-slot { display: inline-flex; align-items: center; }
.mm-check-slot[data-phase='enter'] .mm-active-check { animation: mm-check-in 180ms var(--mm-ease-spring) both; }
.mm-check-slot[data-phase='exit'] .mm-active-check { animation: mm-fade-out 150ms ease forwards; }

.mm-panel-content { animation: mm-panel-fade 320ms var(--mm-ease-expo) both; }
.mm-cascade { animation: mm-panel-fade 320ms var(--mm-ease-expo) both; }

.mm-pill {
    height: 28px; border-radius: 100px; border: 1px solid var(--mm-btn-border);
    padding: 0 14px; font-size: 12px; font-weight: 500; cursor: pointer;
    display: inline-flex; align-items: center;
    transition: background 180ms var(--mm-ease-out), color 180ms ease, transform 160ms var(--mm-ease-out);
}
.mm-pill--ghost { background: var(--mm-btn-bg); color: var(--mm-text-secondary); }
.mm-pill--ghost:hover { background: var(--mm-btn-bg-hover); }
.mm-pill--danger { background: var(--mm-danger-bg); color: var(--mm-danger); border-color: transparent; }
.mm-pill--danger:hover { opacity: 0.85; }
.mm-pill--primary { background: var(--mm-active-blue); color: var(--mm-bg); border-color: transparent; }
.mm-pill--primary:hover { opacity: 0.9; }
.mm-pill--icon { width: 28px; padding: 0; justify-content: center; }
.mm-pill:disabled { opacity: 0.4; cursor: default; pointer-events: none; }

/* Dot-selector (tj from bundle) */
.mm-dot-row { display: inline-flex; align-items: center; justify-content: center; vertical-align: middle; }
.mm-dot-native {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
}
.mm-dot-ring {
    display: inline-block; width: 16px; height: 16px; box-sizing: border-box;
    border-radius: 999px; border: 1.5px solid var(--mm-input-border);
    background: transparent; position: relative;
    transition: transform 80ms cubic-bezier(0.23, 1, 0.32, 1); flex: 0 0 auto;
}
.mm-dot-ring::after {
    content: ''; position: absolute; left: 50%; top: 50%;
    width: 6px; height: 6px; border-radius: 999px;
    background: var(--mm-text-primary);
    transform: translate(-50%, -50%) scale(0);
    transition: transform 150ms cubic-bezier(0.22, 1, 0.36, 1);
}
.mm-dot-row:not(.mm-dot-disabled):hover .mm-dot-ring { transform: scale(1.05); }
.mm-dot-row:not(.mm-dot-disabled):active .mm-dot-ring { transform: scale(0.94); }
.mm-dot-checked .mm-dot-ring::after {
    transform: translate(-50%, -50%) scale(1);
    transition: transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
.mm-dot-row.mm-dot-disabled { opacity: 0.4; }

@media (prefers-reduced-motion: reduce) {
    .mm-mode-item, .mm-template-row, .mm-section-card, .mm-fresh-row {
        animation-name: mm-fade-only;
    }
    .mm-panel-content, .mm-cascade { animation-name: mm-fade-only; }
}
`;

// ─── Types ───────────────────────────────────────────────────────────────────
interface Mode {
  id: string;
  name: string;
  templateType: string;
  customContext: string;
  isActive: boolean;
  isBuiltin?: boolean;
  createdAt: string;
  referenceFileCount: number;
}

interface ReferenceFile {
  id: string;
  fileName: string;
  content?: string;
}

interface NoteSection {
  id: string;
  title: string;
  description?: string;
}

interface WritingSample {
  id: string;
  preview: string;
  source?: string;
}

interface WritingStyleInfo {
  sampleCount: number;
  title?: string;
  summary?: string;
}

// Default knowledge sources per template type (fL from bundle)
const DEFAULT_SOURCES: Record<string, string[]> = {
  general: ['reference_files'],
  sales: ['reference_files'],
  recruiting: ['reference_files'],
  'team-meet': ['reference_files'],
  lecture: ['reference_files'],
  seminar: ['reference_files'],
  'call-center': ['reference_files'],
  'looking-for-work': ['profile', 'job_description'],
  'technical-interview': ['profile', 'job_description'],
};

const defaultSourcesFor = (templateType: string): string[] =>
  DEFAULT_SOURCES[templateType] ?? ['reference_files'];

interface TemplateDefinition {
  type: string;
  label: string;
  description: string;
  Icon: React.FC<{ size?: number }>;
  iconBg: string;
  iconColor: string;
}

// ─── Template definitions (from bundle Fd) ───────────────────────────────────
const TEMPLATES: TemplateDefinition[] = [
  {
    type: 'sales', label: 'Sales',
    description: 'Close deals with strategic discovery and objection handling.',
    Icon: ({ size = 16 }) => <TrendingUp size={size} />,
    iconBg: 'rgba(249,115,22,0.18)', iconColor: '#f97316',
  },
  {
    type: 'recruiting', label: 'Recruiting',
    description: 'Evaluate candidates with structured interview insights.',
    Icon: ({ size = 16 }) => <UserSearch size={size} />,
    iconBg: 'rgba(168,85,247,0.18)', iconColor: '#a855f7',
  },
  {
    type: 'team-meet', label: 'Team Meet',
    description: 'Track action items and key decisions from meetings.',
    Icon: ({ size = 16 }) => <Users size={size} />,
    iconBg: 'rgba(20,184,166,0.18)', iconColor: '#14b8a6',
  },
  {
    type: 'looking-for-work', label: 'Looking for work',
    description: 'Answer interview questions with confidence and clarity.',
    Icon: ({ size = 16 }) => <Briefcase size={size} />,
    iconBg: 'rgba(59,130,246,0.18)', iconColor: '#3b82f6',
  },
  {
    type: 'lecture', label: 'Lecture',
    description: 'Capture key concepts and content from lectures.',
    Icon: ({ size = 16 }) => <BookOpen size={size} />,
    iconBg: 'rgba(168,85,247,0.18)', iconColor: '#a855f7',
  },
  {
    type: 'technical-interview', label: 'Technical Interview',
    description: 'Ace DSA, system design, and coding rounds with structured thinking.',
    Icon: ({ size = 16 }) => <Code2 size={size} />,
    iconBg: 'rgba(34,197,94,0.18)', iconColor: '#22c55e',
  },
  {
    type: 'seminar', label: 'Seminar',
    description: 'Answer from your slides, paper, or thesis — and flag anything that isn\'t in them.',
    Icon: ({ size = 16 }) => <LayoutGrid size={size} />,
    iconBg: 'rgba(236,72,153,0.18)', iconColor: '#ec4899',
  },
  {
    type: 'call-center', label: 'Call Center',
    description: 'Work support calls from issue to resolution, with escalations tracked.',
    Icon: ({ size = 16 }) => <Headphones size={size} />,
    iconBg: 'rgba(234,179,8,0.18)', iconColor: '#eab308',
  },
];

const TEMPLATE_MAP = Object.fromEntries(TEMPLATES.map(t => [t.type, t]));

// xl() from bundle — only the default General mode is "locked" (no template change, shown differently)
function isLockedGeneral(mode: Mode): boolean {
  return mode.templateType === 'general' && mode.name === 'General';
}

function contextPlaceholder(templateType: string): string {
  return ({
    general: 'Add your role, context, or anything Natively should know...',
    sales: 'Add the product, deal stage, your ICP, and common objections...',
    recruiting: 'Add the role, company, must-haves, and what good looks like...',
    'team-meet': 'Add the meeting purpose, attendees, and what to track...',
    'looking-for-work': 'Add the company, role, what you want to highlight...',
    lecture: 'Add course context, prerequisites, and what you want to capture...',
    'technical-interview': 'Add the role, company, topics to focus on, or your weak areas...',
    seminar: 'Add the talk title, audience, and the sections you expect questions on...',
    'call-center': 'Add the product, common issues, escalation paths, and policies to follow...',
  } as Record<string, string>)[templateType] ?? '';
}

function useTheme(): 'light' | 'dark' | undefined {
  const [theme, setTheme] = useState<'light' | 'dark' | undefined>(undefined);
  useEffect(() => {
    const el = document.documentElement;
    const read = () => {
      const v = el.getAttribute('data-theme');
      setTheme(v === 'light' ? 'light' : v === 'dark' ? 'dark' : undefined);
    };
    read();
    const obs = new MutationObserver(read);
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

// ─── Styles object (js from bundle) ─────────────────────────────────────────
const S: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex', height: '100%',
    background: 'var(--mm-bg)',
    borderRadius: 16, overflow: 'hidden',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif',
    color: 'var(--mm-text-primary)',
  },
  sidebar: {
    width: 240, borderRight: '1px solid var(--mm-sidebar-border)',
    display: 'flex', flexDirection: 'column', flexShrink: 0,
    background: 'var(--mm-sidebar-bg)', paddingTop: 12,
  },
  closeBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--mm-text-tertiary)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '4px 8px', marginLeft: 8, marginBottom: 4,
    borderRadius: 6, alignSelf: 'flex-start',
    transition: 'color 180ms var(--mm-ease-out), transform 140ms var(--mm-ease-out)',
  },
  modeItem: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
    userSelect: 'none', fontSize: 13, marginBottom: 2,
  },
  activeCheck: {
    width: 16, height: 16, borderRadius: '50%',
    background: 'var(--mm-active-blue)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  templatesBtn: {
    display: 'flex', alignItems: 'center', gap: 8,
    width: '100%', padding: '6px 10px',
    background: 'none', border: 'none', borderRadius: 6,
    color: 'var(--mm-text-tertiary)', fontSize: 12, fontWeight: 500,
    cursor: 'pointer', textAlign: 'left',
    transition: 'color 180ms var(--mm-ease-out), transform 140ms var(--mm-ease-out)',
  },
  rightPanel: { flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  setActiveBtn: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '0 14px', height: 28, border: 'none', borderRadius: 100,
    background: 'var(--mm-btn-bg)', color: 'var(--mm-text-secondary)',
    fontSize: 12, fontWeight: 500, cursor: 'pointer', flexShrink: 0,
    transition: 'background 250ms var(--mm-ease-out), color 250ms var(--mm-ease-out), transform 160ms var(--mm-ease-out)',
  },
  sectionLabel: {
    fontSize: 15, fontWeight: 700, color: 'var(--mm-text-hero)',
    margin: 0, marginBottom: 10,
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif',
    letterSpacing: '-0.02em', lineHeight: 1.2,
  },
  contentBox: {
    border: '1px solid var(--mm-input-border)', borderRadius: 12,
    minHeight: 76, display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'text', overflow: 'hidden', background: 'var(--mm-input-bg)',
  },
  textarea: {
    width: '100%', background: 'transparent', border: 'none', outline: 'none',
    padding: '14px 16px', fontSize: 12, color: 'var(--mm-text-primary)',
    lineHeight: 1.6, resize: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
  },
  fileRow: {
    display: 'grid',
    gridTemplateColumns: '13px 1fr auto auto auto',
    alignItems: 'center', gap: 7, padding: '8px 12px',
    background: 'var(--mm-btn-bg)', border: '1px solid var(--mm-btn-border)', borderRadius: 10,
  },
  iconBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--mm-text-tertiary)', padding: 4,
    display: 'flex', borderRadius: 4,
    transition: 'color 180ms var(--mm-ease-out), transform 140ms var(--mm-ease-out)',
  },
  saveBtn: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid var(--mm-btn-border)',
    borderRadius: 6, color: 'var(--mm-text-primary)',
    fontSize: 12, fontWeight: 500,
    padding: '4px 12px', cursor: 'pointer',
    transition: 'background 180ms var(--mm-ease-out), transform 160ms var(--mm-ease-out)',
  },
  dotsBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 28, height: 28, borderRadius: 100, border: 'none',
    background: 'var(--mm-btn-bg)', color: 'var(--mm-text-secondary)',
    cursor: 'pointer', flexShrink: 0,
    transition: 'background 180ms var(--mm-ease-out), transform 140ms var(--mm-ease-out)',
  },
  dotsDeleteBtn: {
    display: 'flex', alignItems: 'center', gap: 8,
    width: '100%', padding: '7px 12px',
    background: 'transparent', border: 'none', borderRadius: 6,
    color: 'var(--mm-danger)', fontSize: 12, fontWeight: 500,
    cursor: 'pointer', textAlign: 'left',
    transition: 'background 150ms ease',
  },
  addFileBtn: {
    display: 'flex', alignItems: 'center', gap: 6,
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--mm-text-tertiary)', fontSize: 12, padding: '6px 2px', marginTop: 2,
    transition: 'color 180ms var(--mm-ease-out), transform 140ms var(--mm-ease-out)',
  },
  addSectionBtn: {
    display: 'flex', alignItems: 'center', gap: 6,
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--mm-text-secondary)', fontSize: 12, padding: '4px 2px',
    transition: 'color 180ms var(--mm-ease-out), background 180ms ease, transform 160ms var(--mm-ease-out)',
  },
  removeTplBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--mm-text-tertiary)', fontSize: 12, padding: 0,
    transition: 'color 180ms var(--mm-ease-out), transform 140ms var(--mm-ease-out)',
  },
  autofillPlaceholder: {
    fontSize: 12, color: 'var(--mm-text-tertiary)',
    textAlign: 'center', userSelect: 'none',
  },
  uploadBtn: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 16px', borderRadius: 20,
    background: 'var(--mm-btn-bg)', border: '1px solid var(--mm-btn-border)',
    color: 'var(--mm-text-secondary)', fontSize: 12, fontWeight: 500,
    cursor: 'pointer',
    transition: 'background 180ms var(--mm-ease-out)',
  },
};

// ─── ModesDialIcon (tL from bundle) ─────────────────────────────────────────
export function ModesDialIcon({ sz = 14, color = 'currentColor' }: { sz?: number; color?: string }) {
  return (
    <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="5.2" stroke={color} strokeWidth="0.9" strokeDasharray="1.4 1.8" fill="none" opacity="0.3" />
      <circle cx="8" cy="2.8" r="1.55" fill={color} />
      <circle cx="12.5" cy="10.6" r="1.1" fill={color} opacity="0.32" />
      <circle cx="3.5" cy="10.6" r="1.1" fill={color} opacity="0.32" />
      <circle cx="8" cy="8" r="0.9" fill={color} opacity="0.18" />
    </svg>
  );
}

// ─── InlineEdit (yu from bundle) ─────────────────────────────────────────────
function InlineEdit({
  value,
  onCommit,
  style = {},
  inputStyle = {},
  disabled = false,
  autoEdit = false,
  onEditEnd,
}: {
  value: string;
  onCommit: (v: string) => void;
  style?: React.CSSProperties;
  inputStyle?: React.CSSProperties;
  disabled?: boolean;
  autoEdit?: boolean;
  onEditEnd?: () => void;
}) {
  const [editing, setEditing] = useState(autoEdit && !disabled);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => {
    if (editing && ref.current) { ref.current.focus(); ref.current.select(); }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== value) onCommit(draft.trim());
    else setDraft(value);
    onEditEnd?.();
  };

  if (editing) {
    return (
      <input
        ref={ref}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            e.preventDefault();
            setEditing(false);
            setDraft(value);
            onEditEnd?.();
          }
        }}
        style={{
          background: 'transparent', border: 'none',
          borderBottom: '1px solid var(--mm-input-border-focus)',
          outline: 'none', color: 'inherit', width: '100%',
          fontFamily: 'inherit', ...inputStyle,
        }}
      />
    );
  }

  return (
    <span
      style={{ cursor: disabled ? 'inherit' : 'text', ...style }}
      onDoubleClick={() => !disabled && setEditing(true)}
    >
      {value}
    </span>
  );
}

// ─── BannerSlot (dL from bundle) ─────────────────────────────────────────────
function BannerSlot({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div className="mm-banner-slot" data-open={open ? 'true' : undefined} style={{ padding: open ? '0 8px 0' : '0 8px' }}>
      <div>
        <div className="mm-banner">{children}</div>
      </div>
    </div>
  );
}

// ─── ActiveCheck (uL from bundle) ────────────────────────────────────────────
function ActiveCheck({ active }: { active: boolean }) {
  const [phase, setPhase] = useState<'rest' | 'enter' | 'exit' | null>(active ? 'rest' : null);
  const [prev, setPrev] = useState(active);

  if (active !== prev) {
    setPrev(active);
    setPhase(active ? 'enter' : 'exit');
  }

  useEffect(() => {
    if (phase !== 'exit') return;
    const t = setTimeout(() => setPhase(null), 150);
    return () => clearTimeout(t);
  }, [phase]);

  if (!phase) return null;

  return (
    <span className="mm-check-slot" data-phase={phase}>
      <span className="mm-active-check" style={S.activeCheck}>
        <Check size={9} strokeWidth={3} style={{ color: 'var(--mm-bg)' }} />
      </span>
    </span>
  );
}

// ─── ActivateBtn (vL from bundle) ────────────────────────────────────────────
function ActivateBtn({ isActive, onActivate, onDeactivate }: {
  isActive: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
}) {
  const [hover, setHover] = useState(false);
  const showDeactivate = isActive && hover;
  const bg = showDeactivate
    ? 'var(--mm-danger-bg)'
    : isActive || hover ? 'var(--mm-btn-bg-hover)' : 'var(--mm-btn-bg)';
  const color = showDeactivate
    ? 'var(--mm-danger)'
    : isActive ? 'var(--mm-active-blue)' : hover ? 'var(--mm-text-primary)' : 'var(--mm-text-secondary)';

  return (
    <button
      onClick={isActive ? onDeactivate : onActivate}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="mm-press"
      style={{ ...S.setActiveBtn, background: bg, color, gap: 0 }}
    >
      <span style={{
        display: 'inline-flex', alignItems: 'center', overflow: 'hidden',
        width: showDeactivate ? 0 : 18, flexShrink: 0,
        transition: 'width 250ms var(--mm-ease-out)',
      }}>
        <Check
          size={12} strokeWidth={2.5}
          style={{
            marginRight: 6, flexShrink: 0,
            transform: showDeactivate ? 'scale(0)' : 'scale(1)',
            opacity: showDeactivate ? 0 : 1,
            transition: 'transform 250ms var(--mm-ease-out), opacity 150ms ease-in-out',
          }}
        />
      </span>
      <span style={{ fontSize: 12 }}>
        {showDeactivate ? 'Deactivate' : isActive ? 'Active' : 'Set active'}
      </span>
    </button>
  );
}

// ─── DropdownMenu (iL from bundle) ───────────────────────────────────────────
function DropdownMenu({ open, children }: { open: boolean; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div style={{
      position: 'absolute', top: '100%', right: 0, zIndex: 100,
      marginTop: 4, background: 'var(--mm-sidebar-bg)',
      border: '1px solid var(--mm-btn-border)', borderRadius: 10,
      boxShadow: '0 8px 24px rgba(0,0,0,0.3)', minWidth: 140,
      overflow: 'hidden',
      animation: 'mm-pop-in 180ms var(--mm-ease-out) both',
    }}>
      {children}
    </div>
  );
}

// ─── DotSelector (tj from bundle) ────────────────────────────────────────────
function DotSelector({ checked, onChange, disabled, label }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string;
}) {
  return (
    <span className={`mm-dot-row${checked ? ' mm-dot-checked' : ''}${disabled ? ' mm-dot-disabled' : ''}`}
      onClick={() => !disabled && onChange(!checked)}
      role="checkbox" aria-checked={checked} aria-label={label} tabIndex={disabled ? -1 : 0}
      onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); !disabled && onChange(!checked); } }}
      style={{ cursor: disabled ? 'default' : 'pointer' }}
    >
      <input className="mm-dot-native" type="checkbox" checked={checked} readOnly tabIndex={-1} aria-hidden="true" />
      <span className="mm-dot-ring" aria-hidden="true" />
    </span>
  );
}

// ─── KnowledgeSource (gL from bundle) ────────────────────────────────────────
function KnowledgeSource({ modeId, templateType, contract, loading, onSave }: {
  modeId: string; templateType: string; contract: any; loading: boolean;
  onSave: (params: { allowedExplicitSwitches: string[] }) => Promise<any>;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaultSourcesFor(templateType)));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!contract || contract.origin !== 'user_selected') {
      setSelected(new Set(defaultSourcesFor(templateType)));
      return;
    }
    const switches = (contract.allowedExplicitSwitches as string[] ?? []).filter((s: string) => s !== 'transcript');
    setSelected(new Set(switches));
  }, [modeId, contract, templateType]);

  const handleToggle = async (value: string) => {
    if (saving || loading) return;
    const next = new Set(selected);
    if (next.has(value)) next.delete(value); else next.add(value);
    setSelected(next);
    setSaving(true);
    try { await onSave({ allowedExplicitSwitches: Array.from(next) }); }
    finally { setSaving(false); }
  };

  const sources = [
    { value: 'reference_files', label: 'Reference files' },
    { value: 'profile', label: 'Resume' },
    { value: 'job_description', label: 'Job description' },
  ];

  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={S.sectionLabel}>Knowledge source</h3>
      <div style={{ border: '1px solid var(--mm-input-border)', borderRadius: 12, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10, opacity: loading ? 0.6 : 1, transition: 'opacity 180ms ease' }}>
        {sources.map(src => (
          <label key={src.value} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: loading || saving ? 'default' : 'pointer' }}>
            <DotSelector checked={selected.has(src.value)} onChange={() => handleToggle(src.value)} disabled={loading || saving} label={src.label} />
            <span style={{ fontSize: 13, color: 'var(--mm-text-primary)' }}>{src.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ─── AnswerPolicyV3 (xL from bundle) ─────────────────────────────────────────
function AnswerPolicyV3({ modeId, templateType, state, onRefresh }: {
  modeId: string; templateType: string; state: any; onRefresh: () => void;
}) {
  const [saving, setSaving] = useState(false);
  if (!state?.offered) return null;

  const opts = [
    { value: 'use_references_when_relevant', label: state.labels?.use_references_when_relevant ?? 'Use references when relevant' },
    { value: 'only_answer_from_references', label: state.labels?.only_answer_from_references ?? 'Only answer from references' },
  ];

  const set = async (policy: string) => {
    if (saving || policy === state.answerPolicy) return;
    setSaving(true);
    try {
      await (window as any).electronAPI?.answerPolicySet?.({ modeId, templateType, policy });
      onRefresh();
    } finally { setSaving(false); }
  };

  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={S.sectionLabel}>Answer policy</h3>
      <div style={{ border: '1px solid var(--mm-input-border)', borderRadius: 12, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10, opacity: saving ? 0.7 : 1, transition: 'opacity 180ms ease' }}>
        {opts.map(opt => (
          <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: saving ? 'default' : 'pointer' }}>
            <DotSelector checked={state.answerPolicy === opt.value} onChange={() => set(opt.value)} disabled={saving} />
            <span style={{ fontSize: 13 }}>{opt.label}</span>
          </label>
        ))}
        {state.source === 'mode_default' && (
          <p style={{ fontSize: 11, color: 'var(--mm-text-tertiary)', margin: '4px 0 0' }}>Using this mode's default.</p>
        )}
      </div>
    </div>
  );
}

// ─── WritingStyle (yL from bundle) ───────────────────────────────────────────
const MIN_SAMPLE_LEN = 40;

function WritingStyle({ modeId }: { modeId: string }) {
  const outputs = () => (window as any).electronAPI?.meetingOutputs;
  const [style, setStyle] = useState<WritingStyleInfo | null>(null);
  const [samples, setSamples] = useState<WritingSample[]>([]);
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState<'add' | 'refresh' | null>(null);
  const [freshIds, setFreshIds] = useState<Set<string>>(() => new Set());
  const [added, setAdded] = useState(false);
  const [toast, setToast] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { addedTimer.current && clearTimeout(addedTimer.current); }, []);
  useEffect(() => {
    if (toast?.tone !== 'ok') return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    const [s, smpls] = await Promise.all([
      outputs()?.getWritingStyle(modeId).catch(() => null),
      outputs()?.listWritingSamples(modeId).catch(() => null),
    ]);
    if (s) setStyle(s);
    if (smpls) setSamples(smpls ?? []);
    return smpls as WritingSample[] | null;
  }, [modeId]);

  useEffect(() => { load(); }, [load]);

  if (!style) return null;

  const addSample = async () => {
    if (!text.trim() || busy) return;
    setBusy('add');
    setToast(null);
    const prevIds = new Set(samples.map(s => s.id));
    const result = await outputs()?.addWritingSample(modeId, text).catch(() => null);
    setBusy(null);
    if (result?.ok) {
      setText('');
      setAdded(true);
      addedTimer.current && clearTimeout(addedTimer.current);
      addedTimer.current = setTimeout(() => setAdded(false), 1400);
      const updated = await load();
      if (updated) setFreshIds(new Set(updated.filter((s: WritingSample) => !prevIds.has(s.id)).map((s: WritingSample) => s.id)));
    } else {
      setToast({ tone: 'err', text: result?.message ?? 'Something went wrong. Try again.' });
    }
  };

  const refreshStyle = async () => {
    if (busy) return;
    setBusy('refresh');
    setToast(null);
    const result = await outputs()?.refreshWritingStyle(modeId).catch(() => null);
    setBusy(null);
    if (result?.ok) setToast({ tone: 'ok', text: result.message ?? 'Your style is up to date.' });
    else setToast({ tone: 'err', text: 'Something went wrong. Try again.' });
    load();
  };

  const removeSample = async (id: string) => {
    const result = await outputs()?.removeWritingSample(modeId, id).catch(() => null);
    if (result) setStyle(result);
    load();
  };

  const placeholder = style.sampleCount > 0
    ? 'Paste another email or message you wrote yourself.'
    : 'Follow-up emails are drafted in your own voice once Natively has some of your writing. Paste a few emails you wrote, or edit a draft before you copy it.';
  const statusText = toast?.text ?? (style.sampleCount > 0 ? (style.title ?? 'Style learned at your next follow-up') : null);
  const toastColor = toast?.tone === 'err' ? 'var(--mm-danger)' : 'var(--mm-text-tertiary)';
  const canSubmit = text.trim().length >= MIN_SAMPLE_LEN && !busy;

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <h3 style={{ ...S.sectionLabel, marginBottom: 0 }}>Follow-ups in your style</h3>
        {style.sampleCount > 0 && (
          <button type="button" onClick={refreshStyle} disabled={!!busy} className="mm-press mm-pill mm-pill--ghost"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={12} style={busy === 'refresh' ? { animation: 'spin 1s linear infinite' } : undefined} />
            Update style
          </button>
        )}
      </div>
      <div style={{ border: '1px solid var(--mm-input-border)', borderRadius: 12, overflow: 'hidden', background: focused ? 'var(--mm-input-bg-focus)' : 'transparent', borderColor: focused ? 'var(--mm-input-border-focus)' : 'var(--mm-input-border)', transition: 'border-color 180ms ease, background 180ms ease' }}>
        <textarea
          value={text}
          onChange={e => { setText(e.target.value); if (toast?.tone === 'err') setToast(null); }}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          aria-label="Paste something you wrote"
          placeholder={placeholder}
          style={{ ...S.textarea, minHeight: 80, background: 'rgba(255,255,255,0.02)', resize: 'none' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderTop: '1px solid var(--mm-input-border)' }}>
          <span role="status" aria-live="polite" title={style.summary}
            style={{ flex: 1, fontSize: 12, lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: toastColor }}>
            {statusText}
          </span>
          <button type="button" onClick={addSample} disabled={!canSubmit} className={canSubmit ? 'mm-press' : undefined}
            style={{ ...S.saveBtn, flexShrink: 0, opacity: canSubmit || added || busy === 'add' ? 1 : 0.35, cursor: canSubmit ? 'pointer' : 'default' }}
            onMouseEnter={e => { if (canSubmit) e.currentTarget.style.background = 'var(--mm-btn-bg-hover)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
          >
            {busy === 'add' ? 'Adding…' : added
              ? <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Check size={11} />Added</span>
              : 'Add sample'}
          </button>
        </div>
      </div>
      {samples.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {samples.map(s => (
            <div key={s.id} className={freshIds.has(s.id) ? 'mm-fresh-row' : undefined}
              style={{ display: 'grid', gridTemplateColumns: '13px 1fr auto 20px', alignItems: 'center', gap: 7, padding: '8px 12px', background: 'var(--mm-btn-bg)', border: '1px solid var(--mm-btn-border)', borderRadius: 10 }}>
              <MessageSquare size={13} style={{ color: 'var(--mm-text-secondary)', flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: 'var(--mm-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{s.preview}</span>
              <span style={{ fontSize: 11, color: 'var(--mm-text-tertiary)', whiteSpace: 'nowrap' }}>
                {s.source === 'followup' ? 'From a follow-up you edited' : 'Pasted'}
              </span>
              <button type="button" aria-label="Remove sample" onClick={() => removeSample(s.id)} className="mm-press-soft"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mm-text-tertiary)', padding: 2, display: 'flex' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--mm-danger)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--mm-text-tertiary)')}>
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <p style={{ fontSize: 11, color: 'var(--mm-text-tertiary)', lineHeight: 1.5, margin: '8px 0 0' }}>
        Samples stay on this computer. Your AI provider reads them only to describe your style.
      </p>
    </div>
  );
}

// ─── NotesTemplatePicker (cL from bundle) ────────────────────────────────────
function NotesTemplatePicker({ currentTitles, modeDefault, onPick }: {
  currentTitles: string[];
  modeDefault: { label: string; titles: string[] } | null;
  onPick: (templateId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', esc); };
  }, [open]);

  const isActive = (titles: string[]) =>
    titles.length === currentTitles.length && titles.every((t, i) => t === currentTitles[i]);

  const pick = async (id: string, active: boolean) => {
    if (loading || active) { setOpen(false); return; }
    setLoading(id);
    try { await onPick(id); }
    finally { setLoading(null); setOpen(false); }
  };

  const templates = [{ id: 'general', label: 'General' }, ...TEMPLATES.map(t => ({ id: t.type, label: t.label }))];

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} className="mm-press mm-pill mm-pill--ghost" style={{ gap: 4 }}>
        {loading ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : null}
        Use template
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 200, marginTop: 4, background: 'var(--mm-sidebar-bg)', border: '1px solid var(--mm-btn-border)', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.3)', minWidth: 200, maxHeight: 320, overflowY: 'auto', padding: '6px', animation: 'mm-pop-in 180ms var(--mm-ease-out) both' }}>
          {modeDefault && (
            <>
              <button type="button" role="menuitemradio" aria-checked={isActive(modeDefault.titles)} onClick={() => pick('__mode_default__', isActive(modeDefault.titles))}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', padding: '7px 10px', borderRadius: 6, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', color: isActive(modeDefault.titles) ? 'var(--mm-active-blue)' : 'var(--mm-text-primary)', transition: 'background 140ms var(--mm-ease-out)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--mm-item-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ fontSize: 13, fontWeight: 500 }}>{modeDefault.label} (default)</span>
                {isActive(modeDefault.titles) && <Check size={12} />}
              </button>
              <div style={{ height: 1, background: 'var(--mm-border)', margin: '4px 0' }} />
            </>
          )}
          {templates.map(tpl => (
            <button key={tpl.id} type="button" role="menuitemradio" onClick={() => pick(tpl.id, false)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', padding: '7px 10px', borderRadius: 6, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', color: loading === tpl.id ? 'var(--mm-active-blue)' : 'var(--mm-text-primary)', transition: 'background 140ms var(--mm-ease-out)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--mm-item-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ fontSize: 13, fontWeight: 500 }}>{tpl.label}</span>
              {loading === tpl.id && <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── TemplatePicker (eL from bundle) ─────────────────────────────────────────
function TemplatePicker({ onSelect, onCreateEmpty }: {
  onSelect: (type: string) => void;
  onCreateEmpty: () => void;
}) {
  return (
    <div className="mm-panel-content" style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      padding: '28px 32px', overflowY: 'auto',
    }}>
      <h2 className="mm-template-row" style={{
        fontSize: 22, fontWeight: 700, color: 'var(--mm-text-hero)',
        margin: 0, marginBottom: 6, animationDelay: '0ms',
      }}>
        Templates
      </h2>
      <p className="mm-template-row" style={{
        fontSize: 12, color: 'var(--mm-text-secondary)',
        margin: 0, marginBottom: 24, lineHeight: 1.5, animationDelay: '20ms',
      }}>
        Get started by selecting a template or start from an empty mode.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {TEMPLATES.map(t => (
          <button
            key={t.type}
            onClick={() => onSelect(t.type)}
            className="mm-template-row mm-press"
            style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '12px 14px', borderRadius: 10,
              border: 'none', cursor: 'pointer', textAlign: 'left',
              transition: 'background 180ms var(--mm-ease-out), transform 160ms var(--mm-ease-out)',
            }}
          >
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: t.iconBg, color: t.iconColor,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <t.Icon size={16} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--mm-text-primary)' }}>{t.label}</span>
                <ChevronRight size={13} style={{ color: 'var(--mm-text-tertiary)' }} />
              </div>
              <p style={{ fontSize: 12, color: 'var(--mm-text-secondary)', margin: 0, lineHeight: 1.4 }}>
                {t.description}
              </p>
            </div>
          </button>
        ))}
      </div>
      <button
        onClick={onCreateEmpty}
        className="mm-press-soft"
        style={{
          marginTop: 16, alignSelf: 'flex-start',
          background: 'none', border: 'none',
          color: 'var(--mm-text-tertiary)', fontSize: 12, cursor: 'pointer',
          padding: '4px 0',
          transition: 'color 180ms var(--mm-ease-out), transform 140ms var(--mm-ease-out)',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = 'var(--mm-text-primary)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--mm-text-tertiary)')}
      >
        + Start from empty mode
      </button>
    </div>
  );
}

// ─── NoteSection form (jL from bundle) ──────────────────────────────────────
function NewSectionForm({ onConfirm, onCancel }: {
  onConfirm: (title: string, desc: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const esc = (e: React.KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } };

  return (
    <div className="mm-section-card" style={{
      border: '1px solid var(--mm-card-border)', borderRadius: 12,
      padding: '16px 20px', background: 'transparent', marginBottom: 8,
    }}>
      <input
        ref={ref}
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onConfirm(title, desc); } else esc(e); }}
        placeholder="Section title"
        style={{
          display: 'block', width: '100%', background: 'transparent',
          border: 'none', outline: 'none', fontSize: 15, fontWeight: 700,
          color: 'var(--mm-text-hero)', fontFamily: 'inherit', marginBottom: 6, padding: 0,
        }}
      />
      <input
        value={desc}
        onChange={e => setDesc(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onConfirm(title, desc); } else esc(e); }}
        placeholder="Instructions for Natively"
        style={{
          display: 'block', width: '100%', background: 'transparent',
          border: 'none', outline: 'none', fontSize: 12,
          color: 'var(--mm-text-secondary)', fontFamily: 'inherit', padding: 0,
        }}
      />
    </div>
  );
}

// ─── NoteSection card (kL from bundle) ──────────────────────────────────────
function SectionCard({ section, fresh, onUpdateTitle, onUpdateDesc, onDelete }: {
  section: NoteSection;
  fresh?: boolean;
  onUpdateTitle: (id: string, v: string) => void;
  onUpdateDesc: (id: string, v: string) => void;
  onDelete: (id: string) => void;
}) {
  const [hover, setHover] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className="mm-section-card"
      style={{
        border: `1px solid ${hover ? 'var(--mm-card-border-hover)' : 'var(--mm-card-border)'}`,
        borderRadius: 12, padding: '16px 20px',
        background: hover ? 'var(--mm-card-bg-hover)' : 'transparent',
        position: 'relative',
        transition: 'border-color 200ms var(--mm-ease-out), background 200ms var(--mm-ease-out)',
        ...(fresh ? { animationDelay: '0ms' } : {}),
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <InlineEdit
            value={section.title}
            onCommit={v => onUpdateTitle(section.id, v)}
            style={{ fontSize: 15, fontWeight: 700, color: 'var(--mm-text-hero)', display: 'block', lineHeight: 1.3, marginBottom: 5 }}
            inputStyle={{ fontSize: 15, fontWeight: 700 }}
          />
          <InlineEdit
            value={section.description || 'Click to add description'}
            onCommit={v => onUpdateDesc(section.id, v)}
            style={{ fontSize: 12, color: 'var(--mm-text-secondary)', lineHeight: 1.5, display: 'block' }}
            inputStyle={{ fontSize: 13 }}
          />
        </div>
        <button
          onClick={() => onDelete(section.id)}
          className="mm-press-soft"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--mm-text-tertiary)', padding: 2, display: 'flex', flexShrink: 0,
            opacity: hover ? 1 : 0, pointerEvents: hover ? 'auto' : 'none',
            transition: 'opacity 180ms ease, color 180ms ease',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--mm-danger)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--mm-text-tertiary)')}
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}

// KnowledgeSource and AnswerPolicyV3 are defined above (gL/xL from bundle)

// ─── ProGate (rL from bundle — shown when !isPremium && !isTrialActive) ──────
function ProGate({ onOpenNativelyAPI, onClose }: {
  onOpenNativelyAPI?: () => void;
  onClose?: () => void;
}) {
  useEffect(() => {
    (window as any).electronAPI?.funnelTrack?.('paywall_hit', { feature: 'modes' })?.catch?.(() => {});
  }, []);

  return (
    <div style={{
      position: 'relative', display: 'flex', flexDirection: 'column',
      height: '100%', background: 'var(--mm-bg)', overflow: 'hidden',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '16px 20px', flexShrink: 0 }}>
        {onClose && (
          <button onClick={onClose} style={{ ...S.dotsBtn, background: 'none' }}>
            <X size={14} strokeWidth={2.5} />
          </button>
        )}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 32px' }}>
        <div style={{ textAlign: 'center', marginBottom: 36, maxWidth: 380 }}>
          <h1 style={{ margin: '0 0 10px', fontSize: 34, fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1.1, color: 'var(--mm-text-hero)' }}>
            Every conversation.<br />A different expert.
          </h1>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.4, color: 'var(--mm-text-secondary)', letterSpacing: '-0.01em' }}>
            Six dedicated AI modes tuned for the exact room you're in. Designed for professionals.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          {TEMPLATES.slice(0, 6).map(t => (
            <div key={t.type} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 14px', borderRadius: 20,
              background: t.iconBg, border: `1px solid ${t.iconColor}33`,
            }}>
              <span style={{ color: t.iconColor, display: 'flex' }}><t.Icon size={14} /></span>
              <span style={{ fontSize: 12, fontWeight: 500, color: t.iconColor }}>{t.label}</span>
            </div>
          ))}
        </div>
        {onOpenNativelyAPI && (
          <button
            onClick={onOpenNativelyAPI}
            className="mm-press"
            style={{
              marginTop: 32, padding: '0 28px', height: 44, borderRadius: 22,
              background: 'var(--mm-active-blue)', border: 'none',
              color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            Unlock Modes
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main component (wL from bundle) ─────────────────────────────────────────
export default function ModesSettings({
  onClose,
  isPremium = false,
  isLoaded = false,
  isTrialActive = false,
  onOpenNativelyAPI,
}: {
  onClose?: () => void;
  isPremium?: boolean;
  isLoaded?: boolean;
  isTrialActive?: boolean;
  onOpenNativelyAPI?: () => void;
}) {
  const api = () => (window as any).electronAPI;
  const theme = useTheme();

  const [modes, setModes] = useState<Mode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const [loaded, setLoaded] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [context, setContext] = useState('');
  const [contextSaved, setContextSaved] = useState(true);
  const [contextFocused, setContextFocused] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  const pendingSwitchRef = useRef(pendingSwitch);
  pendingSwitchRef.current = pendingSwitch;

  const [saveFailed, setSaveFailed] = useState(false);
  const [savePulsing, setSavePulsing] = useState(false);
  const savePulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [savePulseKey, setSavePulseKey] = useState(0);

  const [refFiles, setRefFiles] = useState<ReferenceFile[]>([]);
  const [fileStatuses, setFileStatuses] = useState<Record<string, string>>({});
  const [freshFiles, setFreshFiles] = useState<Set<string>>(() => new Set());
  const [uploading, setUploading] = useState(false);

  // Source contract + answer policy (gL/xL from bundle)
  const [sourceContract, setSourceContract] = useState<any>(null);
  const [sourceContractLoading, setSourceContractLoading] = useState(false);
  const [answerPolicyState, setAnswerPolicyState] = useState<any>(null);

  const [noteSections, setNoteSections] = useState<NoteSection[]>([]);
  const [freshSections, setFreshSections] = useState<Set<string>>(() => new Set());
  const [addingSection, setAddingSection] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [notesPanelAnim, setNotesPanelAnim] = useState(0);
  const [defaultNoteSections, setDefaultNoteSections] = useState<Array<{ title: string; description: string }>>([]);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const [dotsOpen, setDotsOpen] = useState(false);
  const dotsRef = useRef<HTMLDivElement>(null);

  const [autoEditId, setAutoEditId] = useState<string | null>(null);

  // Sidebar selection indicator state
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const [indicator, setIndicator] = useState({ top: 0, height: 0, visible: false, ready: false });
  const listRef = useRef<HTMLDivElement>(null);

  const setError = (msg: string | null) => {
    setErrorMsg(msg);
    if (msg) setLastError(msg);
  };

  // ── Load modes ──────────────────────────────────────────────────────────────
  const loadModes = useCallback(async () => {
    try {
      const all: Mode[] = (await api()?.modesGetAll?.()) ?? [];
      setModes(all);
      setSelectedId(prev => {
        if (prev && all.find(m => m.id === prev)) return prev;
        return all.find(m => m.isActive)?.id ?? all[0]?.id ?? null;
      });
    } catch (err: any) {
      console.error('[ModesSettings] loadModes failed:', err);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { void loadModes(); }, [loadModes]);

  useEffect(() => {
    const unsub = api()?.onModesActiveCleared?.(() => loadModes());
    return () => unsub?.();
  }, [loadModes]);

  // ── Sync context when selected mode changes ─────────────────────────────────
  useEffect(() => {
    if (!selectedId) return;
    const m = modes.find(x => x.id === selectedId);
    if (m) { setContext(m.customContext ?? ''); setContextSaved(true); setSaveFailed(false); }
  }, [selectedId, modes]);

  // ── Load source contract per mode ─────────────────────────────────────────
  useEffect(() => {
    if (!selectedId) { setSourceContract(null); return; }
    let cancelled = false;
    setSourceContractLoading(true);
    api()?.modesGetSourceContract?.(selectedId)
      .then((c: any) => { if (!cancelled) setSourceContract(c ?? null); })
      .catch(() => { if (!cancelled) setSourceContract(null); })
      .finally(() => { if (!cancelled) setSourceContractLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  // ── Load answer policy per mode ───────────────────────────────────────────
  const loadAnswerPolicy = useCallback((mId: string, tpl: string) => {
    api()?.answerPolicyGet?.({ modeId: mId, templateType: tpl })
      .then((s: any) => setAnswerPolicyState(s ?? null))
      .catch(() => setAnswerPolicyState(null));
  }, []);

  useEffect(() => {
    const m = modes.find(x => x.id === selectedId);
    if (!m) { setAnswerPolicyState(null); return; }
    loadAnswerPolicy(m.id, m.templateType);
  }, [selectedId, modes, loadAnswerPolicy]);

  // ── Load ref files + note sections + defaults when mode changes ───────────
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    Promise.all([
      api()?.modesGetReferenceFiles?.(selectedId),
      api()?.modesGetNoteSections?.(selectedId),
      api()?.modesGetDefaultNoteSections?.(selectedId),
    ]).then(([files, sections, defaults]) => {
      if (cancelled) return;
      setRefFiles(files ?? []);
      setNoteSections(sections ?? []);
      setDefaultNoteSections(Array.isArray(defaults) ? defaults : []);
    }).catch(err => {
      if (!cancelled) console.error('[ModesSettings] panel load failed:', err);
    });
    return () => { cancelled = true; };
  }, [selectedId]);

  // ── File status realtime via IPC event ────────────────────────────────────
  const refreshFileStatus = useCallback(async (mId: string) => {
    try {
      const result = await api()?.modesGetReferenceFileStatus?.(mId);
      if (result?.success && result.statuses) {
        const map = Object.fromEntries(result.statuses.map((s: any) => [s.fileId, s.status]));
        setFileStatuses(prev => ({ ...prev, ...map }));
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    void refreshFileStatus(selectedId);
    const unsub = api()?.onModeFileIndexStatus?.((data: any) => {
      if (data.modeId !== selectedIdRef.current) return;
      if (data.phase === 'indexing' && data.fileId) {
        setFileStatuses(prev => ({ ...prev, [data.fileId]: 'indexing' }));
      } else {
        void refreshFileStatus(selectedIdRef.current!);
      }
    });
    return () => unsub?.();
  }, [selectedId, refreshFileStatus]);

  // ── Close dots on outside click ─────────────────────────────────────────────
  useEffect(() => {
    if (!dotsOpen) return;
    const handler = (e: MouseEvent) => {
      if (dotsRef.current && !dotsRef.current.contains(e.target as Node)) setDotsOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setDotsOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', esc); };
  }, [dotsOpen]);

  // ── Sidebar indicator ───────────────────────────────────────────────────────
  useLayoutEffect(() => {
    if (showTemplates || !selectedId) {
      setIndicator(p => ({ ...p, visible: false }));
      return;
    }
    const el = rowRefs.current.get(selectedId);
    if (!el) { setIndicator(p => ({ ...p, visible: false })); return; }
    setIndicator(p => ({
      top: el.offsetTop,
      height: el.offsetHeight,
      visible: true,
      ready: p.ready || p.visible,
    }));
  }, [selectedId, showTemplates, modes]);

  const mode = modes.find(m => m.id === selectedId) ?? null;
  const isAllowed = isPremium || isTrialActive;
  const firstTabId = modes[0]?.id;

  // ── Navigate sidebar with keyboard ─────────────────────────────────────────
  const handleKeyNav = (e: React.KeyboardEvent, id: string) => {
    if (e.target !== e.currentTarget) return;
    const ids = modes.map(m => m.id);
    const idx = ids.indexOf(id);
    let next: string | undefined;
    if (e.key === 'ArrowDown') next = ids[(idx + 1) % ids.length];
    else if (e.key === 'ArrowUp') next = ids[(idx - 1 + ids.length) % ids.length];
    else if (e.key === 'Home') next = ids[0];
    else if (e.key === 'End') next = ids[ids.length - 1];
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectMode(id); return; }
    else return;
    e.preventDefault();
    if (next) rowRefs.current.get(next)?.focus();
  };

  // ── Unsaved-changes guard ───────────────────────────────────────────────────
  const selectMode = (id: string) => {
    if (!contextSaved && selectedId !== id) {
      setPendingSwitch(id);
      return;
    }
    setShowTemplates(false);
    setSelectedId(id);
    setDotsOpen(false);
    setError(null);
    setSaveFailed(false);
  };

  const discardAndSwitch = () => {
    const target = pendingSwitchRef.current;
    setPendingSwitch(null);
    setContextSaved(true);
    if (target && target !== '__templates__' && target !== '__new__') {
      setSelectedId(target);
      setShowTemplates(false);
    } else if (target === '__templates__') {
      setShowTemplates(true);
      setSelectedId(null);
    } else if (target === '__new__') {
      void createEmpty();
    }
    setError(null);
    setSaveFailed(false);
  };

  // ── Save context ────────────────────────────────────────────────────────────
  const saveContext = async (): Promise<boolean> => {
    if (!selectedId) return false;
    try {
      await api()?.modesUpdate?.(selectedId, { customContext: context });
      setContextSaved(true);
      setSaveFailed(false);
      setSavePulsing(true);
      setSavePulseKey(k => k + 1);
      savePulseTimer.current && clearTimeout(savePulseTimer.current);
      savePulseTimer.current = setTimeout(() => setSavePulsing(false), 1400);
      setError(null);
      await loadModes();
      return true;
    } catch (err: any) {
      console.error('[ModesSettings] saveContext failed:', err);
      setSaveFailed(true);
      return false;
    }
  };
  useEffect(() => () => { savePulseTimer.current && clearTimeout(savePulseTimer.current); }, []);

  const saveAndSwitch = async () => {
    const ok = await saveContext();
    if (!ok) { setPendingSwitch(pendingSwitchRef.current); return; }
    discardAndSwitch();
  };

  // ── Create modes ────────────────────────────────────────────────────────────
  const createFromTemplate = async (type: string) => {
    try {
      const tpl = TEMPLATES.find(t => t.type === type);
      const name = tpl?.label ?? 'New Mode';
      const result = await api()?.modesCreate?.({ name, templateType: type });
      if (result?.success && result.mode) {
        setFreshFiles(s => new Set(s).add(result.mode.id));
        await loadModes();
        setSelectedId(result.mode.id);
        setShowTemplates(false);
        setError(null);
      }
    } catch (err: any) {
      console.error('[ModesSettings] createMode failed:', err);
      setError('Failed to create mode.');
    }
  };

  const createEmpty = async () => {
    try {
      const result = await api()?.modesCreate?.({ name: 'Untitled Mode', templateType: 'general' });
      if (result?.success && result.mode) {
        setAutoEditId(result.mode.id);
        setFreshFiles(s => new Set(s).add(result.mode.id));
        await loadModes();
        setSelectedId(result.mode.id);
        setShowTemplates(false);
        setError(null);
      }
    } catch (err: any) {
      console.error('[ModesSettings] createEmptyMode failed:', err);
      setError('Failed to create mode.');
    }
  };

  // ── Rename ──────────────────────────────────────────────────────────────────
  const renameMode = async (id: string, name: string) => {
    try {
      await api()?.modesUpdate?.(id, { name });
      setModes(prev => prev.map(m => m.id === id ? { ...m, name } : m));
    } catch (err: any) {
      console.error('[ModesSettings] renameMode failed:', err);
      setError('Failed to rename mode.');
      void loadModes();
    }
  };

  // ── Delete ──────────────────────────────────────────────────────────────────
  const deleteMode = async (id: string) => {
    const remaining = modes.filter(m => m.id !== id);
    setModes(remaining);
    if (selectedId === id) setSelectedId(remaining[0]?.id ?? null);
    try {
      await api()?.modesDelete?.(id);
    } catch (err: any) {
      console.error('[ModesSettings] deleteMode failed:', err);
      setError('Failed to delete mode.');
      void loadModes();
    }
  };

  // ── Activate ────────────────────────────────────────────────────────────────
  const activateMode = async (id: string) => {
    setModes(prev => prev.map(m => ({ ...m, isActive: m.id === id })));
    try {
      const result = await api()?.modesSetActive?.(id);
      if (result && result.success === false) {
        console.warn('[ModesSettings] setActive rejected:', result.error);
        setError(result.error === 'pro_required'
          ? 'Activating this mode requires Natively Pro — the previous mode is still active.'
          : 'Failed to activate mode — the previous mode is still active.');
        void loadModes();
      }
    } catch (err: any) {
      console.error('[ModesSettings] setActive failed:', err);
      setError('Failed to activate mode.');
      void loadModes();
    }
  };

  const deactivateMode = async () => {
    setModes(prev => prev.map(m => ({ ...m, isActive: false })));
    try {
      await api()?.modesSetActive?.(null);
    } catch (err: any) {
      console.error('[ModesSettings] deactivateMode failed:', err);
      setError('Failed to deactivate mode.');
      void loadModes();
    }
  };

  // ── Reference files ─────────────────────────────────────────────────────────
  const uploadFile = async () => {
    if (!selectedId || uploading) return;
    setUploading(true);
    try {
      const result = await api()?.modesUploadReferenceFile?.(selectedId);
      if (result?.success && result.file) {
        setRefFiles(prev => [...prev, result.file]);
        setFreshFiles(s => new Set(s).add(result.file.id));
        setModes(prev => prev.map(m => m.id === selectedId
          ? { ...m, referenceFileCount: m.referenceFileCount + 1 } : m));
        setError(null);
        setFileStatuses(p => ({ ...p, [result.file.id]: 'pending' }));
      } else if (result && !result.cancelled) {
        setError(result.error === 'pro_required'
          ? 'Reference files require Pro.'
          : result.error ? `Failed to upload file: ${result.error}` : 'Failed to upload file.');
      }
    } catch (err: any) {
      console.error('[ModesSettings] uploadFile failed:', err);
      setError(err?.message ? `Failed to upload file: ${err.message}` : 'Failed to upload file.');
    } finally {
      setUploading(false);
    }
  };

  const deleteFile = async (fileId: string) => {
    setRefFiles(prev => prev.filter(f => f.id !== fileId));
    setModes(prev => prev.map(m => m.id === selectedId
      ? { ...m, referenceFileCount: Math.max(0, m.referenceFileCount - 1) } : m));
    try {
      await api()?.modesDeleteReferenceFile?.(fileId);
    } catch (err: any) {
      console.error('[ModesSettings] deleteFile failed:', err);
      setError('Failed to delete file.');
      void loadModes();
    }
  };

  // ── Notes sections ──────────────────────────────────────────────────────────
  const addSection = async (title: string, desc: string) => {
    if (!selectedId || !title.trim()) { setAddingSection(false); return; }
    const result = await api()?.modesAddNoteSection?.(selectedId, title.trim(), desc.trim());
    if (result?.success && result.section) {
      setNoteSections(prev => [...prev, result.section]);
      setFreshSections(s => new Set(s).add(result.section.id));
    }
    setAddingSection(false);
  };

  const updateSectionTitle = async (id: string, title: string) => {
    setNoteSections(prev => prev.map(s => s.id === id ? { ...s, title } : s));
    try {
      await api()?.modesUpdateNoteSection?.(id, { title });
    } catch (err: any) {
      console.error('[ModesSettings] updateSectionTitle failed:', err);
      setError('Failed to update section.');
    }
  };

  const updateSectionDesc = async (id: string, description: string) => {
    setNoteSections(prev => prev.map(s => s.id === id ? { ...s, description } : s));
    try {
      await api()?.modesUpdateNoteSection?.(id, { description });
    } catch (err: any) {
      console.error('[ModesSettings] updateSectionDesc failed:', err);
      setError('Failed to update section.');
    }
  };

  const deleteSection = async (id: string) => {
    setNoteSections(prev => prev.filter(s => s.id !== id));
    try {
      await api()?.modesDeleteNoteSection?.(id);
    } catch (err: any) {
      console.error('[ModesSettings] deleteSection failed:', err);
      setError('Failed to delete section.');
    }
  };

  const removeNotesTemplate = async () => {
    if (!selectedId) return;
    setNoteSections([]); setNotesPanelAnim(k => k + 1);
    try {
      await api()?.modesRemoveAllNoteSections?.(selectedId);
    } catch (err: any) {
      console.error('[ModesSettings] removeNotesTemplate failed:', err);
      setError('Failed to remove template.');
      void loadModes();
    }
  };

  // ── Save knowledge source contract ────────────────────────────────────────
  const saveSourceContract = async ({ allowedExplicitSwitches }: { allowedExplicitSwitches: string[] }) => {
    if (!mode) return { success: false };
    const built = await api()?.modesBuildUserSourceContract?.({ modeId: mode.id, templateType: mode.templateType, switches: allowedExplicitSwitches });
    if (!built) return { success: false };
    const result = await api()?.modesUpdate?.(mode.id, { sourceContract: built });
    if (result?.success) {
      const fresh = await api()?.modesGetSourceContract?.(mode.id);
      setSourceContract(fresh ?? null);
    }
    return result ?? { success: false };
  };

  // ── Apply notes template ──────────────────────────────────────────────────
  const applyNoteTemplate = async (templateId: string) => {
    if (!selectedId || applyingTemplate) return;
    const id = selectedId;
    setApplyingTemplate(true);
    try {
      const result = await api()?.modesApplyNoteTemplate?.(id, templateId);
      if (selectedIdRef.current !== id) return;
      if (result?.success && Array.isArray(result.sections)) {
        setFreshSections(new Set());
        setNoteSections(result.sections);
        setNotesPanelAnim(k => k + 1);
      } else {
        setError(result?.error === 'pro_required'
          ? 'Note templates need Natively Pro.'
          : "Couldn't use that template. Try again.");
      }
    } catch (err: any) {
      setError("Couldn't use that template. Try again.");
    } finally {
      setApplyingTemplate(false);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  if (!isAllowed) {
    return (
      <div className="modes-manager-root" data-theme={theme} style={{ height: '100%' }}>
        <style>{CSS}</style>
        {isLoaded
          ? <ProGate onOpenNativelyAPI={onOpenNativelyAPI} onClose={onClose} />
          : <div aria-busy="true" style={{ height: '100%' }} />
        }
      </div>
    );
  }

  return (
    <div className="modes-manager-root" data-theme={theme}
      style={S.root}
      aria-busy={!loaded || uploading}
    >
      <style>{CSS}</style>

      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <div style={S.sidebar}>
        {onClose && (
          <button
            onClick={onClose}
            className="mm-press-soft"
            style={S.closeBtn}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--mm-text-primary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--mm-text-tertiary)')}
            title="Close"
          >
            <X size={15} />
          </button>
        )}

        <div style={{ padding: '8px 20px 12px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: 'var(--mm-text-hero)', margin: 0, letterSpacing: '0.01em', textTransform: 'uppercase' }}>
            Modes Manager
          </h2>
        </div>

        <div style={{ padding: '8px 12px 10px' }}>
          <button
            onClick={() => {
              if (!contextSaved) { setPendingSwitch('__new__'); return; }
              void createEmpty();
            }}
            className="mm-press"
            style={{
              display: 'flex', alignItems: 'center', gap: 6, width: '100%',
              padding: '7px 12px', borderRadius: 8,
              background: 'var(--mm-btn-bg)', border: '1px solid var(--mm-btn-border)',
              color: 'var(--mm-text-secondary)', fontSize: 12, fontWeight: 500,
              cursor: 'pointer', justifyContent: 'center',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--mm-btn-bg-hover)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--mm-btn-bg)'; }}
          >
            <Plus size={13} />
            New Mode
          </button>
        </div>

        <div
          ref={listRef}
          role="tablist"
          aria-orientation="vertical"
          aria-label="Modes"
          style={{ flex: 1, overflowY: 'auto', padding: '2px 8px', position: 'relative' }}
        >
          <div
            aria-hidden="true"
            className="mm-sel-indicator"
            data-instant={!indicator.ready ? 'true' : undefined}
            style={{ transform: `translateY(${indicator.top}px)`, height: indicator.height, opacity: indicator.visible ? 1 : 0 }}
          />

          {modes.map(m => {
            const selected = m.id === selectedId && !showTemplates;
            return (
              <div
                key={m.id}
                ref={el => { el ? rowRefs.current.set(m.id, el) : rowRefs.current.delete(m.id); }}
                role="tab"
                aria-selected={selected}
                tabIndex={m.id === firstTabId ? 0 : -1}
                className="mm-mode-item mm-press"
                onClick={() => selectMode(m.id)}
                onKeyDown={e => handleKeyNav(e, m.id)}
                style={{
                  ...S.modeItem, position: 'relative', zIndex: 1,
                  color: selected ? 'var(--mm-text-primary)' : 'var(--mm-text-secondary)',
                  ...(freshFiles.has(m.id) ? { animationDelay: '0ms' } : {}),
                }}
              >
                <FileText
                  size={15}
                  style={{ flexShrink: 0, color: 'var(--mm-text-secondary)', fill: 'var(--mm-text-secondary)', fillOpacity: 0.2 }}
                />
                <InlineEdit
                  value={m.name}
                  onCommit={v => renameMode(m.id, v)}
                  disabled={isLockedGeneral(m)}
                  autoEdit={autoEditId === m.id}
                  onEditEnd={() => setAutoEditId(null)}
                  style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 500, cursor: isLockedGeneral(m) ? 'inherit' : 'text' }}
                  inputStyle={{ fontSize: 13, fontWeight: 500 }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  {m.referenceFileCount > 0 && (
                    <span
                      title={`${m.referenceFileCount} reference file${m.referenceFileCount > 1 ? 's' : ''}`}
                      style={{ fontSize: 10, fontWeight: 600, color: 'var(--mm-text-tertiary)', background: 'var(--mm-btn-bg)', borderRadius: 10, padding: '1px 5px', lineHeight: 1.6, display: 'flex', alignItems: 'center', gap: 3 }}
                    >
                      <Paperclip size={9} />
                      {m.referenceFileCount}
                    </span>
                  )}
                  <ActiveCheck active={m.isActive} />
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ borderTop: '1px solid var(--mm-border)', padding: '10px 8px' }}>
          <button
            onClick={() => {
              if (!contextSaved) { setPendingSwitch('__templates__'); return; }
              setShowTemplates(true);
              setSelectedId(null);
            }}
            className="mm-press-soft"
            style={S.templatesBtn}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--mm-text-secondary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--mm-text-tertiary)')}
          >
            <svg width="15" height="15" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, display: 'block' }}>
              <rect x="1" y="1" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.9" />
              <rect x="7.5" y="1" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.9" />
              <rect x="1" y="7.5" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.9" />
              <rect x="7.5" y="7.5" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.35" />
            </svg>
            <span style={{ fontSize: 13, fontWeight: 500 }}>Natively Templates</span>
          </button>
        </div>
      </div>

      {/* ── Right panel ─────────────────────────────────────────────── */}
      <div style={S.rightPanel}>
        {/* Error banner */}
        <BannerSlot open={!!errorMsg}>
          <div style={{
            padding: '6px 6px 6px 16px',
            background: 'var(--mm-btn-bg)', border: '1px solid var(--mm-btn-border)',
            borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          }}>
            <span style={{ fontSize: 12, color: 'var(--mm-danger)', lineHeight: 1.4 }}>
              {errorMsg ?? lastError}
            </span>
            <button
              onClick={() => setError(null)}
              className="mm-press mm-pill mm-pill--ghost mm-pill--icon"
              aria-label="Dismiss"
            >
              <X size={13} />
            </button>
          </div>
        </BannerSlot>

        {showTemplates || !mode ? (
          <TemplatePicker key="templates" onSelect={createFromTemplate} onCreateEmpty={createEmpty} />
        ) : (
          <div
            key={mode.id}
            className="mm-cascade"
            style={{ padding: '28px 32px', overflowX: 'hidden', overflowY: 'auto', height: '100%', boxSizing: 'border-box' }}
          >
            {/* Title row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
              <div style={{ minWidth: 0, flex: 1 }} key={`title-${mode.id}`}>
                <InlineEdit
                  value={mode.name}
                  onCommit={v => renameMode(mode.id, v)}
                  autoEdit={autoEditId === mode.id}
                  onEditEnd={() => setAutoEditId(null)}
                  disabled={isLockedGeneral(mode)}
                  style={{
                    fontSize: 28, fontWeight: 700, color: 'var(--mm-text-hero)',
                    lineHeight: 1.1, display: 'block',
                    cursor: isLockedGeneral(mode) ? 'inherit' : 'text',
                  }}
                  inputStyle={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1, color: 'var(--mm-text-hero)', width: '100%' }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <ActivateBtn
                  isActive={mode.isActive}
                  onActivate={() => activateMode(mode.id)}
                  onDeactivate={deactivateMode}
                />
                {modes.length > 1 && !isLockedGeneral(mode) && (
                  <div ref={dotsRef} style={{ position: 'relative' }}>
                    <button
                      onClick={() => setDotsOpen(d => !d)}
                      className="mm-press-soft"
                      style={{ ...S.dotsBtn, background: dotsOpen ? 'var(--mm-btn-bg-hover)' : 'var(--mm-btn-bg)' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--mm-btn-bg-hover)')}
                      onMouseLeave={e => { if (!dotsOpen) e.currentTarget.style.background = 'var(--mm-btn-bg)'; }}
                    >
                      <span style={{ letterSpacing: 1, fontSize: 14 }}>•••</span>
                    </button>
                    <DropdownMenu open={dotsOpen}>
                      <button
                        onClick={() => { setDotsOpen(false); void deleteMode(mode.id); }}
                        className="mm-press"
                        style={S.dotsDeleteBtn}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--mm-danger-bg)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <Trash2 size={14} style={{ color: 'var(--mm-danger)', flexShrink: 0 }} />
                        <span>Delete Mode</span>
                      </button>
                    </DropdownMenu>
                  </div>
                )}
              </div>
            </div>

            {/* Real-time prompt */}
            <div style={{ marginBottom: 24 }}>
              <h3 style={S.sectionLabel}>Real-time prompt</h3>
              <div
                className="mm-input-box"
                style={{
                  ...S.contentBox,
                  display: 'flex', flexDirection: 'column', padding: 0, minHeight: 200,
                  background: contextFocused ? 'var(--mm-input-bg-focus)' : 'transparent',
                  borderColor: pendingSwitch ? 'var(--mm-pending-border)' : contextFocused ? 'var(--mm-input-border-focus)' : 'var(--mm-input-border)',
                }}
                key={`prompt-${mode.id}`}
              >
                <textarea
                  value={context}
                  maxLength={8000}
                  onChange={e => { setContext(e.target.value); setContextSaved(false); setSaveFailed(false); }}
                  onFocus={() => { setContextFocused(true); setPendingSwitch(null); }}
                  onBlur={() => setContextFocused(false)}
                  placeholder={contextPlaceholder(mode.templateType)}
                  style={{ ...S.textarea, flex: 1, minHeight: 120, background: 'rgba(255,255,255,0.02)' }}
                />
                <div style={{ display: 'grid', alignItems: 'center', padding: '10px 12px', borderTop: '1px solid var(--mm-input-border)', width: '100%', boxSizing: 'border-box' }}>
                  {/* Normal save row */}
                  <div
                    className="mm-prompt-foot"
                    data-shown={pendingSwitch ? undefined : 'true'}
                    style={{ justifyContent: 'flex-end', gap: 8 }}
                  >
                    <span
                      role="status" aria-live="polite"
                      className="mm-save-fail"
                      data-shown={saveFailed ? 'true' : undefined}
                      style={{ flex: 1, minWidth: 0, paddingLeft: 4, fontSize: 12, color: 'var(--mm-danger)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                    >
                      {saveFailed ? 'Failed to save prompt. Please try again.' : ''}
                    </span>
                    <button
                      key={`save-${savePulseKey}`}
                      onClick={saveContext}
                      disabled={contextSaved}
                      className={contextSaved ? undefined : 'mm-press mm-save-pulse'}
                      style={{ ...S.saveBtn, opacity: contextSaved && !savePulsing ? 0.35 : 1, cursor: contextSaved ? 'default' : 'pointer' }}
                      onMouseEnter={e => { if (!contextSaved) e.currentTarget.style.background = 'var(--mm-btn-bg-hover)'; }}
                      onMouseLeave={e => { if (!contextSaved) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                    >
                      {savePulsing ? (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Check size={11} />Saved
                        </span>
                      ) : 'Save'}
                    </button>
                  </div>
                  {/* Unsaved-changes row */}
                  <div
                    className="mm-prompt-foot"
                    data-shown={pendingSwitch ? 'true' : undefined}
                    role="group" aria-label="Unsaved changes"
                    style={{ gap: 8, paddingLeft: 4 }}
                  >
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--mm-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {pendingSwitch === '__templates__' || pendingSwitch === '__new__'
                        ? 'Save changes before leaving?' : 'Save changes before switching?'}
                    </span>
                    <button onClick={() => setPendingSwitch(null)} className="mm-press mm-pill mm-pill--ghost">Keep editing</button>
                    <button onClick={discardAndSwitch} className="mm-press mm-pill mm-pill--danger">Discard</button>
                    <button onClick={saveAndSwitch} className="mm-press mm-pill mm-pill--primary">
                      {pendingSwitch === '__templates__' || pendingSwitch === '__new__' ? 'Save & leave' : 'Save & switch'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Template type dropdown (non-locked modes only) */}
              {!mode.isBuiltin && (
                <p key={`subtitle-${mode.id}`} style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--mm-text-tertiary)', lineHeight: 1.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>Powered by Natively's built-in</span>
                  {isLockedGeneral(mode) ? <span>General</span> : (
                    <select
                      value={mode.templateType}
                      onChange={async e => {
                        const type = e.target.value;
                        try {
                          const result = await api()?.modesUpdate?.(mode.id, { templateType: type });
                          if (result?.success) {
                            setModes(prev => prev.map(m => m.id === mode.id ? { ...m, templateType: type } : m));
                          }
                        } catch (err) { console.error('[ModesSettings] template change failed:', err); }
                      }}
                      style={{ background: 'transparent', border: 'none', borderBottom: '1px solid var(--mm-input-border)', color: 'var(--mm-text-tertiary)', fontSize: 11, cursor: 'pointer', outline: 'none', fontFamily: 'inherit' }}
                    >
                      <option value="general" style={{ background: '#1c1c1e' }}>General</option>
                      {TEMPLATES.map(t => <option key={t.type} value={t.type} style={{ background: '#1c1c1e' }}>{t.label}</option>)}
                    </select>
                  )}
                  <span>intelligence.</span>
                </p>
              )}
            </div>

            {/* Knowledge source (gL) or answer policy v3 (xL) */}
            {answerPolicyState?.v3Enabled ? (
              <AnswerPolicyV3
                modeId={mode.id}
                templateType={mode.templateType}
                state={answerPolicyState}
                onRefresh={() => loadAnswerPolicy(mode.id, mode.templateType)}
              />
            ) : (
              <KnowledgeSource
                modeId={mode.id}
                templateType={mode.templateType}
                contract={sourceContract}
                loading={sourceContractLoading}
                onSave={saveSourceContract}
              />
            )}

            {/* Reference files */}
            <div style={{ marginBottom: 24 }}>
              <h3 style={S.sectionLabel}>Reference files</h3>
              {refFiles.length === 0 && uploading ? (
                <div
                  style={{ ...S.contentBox, padding: '22px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}
                  role="status"
                  key="uploading"
                >
                  <Loader2 size={32} className="animate-spin" style={{ color: 'var(--mm-text-tertiary)' }} />
                  <p style={{ fontSize: 12, color: 'var(--mm-text-secondary)', textAlign: 'center', margin: 0 }}>Adding your file…</p>
                </div>
              ) : refFiles.length === 0 ? (
                <div
                  style={{ ...S.contentBox, padding: '22px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}
                  key="empty"
                >
                  <p style={{ fontSize: 12, color: 'var(--mm-text-tertiary)', textAlign: 'center', margin: 0 }}>
                    Add files as real-time context.
                  </p>
                  <button
                    onClick={uploadFile}
                    className="mm-press"
                    style={S.uploadBtn}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--mm-btn-bg-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'var(--mm-btn-bg)')}
                  >
                    <Paperclip size={13} />
                    <span>Upload file</span>
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} key="list">
                  {refFiles.map(f => (
                    <div
                      key={f.id}
                      data-file-row
                      className={freshFiles.has(f.id) ? 'mm-fresh-row' : undefined}
                      style={S.fileRow}
                    >
                      <FileText size={13} style={{ color: 'var(--mm-text-secondary)', flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 12, color: 'var(--mm-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f.fileName}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--mm-text-tertiary)', flexShrink: 0 }}>
                        {fileStatuses[f.id] === 'indexing' ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Loader2 size={10} className="animate-spin" /> Indexing
                          </span>
                        ) : fileStatuses[f.id] === 'ready' ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Check size={10} style={{ color: 'var(--mm-active-blue)' }} /> Ready
                          </span>
                        ) : (
                          <span style={{ color: 'var(--mm-text-tertiary)', fontSize: 10 }}>
                            {((f.content?.length ?? 0) / 1000).toFixed(1)}k
                          </span>
                        )}
                      </span>
                      <button
                        onClick={() => deleteFile(f.id)}
                        className="mm-press-soft"
                        style={{ ...S.iconBtn, color: 'var(--mm-text-tertiary)' }}
                        onMouseEnter={e => (e.currentTarget.style.color = 'var(--mm-danger)')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--mm-text-tertiary)')}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={uploadFile}
                    disabled={uploading}
                    className="mm-press-soft"
                    style={S.addFileBtn}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--mm-text-primary)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--mm-text-tertiary)')}
                  >
                    <Plus size={12} />
                    {uploading ? 'Uploading…' : 'Add file'}
                  </button>
                </div>
              )}
            </div>

            {/* Writing style (yL from bundle) */}
            <WritingStyle key={`ws-${mode.id}`} modeId={mode.id} />

            {/* Notes template */}
            <div style={{ marginBottom: 24 }}>
              {(() => {
                const modeDefault = defaultNoteSections.length > 0 ? {
                  label: mode.templateType === 'general' ? 'General' : (TEMPLATE_MAP[mode.templateType]?.label ?? 'Default'),
                  titles: defaultNoteSections.map(s => s.title),
                } : null;
                return (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <h3 style={{ ...S.sectionLabel, margin: 0 }}>Notes template</h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <NotesTemplatePicker
                        currentTitles={noteSections.map(s => s.title)}
                        modeDefault={modeDefault}
                        onPick={applyNoteTemplate}
                      />
                      {noteSections.length > 0 && (
                        <button
                          onClick={removeNotesTemplate}
                          className="mm-press-soft"
                          style={S.removeTplBtn}
                          onMouseEnter={e => (e.currentTarget.style.color = 'var(--mm-text-primary)')}
                          onMouseLeave={e => (e.currentTarget.style.color = 'var(--mm-text-tertiary)')}
                        >
                          Remove template
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()}

              {noteSections.length === 0 ? (
                <div style={{ ...S.contentBox, minHeight: 56 }} key={`empty-${notesPanelAnim}`}>
                  <div style={S.autofillPlaceholder}>Autofilled by Natively</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} key={`list-${notesPanelAnim}`}>
                  {noteSections.map(sec => (
                    <SectionCard
                      key={sec.id}
                      section={sec}
                      fresh={freshSections.has(sec.id)}
                      onUpdateTitle={updateSectionTitle}
                      onUpdateDesc={updateSectionDesc}
                      onDelete={deleteSection}
                    />
                  ))}
                </div>
              )}

              <div style={{ marginTop: 12 }}>
                {addingSection && (
                  <NewSectionForm
                    onConfirm={addSection}
                    onCancel={() => setAddingSection(false)}
                  />
                )}
                <button
                  onClick={() => setAddingSection(true)}
                  className="mm-press"
                  style={{ ...S.addSectionBtn, marginTop: addingSection ? 10 : 0, border: '1px solid var(--mm-btn-border)', borderRadius: 20, padding: '6px 14px' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--mm-text-primary)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--mm-text-secondary)')}
                >
                  <Plus size={13} />
                  <span>Add section</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
