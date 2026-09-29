// DEV-ONLY visual rig for the Launcher ⇄ MeetingDetails page transition.
// Not part of the shipped app — vite's build input is index.html only
// (vite.config.mts), so this and launcherTransitionHarness.html exist for the
// dev server alone. Same precedent as thinkingDotHarness.tsx.
//
// It renders the REAL variants (imported from the same module Launcher.tsx
// imports, ./components/launcherPageTransition) against the real
// layer structure (absolute inset-0, z-2 over z-1, overflow-hidden wrapper) so
// what plays here is what plays in the app. The two pages are stand-ins with
// list- and document-weight content — enough text at the real sizes to judge
// whether the parallax reads and whether anything ghosts mid-travel.
//
// The speed control is the point of the rig: the skill is explicit that timing
// faults are invisible at full speed. Watch it at 5x before believing it.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { motion, AnimatePresence } from 'framer-motion';
import '../index.css';
import type { TargetAndTransition } from 'framer-motion';

// Mirrors Launcher.tsx:424-462 (PR #511). Copied rather than imported because
// the app builds these inline inside the component, closed over the
// useReducedMotion() result. Keep in sync by hand — if the numbers below stop
// matching Launcher.tsx, this rig is lying to you.
const NAV_EASE: [number, number, number, number] = [0.32, 0.72, 0, 1];

const detailsInitial = (rm: boolean): TargetAndTransition =>
    rm ? { opacity: 0 } : { opacity: 0, transform: 'translateX(24px)' };
const detailsEnter = (rm: boolean): TargetAndTransition =>
    rm
        ? { opacity: 1, transition: { duration: 0.12, ease: 'linear' } }
        : {
            opacity: 1,
            transform: 'translateX(0px)',
            transition: {
                transform: { duration: 0.34, ease: NAV_EASE },
                opacity: { duration: 0.2, ease: 'easeOut' },
            },
        };
const detailsExit = (rm: boolean): TargetAndTransition =>
    rm
        ? { opacity: 0, pointerEvents: 'none', transition: { duration: 0.12, ease: 'linear' } }
        : {
            opacity: 0,
            transform: 'translateX(20px)',
            pointerEvents: 'none',
            transition: {
                transform: { duration: 0.26, ease: NAV_EASE },
                opacity: { duration: 0.22, ease: 'easeOut' },
            },
        };
const listRecede = (rm: boolean): TargetAndTransition =>
    rm
        ? { opacity: 0.999, transition: { duration: 0.12, ease: 'linear' } }
        : { transform: 'scale(1.03)', transition: { duration: 0.3, ease: NAV_EASE } };
const listSettle = (rm: boolean): TargetAndTransition =>
    rm
        ? { opacity: 1, transition: { duration: 0.12, ease: 'linear' } }
        : { transform: 'scale(1)', transition: { duration: 0.34, ease: NAV_EASE } };

const SPEEDS = [1, 2, 3, 5, 10];

function FakeList({ onOpen }: { onOpen: (n: number) => void }) {
    return (
        <div className="h-full w-full flex flex-col bg-bg-primary text-text-primary overflow-hidden">
            <section className="bg-bg-elevated px-8 pt-6 pb-8 border-b border-border-subtle shrink-0">
                <h1 className="text-3xl font-medium tracking-wide">My Natively</h1>
            </section>
            <div className="flex-1 overflow-y-auto px-8 py-4 space-y-1">
                {Array.from({ length: 14 }, (_, i) => (
                    <button
                        key={i}
                        onClick={() => onOpen(i)}
                        className="w-full text-left px-4 py-3 rounded-xl hover:bg-white/5 flex items-center justify-between"
                    >
                        <span className="text-[14px]">Weekly sync — engineering #{i + 1}</span>
                        <span className="text-[13px] text-text-secondary">3:1{i}pm</span>
                    </button>
                ))}
            </div>
        </div>
    );
}

