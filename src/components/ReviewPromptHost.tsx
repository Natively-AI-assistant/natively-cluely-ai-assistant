// src/components/ReviewPromptHost.tsx
// Reviews-prompt orchestration. Mounted once at the top level; checks the
// backend + local ledger for eligibility, then opens the ReviewModal.
//
// UX rules implemented here (mirrored from the backend so we don't open a
// flash-of-modal during slow networks):
//   * After 3 sessions OR 30 minutes of usage.
//   * "Maybe later" → 7 days or 3 more sessions.
//   * "Don't show again" → never.
//   * Already reviewed → never.
//
// The host defers the very first eligibility check by 15s after mount so the
// modal doesn't compete with startup toasts for attention.
//
// DEV-ONLY FORCE-SHOW:
//   ?review=force  in URL query string  → modal opens immediately + every reopen
//   window.reviewForceShow()             → same flag, callable from devtools
//   Set NativelyReviewService.recordSessionStart()/recordSessionEnd()  in devtools
//   to re-arm threshold-based eligibility checks without restarting.
//
// Honors the existing 4 product semantics even in force mode:
//   * Dismiss / submit / forever all still mark local + backend state.
//   * The dev hook can re-open at will after each dismissal.

import React, { useCallback, useEffect, useRef, useState } from "react"
import ReviewModal from "./ReviewModal"
import { isMac } from "../utils/platformUtils"

const PLATFORM = (() => {
    const p = (typeof navigator !== "undefined" ? navigator.platform : "")?.toLowerCase() || ""
    if (p.includes("mac")) return "macos" as const
    if (p.includes("win")) return "windows" as const
    if (p.includes("linux")) return "linux" as const
    return "other" as const
})()

const APP_VERSION = (() => {
    // Pull from window.electronAPI.getAppVersion if available; otherwise empty.
    try {
        return (window.electronAPI as any)?.appVersion || ""
    } catch {
        return ""
    }
})()

const FIRST_CHECK_DELAY_MS = 15_000
const SUBSEQUENT_CHECK_DELAY_MS = 60_000  // re-check every minute in case the user lingers

// Build-time dev auto-open. Pulled once at module load because Vite injects
// `import.meta.env.DEV` as a literal (true/false) in the bundle — it does not
// change at runtime. In production builds DEV is false, so we use the normal
// 15 s delay; in dev we open almost immediately.
const IS_DEV_BUILD: boolean =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    !!(import.meta as any)?.env?.DEV
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const devDelayMs = (import.meta as any)?.env?.VITE_REVIEW_PROMPT_DELAY_MS
// Tiny delay in dev so the modal doesn't compete with first-paint toasts.
const DEV_FIRST_CHECK_DELAY_MS = IS_DEV_BUILD
    ? (typeof devDelayMs === "string" ? Number(devDelayMs) || 2000 : 2000)
    : FIRST_CHECK_DELAY_MS

// Dev-only force-show switch. Read on every render so a devtools toggle
// takes effect immediately without a page reload.
//
// Behavior:
//   * Production builds (`import.meta.env.DEV === false`) — always false,
//     no modal pops without proper eligibility.
//   * Dev (`npm run electron:dev` / Vite dev server) — defaults to TRUE on
//     every renderer boot. The host opens the modal on mount and re-opens
//     after every dismiss / submit, so you can iterate on the UX without
//     re-launching or hitting threshold counters.
//   * Explicit toggles still work: `?review=off`, `?review=force`, and
//     `window.__reviewForceShow = true|false` override the dev default.
function isDevForceShow(): boolean {
    try {
        if (typeof window === "undefined") return false
        const params = new URLSearchParams(window.location?.search || "")
        const explicit = params.get("review")
        if (explicit === "force") return true
        if (explicit === "off") return false
        const w = window as any
        if (w.__reviewForceShow === true) return true
        if (w.__reviewForceShow === false) return false
        // No explicit override — fall through to the build-time default.
        // Vite sets `import.meta.env.DEV` per build. In Electron's prod build
        // the renderer code is bundled without DEV; in dev it stays true.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dev: boolean = !!(import.meta as any)?.env?.DEV
        return dev
    } catch {
        return false
    }
}

interface ReviewPromptHostProps {
    // Force the host to be hidden (e.g. when another modal is open). Defaults
    // to false — the host is invisible by default.
    paused?: boolean
    // Orchestrator-controlled visibility. When undefined, falls back to the
    // pre-orchestrator behavior (check backend eligibility + dev hooks).
    isOpen?: boolean
    onClose?: () => void
}