function FakeDetails({ n }: { n: number }) {
    return (
        <div className="h-full w-full flex flex-col bg-bg-elevated text-text-secondary overflow-hidden">
            <div className="flex-1 overflow-y-auto">
                {/* Plain div, matching MeetingDetails after its own delayed
                    mount fade-up was removed: the page transition owns the
                    entrance, so the arriving panel carries its content with it
                    instead of landing empty and filling in afterwards. */}
                <div className="max-w-4xl mx-auto px-8 py-8">
                    <h1 className="text-2xl font-medium text-text-primary mb-2">
                        Weekly sync — engineering #{n + 1}
                    </h1>
                    <p className="text-[13px] text-text-secondary mb-8">Aug 26 · 42:18</p>
                    {Array.from({ length: 8 }, (_, i) => (
                        <p key={i} className="text-[14px] leading-relaxed mb-4">
                            Paragraph {i + 1}. Body copy at the real 14px so the mid-travel frames
                            show whether the leaving page stays legible over the arriving one, which
                            is the failure a dissolve has and a push should not.
                        </p>
                    ))}
                </div>
            </div>
        </div>
    );
}

function Harness() {
    const [selected, setSelected] = useState<number | null>(null);
    const [speed, setSpeed] = useState(1);
    const [reduced, setReduced] = useState(false);


    return (
        <div className="h-screen w-screen flex flex-col bg-bg-primary">
            <div className="shrink-0 flex items-center gap-4 px-4 h-[52px] border-b border-border-subtle text-text-primary text-[13px]">
                <button
                    onClick={() => setSelected(selected === null ? 0 : null)}
                    className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20"
                >
                    {selected === null ? 'Push →' : '← Pop'}
                </button>
                <div className="flex items-center gap-1">
                    {SPEEDS.map(s => (
                        <button
                            key={s}
                            onClick={() => setSpeed(s)}
                            className={`px-2.5 py-1 rounded-full ${speed === s ? 'bg-white/25' : 'bg-white/5 hover:bg-white/10'}`}
                        >
                            {s}x slower
                        </button>
                    ))}
                </div>
                <label className="flex items-center gap-2 ml-auto">
                    <input type="checkbox" checked={reduced} onChange={e => setReduced(e.target.checked)} />
                    prefers-reduced-motion
                </label>
            </div>

            {/* Mirrors Launcher.tsx: the content area below the persistent
                header chrome, clipping both absolutely-positioned layers. */}
            <div className="relative flex-1 flex flex-col overflow-hidden">
                {/* Slow motion scales the variants' own durations (see
                    `slowed` below) rather than using MotionConfig, so the
                    per-direction PUSH/POP split survives. */}
                <AnimatePresence initial={false}>
                    {selected !== null ? (
                        <motion.div
                            key="details"
                            data-page="details"
                            className="absolute inset-0 z-20 overflow-hidden"
                            initial={detailsInitial(reduced)}
                            animate={slow(detailsEnter(reduced), speed)}
                            exit={slow(detailsExit(reduced), speed)}
                        >
                            <FakeDetails n={selected} />
                        </motion.div>
                    ) : (
                        <motion.div
                            key="launcher"
                            data-page="launcher"
                            className="absolute inset-0 z-10 flex flex-col overflow-hidden"
                            initial={listRecede(reduced)}
                            animate={slow(listSettle(reduced), speed)}
                            exit={slow(listRecede(reduced), speed)}
                        >
                            <FakeList onOpen={setSelected} />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}

// Scale durations without touching the curve, so slow motion stretches the real
// easing rather than showing a different animation. Handles both a flat
// `transition.duration` and the per-property form PR #511 uses.
function slow(target: TargetAndTransition, factor: number): TargetAndTransition {
    if (factor === 1) return target;
    const t = target.transition as Record<string, any> | undefined;
    if (!t) return target;
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(t)) {
        out[k] = typeof v === 'object' && v && 'duration' in v
            ? { ...v, duration: v.duration * factor }
            : k === 'duration' ? v * factor : v;
    }
    return { ...target, transition: out };
}

createRoot(document.getElementById('harness-root')!).render(
    <React.StrictMode>
        <Harness />
    </React.StrictMode>,
);