const ReviewPromptHost: React.FC<ReviewPromptHostProps> = ({ paused, isOpen: isOpenProp, onClose: onCloseProp }) => {
    const [isOpenInternal, setIsOpen] = useState(false)
    const [forceTick, setForceTick] = useState(0)
    const checkedRef = useRef(false)
    const isOpenRef = useRef(false)

    const isOrchestratorControlled = isOpenProp !== undefined
    const isOpen = isOrchestratorControlled ? isOpenProp : isOpenInternal

    // Expose dev helpers on `window` so we can re-show / reset state from devtools
    // without re-launching the app. These are no-ops in production.
    useEffect(() => {
        if (typeof window === "undefined") return
        const w = window as any
        // Programmatic force-show (re-opens the modal even if backend says no).
        w.reviewForceShow = () => {
            w.__reviewForceShow = true
            setForceTick((n) => n + 1)
        }
        w.reviewClearForceShow = () => {
            w.__reviewForceShow = false
            setForceTick((n) => n + 1)
        }
        // Open immediately, regardless of dev flag.
        w.reviewOpen = () => {
            setForceTick((n) => n + 1)
            isOpenRef.current = true
            setIsOpen(true)
        }
        // Wipe local prompt-state (lets you re-run the full funnel).
        w.reviewResetLocal = async () => {
            try {
                await (window.electronAPI as any)?.reviewDismissForever?.()
            } catch { /* noop */ }
            try {
                // Also call reset which clears fields then we follow up by
                // forcing open.
            } catch { /* noop */ }
            w.reviewForceShow()
        }
    }, [])

    const check = useCallback(async () => {
        if (isOpenRef.current) return
        try {
            if (!window.electronAPI?.reviewGetPromptState) return
            const res = await window.electronAPI.reviewGetPromptState()
            if (!res?.ok) return
            // Dev override: force-show wins over backend eligibility so you can
            // iterate on the modal without re-running sessions.
            if (isDevForceShow() || res.eligible?.eligible) {
                isOpenRef.current = true
                setIsOpen(true)
                window.electronAPI?.reviewMarkShown?.()
            }
        } catch {
            /* noop */
        }
    }, [forceTick])

    useEffect(() => {
        if (paused) return
        // When orchestrator-controlled, the host is purely presentational —
        // visibility comes from the prop, no auto-scheduling.
        if (isOrchestratorControlled) return
        let mounted = true
        const firstDelay = IS_DEV_BUILD ? DEV_FIRST_CHECK_DELAY_MS : FIRST_CHECK_DELAY_MS
        const first = setTimeout(() => {
            if (!mounted || checkedRef.current) return
            checkedRef.current = true
            check()
        }, firstDelay)
        const interval = setInterval(() => {
            if (!mounted) return
            // Re-check periodically so a user who sits at the app eventually
            // crosses the threshold without us having to react to other events.
            check()
        }, SUBSEQUENT_CHECK_DELAY_MS)
        // Close the current usage session on unmount + page-hide. The main
        // process also flushes on before-quit, but the renderer may be torn
        // down first (Cmd+Q on macOS, devtools reload, route change). This
        // makes the session accounting race-free in either path.
        const flush = () => {
            try { window.electronAPI?.reviewFlushSession?.() } catch { /* noop */ }
        }
        window.addEventListener("pagehide", flush)
        window.addEventListener("beforeunload", flush)
        return () => {
            mounted = false
            clearTimeout(first)
            clearInterval(interval)
            window.removeEventListener("pagehide", flush)
            window.removeEventListener("beforeunload", flush)
            flush()
        }
    }, [paused, check])

    const onClose = useCallback(() => {
        isOpenRef.current = false
        if (isOrchestratorControlled) {
            onCloseProp?.()
        } else {
            setIsOpen(false)
        }
    }, [isOrchestratorControlled, onCloseProp])

    const handleDismissLater = useCallback(() => {
        void window.electronAPI?.reviewDismissLater?.()
        // Dev mode: keep showing after a soft dismiss so you can iterate.
        if (isDevForceShow()) {
            // schedule a re-open on next tick
            setTimeout(() => {
                isOpenRef.current = true
                setIsOpen(true)
            }, 1500)
        }
    }, [])

    const handleDismissForever = useCallback(() => {
        void window.electronAPI?.reviewDismissForever?.()
        if (isDevForceShow()) {
            setTimeout(() => {
                isOpenRef.current = true
                setIsOpen(true)
            }, 1500)
        }
    }, [])

    const handleSubmit = useCallback(async (payload: { rating: number; review_text: string | null }) => {
        const res = await window.electronAPI?.reviewSubmit?.(payload)
        // Dev mode: re-arm so you can run the funnel again without restart.
        if (isDevForceShow()) {
            setTimeout(() => {
                isOpenRef.current = true
                setIsOpen(true)
            }, 1500)
        }
        return res || { ok: false, error: "no_api" }
    }, [])

    const handleTestimonial = useCallback(async (payload: any) => {
        const res = await window.electronAPI?.reviewUpdateTestimonial?.(payload)
        if (isDevForceShow()) {
            setTimeout(() => {
                isOpenRef.current = true
                setIsOpen(true)
            }, 1500)
        }
        return res || { ok: false, error: "no_api" }
    }, [])

    return (
        <ReviewModal
            isOpen={isOpen}
            onClose={onClose}
            onDismissLater={handleDismissLater}
            onDismissForever={handleDismissForever}
            platform={PLATFORM}
            appVersion={APP_VERSION}
            hardwareId={undefined}
            submitReview={handleSubmit}
            updateTestimonial={handleTestimonial}
        />
    )
}

export default ReviewPromptHost